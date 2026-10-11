"use strict";

/* VUEO_PROVIDER_REPAIR_V16 */

var PROVIDER_NAME = "MovieBox";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var MOVIEBOX_WEB = "https://moviebox.asia";

var WEB_HOSTS = [
  "https://moviebox.ph",
  "https://moviebox.pk",
  "https://moviebox.ng",
  "https://filmboom.top"
];

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var COMMON_HEADERS = {
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Client-Info": "{\"timezone\":\"Asia/Kuala_Lumpur\"}",
  "User-Agent": USER_AGENT
};

var PROVIDER_BUDGET_MS = 19000;
var WEBVIEW_BUDGET_MS = 5200;
var SEARCH_COLLECT_MS = 4300;
var DETAIL_RACE_MS = 3400;
var PLAY_COLLECT_MS = 5600;
var CAPTION_COLLECT_MS = 3400;

var preferredWebHost = null;
var unhealthyWebHosts = Object.create(null);

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
      reject(new Error((label || "Operation") + " timed out"));
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

function firstNonEmptyStreams(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var settled = false;
    var pending = tasks.length;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(value) ? value : []);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (settled) return;

          if (Array.isArray(value) && value.length) {
            finish(value);
            return;
          }

          pending -= 1;
          if (pending <= 0) finish([]);
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish([]);
        });
    });

    setTimeout(function() {
      finish([]);
    }, timeoutMs);
  });
}

function raceFirstValid(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve(null);
  }

  return new Promise(function(resolve) {
    var settled = false;
    var pending = tasks.length;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value || null);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (settled) return;

          if (value) {
            finish(value);
            return;
          }

          pending -= 1;
          if (pending <= 0) finish(null);
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish(null);
        });
    });

    setTimeout(function() {
      finish(null);
    }, timeoutMs);
  });
}

function collectSettled(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var results = [];
    var pending = tasks.length;
    var settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      resolve(results);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (value) results.push(value);
        })
        .catch(function() {})
        .then(function() {
          pending -= 1;
          if (pending <= 0) finish();
        });
    });

    setTimeout(finish, timeoutMs);
  });
}

function fetchJson(url, options, timeoutMs, label) {
  var opts = options || {};

  var headers = Object.assign(
    {},
    COMMON_HEADERS,
    opts.headers || {}
  );

  var fetchOptions = {
    method: opts.method || "GET",
    headers: headers,
    redirect: "follow"
  };

  if (opts.body !== undefined) {
    fetchOptions.body = opts.body;
  }

  return withSoftTimeout(
    fetch(url, fetchOptions).then(function(response) {
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
    timeoutMs || 3200,
    label || "MovieBox request"
  );
}

function getTmdbInfo(tmdbId, mediaType) {
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
        {
          headers: {
            "Accept": "application/json"
          }
        },
        1300,
        "TMDB"
      );
    }
  ).then(function(data) {
    return {
      title:
        String(
          data &&
          (data.title || data.name) ||
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

  if (!leftWords.length || !rightWords.length) {
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


/* VUEO_DISCOVERY_REBUILD_V1 */
function cleanDiscoveryTitleMovieBox(value) {
  return normalizeTitle(
    String(value || "")
      .replace(/\[(?:[^\]]{0,120})\]/g, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .replace(/\bseason\s*\d{1,2}\b/gi, " ")
      .replace(/\bs\d{1,2}\b/gi, " ")
      .replace(/\b(?:ep|episode|e)\s*[-#:]?\s*\d{1,3}\b/gi, " ")
      .replace(/\b(?:2160p|1080p|720p|480p|4k|web[- ]?dl|bluray|hevc|h26[45]|10bit|series|movie)\b/gi, " ")
  );
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
  var cleanCandidate =
    cleanDiscoveryTitleMovieBox(
      candidate
    );

  aliases.forEach(function(alias) {
    var cleanAlias =
      cleanDiscoveryTitleMovieBox(
        alias
      );

    best = Math.max(
      best,
      titleScore(
        candidate,
        alias
      )
    );

    if (
      cleanCandidate &&
      cleanAlias
    ) {
      if (cleanCandidate === cleanAlias) {
        best = Math.max(
          best,
          100
        );
      } else if (
        cleanCandidate.indexOf(cleanAlias) !== -1 ||
        cleanAlias.indexOf(cleanCandidate) !== -1
      ) {
        best = Math.max(
          best,
          92
        );
      } else {
        best = Math.max(
          best,
          titleScore(
            cleanCandidate,
            cleanAlias
          )
        );
      }
    }
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

function itemYear(item) {
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

  return match ? match[0] : "";
}

function typeMatches(item, mediaType) {
  var type =
    Number(
      item &&
      (
        item.subjectType !== undefined
          ? item.subjectType
          : item.subject_type
      )
    );

  if (!type) return true;

  return mediaType === "movie"
    ? type === 1
    : type !== 1;
}

function extractSearchItems(payload) {
  var queue = [payload];
  var seen = [];
  var depth = 0;

  while (queue.length && depth < 24) {
    var value = queue.shift();
    depth += 1;
    if (!value || typeof value !== "object") continue;
    if (seen.indexOf(value) !== -1) continue;
    seen.push(value);

    if (Array.isArray(value)) {
      if (value.length && value.some(function(item) {
        return item && typeof item === "object" &&
          (item.subjectId || item.subject_id || item.title || item.name);
      })) return value;
      value.forEach(function(item) { if (item && typeof item === "object") queue.push(item); });
      continue;
    }

    ["items", "subjectList", "subjects", "list", "results", "records", "content"].forEach(function(key) {
      if (value[key] && typeof value[key] === "object") queue.push(value[key]);
    });
    if (value.data && typeof value.data === "object") queue.push(value.data);
    if (value.result && typeof value.result === "object") queue.push(value.result);
  }

  return [];
}

function scoreCandidate(item, info, mediaType) {
  var score =
    bestAliasTitleScore(
      item && item.title,
      info
    );

  var year =
    itemYear(item);

  if (
    info.year &&
    year
  ) {
    if (String(info.year) === String(year)) {
      score += 24;
    } else {
      /*
       * TV mirrors sometimes expose the latest-season year instead of the
       * original first-air year. Treat year as a preference, not a hard miss.
       */
      score -=
        mediaType === "tv"
          ? 8
          : 24;
    }
  }

  if (typeMatches(item, mediaType)) {
    score += 22;
  } else {
    score -= 80;
  }

  return score;
}

function orderedHosts(seedHost) {
  var output = [];

  function add(host) {
    var value =
      String(host || "")
        .replace(/\/+$/, "");

    if (
      !value ||
      output.indexOf(value) !== -1
    ) {
      return;
    }

    output.push(value);
  }

  add(seedHost);
  add(preferredWebHost);

  WEB_HOSTS.forEach(function(host) {
    var normalized = String(host || "").replace(/\/+$/, "");
    if (!unhealthyWebHosts[normalized]) add(host);
  });

  return output;
}

function searchHost(host, query) {
  var body =
    JSON.stringify({
      keyword:
        String(query || "").trim(),
      page: 1,
      perPage: 24,
      subjectType: 0
    });

  return fetchJson(
    host +
      "/wefeed-h5-bff/web/subject/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": host + "/"
      },
      body: body
    },
    3800,
    "MovieBox search " + host
  ).then(function(payload) {
    var normalizedHost = String(host || "").replace(/\/+$/, "");
    delete unhealthyWebHosts[normalizedHost];
    return {
      host: host,
      items: extractSearchItems(payload)
    };
  }).catch(function(error) {
    var normalizedHost = String(host || "").replace(/\/+$/, "");
    unhealthyWebHosts[normalizedHost] = true;
    vueoCandidateTrace("HOST_DEAD", {
      host: normalizedHost,
      error: error && error.message ? error.message : String(error)
    });
    throw error;
  });
}

function collectAllSearchResults(query) {
  return collectSettled(
    orderedHosts().map(function(host) {
      return searchHost(
        host,
        query
      );
    }),
    SEARCH_COLLECT_MS
  );
}

function chooseAcrossMirrors(
  searchResults,
  info,
  mediaType
) {
  var candidates = [];

  (searchResults || []).forEach(
    function(result) {
      (result.items || []).forEach(
        function(item, index) {
          if (
            !item ||
            !(item.subjectId || item.subject_id || item.id)
          ) {
            return;
          }

          if (!item.subjectId) item.subjectId = item.subject_id || item.id;
          if (!item.title) item.title = item.name || item.subjectName || item.subject_name || "";
          candidates.push({
            host: result.host,
            item: item,
            score:
              scoreCandidate(
                item,
                info,
                mediaType
              ) +
              Math.max(
                0,
                5 - index
              )
          });
        }
      );
    }
  );

  candidates.sort(function(a, b) {
    return b.score - a.score;
  });

  vueoCandidateTrace("CANDIDATE", {
    count: candidates.length,
    title: candidates.length && candidates[0].item ? (candidates[0].item.title || "") : "",
    score: candidates.length ? candidates[0].score : 0
  });

  if (!candidates.length) {
    return null;
  }

  /*
   * Exact or partial title relation is enough. Do not use the old high
   * confidence gate. If MovieBox itself returned the queried title, year and
   * type bonuses make the intended result naturally win.
   */
  if (candidates[0].score < 22) {
    console.log(
      "[MovieBox] H5 weak candidate title=" +
      String(
        candidates[0].item &&
        candidates[0].item.title ||
        ""
      ) +
      " score=" +
      candidates[0].score
    );
    return null;
  }

  return candidates[0];
}

function searchH5(
  info,
  mediaType
) {
  var queries =
    buildAliasQueries(
      info,
      7
    );

  var primary =
    queries[0] ||
    info.title;

  return collectAllSearchResults(
    primary
  ).then(function(results) {
    var best =
      chooseAcrossMirrors(
        results,
        info,
        mediaType
      );

    if (best) return best;

    var fallbackQueries =
      queries
        .slice(1, 4);

    if (!fallbackQueries.length) {
      return null;
    }

    /*
     * Alias fallback uses only the two healthiest ordered mirrors instead of
     * querying every alias on all four hosts. This fixes alternate-title
     * matching without turning a miss into a 20 second provider timeout.
     */
    var hosts =
      orderedHosts()
        .slice(0, 2);

    var tasks = [];

    fallbackQueries.forEach(
      function(query) {
        hosts.forEach(function(host) {
          tasks.push(
            searchHost(
              host,
              query
            ).then(function(result) {
              result.query = query;
              return result;
            })
          );
        });
      }
    );

    return collectSettled(
      tasks,
      5200
    ).then(function(extra) {
      var aliasBest =
        chooseAcrossMirrors(
          extra,
          info,
          mediaType
        );

      if (!aliasBest) {
        console.log(
          "[MovieBox] H5 aliases exhausted count=" +
          fallbackQueries.length
        );
      }

      return aliasBest;
    });
  });
}
function raceDetailHosts(
  subjectId,
  seedHost
) {
  return raceFirstValid(
    orderedHosts(seedHost).map(
      function(host) {
        return fetchJson(
          host +
            "/wefeed-h5-bff/web/subject/detail?subjectId=" +
            encodeURIComponent(subjectId),
          {
            headers: {
              "Referer": host + "/"
            }
          },
          3000,
          "MovieBox detail " + host
        ).then(function(payload) {
          var data =
            payload &&
            payload.data &&
            typeof payload.data === "object"
              ? payload.data
              : null;

          if (
            !data ||
            !data.subject
          ) {
            return null;
          }

          return {
            host: host,
            subject: data.subject
          };
        });
      }
    ),
    DETAIL_RACE_MS
  );
}

function buildPlayReferer(
  host,
  item,
  subjectId
) {
  var detailPath =
    String(
      item &&
      (
        item.detailPath ||
        item.detail_path
      ) ||
      ""
    )
      .trim()
      .replace(/^\/+/, "");

  if (!detailPath) {
    return host + "/";
  }

  return (
    host +
    "/spa/videoPlayPage/movies/" +
    detailPath +
    "?id=" +
    encodeURIComponent(subjectId) +
    "&type=/movie/detail&lang=en"
  );
}

function extractStreams(payload) {
  var data =
    payload &&
    payload.data &&
    typeof payload.data === "object"
      ? payload.data
      : {};

  return Array.isArray(data.streams)
    ? data.streams
    : [];
}

function collectPlayHosts(
  item,
  mediaType,
  season,
  episode,
  seedHost
) {
  var subjectId =
    String(
      item &&
      item.subjectId ||
      ""
    ).trim();

  if (!subjectId) {
    return Promise.resolve([]);
  }

  var se =
    mediaType === "tv"
      ? Number(season || 1)
      : 0;

  var ep =
    mediaType === "tv"
      ? Number(episode || 1)
      : 0;

  var tasks =
    orderedHosts(seedHost).map(
      function(host) {
        var referer =
          buildPlayReferer(
            host,
            item,
            subjectId
          );

        var url =
          host +
          "/wefeed-h5-bff/web/subject/play" +
          "?subjectId=" +
          encodeURIComponent(subjectId) +
          "&se=" +
          encodeURIComponent(se) +
          "&ep=" +
          encodeURIComponent(ep);

        return fetchJson(
          url,
          {
            headers: {
              "Referer": referer
            }
          },
          4400,
          "MovieBox play " + host
        ).then(function(payload) {
          var streams =
            extractStreams(payload)
              .filter(function(source) {
                return (
                  source &&
                  String(
                    source.url || ""
                  ).trim()
                );
              });

          if (!streams.length) {
            return null;
          }

          return {
            host: host,
            referer: referer,
            subjectId: subjectId,
            streams: streams
          };
        });
      }
    );

  return collectSettled(
    tasks,
    PLAY_COLLECT_MS
  ).then(function(results) {
    var seen = {};
    var output = [];

    results.forEach(function(result) {
      if (!result) return;

      result.streams.forEach(function(stream) {
        var url =
          String(
            stream &&
            stream.url ||
            ""
          ).trim();

        if (!url || seen[url]) {
          return;
        }

        seen[url] = true;

        output.push({
          host: result.host,
          referer: result.referer,
          subjectId: result.subjectId,
          stream: stream
        });
      });
    });

    if (output.length) {
      preferredWebHost =
        output[0].host;
    }

    return output;
  });
}
function subtitleLanguage(caption) {
  var values = [
    caption && caption.lan,
    caption && caption.lanName
  ]
    .filter(Boolean)
    .map(function(value) {
      return String(value)
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");
    });

  function has(valuesToFind) {
    return values.some(function(value) {
      return valuesToFind.some(
        function(needle) {
          return (
            value === needle ||
            value.indexOf(needle) !== -1
          );
        }
      );
    });
  }

  if (
    has([
      "ms",
      "msa",
      "may",
      "malay",
      "bahasa melayu",
      "bahasa malaysia"
    ])
  ) {
    return {
      code: "ms",
      label: "Malay"
    };
  }

  if (
    has([
      "en",
      "eng",
      "english"
    ])
  ) {
    return {
      code: "en",
      label: "English"
    };
  }

  if (
    has([
      "id",
      "ind",
      "indonesian",
      "bahasa indonesia"
    ])
  ) {
    return {
      code: "id",
      label: "Indonesian"
    };
  }

  return null;
}

function loadCaptions(
  resolvedStreams
) {
  var streams =
    Array.isArray(resolvedStreams)
      ? resolvedStreams
      : [];

  if (!streams.length) {
    return Promise.resolve([]);
  }

  var subjectId =
    String(
      streams[0].subjectId || ""
    ).trim();

  if (!subjectId) {
    return Promise.resolve([]);
  }

  var seedSeen = {};
  var seeds = [];

  streams.forEach(function(resolved) {
    var source =
      resolved &&
      resolved.stream;

    var id =
      String(
        source &&
        source.id ||
        ""
      ).trim();

    var format =
      String(
        source &&
        source.format ||
        ""
      ).trim();

    if (!id || !format) {
      return;
    }

    var key =
      id + "\u0000" + format;

    if (seedSeen[key]) {
      return;
    }

    seedSeen[key] = true;

    seeds.push({
      id: id,
      format: format,
      host: resolved.host
    });
  });

  if (!seeds.length) {
    return Promise.resolve([]);
  }

  var tasks = [];

  seeds.forEach(function(seed) {
    orderedHosts(seed.host).forEach(
      function(host) {
        var url =
          host +
          "/wefeed-h5-bff/web/subject/caption" +
          "?format=" +
          encodeURIComponent(seed.format) +
          "&id=" +
          encodeURIComponent(seed.id) +
          "&subjectId=" +
          encodeURIComponent(subjectId);

        tasks.push(
          fetchJson(
            url,
            {
              headers: {
                "Referer": host + "/"
              }
            },
            2800,
            "MovieBox caption " + host
          ).then(function(payload) {
            var data =
              payload &&
              payload.data &&
              typeof payload.data === "object"
                ? payload.data
                : {};

            return Array.isArray(data.captions)
              ? data.captions
              : [];
          })
        );
      }
    );
  });

  return collectSettled(
    tasks,
    CAPTION_COLLECT_MS
  ).then(function(results) {
    var seen = {};
    var captions = [];

    results.forEach(function(group) {
      (Array.isArray(group) ? group : [])
        .forEach(function(caption) {
          var url =
            String(
              caption &&
              caption.url ||
              ""
            ).trim();

          if (
            !url ||
            seen[url] ||
            !subtitleLanguage(caption)
          ) {
            return;
          }

          seen[url] = true;
          captions.push(caption);
        });
    });

    return captions;
  });
}
function qualityNumber(value) {
  var text =
    String(value || "")
      .toLowerCase();

  if (text.indexOf("4k") !== -1) {
    return 2160;
  }

  var match =
    text.match(/(\d{3,4})/);

  return match
    ? Number(match[1]) || 0
    : 0;
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

  var q =
    qualityNumber(value);

  return q
    ? q + "p"
    : "Auto";
}

function sanitiseHeaders(
  input,
  fallbackReferer
) {
  var source =
    input &&
    typeof input === "object"
      ? input
      : {};

  var output = {};

  Object.keys(source).forEach(
    function(key) {
      var lower =
        String(key || "")
          .toLowerCase();

      if (
        lower === "host" ||
        lower === "connection" ||
        lower === "content-length" ||
        lower === "accept-encoding" ||
        lower === "range" ||
        lower === "origin" ||
        lower.indexOf("sec-fetch-") === 0
      ) {
        return;
      }

      output[key] =
        String(source[key]);
    }
  );

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
    fallbackReferer;

  return output;
}

function buildSubtitleFiles(captions) {
  var seen = {};

  return (captions || [])
    .map(function(caption) {
      var url =
        String(
          caption &&
          caption.url ||
          ""
        ).trim();

      var language =
        subtitleLanguage(caption);

      if (
        !url ||
        !language ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      return {
        label: language.label,
        language: language.label,
        lang: language.code,
        url: url,
        default: false,
        format:
          url.toLowerCase().indexOf(".srt") !== -1
            ? "srt"
            : url.toLowerCase().indexOf(".vtt") !== -1
              ? "vtt"
              : ""
      };
    })
    .filter(Boolean);
}

function buildH5Output(
  resolvedStreams,
  captions,
  info,
  mediaType,
  season,
  episode
) {
  var subtitles =
    buildSubtitleFiles(captions);

  var suffix =
    mediaType === "tv"
      ? " S" +
        String(season || 1).padStart(2, "0") +
        "E" +
        String(episode || 1).padStart(2, "0")
      : "";

  return (resolvedStreams || [])
    .slice()
    .sort(function(a, b) {
      return (
        qualityNumber(
          b &&
          b.stream &&
          b.stream.resolutions
        ) -
        qualityNumber(
          a &&
          a.stream &&
          a.stream.resolutions
        )
      );
    })
    .map(function(resolved) {
      var source =
        resolved &&
        resolved.stream;

      var url =
        String(
          source &&
          source.url ||
          ""
        ).trim();

      if (!url) {
        return null;
      }

      var quality =
        inferQuality(
          url,
          source &&
          (
            source.resolutions ||
            source.resolution ||
            source.quality
          )
        );

      return {
        name:
          PROVIDER_NAME +
          " " +
          quality,
        title:
          (info.title || PROVIDER_NAME) +
          suffix,
        url: url,
        quality: quality,
        type: "direct",
        subtitles: subtitles,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer":
            resolved.referer ||
            resolved.host + "/"
        }
      };
    })
    .filter(Boolean);
}
function resolveH5(
  info,
  mediaType,
  season,
  episode
) {
  var selectedItem;
  var selectedHost;

  return searchH5(
    info,
    mediaType
  )
    .then(function(match) {
      if (!match) {
        throw new Error(
          "MovieBox H5 mirrors returned no matching title"
        );
      }

      selectedItem =
        Object.assign(
          {},
          match.item
        );

      selectedHost =
        match.host;

      preferredWebHost =
        match.host;

      console.log(
        "[MovieBox] H5 selected host=" +
        match.host +
        " title=" +
        selectedItem.title +
        " score=" +
        match.score
      );

      if (
        selectedItem.detailPath ||
        selectedItem.detail_path
      ) {
        return null;
      }

      return raceDetailHosts(
        selectedItem.subjectId,
        selectedHost
      );
    })
    .then(function(detail) {
      if (
        detail &&
        detail.subject
      ) {
        selectedItem =
          Object.assign(
            {},
            selectedItem,
            detail.subject
          );

        selectedHost =
          detail.host;

        preferredWebHost =
          detail.host;
      }

      return collectPlayHosts(
        selectedItem,
        mediaType,
        season,
        episode,
        selectedHost
      );
    })
    .then(function(resolvedStreams) {
      if (!resolvedStreams.length) {
        throw new Error(
          "MovieBox H5 returned no playable streams"
        );
      }

      return loadCaptions(
        resolvedStreams
      )
        .catch(function() {
          return [];
        })
        .then(function(captions) {
          return buildH5Output(
            resolvedStreams,
            captions,
            info,
            mediaType,
            season,
            episode
          );
        });
    })
    .catch(function(error) {
      console.log(
        "[MovieBox] H5 path failed: " +
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
function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function buildMovieBoxWatchUrl(
  tmdbId,
  mediaType,
  season,
  episode
) {
  if (mediaType === "tv") {
    return (
      MOVIEBOX_WEB +
      "/watch/tv/" +
      encodeURIComponent(tmdbId) +
      "/"
    );
  }

  return (
    MOVIEBOX_WEB +
    "/watch/movie/" +
    encodeURIComponent(tmdbId) +
    "/"
  );
}

function resolveMovieBoxWebsite(
  tmdbId,
  info,
  mediaType,
  season,
  episode
) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  var watchUrl =
    buildMovieBoxWatchUrl(
      tmdbId,
      mediaType,
      season,
      episode
    );

  /*
   * On the real MovieBox watch page the first server is "Zen" and MovieBox
   * exposes a Change Server control for additional mirrors. Repeated
   * interaction ticks therefore do useful work instead of repeatedly trying
   * the same homepage search control.
   */
  var interactions = [
    "play",
    "continue",
    "watch",
    "change server",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ];

  if (mediaType === "tv") {
    interactions.unshift(
      "episode " + Number(episode || 1),
      "season " + Number(season || 1)
    );
  }

  console.log(
    "[MovieBox] Native watch page=" +
    watchUrl
  );

  return globalThis.webviewResolve(
    watchUrl,
    {
      referer:
        MOVIEBOX_WEB + "/",
      directLoad: true,
      timeoutMs:
        WEBVIEW_BUDGET_MS,
      finishAfterFirstMs: 500,
      suppressPopups: true,
      lockMainFrameHost: true,
      interactionTexts:
        interactions,
      clickDelaysMs: [
        700,
        1500,
        2600,
        3900,
        4900
      ],
      match: [
        ".m3u8",
        ".mp4",
        ".m4v",
        "/sora/"
      ],
      blocked: [
        "doubleclick",
        "googlesyndication",
        "/vast"
      ],
      injectAbyssHook: true
    }
  ).then(function(result) {
    var captured =
      result &&
      Array.isArray(result.streams)
        ? result.streams
        : [];

    var seen = {};

    var output =
      captured
        .filter(function(item) {
          var url =
            String(
              item &&
              item.url ||
              ""
            ).toLowerCase();

          return (
            url.indexOf(".m3u8") !== -1 ||
            url.indexOf(".mp4") !== -1 ||
            url.indexOf(".m4v") !== -1 ||
            url.indexOf("/sora/") !== -1
          );
        })
        .filter(function(item) {
          var url =
            String(item.url);

          if (seen[url]) {
            return false;
          }

          seen[url] = true;
          return true;
        })
        .map(function(item, index) {
          var url =
            String(item.url);

          var suffix =
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

          var capturedReferer =
            item.headers &&
            (
              item.headers.Referer ||
              item.headers.referer
            );

          return {
            name:
              PROVIDER_NAME +
              " Web" +
              (
                index
                  ? " " + (index + 1)
                  : ""
              ),
            title:
              (info.title || PROVIDER_NAME) +
              suffix,
            url: url,
            quality:
              inferQuality(
                url,
                item.label
              ),
            type: "direct",
            subtitles: [],
            headers:
              sanitiseHeaders(
                item.headers,
                capturedReferer ||
                  watchUrl
              )
          };
        });

    output.sort(function(a, b) {
      var ai =
        String(a.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      var bi =
        String(b.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      if (ai !== bi) {
        return ai - bi;
      }

      return (
        qualityNumber(b.quality) -
        qualityNumber(a.quality)
      );
    });

    console.log(
      "[MovieBox] Native watch streams=" +
      output.length
    );

    return output;
  }).catch(function(error) {
    console.log(
      "[MovieBox] Native watch failed: " +
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
    String(tmdbId || "").trim();

  if (!id) {
    console.error(
      "[MovieBox] TMDB ID is missing"
    );
    return Promise.resolve([]);
  }

  console.log(
    "[MovieBox] Direct request tmdbId=" +
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

  var work =
    getTmdbInfo(
      id,
      type
    )
      .catch(function(error) {
        console.log(
          "[MovieBox] TMDB metadata failed: " +
          (
            error &&
            error.message
              ? error.message
              : String(error)
          )
        );

        return {
          title: "",
          originalTitle: "",
          year: "",
          aliases: []
        };
      })
      .then(function(info) {
        if (!info.title) {
          return resolveMovieBoxWebsite(
            id,
            {
              title: PROVIDER_NAME
            },
            type,
            requestedSeason,
            requestedEpisode
          );
        }

        return resolveH5(
          info,
          type,
          requestedSeason,
          requestedEpisode
        ).then(function(h5Streams) {
          if (
            Array.isArray(h5Streams) &&
            h5Streams.length
          ) {
            return h5Streams;
          }

          return resolveMovieBoxWebsite(
            id,
            info,
            type,
            requestedSeason,
            requestedEpisode
          );
        });
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "MovieBox provider"
  ).catch(function(error) {
    console.error(
      "[MovieBox] " +
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
module.exports = cloudbankDisplayInstall(module.exports, "MovieBox", "moviebox");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
