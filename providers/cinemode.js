"use strict";

var PROVIDER_NAME = "CineMode";
var BASE_URL = "https://cinemode.fun";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var MATCH_PARTS = [
  ".m3u8",
  ".mp4",
  ".m4v",
  "/sora/"
];

var BLOCKED_PARTS = [
  "googletagmanager",
  "doubleclick",
  "googlesyndication",
  "/ads/",
  "/vast"
];

var PROVIDER_BUDGET_MS = 18800;
var PRIMARY_WEBVIEW_MS = 11800;
var ALIAS_WEBVIEW_MS = 6200;

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

function withSoftTimeout(
  promise,
  timeoutMs,
  label
) {
  return new Promise(function(resolve, reject) {
    var settled = false;

    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;

      reject(
        new Error(
          (label || "Operation") +
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

function fetchJson(
  url,
  timeoutMs
) {
  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT
      },
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
    timeoutMs || 1600,
    "CineMode metadata"
  );
}

function getTmdbInfo(
  tmdbId,
  mediaType
) {
  var endpoint =
    mediaType === "tv"
      ? "tv"
      : "movie";

  var url =
    "https://api.themoviedb.org/3/" +
    endpoint +
    "/" +
    encodeURIComponent(tmdbId) +
    "?api_key=" +
    TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  return vueoSharedTmdb(
    url,
    function() {
      return fetchJson(
        url,
        1600
      );
    }
  ).then(function(data) {
    return {
      title:
        String(
          data &&
          (
            data.title ||
            data.name
          ) ||
          ""
        ).trim(),

      originalTitle:
        String(
          data &&
          (
            data.original_title ||
            data.original_name
          ) ||
          ""
        ).trim(),

      year:
        String(
          data &&
          (
            data.release_date ||
            data.first_air_date
          ) ||
          ""
        )
          .split("-")[0],
      aliases:
        collectTmdbAliasesCine(data)
    };
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliasesCine(data) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);

    if (!text || !key || seen[key]) {
      return;
    }

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var alt = data && data.alternative_titles;
  var altItems =
    alt && Array.isArray(alt.titles)
      ? alt.titles
      : alt && Array.isArray(alt.results)
        ? alt.results
        : [];

  altItems.forEach(function(item) {
    add(
      item && (item.title || item.name),
      82
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(data.translations.translations)
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    add(
      item &&
      item.data &&
      (
        item.data.title ||
        item.data.name
      ),
      item && item.iso_639_1 === "en" ? 88 : 68
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 10);
}

function inferQuality(
  url,
  label
) {
  var value =
    (
      String(label || "") +
      " " +
      String(url || "")
    ).toLowerCase();

  if (
    value.indexOf("2160") !== -1 ||
    value.indexOf("4k") !== -1
  ) return "2160p";

  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";

  return "Auto";
}

function isDirectPlayable(url) {
  var value =
    String(url || "")
      .toLowerCase();

  return (
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1
  );
}

function isIntermediate(url) {
  return (
    String(url || "")
      .toLowerCase()
      .indexOf("/sora/") !== -1
  );
}

function sanitiseHeaders(
  input,
  fallbackReferer
) {
  var output = {};

  var source =
    input &&
    typeof input === "object"
      ? input
      : {};

  Object.keys(source)
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

      output[key] =
        String(source[key]);
    });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  var capturedReferer =
    output["Referer"] ||
    output["referer"] ||
    "";

  delete output["referer"];

  /*
   * Do not overwrite a player/CDN Referer captured by the native bridge.
   * Some CineMode servers reject BASE_URL as Referer.
   */
  output["Referer"] =
    capturedReferer ||
    fallbackReferer ||
    BASE_URL + "/";

  return output;
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function episodeInteractions(
  mediaType,
  season,
  episode
) {
  if (mediaType !== "tv") {
    return [];
  }

  var s =
    Math.max(
      1,
      Number(season || 1)
    );

  var e =
    Math.max(
      1,
      Number(episode || 1)
    );

  var s2 =
    String(s).padStart(2, "0");

  var e2 =
    String(e).padStart(2, "0");

  return [
    "season " + s,
    "season " + s2,
    "s" + s,
    "s" + s2,
    "episode " + e,
    "episode " + e2,
    "ep " + e,
    "ep" + e,
    "e" + e,
    "e" + e2
  ];
}

function buildInteractionTexts(
  searchTitle,
  info,
  mediaType,
  season,
  episode
) {
  var output = [];
  var seen = {};

  function add(value) {
    var text =
      String(value || "")
        .trim();

    var key =
      text.toLowerCase();

    if (
      !text ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  }

  /*
   * Search result selection first.
   */
  add(searchTitle);
  add(info.title);
  add(info.originalTitle);

  /*
   * Then TV season/episode controls, before generic Watch/Play buttons.
   * This prevents opening episode 1 when Nuvio requested another episode.
   */
  episodeInteractions(
    mediaType,
    season,
    episode
  ).forEach(add);

  [
    "watch now",
    "start watching",
    "watch",
    "play now",
    "play",
    "continue",
    "server",
    "change server",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ].forEach(add);

  return output;
}

function runUiSearch(
  searchTitle,
  info,
  mediaType,
  season,
  episode,
  timeoutMs
) {
  var interactions =
    buildInteractionTexts(
      searchTitle,
      info,
      mediaType,
      season,
      episode
    );

  console.log(
    "[CineMode] UI search title=" +
    searchTitle +
    (
      mediaType === "tv"
        ? " S" +
          season +
          "E" +
          episode
        : ""
    )
  );

  return globalThis.webviewResolve(
    BASE_URL + "/",
    {
      referer:
        BASE_URL + "/",

      directLoad: true,

      searchText:
        searchTitle,

      timeoutMs:
        timeoutMs,

      finishAfterFirstMs: 850,

      suppressPopups: true,

      /*
       * Keep ads/popups from hijacking the main PWA. External player/CDN
       * requests are still visible to the native capture hook.
       */
      lockMainFrameHost: true,

      interactionTexts:
        interactions,

      viewportWidth: 1080,
      viewportHeight: 1080,

      /*
       * Centre clicks are only a secondary assist for players whose controls
       * have no useful text. Text interactions remain the primary path.
       */
      clickX: 540,
      clickY: 540,

      clickDelaysMs: [
        650,
        1300,
        2200,
        3300,
        4700,
        6300,
        8200,
        10400
      ].filter(function(delay) {
        return delay < timeoutMs;
      }),

      match:
        MATCH_PARTS,

      blocked:
        BLOCKED_PARTS,

      injectAbyssHook: true
    }
  )
    .then(function(result) {
      return (
        result &&
        Array.isArray(result.streams)
          ? result.streams
          : []
      );
    })
    .catch(function(error) {
      console.log(
        "[CineMode] UI attempt failed title=" +
        searchTitle +
        " error=" +
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

function buildStreams(
  captured,
  info,
  mediaType,
  season,
  episode
) {
  var direct = [];
  var intermediate = [];
  var seen = {};

  (captured || [])
    .forEach(function(item) {
      if (
        !item ||
        !item.url
      ) {
        return;
      }

      var url =
        String(item.url)
          .trim();

      if (
        !url ||
        seen[url]
      ) {
        return;
      }

      if (
        !isDirectPlayable(url) &&
        !isIntermediate(url)
      ) {
        return;
      }

      seen[url] = true;

      var entry = {
        item: item,
        url: url
      };

      if (isDirectPlayable(url)) {
        direct.push(entry);
      } else {
        intermediate.push(entry);
      }
    });

  /*
   * /sora/ is an intermediate capture on some servers. Only expose it when
   * no direct HLS/MP4/M4V request was captured.
   */
  var selected =
    direct.length
      ? direct
      : intermediate;

  var suffix =
    mediaType === "tv"
      ? " S" +
        String(season).padStart(2, "0") +
        "E" +
        String(episode).padStart(2, "0")
      : "";

  return selected
    .map(function(entry, index) {
      var item =
        entry.item;

      var fallbackReferer =
        String(
          item &&
          (
            item.referer ||
            item.referrer
          ) ||
          ""
        ).trim() ||
        BASE_URL + "/";

      return {
        name:
          PROVIDER_NAME +
          (
            selected.length > 1
              ? " " + (index + 1)
              : ""
          ),

        title:
          (info.title || PROVIDER_NAME) +
          suffix,

        url:
          entry.url,

        quality:
          inferQuality(
            entry.url,
            item && item.label
          ),

        type: "direct",

        headers:
          sanitiseHeaders(
            item && item.headers,
            fallbackReferer
          )
      };
    })
    .sort(function(a, b) {
      function score(stream) {
        var value =
          String(stream.quality || "");

        if (value === "2160p") return 2160;
        if (value === "1440p") return 1440;
        if (value === "1080p") return 1080;
        if (value === "720p") return 720;
        if (value === "480p") return 480;
        if (value === "360p") return 360;
        return 0;
      }

      return score(b) - score(a);
    });
}

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  var type =
    mediaType === "tv"
      ? "tv"
      : "movie";

  var id =
    String(tmdbId || "")
      .trim();

  var requestedSeason =
    Math.max(
      1,
      Number(season || 1)
    );

  var requestedEpisode =
    Math.max(
      1,
      Number(episode || 1)
    );

  if (!id) {
    console.error(
      "[CineMode] TMDB ID is missing"
    );

    return Promise.resolve([]);
  }

  if (!nativeAvailable()) {
    console.error(
      "[CineMode] Native webviewResolve() is unavailable"
    );

    return Promise.resolve([]);
  }

  var work =
    getTmdbInfo(
      id,
      type
    )
      .then(function(info) {
        if (!info.title) {
          throw new Error(
            "TMDB title is empty"
          );
        }

        vueoCandidateTrace("SEARCH", {
          title: info.title,
          aliases: Array.isArray(info.aliases) ? info.aliases.length : 0,
          mode: "webview"
        });

        return runUiSearch(
          info.title,
          info,
          type,
          requestedSeason,
          requestedEpisode,
          PRIMARY_WEBVIEW_MS
        )
          .then(function(primaryCaptured) {
            var primaryStreams =
              buildStreams(
                primaryCaptured,
                info,
                type,
                requestedSeason,
                requestedEpisode
              );

            if (primaryStreams.length) {
              return primaryStreams;
            }

            var fallbackTitle = "";

            (info.aliases || [])
              .some(function(alias) {
                var value =
                  String(alias || "")
                    .trim();

                if (
                  !value ||
                  normalizeTitle(value) ===
                    normalizeTitle(info.title)
                ) {
                  return false;
                }

                fallbackTitle = value;
                return true;
              });

            if (!fallbackTitle) {
              return [];
            }

            /*
             * Use the highest-priority TMDB alias only when the primary title
             * produced no media. One fallback keeps CineMode inside its 20s
             * runtime while covering alternate/localized title cases.
             */
            return runUiSearch(
              fallbackTitle,
              info,
              type,
              requestedSeason,
              requestedEpisode,
              ALIAS_WEBVIEW_MS
            ).then(function(aliasCaptured) {
              return buildStreams(
                aliasCaptured,
                info,
                type,
                requestedSeason,
                requestedEpisode
              );
            });
          });
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "CineMode provider"
  )
    .then(function(streams) {
      console.log(
        "[CineMode] streams=" +
        (
          Array.isArray(streams)
            ? streams.length
            : 0
        )
      );

      return (
        Array.isArray(streams)
          ? streams
          : []
      );
    })
    .catch(function(error) {
      console.error(
        "[CineMode] " +
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

module.exports = {
  getStreams: getStreams
};

/* CLOUDBANK_STREAM_DISPLAY_START */
/* CLOUDBANK_STREAM_DISPLAY_V1
 * Embedded in each provider: the app downloads standalone JavaScript files.
 * Presentation only. No network requests and no changes to playback fields.
 */
function cloudbankDisplayInstall(provider, providerName, providerId) {
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
    var contentTitle = clean(meta.title || meta.name);
    if (contentTitle) text = text.split(contentTitle).join("");
    var quality = usable(stream.quality);
    var resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p?\b/i.exec(quality);
    if (!resolution) resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p\b/i.exec(text);
    var qualityLabel = resolution ? (resolution[1] === "2160" ? "4K" : resolution[1] + "p") : (/\b4k\b/i.test(quality + " " + text) ? "4K" : "");
    var release = /\b(WEB[ ._-]?DL|WEB[ ._-]?RIP|BLU[ ._-]?RAY|BD[ ._-]?REMUX|REMUX|DVD[ ._-]?RIP|HD[ ._-]?RIP|HDTV|HDCAM|CAM)\b/i.exec(text);
    var releaseLabel = release ? release[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/^WEB-?DL$/.test(releaseLabel)) releaseLabel = "WEB-DL";
    if (/^WEB-?RIP$/.test(releaseLabel)) releaseLabel = "WEBRip";
    if (/^BLU-?RAY$/.test(releaseLabel)) releaseLabel = "BluRay";
    if (/REMUX/.test(releaseLabel)) releaseLabel = "Remux";
    var codec = /\b(HEVC|H[ ._-]?265|X265|AVC|H[ ._-]?264|X264|AV1)\b/i.exec(text);
    var codecLabel = codec ? (/265|HEVC/i.test(codec[1]) ? "HEVC" : /264|AVC/i.test(codec[1]) ? "H.264" : "AV1") : "";
    var hdr = /\b(DOLBY[ ._-]?VISION|HDR10\+|HDR10|HDR|SDR)(?!\w)/i.exec(text);
    var hdrLabel = hdr ? (/DOLBY/i.test(hdr[1]) ? "Dolby Vision" : hdr[1].toUpperCase()) : "";
    var videoLine = unique([qualityLabel, releaseLabel, codecLabel, hdrLabel]).join(" · ");
    if (videoLine) lines.push(videoLine);
    var audioLang = language(stream.audioLanguage || stream.language || stream.lang);
    var audioLanguages = Array.isArray(stream.audioLanguages) ? unique(stream.audioLanguages.map(language)) : [];
    if (!audioLang && audioLanguages.length === 1) audioLang = audioLanguages[0];
    var explicitAudio = /\b(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese|Spanish|French|Arabic)[ -]Audio\b/i.exec(text);
    if (!audioLang && explicitAudio) audioLang = language(explicitAudio[1]);
    // MovieBlast exposes its language as a trailing parenthesised code.
    var parenthesised = /\(([A-Za-z]{2,3})\)\s*$/.exec(clean(originalTitle));
    if (!audioLang && parenthesised) audioLang = language(parenthesised[1]);
    var audioLabel = audioLang ? audioLang + " Audio" : "";
    if (audioLanguages.length > 1) audioLabel = "Multi Audio (" + audioLanguages.join(", ") + ")";
    if (/^original$/i.test(clean(stream.audioLanguage))) audioLabel = "Original Audio";
    if (/\bdual[- ]audio\b/i.test(text)) audioLabel = "Dual Audio" + (audioLang ? " (" + audioLang + ")" : "");
    else if (/\b(?:multi[- ]audio|multilingual)\b/i.test(text)) audioLabel = "Multi Audio" + (audioLang ? " (" + audioLang + ")" : "");
    var audioCodec = /\b(DOLBY[ ._-]?ATMOS|ATMOS|TRUEHD|DTS[ ._-]?HD[ ._-]?MA|DTS[ ._-]?HD|DTS[ ._-]?X|DTS|E[ ._-]?AC[ ._-]?3|DDP|AC[ ._-]?3|AAC|FLAC|OPUS)\b/i.exec(text);
    var audioCodecLabel = audioCodec ? audioCodec[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/ATMOS/.test(audioCodecLabel)) audioCodecLabel = "Dolby Atmos";
    if (audioCodecLabel === "TRUEHD") audioCodecLabel = "Dolby TrueHD";
    if (/^(E-?AC-?3|DDP)$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital Plus";
    if (/^AC-?3$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital";
    var channels = /\b(7\.1|6\.1|5\.1|2\.0)\b/.exec(text);
    var audioLine = unique([audioLabel, [audioCodecLabel, channels ? channels[1] : ""].filter(Boolean).join(" ")]).join(" · ");
    if (audioLine) lines.push(audioLine);
    var subs = Array.isArray(stream.subtitles) ? unique(stream.subtitles.map(function(sub) {
      return sub && (language(sub.language) || language(sub.lang) || language(sub.code) || language(sub.id));
    })) : [];
    if (subs.length) lines.push("Subtitles: " + subs.join(", "));
    var server = usable(stream.serverName || stream.server || stream.sourceName);
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
    var size = usable(stream.size || stream.fileSize || (stream.behaviorHints && stream.behaviorHints.videoSize));
    if (!size) { var sm = /\b(\d+(?:\.\d+)?)\s*(GB|MB|TB|GiB|MiB)\b/i.exec(text); if (sm) size = sm[1] + " " + sm[2]; }
    if (/^\d+(?:\.\d+)?$/.test(size)) {
      var bytes = Number(size);
      size = bytes > 0 ? (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + " GB" : (bytes / 1048576).toFixed(1) + " MB") : "";
    } else if (!/^\d+(?:\.\d+)?\s*(?:GB|MB|TB|GiB|MiB)$/i.test(size)) size = "";
    var minutes = Number(stream.runtimeMinutes || (type === "movie" ? meta.runtime : 0));
    var duration = minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) + " min" : "";
    if (!duration) { var dm = /\b(\d+)\s*min(?:utes)?\b/i.exec(clean(stream.duration) + " " + text); if (dm && Number(dm[1]) > 0) duration = dm[1] + " min"; }
    lines.push(unique([formatLabel, server, size, duration]).join(" · "));
    output.name = "";
    output.title = lines.join("\n");
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
module.exports = cloudbankDisplayInstall(module.exports, "CineMode", "cinemode");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
