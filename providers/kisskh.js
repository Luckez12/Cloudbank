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

/* CLOUDBANK_VERSION_MERGE_ADAPTER_START */
function cloudbankVersionMerge(engines, providerId) {
  var primary = engines[0].provider;
  var merged = Object.assign({}, primary);
  function platform(args) {
    var options = args[4];
    var hint = options && options.platform || (typeof globalThis !== 'undefined' && (globalThis.VUEO_PLATFORM || globalThis.PLATFORM || globalThis.platform));
    if (!hint && typeof navigator !== 'undefined') hint = navigator.userAgent;
    hint = String(hint || '').toLowerCase();
    if (/ios|iphone|ipad/.test(hint)) return 'ios';
    if (/android/.test(hint)) return 'android';
    return hint;
  }
  function available(engine, args) {
    if (!engine.enabled) return false;
    if (!engine.disabledPlatforms.length) return true;
    var current = platform(args);
    // Preserve source platform restrictions when the host cannot identify its platform.
    return !!current && engine.disabledPlatforms.indexOf(current) < 0;
  }
  function key(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + key(value[k]); }).join(',') + '}';
  }
  function combine(results) {
    var seen = Object.create(null), out = [];
    results.forEach(function(rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(function(stream) {
        if (!stream || typeof stream.url !== 'string' || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return;
        var identity;
        try { identity = key([stream.url, stream.name || '', stream.headers || {}, stream.subtitles || [], stream.audio || stream.language || '', stream.quality || '']); }
        catch (_) { identity = String(stream.url) + '/' + String(stream.name || ''); }
        if (seen[identity]) return;
        seen[identity] = true;
        out.push(Object.assign({}, stream, { provider: providerId }));
      });
    });
    return out;
  }
  merged.getStreams = function(id, type, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    type = type === 'series' ? 'tv' : type;
    if (!String(id || '').trim() || (type !== 'movie' && type !== 'tv')) return Promise.resolve([]);
    if (type === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(id); args[1] = type;
    if (type === 'tv') { args[2] = Number(season); args[3] = Number(episode); }
    var deadline = Date.now() + 18500;
    var active = engines.filter(function(engine) { return available(engine, args); });
    var results = active.map(function() { return []; });
    return new Promise(function(resolve) {
      var done = false, primaryDone = false, alternateStarted = false, alternateDone = false;
      var timers = [];
      function finish() {
        if (done) return; done = true;
        timers.forEach(clearTimeout);
        resolve(combine(results));
      }
      function attempt(index, ms, next) {
        if (done || Date.now() >= deadline) { next(); return; }
        var settled = false;
        var timer = setTimeout(function() { settle([]); }, Math.min(ms, deadline - Date.now())); timers.push(timer);
        function settle(rows) {
          if (settled || done) return; settled = true; clearTimeout(timer);
          results[index] = Array.isArray(rows) ? rows : [];
          next();
        }
        Promise.resolve().then(function() { return active[index].provider.getStreams.apply(active[index].provider, args); }).then(settle, function() { settle([]); });
      }
      function alternate(index) {
        if (done) return;
        if (index >= active.length) { alternateDone = true; if (primaryDone) finish(); return; }
        attempt(index, 6000, function() {
          if (combine([results[index]]).length) { alternateDone = true; if (primaryDone) finish(); }
          else alternate(index + 1);
        });
      }
      function startAlternate() {
        if (alternateStarted || done) return; alternateStarted = true; alternate(1);
      }
      if (!active.length) { finish(); return; }
      timers.push(setTimeout(finish, 18500));
      // A fast successful primary starts no duplicate engine. A slow or failed one unlocks the fallback.
      timers.push(setTimeout(startAlternate, 5000));
      attempt(0, 18500, function() {
        primaryDone = true;
        if (combine([results[0]]).length) { finish(); return; }
        startAlternate();
        if (alternateDone) finish();
      });
    });
  };
  // Preserve primary settings and add missing alternate controls/options under the same provider ID.
  if (engines.some(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; })) {
    merged.onSettings = function() {
      var args = arguments;
      return Promise.all(engines.filter(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; }).map(function(engine) {
        return new Promise(function(resolve) {
          var timer = setTimeout(function() { resolve([]); }, 1500);
          Promise.resolve().then(function() { return engine.provider.onSettings.apply(engine.provider, args); }).then(function(value) { clearTimeout(timer); resolve(value); }, function() { clearTimeout(timer); resolve([]); });
        });
      })).then(function(values) {
        if (values.length && !Array.isArray(values[0])) return values[0];
        var out = [], keys = Object.create(null), headers = Object.create(null);
        values.forEach(function(rows) {
          if (!Array.isArray(rows)) return;
          rows.forEach(function(setting) {
            if (!setting || typeof setting !== 'object') return;
            if (!setting.key) {
              var identity = key(setting); if (!headers[identity]) { headers[identity] = true; out.push(setting); } return;
            }
            var existing = keys[setting.key];
            if (!existing) { existing = Object.assign({}, setting); if (Array.isArray(setting.options)) existing.options = setting.options.slice(); keys[setting.key] = existing; out.push(existing); return; }
            if (existing.type === setting.type && Array.isArray(existing.options) && Array.isArray(setting.options)) {
              setting.options.forEach(function(option) { if (!existing.options.some(function(current) { return current.value === option.value; })) existing.options.push(option); });
            }
          });
        });
        return out;
      });
    };
  }
  return merged;
}
function cloudbankMergedBudgetFetch(nativeFetch, deadline) {
  function bounded(run) {
    var remaining = Math.min(2200, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(new Error('Merged engine budget exhausted'));
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Merged engine request timeout')); }, remaining);
      Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
    });
  }
  return function(url, options) {
    return bounded(function() { return nativeFetch(url, options); }).then(function(response) {
      return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: response.headers,
        text: function() { return bounded(function() { return response.text(); }); },
        json: function() { return bounded(function() { return response.json(); }); },
        arrayBuffer: function() { return bounded(function() { return response.arrayBuffer(); }); } };
    });
  };
}
function cloudbankMergedMetadataFetch(nativeFetch) {
  return function(url, options) {
    var raw = typeof url === 'string' ? url : url && url.url;
    var match = typeof raw === 'string' && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || options && options.method && String(options.method).toUpperCase() !== 'GET' || typeof vueoSharedTmdb !== 'function') return nativeFetch(url, options);
    var context = typeof globalThis !== 'undefined' ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === 'string') { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    if (contextId && String(contextId) !== match[2]) return nativeFetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return nativeFetch(url, options).then(function(response) { if (!response.ok) throw new Error('TMDB HTTP ' + response.status); return response.json(); });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw, headers: { get: function(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); } };
    });
  };
}
/* CLOUDBANK_VERSION_MERGE_ADAPTER_END */

var cloudbankMergedEngines = [{ id: "kisskh", enabled: true, disabledPlatforms: [], provider: module.exports }];
cloudbankMergedEngines.push({ id: "kisskh-v2", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:kisskh-v2 */
const _0x41778f=_0x33a8;(function(_0x104ed8,_0x594abf){const _0x19fed8={_0x472805:0x1d9,_0xb7e4e9:0x1e0,_0x427a29:0x1d4},_0x476bef=_0x33a8,_0x125229=_0x104ed8();while(!![]){try{const _0x437ef3=parseInt(_0x476bef(0x1c6))/0x1*(-parseInt(_0x476bef(_0x19fed8._0x472805))/0x2)+-parseInt(_0x476bef(0x1f7))/0x3*(parseInt(_0x476bef(0x1e2))/0x4)+-parseInt(_0x476bef(_0x19fed8._0xb7e4e9))/0x5+parseInt(_0x476bef(0x1ec))/0x6+parseInt(_0x476bef(0x1c4))/0x7*(-parseInt(_0x476bef(0x1c7))/0x8)+-parseInt(_0x476bef(_0x19fed8._0x427a29))/0x9*(-parseInt(_0x476bef(0x1f4))/0xa)+parseInt(_0x476bef(0x1bf))/0xb*(parseInt(_0x476bef(0x1fc))/0xc);if(_0x437ef3===_0x594abf)break;else _0x125229['push'](_0x125229['shift']());}catch(_0x1ad90c){_0x125229['push'](_0x125229['shift']());}}}(_0x211a,0x6f12c));var __defProp=Object['defineProperty'],__getOwnPropSymbols=Object['getOwnPropertySymbols'],__hasOwnProp=Object[_0x41778f(0x1f1)]['hasOwnProperty'],__propIsEnum=Object['prototype'][_0x41778f(0x20b)],__defNormalProp=(_0x59a0ce,_0x203ab7,_0x453c8b)=>_0x203ab7 in _0x59a0ce?__defProp(_0x59a0ce,_0x203ab7,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x453c8b}):_0x59a0ce[_0x203ab7]=_0x453c8b,__spreadValues=(_0x2f2a38,_0x20f060)=>{const _0x2edd7a=_0x41778f;for(var _0x9cae8c in _0x20f060||(_0x20f060={}))if(__hasOwnProp[_0x2edd7a(0x1c5)](_0x20f060,_0x9cae8c))__defNormalProp(_0x2f2a38,_0x9cae8c,_0x20f060[_0x9cae8c]);if(__getOwnPropSymbols)for(var _0x9cae8c of __getOwnPropSymbols(_0x20f060)){if(__propIsEnum['call'](_0x20f060,_0x9cae8c))__defNormalProp(_0x2f2a38,_0x9cae8c,_0x20f060[_0x9cae8c]);}return _0x2f2a38;},__async=(_0x56f872,_0x34012e,_0x2aad33)=>{return new Promise((_0x4d738d,_0x2d73c7)=>{const _0x3604de=_0x33a8;var _0x1d9a9b=_0x3bcbc0=>{try{_0x3c5ff5(_0x2aad33['next'](_0x3bcbc0));}catch(_0x569dcc){_0x2d73c7(_0x569dcc);}},_0x47dbf5=_0x1ade28=>{try{_0x3c5ff5(_0x2aad33['throw'](_0x1ade28));}catch(_0x7be24c){_0x2d73c7(_0x7be24c);}},_0x3c5ff5=_0x43e578=>_0x43e578[_0x3604de(0x1e8)]?_0x4d738d(_0x43e578['value']):Promise['resolve'](_0x43e578['value'])[_0x3604de(0x1e9)](_0x1d9a9b,_0x47dbf5);_0x3c5ff5((_0x2aad33=_0x2aad33['apply'](_0x56f872,_0x34012e))['next']());});},KISSKH_BASE=_0x41778f(0x1d5),HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/147.0.0.0\x20Safari/537.36','Referer':KISSKH_BASE+'/','Accept':_0x41778f(0x1bd)};function fetchSafe(_0x2081d0){const _0x23b93a={_0x5c3088:0x1bc,_0x2d4f83:0x1d2,_0x49033b:0x1b6,_0x1628c0:0x1cb,_0x3e154f:0x1c1,_0x3a6968:0x1df};return __async(this,arguments,function*(_0xb777,_0x450596={}){const _0x19876f=_0x33a8;try{const _0x733212=0x3a98,_0x57125a=typeof AbortSignal!==_0x19876f(0x1b6)&&AbortSignal[_0x19876f(_0x23b93a._0x5c3088)]?AbortSignal['timeout'](_0x733212):null;let _0x1c4f36={'headers':__spreadValues(__spreadValues({},HEADERS),_0x450596[_0x19876f(_0x23b93a._0x2d4f83)]||{})};if(_0x57125a)_0x1c4f36['signal']=_0x57125a;if(typeof fetchText!==_0x19876f(_0x23b93a._0x49033b)){const _0x3782fc=yield fetchText(_0xb777,_0x1c4f36);return _0x3782fc;}else{const _0x51f075=yield fetch(_0xb777,_0x1c4f36);if(!_0x51f075||!_0x51f075['ok'])return null;return yield _0x51f075[_0x19876f(0x1c3)]();}}catch(_0xe05c4){return console[_0x19876f(_0x23b93a._0x1628c0)](_0x19876f(_0x23b93a._0x3e154f)+_0xe05c4[_0x19876f(_0x23b93a._0x3a6968)]),null;}});}function fetchJsonSafe(_0x2f8a5d){const _0xca9ee0={_0x5d048e:0x1cb};return __async(this,arguments,function*(_0x33a5ba,_0x5cd4e2={}){const _0x3a7fca=_0x33a8,_0x16c93b=yield fetchSafe(_0x33a5ba,_0x5cd4e2);if(!_0x16c93b)return null;try{return JSON[_0x3a7fca(0x1d8)](_0x16c93b);}catch(_0x2d1a6d){return console[_0x3a7fca(_0xca9ee0._0x5d048e)](_0x3a7fca(0x1ea)+_0x2d1a6d['message']),null;}});}function calculateHash(_0x22b07a){const _0x15b925=_0x41778f;let _0x147792=0x0;for(let _0x1b34e8=0x0;_0x1b34e8<_0x22b07a['length'];_0x1b34e8++){_0x147792=(_0x147792<<0x5)-_0x147792+_0x22b07a[_0x15b925(0x206)](_0x1b34e8);}return _0x147792;}function wordsToHex(_0x426b29){let _0x59e3bf='';for(let _0x3f7416=0x0;_0x3f7416<_0x426b29['length'];_0x3f7416++){let _0x2896a2=(_0x426b29[_0x3f7416]>>>0x0)['toString'](0x10);while(_0x2896a2['length']<0x8)_0x2896a2='0'+_0x2896a2;_0x59e3bf+=_0x2896a2;}return _0x59e3bf['toUpperCase']();}function encryptKkeyCustom(_0x59d24b){const _0x2d0ff4={_0xa22b42:0x206,_0x362620:0x1e3},_0x3dbe0f=_0x41778f;let _0x4bfa5d=_0x59d24b,_0x854f35=0x10-_0x59d24b['length']%0x10;for(let _0x2b146c=0x0;_0x2b146c<_0x854f35;_0x2b146c++){_0x4bfa5d+=String['fromCharCode'](_0x854f35);}let _0x294224=[];for(let _0x48a206=0x0;_0x48a206<_0x4bfa5d['length'];_0x48a206+=0x4){_0x294224['push'](_0x4bfa5d[_0x3dbe0f(0x206)](_0x48a206)<<0x18|_0x4bfa5d[_0x3dbe0f(_0x2d0ff4._0xa22b42)](_0x48a206+0x1)<<0x10|_0x4bfa5d['charCodeAt'](_0x48a206+0x2)<<0x8|_0x4bfa5d['charCodeAt'](_0x48a206+0x3));}const _0x48f2d5=[[0x4f6bdaa3,-0x61d07350,0x7f5e722d,-0x61210cec,0x536620a8,-0x32b653e8,-0x4de821cb,0x2cc92d21,-0x73412227,0x41f771c1,-0xc1f500c,-0x20d67d2b,0x2dadde47,0x6c5aaf86,-0x6045ff8e,0x409382a7,-0x6417db2,-0x6a1bd238,0xa5e2dba,0x4acdaf1d,0x54c72698,-0x3edcf4b0,-0x3482d916,-0x7e4f7609,-0x6c9fb16c,0x524345c4,-0x66c19cd2,0x188eead9,-0x351884c7,-0x675bc103,0x19a5dd3,0x1914b70a,-0x4fb1e313,0x28ea2210,0x29707fc3,0x3064c8c9,-0x17593e17,-0x3fb31c07,-0x16c363c6,-0x26a7ab0d,-0x4b793324,0x74ca2f25,-0x62094ce1,0x44aee7ec]];var _0x42c3de=[],_0x545c9f=[],_0x310bd9=[],_0xc76051=[],_0x43db5a=[],_0x1d204f=[];for(let _0x384500=0x0;_0x384500<0x100;_0x384500++)_0x1d204f[_0x384500]=_0x384500<0x80?_0x384500<<0x1:_0x384500<<0x1^0x11b;var _0x1543d8=0x0,_0x123d3b=0x0;for(let _0x4869ad=0x0;_0x4869ad<0x100;_0x4869ad++){var _0x2e903d=_0x123d3b^_0x123d3b<<0x1^_0x123d3b<<0x2^_0x123d3b<<0x3^_0x123d3b<<0x4;_0x2e903d=_0x2e903d>>>0x8^0xff&_0x2e903d^0x63,_0x42c3de[_0x1543d8]=_0x2e903d;var _0x25c18a=_0x1d204f[_0x1543d8],_0x2c1a96=_0x1d204f[_0x1d204f[_0x25c18a]],_0x5bccaa=0x101*_0x1d204f[_0x2e903d]^0x1010100*_0x2e903d;_0x545c9f[_0x1543d8]=_0x5bccaa<<0x18|_0x5bccaa>>>0x8,_0x310bd9[_0x1543d8]=_0x5bccaa<<0x10|_0x5bccaa>>>0x10,_0xc76051[_0x1543d8]=_0x5bccaa<<0x8|_0x5bccaa>>>0x18,_0x43db5a[_0x1543d8]=_0x5bccaa,_0x1543d8?(_0x1543d8=_0x25c18a^_0x1d204f[_0x1d204f[_0x1d204f[_0x2c1a96^_0x25c18a]]],_0x123d3b^=_0x1d204f[_0x1d204f[_0x123d3b]]):_0x1543d8=_0x123d3b=0x1;}_0x48f2d5[_0x3dbe0f(_0x2d0ff4._0x362620)](_0x545c9f),_0x48f2d5[_0x3dbe0f(0x1e3)](_0x310bd9),_0x48f2d5['push'](_0xc76051),_0x48f2d5['push'](_0x43db5a),_0x48f2d5[_0x3dbe0f(0x1e3)](_0x42c3de);const [_0x40bdfc,_0x457201,_0x35bf7e,_0x9a9dc,_0x2de4bf,_0x45ae79]=_0x48f2d5,_0x1a2ddc=[0x1504af3,0x56e619cf,0x2e42bba6,-0x73c08f07];for(let _0x37f332=0x0;_0x37f332<_0x294224['length'];_0x37f332+=0x4){let _0x26e77a=_0x37f332===0x0?_0x1a2ddc:_0x294224[_0x3dbe0f(0x1d0)](_0x37f332-0x4,_0x37f332);for(let _0x7f6614=0x0;_0x7f6614<0x4;_0x7f6614++){_0x294224[_0x37f332+_0x7f6614]^=_0x26e77a[_0x7f6614];}let _0x2ccf00=_0x294224[_0x37f332]^_0x40bdfc[0x0],_0x574a2e=_0x294224[_0x37f332+0x1]^_0x40bdfc[0x1],_0x417cc2=_0x294224[_0x37f332+0x2]^_0x40bdfc[0x2],_0x295407=_0x294224[_0x37f332+0x3]^_0x40bdfc[0x3],_0x4ae57d=0x4;for(let _0xc525f2=0x1;_0xc525f2<0xa;_0xc525f2++){let _0x46a364=_0x457201[_0x2ccf00>>>0x18]^_0x35bf7e[_0x574a2e>>>0x10&0xff]^_0x9a9dc[_0x417cc2>>>0x8&0xff]^_0x2de4bf[0xff&_0x295407]^_0x40bdfc[_0x4ae57d++],_0xc7e5c0=_0x457201[_0x574a2e>>>0x18]^_0x35bf7e[_0x417cc2>>>0x10&0xff]^_0x9a9dc[_0x295407>>>0x8&0xff]^_0x2de4bf[0xff&_0x2ccf00]^_0x40bdfc[_0x4ae57d++],_0x396cca=_0x457201[_0x417cc2>>>0x18]^_0x35bf7e[_0x295407>>>0x10&0xff]^_0x9a9dc[_0x2ccf00>>>0x8&0xff]^_0x2de4bf[0xff&_0x574a2e]^_0x40bdfc[_0x4ae57d++];_0x295407=_0x457201[_0x295407>>>0x18]^_0x35bf7e[_0x2ccf00>>>0x10&0xff]^_0x9a9dc[_0x574a2e>>>0x8&0xff]^_0x2de4bf[0xff&_0x417cc2]^_0x40bdfc[_0x4ae57d++],_0x2ccf00=_0x46a364,_0x574a2e=_0xc7e5c0,_0x417cc2=_0x396cca;}let _0x21d8b1=(_0x45ae79[_0x2ccf00>>>0x18]<<0x18|_0x45ae79[_0x574a2e>>>0x10&0xff]<<0x10|_0x45ae79[_0x417cc2>>>0x8&0xff]<<0x8|_0x45ae79[0xff&_0x295407])^_0x40bdfc[_0x4ae57d++],_0x40ed53=(_0x45ae79[_0x574a2e>>>0x18]<<0x18|_0x45ae79[_0x417cc2>>>0x10&0xff]<<0x10|_0x45ae79[_0x295407>>>0x8&0xff]<<0x8|_0x45ae79[0xff&_0x2ccf00])^_0x40bdfc[_0x4ae57d++],_0x16c28a=(_0x45ae79[_0x417cc2>>>0x18]<<0x18|_0x45ae79[_0x295407>>>0x10&0xff]<<0x10|_0x45ae79[_0x2ccf00>>>0x8&0xff]<<0x8|_0x45ae79[0xff&_0x574a2e])^_0x40bdfc[_0x4ae57d++],_0x5bbf43=(_0x45ae79[_0x295407>>>0x18]<<0x18|_0x45ae79[_0x2ccf00>>>0x10&0xff]<<0x10|_0x45ae79[_0x574a2e>>>0x8&0xff]<<0x8|_0x45ae79[0xff&_0x417cc2])^_0x40bdfc[_0x4ae57d++];_0x294224[_0x37f332]=_0x21d8b1,_0x294224[_0x37f332+0x1]=_0x40ed53,_0x294224[_0x37f332+0x2]=_0x16c28a,_0x294224[_0x37f332+0x3]=_0x5bbf43;}return wordsToHex(_0x294224);}function generateKkey(_0x35d192,_0x3279a3=![]){const _0x569af7={_0x3d8b07:0x1d7,_0xa67c6e:0x1d6,_0x4ee198:0x20e,_0x5a4b36:0x208},_0x19c5ac=_0x41778f,_0x1dedd1='2.8.10',_0x39ad75=_0x19c5ac(_0x569af7._0x3d8b07),_0x1b6079=_0x19c5ac(_0x569af7._0xa67c6e),_0x1a52de='62f176f3bb1b5b8e70e39932ad34a0c7',_0x5d9822='VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp';let _0x2ee56a=['',_0x35d192[_0x19c5ac(0x20e)](),'',_0x19c5ac(0x1f8),_0x1dedd1,_0x3279a3?_0x5d9822:_0x1a52de,_0x39ad75,_0x1b6079,_0x1b6079,_0x1b6079,_0x1b6079,_0x1b6079,_0x1b6079,'00',''];const _0x535119=_0x2ee56a['join']('|'),_0x506ffe=calculateHash(_0x535119);_0x2ee56a['splice'](0x1,0x0,_0x506ffe[_0x19c5ac(_0x569af7._0x4ee198)]());const _0x3e8915=_0x2ee56a[_0x19c5ac(_0x569af7._0x5a4b36)]('|');return encryptKkeyCustom(_0x3e8915);}function _0x33a8(_0x35bb70,_0x4b8d5f){_0x35bb70=_0x35bb70-0x1b6;const _0x211a07=_0x211a();let _0x33a80f=_0x211a07[_0x35bb70];if(_0x33a8['VqWtoQ']===undefined){var _0x2c23c3=function(_0x208386){const _0x151968='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x59a0ce='',_0x203ab7='';for(let _0x453c8b=0x0,_0x2f2a38,_0x20f060,_0x9cae8c=0x0;_0x20f060=_0x208386['charAt'](_0x9cae8c++);~_0x20f060&&(_0x2f2a38=_0x453c8b%0x4?_0x2f2a38*0x40+_0x20f060:_0x20f060,_0x453c8b++%0x4)?_0x59a0ce+=String['fromCharCode'](0xff&_0x2f2a38>>(-0x2*_0x453c8b&0x6)):0x0){_0x20f060=_0x151968['indexOf'](_0x20f060);}for(let _0x56f872=0x0,_0x34012e=_0x59a0ce['length'];_0x56f872<_0x34012e;_0x56f872++){_0x203ab7+='%'+('00'+_0x59a0ce['charCodeAt'](_0x56f872)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x203ab7);};_0x33a8['YGbxbP']=_0x2c23c3,_0x33a8['SSMytj']={},_0x33a8['VqWtoQ']=!![];}const _0x335803=_0x211a07[0x0],_0x1cfabf=_0x35bb70+_0x335803,_0xcd96fa=_0x33a8['SSMytj'][_0x1cfabf];return!_0xcd96fa?(_0x33a80f=_0x33a8['YGbxbP'](_0x33a80f),_0x33a8['SSMytj'][_0x1cfabf]=_0x33a80f):_0x33a80f=_0xcd96fa,_0x33a80f;}var TVDB_API_KEY=_0x41778f(0x1de),_tvdbToken=null;function getTvdbToken(){const _0x30ddf1={_0x55feac:0x1c2,_0x1de595:0x1ef,_0x4b528b:0x202,_0x6366e8:0x1eb};return __async(this,null,function*(){const _0x23e951=_0x33a8;if(_tvdbToken)return _tvdbToken;try{var _0x188f48=yield fetch(_0x23e951(_0x30ddf1._0x55feac),{'method':_0x23e951(_0x30ddf1._0x1de595),'headers':{'Content-Type':_0x23e951(_0x30ddf1._0x4b528b)},'body':JSON[_0x23e951(0x1f3)]({'apikey':TVDB_API_KEY})});if(_0x188f48['ok']){var _0x5c03da=yield _0x188f48['json']();if(_0x5c03da&&_0x5c03da['data']&&_0x5c03da['data'][_0x23e951(_0x30ddf1._0x6366e8)])_tvdbToken=_0x5c03da['data']['token'];}}catch(_0x471c75){}return _tvdbToken;});}function getAbsoluteEpisode(_0x376a58,_0x27fbee,_0x360155,_0x345b65,_0x56116e){const _0x402d65={_0x286f2f:0x1f2,_0x545e08:0x1f5,_0x10ae95:0x1d3,_0x4c9dd3:0x1c8,_0x37fa0e:0x1fa,_0x53a830:0x201,_0x3d09f4:0x1c3,_0x291a26:0x1dc,_0x9cff:0x1f2,_0x46f6d6:0x1fd,_0x3e0662:0x205,_0x45d048:0x1cb,_0x2a4d43:0x203};return __async(this,null,function*(){const _0x1f58cd=_0x33a8;if(_0x27fbee==='movie')return 0x1;let _0x206360=_0x345b65,_0x39d892=null,_0x15c5bc=null;try{const _0x148db5=yield fetchJsonSafe(_0x1f58cd(_0x402d65._0x286f2f)+_0x376a58+_0x1f58cd(0x1e4));_0x148db5&&(_0x39d892=_0x148db5['imdb_id'],_0x15c5bc=_0x148db5[_0x1f58cd(_0x402d65._0x545e08)]);}catch(_0x5547f8){}if(!_0x15c5bc&&_0x56116e)try{console['log']('[KissKH]\x20Searching\x20TVDB\x20for\x20series:\x20'+_0x56116e);const _0x3bf16b=yield getTvdbToken();if(_0x3bf16b){const _0x1769ed=yield fetchJsonSafe('https://api4.thetvdb.com/v4/search?query='+encodeURIComponent(_0x56116e),{'headers':{'Authorization':'Bearer\x20'+_0x3bf16b}});if(_0x1769ed&&_0x1769ed[_0x1f58cd(0x1c8)]){const _0xbabbde=_0x1769ed['data']['find'](_0x40f3f5=>_0x40f3f5[_0x1f58cd(0x1bb)]==='series');if(_0xbabbde){const _0x52834d=_0xbabbde['id']||_0xbabbde[_0x1f58cd(_0x402d65._0x545e08)];_0x52834d&&(_0x15c5bc=parseInt(String(_0x52834d)[_0x1f58cd(0x1ff)](/^series-/,''),0xa),console[_0x1f58cd(0x1cb)]('[KissKH]\x20Resolved\x20TVDB\x20ID\x20'+_0x15c5bc+_0x1f58cd(_0x402d65._0x10ae95)));}}}}catch(_0x3853eb){}if(_0x15c5bc)try{console['log']('[KissKH]\x20Attempting\x20TVDB\x20Math\x20for\x20TVDB:\x20'+_0x15c5bc);const _0x190272=yield getTvdbToken();if(_0x190272){const _0xb78462=yield fetchJsonSafe('https://api4.thetvdb.com/v4/series/'+_0x15c5bc+'/episodes/default?season='+_0x360155,{'headers':{'Authorization':'Bearer\x20'+_0x190272}});if(_0xb78462&&_0xb78462[_0x1f58cd(_0x402d65._0x4c9dd3)]&&_0xb78462[_0x1f58cd(0x1c8)][_0x1f58cd(_0x402d65._0x37fa0e)]){const _0x5bcb12=_0xb78462[_0x1f58cd(_0x402d65._0x4c9dd3)][_0x1f58cd(0x1fa)][_0x1f58cd(0x204)](_0x2ff451=>_0x2ff451['seasonNumber']==_0x360155&&_0x2ff451[_0x1f58cd(0x20f)]==_0x345b65);if(_0x5bcb12&&_0x5bcb12[_0x1f58cd(_0x402d65._0x53a830)])return console['log']('[KissKH]\x20TVDB\x20Math\x20calculated\x20absolute\x20episode:\x20'+_0x5bcb12[_0x1f58cd(0x201)]),_0x5bcb12[_0x1f58cd(_0x402d65._0x53a830)];}}}catch(_0x6c50dd){}if(_0x39d892)try{console['log']('[KissKH]\x20Attempting\x20Regex\x20Math\x20for\x20IMDB:\x20'+_0x39d892);const _0x37013b='https://aiometadata.elfhosted.com/stremio/80d082c4-6e99-4c97-a67d-3d9e242685ce/meta/series/'+_0x39d892+'.json',_0x3615bf=yield fetch(_0x37013b);if(_0x3615bf['ok']){const _0xcdf8ab=yield _0x3615bf[_0x1f58cd(_0x402d65._0x3d09f4)]();let _0x35090b=0x0,_0x3d3a0e=![];const _0x541759=/"season"\s*:\s*(\d+)/g;let _0x358dca;while((_0x358dca=_0x541759[_0x1f58cd(_0x402d65._0x291a26)](_0xcdf8ab))!==null){_0x3d3a0e=!![];const _0x95c870=parseInt(_0x358dca[0x1]);_0x95c870>0x0&&_0x95c870<_0x360155&&_0x35090b++;}if(_0x3d3a0e){let _0x512949=_0x35090b+_0x345b65;return console[_0x1f58cd(0x1cb)]('[KissKH]\x20Regex\x20Math\x20calculated\x20absolute\x20episode:\x20'+_0x512949),_0x512949;}}}catch(_0x3dec97){}try{console['log']('[KissKH]\x20Cinemeta/TVDB\x20failed.\x20Falling\x20back\x20to\x20TMDB\x20math...');const _0x3a11b9=_0x1f58cd(_0x402d65._0x9cff)+_0x376a58+'?api_key=1865f43a0549ca50d341dd9ab8b29f49',_0x1da017=yield fetchJsonSafe(_0x3a11b9,{});if(_0x1da017&&_0x1da017[_0x1f58cd(_0x402d65._0x46f6d6)]){let _0x22faea=0x0;const _0x102c12=_0x1da017['seasons']['filter'](_0x2b0773=>_0x2b0773[_0x1f58cd(0x1ee)]>0x0&&_0x2b0773['season_number']<_0x360155);for(let _0x28b8eb of _0x102c12){_0x22faea+=_0x28b8eb[_0x1f58cd(_0x402d65._0x3e0662)];}return _0x22faea+=_0x345b65,console[_0x1f58cd(_0x402d65._0x45d048)](_0x1f58cd(_0x402d65._0x2a4d43)+_0x22faea),_0x22faea;}}catch(_0x234b8b){}return _0x206360;});}function _0x211a(){const _0x30ee7f=['DhLWzq','DgLTzw91Da','yxbWBgLJyxrPB24VANnVBIWGDgv4Dc9WBgfPBIWGkI8Q','CgfYDca','mti2otrAt3fYBMO','l2fWAs9eCMfTyuXPC3qVrxbPC29Kzs8','zMv0y2HtywzLievYCM9YoIa','Ahr0Chm6lY9HCgK0lNrOzxr2zgiUy29Tl3y0l2XVz2LU','Dgv4Da','mJeXntm3ovz2tvzZuW','y2fSBa','mJu1ndy5qMDZEuT5','ohnkuezzBa','zgf0yq','ic0G','ywjZ','Bg9N','Aw5JBhvKzxm','CMvSzwfZzv9KyxrL','l2fWAs9tDwiV','s2LZC0TiigDLDfn0CMvHBxmGy2fSBgvKoIa','C2XPy2u','l2fWAs9eCMfTyuXPC3qVu2vHCMnOp3e9','AgvHzgvYCW','igzYB20GC2vHCMnO','mZC3nZnZshjYvhm','Ahr0Chm6lY9RAxnZA2GUBMW','A2LZC2TO','ndGZmdiWmq','CgfYC2u','nMPvtLLYDG','zMLYC3rFywLYx2rHDgu','BgvUz3rO','zxHLyW','l2fWAs9eCMfTyuXPC3qVrhjHBweV','nZC3mtqWzMiTzgu5mI00ndbHlwfLyZiTotvLyJuXztjKn2fI','BwvZC2fNzq','mZC2otK1meDlr1jVAG','zxHWB3j0CW','nhbRufzvza','ChvZAa','l2v4DgvYBMfSx2LKCZ9HCgLFA2v5pte4nJvMndnHmdu0ownHntbKmZqXzgq5ywi4yJi5zJq5','B3jPz2LUywXFDgL0Bgu','vxnLCI1bz2vUDa','BgfUza','zg9Uzq','DgHLBG','zMv0y2HkC29Uu2fMzsbqyxjZzsbfCNjVCJOG','Dg9Rzw4','mJK0mteYmNbLu3z4Cq','yMvOyxzPB3jiAw50CW','C2vHC29Ux251BwjLCG','ue9tva','BMfTzq','ChjVDg90ExbL','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','C3rYAw5NAwz5','ntaWzLnTD3HZ','DhzKyL9Pza','C3bSAxq','mJy4nJuYn0Lkwxj6qW','BwCZyZnImdrIyq','vgHPCMrqyxj0Eq','zxbPC29Kzxm','w0TPC3nlsf0GrxH0CMfJDgvKievWrgf0ysbMB3iGsuqG','mJu3mtz6rw9fveO','C2vHC29UCW','DgL0Bgu','CMvWBgfJzq','AxnbCNjHEq','ywjZB2X1DgvoDw1Izxi','yxbWBgLJyxrPB24VANnVBG','w0TPC3nlsf0Gve1eqIbdywXJDwXHDgvKigfIC29SDxrLigvWAxnVzgu6ia','zMLUza','zxbPC29Kzv9JB3vUDa','y2HHCKnVzgvbDa','CM91BMq','AM9PBG','vMLKzw8','B3jPz2LUywXFBMfTzq','ChjVCgvYDhLjC0vUDw1LCMfIBgu','w0TPC3nlsf0Gz2v0qwjZB2X1DgvfCgLZB2rLigzHAwXLza','C2vYAwvZ','Dg9tDhjPBMC','BNvTyMvY','Dw5KzwzPBMvK','rMv0y2HPBMCGve1eqJOG','z2v0u3rYzwfTCW','DhjPBq','p2LZCt1MywXZzq'];_0x211a=function(){return _0x30ee7f;};return _0x211a();}function getStreams(_0x3411f4,_0x52e66b,_0x436708,_0x45c632){const _0x403cbe={_0x388941:0x1cb,_0x512637:0x1b7,_0x151138:0x1fe,_0x239a35:0x1f6,_0x43dfcf:0x1cd,_0x36b911:0x1f6,_0xc4d2b7:0x1d1,_0x3d265b:0x1db,_0x1f380f:0x1ca,_0x5c953d:0x1c9,_0x2ce025:0x1cc,_0x1c1682:0x1dd,_0x1559e3:0x20c,_0x38c3ef:0x1fa,_0x3e5173:0x204,_0x58a936:0x1c0,_0x512e3f:0x209,_0x485191:0x1f9,_0x7ed64a:0x1e6,_0x25b9d5:0x1ed,_0xb1c863:0x1e7,_0x406afe:0x1e3};return __async(this,null,function*(){const _0x560832=_0x33a8;let _0x5ec7ea=[];console[_0x560832(_0x403cbe._0x388941)](_0x560832(0x1cf)+_0x3411f4+'\x20'+_0x52e66b);const _0x84538d='https://api.themoviedb.org/3/'+_0x52e66b+'/'+_0x3411f4+'?api_key=1865f43a0549ca50d341dd9ab8b29f49';console['log'](_0x560832(_0x403cbe._0x512637)+_0x84538d);const _0x25cc21=yield fetchJsonSafe(_0x84538d);if(!_0x25cc21)return console['log']('TMDB\x20fetch\x20failed\x20or\x20returned\x20null!'),[];const _0x2f429c=_0x25cc21[_0x560832(_0x403cbe._0x151138)]||_0x25cc21[_0x560832(0x1f0)]||_0x25cc21[_0x560832(0x1e5)]||_0x25cc21[_0x560832(0x20a)],_0x51e879=_0x2f429c[_0x560832(_0x403cbe._0x239a35)](':')[0x0][_0x560832(0x1f6)]('-')[0x0][_0x560832(0x1b9)]();console[_0x560832(0x1cb)]('TMDB\x20Base\x20Title:\x20'+_0x51e879);let _0x49e7a6='';if(_0x25cc21[_0x560832(0x1cd)])_0x49e7a6=_0x25cc21[_0x560832(_0x403cbe._0x43dfcf)][_0x560832(0x1f6)]('-')[0x0];else{if(_0x25cc21['first_air_date'])_0x49e7a6=_0x25cc21[_0x560832(0x1da)][_0x560832(_0x403cbe._0x36b911)]('-')[0x0];}let _0x130d21=KISSKH_BASE+'/api/DramaList/Search?q='+encodeURIComponent(_0x2f429c)+'&type=0',_0x10b507=yield fetchJsonSafe(_0x130d21);(!_0x10b507||!Array['isArray'](_0x10b507)||_0x10b507['length']===0x0)&&(_0x130d21=KISSKH_BASE+_0x560832(_0x403cbe._0xc4d2b7)+encodeURIComponent(_0x51e879)+'&type=0',_0x10b507=yield fetchJsonSafe(_0x130d21));if(!_0x10b507||!Array['isArray'](_0x10b507)||_0x10b507[_0x560832(_0x403cbe._0x3d265b)]===0x0)return[];let _0x434356=null,_0x3a948e=null,_0x1ab80b=null,_0x3b0abe=null;const _0x1a6516=_0x52e66b==='tv'||_0x52e66b===_0x560832(0x20d);for(let _0x2dcdc3=0x0;_0x2dcdc3<_0x10b507['length'];_0x2dcdc3++){let _0xad4610=_0x10b507[_0x2dcdc3],_0x157f10=(_0xad4610[_0x560832(0x1fe)]||'')['toLowerCase'](),_0x2c0fd2=_0x2f429c['toLowerCase'](),_0x19c755=_0x51e879['toLowerCase'](),_0x46a5e1=!![];if(_0x49e7a6){let _0x5a8e1f=_0x157f10['match'](/\((20\d\d|19\d\d)\)/);_0x5a8e1f&&(Math[_0x560832(_0x403cbe._0x1f380f)](parseInt(_0x5a8e1f[0x1])-parseInt(_0x49e7a6))>0x1&&(_0x46a5e1=![]));}if(!_0x46a5e1)continue;if(_0x1a6516&&_0x436708){let _0x4657f3='season\x20'+_0x436708,_0x29bd11=_0x560832(0x1be)+_0x436708,_0x20b753=_0x2c0fd2+'\x20'+_0x436708,_0x25e8c0=_0x2c0fd2+'\x20'+_0x4657f3,_0x575036=_0x2c0fd2+_0x560832(_0x403cbe._0x5c953d)+_0x4657f3,_0x29aff7=_0x2c0fd2+':\x20'+_0x4657f3;if(_0x157f10===_0x20b753||_0x157f10===_0x25e8c0||_0x157f10===_0x575036||_0x157f10===_0x29aff7){_0x434356=_0xad4610;break;}if((_0x157f10['includes'](_0x4657f3)||_0x157f10['includes'](_0x29bd11))&&(_0x157f10['includes'](_0x2c0fd2)||_0x157f10['includes'](_0x19c755))){if(!_0x1ab80b)_0x1ab80b=_0xad4610;}}if(_0x157f10===_0x2c0fd2||_0x157f10===_0x19c755||_0x157f10===_0x2c0fd2+'\x20('+_0x49e7a6+')')_0x3a948e=_0xad4610;else{if(_0x157f10['includes'](_0x2c0fd2)||_0x157f10[_0x560832(_0x403cbe._0x2ce025)](_0x19c755)){if(!_0x3b0abe)_0x3b0abe=_0xad4610;}}}let _0x5d6ae9=_0x434356||_0x3a948e||_0x1ab80b||_0x3b0abe;if(!_0x5d6ae9||!_0x5d6ae9['id'])return[];const _0x4a3f73=_0x5d6ae9['id'],_0x3c4cbb=KISSKH_BASE+_0x560832(_0x403cbe._0x1c1682)+_0x4a3f73+_0x560832(0x1ba),_0x3c374d=yield fetchJsonSafe(_0x3c4cbb);if(!_0x3c374d||!_0x3c374d['episodes']||_0x3c374d[_0x560832(0x1fa)]['length']===0x0)return[];let _0x1e8ba7=null,_0x5f5971=parseInt(_0x45c632);if(_0x1a6516&&_0x436708&&parseInt(_0x436708)>0x1&&_0x5d6ae9===_0x3a948e)try{_0x5f5971=yield getAbsoluteEpisode(_0x3411f4,_0x52e66b,parseInt(_0x436708),parseInt(_0x45c632),_0x2f429c);}catch(_0x1a2423){console[_0x560832(_0x403cbe._0x388941)](_0x560832(_0x403cbe._0x1559e3),_0x1a2423);}_0x1a6516&&_0x45c632?_0x1e8ba7=_0x3c374d[_0x560832(_0x403cbe._0x38c3ef)][_0x560832(_0x403cbe._0x3e5173)](_0x3f137a=>Math[_0x560832(0x207)](_0x3f137a['number']||0x0)===_0x5f5971):_0x1e8ba7=_0x3c374d['episodes'][0x0];if(!_0x1e8ba7||!_0x1e8ba7['id'])return[];const _0x1910e9=_0x1e8ba7['id']['toString'](),_0x5d0fff=generateKkey(_0x1910e9,![]),_0x4e626a=generateKkey(_0x1910e9,!![]),_0x3d5ad2=KISSKH_BASE+_0x560832(_0x403cbe._0x58a936)+_0x1910e9+'.png?err=false&ts=&time=&kkey='+_0x5d0fff,_0xb7076a=yield fetchJsonSafe(_0x3d5ad2);if(_0xb7076a){console['log'](_0x560832(0x1fb)+_0x1910e9+':\x20'+JSON[_0x560832(0x1f3)](_0xb7076a));const _0x33ce47=_0xb7076a[_0x560832(_0x403cbe._0x512e3f)]||_0xb7076a[_0x560832(_0x403cbe._0x485191)];console[_0x560832(0x1cb)]('[KissKH]\x20Selected\x20Video\x20URL:\x20'+_0x33ce47);if(_0x33ce47){const _0x45143c=_0x33ce47['indexOf']('.m3u8')!==-0x1;let _0x1e65ab={'name':'KissKH\x20-\x20Ep\x20'+Math['round'](_0x1e8ba7['number']||0x0),'title':'Auto','size':_0x5d6ae9['title'],'url':_0x33ce47,'quality':'HD'};const _0x42432c={'User-Agent':HEADERS[_0x560832(_0x403cbe._0x7ed64a)],'Referer':KISSKH_BASE+'/','Origin':KISSKH_BASE};_0x45143c?_0x1e65ab[_0x560832(0x1d2)]=_0x42432c:_0x1e65ab[_0x560832(_0x403cbe._0x25b9d5)]={'proxyHeaders':{'request':_0x42432c}},_0x5ec7ea['push'](_0x1e65ab);}}let _0x1ab0ea=[];const _0x1dd961=KISSKH_BASE+_0x560832(0x1ce)+_0x1910e9+'?kkey='+_0x4e626a,_0x50ba98=yield fetchJsonSafe(_0x1dd961);if(_0x50ba98&&Array[_0x560832(0x200)](_0x50ba98))for(const _0x3c5da3 of _0x50ba98){_0x3c5da3['src']&&_0x3c5da3[_0x560832(_0x403cbe._0xb1c863)]&&_0x1ab0ea[_0x560832(_0x403cbe._0x406afe)]({'url':_0x3c5da3['src'],'language':_0x3c5da3[_0x560832(0x1e7)]});}return _0x5ec7ea['length']>0x0&&_0x1ab0ea['length']>0x0&&(_0x5ec7ea[0x0]['subtitles']=_0x1ab0ea),_0x5ec7ea;});}typeof module!==_0x41778f(0x1b6)&&module['exports']?module[_0x41778f(0x1e1)]={'getStreams':getStreams}:global[_0x41778f(0x1b8)]=getStreams;

/* CLOUDBANK_MERGED_ENGINE_END:kisskh-v2 */
  })(embedded, embedded.exports, portableRequire, cloudbankMergedBudgetFetch(cloudbankMergedMetadataFetch(fetch), deadline), typeof globalThis !== "undefined" ? globalThis : global);
  return Object.assign({}, embedded.exports);
  }
  var settingsProvider = createEngine(Date.now() + 6000);
  return Object.assign({}, settingsProvider, { getStreams: function() {
    // A fresh request scope prevents an expired scan from borrowing a later scan's deadline.
    var engine = createEngine(Date.now() + 6000);
    return engine.getStreams.apply(engine, arguments);
  } });
})() });
module.exports = cloudbankVersionMerge(cloudbankMergedEngines, "kisskh");
if (typeof globalThis !== "undefined") { globalThis.getStreams = module.exports.getStreams; if (module.exports.onSettings) globalThis.onSettings = module.exports.onSettings; }

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
