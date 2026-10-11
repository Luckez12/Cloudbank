"use strict";

var PROVIDER_NAME = "OneTouchTV";
var BASE_URL = "https://api3.devcorp.me";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var AES_KEY_TEXT = "im72charPasswordofdInitVectorStm";
var AES_IV_TEXT = "im72charPassword";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": BASE_URL + "/"
};

var REQUEST_TIMEOUT_MS = 4200;
var PROVIDER_BUDGET_MS = 18000;

/* AES-256-CBC decryption is implemented locally so this provider does not
 * depend on Node crypto, WebCrypto, or an injected crypto-js module. */
var AES_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var AES_INV_SBOX = (function() {
  var inverse = new Array(256);
  for (var i = 0; i < AES_SBOX.length; i++) inverse[AES_SBOX[i]] = i;
  return inverse;
})();
var AES_RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d,0x9a];

/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  function trace(stage, details) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
        globalThis.vueoTrace(stage, details);
      }
    } catch (_) {}
  }
  function normalize(raw) {
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (_) { return null; }
    }
    if (!raw || typeof raw !== "object" || raw.error) return null;
    var tmdb = raw.tmdb;
    if (!tmdb || typeof tmdb !== "object") {
      if (!raw.title || (raw.mediaType !== "movie" && raw.mediaType !== "tv")) return null;
      var alternatives = Array.isArray(raw.aliases) ? raw.aliases.map(function(alias) {
        return { title: String(alias), iso_3166_1: "" };
      }) : [];
      tmdb = {
        id: raw.tmdbId,
        title: raw.mediaType === "movie" ? raw.title : undefined,
        name: raw.mediaType === "tv" ? raw.title : undefined,
        original_title: raw.mediaType === "movie" ? (raw.originalTitle || raw.title) : undefined,
        original_name: raw.mediaType === "tv" ? (raw.originalTitle || raw.title) : undefined,
        release_date: raw.mediaType === "movie" && raw.year ? String(raw.year) + "-01-01" : "",
        first_air_date: raw.mediaType === "tv" && raw.year ? String(raw.year) + "-01-01" : "",
        external_ids: { imdb_id: raw.imdbId || "" },
        alternative_titles: { titles: alternatives, results: alternatives }
      };
    }
    if (!tmdb.title && !tmdb.name) return null;
    trace("METADATA", { shared: true, title: raw.title || tmdb.title || tmdb.name || "",
      year: raw.year || "", imdbId: raw.imdbId || "",
      aliases: Array.isArray(raw.aliases) ? raw.aliases.length : 0 });
    return tmdb;
  }
  function local() {
    trace("METADATA_FALLBACK", { shared: false });
    return Promise.resolve().then(fallback);
  }
  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve().then(function() {
          return globalThis.vueoDiscoveryContext(url);
        }).then(function(raw) {
          var shared = normalize(raw);
          return shared || local();
        }, local);
      }
    }
  } catch (_) {}
  return local();
}


function vueoCandidateTrace(stage, details) {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.vueoTrace === "function"
    ) {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function asciiBytes(value) {
  var text = String(value || "");
  var out = new Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function decodeBase64(input) {
  var value = String(input || "")
    .replace(/-_\./g, "/")
    .replace(/@/g, "+")
    .replace(/\s+/g, "");
  while (value.length % 4 !== 0) value += "=";

  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  for (var i = 0; i < value.length; i += 4) {
    var c0 = alphabet.indexOf(value.charAt(i));
    var c1 = alphabet.indexOf(value.charAt(i + 1));
    var c2char = value.charAt(i + 2);
    var c3char = value.charAt(i + 3);
    var c2 = c2char === "=" ? 0 : alphabet.indexOf(c2char);
    var c3 = c3char === "=" ? 0 : alphabet.indexOf(c3char);
    if (c0 < 0 || c1 < 0 || (c2char !== "=" && c2 < 0) || (c3char !== "=" && c3 < 0)) {
      throw new Error("Invalid OneTouchTV base64 payload");
    }
    var triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    output.push((triple >>> 16) & 0xff);
    if (c2char !== "=") output.push((triple >>> 8) & 0xff);
    if (c3char !== "=") output.push(triple & 0xff);
  }
  return output;
}

function gfMul(a, b) {
  var x = a & 0xff;
  var y = b & 0xff;
  var result = 0;
  for (var i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    var hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>>= 1;
  }
  return result & 0xff;
}

function rotWord(word) {
  return [word[1], word[2], word[3], word[0]];
}

function subWord(word) {
  return [AES_SBOX[word[0]], AES_SBOX[word[1]], AES_SBOX[word[2]], AES_SBOX[word[3]]];
}

function expandAes256Key(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error("OneTouchTV AES key must be 32 bytes");
  var words = new Array(60);
  var i;
  for (i = 0; i < 8; i++) {
    words[i] = [
      keyBytes[i * 4], keyBytes[i * 4 + 1], keyBytes[i * 4 + 2], keyBytes[i * 4 + 3]
    ];
  }
  for (i = 8; i < 60; i++) {
    var temp = words[i - 1].slice();
    if (i % 8 === 0) {
      temp = subWord(rotWord(temp));
      temp[0] ^= AES_RCON[i / 8];
    } else if (i % 8 === 4) {
      temp = subWord(temp);
    }
    words[i] = [
      words[i - 8][0] ^ temp[0],
      words[i - 8][1] ^ temp[1],
      words[i - 8][2] ^ temp[2],
      words[i - 8][3] ^ temp[3]
    ];
  }

  var expanded = new Array(240);
  for (i = 0; i < 60; i++) {
    expanded[i * 4] = words[i][0] & 0xff;
    expanded[i * 4 + 1] = words[i][1] & 0xff;
    expanded[i * 4 + 2] = words[i][2] & 0xff;
    expanded[i * 4 + 3] = words[i][3] & 0xff;
  }
  return expanded;
}

function addRoundKey(state, expandedKey, round) {
  var offset = round * 16;
  for (var i = 0; i < 16; i++) state[i] = (state[i] ^ expandedKey[offset + i]) & 0xff;
}

function invSubBytes(state) {
  for (var i = 0; i < 16; i++) state[i] = AES_INV_SBOX[state[i]];
}

function invShiftRows(state) {
  var copy = state.slice();
  for (var row = 0; row < 4; row++) {
    for (var col = 0; col < 4; col++) {
      var sourceCol = (col - row + 4) % 4;
      state[row + 4 * col] = copy[row + 4 * sourceCol];
    }
  }
}

function invMixColumns(state) {
  for (var col = 0; col < 4; col++) {
    var i = col * 4;
    var a0 = state[i];
    var a1 = state[i + 1];
    var a2 = state[i + 2];
    var a3 = state[i + 3];
    state[i] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
    state[i + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
    state[i + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
    state[i + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
  }
}

function decryptAesBlock(block, expandedKey) {
  var state = block.slice();
  addRoundKey(state, expandedKey, 14);
  for (var round = 13; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, expandedKey, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, expandedKey, 0);
  return state;
}

function utf8Decode(bytes) {
  var output = "";
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i++] & 0xff;
    if (b0 < 0x80) {
      output += String.fromCharCode(b0);
      continue;
    }
    if ((b0 & 0xe0) === 0xc0) {
      if (i >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b1 = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
      continue;
    }
    if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b2a = bytes[i++] & 0x3f;
      var b2b = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x0f) << 12) | (b2a << 6) | b2b);
      continue;
    }
    if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b3a = bytes[i++] & 0x3f;
      var b3b = bytes[i++] & 0x3f;
      var b3c = bytes[i++] & 0x3f;
      var codePoint = ((b0 & 0x07) << 18) | (b3a << 12) | (b3b << 6) | b3c;
      codePoint -= 0x10000;
      output += String.fromCharCode(0xd800 + (codePoint >>> 10), 0xdc00 + (codePoint & 0x3ff));
      continue;
    }
    throw new Error("Invalid UTF-8 payload");
  }
  return output;
}

function decryptString(encrypted) {
  var ciphertext = decodeBase64(encrypted);
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error("Encrypted OneTouchTV payload is not AES block aligned");
  }

  var expandedKey = expandAes256Key(asciiBytes(AES_KEY_TEXT));
  var iv = asciiBytes(AES_IV_TEXT);
  var plain = [];
  var previous = iv;
  for (var offset = 0; offset < ciphertext.length; offset += 16) {
    var cipherBlock = ciphertext.slice(offset, offset + 16);
    var decryptedBlock = decryptAesBlock(cipherBlock, expandedKey);
    for (var i = 0; i < 16; i++) plain.push((decryptedBlock[i] ^ previous[i]) & 0xff);
    previous = cipherBlock;
  }

  var padding = plain[plain.length - 1];
  if (padding < 1 || padding > 16 || padding > plain.length) throw new Error("Invalid OneTouchTV PKCS7 padding");
  for (var p = 0; p < padding; p++) {
    if (plain[plain.length - 1 - p] !== padding) throw new Error("Invalid OneTouchTV PKCS7 padding");
  }
  plain.length -= padding;

  var envelope = JSON.parse(utf8Decode(plain));
  if (envelope === null || envelope === undefined) {
    throw new Error("OneTouchTV decrypted payload is empty");
  }

  // Older OneTouchTV responses wrap the real JSON as a string in `result`.
  // Newer responses may expose `result` directly as an object/array, or may
  // already be the final JSON payload. Support all three shapes.
  if (typeof envelope === "object" && !Array.isArray(envelope) &&
      Object.prototype.hasOwnProperty.call(envelope, "result")) {
    if (typeof envelope.result === "string") return envelope.result;
    if (envelope.result === null || envelope.result === undefined) return "null";
    return JSON.stringify(envelope.result);
  }

  return JSON.stringify(envelope);
}


function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;

    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          (label || "OneTouchTV request") +
          " timed out"
        )
      );
    }, Math.max(1, Number(timeoutMs || 1)));

    Promise.resolve(promise).then(
      function(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function unwrapPayload(value) {
  var current = value;

  for (var i = 0; i < 4; i++) {
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      if (
        current.result !== undefined &&
        current.result !== null
      ) {
        current = current.result;
        continue;
      }

      if (
        current.data !== undefined &&
        current.data !== null
      ) {
        current = current.data;
        continue;
      }
    }

    break;
  }

  return current;
}

function isBlankValue(value) {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  );
}

function fetchText(
  url,
  headers,
  timeoutMs
) {
  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers:
        Object.assign(
          {},
          DEFAULT_HEADERS,
          headers || {}
        ),
      redirect: "follow"
    }).then(function(response) {
      if (!response.ok) {
        throw new Error(
          "HTTP " +
          response.status +
          " for " +
          url
        );
      }

      return response.text();
    }),
    timeoutMs || REQUEST_TIMEOUT_MS,
    "OneTouchTV text request"
  );
}

function fetchJson(
  url,
  headers,
  timeoutMs
) {
  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers:
        Object.assign(
          {},
          DEFAULT_HEADERS,
          headers || {}
        ),
      redirect: "follow"
    }).then(function(response) {
      if (!response.ok) {
        throw new Error(
          "HTTP " +
          response.status +
          " for " +
          url
        );
      }

      return response.json();
    }),
    timeoutMs || REQUEST_TIMEOUT_MS,
    "OneTouchTV JSON request"
  );
}
function fetchDecryptedJson(
  url,
  headers,
  timeoutMs
) {
  return fetchText(
    url,
    headers,
    timeoutMs
  ).then(function(raw) {
    var text =
      String(raw || "").trim();

    if (!text) {
      throw new Error(
        "OneTouchTV response is empty"
      );
    }

    /*
     * Current API uses AES, but accepting plaintext JSON makes the provider
     * survive endpoint/envelope changes without breaking the whole pipeline.
     */
    if (
      text.charAt(0) === "{" ||
      text.charAt(0) === "["
    ) {
      return JSON.parse(text);
    }

    var decrypted =
      decryptString(text);

    return JSON.parse(decrypted);
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(item, keys) {
  if (!item || typeof item !== "object") return null;
  for (var i = 0; i < keys.length; i++) {
    var value = item[keys[i]];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function itemId(item) {
  return firstValue(item, ["id", "vodId", "vod_id", "contentId", "content_id", "movieId", "movie_id"]);
}

function itemTitle(item) {
  return String(firstValue(item, [
    "title", "name", "vodName", "vod_name", "displayName", "display_name",
    "movieName", "movie_name", "dramaName", "drama_name", "originalTitle", "original_title"
  ]) || "");
}

function itemYear(item) {
  var raw = String(firstValue(item, [
    "year", "releaseDate", "release_date", "firstAirDate", "first_air_date",
    "publishDate", "publish_date", "date"
  ]) || "");
  var match = raw.match(/\d{4}/);
  return match ? match[0] : "";
}

function itemType(item) {
  return String(firstValue(item, [
    "type", "contentType", "content_type", "vodType", "vod_type", "category"
  ]) || "").toLowerCase();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 82;

  var expectedWords = right.split(" ").filter(function(word) { return word.length > 1; });
  var candidateWords = left.split(" ").filter(function(word) { return word.length > 1; });
  var set = {};
  candidateWords.forEach(function(word) { set[word] = true; });

  var matched = expectedWords.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  var recall = matched / Math.max(expectedWords.length, 1);
  var precision = matched / Math.max(candidateWords.length, 1);
  return Math.round((recall * 0.7 + precision * 0.3) * 72);
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(
    data &&
    (
      data.original_title ||
      data.original_name
    ),
    95
  );

  var altRoot =
    data &&
    data.alternative_titles;

  var altItems =
    altRoot &&
    (
      Array.isArray(altRoot.titles)
        ? altRoot.titles
        : Array.isArray(altRoot.results)
          ? altRoot.results
          : []
    );

  altItems.forEach(function(item) {
    if (!item) return;

    var country =
      String(
        item.iso_3166_1 || ""
      ).toUpperCase();

    var boost =
      country === "US" ||
      country === "GB"
        ? 86
        : country === "MY" ||
          country === "ID"
          ? 82
          : 72;

    add(
      item.title ||
      item.name,
      boost
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(
      data.translations.translations
    )
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    var row =
      item &&
      item.data &&
      typeof item.data === "object"
        ? item.data
        : {};

    var lang =
      String(
        item &&
        item.iso_639_1 ||
        ""
      ).toLowerCase();

    var boost =
      lang === "en"
        ? 88
        : lang === "ms" ||
          lang === "id"
          ? 80
          : 68;

    add(
      row.title ||
      row.name,
      boost
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 12);
}

function bestAliasTitleScore(candidate, info) {
  var aliases =
    info &&
    Array.isArray(info.aliases) &&
    info.aliases.length
      ? info.aliases
      : [
          info && info.title,
          info && info.originalTitle
        ];

  var best = 0;

  aliases.forEach(function(alias) {
    best = Math.max(
      best,
      titleScore(
        candidate,
        alias
      )
    );
  });

  return best;
}

function buildAliasQueries(info, limit) {
  var output = [];
  var seen = {};

  var aliases =
    info &&
    Array.isArray(info.aliases)
      ? info.aliases
      : [
          info && info.title,
          info && info.originalTitle
        ];

  aliases.forEach(function(alias) {
    var text =
      String(alias || "")
        .trim();

    var key =
      normalizeTitle(text);

    if (
      !text ||
      !key ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  });

  return output.slice(
    0,
    Math.max(
      1,
      Number(limit || 4)
    )
  );
}

function extractSeasonFromTitle(title) {
  var normalized = normalizeTitle(title);
  var patterns = [
    /(?:season|series)\s*(\d+)\b/,
    /\bs\s*(\d+)\b/,
    /\bpart\s*(\d+)\b/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = normalized.match(patterns[i]);
    if (match) return Number(match[1]);
  }
  return null;
}

function scoreCandidate(item, info, mediaType, season) {
  var score =
    bestAliasTitleScore(
      itemTitle(item),
      info
    );

  var directTmdb = firstValue(item, ["tmdbId", "tmdb_id", "themoviedbId", "themoviedb_id"]);
  if (directTmdb && String(directTmdb) === String(info.tmdbId || "")) score += 200;

  var year = itemYear(item);
  if (info.year && year && year === info.year) score += 28;

  var type = itemType(item);
  var typeIsMovie =
    type === "movie" ||
    type === "film" ||
    type === "1";

  if (type) {
    if (
      mediaType === "movie" &&
      typeIsMovie
    ) {
      score += 30;
    } else if (
      mediaType === "tv" &&
      !typeIsMovie
    ) {
      score += 22;
    } else {
      score -= 70;
    }
  }

  var rank = Number(item && item.__vueoSearchRank || 0);
  var queryIndex = Number(item && item.__vueoQueryIndex || 0);
  score += Math.max(0, 18 - rank * 3);
  if (queryIndex === 0) score += 6;

  if (mediaType === "tv") {
    var requestedSeason = Number(season || 1);
    var titleSeason = extractSeasonFromTitle(itemTitle(item));
    if (requestedSeason > 1) {
      if (titleSeason === requestedSeason) score += 35;
      else if (titleSeason !== null) score -= 40;
    } else if (titleSeason !== null && titleSeason !== 1) {
      score -= 30;
    }
  }
  return score;
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles,translations,external_ids";
  return vueoSharedTmdb(
    url,
    function() {
      return fetchJson(url, {});
    }
  ).then(function(data) {
    return {
      tmdbId: String(tmdbId),
      title: data.title || data.name || "",
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").split("-")[0],
      aliases: collectTmdbAliases(data, mediaType)
    };
  });
}

function searchOneTouch(query, page) {
  var clean = String(query || "").trim();
  if (!clean) return Promise.resolve([]);
  var url = BASE_URL + "/vod/search?page=" + String(page || 1) + "&keyword=" + encodeURIComponent(clean);
  return fetchDecryptedJson(url, { "Referer": BASE_URL + "/" }).then(function(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];

    var candidates = [
      data.result,
      data.items,
      data.list,
      data.records,
      data.data,
      data.data && data.data.items,
      data.data && data.data.list,
      data.result && data.result.items,
      data.result && data.result.list
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i])) return candidates[i];
    }
    return [];
  });
}

function getDetail(id) {
  return fetchDecryptedJson(BASE_URL + "/vod/" + encodeURIComponent(id) + "/detail", {});
}

function findBestTitle(info, mediaType, season) {
  var requestedSeason = mediaType === "tv" ? Number(season || 1) : 0;
  var aliases = buildAliasQueries(info, 5);
  var queries = aliases.slice();

  if (requestedSeason > 1) {
    aliases.slice(0, 3).forEach(function(alias) {
      queries.unshift(
        alias +
        " Season " +
        requestedSeason
      );
    });
  }

  queries = queries.slice(0, 7);

  return Promise.all(queries.map(function(query) {
    return searchOneTouch(query, 1).catch(function(error) {
      console.log("[OneTouchTV] search miss query=\"" + query + "\" error=" +
        (error && error.message ? error.message : String(error)));
      return [];
    });
  })).then(function(groups) {
    vueoCandidateTrace("SEARCH", {
      queries: queries.length,
      groups: groups.length,
      nonEmpty: groups.filter(function(group) { return Array.isArray(group) && group.length; }).length
    });
    var seen = {};
    var candidates = [];

    groups.forEach(function(group, queryIndex) {
      group.forEach(function(rawItem, rank) {
        var id = itemId(rawItem);
        if (id === undefined || id === null || seen[String(id)]) return;
        seen[String(id)] = true;

        var item = Object.assign({}, rawItem);
        item.__vueoSearchRank = rank;
        item.__vueoQueryIndex = queryIndex;
        candidates.push(item);
      });
    });

    candidates.sort(function(a, b) {
      return scoreCandidate(b, info, mediaType, season) - scoreCandidate(a, info, mediaType, season);
    });

    vueoCandidateTrace("CANDIDATE", {
      count: candidates.length,
      title: candidates.length ? itemTitle(candidates[0]) : "",
      score: candidates.length ? scoreCandidate(candidates[0], info, mediaType, season) : 0
    });

    candidates = candidates.slice(0, 6);
    if (!candidates.length) throw new Error("No OneTouchTV title match");

    return Promise.all(candidates.map(function(candidate) {
      var id = itemId(candidate);
      return getDetail(id).then(function(detail) {
        var score = scoreCandidate(candidate, info, mediaType, season);

        var detailRoot =
          unwrapPayload(detail);

        var detailTitle =
          itemTitle(detailRoot);

        score = Math.max(
          score,
          bestAliasTitleScore(
            detailTitle,
            info
          ) + 20
        );

        var detailType =
          itemType(detailRoot);

        var detailIsMovie =
          detailType === "movie" ||
          detailType === "film" ||
          detailType === "1";

        if (detailType) {
          if (
            mediaType === "movie" &&
            detailIsMovie
          ) {
            score += 24;
          } else if (
            mediaType === "tv" &&
            !detailIsMovie
          ) {
            score += 18;
          } else {
            score -= 75;
          }
        }

        var detailYear =
          itemYear(detailRoot);
        if (info.year && detailYear && detailYear === info.year) score += 20;

        return { candidate: candidate, detail: detail, score: score };
      }).catch(function() {
        return null;
      });
    })).then(function(matches) {
      matches = matches.filter(Boolean).sort(function(a, b) { return b.score - a.score; });
      if (!matches.length) throw new Error("No OneTouchTV detail match");

      /*
       * The OneTouchTV server already ranked these results for the exact TMDB
       * title query. Do not reject a top server result solely because the site
       * uses an alternate English title while TMDB uses another alias.
       */
      if (matches[0].score < 28) {
        throw new Error("OneTouchTV match confidence too low");
      }

      vueoCandidateTrace("VERIFIED", {
        title: itemTitle(unwrapPayload(matches[0].detail)),
        score: matches[0].score
      });

      return matches[0];
    });
  });
}

function episodeNumber(value) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) return null;
  var exact = Number(text);
  if (isFinite(exact)) return exact;
  var match = text.match(/(?:episode|ep)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function selectEpisode(
  detail,
  mediaType,
  episode
) {
  var root =
    unwrapPayload(detail);

  var episodes =
    root &&
    Array.isArray(root.episodes)
      ? root.episodes
      : root &&
        Array.isArray(root.episodeList)
          ? root.episodeList
          : root &&
            Array.isArray(root.episode_list)
              ? root.episode_list
              : [];

  if (!episodes.length) {
    throw new Error(
      "No OneTouchTV episodes"
    );
  }

  if (
    mediaType === "movie" ||
    episodes.length === 1
  ) {
    return episodes[0];
  }

  var requested =
    Math.max(
      1,
      Number(episode || 1)
    );

  function valueOf(item) {
    return episodeNumber(
      firstValue(
        item,
        [
          "episode",
          "episodeNumber",
          "episode_number",
          "number",
          "ep",
          "name",
          "title"
        ]
      )
    );
  }

  for (
    var i = 0;
    i < episodes.length;
    i += 1
  ) {
    if (
      valueOf(episodes[i]) ===
      requested
    ) {
      return episodes[i];
    }
  }

  var numbered =
    episodes.filter(function(item) {
      return (
        valueOf(item) !== null
      );
    });

  if (
    !numbered.length &&
    episodes.length >= requested
  ) {
    return episodes[
      requested - 1
    ];
  }

  throw new Error(
    "Episode " +
    requested +
    " not found on OneTouchTV"
  );
}
function getEpisodePayload(identifier, playId) {
  var url = BASE_URL + "/vod/" + encodeURIComponent(identifier) + "/episode/" + encodeURIComponent(playId);
  return fetchDecryptedJson(url, {});
}

function inferQuality(source) {
  var explicit = String(source && source.quality || source && source.name || "").trim();
  var value = (explicit + " " + String(source && source.url || "")).toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1 || value.indexOf("2k") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return explicit || "Auto";
}

function subtitleLanguage(name) {
  var value = String(name || "").trim();
  var lower = value.toLowerCase();
  var aliases = {
    en: ["english", "eng", "en"], ms: ["malay", "malaysia", "ms"], id: ["indonesian", "indonesia", "id"],
    ko: ["korean", "kor", "ko"], zh: ["chinese", "chi", "zh", "zho"], ja: ["japanese", "jpn", "ja"],
    th: ["thai", "tha", "th"], vi: ["vietnamese", "vie", "vi"], ar: ["arabic", "ara", "ar"],
    es: ["spanish", "spa", "es"], fr: ["french", "fra", "fr"], pt: ["portuguese", "por", "pt"]
  };
  var labels = { en: "English", ms: "Malay", id: "Indonesian", ko: "Korean", zh: "Chinese", ja: "Japanese", th: "Thai", vi: "Vietnamese", ar: "Arabic", es: "Spanish", fr: "French", pt: "Portuguese" };
  var keys = Object.keys(aliases);
  for (var i = 0; i < keys.length; i++) {
    var code = keys[i];
    if (aliases[code].some(function(alias) { return lower === alias || lower.indexOf(alias) !== -1; })) {
      return { code: code, label: labels[code] };
    }
  }
  return { code: lower || "und", label: value || "Unknown" };
}

function normalizeHeaders(
  headers,
  fallbackReferer
) {
  var input =
    headers &&
    typeof headers === "object"
      ? headers
      : {};

  var output = {};

  Object.keys(input)
    .forEach(function(key) {
      var lower =
        String(key || "")
          .toLowerCase();

      if (
        lower === "host" ||
        lower === "connection" ||
        lower === "content-length" ||
        lower === "accept-encoding" ||
        lower === "range" ||
        lower.indexOf("sec-fetch-") === 0
      ) {
        return;
      }

      if (
        input[key] !== undefined &&
        input[key] !== null &&
        String(input[key]) !== ""
      ) {
        output[key] =
          String(input[key]);
      }
    });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  var referer =
    output["Referer"] ||
    output["referer"] ||
    fallbackReferer ||
    BASE_URL + "/";

  delete output["referer"];
  output["Referer"] = referer;

  return output;
}
function buildSubtitles(payload) {
  var root =
    unwrapPayload(payload);

  var tracks =
    root &&
    Array.isArray(root.track)
      ? root.track
      : root &&
        Array.isArray(root.tracks)
          ? root.tracks
          : root &&
            Array.isArray(root.subtitles)
              ? root.subtitles
              : [];

  var seen = {};

  return tracks
    .map(function(track) {
      var rawUrl =
        firstValue(
          track,
          [
            "file",
            "url",
            "src"
          ]
        );

      var url =
        String(rawUrl || "").trim();

      if (!url) {
        return null;
      }

      try {
        url =
          new URL(
            url,
            BASE_URL + "/"
          ).toString();
      } catch (_) {}

      if (seen[url]) {
        return null;
      }

      seen[url] = true;

      var lang =
        subtitleLanguage(
          firstValue(
            track,
            [
              "name",
              "label",
              "language",
              "lang"
            ]
          )
        );

      var format =
        String(
          firstValue(
            track,
            [
              "format",
              "type"
            ]
          ) ||
          ""
        ).toLowerCase();

      if (!format) {
        var cleanUrl =
          url
            .toLowerCase()
            .split("?")[0];

        if (cleanUrl.endsWith(".vtt")) {
          format = "vtt";
        } else if (cleanUrl.endsWith(".srt")) {
          format = "srt";
        } else if (cleanUrl.endsWith(".ass")) {
          format = "ass";
        }
      }

      return {
        label: lang.label,
        language: lang.label,
        lang: lang.code,
        url: url,
        default:
          Boolean(
            track &&
            (
              track.default ||
              track.isDefault
            )
          ),
        format: format
      };
    })
    .filter(Boolean);
}
function buildStreams(
  payload,
  subtitles,
  info,
  mediaType,
  season,
  episode
) {
  var root =
    unwrapPayload(payload);

  var sources =
    root &&
    Array.isArray(root.sources)
      ? root.sources
      : root &&
        Array.isArray(root.source)
          ? root.source
          : root &&
            Array.isArray(root.streams)
              ? root.streams
              : [];

  var seen = {};

  var episodeLabel =
    mediaType === "tv"
      ? " S" +
        String(
          season || 1
        ).padStart(2, "0") +
        "E" +
        String(
          episode || 1
        ).padStart(2, "0")
      : "";

  return sources
    .map(function(source, index) {
      var rawUrl =
        firstValue(
          source,
          [
            "url",
            "file",
            "src"
          ]
        );

      var url =
        String(rawUrl || "")
          .trim();

      if (!url) {
        return null;
      }

      try {
        url =
          new URL(
            url,
            BASE_URL + "/"
          ).toString();
      } catch (_) {}

      if (seen[url]) {
        return null;
      }

      seen[url] = true;

      var sourceName =
        String(
          firstValue(
            source,
            [
              "name",
              "label",
              "server"
            ]
          ) ||
          ""
        ).trim();

      var quality =
        inferQuality(
          Object.assign(
            {},
            source,
            {
              url: url,
              name: sourceName
            }
          )
        );

      var sourceHeaders =
        source &&
        source.headers &&
        typeof source.headers === "object"
          ? source.headers
          : {};

      var sourceReferer =
        firstValue(
          source,
          [
            "referer",
            "referrer"
          ]
        ) ||
        sourceHeaders.Referer ||
        sourceHeaders.referer ||
        BASE_URL + "/";

      return {
        name:
          PROVIDER_NAME +
          (
            sourceName
              ? " " + sourceName
              : sources.length > 1
                ? " Server " + (index + 1)
                : ""
          ),
        title:
          (info.title || PROVIDER_NAME) +
          episodeLabel,
        url: url,
        quality: quality,
        type: "direct",
        subtitles: subtitles,
        headers:
          normalizeHeaders(
            sourceHeaders,
            String(sourceReferer)
          )
      };
    })
    .filter(Boolean);
}
function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  console.log("[OneTouchTV] Request tmdbId=" + tmdbId + " type=" + type +
    (type === "tv" ? " S" + (season || 1) + "E" + (episode || 1) : ""));

  var info;

  var work =
    getTmdbInfo(
      tmdbId,
      type
    )
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestTitle(info, type, season);
    })
    .then(function(match) {
      var selected =
        selectEpisode(
          match.detail,
          type,
          episode
        );

      var identifier =
        firstValue(
          selected,
          [
            "identifier",
            "contentIdentifier",
            "content_identifier",
            "vodIdentifier",
            "vod_identifier",
            "contentId",
            "content_id"
          ]
        );

      var playId =
        firstValue(
          selected,
          [
            "playId",
            "play_id",
            "playID",
            "id",
            "episodeId",
            "episode_id"
          ]
        );

      if (
        isBlankValue(identifier) ||
        isBlankValue(playId)
      ) {
        throw new Error(
          "OneTouchTV episode identifier is missing"
        );
      }

      return getEpisodePayload(
        identifier,
        playId
      );
    })
    .then(function(payload) {
      var subtitles = buildSubtitles(payload);
      var streams = buildStreams(payload, subtitles, info, type, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[OneTouchTV] Direct streams found=" + streams.length + " subtitles=" + subtitles.length);
      return streams;
    })
    ;

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "OneTouchTV provider"
  ).catch(function(error) {
    console.error(
      "[OneTouchTV] " +
      (
        error &&
        error.message
          ? error.message
          : String(error)
      )
    );

    return [];
  });
}

module.exports = { getStreams: getStreams };

/* CLOUDBANK_TEST_PLUGIN_ADAPTATION_START */
// Test-Plugin is an additional extraction/discovery engine. Existing Cloudbank
// discovery and native-host fallbacks remain available in the same provider.
var cloudbankLegacyProvider = module.exports;
var cloudbankTestPluginProvider = (function() {
  var transferredModule = { exports: {} };
  function metadataFetch(url, options) {
    var raw = typeof url === "string" ? url : url && url.url;
    var match = typeof raw === "string" && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || (options && options.method && String(options.method).toUpperCase() !== "GET")) return fetch(url, options);
    // Reject an explicitly stale host context instead of displaying another title.
    var context = typeof globalThis !== "undefined" ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === "string") { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    var stale = contextId && String(contextId) !== match[2];
    if (stale) return fetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return fetch(url, options).then(function(response) {
        if (!response.ok) throw new Error("TMDB HTTP " + response.status);
        return response.json();
      });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw,
        headers: { get: function(name) { return String(name).toLowerCase() === "content-type" ? "application/json" : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); },
        text: function() { return Promise.resolve(body); } };
    });
  }
  (function(module, exports, fetch) {
/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */
const PROVIDER = "OneTouchTV";
const BASE = "https://api3.devcorp.me";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const AES_KEY = "im72charPasswordofdInitVectorStm";
const AES_IV = "im72charPassword";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

const decryptedCache = new Map();
const searchCache = new Map();


function fetchText(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "unknown"));
    }
    return res.text();
  });
}

function sanitizeJsonControls(input) {
  var text = String(input == null ? "" : input).replace(/^\uFEFF/, "");
  var out = "";
  var inString = false;
  var escaped = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var code = text.charCodeAt(i);

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }

      if (code < 0x20) {
        out += "\\u" + ("000" + code.toString(16)).slice(-4);
        continue;
      }

      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      out += " ";
      continue;
    }

    out += ch;
  }

  return out;
}

function parseJsonLenient(input, label) {
  var text = String(input == null ? "" : input).trim();

  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(sanitizeJsonControls(text));
    } catch (secondError) {
      throw new Error(
        (label || "payload") + " JSON parse failed: " +
        (secondError && secondError.message ? secondError.message : String(secondError))
      );
    }
  }
}

function fetchJson(url, options) {
  return fetchText(url, options).then(function (text) {
    return parseJsonLenient(text, "TMDB");
  });
}

function getCryptoJS() {
  try {
    return require("crypto-js");
  } catch (error) {
    throw new Error("crypto-js module unavailable");
  }
}

function normalizeEncryptedBase64(input) {
  var value = String(input || "")
    .replace(/-_\./g, "/")
    .replace(/@/g, "+")
    .replace(/\s+/g, "");

  var remainder = value.length % 4;
  if (remainder) value += new Array(5 - remainder).join("=");
  return value;
}

function decryptString(encrypted) {
  var CryptoJS = getCryptoJS();
  var normalized = normalizeEncryptedBase64(encrypted);
  var cipherBytes = CryptoJS.enc.Base64.parse(normalized);
  var key = CryptoJS.enc.Utf8.parse(AES_KEY);
  var iv = CryptoJS.enc.Utf8.parse(AES_IV);
  var params = CryptoJS.lib.CipherParams.create({ ciphertext: cipherBytes });
  var decrypted = CryptoJS.AES.decrypt(params, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  var plain = decrypted.toString(CryptoJS.enc.Utf8);
  if (!plain) throw new Error("empty decrypted payload");

  var wrapper = parseJsonLenient(plain, "encrypted wrapper");
  if (!wrapper || wrapper.result == null) {
    throw new Error("decrypted payload missing result");
  }

  if (typeof wrapper.result === "string") {
    return wrapper.result;
  }

  return JSON.stringify(wrapper.result);
}

function decryptViaRemote(raw) {
  return fetch("https://enc-dec.app/api/dec-onetouchtv", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({ text: String(raw || "") })
  }).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("remote decrypt HTTP " + (res ? res.status : "unknown"));
    }
    return res.text();
  }).then(function (body) {
    var envelope = parseJsonLenient(body, "remote decrypt response");

    if (!envelope || Number(envelope.status) !== 200) {
      throw new Error(
        "remote decrypt failed" +
        (envelope && envelope.error ? ": " + envelope.error : "")
      );
    }

    var result = envelope.result;

    if (typeof result === "string") {
      return parseJsonLenient(result, "remote decrypted result");
    }

    if (result && typeof result === "object") {
      return result;
    }

    throw new Error("remote decrypt returned empty result");
  });
}

function getDecryptedJson(url) {
  if (decryptedCache.has(url)) {
    return Promise.resolve(decryptedCache.get(url));
  }

  return fetchText(url, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Referer": BASE + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (raw) {
    // Current OneTouchTV payloads are not reliably compatible with the
    // local AES routine. Use the working decrypt endpoint directly.
    return decryptViaRemote(raw);
  }).then(function (result) {
    decryptedCache.set(url, result);
    return result;
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingYear(value) {
  return normalizeTitle(value)
    .replace(/\s+(?:19|20)\d{2}$/, "")
    .trim();
}

function seasonTitleVariants(title, season) {
  var s = Number(season || 1);
  var base = String(title || "").trim();
  if (!base || s <= 1) return [];

  return [
    base + " Season " + s,
    base + " Season" + s,
    base + " S" + String(s).padStart(2, "0"),
    base + " S" + s,
    base + " " + s,
    base + " " + s + "nd Season",
    base + " " + s + "rd Season",
    base + " " + s + "th Season"
  ];
}

function inferQuality(value) {
  var match = String(value || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)(?:p|[^0-9]|$)/i);
  return match ? match[1] + "p" : "Auto";
}

function inferType(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf(".m3u8") !== -1) return "m3u8";
  if (value.indexOf(".mp4") !== -1) return "mp4";
  return "m3u8";
}

function fetchTmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  }).then(function (data) {
    if (!data) return null;

    var altRoot = data.alternative_titles || {};
    var altItems = type === "movie"
      ? (Array.isArray(altRoot.titles) ? altRoot.titles : [])
      : (Array.isArray(altRoot.results) ? altRoot.results : []);

    var alternativeTitles = altItems.map(function (item) {
      return item && item.title ? String(item.title).trim() : "";
    }).filter(Boolean);

    return {
      title: type === "movie" ? (data.title || data.original_title || "") : (data.name || data.original_name || ""),
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4),
      alternativeTitles: alternativeTitles
    };
  });
}

function buildQueries(details, mediaType, season) {
  var queries = [];

  function add(value) {
    value = String(value || "").trim();
    if (value && queries.indexOf(value) === -1) queries.push(value);
  }

  var titles = [details.title, details.originalTitle]
    .concat(Array.isArray(details.alternativeTitles) ? details.alternativeTitles : [])
    .filter(Boolean);

  // Search the canonical title first because it usually returns the season
  // variants in one response. Only keep a few targeted fallbacks.
  titles.slice(0, 2).forEach(add);

  if (mediaType === "tv" && Number(season || 1) > 1 && titles[0]) {
    add(titles[0] + " Season " + Number(season));
    add(titles[0] + " S" + String(Number(season)).padStart(2, "0"));
  }

  return queries.slice(0, 4);
}

function parseSearchPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.result)) return payload.result;
  return [];
}

function search(query) {
  var url = BASE + "/vod/search?page=1&keyword=" + encodeURIComponent(query);
  return getDecryptedJson(url).then(parseSearchPayload);
}

function collectCandidates(queries) {
  var map = {};
  var chain = Promise.resolve();

  queries.forEach(function (query) {
    chain = chain.then(function () {
      return search(query).then(function (items) {
        (items || []).forEach(function (item) {
          var id = item && item.id != null ? String(item.id) : "";
          if (id) map[id] = item;
        });
      }).catch(function (error) {
        console.log("[OneTouchTV] search failed query='" + query + "' error=" + error.message);
      });
    });
  });

  return chain.then(function () {
    return Object.keys(map).map(function (id) { return map[id]; });
  });
}

function targetTitles(details, mediaType, season) {
  var set = {};

  function add(value) {
    var n = normalizeTitle(value);
    if (n) set[n] = true;
  }

  var titles = [details.title, details.originalTitle]
    .concat(Array.isArray(details.alternativeTitles) ? details.alternativeTitles : [])
    .filter(Boolean);

  titles.forEach(add);

  if (mediaType === "tv" && Number(season || 1) > 1) {
    titles.forEach(function (title) {
      seasonTitleVariants(title, season).forEach(add);
    });
  }

  return set;
}

function titleMatchesTargets(value, targets) {
  var exact = normalizeTitle(value);
  if (exact && targets[exact]) return true;

  var withoutYear = stripTrailingYear(value);
  return !!(withoutYear && targets[withoutYear]);
}

function itemTitleSet(item) {
  var set = {};
  function add(value) {
    var n = normalizeTitle(value);
    if (n) set[n] = true;
  }

  add(item && item.title);
  (Array.isArray(item && item.otherTitles) ? item.otherTitles : []).forEach(add);
  return set;
}

function mediaTypeCompatible(value, mediaType) {
  var type = String(value || "").trim().toLowerCase();
  if (!type) return true;
  var isMovie = type === "movie" || type === "film";
  if (mediaType === "movie") return isMovie;
  return !isMovie;
}

function candidateScore(item, details, mediaType, season) {
  if (!item || !mediaTypeCompatible(item.type, mediaType)) return null;

  var targets = targetTitles(details, mediaType, season);
  var values = [item.title]
    .concat(Array.isArray(item.otherTitles) ? item.otherTitles : [])
    .filter(Boolean);

  var matched = values.some(function (value) {
    return titleMatchesTargets(value, targets);
  });

  if (!matched) return null;

  var targetYear = Number(String(details.year || "").slice(0, 4));
  var itemYear = Number(String(item.year || "").slice(0, 4));
  var seasonNumber = Number(season || 1);

  // TMDB TV year is the show's first-air year. Do not reject later seasons
  // because their upstream item can use the season's actual release year.
  if (
    (mediaType === "movie" || seasonNumber <= 1) &&
    targetYear &&
    itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  var score = 100;
  var normalizedMain = stripTrailingYear(item.title);

  if (normalizedMain === normalizeTitle(details.title)) score += 30;
  if (normalizedMain === normalizeTitle(details.originalTitle)) score += 20;

  if (mediaType === "tv" && seasonNumber > 1) {
    var seasonVariants = seasonTitleVariants(details.title, seasonNumber)
      .map(normalizeTitle);

    if (seasonVariants.indexOf(normalizedMain) !== -1) {
      score += 100;
    }

    // Prefer a later-year entry for later seasons, but never require it.
    if (targetYear && itemYear && itemYear > targetYear) score += 20;
  } else if (targetYear && itemYear) {
    score += targetYear === itemYear ? 50 : 20;
  }

  return score;
}

function fetchDetail(id) {
  return getDecryptedJson(BASE + "/vod/" + encodeURIComponent(id) + "/detail");
}

function detailScore(detail, item, details, mediaType, season) {
  var baseScore = candidateScore(item, details, mediaType, season);
  if (baseScore === null || !detail) return null;
  if (!mediaTypeCompatible(detail.type, mediaType)) return null;

  var targets = targetTitles(details, mediaType, season);
  var detailTitle = String(detail.title || "");

  if (detailTitle && !titleMatchesTargets(detailTitle, targets)) {
    var itemTitles = itemTitleSet(item);
    var normalizedDetail = normalizeTitle(detailTitle);
    var strippedDetail = stripTrailingYear(detailTitle);

    if (!itemTitles[normalizedDetail] && !itemTitles[strippedDetail]) {
      return null;
    }
  }

  var targetYear = Number(String(details.year || "").slice(0, 4));
  var resultYear = Number(String(detail.year || "").slice(0, 4));
  var seasonNumber = Number(season || 1);

  if (
    (mediaType === "movie" || seasonNumber <= 1) &&
    targetYear &&
    resultYear &&
    Math.abs(targetYear - resultYear) > 1
  ) {
    return null;
  }

  var score = baseScore;
  var strippedTitle = stripTrailingYear(detailTitle);

  if (strippedTitle === normalizeTitle(details.title)) score += 30;

  if (mediaType === "tv" && seasonNumber > 1) {
    var seasonVariants = seasonTitleVariants(details.title, seasonNumber)
      .map(normalizeTitle);

    if (seasonVariants.indexOf(strippedTitle) !== -1) score += 100;
    if (targetYear && resultYear && resultYear > targetYear) score += 20;
  } else if (targetYear && resultYear) {
    score += targetYear === resultYear ? 40 : 15;
  }

  return score;
}

function chooseBest(candidates, details, mediaType, season) {
  var ranked = (candidates || []).map(function (item) {
    return { item: item, score: candidateScore(item, details, mediaType, season) };
  }).filter(function (x) {
    return typeof x.score === "number";
  }).sort(function (a, b) {
    return b.score - a.score;
  }).slice(0, 8);

  if (!ranked.length) {
    var sample = (candidates || []).slice(0, 10).map(function (item) {
      return String(item && item.title || "?") +
        (item && item.year ? " (" + item.year + ")" : "") +
        (item && item.type ? " [" + item.type + "]" : "");
    }).join(" | ");

    console.log(
      "[OneTouchTV] no ranked match" +
      (sample ? " candidates=" + sample : "")
    );
    return Promise.resolve(null);
  }

  return Promise.all(ranked.map(function (entry) {
    return fetchDetail(entry.item.id).then(function (detail) {
      return {
        item: entry.item,
        detail: detail,
        score: detailScore(detail, entry.item, details, mediaType, season)
      };
    }).catch(function () {
      return null;
    });
  })).then(function (items) {
    var valid = items.filter(function (x) {
      return x && typeof x.score === "number";
    }).sort(function (a, b) {
      return b.score - a.score;
    });
    return valid.length ? valid[0] : null;
  });
}

function findPlayableEpisode(detail, mediaType, episode) {
  var episodes = Array.isArray(detail && detail.episodes) ? detail.episodes : [];
  var playable = episodes.filter(function (item) {
    return item && String(item.identifier || "").trim() && String(item.playId || "").trim();
  });

  if (mediaType === "movie") return playable.length ? playable[0] : null;

  var target = Number(episode || 1);
  var exact = playable.find(function (item) {
    var value = Number(item.episode);
    return Number.isFinite(value) && value === target;
  });
  return exact || null;
}

function parseStreams(payload) {
  var root = payload && payload.result && typeof payload.result === "object" ? payload.result : payload;
  var sources = root && Array.isArray(root.sources) ? root.sources : [];

  var seen = {};
  return sources.map(function (source) {
    var url = String(source && source.url || "").trim();
    if (!url) return null;

    var headerObj = source && source.headers && typeof source.headers === "object"
      ? source.headers
      : {};
    var headerKey = Object.keys(headerObj).sort().map(function (key) {
      return key + ":" + String(headerObj[key]);
    }).join("|");
    var dedupe = url + "|" + headerKey;
    if (seen[dedupe]) return null;
    seen[dedupe] = true;

    var quality = String(source.quality || "").trim() || inferQuality(source.name || url);
    var label = String(source.name || "Source").trim();

    return {
      name: PROVIDER,
      title: label + (quality && label.toLowerCase().indexOf(quality.toLowerCase()) === -1 ? " • " + quality : ""),
      url: url,
      quality: quality || "Auto",
      headers: headerObj,
      provider: PROVIDER,
      type: inferType(url)
    };
  }).filter(Boolean);
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "movie" ? "movie" : "tv";
  console.log(
    "[OneTouchTV] TMDB=" + tmdbId +
    " type=" + mediaType +
    (mediaType === "tv" ? " S" + Number(season || 1) + "E" + Number(episode || 1) : "")
  );

  var details;
  var match;

  return fetchTmdbDetails(tmdbId, mediaType)
    .then(function (value) {
      details = value;
      if (!details || !details.title) throw new Error("TMDB metadata unavailable");
      var queries = buildQueries(details, mediaType, season);
      return collectCandidates(queries);
    })
    .then(function (candidates) {
      return chooseBest(candidates, details, mediaType, season);
    })
    .then(function (value) {
      match = value;
      if (!match || !match.detail) {
        throw new Error("No matching title found");
      }

      console.log(
        "[OneTouchTV] matched id=" + match.item.id +
        " title='" + String(match.detail.title || match.item.title || "") +
        "' year=" + String(match.detail.year || match.item.year || "")
      );

      var selected = findPlayableEpisode(match.detail, mediaType, episode);
      if (!selected) throw new Error("Episode/stream entry not found");

      var streamUrl = BASE + "/vod/" + encodeURIComponent(selected.identifier) +
        "/episode/" + encodeURIComponent(selected.playId);
      return getDecryptedJson(streamUrl);
    })
    .then(function (payload) {
      var streams = parseStreams(payload);
      console.log("[OneTouchTV] v1.0.4 playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[OneTouchTV] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };

/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */
  })(transferredModule, transferredModule.exports, metadataFetch);
  return transferredModule.exports;
})();
function cloudbankTestPluginAttempt(provider, args, ms) {
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function() { finish([]); }, ms);
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Array.isArray(value) ? value.filter(function(item) {
        return item && typeof item.url === "string" && /^https?:\/\//i.test(item.url);
      }) : []);
    }
    Promise.resolve().then(function() {
      return provider.getStreams.apply(provider, args);
    }).then(finish, function() { finish([]); });
  });
}
module.exports = Object.assign({}, cloudbankLegacyProvider, {
  getStreams: function(id, type, season, episode) {
    type = type === "series" ? "tv" : type;
    if (!String(id || "").trim() || (type !== "movie" && type !== "tv")) return Promise.resolve([]);
    if (type === "tv" && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    var args = [String(id), type, season, episode];
    return cloudbankTestPluginAttempt(cloudbankTestPluginProvider, args, 11000).then(function(streams) {
      if (streams.length) return streams;
      try { if (typeof globalThis.vueoTrace === "function") globalThis.vueoTrace("RESOLVER_FALLBACK", { source: "Cloudbank existing engine" }); } catch (_) {}
      return cloudbankTestPluginAttempt(cloudbankLegacyProvider, args, 7500);
    });
  }
});
/* CLOUDBANK_TEST_PLUGIN_ADAPTATION_END */

/* CLOUDBANK_PLAYIMDB_DISPLAY_START */
/* CLOUDBANK_PLAYIMDB_DISPLAY_V1
 * Embedded in each provider: the app downloads standalone JavaScript files.
 * Presentation only. No network requests and no changes to playback fields.
 */
function cloudbankDisplayInstall(provider, providerName, providerId) {
  if (providerId === "playimdb") return provider; // Reference output stays exactly upstream.
  var details = Object.create(null);
  var keys = [];
  function remember(key, value) {
    if (!details[key]) keys.push(key);
    details[key] = value;
    while (keys.length > 16) delete details[keys.shift()];
  }
  if (typeof vueoSharedTmdb === "function") {
    var shared = vueoSharedTmdb;
    vueoSharedTmdb = function(url, fallback) {
      var match = /\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(String(url));
      return Promise.resolve(shared(url, fallback)).then(function(value) {
        if (match && value && typeof value === "object") remember(match[1] + "/" + match[2], value);
        return value;
      });
    };
  }
  function clean(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F\u200D]/g, "").replace(/\s+/g, " ").trim();
  }
  function usable(value) {
    var text = clean(value);
    return /^(?:unknown(?: title)?|n\/?a|none|null|undefined|auto|stream|original[- ]audio)$/i.test(text) ? "" : text;
  }
  function unique(list) {
    return list.filter(function(value, index) { return value && list.indexOf(value) === index; });
  }
  var languages = { en: "English", eng: "English", english: "English", ms: "Malay", msa: "Malay", may: "Malay", malay: "Malay", id: "Indonesian", ind: "Indonesian", indo: "Indonesian", indonesian: "Indonesian", hi: "Hindi", hin: "Hindi", hindi: "Hindi", ta: "Tamil", tam: "Tamil", tamil: "Tamil", te: "Telugu", tel: "Telugu", telugu: "Telugu", ja: "Japanese", jpn: "Japanese", japanese: "Japanese", ko: "Korean", kor: "Korean", korean: "Korean", zh: "Chinese", zho: "Chinese", chi: "Chinese", chinese: "Chinese", es: "Spanish", spa: "Spanish", spanish: "Spanish", fr: "French", fra: "French", fre: "French", french: "French", de: "German", deu: "German", ger: "German", german: "German", ar: "Arabic", ara: "Arabic", arabic: "Arabic", pt: "Portuguese", por: "Portuguese", portuguese: "Portuguese", ru: "Russian", rus: "Russian", russian: "Russian", it: "Italian", ita: "Italian", italian: "Italian", th: "Thai", tha: "Thai", thai: "Thai", vi: "Vietnamese", vie: "Vietnamese", vietnamese: "Vietnamese", ml: "Malayalam", mal: "Malayalam", malayalam: "Malayalam", bn: "Bengali", ben: "Bengali", bengali: "Bengali", tr: "Turkish", tur: "Turkish", turkish: "Turkish" };
  function language(value) {
    var text = clean(value).toLowerCase().replace(/[-_](?:us|gb|my|id|cn|tw|br|pt)$/, "");
    return languages[text] || "";
  }
  function metadata(id, type) {
    if (details[type + "/" + id]) return details[type + "/" + id];
    var raw = typeof globalThis !== "undefined" ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
    if (!raw || typeof raw !== "object") return {};
    var tmdb = raw.tmdb || raw;
    var contextId = raw.tmdbId || tmdb.id;
    if (String(contextId) !== String(id) || (raw.mediaType && raw.mediaType !== type)) return {};
    return tmdb;
  }
  function format(stream, index, meta, type, season, episode) {
    if (!stream || typeof stream !== "object" || !stream.url) return stream;
    var output = Object.assign({}, stream);
    var originalTitle = typeof stream.title === "string" ? stream.title : "";
    var displayTitle = usable(meta.title || meta.name);
    var year = /\b(?:19|20)\d{2}\b/.exec(clean(meta.release_date || meta.first_air_date || meta.year));
    var lines = [];
    if (displayTitle) {
      if (year) displayTitle += " (" + year[0] + ")";
      if (type === "tv" && Number.isInteger(Number(season)) && Number(season) >= 0 && Number(episode) >= 1) {
        displayTitle += " · S" + (Number(season) < 10 ? "0" : "") + Number(season) + "E" + (Number(episode) < 10 ? "0" : "") + Number(episode);
      }
      lines.push(displayTitle);
    } else {
      // Keep a source-provided content title when it is recognisable as one.
      var first = clean(originalTitle.split(/\r?\n/)[0]);
      var providerLabel = clean(providerName.replace(/\s+V\d+$/i, ""));
      var isProviderTitle = providerLabel && first.toLowerCase().indexOf(providerLabel.toLowerCase()) === 0;
      var isTechnicalTitle = /^(?:\d{3,4}p|4k|Server\s+\d+|Unknown|Subtitles:|WEB[- ]DL|BluRay|HLS|M3U8|MP4|DASH)\b/i.test(first);
      if (first && /[A-Za-z\u0080-\uFFFF]/.test(first) && !isProviderTitle && !isTechnicalTitle) lines.push(first);
    }
    var text = [stream.name, originalTitle, stream.fileName, stream.filename, stream.videoCodec, stream.codec, stream.audioCodec, stream.audioChannels, stream.releaseSource, stream.sourceQuality, stream.hdr].map(clean).join(" ");
    // Film titles containing words such as English or BluRay are not technical metadata.
    var contentTitle = clean(meta.title || meta.name) || (lines.length ? lines[0] : "");
    if (contentTitle) text = text.split(contentTitle).join("");
    var quality = usable(stream.quality);
    var resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p?\b/i.exec(quality);
    if (!resolution) resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p\b/i.exec(text);
    var qualityLabel = resolution ? (resolution[1] === "2160" ? "4K" : resolution[1] + "p") : (/\b4k\b/i.test(quality + " " + text) ? "4K" : "");
    var audioLang = language(stream.audioLanguage || stream.language || stream.lang);
    var audioLanguages = Array.isArray(stream.audioLanguages) ? unique(stream.audioLanguages.map(language)) : [];
    if (!audioLang && audioLanguages.length === 1) audioLang = audioLanguages[0];
    var explicitAudio = /\b(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese|Spanish|French|Arabic)[ -]Audio\b/i.exec(text);
    if (!audioLang && explicitAudio) audioLang = language(explicitAudio[1]);
    var labelledAudio = /🌍\s*([^|\n]+)/.exec(originalTitle);
    if (!audioLang && labelledAudio) audioLang = language(labelledAudio[1]);
    var filenameAudio = /(?:^|[._ -])(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese)(?=[._ -]|$)/i.exec(clean(stream.fileName || stream.filename));
    if (!audioLang && filenameAudio) audioLang = language(filenameAudio[1]);
    // MovieBlast exposes its language as a trailing parenthesised code.
    var parenthesised = /\(([A-Za-z]{2,3})\)\s*$/.exec(clean(originalTitle));
    if (!audioLang && parenthesised) audioLang = language(parenthesised[1]);
    var audioLabel = audioLang ? audioLang + " Audio" : "";
    if (audioLanguages.length > 1) audioLabel = "Multi Audio (" + audioLanguages.join(", ") + ")";
    if (/^original$/i.test(clean(stream.audioLanguage)) || /\boriginal[- ]audio\b/i.test(text)) audioLabel = "Original Audio";
    if (/\bdual[- ]audio\b/i.test(text)) audioLabel = "Dual Audio" + (audioLang ? " (" + audioLang + ")" : "");
    else if (/\b(?:multi[- ]audio|multilingual)\b/i.test(text)) audioLabel = "Multi Audio" + (audioLang ? " (" + audioLang + ")" : "");
    var server = usable(stream.serverName || stream.server || stream.sourceName);
    var labelledServer = /📌\s*([^|\n]+)/.exec(originalTitle);
    if (!server && labelledServer) server = usable(labelledServer[1]);
    if (!server) {
      server = clean(stream.name);
      [providerName, providerName.replace(/\s+V\d+$/i, ""), providerId, providerId.replace(/-v\d+$/, "")].forEach(function(label) {
        label = clean(label);
        if (!label) return;
        if (server.toLowerCase().indexOf(label.toLowerCase()) === 0) server = server.slice(label.length).trim();
      });
      if (!server) {
        var titleServer = clean(originalTitle);
        var baseLabel = clean(providerName.replace(/\s+V\d+$/i, ""));
        if (baseLabel && titleServer.toLowerCase().indexOf(baseLabel.toLowerCase() + " - ") === 0) {
          server = titleServer.slice(baseLabel.length + 3).replace(/\([A-Za-z]{2,3}\)\s*$/, "").trim();
        }
      }
      server = server.replace(/\b\d{3,4}p\b|\b(?:4k|FHD|UHD|Auto)\b/gi, "")
        .replace(/\((?:English|Hindi|Tamil|Telugu|Malay|Indonesian|EN|HI|TA|TE|MS|ID)\)/gi, "").trim();
      // Keep descriptive host names; omit names consisting of quality/audio labels.
      if (/\b(?:\d{3,4}p|4k|audio|FHD|UHD|HLS|M3U8|MP4|BluRay|WEB-DL)\b/i.test(server)) {
        var numbered = /\bServer\s+\d+\b/i.exec(server);
        server = numbered ? numbered[0] : "";
      }
      server = usable(server.replace(/^[|·: -]+|[|·: -]+$/g, ""));
      if (server.length > 80) server = "";
    }
    if (!server) server = "Server " + (index + 1);
    var path = String(stream.url).split(/[?#]/)[0];
    var formatLabel = /\.m3u8$/i.test(path) ? "HLS" : /\.mp4$/i.test(path) ? "MP4" : /\.mkv$/i.test(path) ? "MKV" : /\.mpd$/i.test(path) ? "DASH" : "";
    if (!formatLabel) {
      var declared = clean(stream.format || stream.mimeType || stream.type);
      if (/^(?:hls|m3u8|application\/(?:vnd\.apple\.mpegurl|x-mpegurl))$/i.test(declared)) formatLabel = "HLS";
      else if (/^(?:mp4|video\/mp4)$/i.test(declared)) formatLabel = "MP4";
      else if (/^(?:dash|application\/dash\+xml)$/i.test(declared)) formatLabel = "DASH";
    }
    var minutes = Number(stream.runtimeMinutes || (type === "movie" ? meta.runtime : 0));
    var duration = minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) + " min" : "";
    if (!duration) { var dm = /\b(\d+)\s*min(?:utes)?\b/i.exec(clean(stream.duration) + " " + text); if (dm && Number(dm[1]) > 0) duration = dm[1] + " min"; }
    var firstLine = lines.length ? "🎬 " + lines[0] : "";
    // Match PlayIMDb's original typography and order, without its guessed defaults.
    if (displayTitle) {
      firstLine = type === "tv" ? "🎬 " + usable(meta.title || meta.name) + " - S" + Number(season) + "E" + Number(episode) + (year ? " (" + year[0] + ")" : "") :
        "🎬 " + usable(meta.title || meta.name) + (year ? " - " + year[0] : "");
    }
    var qualityDisplay = qualityLabel === "4K" ? "2160P" : qualityLabel.toUpperCase();
    var audioDisplay = audioLabel.replace(/[- ]Audio/g, "").trim();
    var infoLine = [qualityDisplay ? "💎 " + qualityDisplay : "", audioDisplay ? "🌍 " + audioDisplay : ""].filter(Boolean).join(" | ");
    var bottomLine = [formatLabel ? "🎞️ " + (formatLabel === "HLS" ? "M3U8" : formatLabel) : "", duration ? "⏱️ " + duration : "", "📌 " + server].filter(Boolean).join(" | ");
    var nameQuality = qualityLabel === "4K" ? "4K UHD" : qualityLabel === "1080p" ? "1080p FHD" : qualityLabel === "720p" ? "720p HD" : qualityLabel;
    output.name = ["🟡 " + providerName, nameQuality, audioLabel ? audioLabel.replace(/ Audio/g, "-Audio") : ""].filter(Boolean).join(" | ");
    output.title = [firstLine, infoLine, bottomLine].filter(Boolean).join("\n");
    return output;
  }
  var original = provider.getStreams;
  var adapted = Object.assign({}, provider);
  adapted.getStreams = function(id, type, season, episode) {
    var args = arguments;
    var mediaType = type === "series" ? "tv" : type;
    return Promise.resolve().then(function() { return original.apply(provider, args); }).then(function(streams) {
      if (!Array.isArray(streams)) return streams;
      var meta = metadata(id, mediaType);
      return streams.map(function(stream, index) {
        try { return format(stream, index, meta, mediaType, season, episode); } catch (_) { return stream; }
      });
    });
  };
  return adapted;
}
module.exports = cloudbankDisplayInstall(module.exports, "OneTouchTV", "onetouchtv");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
