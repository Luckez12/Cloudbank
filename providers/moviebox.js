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
const PROVIDER = "MovieBox";
const VERSION = "1.1.7";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var CryptoJS = null;

function getCryptoJS() {
  if (!CryptoJS) CryptoJS = require("crypto-js");
  return CryptoJS;
}

const API_HOSTS = [
  "https://api.inmoviebox.com",
  "https://apii.inmoviebox.com",
  "https://i-api.aoneroom.com",
  "https://api.aoneroom.com",
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com"
];

const PATH_SEARCH = "/wefeed-mobile-bff/subject-api/search";
const PATH_RESOURCE = "/wefeed-mobile-bff/subject-api/resource";
const PATH_PLAY_INFO = "/wefeed-mobile-bff/subject-api/play-info";
const PATH_BOOTSTRAP = "/wefeed-mobile-bff/tab-operating";
const SECRET_KEY_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const VERSION_CODE = 50020044;
const VERSION_NAME = "3.0.03.0529.03";
const MOBILE_UA = "com.community.oneroom/" + VERSION_CODE + " (Linux; U; Android 13; en_US; 23078RKD5C; Build/TQ2A.230405.003; Cronet/135.0.7012.3)";
const FORWARDED_IP = "";

var SESSION = {
  token: null,
  deviceId: randomHex(32),
  gaid: randomUuid(),
  preferredHost: null,
  badHosts: {}
};

function hostErrorLooksTransient(error) {
  var message = String(error && error.message ? error.message : error || "").toLowerCase();
  return /407|http_proxy_auth|timeout|timed out|abort|network|failed to fetch|econn|enotfound|socket|connection/.test(message);
}

function markHostBad(host, reason) {
  host = String(host || "");
  if (!host) return;
  SESSION.badHosts[host] = true;
  if (SESSION.preferredHost === host) SESSION.preferredHost = null;
  console.log("[MovieBox] host unhealthy host=" + host + " reason=" + String(reason || "transient-error"));
}

function markHostGood(host) {
  host = String(host || "");
  if (!host) return;
  delete SESSION.badHosts[host];
  SESSION.preferredHost = host;
}

function orderedApiHosts() {
  var out = [];
  var preferred = String(SESSION.preferredHost || "");
  if (preferred && API_HOSTS.indexOf(preferred) >= 0 && !SESSION.badHosts[preferred]) out.push(preferred);
  API_HOSTS.forEach(function (host) {
    if (host === preferred || SESSION.badHosts[host]) return;
    out.push(host);
  });

  // Keep failures session-local, but avoid permanently dead-ending if every
  // host has been marked unhealthy. A full runtime restart also resets this.
  if (!out.length) {
    SESSION.badHosts = {};
    SESSION.preferredHost = null;
    return API_HOSTS.slice();
  }
  return out;
}

function randomHex(length) {
  var out = "";
  while (out.length < length) out += Math.floor(Math.random() * 0x100000000).toString(16);
  return out.slice(0, length);
}

function randomUuid() {
  var h = randomHex(32);
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
}

function fetchJsonSimple(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "unknown") + " " + url);
    return res.text();
  }).then(function (text) {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  });
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(value) {
  var m = String(value || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}

function uniqueStrings(values) {
  var seen = {};
  var out = [];
  (values || []).forEach(function (value) {
    var clean = String(value || "").trim();
    var key = normalizeTitle(clean);
    if (!clean || !key || seen[key]) return;
    seen[key] = true;
    out.push(clean);
  });
  return out;
}

function getTmdbDetails(tmdbId, mediaType) {
  var path = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + path + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=en-US";
  return fetchJsonSimple(url, { headers: { "Accept": "application/json" } });
}

function tmdbInfo(details, mediaType) {
  var isTv = mediaType === "tv";
  var title = isTv ? details.name : details.title;
  var original = isTv ? details.original_name : details.original_title;
  var date = isTv ? details.first_air_date : details.release_date;
  return {
    title: String(title || original || "").trim(),
    titles: uniqueStrings([title, original]),
    year: parseYear(date),
    type: mediaType
  };
}

function makeClientInfo() {
  return JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: VERSION_NAME,
    version_code: VERSION_CODE,
    os: "android",
    os_version: "13",
    install_ch: "ps",
    device_id: SESSION.deviceId,
    install_store: "ps",
    gaid: SESSION.gaid,
    brand: "Redmi",
    model: "23078RKD5C",
    system_language: "en",
    net: "NETWORK_WIFI",
    region: "US",
    timezone: "America/New_York",
    sp_code: "90101",
    "X-Play-Mode": "2"
  });
}

function paddedBase64(value) {
  var s = String(value || "");
  while (s.length % 4) s += "=";
  return s;
}

function sortedQueryString(url) {
  var query = String(url || "").split("?")[1] || "";
  if (!query) return "";
  var parts = query.split("&").filter(Boolean).map(function (piece) {
    var i = piece.indexOf("=");
    var key = i >= 0 ? piece.slice(0, i) : piece;
    var value = i >= 0 ? piece.slice(i + 1) : "";
    try { key = decodeURIComponent(key); } catch (_) {}
    try { value = decodeURIComponent(value); } catch (_) {}
    return [key, value];
  });
  parts.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return parts.map(function (p) { return p[0] + "=" + p[1]; }).join("&");
}

function pathnameOf(url) {
  var s = String(url || "").replace(/^https?:\/\/[^/]+/i, "");
  return (s.split("?")[0] || "/");
}

function buildSignedHeaders(method, url, body, authToken) {
  var CryptoJS = getCryptoJS();
  var accept = "application/json";
  var contentType = body !== null ? "application/json; charset=utf-8" : "application/json";
  var ts = Date.now();
  var tsStr = String(ts);
  var clientToken = tsStr + "," + CryptoJS.MD5(tsStr.split("").reverse().join("")).toString(CryptoJS.enc.Hex);

  var bodyLength = "";
  var bodyHash = "";
  if (body !== null) {
    var bodyStr = String(body);
    bodyLength = String(unescape(encodeURIComponent(bodyStr)).length);
    bodyHash = CryptoJS.MD5(bodyStr).toString(CryptoJS.enc.Hex);
  }

  var query = sortedQueryString(url);
  var canonicalUrl = pathnameOf(url) + (query ? "?" + query : "");
  var canonical = [String(method).toUpperCase(), accept, contentType, bodyLength, ts, bodyHash, canonicalUrl].join("\n");
  var key = CryptoJS.enc.Base64.parse(paddedBase64(SECRET_KEY_B64));
  var mac = CryptoJS.HmacMD5(canonical, key);
  var signature = tsStr + "|2|" + CryptoJS.enc.Base64.stringify(mac);

  var headers = {
    "User-Agent": MOBILE_UA,
    "Accept": accept,
    "Content-Type": contentType,
    "X-Client-Token": clientToken,
    "x-tr-signature": signature,
    "X-Client-Info": makeClientInfo(),
    "X-Client-Status": "0",
    "X-Play-Mode": "2",
    "Cache-Control": "no-cache"
  };
  if (FORWARDED_IP) headers["X-Forwarded-For"] = FORWARDED_IP;
  if (authToken) headers.Authorization = "Bearer " + authToken;
  return headers;
}

function makeUrl(host, path, params) {
  var pairs = [];
  Object.keys(params || {}).forEach(function (key) {
    pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])));
  });
  return host + path + (pairs.length ? "?" + pairs.join("&") : "");
}

function extractXUserToken(res) {
  try {
    var raw = res && res.headers && res.headers.get ? res.headers.get("x-user") : null;
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.token ? String(parsed.token) : null;
  } catch (_) {
    return null;
  }
}

function signedAttempt(host, path, method, params, bodyObj, token) {
  var url = makeUrl(host, path, params || {});
  var body = bodyObj ? JSON.stringify(bodyObj) : null;
  var headers = buildSignedHeaders(method, url, body, token || null);
  return fetch(url, {
    method: method,
    headers: headers,
    body: body === null ? undefined : body
  }).then(function (res) {
    var freshToken = extractXUserToken(res);
    return res.text().then(function (text) {
      var json = null;
      try { json = JSON.parse(String(text || "").replace(/^\uFEFF/, "")); } catch (_) {}
      return {
        status: res.status,
        ok: !!res.ok,
        token: freshToken,
        json: json,
        url: url
      };
    });
  });
}

function bootstrapToken() {
  if (SESSION.token) {
    console.log("[MovieBox] auth bootstrap cache-hit elapsed=0ms");
    return Promise.resolve(SESSION.token);
  }
  var bootstrapStartedAt = Date.now();
  var hosts = orderedApiHosts();

  function tryHost(i) {
    if (i >= hosts.length) return Promise.resolve(null);
    var host = hosts[i];
    return signedAttempt(host, PATH_BOOTSTRAP, "GET", { page: 1, tabId: 0, version: "" }, null, null)
      .then(function (result) {
        if (result.status === 407) {
          markHostBad(host, "http-407");
          return tryHost(i + 1);
        }
        if (result.token) {
          SESSION.token = result.token;
          markHostGood(host);
          console.log("[MovieBox] auth bootstrap host=" + host + " status=" + result.status + " token=yes elapsed=" + (Date.now() - bootstrapStartedAt) + "ms");
          return SESSION.token;
        }
        console.log("[MovieBox] auth bootstrap host=" + host + " status=" + result.status + " token=no elapsed=" + (Date.now() - bootstrapStartedAt) + "ms");
        return tryHost(i + 1);
      })
      .catch(function (error) {
        if (hostErrorLooksTransient(error)) markHostBad(host, error && error.message ? error.message : String(error));
        console.log("[MovieBox] auth bootstrap fail host=" + host + " elapsed=" + (Date.now() - bootstrapStartedAt) + "ms error=" + (error && error.message ? error.message : String(error)));
        return tryHost(i + 1);
      });
  }

  return tryHost(0);
}

function apiCall(path, method, params, bodyObj) {
  return bootstrapToken().then(function (token) {
    if (!token) throw new Error("auth bootstrap failed");
    var hosts = orderedApiHosts();

    function tryHost(i) {
      if (i >= hosts.length) return Promise.resolve(null);
      var host = hosts[i];
      return signedAttempt(host, path, method, params, bodyObj, SESSION.token)
        .then(function (result) {
          if (result.token) SESSION.token = result.token;
          if (result.status === 407) {
            markHostBad(host, "http-407");
            return tryHost(i + 1);
          }
          var payload = result.json || {};
          if (result.ok && Number(payload.code) === 0) {
            markHostGood(host);
            return { host: host, data: payload.data || null };
          }
          console.log("[MovieBox] api fail host=" + host + " path=" + path + " status=" + result.status + " code=" + String(payload.code == null ? "?" : payload.code));
          return tryHost(i + 1);
        })
        .catch(function (error) {
          if (hostErrorLooksTransient(error)) markHostBad(host, error && error.message ? error.message : String(error));
          console.log("[MovieBox] api error host=" + host + " path=" + path + " error=" + (error && error.message ? error.message : String(error)));
          return tryHost(i + 1);
        });
    }

    return tryHost(0);
  });
}

function itemMatches(item, info) {
  if (!item) return false;
  var subjectType = Number(item.subjectType || 0);
  if (info.type === "movie" && subjectType !== 1) return false;
  if (info.type === "tv" && subjectType !== 2) return false;

  var itemTitle = normalizeTitle(item.title);
  var titleMatch = info.titles.some(function (title) {
    return normalizeTitle(title) === itemTitle;
  });
  if (!titleMatch) return false;

  var itemYear = parseYear(item.releaseDate);
  if (info.year && itemYear && Math.abs(info.year - itemYear) > 1) return false;
  return true;
}

function chooseBest(items, info) {
  var matched = (items || []).filter(function (item) { return itemMatches(item, info); });
  if (!matched.length) return null;
  matched.sort(function (a, b) {
    var ay = parseYear(a.releaseDate);
    var by = parseYear(b.releaseDate);
    var ad = info.year && ay ? Math.abs(info.year - ay) : 99;
    var bd = info.year && by ? Math.abs(info.year - by) : 99;
    return ad - bd;
  });
  return matched[0];
}

function findSubject(info) {
  var queries = info.titles.length ? info.titles : [info.title];

  function tryQuery(i) {
    if (i >= queries.length) return Promise.resolve(null);
    var query = queries[i];
    var searchStartedAt = Date.now();
    return apiCall(PATH_SEARCH, "POST", null, {
      keyword: query,
      page: 1,
      perPage: 20,
      subjectType: 0
    }).then(function (result) {
      var data = result && result.data ? result.data : {};
      var items = Array.isArray(data.items) ? data.items : [];
      var selected = chooseBest(items, info);
      console.log("[MovieBox] mobile search host=" + (result ? result.host : "none") + " query='" + query + "' items=" + items.length + " match=" + (selected ? "yes" : "no") + " elapsed=" + (Date.now() - searchStartedAt) + "ms");
      if (selected) return selected;
      return tryQuery(i + 1);
    });
  }

  return tryQuery(0);
}

function fetchResolution(subjectId, mediaType, season, episode, resolution) {
  var resourceStartedAt = Date.now();
  var targetSe = mediaType === "tv" ? Number(season || 1) : 0;
  var targetEp = mediaType === "tv" ? Number(episode || 1) : 0;

  function fetchPage(page, acc) {
    // Current MovieBox Android API is most reliable when se=0&ep=0 is used
    // to fetch the resource pack, then the requested TV episode is filtered locally.
    return apiCall(PATH_RESOURCE, "GET", {
      subjectId: subjectId,
      se: 0,
      ep: 0,
      resolution: resolution,
      page: page,
      perPage: 10
    }, null).then(function (result) {
      var data = result && result.data ? result.data : {};
      var list = Array.isArray(data.list) ? data.list : [];
      list.forEach(function (item) {
        item._requestedResolution = resolution;
        item._apiHost = result ? result.host : "";
        // Keep the requested resolution only as request metadata. Do not
        // promote an unknown API resolution to the requested quality.
        acc.push(item);
      });
      var hasMore = !!(data.pager && data.pager.hasMore);
      if (hasMore && page < 20) return fetchPage(page + 1, acc);
      return { host: result ? result.host : "none", items: acc };
    });
  }

  return fetchPage(1, []).then(function (result) {
    var list = result.items || [];
    if (mediaType === "tv") {
      list = list.filter(function (item) {
        return Number(item.se) === targetSe && Number(item.ep) === targetEp;
      });
    }
    console.log("[MovieBox] resource " + resolution + "p host=" + result.host + " items=" + list.length + " region=US sp=90101 elapsed=" + (Date.now() - resourceStartedAt) + "ms");
    return list;
  }).catch(function (error) {
    console.log("[MovieBox] resource " + resolution + "p elapsed=" + (Date.now() - resourceStartedAt) + "ms error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function loadStreams(item, mediaType, season, episode) {
  var subjectId = String(item && item.subjectId || "").trim();
  if (!subjectId) return Promise.resolve([]);
  return Promise.all([
    fetchResolution(subjectId, mediaType, season, episode, 1080),
    fetchResolution(subjectId, mediaType, season, episode, 720),
    fetchResolution(subjectId, mediaType, season, episode, 480),
    fetchResolution(subjectId, mediaType, season, episode, 360)
  ]).then(function (groups) {
    var out = [];
    groups.forEach(function (group) {
      (group || []).forEach(function (entry) { out.push(entry); });
    });
    return out;
  });
}

function candidateDuration(item) {
  var n = Number(item && item.duration || 0);
  return isFinite(n) && n > 0 ? n : 0;
}

function candidateSize(item) {
  var raw = String(item && item.size || "").trim();
  var n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function isNoticeCandidate(item) {
  var text = String(item && item.title || "").toLowerCase();
  return /install(?:ation)?|official\s*notice|update\s*(?:the\s*)?app|download\s*(?:the\s*)?(?:latest\s*)?(?:version|app)|uninstall/.test(text);
}

function candidateScore(item) {
  var score = 0;
  if (isNoticeCandidate(item)) score -= 1000000000000;
  score += candidateDuration(item) * 1000000;
  score += candidateSize(item);
  return score;
}

function parseTotalBytesFromHeaders(res) {
  try {
    if (!res || !res.headers || !res.headers.get) return 0;
    var cr = String(res.headers.get("content-range") || "");
    var m = cr.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]) || 0;
    var cl = Number(res.headers.get("content-length") || 0);
    return isFinite(cl) && cl > 0 ? cl : 0;
  } catch (_) {
    return 0;
  }
}

function probeCandidate(item, index) {
  var probeStartedAt = Date.now();
  var url = String(item && (item.resourceLink || item.url) || "").trim();
  if (!/^https?:\/\//i.test(url)) return Promise.resolve({ item: item, bytes: 0, status: 0, index: index });

  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": MOBILE_UA,
      "Accept": "*/*",
      "Range": "bytes=0-0"
    }
  }).then(function (res) {
    var bytes = parseTotalBytesFromHeaders(res);
    console.log("[MovieBox] CDN probe #" + index + " status=" + res.status +
      " totalMB=" + (bytes ? Math.round(bytes / 1048576) : 0) +
      " apiDuration=" + candidateDuration(item) +
      " apiSize=" + candidateSize(item) +
      " resolution=" + actualResolution(item) +
      " elapsed=" + (Date.now() - probeStartedAt) + "ms");
    return { item: item, bytes: bytes, status: res.status, index: index };
  }).catch(function (error) {
    console.log("[MovieBox] CDN probe #" + index + " elapsed=" + (Date.now() - probeStartedAt) + "ms fail=" + (error && error.message ? error.message : String(error)));
    return { item: item, bytes: 0, status: 0, index: index };
  });
}

function uniqueCandidates(items) {
  var seen = {};
  var out = [];
  (items || []).forEach(function (item) {
    var url = String(item && (item.resourceLink || item.url) || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    var rid = String(item && item.resourceId || "").trim();
    var key = rid ? "rid:" + rid : "url:" + url;
    if (seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out;
}


function isPlayableMediaUrl(url) {
  var s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  return /(?:\.m3u8|\.mp4|\.m4v|\.mpd|\/resource\/|hakunaymatata\.com|aoneroom\.com\/.*(?:video|stream))/i.test(s);
}

function collectPlayableUrls(value, out, depth) {
  out = out || [];
  depth = Number(depth || 0);
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    if (isPlayableMediaUrl(value) && out.indexOf(value) < 0) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(function (v) { collectPlayableUrls(v, out, depth + 1); });
    return out;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      var v = value[key];
      if (typeof v === "string" && /^(?:url|streamUrl|playUrl|videoUrl|file|src|link|resourceLink|downloadUrl)$/i.test(key)) {
        if (isPlayableMediaUrl(v) && out.indexOf(v) < 0) out.push(v);
      } else if (v && (typeof v === "object" || Array.isArray(v))) {
        collectPlayableUrls(v, out, depth + 1);
      }
    });
  }
  return out;
}

function candidateRank(a, b) {
  var am = Number(a && a.requireMemberType || 0);
  var bm = Number(b && b.requireMemberType || 0);
  if (am !== bm) return am - bm;
  var ar = actualResolution(a);
  var br = actualResolution(b);
  if (ar !== br) return br - ar;
  var ad = candidateDuration(a), bd = candidateDuration(b);
  if (ad !== bd) return bd - ad;
  return candidateSize(b) - candidateSize(a);
}

function resolveViaPlayInfo(items, subjectId, mediaType, season, episode) {
  var candidates = uniqueCandidates(items).slice().sort(candidateRank).slice(0, 6);
  if (!candidates.length) return Promise.resolve([]);
  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;

  function tryCandidate(i) {
    if (i >= candidates.length) return Promise.resolve([]);
    var item = candidates[i];
    var resolution = actualResolution(item);
    var resourceId = String(item.resourceId || "").trim();
    if (!resourceId) return tryCandidate(i + 1);

    console.log("[MovieBox] candidate #" + (i + 1) +
      " resourceId=" + resourceId +
      " q=" + resolution +
      " member=" + Number(item.requireMemberType || 0) +
      " linkType=" + Number(item.linkType || 0) +
      " apiMB=" + Math.round(candidateSize(item) / 1048576));

    function callPlayInfo(qualityValue, secondTry) {
      return apiCall(PATH_PLAY_INFO, "GET", {
        subjectId: subjectId,
        se: se,
        ep: ep,
        quality: qualityValue,
        resourceId: resourceId
      }, null).then(function (result) {
        var data = result && result.data ? result.data : null;
        var urls = collectPlayableUrls(data, [], 0);
        console.log("[MovieBox] play-info resourceId=" + resourceId +
          " quality=" + String(qualityValue) +
          " host=" + (result ? result.host : "none") +
          " urls=" + urls.length);
        if (!urls.length && !secondTry && resolution) {
          return callPlayInfo(resolution + "p", true);
        }
        if (!urls.length) return tryCandidate(i + 1);

        var url = urls[0];
        var quality = resolution ? resolution + "p" : "Auto";
        console.log("[MovieBox] selected play-info stream q=" + quality +
          " resourceId=" + resourceId +
          " cdn=" + String(url).replace(/^https?:\/\//i, "").split("/")[0]);
        return [{
          name: PROVIDER,
          title: "MovieBox • " + quality + " • Direct",
          url: url,
          quality: quality,
          headers: {
            "User-Agent": "ExoPlayerLib/2.19.1",
            "Accept": "*/*",
            "Referer": "https://api6.aoneroom.com/"
          }
        }];
      }).catch(function (error) {
        console.log("[MovieBox] play-info error resourceId=" + resourceId +
          " error=" + (error && error.message ? error.message : String(error)));
        return tryCandidate(i + 1);
      });
    }

    return callPlayInfo(resolution || 720, false);
  }

  return tryCandidate(0);
}


function extractPlayInfoStreams(data, fallbackResolution, resourceId) {
  var out = [];
  if (!data || typeof data !== "object") return out;
  var signCookie = String(data.signCookie || data.cookie || "").trim();
  var list = Array.isArray(data.streamList) ? data.streamList : [];
  list.forEach(function (stream) {
    if (!stream || typeof stream !== "object") return;
    var url = String(stream.url || stream.streamUrl || stream.playUrl || stream.file || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    var q = Number(stream.resolution || stream.quality || fallbackResolution || 0);
    if (!isFinite(q)) q = Number(fallbackResolution || 0);
    var headers = {
      "User-Agent": "ExoPlayerLib/2.19.1",
      "Accept": "*/*"
    };
    if (/hakunaymatata\.com/i.test(url)) headers.Referer = "https://www.movieboxpro.app/";
    if (signCookie) headers.Cookie = signCookie;
    out.push({
      name: PROVIDER,
      title: "MovieBox • " + (q ? q + "p" : "Auto") + " • PlayInfo",
      url: url,
      quality: q ? q + "p" : "Auto",
      headers: headers,
      _resourceId: resourceId || ""
    });
  });
  return out;
}

function resolveCurrentPlayInfo(items, subjectId, mediaType, season, episode) {
  var candidates = uniqueCandidates(items).slice().sort(candidateRank).slice(0, 5);
  if (!candidates.length) return Promise.resolve([]);
  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;

  function tryOne(i) {
    if (i >= candidates.length) return Promise.resolve([]);
    var item = candidates[i];
    var resourceId = String(item.resourceId || "").trim();
    if (!resourceId) return tryOne(i + 1);
    var resolution = actualResolution(item);
    var apiHost = String(item._apiHost || API_HOSTS[0]);
    var apiHostName = apiHost.replace(/^https?:\/\//i, "");
    return apiCall(PATH_PLAY_INFO, "GET", {
      subjectId: subjectId,
      se: se,
      ep: ep,
      quality: resolution || 720,
      resourceId: resourceId,
      host: apiHostName
    }, null).then(function (result) {
      var data = result && result.data ? result.data : {};
      var streams = extractPlayInfoStreams(data, resolution, resourceId);
      console.log("[MovieBox] play-info resourceId=" + resourceId +
        " host=" + (result ? result.host : "none") +
        " apiHost=" + apiHostName +
        " streams=" + streams.length +
        " cookie=" + (data && (data.signCookie || data.cookie) ? "yes" : "no"));
      if (streams.length) return streams;
      return tryOne(i + 1);
    }).catch(function (error) {
      console.log("[MovieBox] play-info error resourceId=" + resourceId + " error=" + (error && error.message ? error.message : String(error)));
      return tryOne(i + 1);
    });
  }
  return tryOne(0);
}

function hostOf(url) {
  return String(url || "").replace(/^https?:\/\//i, "").split("/")[0];
}

function qualityName(value) {
  var q = Number(value || 0);
  if (q >= 2160) return "4K";
  return q ? q + "p" : "Auto";
}

function actualResolution(item) {
  var q = Number(item && item.resolution || 0);
  return isFinite(q) && q > 0 ? q : 0;
}

function isAllowedResolution(item) {
  var q = actualResolution(item);
  // Unknown/Auto is allowed. Known qualities below 720p are not.
  return q === 0 || q >= 720;
}

function waitMs(ms, value) {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(value); }, ms);
  });
}

function directCandidateScore(item) {
  var score = 0;
  var resolution = actualResolution(item);
  var member = Number(item && item.requireMemberType || 0);
  var linkType = Number(item && item.linkType || 0);
  if (member === 0) score += 1000000000000;
  else score -= member * 100000000000;
  if (linkType === 1) score += 50000000000;
  score += resolution * 100000000;
  score += candidateDuration(item) * 10000;
  score += candidateSize(item);
  return score;
}

function resolveDirectResources(items, mediaType) {
  var unique = uniqueCandidates(items).filter(function (item) {
    return /^https?:\/\//i.test(String(item && item.resourceLink || ""));
  });
  if (!unique.length) return Promise.resolve([]);

  unique.sort(function (a, b) { return directCandidateScore(b) - directCandidateScore(a); });

  // Keep the best candidate per quality first. This mirrors the current
  // resourceLink flow and avoids returning duplicate mirrors for one quality.
  var byQuality = {};
  unique.forEach(function (item) {
    var q = actualResolution(item);
    if (!byQuality[q]) byQuality[q] = item;
  });
  var selected = Object.keys(byQuality).map(function (q) { return byQuality[q]; })
    .sort(function (a, b) { return actualResolution(b) - actualResolution(a); })
    .slice(0, 4);

  return Promise.all(selected.map(function (item, i) {
    return probeCandidate(item, i + 1);
  })).then(function (probes) {
    var minBytes = mediaType === "movie" ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
    var streams = [];

    probes.forEach(function (p) {
      var item = p.item || {};
      var apiBytes = candidateSize(item);
      var actualBytes = Number(p.bytes || 0);
      var validStatus = p.status === 200 || p.status === 206;
      var tinyMismatch = apiBytes >= 50 * 1024 * 1024 && actualBytes > 0 && actualBytes < minBytes;
      var likelyFull = actualBytes >= minBytes || (actualBytes === 0 && apiBytes >= minBytes);
      var qn = actualResolution(item);
      console.log("[MovieBox] direct check q=" + qn +
        " host=" + hostOf(item.resourceLink) +
        " apiMB=" + Math.round(apiBytes / 1048576) +
        " actualMB=" + (actualBytes ? Math.round(actualBytes / 1048576) : 0) +
        " ok=" + (validStatus && likelyFull && !tinyMismatch));
      if (!validStatus || tinyMismatch || !likelyFull) return;

      streams.push({
        name: PROVIDER,
        title: "MovieBox • " + (qn ? qn + "p" : "Auto") + " • Direct",
        url: String(item.resourceLink),
        quality: qn ? qn + "p" : "Auto",
        headers: {
          "User-Agent": MOBILE_UA,
          "Accept": "*/*"
        }
      });
    });

    console.log("[MovieBox] direct verified=" + streams.length + "/" + probes.length);
    return streams;
  });
}

function selectPlayableByActualSize(items, mediaType) {
  var unique = uniqueCandidates(items);
  if (!unique.length) return Promise.resolve([]);

  // Current MovieBox responses can include a short official install/update
  // notice beside the real movie. Metadata is not always reliable, so probe
  // the signed CDN URLs and rank using the real file size from Content-Range.
  var probeList = unique.slice(0, 8);
  return Promise.all(probeList.map(function (item, i) {
    return probeCandidate(item, i + 1);
  })).then(function (results) {
    var usable = results.filter(function (r) {
      return r && r.item && !isNoticeCandidate(r.item) && (r.status === 200 || r.status === 206 || r.bytes > 0);
    });
    if (!usable.length) usable = results.filter(function (r) { return r && r.item; });
    if (!usable.length) return [];

    usable.sort(function (a, b) {
      var byteDiff = Number(b.bytes || 0) - Number(a.bytes || 0);
      if (byteDiff) return byteDiff;
      var durationDiff = candidateDuration(b.item) - candidateDuration(a.item);
      if (durationDiff) return durationDiff;
      return candidateSize(b.item) - candidateSize(a.item);
    });

    var best = usable[0];
    var item = best.item;
    var url = String(item.resourceLink || item.url || "").trim();
    var resolution = actualResolution(item);
    var quality = resolution ? resolution + "p" : "Auto";
    var actualMb = best.bytes ? Math.round(best.bytes / 1048576) : 0;

    // If there is a clearly full-length candidate, never return tiny notice clips.
    var fullThreshold = mediaType === "movie" ? 25 * 1024 * 1024 : 12 * 1024 * 1024;
    var hasFull = usable.some(function (r) { return Number(r.bytes || 0) >= fullThreshold; });
    if (hasFull && Number(best.bytes || 0) < fullThreshold) return [];

    console.log("[MovieBox] selected actual stream index=" + best.index +
      " quality=" + quality + " actualMB=" + actualMb +
      " duration=" + candidateDuration(item) +
      " resourceId=" + String(item.resourceId || "?"));

    return [{
      name: PROVIDER,
      title: "MovieBox • " + quality + " • MP4",
      url: url,
      quality: quality,
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept": "*/*"
      }
    }];
  });
}
function verifyFastDirectCandidate(item, mediaType, index) {
  return probeCandidate(item, index).then(function (p) {
    var apiBytes = candidateSize(item);
    var actualBytes = Number(p.bytes || 0);
    var minBytes = mediaType === "movie" ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
    var validStatus = p.status === 200 || p.status === 206;
    var tinyMismatch = apiBytes >= 50 * 1024 * 1024 && actualBytes > 0 && actualBytes < minBytes;
    var likelyFull = actualBytes >= minBytes || (actualBytes === 0 && apiBytes >= minBytes);
    var qn = actualResolution(item);
    var ok = validStatus && likelyFull && !tinyMismatch;

    console.log("[MovieBox] fast direct check q=" + qn +
      " host=" + hostOf(item.resourceLink) +
      " apiMB=" + Math.round(apiBytes / 1048576) +
      " actualMB=" + (actualBytes ? Math.round(actualBytes / 1048576) : 0) +
      " ok=" + ok);

    if (!ok) return null;
    var qLabel = qualityName(qn);
    return {
      name: PROVIDER,
      title: "MovieBox • " + qLabel + " • Direct",
      url: String(item.resourceLink),
      quality: qLabel,
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept": "*/*"
      }
    };
  });
}

var fastVerifyCache = {};

function candidateFingerprint(item) {
  var url = String(item && item.resourceLink || "");
  var q = actualResolution(item);
  var size = candidateSize(item);
  var duration = candidateDuration(item);
  var host = hostOf(url);
  var rid = String(item && item.resourceId || "").trim();

  // MovieBox frequently returns the same underlying file with a different
  // signed URL/resourceId for 2160/1080/720 requests. The stable media
  // metadata is a better de-duplication key than the signed URL.
  return [
    q,
    size,
    duration,
    host,
    rid && !size && !duration ? rid : ""
  ].join("|");
}

function verifyCachedCandidate(item, mediaType, index) {
  var url = String(item && item.resourceLink || "");
  if (!url) return Promise.resolve(null);
  var key = candidateFingerprint(item);
  if (!fastVerifyCache[key]) {
    fastVerifyCache[key] = verifyFastDirectCandidate(item, mediaType, index);
  } else {
    console.log("[MovieBox] reuse media fingerprint q=" +
      qualityName(actualResolution(item)) +
      " host=" + hostOf(url));
  }
  return fastVerifyCache[key];
}

function resolveFastQuality(subjectId, mediaType, season, episode, resolution) {
  return fetchResolution(subjectId, mediaType, season, episode, resolution).then(function (items) {
    var candidates = uniqueCandidates(items).filter(function (item) {
      return /^https?:\/\//i.test(String(item && item.resourceLink || "")) &&
        isAllowedResolution(item);
    }).sort(function (a, b) {
      return directCandidateScore(b) - directCandidateScore(a);
    }).slice(0, 2);

    var actualQualities = [];
    candidates.forEach(function (item) {
      var q = qualityName(actualResolution(item));
      if (actualQualities.indexOf(q) < 0) actualQualities.push(q);
    });
    console.log("[MovieBox] request " + qualityName(resolution) +
      " candidates=" + candidates.length +
      " actual=" + (actualQualities.length ? actualQualities.join(",") : "none"));
    if (!candidates.length) return null;

    function tryCandidate(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      return verifyCachedCandidate(candidates[i], mediaType, i + 1).then(function (stream) {
        if (stream) {
          console.log("[MovieBox] READY q=" + stream.quality +
            " candidate=" + (i + 1) +
            " host=" + hostOf(stream.url));
          return stream;
        }
        return tryCandidate(i + 1);
      });
    }

    return tryCandidate(0);
  }).catch(function (error) {
    console.log("[MovieBox] quality " + qualityName(resolution) +
      " error=" + (error && error.message ? error.message : String(error)));
    return null;
  });
}

function multiQualityFastDirect(subjectId, mediaType, season, episode) {
  fastVerifyCache = {};

  // Current MovieBox resource flows are consistently useful at 1080p/720p.
  // Do not spend a separate network round-trip probing 2160p. If the 1080p
  // response itself contains an actual 2160p resource, isAllowedResolution()
  // and directCandidateScore() will still allow and prefer it.
  return resolveFastQuality(subjectId, mediaType, season, episode, 1080).then(function (stream) {
    if (stream) return [stream];
    return resolveFastQuality(subjectId, mediaType, season, episode, 720).then(function (fallbackStream) {
      return fallbackStream ? [fallbackStream] : [];
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);
  console.log("[MovieBox] v" + VERSION + " TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : "") + " region=US sp=90101 multiQuality=true");

  var info = null;
  var matchedSubjectId = null;
  var metadataStartedAt = Date.now();
  var searchStageStartedAt = 0;
  var streamStageStartedAt = 0;
  return getTmdbDetails(tmdbId, mediaType)
    .then(function (details) {
      info = tmdbInfo(details || {}, mediaType);
      console.log("[MovieBox] metadata elapsed=" + (Date.now() - metadataStartedAt) + "ms title='" + info.title + "' year=" + info.year);
      if (!info.title) return null;
      searchStageStartedAt = Date.now();
      return findSubject(info);
    })
    .then(function (item) {
      if (!item) {
        console.log("[MovieBox] title not found");
        return [];
      }
      matchedSubjectId = String(item.subjectId || "").trim();
      console.log("[MovieBox] matched title='" + String(item.title || "") + "' year=" + parseYear(item.releaseDate) + " id=" + matchedSubjectId + " searchStage=" + (searchStageStartedAt ? (Date.now() - searchStageStartedAt) : 0) + "ms");
      streamStageStartedAt = Date.now();
      return multiQualityFastDirect(matchedSubjectId, mediaType, season, episode);
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[MovieBox] v" + VERSION +
        " playable sources=" + streams.length +
        " streamStage=" + (streamStageStartedAt ? (Date.now() - streamStageStartedAt) : 0) + "ms" +
        " elapsed=" + (Date.now() - startedAt) + "ms");
      return streams;
    })
    .catch(function (error) {
      console.log("[MovieBox] error=" + (error && error.message ? error.message : String(error)));
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

var cloudbankMergedEngines = [{ id: "moviebox", enabled: true, disabledPlatforms: [], provider: module.exports }];
cloudbankMergedEngines.push({ id: "moviebox-v2", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:moviebox-v2 */
/**
 * moviebox - Built from src/moviebox/
 * Generated: 2026-09-29T14:51:11.980Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/moviebox/constants.js
var API_BASE = "https://api3.aoneroom.com";
var PLAYER_BASE = "https://moviebox.ph";
var PLAYER_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
var HOST_POOL = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com"
];
var KEY_B64_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
var KEY_B64_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var BRAND_MODELS = {
  "Samsung": ["SM-S918B", "SM-A528B", "SM-M336B"],
  "Xiaomi": ["2201117TI", "M2012K11AI", "Redmi Note 11"],
  "OnePlus": ["LE2111", "CPH2449", "IN2023"],
  "Google": ["Pixel 6", "Pixel 7", "Pixel 8"],
  "Realme": ["RMX3085", "RMX3360", "RMX3551"]
};
var TOKEN_URL = "https://apig.inmoviebox.com/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1";
var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "4.0.03.0920.03",
  version_code: 50020130
};

// src/moviebox/utils.js
var import_crypto_js = __toESM(require("crypto-js"));
var SECRET_KEY_DEFAULT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_DEFAULT).toString(import_crypto_js.default.enc.Utf8)
);
var SECRET_KEY_ALT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_ALT).toString(import_crypto_js.default.enc.Utf8)
);
var deviceId = "";
var selectedBrand = "";
var selectedModel = "";
var bearerToken = null;
function decodeJwtExpiry(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2)
      return 0;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    const parsed = import_crypto_js.default.enc.Base64.parse(base64).toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(parsed);
    return json.exp || 0;
  } catch (e) {
    return 0;
  }
}
function isTokenValid(token) {
  if (!token)
    return false;
  const exp = decodeJwtExpiry(token);
  return exp > Date.now() / 1e3 + 3600;
}
function getCachedToken() {
  return __async(this, null, function* () {
    if (isTokenValid(bearerToken))
      return bearerToken;
    console.log("[MovieBox] Fetching fresh anonymous token...");
    const url = TOKEN_URL;
    const res = yield movieBoxRequest("GET", url, null, {}, true);
    if (res && res.headers) {
      const xUser = res.headers.get("x-user");
      if (xUser) {
        try {
          const xUserJson = JSON.parse(xUser);
          const token = xUserJson.token;
          if (token && isTokenValid(token)) {
            bearerToken = token;
            return token;
          }
        } catch (e) {
          console.error("[MovieBox] Failed to parse x-user header for token", e);
        }
      }
    }
    return bearerToken || "";
  });
}
function initializeSession() {
  if (!deviceId) {
    let chars = "0123456789abcdef";
    for (let i = 0; i < 32; i++) {
      deviceId += chars[Math.floor(Math.random() * 16)];
    }
    const brands = Object.keys(BRAND_MODELS);
    selectedBrand = brands[Math.floor(Math.random() * brands.length)];
    const models = BRAND_MODELS[selectedBrand];
    selectedModel = models[Math.floor(Math.random() * models.length)];
  }
}
function md5(input) {
  return import_crypto_js.default.MD5(input).toString(import_crypto_js.default.enc.Hex);
}
function hmacMd5(key, data) {
  return import_crypto_js.default.HmacMD5(data, key).toString(import_crypto_js.default.enc.Base64);
}
function generateXClientToken(timestamp) {
  const ts = (timestamp || Date.now()).toString();
  const reversed = ts.split("").reverse().join("");
  const hash = md5(reversed);
  return `${ts},${hash}`;
}
function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  let path = "";
  let query = "";
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
    const params = Array.from(urlObj.searchParams.keys()).sort();
    if (params.length > 0) {
      query = params.map((key) => {
        const values = urlObj.searchParams.getAll(key);
        return values.map((val) => `${key}=${val}`).join("&");
      }).join("&");
    }
  } catch (e) {
    if (url.includes("?")) {
      const parts = url.split("?");
      path = parts[0].replace(/https?:\/\/[^\/]+/, "");
      const qParts = parts[1].split("&").sort();
      query = qParts.join("&");
    } else {
      path = url.replace(/https?:\/\/[^\/]+/, "");
    }
  }
  const canonicalUrl = query ? `${path}?${query}` : path;
  let bodyHash = "";
  let bodyLength = "";
  if (body) {
    const bodyWords = import_crypto_js.default.enc.Utf8.parse(body);
    const totalBytes = bodyWords.sigBytes;
    bodyHash = md5(bodyWords);
    bodyLength = totalBytes.toString();
  }
  return `${method.toUpperCase()}
${accept || ""}
${contentType || ""}
${bodyLength}
${timestamp}
${bodyHash}
` + canonicalUrl;
}
function generateXTrSignature(method, accept, contentType, url, body, useAltKey = false, customTimestamp = null) {
  const timestamp = customTimestamp || Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  const secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  const signatureB64 = hmacMd5(secret, canonical);
  return `${timestamp}|2|${signatureB64}`;
}
function movieBoxRequest(_0, _1) {
  return __async(this, arguments, function* (method, url, body = null, customHeaders = {}, isTokenFetch = false) {
    initializeSession();
    const timestamp = Date.now();
    const xClientToken = generateXClientToken(timestamp);
    const headerContentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xTrSignature = generateXTrSignature(method, accept, headerContentType, url, body, false, timestamp);
    const xClientInfo = JSON.stringify(__spreadProps(__spreadValues({}, PACKAGE_INFO), {
      os: "android",
      os_version: "14",
      device_id: deviceId,
      install_store: "official",
      gaid: "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d",
      brand: selectedBrand.toLowerCase(),
      model: selectedModel,
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "IN",
      timezone: "Asia/Calcutta",
      sp_code: ""
    }));
    const headers = __spreadValues({
      "Accept": accept,
      "Content-Type": headerContentType,
      "x-client-token": xClientToken,
      "x-tr-signature": xTrSignature,
      "User-Agent": `${PACKAGE_INFO.package_name}/${PACKAGE_INFO.version_code} (Linux; U; Android 14; en_IN; ${selectedModel}; Build/UD1A.230803.041; Cronet/145.0.7582.0)`,
      "x-client-info": xClientInfo,
      "x-client-status": "0"
    }, customHeaders);
    if (!isTokenFetch) {
      const token = yield getCachedToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    const options = {
      method,
      headers
    };
    if (body) {
      options.body = body;
    }
    let originalUrl;
    try {
      originalUrl = new URL(url);
    } catch (_) {
      return null;
    }
    const apiHosts = new Set(HOST_POOL.map((host) => new URL(host).host));
    const hosts = apiHosts.has(originalUrl.host) ? [originalUrl.host, ...HOST_POOL.map((host) => new URL(host).host).filter((host) => host !== originalUrl.host)] : [originalUrl.host];
    const maxAttempts = Math.min(3, hosts.length);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const requestUrl = new URL(originalUrl.toString());
        requestUrl.host = hosts[attempt];
        const res = yield fetch(requestUrl.toString(), options);
        if (!res.ok) {
          if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt + 1 < maxAttempts) {
            continue;
          }
          return null;
        }
        const text = yield res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parsed = text;
        }
        if (res.headers) {
          const xUser = res.headers.get("x-user");
          if (xUser) {
            try {
              const xUserJson = JSON.parse(xUser);
              const token = xUserJson.token;
              if (token && isTokenValid(token)) {
                bearerToken = token;
              }
            } catch (e) {
            }
          }
        }
        return {
          data: parsed,
          headers: res.headers
        };
      } catch (err) {
        if (attempt + 1 === maxAttempts) {
          console.error("[MovieBox Request Error]", err.message);
          return null;
        }
      }
    }
    return null;
  });
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Connection": "keep-alive"
        }
      });
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id,
        originalTitle: data.original_title || data.original_name
      };
    } catch (e) {
      console.error("[MovieBox TMDB Error]", e.message);
      return null;
    }
  });
}
function normalizeTitle(s) {
  if (!s)
    return "";
  return String(s).replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ").trim().toLowerCase().replace(/:/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
}
function parseQualityNumber(value) {
  const match = String(value || "").match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : 0;
}
function getFormatType(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes(".mpd"))
    return "DASH";
  if (u.includes(".m3u8"))
    return "HLS";
  if (u.includes(".mp4"))
    return "MP4";
  if (u.includes(".mkv"))
    return "MKV";
  return "VIDEO";
}
function extractPolicyResource(signCookie) {
  var _a, _b;
  if (!signCookie || typeof signCookie !== "string")
    return null;
  const edgeMatch = signCookie.match(/Edge-Cache-Cookie=urlprefix=([^:;\s]+)/);
  if (edgeMatch) {
    try {
      let std = edgeMatch[1].replace(/_/g, "/").replace(/-/g, "+");
      const rem = (4 - std.length % 4) % 4;
      if (rem > 0)
        std += "=".repeat(rem);
      const decoded = import_crypto_js.default.enc.Base64.parse(std).toString(import_crypto_js.default.enc.Utf8).replace(/\/+$/, "");
      if (decoded)
        return `${decoded}/index.mpd`;
    } catch (_) {
    }
  }
  const cfMatch = signCookie.match(/CloudFront-Policy=([^;]+)/);
  if (cfMatch) {
    try {
      const policyRaw = cfMatch[1];
      let cfB64 = policyRaw.replace(/-/g, "+").replace(/~/g, "/").replace(/_/g, "=");
      const rem = cfB64.length % 4;
      if (rem > 0)
        cfB64 += "=".repeat(rem);
      let decodedJson = null;
      try {
        decodedJson = import_crypto_js.default.enc.Base64.parse(cfB64).toString(import_crypto_js.default.enc.Utf8);
      } catch (_) {
        let stdB64 = policyRaw.replace(/-/g, "+").replace(/_/g, "/");
        const rem2 = stdB64.length % 4;
        if (rem2 > 0)
          stdB64 += "=".repeat(rem2);
        decodedJson = import_crypto_js.default.enc.Base64.parse(stdB64).toString(import_crypto_js.default.enc.Utf8);
      }
      if (decodedJson) {
        const root = JSON.parse(decodedJson);
        const resource = (_b = (_a = root == null ? void 0 : root.Statement) == null ? void 0 : _a[0]) == null ? void 0 : _b.Resource;
        if (resource && typeof resource === "string") {
          const trimmed = resource.replace(/[\*\/]+$/, "");
          return trimmed.toLowerCase().endsWith(".mpd") ? trimmed : `${trimmed}/index.mpd`;
        }
      }
    } catch (_) {
    }
  }
  return null;
}

// src/moviebox/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details)
      return [];
    let subjects = yield searchMovieBox(details.title);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      const s = mediaType === "tv" ? seasonNum : 0;
      const e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(bestMatch.subjectId, s, e, details.title, mediaType);
    }
    console.log(`[MovieBox] No matching content found for: ${details.title}`);
    return [];
  });
}
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query, restrictKid: 1 });
    const response = yield movieBoxRequest("POST", url, body);
    if (response && response.data && response.data.data && response.data.data.results) {
      let allSubjects = [];
      response.data.data.results.forEach((group) => {
        if (group.subjects) {
          allSubjects = allSubjects.concat(group.subjects);
        }
      });
      return allSubjects;
    }
    return [];
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  const normTmdbTitle = normalizeTitle(tmdbTitle);
  const targetType = mediaType === "movie" ? 1 : 2;
  let bestMatch = null;
  let bestScore = 0;
  for (const subject of subjects) {
    if (subject.subjectType !== targetType)
      continue;
    const title = subject.title;
    const normTitle = normalizeTitle(title);
    const year = subject.year || (subject.releaseDate ? subject.releaseDate.substring(0, 4) : null);
    let score = 0;
    if (normTitle === normTmdbTitle)
      score += 50;
    else if (normTitle.includes(normTmdbTitle) || normTmdbTitle.includes(normTitle))
      score += 15;
    if (tmdbYear && year && tmdbYear == year)
      score += 35;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = subject;
    }
  }
  if (bestScore >= 40)
    return bestMatch;
  return null;
}
function getPlaybackPage(subjectData, subjectId) {
  const candidates = [subjectData.detailPath, subjectData.detail_path, subjectData.path, subjectData.slug];
  let detailPath = candidates.find((value) => typeof value === "string" && value.trim());
  let webBase = PLAYER_BASE;
  for (const value of [subjectData.detailDomain, subjectData.webDomain, subjectData.webUrl, subjectData.detailUrl, subjectData.shareUrl]) {
    if (typeof value !== "string")
      continue;
    try {
      const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
      if (!parsed.hostname.endsWith("aoneroom.com"))
        webBase = parsed.origin;
      if (!detailPath && parsed.pathname && parsed.pathname !== "/")
        detailPath = parsed.pathname;
      break;
    } catch (e) {
    }
  }
  if (!detailPath)
    return { webBase, referer: `${webBase}/` };
  detailPath = detailPath.replace(/^\/+/, "").replace(/^movies\//, "");
  const pageUrl = new URL(`/movies/${detailPath}`, `${webBase}/`);
  pageUrl.searchParams.set("id", subjectId);
  pageUrl.searchParams.set("type", "/movie/detail");
  pageUrl.searchParams.set("detailSe", "");
  pageUrl.searchParams.set("detailEp", "");
  pageUrl.searchParams.set("lang", "en");
  return { webBase, detailPath, referer: pageUrl.toString() };
}
function collectStreams(playData) {
  var _a, _b;
  const streams = Array.isArray(playData == null ? void 0 : playData.streams) ? [...playData.streams] : [];
  for (const [key, format] of [["netDash", "DASH"], ["netHls", "HLS"]]) {
    const value = (_b = playData == null ? void 0 : playData[key]) != null ? _b : (_a = playData == null ? void 0 : playData.data) == null ? void 0 : _a[key];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of values) {
      if (typeof item === "string")
        streams.push({ url: item, format });
      else if (item && typeof item === "object") {
        if (item.url || item.playUrl || item.resourceLink || item.streamUrl)
          streams.push(__spreadProps(__spreadValues({}, item), { format: item.format || format }));
        else
          for (const [resolution, url] of Object.entries(item)) {
            if (typeof url === "string" && /^https?:\/\//i.test(url))
              streams.push({ url, resolution, format });
            else if (url && typeof url === "object")
              streams.push(__spreadProps(__spreadValues({}, url), { resolution: url.resolution || resolution, format: url.format || format }));
          }
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return streams.filter((stream) => {
    const key = (stream == null ? void 0 : stream.url) || (stream == null ? void 0 : stream.playUrl) || (stream == null ? void 0 : stream.resourceLink) || (stream == null ? void 0 : stream.streamUrl);
    if (!key || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
function getAudioLabel(stream, fallbackLanguage) {
  var _a, _b;
  const rawLanguage = [stream.languageName, stream.lanName, stream.language, stream.lan, fallbackLanguage].find((value) => typeof value === "string" && value.trim()) || "Unknown";
  let language = rawLanguage.replace(/\bdub\b/gi, " ").replace(/\baudio\b/gi, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const languageNames = {
    ar: "Arabic",
    bn: "Bengali",
    de: "German",
    en: "English",
    es: "Spanish",
    fr: "French",
    hi: "Hindi",
    id: "Indonesian",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    ml: "Malayalam",
    mr: "Marathi",
    pt: "Portuguese",
    ru: "Russian",
    ta: "Tamil",
    te: "Telugu",
    th: "Thai",
    tr: "Turkish",
    ur: "Urdu",
    vi: "Vietnamese",
    zh: "Chinese"
  };
  const languageCode = (_b = (_a = language.match(/^([a-z]{2,3})(?:\s|$)/i)) == null ? void 0 : _a[1]) == null ? void 0 : _b.toLowerCase();
  if (languageCode && languageNames[languageCode]) {
    language = languageNames[languageCode];
  } else if (language) {
    language = language.charAt(0).toUpperCase() + language.slice(1);
  } else {
    language = "Unknown";
  }
  return `${language} Audio`;
}
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes || !detailRes.data || !detailRes.data.data)
      return [];
    const subjectData = detailRes.data.data;
    const playbackPage = getPlaybackPage(subjectData, subjectId);
    const subjectIds = [];
    let originalLang = "Original";
    const dubs = subjectData.dubs;
    if (Array.isArray(dubs)) {
      dubs.forEach((dub) => {
        if (dub.subjectId == subjectId) {
          originalLang = dub.lanName || "Original";
        } else {
          subjectIds.push({ id: dub.subjectId, lang: dub.lanName });
        }
      });
    }
    subjectIds.unshift({ id: subjectId, lang: originalLang });
    const allStreams = [];
    const playbackHeaders = {
      "Origin": playbackPage.webBase,
      "Referer": playbackPage.referer,
      "User-Agent": PLAYER_USER_AGENT,
      "x-request-lang": "en",
      "x-vip-restrict": "0",
      "x-no-high-risk-restrict": "0"
    };
    for (const item of subjectIds) {
      try {
        const playParams = new URLSearchParams({ subjectId: item.id, se: season, ep: episode, streamSignType: "1" });
        if (playbackPage.detailPath)
          playParams.set("detailPath", playbackPage.detailPath);
        playParams.set("supportCodecs[hevc]", "1");
        playParams.set("supportCodecs[h264]", "1");
        const playUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?${playParams.toString()}`;
        const playRes = yield movieBoxRequest("GET", playUrl, null, playbackHeaders);
        let hasValidStream = false;
        if (playRes && playRes.data && playRes.data.data) {
          const playData = playRes.data.data;
          const streamsList = collectStreams(playData);
          if (Array.isArray(streamsList) && streamsList.length > 0) {
            for (const stream of streamsList) {
              const rawStreamUrl = stream.url || stream.playUrl || stream.resourceLink || stream.streamUrl || "";
              const signCookie = stream.signCookie || null;
              const policyUrl = extractPolicyResource(signCookie);
              const finalStreamUrl = policyUrl || rawStreamUrl;
              if (!finalStreamUrl)
                continue;
              if (finalStreamUrl.includes("b164fbfb4347792950bdfbfb563d39d9"))
                continue;
              if (finalStreamUrl === rawStreamUrl && rawStreamUrl.includes("/other/2026/09/"))
                continue;
              let formatType = getFormatType(finalStreamUrl);
              if (stream.format) {
                const declaredFormat = String(stream.format).toUpperCase();
                formatType = ["DASH", "HLS", "MP4", "MKV"].includes(declaredFormat) ? declaredFormat : getFormatType(finalStreamUrl);
              }
              const qualLabel = stream.resolutions || stream.resolution || stream.quality || "Auto";
              const qualNum = parseQualityNumber(qualLabel);
              const quality = qualNum ? `${qualNum}p` : "Auto";
              const audioLabel = getAudioLabel(stream, item.lang);
              const streamId = stream.id || `${item.id}|${season}|${episode}`;
              const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
              const signHeaderKey = stream.signHeaderKey || stream.sign_header_key || "Cookie";
              allStreams.push({
                name: "MovieBox",
                title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} - ${quality} (${audioLabel}) [${formatType}]`,
                url: finalStreamUrl,
                quality,
                headers: __spreadValues(__spreadValues({}, playbackHeaders), signCookie ? { [signHeaderKey]: signCookie } : {}),
                subtitles,
                provider: "moviebox"
              });
              hasValidStream = true;
            }
          }
          if (!hasValidStream) {
            let detectors = playData.resourceDetectors;
            if (!Array.isArray(detectors)) {
              detectors = subjectData.resourceDetectors;
            }
            if (Array.isArray(detectors)) {
              for (const detector of detectors) {
                if (Array.isArray(detector.resolutionList)) {
                  for (const video of detector.resolutionList) {
                    if (!video.resourceLink)
                      continue;
                    const se = video.se != null ? video.se : 0;
                    const ep = video.ep != null ? video.ep : 0;
                    if ((season > 0 || episode > 0) && (se !== season || ep !== episode)) {
                      continue;
                    }
                    const quality = video.resolution ? `${video.resolution}p` : "Auto";
                    const audioLabel = getAudioLabel({}, item.lang);
                    allStreams.push({
                      name: "MovieBox",
                      title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} - ${quality} (${audioLabel}) [Fallback]`,
                      url: video.resourceLink,
                      quality,
                      headers: __spreadValues({}, playbackHeaders),
                      provider: "moviebox"
                    });
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[MovieBox Stream Fetch Error] ID: ${item.id}`, err.message);
      }
    }
    const qualityRank = {
      "2160p": 2160,
      "4k": 2160,
      "1440p": 1440,
      "1080p": 1080,
      "720p": 720,
      "480p": 480,
      "360p": 360,
      "240p": 240,
      "auto": 1
    };
    allStreams.sort((a, b) => {
      var _a, _b;
      const qa = qualityRank[(_a = a.quality) == null ? void 0 : _a.toLowerCase()] || 0;
      const qb = qualityRank[(_b = b.quality) == null ? void 0 : _b.toLowerCase()] || 0;
      return qb - qa;
    });
    return allStreams;
  });
}
function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const subtitles = [];
    try {
      const streamCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const capRes = yield movieBoxRequest("GET", streamCapUrl, null);
      if (capRes && capRes.data && capRes.data.data && Array.isArray(capRes.data.data.extCaptions)) {
        capRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.language || cap.lanName || cap.lan || "en",
              name: `${cap.lanName || cap.language || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {
    }
    try {
      const extCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const extRes = yield movieBoxRequest("GET", extCapUrl, null);
      if (extRes && extRes.data && extRes.data.data && Array.isArray(extRes.data.data.extCaptions)) {
        extRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.lan || cap.lanName || cap.language || "en",
              name: `${cap.lanName || cap.lan || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {
    }
    return subtitles;
  });
}
module.exports = { getStreams };

/* CLOUDBANK_MERGED_ENGINE_END:moviebox-v2 */
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
cloudbankMergedEngines.push({ id: "moviebox-v3", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:moviebox-v3 */
/**
 * moviebox - Built from src/moviebox/
 * Generated: 2026-06-01T21:56:44.519Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/moviebox/constants.js
var API_BASE = "https://api3.aoneroom.com";
var KEY_B64_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
var KEY_B64_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var BRAND_MODELS = {
  "Samsung": ["SM-S918B", "SM-A528B", "SM-M336B"],
  "Xiaomi": ["2201117TI", "M2012K11AI", "Redmi Note 11"],
  "OnePlus": ["LE2111", "CPH2449", "IN2023"],
  "Google": ["Pixel 6", "Pixel 7", "Pixel 8"],
  "Realme": ["RMX3085", "RMX3360", "RMX3551"]
};
var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "3.0.03.0529.03",
  version_code: 50020042
};

// src/moviebox/utils.js
var import_crypto_js = __toESM(require("crypto-js"));
var SECRET_KEY_DEFAULT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_DEFAULT).toString(import_crypto_js.default.enc.Utf8)
);
var SECRET_KEY_ALT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_ALT).toString(import_crypto_js.default.enc.Utf8)
);
var deviceId = "";
var selectedBrand = "";
var selectedModel = "";
function initializeSession() {
  if (!deviceId) {
    let chars = "0123456789abcdef";
    for (let i = 0; i < 32; i++) {
      deviceId += chars[Math.floor(Math.random() * 16)];
    }
    const brands = Object.keys(BRAND_MODELS);
    selectedBrand = brands[Math.floor(Math.random() * brands.length)];
    const models = BRAND_MODELS[selectedBrand];
    selectedModel = models[Math.floor(Math.random() * models.length)];
  }
}
function md5(input) {
  return import_crypto_js.default.MD5(input).toString(import_crypto_js.default.enc.Hex);
}
function hmacMd5(key, data) {
  return import_crypto_js.default.HmacMD5(data, key).toString(import_crypto_js.default.enc.Base64);
}
function generateXClientToken(timestamp) {
  const ts = (timestamp || Date.now()).toString();
  const reversed = ts.split("").reverse().join("");
  const hash = md5(reversed);
  return `${ts},${hash}`;
}
function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  let path = "";
  let query = "";
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
    const params = Array.from(urlObj.searchParams.keys()).sort();
    if (params.length > 0) {
      query = params.map((key) => {
        const values = urlObj.searchParams.getAll(key);
        return values.map((val) => `${key}=${val}`).join("&");
      }).join("&");
    }
  } catch (e) {
    if (url.includes("?")) {
      const parts = url.split("?");
      path = parts[0].replace(/https?:\/\/[^\/]+/, "");
      const qParts = parts[1].split("&").sort();
      query = qParts.join("&");
    } else {
      path = url.replace(/https?:\/\/[^\/]+/, "");
    }
  }
  const canonicalUrl = query ? `${path}?${query}` : path;
  let bodyHash = "";
  let bodyLength = "";
  if (body) {
    const bodyWords = import_crypto_js.default.enc.Utf8.parse(body);
    const totalBytes = bodyWords.sigBytes;
    bodyHash = md5(bodyWords);
    bodyLength = totalBytes.toString();
  }
  return `${method.toUpperCase()}
${accept || ""}
${contentType || ""}
${bodyLength}
${timestamp}
${bodyHash}
` + canonicalUrl;
}
function generateXTrSignature(method, accept, contentType, url, body, useAltKey = false, customTimestamp = null) {
  const timestamp = customTimestamp || Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  const secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  const signatureB64 = hmacMd5(secret, canonical);
  return `${timestamp}|2|${signatureB64}`;
}
function movieBoxRequest(_0, _1) {
  return __async(this, arguments, function* (method, url, body = null, customHeaders = {}) {
    initializeSession();
    const timestamp = Date.now();
    const xClientToken = generateXClientToken(timestamp);
    const headerContentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xTrSignature = generateXTrSignature(method, accept, headerContentType, url, body, false, timestamp);
    const xClientInfo = JSON.stringify(__spreadProps(__spreadValues({}, PACKAGE_INFO), {
      os: "android",
      os_version: "16",
      device_id: deviceId,
      install_store: "ps",
      gaid: "d7578036d13336cc",
      brand: selectedBrand.toLowerCase(),
      model: selectedModel,
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "IN",
      timezone: "Asia/Calcutta",
      sp_code: ""
    }));
    const headers = __spreadValues({
      "Accept": accept,
      "Content-Type": headerContentType,
      "x-client-token": xClientToken,
      "x-tr-signature": xTrSignature,
      "User-Agent": `${PACKAGE_INFO.package_name}/${PACKAGE_INFO.version_code} (Linux; U; Android 16; en_IN; ${selectedModel}; Build/BP22.250325.006; Cronet/133.0.6876.3)`,
      "x-client-info": xClientInfo,
      "x-client-status": "0"
    }, customHeaders);
    const options = {
      method,
      headers
    };
    if (body) {
      options.body = body;
    }
    let retries = 2;
    while (retries > 0) {
      try {
        const res = yield fetch(url, options);
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            retries--;
            yield new Promise((resolve) => setTimeout(resolve, 1e3));
            continue;
          }
          return null;
        }
        const text = yield res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parsed = text;
        }
        return {
          data: parsed,
          headers: res.headers
        };
      } catch (err) {
        retries--;
        if (retries === 0) {
          console.error("[MovieBox Request Error]", err.message);
          return null;
        }
        yield new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
    return null;
  });
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Connection": "keep-alive"
        }
      });
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id,
        originalTitle: data.original_title || data.original_name
      };
    } catch (e) {
      console.error("[MovieBox TMDB Error]", e.message);
      return null;
    }
  });
}
function normalizeTitle(s) {
  if (!s)
    return "";
  return s.replace(/\[.*?\]/g, " ").replace(/\(.*?|/g, " ").replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ").trim().toLowerCase().replace(/:/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
}
function parseQualityNumber(value) {
  const match = String(value || "").match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : 0;
}
function getFormatType(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes(".mpd"))
    return "DASH";
  if (u.includes(".m3u8"))
    return "HLS";
  if (u.includes(".mp4"))
    return "MP4";
  if (u.includes(".mkv"))
    return "MKV";
  return "VIDEO";
}

// src/moviebox/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details)
      return [];
    let subjects = yield searchMovieBox(details.title);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      const s = mediaType === "tv" ? seasonNum : 0;
      const e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(bestMatch.subjectId, s, e, details.title, mediaType);
    }
    console.log(`[MovieBox] No matching content found for: ${details.title}`);
    return [];
  });
}
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const response = yield movieBoxRequest("POST", url, body);
    if (response && response.data && response.data.data && response.data.data.results) {
      let allSubjects = [];
      response.data.data.results.forEach((group) => {
        if (group.subjects) {
          allSubjects = allSubjects.concat(group.subjects);
        }
      });
      return allSubjects;
    }
    return [];
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  const normTmdbTitle = normalizeTitle(tmdbTitle);
  const targetType = mediaType === "movie" ? 1 : 2;
  let bestMatch = null;
  let bestScore = 0;
  for (const subject of subjects) {
    if (subject.subjectType !== targetType)
      continue;
    const title = subject.title;
    const normTitle = normalizeTitle(title);
    const year = subject.year || (subject.releaseDate ? subject.releaseDate.substring(0, 4) : null);
    let score = 0;
    if (normTitle === normTmdbTitle)
      score += 50;
    else if (normTitle.includes(normTmdbTitle) || normTmdbTitle.includes(normTitle))
      score += 15;
    if (tmdbYear && year && tmdbYear == year)
      score += 35;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = subject;
    }
  }
  if (bestScore >= 40)
    return bestMatch;
  return null;
}
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes || !detailRes.data || !detailRes.data.data)
      return [];
    const xUserHeader = detailRes.headers ? detailRes.headers.get("x-user") : null;
    let token = null;
    if (xUserHeader) {
      try {
        const xUserJson = JSON.parse(xUserHeader);
        token = xUserJson.token;
      } catch (e) {
      }
    }
    const subjectIds = [];
    let originalLang = "Original";
    const dubs = detailRes.data.data.dubs;
    if (Array.isArray(dubs)) {
      dubs.forEach((dub) => {
        if (dub.subjectId == subjectId) {
          originalLang = dub.lanName || "Original";
        } else {
          subjectIds.push({ id: dub.subjectId, lang: dub.lanName });
        }
      });
    }
    subjectIds.unshift({ id: subjectId, lang: originalLang });
    const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
    const allStreams = [];
    for (const item of subjectIds) {
      try {
        const playUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${item.id}&se=${season}&ep=${episode}`;
        const playRes = yield movieBoxRequest("GET", playUrl, null, authHeaders);
        if (playRes && playRes.data && playRes.data.data) {
          const playData = playRes.data.data;
          const streamsList = playData.streams;
          if (Array.isArray(streamsList) && streamsList.length > 0) {
            for (const stream of streamsList) {
              if (!stream.url)
                continue;
              const formatType = getFormatType(stream.url);
              const qualLabel = stream.resolutions || stream.quality || "Auto";
              const qualNum = parseQualityNumber(qualLabel);
              const quality = qualNum ? `${qualNum}p` : "Auto";
              const streamId = stream.id || `${item.id}|${season}|${episode}`;
              const subtitles = yield fetchSubtitles(item.id, streamId, authHeaders, item.lang);
              allStreams.push({
                name: "MovieBox",
                title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${quality} [${formatType}]`,
                url: stream.url,
                quality,
                headers: __spreadValues({
                  "Referer": API_BASE,
                  "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)`
                }, stream.signCookie ? { "Cookie": stream.signCookie } : {}),
                subtitles,
                provider: "moviebox"
              });
            }
          } else if (Array.isArray(playData.resourceDetectors)) {
            for (const detector of playData.resourceDetectors) {
              if (Array.isArray(detector.resolutionList)) {
                for (const video of detector.resolutionList) {
                  if (!video.resourceLink)
                    continue;
                  const quality = video.resolution ? `${video.resolution}p` : "Auto";
                  const se = video.se || season;
                  const ep = video.ep || episode;
                  allStreams.push({
                    name: "MovieBox",
                    title: `${mediaTitle} S${se}E${ep} (${item.lang}) - ${quality} [Fallback]`,
                    url: video.resourceLink,
                    quality,
                    headers: {
                      "Referer": API_BASE,
                      "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)`
                    },
                    provider: "moviebox"
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[MovieBox Stream Fetch Error] ID: ${item.id}`, err.message);
      }
    }
    return allStreams;
  });
}
function fetchSubtitles(subjectId, streamId, authHeaders, langLabel) {
  return __async(this, null, function* () {
    const subtitles = [];
    try {
      const streamCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const capRes = yield movieBoxRequest("GET", streamCapUrl, null, authHeaders);
      if (capRes && capRes.data && capRes.data.data && Array.isArray(capRes.data.data.extCaptions)) {
        capRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.language || cap.lanName || cap.lan || "en",
              name: `${cap.lanName || cap.language || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {
    }
    try {
      const extCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const extRes = yield movieBoxRequest("GET", extCapUrl, null, authHeaders);
      if (extRes && extRes.data && extRes.data.data && Array.isArray(extRes.data.data.extCaptions)) {
        extRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.lan || cap.lanName || cap.language || "en",
              name: `${cap.lanName || cap.lan || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {
    }
    return subtitles;
  });
}
module.exports = { getStreams };

/* CLOUDBANK_MERGED_ENGINE_END:moviebox-v3 */
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
module.exports = cloudbankVersionMerge(cloudbankMergedEngines, "moviebox");
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
module.exports = cloudbankDisplayInstall(module.exports, "MovieBox", "moviebox");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
