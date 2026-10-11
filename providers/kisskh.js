"use strict";

var PROVIDER_NAME = "KissKH";
var BASE_URL = "https://kisskh.id";
var KISSKH_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var VIDEO_KEY_API =
  "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

var SUBTITLE_KEY_API =
  "https://script.google.com/macros/s/AKfycbyq6hTj0ZhlinYC6xbggtgo166tp6XaDKBCGtnYk8uOfYBUFwwxBui0sGXiu_zIFmA/exec?id=";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": BASE_URL + "/"
};

var PROVIDER_BUDGET_MS = 17500;
var SOURCE_PIPELINE_MS = 9000;
var SUBTITLE_PIPELINE_MS = 8000;
var WEBVIEW_BUDGET_MS = 5200;

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

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;

    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          (label || "Request") +
          " timed out"
        )
      );
    }, timeoutMs);

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

function fetchResponse(
  url,
  options,
  timeoutMs,
  label
) {
  var opts = options || {};

  var headers =
    Object.assign(
      {},
      DEFAULT_HEADERS,
      opts.headers || {}
    );

  var request = {
    method: opts.method || "GET",
    headers: headers,
    redirect:
      opts.redirect || "follow"
  };

  if (opts.body !== undefined) {
    request.body = opts.body;
  }

  return withSoftTimeout(
    fetch(url, request).then(
      function(response) {
        if (!response.ok) {
          throw new Error(
            "HTTP " +
            response.status +
            " for " +
            url
          );
        }

        return response;
      }
    ),
    timeoutMs || 3500,
    label || "KissKH request"
  );
}

function fetchJson(
  url,
  headers,
  timeoutMs,
  label
) {
  return fetchResponse(
    url,
    {
      headers: headers || {}
    },
    timeoutMs,
    label
  ).then(function(response) {
    return response.json();
  });
}

function fetchText(
  url,
  headers,
  timeoutMs,
  label
) {
  return fetchResponse(
    url,
    {
      headers: headers || {}
    },
    timeoutMs,
    label
  ).then(function(response) {
    return response.text().then(
      function(text) {
        return {
          text: text,
          url: response.url || url
        };
      }
    );
  });
}

function collectSettled(tasks, timeoutMs) {
  var list =
    Array.isArray(tasks)
      ? tasks
      : [];

  if (!list.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var output = [];
    var pending = list.length;
    var done = false;

    var timer = setTimeout(
      finish,
      Math.max(1, Number(timeoutMs || 1))
    );

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(output);
    }

    list.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (
            !done &&
            value !== undefined &&
            value !== null
          ) {
            output.push(value);
          }
        })
        .catch(function() {})
        .then(function() {
          pending -= 1;
          if (pending <= 0) {
            finish();
          }
        });
    });
  });
}

function safeUrl(raw, base) {
  var value =
    String(raw || "")
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/");

  if (!value) return "";

  try {
    return new URL(
      value,
      base || BASE_URL + "/"
    ).toString();
  } catch (_) {
    return "";
  }
}

function normalizeTitle(value) {
  var text =
    String(value || "")
      .toLowerCase();

  try {
    if (typeof text.normalize === "function") {
      text =
        text.normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "");
    }
  } catch (_) {}

  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);

  if (!left || !right) return 0;
  if (left === right) return 100;

  if (
    left.indexOf(right) !== -1 ||
    right.indexOf(left) !== -1
  ) {
    return 82;
  }

  var leftWords =
    left.split(" ")
      .filter(function(word) {
        return word.length > 1;
      });

  var rightWords =
    right.split(" ")
      .filter(function(word) {
        return word.length > 1;
      });

  if (
    !leftWords.length ||
    !rightWords.length
  ) {
    return 0;
  }

  var set = {};
  leftWords.forEach(function(word) {
    set[word] = true;
  });

  var matched =
    rightWords.filter(function(word) {
      return set[word];
    }).length;

  if (!matched) return 0;

  return Math.round(
    (
      matched / rightWords.length * 0.75 +
      matched / leftWords.length * 0.25
    ) * 72
  );
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

function yearOf(item) {
  var raw =
    String(
      item &&
      (
        item.releaseDate ||
        item.release_date ||
        item.year ||
        item.firstAirDate ||
        item.first_air_date
      ) ||
      ""
    );

  var match =
    raw.match(/\b(19|20)\d{2}\b/);

  return match
    ? match[0]
    : "";
}

function sourceMediaType(item) {
  var value =
    String(
      item &&
      (
        item.type ||
        item.mediaType ||
        item.media_type
      ) ||
      ""
    )
      .trim()
      .toLowerCase();

  if (!value) return "";

  if (
    value.indexOf("movie") !== -1 ||
    value.indexOf("film") !== -1
  ) {
    return "movie";
  }

  if (
    value.indexOf("series") !== -1 ||
    value.indexOf("drama") !== -1 ||
    value.indexOf("anime") !== -1 ||
    value.indexOf("tv") !== -1
  ) {
    return "tv";
  }

  return "";
}

function explicitSeason(title) {
  var value =
    String(title || "");

  var match =
    value.match(
      /\b(?:season|series)\s*(\d{1,2})\b/i
    );

  if (!match) {
    match =
      value.match(
        /\bS(\d{1,2})\b/i
      );
  }

  return match
    ? Number(match[1]) || 0
    : 0;
}

function candidateScore(
  item,
  info,
  mediaType,
  season
) {
  var candidateTitle =
    item &&
    (
      item.title ||
      item.name
    );

  var score =
    bestAliasTitleScore(
      candidateTitle,
      info
    );

  var itemYear =
    yearOf(item);

  if (
    info.year &&
    itemYear
  ) {
    if (
      String(info.year) ===
      String(itemYear)
    ) {
      score += 25;
    } else {
      score -= 18;
    }
  }

  var detectedType =
    sourceMediaType(item);

  if (detectedType) {
    if (detectedType === mediaType) {
      score += 25;
    } else {
      score -= 90;
    }
  }

  if (mediaType === "tv") {
    var wantedSeason =
      Math.max(
        1,
        Number(season || 1)
      );

    var itemSeason =
      explicitSeason(candidateTitle);

    if (itemSeason) {
      if (itemSeason === wantedSeason) {
        score += 48;
      } else {
        score -= 65;
      }
    } else if (wantedSeason > 1) {
      score -= 6;
    }
  }

  return score;
}

function inferQuality(url, label) {
  var value =
    (
      String(label || "") +
      " " +
      String(url || "")
    ).toLowerCase();

  if (
    value.indexOf("2160") !== -1 ||
    value.indexOf("4k") !== -1
  ) {
    return "2160p";
  }

  if (value.indexOf("1440") !== -1) {
    return "1440p";
  }

  if (value.indexOf("1080") !== -1) {
    return "1080p";
  }

  if (value.indexOf("720") !== -1) {
    return "720p";
  }

  if (value.indexOf("480") !== -1) {
    return "480p";
  }

  if (value.indexOf("360") !== -1) {
    return "360p";
  }

  return "Auto";
}

function isDirectStream(url) {
  var value =
    String(url || "")
      .toLowerCase();

  return (
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1 ||
    value.indexOf("/sora/") !== -1
  );
}

function getTmdbInfo(
  tmdbId,
  mediaType
) {
  var endpoint =
    mediaType === "movie"
      ? "movie"
      : "tv";

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
        {},
        1800,
        "KissKH TMDB"
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
        ).split("-")[0],
      aliases:
        collectTmdbAliases(
          data,
          mediaType
        )
    };
  });
}

function searchKissKh(query) {
  var url =
    BASE_URL +
    "/api/DramaList/Search?q=" +
    encodeURIComponent(
      String(query || "").trim()
    ) +
    "&type=0";

  return fetchJson(
    url,
    {},
    2600,
    "KissKH search"
  ).then(function(data) {
    return Array.isArray(data)
      ? data
      : [];
  });
}

function getDramaDetail(id) {
  var url =
    BASE_URL +
    "/api/DramaList/Drama/" +
    encodeURIComponent(id) +
    "?isq=false";

  return fetchJson(
    url,
    {},
    3000,
    "KissKH detail"
  );
}

function buildSearchQueries(
  info,
  mediaType,
  season
) {
  var output = [];
  var seen = {};

  function add(value) {
    var text =
      String(value || "")
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
  }

  var aliases =
    buildAliasQueries(
      info,
      5
    );

  if (
    mediaType === "tv" &&
    Number(season || 1) > 1
  ) {
    aliases.slice(0, 3)
      .forEach(function(alias) {
        add(
          alias +
          " Season " +
          Number(season)
        );
      });
  }

  aliases.forEach(add);

  return output.slice(0, 7);
}
function findBestDrama(
  info,
  mediaType,
  season
) {
  var queries =
    buildSearchQueries(
      info,
      mediaType,
      season
    );

  return collectSettled(
    queries.map(function(query) {
      return searchKissKh(query).then(
        function(items) {
          return {
            query: query,
            items: items
          };
        }
      );
    }),
    3500
  ).then(function(groups) {
    var seen = {};
    var candidates = [];

    groups.forEach(
      function(group, queryIndex) {
        (group.items || [])
          .forEach(function(item, rank) {
            if (
              !item ||
              item.id === undefined ||
              item.id === null
            ) {
              return;
            }

            var key =
              String(item.id);

            if (seen[key]) {
              return;
            }

            seen[key] = true;

            candidates.push({
              item: item,
              score:
                candidateScore(
                  item,
                  info,
                  mediaType,
                  season
                ) +
                Math.max(
                  0,
                  10 - rank
                ) +
                Math.max(
                  0,
                  4 - queryIndex
                )
            });
          });
      }
    );

    candidates.sort(function(a, b) {
      return b.score - a.score;
    });

    vueoCandidateTrace("CANDIDATE", {
      count: candidates.length,
      title: candidates.length && candidates[0].item ? String(candidates[0].item.title || candidates[0].item.name || "") : "",
      score: candidates.length ? candidates[0].score : 0
    });

    candidates =
      candidates.slice(0, 4);

    if (!candidates.length) {
      throw new Error(
        "No KissKH title match"
      );
    }

    return collectSettled(
      candidates.map(function(candidate) {
        return getDramaDetail(
          candidate.item.id
        ).then(function(detail) {
          if (!detail) return null;

          var detailScore =
            candidateScore(
              detail,
              info,
              mediaType,
              season
            );

          return {
            detail: detail,
            score:
              Math.max(
                candidate.score,
                detailScore
              ) +
              Math.min(
                candidate.score,
                detailScore
              ) * 0.12
          };
        });
      }),
      3900
    );
  }).then(function(matches) {
    matches =
      matches
        .filter(Boolean)
        .sort(function(a, b) {
          return b.score - a.score;
        });

    if (
      !matches.length ||
      matches[0].score < 45
    ) {
      throw new Error(
        "KissKH match confidence too low"
      );
    }

    vueoCandidateTrace("VERIFIED", {
      title: String(matches[0].detail && (matches[0].detail.title || matches[0].detail.name) || ""),
      score: matches[0].score
    });

    return matches[0].detail;
  });
}

function selectEpisode(
  detail,
  mediaType,
  season,
  episode
) {
  var episodes =
    Array.isArray(
      detail &&
      detail.episodes
    )
      ? detail.episodes
      : [];

  if (!episodes.length) {
    throw new Error(
      "No KissKH episodes"
    );
  }

  if (
    mediaType === "movie" ||
    episodes.length === 1
  ) {
    return episodes[0];
  }

  var requestedEpisode =
    Math.max(
      1,
      Number(episode || 1)
    );

  var exact =
    episodes.find(function(item) {
      return (
        Number(
          item &&
          item.number
        ) === requestedEpisode
      );
    });

  if (exact) {
    return exact;
  }

  var numbered =
    episodes.filter(function(item) {
      return Number.isFinite(
        Number(
          item &&
          item.number
        )
      );
    });

  /*
   * Only use positional fallback when KissKH exposes no episode numbers at all.
   * If some numbers exist, guessing a missing episode is more dangerous than
   * returning no result.
   */
  if (
    !numbered.length &&
    episodes.length >= requestedEpisode
  ) {
    return episodes[
      requestedEpisode - 1
    ];
  }

  throw new Error(
    "Episode " +
    requestedEpisode +
    " not found on KissKH"
  );
}

function slugify(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function episodeNumberText(value) {
  var number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  return (
    number % 1 === 0
      ? String(Math.trunc(number))
      : String(number)
  );
}

function episodeReferer(
  detail,
  selected
) {
  var title =
    String(
      detail &&
      detail.title ||
      ""
    );

  var dramaId =
    detail &&
    detail.id;

  var episodeId =
    selected &&
    selected.id;

  var epNumber =
    episodeNumberText(
      selected &&
      selected.number
    );

  if (
    !title ||
    dramaId === undefined ||
    episodeId === undefined
  ) {
    return BASE_URL + "/";
  }

  return (
    BASE_URL +
    "/Drama/" +
    slugify(title) +
    "/Episode-" +
    (epNumber || "1") +
    "?id=" +
    encodeURIComponent(dramaId) +
    "&ep=" +
    encodeURIComponent(episodeId) +
    "&page=0&pageSize=100"
  );
}

function getKey(
  endpoint,
  episodeId,
  label
) {
  var url =
    endpoint +
    encodeURIComponent(episodeId) +
    "&version=" +
    encodeURIComponent(
      KISSKH_VERSION
    );

  return fetchJson(
    url,
    {},
    4500,
    label
  ).then(function(data) {
    var key =
      String(
        data &&
        data.key ||
        ""
      ).trim();

    if (!key) {
      throw new Error(
        "Empty " + label
      );
    }

    return key;
  });
}

function getSources(
  detail,
  selected,
  key
) {
  var episodeId =
    selected.id;

  var url =
    BASE_URL +
    "/api/DramaList/Episode/" +
    encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" +
    encodeURIComponent(key);

  return fetchJson(
    url,
    {
      "Origin": BASE_URL,
      "Referer":
        episodeReferer(
          detail,
          selected
        )
    },
    4800,
    "KissKH video API"
  );
}

function subtitleLanguage(label) {
  var value =
    String(label || "")
      .trim();

  var lower =
    value.toLowerCase()
      .replace(/_/g, "-");

  var aliases = {
    en: [
      "en",
      "eng",
      "english"
    ],
    ms: [
      "ms",
      "msa",
      "may",
      "malay",
      "bahasa melayu",
      "bahasa malaysia"
    ],
    id: [
      "id",
      "ind",
      "indonesian",
      "indonesia",
      "bahasa indonesia"
    ],
    ko: [
      "ko",
      "kor",
      "korean"
    ],
    zh: [
      "zh",
      "chi",
      "zho",
      "chinese",
      "mandarin"
    ],
    th: [
      "th",
      "tha",
      "thai"
    ],
    ja: [
      "ja",
      "jpn",
      "japanese"
    ],
    vi: [
      "vi",
      "vie",
      "vietnamese"
    ]
  };

  var labels = {
    en: "English",
    ms: "Malay",
    id: "Indonesian",
    ko: "Korean",
    zh: "Chinese",
    th: "Thai",
    ja: "Japanese",
    vi: "Vietnamese"
  };

  var codes =
    Object.keys(aliases);

  for (
    var i = 0;
    i < codes.length;
    i += 1
  ) {
    var code =
      codes[i];

    var match =
      aliases[code].some(
        function(alias) {
          return (
            lower === alias ||
            lower.indexOf(alias) !== -1
          );
        }
      );

    if (match) {
      return {
        code: code,
        label: labels[code]
      };
    }
  }

  return {
    code:
      lower || "und",
    label:
      value || "Unknown"
  };
}

function subtitleFormat(url) {
  var value =
    String(url || "")
      .toLowerCase()
      .split("?")[0];

  if (value.endsWith(".srt")) {
    return "srt";
  }

  if (
    value.endsWith(".vtt") ||
    value.endsWith(".webvtt")
  ) {
    return "vtt";
  }

  if (value.endsWith(".ass")) {
    return "ass";
  }

  if (value.endsWith(".ssa")) {
    return "ssa";
  }

  if (value.endsWith(".txt")) {
    return "srt";
  }

  return "";
}

function cryptoJsOrNull() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.CryptoJS
    ) {
      return globalThis.CryptoJS;
    }
  } catch (_) {}

  try {
    if (typeof require === "function") {
      var loaded =
        require("crypto-js");

      if (
        loaded &&
        loaded.AES
      ) {
        return loaded;
      }
    }
  } catch (_) {}

  return null;
}

function decryptSubtitleLine(
  encryptedB64
) {
  var CryptoJS =
    cryptoJsOrNull();

  if (!CryptoJS) {
    return "";
  }

  var pairs = [
    {
      key: "AmSmZVcH93UQUezi",
      iv:
        "5265424b5757386371646a50456e4636"
    },
    {
      key: "8056483646328763",
      iv:
        "36383532363132333730313835323733"
    }
  ];

  for (
    var i = 0;
    i < pairs.length;
    i += 1
  ) {
    try {
      var pair =
        pairs[i];

      var params =
        CryptoJS.lib.CipherParams.create({
          ciphertext:
            CryptoJS.enc.Base64.parse(
              String(encryptedB64 || "").trim()
            )
        });

      var decrypted =
        CryptoJS.AES.decrypt(
          params,
          CryptoJS.enc.Utf8.parse(
            pair.key
          ),
          {
            iv:
              CryptoJS.enc.Hex.parse(
                pair.iv
              ),
            mode:
              CryptoJS.mode.CBC,
            padding:
              CryptoJS.pad.Pkcs7
          }
        )
          .toString(
            CryptoJS.enc.Utf8
          )
          .trim();

      if (decrypted) {
        return decrypted;
      }
    } catch (_) {}
  }

  return "";
}

function decryptKissSubtitleText(text) {
  var source =
    String(text || "");

  /*
   * KissKH encrypted .txt subtitles are SRT-like blocks:
   * numeric cue index, timecode, then AES/Base64 text lines.
   */
  var chunks =
    source
      .split(/^\d+\s*$/gm)
      .map(function(chunk) {
        return chunk.trim();
      })
      .filter(Boolean);

  var output = [];

  chunks.forEach(
    function(chunk, index) {
      var parts =
        chunk.split(/\r?\n/);

      if (!parts.length) {
        return;
      }

      var timeCode =
        String(parts.shift() || "")
          .trim();

      if (
        timeCode.indexOf("-->") === -1
      ) {
        return;
      }

      var textLines =
        parts.map(function(line) {
          var value =
            String(line || "").trim();

          if (!value) {
            return "";
          }

          return (
            decryptSubtitleLine(value) ||
            ""
          );
        });

      var caption =
        textLines
          .join("\n")
          .trim();

      if (!caption) {
        return;
      }

      output.push(
        String(index + 1) +
        "\n" +
        timeCode +
        "\n" +
        caption
      );
    }
  );

  return output.join("\n\n");
}

function maybeDecryptSubtitle(
  subtitle
) {
  var url =
    String(
      subtitle &&
      subtitle.url ||
      ""
    );

  if (
    !url ||
    url.toLowerCase()
      .split("?")[0]
      .indexOf(".txt") === -1
  ) {
    return Promise.resolve(
      subtitle
    );
  }

  if (!cryptoJsOrNull()) {
    return Promise.resolve(
      subtitle
    );
  }

  return fetchText(
    url,
    {
      "Referer": BASE_URL + "/"
    },
    3200,
    "KissKH encrypted subtitle"
  ).then(function(result) {
    if (
      !result.text ||
      result.text.length > 350000
    ) {
      return subtitle;
    }

    var decrypted =
      decryptKissSubtitleText(
        result.text
      );

    if (!decrypted) {
      return subtitle;
    }

    var copy =
      Object.assign(
        {},
        subtitle
      );

    copy.url =
      "data:application/x-subrip;charset=utf-8," +
      encodeURIComponent(decrypted);

    copy.format = "srt";
    copy.sourceUrl = url;

    return copy;
  }).catch(function() {
    return subtitle;
  });
}

function getSubtitles(
  selected
) {
  var episodeId =
    selected.id;

  return getKey(
    SUBTITLE_KEY_API,
    episodeId,
    "KissKH subtitle key"
  )
    .then(function(key) {
      var url =
        BASE_URL +
        "/api/Sub/" +
        encodeURIComponent(episodeId) +
        "?kkey=" +
        encodeURIComponent(key);

      return fetchJson(
        url,
        {
          "Referer": BASE_URL + "/"
        },
        4600,
        "KissKH subtitle API"
      );
    })
    .then(function(data) {
      var list =
        Array.isArray(data)
          ? data
          : [];

      var seen = {};

      var subtitles =
        list.map(function(item) {
          var url =
            safeUrl(
              item &&
              (
                item.src ||
                item.url ||
                item.file
              ),
              BASE_URL + "/"
            );

          if (
            !url ||
            seen[url]
          ) {
            return null;
          }

          seen[url] = true;

          var lang =
            subtitleLanguage(
              item &&
              (
                item.label ||
                item.language ||
                item.lang
              )
            );

          return {
            label: lang.label,
            language: lang.label,
            lang: lang.code,
            url: url,
            default:
              Boolean(
                item &&
                (
                  item.default ||
                  item.isDefault
                )
              ),
            format:
              subtitleFormat(url)
          };
        })
        .filter(Boolean);

      return collectSettled(
        subtitles.map(
          maybeDecryptSubtitle
        ),
        3800
      );
    })
    .catch(function(error) {
      console.log(
        "[KissKH] subtitle pipeline failed: " +
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

function extractMediaFromText(
  text,
  pageUrl
) {
  var source =
    String(text || "")
      .replace(/\\\//g, "/");

  var output = [];
  var seen = {};

  function add(raw, label) {
    var url =
      safeUrl(
        raw,
        pageUrl
      );

    if (
      !url ||
      !isDirectStream(url) ||
      seen[url]
    ) {
      return;
    }

    seen[url] = true;

    output.push({
      url: url,
      quality:
        inferQuality(
          url,
          label
        ),
      referer: pageUrl,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": pageUrl
      }
    });
  }

  var directRegex =
    /https?:\/\/[^\s"'<>\\]+?(?:\.m3u8|\.mp4|\.m4v)(?:\?[^\s"'<>\\]*)?/gi;

  var direct;

  while (
    (direct = directRegex.exec(source))
  ) {
    add(
      direct[0],
      ""
    );
  }

  var attrRegex =
    /(?:file|source|src)\s*[:=]\s*["']([^"']+)["']/gi;

  var attr;

  while (
    (attr = attrRegex.exec(source))
  ) {
    add(
      attr[1],
      ""
    );
  }

  var tagRegex =
    /<(?:video|source)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi;

  var tag;

  while (
    (tag = tagRegex.exec(source))
  ) {
    add(
      tag[2],
      ""
    );
  }

  return output;
}

function extractIframes(
  text,
  pageUrl
) {
  var source =
    String(text || "");

  var seen = {};
  var output = [];

  var regex =
    /<iframe\b[^>]*(?:src|data-src)\s*=\s*(["'])(.*?)\1[^>]*>/gi;

  var match;

  while (
    (match = regex.exec(source))
  ) {
    var url =
      safeUrl(
        match[2],
        pageUrl
      );

    if (
      !url ||
      seen[url]
    ) {
      continue;
    }

    seen[url] = true;
    output.push(url);

    if (output.length >= 4) {
      break;
    }
  }

  return output;
}

function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function sanitizePlaybackHeaders(
  rawHeaders,
  fallbackReferer
) {
  var input =
    rawHeaders &&
    typeof rawHeaders === "object"
      ? rawHeaders
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

      output[key] =
        String(input[key]);
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

  output["Referer"] =
    capturedReferer ||
    fallbackReferer ||
    BASE_URL + "/";

  return output;
}

function resolveWithWebView(
  url,
  referer,
  label
) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  return globalThis.webviewResolve(
    url,
    {
      referer:
        referer || BASE_URL + "/",
      timeoutMs:
        WEBVIEW_BUDGET_MS,
      finishAfterFirstMs: 650,
      suppressPopups: true,
      match: [
        ".m3u8",
        ".mp4",
        ".m4v",
        "/sora/"
      ],
      blocked: [
        "doubleclick",
        "googlesyndication",
        "/ads/",
        "vast"
      ]
    }
  )
    .then(function(result) {
      var streams =
        result &&
        Array.isArray(result.streams)
          ? result.streams
          : [];

      var seen = {};

      return streams
        .map(function(item) {
          var mediaUrl =
            String(
              item &&
              item.url ||
              ""
            ).trim();

          if (
            !mediaUrl ||
            !isDirectStream(mediaUrl) ||
            seen[mediaUrl]
          ) {
            return null;
          }

          seen[mediaUrl] = true;

          return {
            url: mediaUrl,
            quality:
              inferQuality(
                mediaUrl,
                item &&
                (
                  item.label ||
                  label
                )
              ),
            referer: url,
            headers:
              sanitizePlaybackHeaders(
                item && item.headers,
                url
              ),
            serverLabel:
              label || "WebView"
          };
        })
        .filter(Boolean);
    })
    .catch(function(error) {
      console.log(
        "[KissKH] WebView failed host=" +
        url +
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

function resolveHttpSource(
  url,
  referer,
  label,
  depth
) {
  var absolute =
    safeUrl(
      url,
      referer || BASE_URL + "/"
    );

  if (!absolute) {
    return Promise.resolve([]);
  }

  if (isDirectStream(absolute)) {
    return Promise.resolve([
      {
        url: absolute,
        quality:
          inferQuality(
            absolute,
            label
          ),
        referer:
          referer || BASE_URL + "/",
        headers: {
          "User-Agent": USER_AGENT,
          "Referer":
            referer || BASE_URL + "/",
          "Origin": BASE_URL
        },
        serverLabel: label
      }
    ]);
  }

  var currentDepth =
    Number(depth || 0);

  return fetchText(
    absolute,
    {
      "Referer":
        referer || BASE_URL + "/",
      "Accept":
        "text/html,application/xhtml+xml,*/*"
    },
    2800,
    "KissKH third-party"
  )
    .then(function(result) {
      var finalUrl =
        result.url || absolute;

      if (isDirectStream(finalUrl)) {
        return [
          {
            url: finalUrl,
            quality:
              inferQuality(
                finalUrl,
                label
              ),
            referer: absolute,
            headers: {
              "User-Agent": USER_AGENT,
              "Referer": absolute
            },
            serverLabel: label
          }
        ];
      }

      var direct =
        extractMediaFromText(
          result.text,
          finalUrl
        );

      direct.forEach(function(item) {
        item.serverLabel = label;
      });

      if (
        direct.length ||
        currentDepth >= 1
      ) {
        return direct;
      }

      var iframes =
        extractIframes(
          result.text,
          finalUrl
        );

      if (!iframes.length) {
        return [];
      }

      return collectSettled(
        iframes.map(function(child) {
          return resolveHttpSource(
            child,
            finalUrl,
            label,
            currentDepth + 1
          );
        }),
        3500
      ).then(function(groups) {
        var output = [];
        groups.forEach(function(group) {
          if (Array.isArray(group)) {
            output.push.apply(
              output,
              group
            );
          }
        });
        return output;
      });
    })
    .catch(function() {
      return [];
    })
    .then(function(staticStreams) {
      if (
        staticStreams &&
        staticStreams.length
      ) {
        return staticStreams;
      }

      return resolveWithWebView(
        absolute,
        referer || BASE_URL + "/",
        label
      );
    });
}

function buildSourceCandidates(source) {
  var values = [
    {
      value:
        source &&
        source.Video,
      label: "Primary"
    },
    {
      value:
        source &&
        source.ThirdParty,
      label: "ThirdParty"
    }
  ];

  var seen = {};

  return values
    .map(function(item) {
      var url =
        String(
          item.value || ""
        ).trim();

      if (
        !url ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      return {
        url: url,
        label: item.label
      };
    })
    .filter(Boolean);
}

function resolveVideoPipeline(
  detail,
  selected
) {
  return getKey(
    VIDEO_KEY_API,
    selected.id,
    "KissKH video key"
  )
    .then(function(key) {
      return getSources(
        detail,
        selected,
        key
      );
    })
    .then(function(source) {
      var candidates =
        buildSourceCandidates(
          source
        );

      if (!candidates.length) {
        throw new Error(
          "KissKH video API returned no source"
        );
      }

      var referer =
        episodeReferer(
          detail,
          selected
        );

      return collectSettled(
        candidates.map(
          function(candidate) {
            return resolveHttpSource(
              candidate.url,
              referer,
              candidate.label,
              0
            );
          }
        ),
        SOURCE_PIPELINE_MS
      );
    })
    .then(function(groups) {
      var seen = {};
      var streams = [];

      groups.forEach(function(group) {
        (Array.isArray(group) ? group : [])
          .forEach(function(stream) {
            var url =
              String(
                stream &&
                stream.url ||
                ""
              ).trim();

            if (
              !url ||
              seen[url]
            ) {
              return;
            }

            seen[url] = true;
            streams.push(stream);
          });
      });

      return streams;
    })
    .catch(function(error) {
      console.log(
        "[KissKH] video pipeline failed: " +
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
  resolved,
  subtitles,
  info,
  mediaType,
  season,
  episode
) {
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

  return (resolved || [])
    .map(function(source, index) {
      var url =
        String(
          source &&
          source.url ||
          ""
        ).trim();

      if (
        !url ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      var server =
        String(
          source &&
          source.serverLabel ||
          ""
        ).trim();

      var quality =
        source.quality ||
        inferQuality(
          url,
          server
        );

      return {
        name:
          PROVIDER_NAME +
          (
            server
              ? " " + server
              : resolved.length > 1
                ? " Server " + (index + 1)
                : ""
          ),
        title:
          (info.title || PROVIDER_NAME) +
          episodeLabel,
        url: url,
        quality: quality,
        type: "direct",
        subtitles:
          Array.isArray(subtitles)
            ? subtitles
            : [],
        headers:
          sanitizePlaybackHeaders(
            source.headers,
            source.referer ||
              BASE_URL + "/"
          )
      };
    })
    .filter(Boolean);
}

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  var type =
    mediaType === "movie"
      ? "movie"
      : "tv";

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

  var id =
    String(tmdbId || "")
      .trim();

  if (!id) {
    return Promise.resolve([]);
  }

  console.log(
    "[KissKH] Request tmdbId=" +
    id +
    " type=" +
    type +
    (
      type === "tv"
        ? " S" +
          requestedSeason +
          "E" +
          requestedEpisode
        : ""
    )
  );

  var info;

  var work =
    getTmdbInfo(
      id,
      type
    )
      .then(function(value) {
        info = value;

        if (!info.title) {
          throw new Error(
            "TMDB title is empty"
          );
        }

        return findBestDrama(
          info,
          type,
          requestedSeason
        );
      })
      .then(function(detail) {
        var selected =
          selectEpisode(
            detail,
            type,
            requestedSeason,
            requestedEpisode
          );

        if (
          !selected ||
          selected.id === undefined ||
          selected.id === null
        ) {
          throw new Error(
            "KissKH episode ID is missing"
          );
        }

        var videoTask =
          withSoftTimeout(
            resolveVideoPipeline(
              detail,
              selected
            ),
            SOURCE_PIPELINE_MS,
            "KissKH video pipeline"
          ).catch(function() {
            return [];
          });

        var subtitleTask =
          withSoftTimeout(
            getSubtitles(
              selected
            ),
            SUBTITLE_PIPELINE_MS,
            "KissKH subtitle pipeline"
          ).catch(function() {
            return [];
          });

        return Promise.all([
          videoTask,
          subtitleTask
        ]);
      })
      .then(function(results) {
        var streams =
          buildStreams(
            results[0],
            results[1],
            info,
            type,
            type === "tv"
              ? requestedSeason
              : null,
            type === "tv"
              ? requestedEpisode
              : null
          );

        console.log(
          "[KissKH] streams=" +
          streams.length +
          " subtitles=" +
          (
            streams[0] &&
            Array.isArray(
              streams[0].subtitles
            )
              ? streams[0].subtitles.length
              : 0
          )
        );

        return streams;
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "KissKH provider"
  ).catch(function(error) {
    console.error(
      "[KissKH] " +
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
"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.13";
var PRIMARY_BASE_URL = "https://kisskh.is";
var FALLBACK_BASE_URL = "https://kisskh.do";
var BASE_URL = PRIMARY_BASE_URL;
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

// Current KissKH requires a reusable stream kkey. Prefer a key supplied by
// VUEO or captured from KissKH's own episode page. The old Google Apps Script
// is retained only as a bounded compatibility fallback.
var LEGACY_VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var LEGACY_KISSKH_VERSION = "2.8.10";
var VIDEO_KEY_CACHE_SLOT = "__VUEO_KISSKH_VIDEO_KEY_CACHE__";
var VIDEO_KEY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
var WEBVIEW_KEY_TIMEOUT_MS = 3600;
var LEGACY_KEY_TIMEOUT_MS = 2400;
var LOCAL_VIDEO_KEY_CACHE = {};

var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*"
};

function headersFor(baseUrl, extra) {
  return Object.assign({}, DEFAULT_HEADERS, {
    "Referer": String(baseUrl || BASE_URL).replace(/\/+$/, "") + "/"
  }, extra || {});
}

function fetchJson(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    return response.json();
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/([a-z0-9])'s\b/g, "$1s")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function uniqueText(values) {
  var out = [];
  var seen = {};
  (values || []).forEach(function(value) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    out.push(text);
  });
  return out;
}

function collectTmdbAliases(data, mediaType) {
  var values = [
    data && (data.title || data.name),
    data && (data.original_title || data.original_name)
  ];

  var alt = data && data.alternative_titles;
  var altItems = alt && Array.isArray(alt.titles)
    ? alt.titles
    : alt && Array.isArray(alt.results)
      ? alt.results
      : [];

  altItems.forEach(function(item) {
    if (item) values.push(item.title || item.name);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];

  translations.forEach(function(item) {
    var row = item && item.data;
    if (row) values.push(row.title || row.name);
  });

  return uniqueText(values).slice(0, 12);
}

function inferQuality(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function isDirectStream(url) {
  var value = String(url || "").toLowerCase();
  return value.indexOf(".m3u8") !== -1 || value.indexOf(".mp4") !== -1;
}

function getTmdbInfo(tmdbId, mediaType) {
  var started = Date.now();
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  function parseContext(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (_) { return null; }
    }
    if (!raw || typeof raw !== "object" || raw.error) return null;
    var contextId = raw.tmdbId || raw.tmdb && raw.tmdb.id;
    var contextType = raw.mediaType === "series" ? "tv" : raw.mediaType;
    if (contextId && String(contextId) !== String(tmdbId)) return null;
    if (contextType && contextType !== mediaType) return null;
    return raw;
  }

  function normalizeData(data, context) {
    data = data || {};
    context = context || {};
    return {
      title: data.title || data.name || context.title || "",
      originalTitle: data.original_title || data.original_name || context.originalTitle || "",
      year: String(
        data.release_date ||
        data.first_air_date ||
        context.year ||
        ""
      ).split("-")[0],
      aliases: uniqueText(
        collectTmdbAliases(data, mediaType).concat(
          Array.isArray(context.aliases) ? context.aliases : []
        )
      )
    };
  }

  try {
    if (typeof globalThis !== "undefined") {
      var directContext = parseContext(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (directContext) {
        var directTmdb = directContext.tmdb && typeof directContext.tmdb === "object"
          ? directContext.tmdb
          : {
              title: mediaType === "movie" ? directContext.title : undefined,
              name: mediaType === "tv" ? directContext.title : undefined,
              original_title: mediaType === "movie" ? directContext.originalTitle : undefined,
              original_name: mediaType === "tv" ? directContext.originalTitle : undefined,
              release_date: mediaType === "movie" && directContext.year
                ? String(directContext.year) + "-01-01" : "",
              first_air_date: mediaType === "tv" && directContext.year
                ? String(directContext.year) + "-01-01" : ""
            };

        var directInfo = normalizeData(directTmdb, directContext);

        // Some VUEO builds expose VUEO_DISCOVERY_CONTEXT before its title/TMDB
        // payload is populated. Do not accept an empty shell as valid metadata.
        if (directInfo && directInfo.title) {
          console.log("[KissKH] metadata=shared-direct elapsed=" +
            (Date.now() - started) + "ms");
          return Promise.resolve(directInfo);
        }

        console.log("[KissKH] metadata=shared-direct-empty fallback=true");
      }

      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve(globalThis.vueoDiscoveryContext(url))
          .then(function(context) {
            context = parseContext(context);
            if (context) {
              var data = context.tmdb && typeof context.tmdb === "object"
                ? context.tmdb
                : {};
              var sharedInfo = normalizeData(data, context);
              if (sharedInfo && sharedInfo.title) {
                console.log("[KissKH] metadata=shared-fn elapsed=" +
                  (Date.now() - started) + "ms");
                return sharedInfo;
              }
              console.log("[KissKH] metadata=shared-fn-empty fallback=true");
            }
            throw new Error("shared metadata unavailable");
          })
          .catch(function() {
            var tmdbStarted = Date.now();
            return fetchJson(url, {}).then(function(data) {
              console.log("[KissKH] metadata=tmdb elapsed=" +
                (Date.now() - tmdbStarted) + "ms");
              return normalizeData(data, null);
            });
          });
      }
    }
  } catch (_) {}

  var tmdbStarted = Date.now();
  return fetchJson(url, {}).then(function(data) {
    console.log("[KissKH] metadata=tmdb elapsed=" +
      (Date.now() - tmdbStarted) + "ms");
    return normalizeData(data, null);
  });
}

function searchKissKh(baseUrl, query) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0";
  var started = Date.now();
  return fetchJson(url, headersFor(base, {})).then(function(data) {
    var rows = Array.isArray(data) ? data : [];
    console.log("[KissKH] search host=" + base + " query='" + query +
      "' items=" + rows.length + " elapsed=" + (Date.now() - started) + "ms");
    return rows;
  });
}

function getDramaDetail(baseUrl, id) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Drama/" + encodeURIComponent(id) + "?isq=false";
  var started = Date.now();
  return fetchJson(url, headersFor(base, {})).then(function(detail) {
    if (detail && typeof detail === "object") detail.__baseUrl = base;
    console.log("[KissKH] detail id=" + id + " elapsed=" +
      (Date.now() - started) + "ms");
    return detail;
  });
}


function candidateYear(item) {
  if (!item || typeof item !== "object") return "";
  var direct = item.year || item.releaseYear || item.releaseDate || item.release_date || "";
  var directYear = String(direct || "").match(/\b((?:19|20)\d{2})\b/);
  if (directYear) return directYear[1];

  var titleYear = String(item.title || "").match(/\b((?:19|20)\d{2})\b/);
  return titleYear ? titleYear[1] : "";
}

function cleanCandidateTitle(value) {
  return String(value || "")
    .replace(/\s*[\(\[\{]\s*(?:19|20)\d{2}\s*[\)\]\}]\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:19|20)\d{2}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchesExact(value, info) {
  var actual = normalizeTitle(cleanCandidateTitle(value));
  var expected = normalizeTitle(info && info.title);
  return !!actual && !!expected && actual === expected;
}

function parseTvSeasonTitle(value) {
  var title = cleanCandidateTitle(value);
  var season = null;
  var explicit = false;
  var match;

  // KissKH commonly stores each TV season as a separate drama entry, e.g.
  // "Reacher - Season 2", "Kingdom: Season 2", or "Season 2" without a dash.
  match = title.match(/(?:\s*[-–—:]\s*|\s+)season\s*(\d+)\s*$/i);
  if (match) {
    season = Number(match[1]);
    explicit = true;
    title = title.slice(0, match.index).trim();
  } else {
    // Also support suffixes such as "2nd Season" / "3rd Season".
    match = title.match(/(?:\s*[-–—:]\s*|\s+)(\d+)(?:st|nd|rd|th)\s+season\s*$/i);
    if (match) {
      season = Number(match[1]);
      explicit = true;
      title = title.slice(0, match.index).trim();
    }
  }

  return {
    baseTitle: title,
    season: season,
    explicit: explicit
  };
}

function exactTitleCandidates(items, info) {
  return (items || []).filter(function(item) {
    return item && item.id !== undefined && titleMatchesExact(item.title, info);
  });
}

function exactTvSeasonCandidates(items, info, requestedSeason) {
  var expected = normalizeTitle(info && info.title);
  var seasonNumber = Math.max(1, Number(requestedSeason || 1));
  var rows = [];

  (items || []).forEach(function(item) {
    if (!item || item.id === undefined) return;
    var parsed = parseTvSeasonTitle(item.title);
    if (!parsed.baseTitle || normalizeTitle(parsed.baseTitle) !== expected) return;

    // For S2+, only an explicit matching season is safe. A bare base title is
    // treated as S1 because many KissKH shows store their first season that way.
    var itemSeason = parsed.explicit ? parsed.season : 1;
    if (itemSeason !== seasonNumber) return;

    rows.push({ item: item, parsed: parsed });
  });

  return rows;
}

function loadSelectedDetail(base, candidate, info, selectionReason) {
  console.log(
    "[KissKH] SELECT title='" + String(candidate && candidate.title || "") +
    "' year=" + (candidateYear(candidate) || "?") +
    " reason=" + selectionReason
  );

  return getDramaDetail(base, candidate.id)
    .then(function(detail) {
      BASE_URL = base;
      if (detail && typeof detail === "object") {
        detail.__dramaId = candidate.id;
        detail.__selectedTitle = String(candidate.title || detail.title || "");
        detail.__selectedUrl = String(candidate.url || candidate.link || candidate.slug || "");
      }
      return detail;
    })
    .catch(function(error) {
      console.log(
        "[KissKH] detail failed id=" + String(candidate && candidate.id || "?") +
        " reason=" + String(error && error.message || "detail-error")
      );
      return null;
    });
}

function resolveDuplicateByYear(base, candidates, info) {
  var expectedYear = String(info && info.year || "").match(/\b((?:19|20)\d{2})\b/);
  expectedYear = expectedYear ? expectedYear[1] : "";

  if (!expectedYear) {
    return loadSelectedDetail(base, candidates[0], info, "exact-title-no-year");
  }

  var directYearMatches = candidates.filter(function(candidate) {
    return candidateYear(candidate) === expectedYear;
  });

  if (directYearMatches.length > 0) {
    return loadSelectedDetail(base, directYearMatches[0], info, "exact-title-year");
  }

  var unknownYearCandidates = candidates.filter(function(candidate) {
    return !candidateYear(candidate);
  });

  if (unknownYearCandidates.length === 0) {
    console.log(
      "[KissKH] exact title duplicates=" + candidates.length +
      " but no year=" + expectedYear + " match"
    );
    return Promise.resolve(null);
  }

  function inspect(index) {
    if (index >= unknownYearCandidates.length) return Promise.resolve(null);
    var candidate = unknownYearCandidates[index];
    return getDramaDetail(base, candidate.id)
      .then(function(detail) {
        var detailYear = candidateYear(detail);
        console.log(
          "[KissKH] duplicate detail title='" + String(candidate.title || "") +
          "' year=" + (detailYear || "?") +
          " expected=" + expectedYear
        );
        if (detailYear === expectedYear) {
          BASE_URL = base;
          console.log(
            "[KissKH] SELECT title='" + String(candidate.title || "") +
            "' year=" + detailYear + " reason=exact-title-year-detail"
          );
          return detail;
        }
        return inspect(index + 1);
      })
      .catch(function() {
        return inspect(index + 1);
      });
  }

  return inspect(0);
}

function selectExactTitle(base, group, info) {
  var exact = exactTitleCandidates(group, info);
  console.log(
    "[KissKH] exact title query='" + info.title +
    "' matches=" + exact.length +
    " total=" + (group || []).length
  );

  if (exact.length === 0) return Promise.resolve(null);

  // User-selected rule: if there is only one exact title, use it immediately.
  // The release year is consulted only when multiple exact-title results exist.
  if (exact.length === 1) {
    return loadSelectedDetail(base, exact[0], info, "exact-title-single");
  }

  return resolveDuplicateByYear(base, exact, info);
}

function selectTvSeason(base, group, info, requestedSeason) {
  var seasonNumber = Math.max(1, Number(requestedSeason || 1));
  var matches = exactTvSeasonCandidates(group, info, seasonNumber);

  console.log(
    "[KissKH] exact tv title query='" + info.title +
    "' season=" + seasonNumber +
    " matches=" + matches.length +
    " total=" + (group || []).length
  );

  if (matches.length === 0) return Promise.resolve(null);

  // Prefer an explicit "Season 1" entry over a bare title when both exist.
  // For S2+ every match is already explicit by exactTvSeasonCandidates().
  if (seasonNumber === 1) {
    var explicitS1 = matches.filter(function(row) {
      return row.parsed.explicit && row.parsed.season === 1;
    });
    if (explicitS1.length > 0) matches = explicitS1;
  }

  var candidates = matches.map(function(row) { return row.item; });
  if (candidates.length === 1) {
    return loadSelectedDetail(base, candidates[0], info, "exact-tv-season-single");
  }

  // If duplicate entries exist for the same title+season, use the series year
  // only as a tie-breaker when it directly matches one candidate. Do not reject
  // all candidates when season release year differs from the series premiere year.
  var expectedYear = String(info && info.year || "").match(/\b((?:19|20)\d{2})\b/);
  expectedYear = expectedYear ? expectedYear[1] : "";
  if (expectedYear) {
    var yearMatches = candidates.filter(function(candidate) {
      return candidateYear(candidate) === expectedYear;
    });
    if (yearMatches.length > 0) {
      return loadSelectedDetail(base, yearMatches[0], info, "exact-tv-season-year");
    }
  }

  return loadSelectedDetail(base, candidates[0], info, "exact-tv-season-first");
}

function findBestDrama(info, mediaType, season) {
  var query = String(info && info.title || "").replace(/\s+/g, " ").trim();
  if (!query) return Promise.reject(new Error("KissKH title is empty"));

  // One search only: the VUEO/TMDB title. Do not fan out into aliases,
  // title+year variants, or score unrelated search results.
  return searchKissKh(PRIMARY_BASE_URL, query)
    .then(function(group) {
      return mediaType === "tv"
        ? selectTvSeason(PRIMARY_BASE_URL, group, info, season)
        : selectExactTitle(PRIMARY_BASE_URL, group, info);
    }, function(primaryError) {
      // The fallback domain is only for an actual primary-host failure.
      // A successful search with zero exact titles is a valid negative result.
      console.log(
        "[KissKH] primary search failed; fallback host reason=" +
        String(primaryError && primaryError.message || "search-error")
      );
      return searchKissKh(FALLBACK_BASE_URL, query)
        .then(function(group) {
          return mediaType === "tv"
            ? selectTvSeason(FALLBACK_BASE_URL, group, info, season)
            : selectExactTitle(FALLBACK_BASE_URL, group, info);
        });
    })
    .then(function(detail) {
      if (detail) return detail;
      throw new Error(
        mediaType === "tv"
          ? "No exact title/season match for " + info.title + " S" + Math.max(1, Number(season || 1))
          : "No exact title match for " + info.title + " (" + (info.year || "?") + ")"
      );
    });
}

function selectEpisode(detail, mediaType, season, episode) {
  var episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
  if (episodes.length === 0) throw new Error("No KissKH episodes");

  if (mediaType === "movie") {
    return episodes[0];
  }

  var requestedEpisode = Number(episode || 1);
  var exact = episodes.find(function(item) {
    return Number(item.number) === requestedEpisode;
  });

  if (!exact) throw new Error("Episode " + requestedEpisode + " not found on KissKH");
  return exact;
}

function getVideoKeyCache() {
  var store = LOCAL_VIDEO_KEY_CACHE;

  if (typeof globalThis === "object" && globalThis) {
    if (!globalThis[VIDEO_KEY_CACHE_SLOT] ||
        typeof globalThis[VIDEO_KEY_CACHE_SLOT] !== "object") {
      globalThis[VIDEO_KEY_CACHE_SLOT] = {};
    }
    store = globalThis[VIDEO_KEY_CACHE_SLOT];
  }

  if (!store.stream || typeof store.stream !== "object") {
    store.stream = { key: "", fetchedAt: 0, promise: null };
  }
  return store.stream;
}

function clearVideoKeyCache(expectedKey) {
  var cache = getVideoKeyCache();
  if (!expectedKey || cache.key === expectedKey) {
    cache.key = "";
    cache.fetchedAt = 0;
  }
}

function readInjectedVideoKey() {
  if (typeof globalThis !== "object" || !globalThis) return "";

  var direct = [
    globalThis.KISSKH_STREAM_KEY,
    globalThis.VUEO_KISSKH_STREAM_KEY
  ];

  var context = globalThis.VUEO_DISCOVERY_CONTEXT;
  if (context && typeof context === "object") {
    direct.push(context.kisskhStreamKey);
    direct.push(context.KISSKH_STREAM_KEY);
    if (context.providerKeys && context.providerKeys.kisskh) {
      direct.push(context.providerKeys.kisskh.stream || context.providerKeys.kisskh.streamKey);
    }
  }

  for (var i = 0; i < direct.length; i++) {
    var key = String(direct[i] || "").trim();
    if (key.length >= 16) return key;
  }
  return "";
}

function fetchJsonWithTimeout(url, headers, timeoutMs) {
  var timeout = Math.max(250, Number(timeoutMs || 0));
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer;

  var request = fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow",
    signal: controller ? controller.signal : undefined
  }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.json();
  });

  var deadline = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      try { if (controller) controller.abort(); } catch (_) {}
      reject(new Error("timeout after " + timeout + "ms"));
    }, timeout);
  });

  return Promise.race([request, deadline]).then(function(value) {
    clearTimeout(timer);
    return value;
  }, function(error) {
    clearTimeout(timer);
    throw error;
  });
}

function dramaSlug(value) {
  return cleanCandidateTitle(value)
    .replace(/[’‘`´']/g, "")
    .replace(/&/g, " and ")
    .replace(/[\s\/\?\#\:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "Drama";
}

function dramaPageBase(detail) {
  var base = String(detail && detail.__baseUrl || BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var raw = String(detail && detail.__selectedUrl || "").trim();
  var id = detail && detail.__dramaId;

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/Episode-[^/?#]+.*$/i, "").replace(/[?#].*$/, "");
  }

  if (raw && raw.indexOf("/Drama/") !== -1) {
    return base + (raw.charAt(0) === "/" ? raw : "/" + raw).replace(/[?#].*$/, "");
  }

  var slug = raw && raw.indexOf("/") === -1 ? raw : dramaSlug(detail && detail.__selectedTitle || detail && detail.title);
  return base + "/Drama/" + encodeURIComponent(slug).replace(/%2D/gi, "-") +
    (id !== undefined && id !== null ? "?id=" + encodeURIComponent(id) : "");
}

function episodePageUrl(detail, selected) {
  var basePage = dramaPageBase(detail).replace(/[?#].*$/, "");
  var dramaId = detail && detail.__dramaId;
  var number = Math.max(1, Number(selected && selected.number || 1));
  var episodeId = selected && selected.id;
  return basePage + "/Episode-" + number +
    "?id=" + encodeURIComponent(dramaId) +
    "&ep=" + encodeURIComponent(episodeId) +
    "&page=0&pageSize=100";
}

function extractKkey(url) {
  var match = String(url || "").match(/[?&]kkey=([^&#]+)/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
}

function captureVideoKeyFromKissKh(selected, detail) {
  if (typeof globalThis !== "object" || !globalThis ||
      typeof globalThis.webviewResolve !== "function") {
    return Promise.reject(new Error("webviewResolve unavailable"));
  }

  var pageUrl = episodePageUrl(detail, selected);
  var base = String(detail && detail.__baseUrl || BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var started = Date.now();

  console.log("[KissKH] video key=webview-start host=" + base);
  return globalThis.webviewResolve(pageUrl, {
    referer: base + "/",
    directLoad: true,
    timeoutMs: WEBVIEW_KEY_TIMEOUT_MS,
    finishAfterFirstMs: 120,
    suppressPopups: true,
    lockMainFrameHost: true,
    interactionTexts: [
      "episode " + Math.max(1, Number(selected && selected.number || 1)),
      "play",
      "watch"
    ],
    match: ["/api/DramaList/Episode/"]
  }).then(function(result) {
    var rows = result && Array.isArray(result.streams) ? result.streams : [];
    for (var i = 0; i < rows.length; i++) {
      var key = extractKkey(rows[i] && rows[i].url);
      if (key) {
        console.log("[KissKH] video key=webview elapsed=" +
          (Date.now() - started) + "ms");
        return key;
      }
    }
    throw new Error("KissKH webview did not capture kkey");
  });
}

function getLegacyVideoKey(episodeId) {
  var url = LEGACY_VIDEO_KEY_API + encodeURIComponent(episodeId) +
    "&version=" + encodeURIComponent(LEGACY_KISSKH_VERSION);
  var started = Date.now();
  return fetchJsonWithTimeout(url, {}, LEGACY_KEY_TIMEOUT_MS).then(function(data) {
    if (!data || !data.key) throw new Error("Empty legacy KissKH video key");
    console.log("[KissKH] video key=legacy-fallback elapsed=" +
      (Date.now() - started) + "ms");
    return String(data.key);
  });
}

function getVideoKey(selected, detail, forceRefresh) {
  var cache = getVideoKeyCache();
  var now = Date.now();
  var age = cache.fetchedAt ? now - cache.fetchedAt : Infinity;

  if (!forceRefresh) {
    var injected = readInjectedVideoKey();
    if (injected) {
      cache.key = injected;
      cache.fetchedAt = now;
      console.log("[KissKH] video key=injected");
      return Promise.resolve(injected);
    }

    if (cache.key && age < VIDEO_KEY_CACHE_TTL_MS) {
      console.log("[KissKH] video key=cache-hit age=" + age + "ms");
      return Promise.resolve(cache.key);
    }

    if (cache.promise) {
      console.log("[KissKH] video key=shared-inflight");
      return cache.promise;
    }
  }

  var episodeId = selected && selected.id;
  var request = captureVideoKeyFromKissKh(selected, detail)
    .catch(function(webviewError) {
      console.log("[KissKH] video key webview miss reason=" +
        String(webviewError && webviewError.message || webviewError));
      return getLegacyVideoKey(episodeId);
    })
    .then(function(key) {
      if (!key) throw new Error("Empty KissKH video key");
      cache.key = key;
      cache.fetchedAt = Date.now();
      return key;
    });

  cache.promise = request.then(function(key) {
    cache.promise = null;
    return key;
  }, function(error) {
    cache.promise = null;
    throw error;
  });
  return cache.promise;
}

function isVideoKeyAuthError(error) {
  return /\bHTTP\s+(?:401|403)\b/i.test(
    String(error && error.message || error || "")
  );
}

function getSources(episodeId, key) {
  var base = String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Episode/" + encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(key);
  var started = Date.now();
  return fetchJson(url, headersFor(base, {
    "Origin": base,
    "Referer": base + "/"
  })).then(function(data) {
    console.log("[KissKH] sources elapsed=" + (Date.now() - started) + "ms");
    return data;
  });
}

function buildStreams(source, info, season, episode) {
  var urls = [source && source.Video, source && source.ThirdParty]
    .map(function(value) { return String(value || "").trim(); })
    .filter(function(value, index, array) {
      return value && isDirectStream(value) && array.indexOf(value) === index;
    });

  return urls.map(function(url, index) {
    var quality = inferQuality(url);
    var episodeLabel = episode ? " S" + String(season || 1).padStart(2, "0") +
      "E" + String(episode).padStart(2, "0") : "";

    return {
      name: PROVIDER_NAME + (urls.length > 1 ? " Server " + (index + 1) : ""),
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: url,
      quality: quality,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "") + "/",
        "Origin": String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "")
      }
    };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  console.log("[KissKH] v" + VERSION + " TMDB=" + tmdbId + " type=" + type +
    (type === "tv" ? " S" + (season || 1) + "E" + (episode || 1) : ""));

  var info;
  var requestStarted = Date.now();
  return getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      console.log("[KissKH] title='" + info.title + "' year=" + (info.year || "?") + " aliases=" + (info.aliases || []).length);
      return findBestDrama(info, type, season || 1);
    })
    .then(function(detail) {
      var selected = selectEpisode(detail, type, season, episode);
      if (!selected || selected.id === undefined) throw new Error("KissKH episode ID is missing");
      return getVideoKey(selected, detail, false).then(function(key) {
        return getSources(selected.id, key).catch(function(error) {
          if (!isVideoKeyAuthError(error)) throw error;
          clearVideoKeyCache(key);
          console.log("[KissKH] video key rejected; refreshing once");
          return getVideoKey(selected, detail, true).then(function(freshKey) {
            return getSources(selected.id, freshKey);
          });
        });
      });
    })
    .then(function(source) {
      var streams = buildStreams(source, info, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[KissKH] Direct streams found=" + streams.length +
        " elapsed=" + (Date.now() - requestStarted) + "ms");
      return streams;
    })
    .catch(function(error) {
      console.error("[KissKH] " + error.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };

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
module.exports = cloudbankDisplayInstall(module.exports, "KissKH", "kisskh");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
