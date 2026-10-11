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

var PROVIDER = "CineMode";
var VERSION = "2.1.7";
var BASE = "https://cinemode.fun";
var TMDB_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var UA =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var BUDGET_MS = 9300;
var PAGE_TIMEOUT_MS = 3000;
var BUNDLE_TIMEOUT_MS = 1350;
var ROUTE_WEBVIEW_MS = 3900;
var PLAYER_WEBVIEW_MS = 5200;
var VERIFY_MS = 900;

var MEDIA_RE = /\.(?:m3u8|mp4|m4v|webm)(?:$|[?#])/i;
var HLS_RE = /\.m3u8(?:$|[?#])/i;

var BLOCKED = [
  "effectivecpmnetwork",
  "doubleclick",
  "googlesyndication",
  "googleadservices",
  "adservice.google",
  "popads",
  "popcash",
  "propellerads",
  "onclicka",
  "adsterra",
  "exoclick",
  "/ads/",
  "/vast"
];

var PLAYER_HINTS = [
  ".m3u8",
  ".mp4",
  ".m4v",
  ".webm",
  "/embed/",
  "/embed-",
  "/player/",
  "/watch/",
  "/sora/",
  "vidsrc",
  "vidlink",
  "vidfast",
  "autoembed",
  "2embed",
  "embedsu",
  "multiembed",
  "player4u",
  "moviesapi",
  "superembed",
  "smashystream",
  "streamwish",
  "filelions",
  "streamtape",
  "abyss",
  "video"
];

var ZXC_MATCH = [
  ".m3u8",
  ".mp4",
  ".m4v",
  ".webm",
  "workers.dev",
  "berkas.",
  "valstrax.",
  "burat.",
  "zinogre.",
  "daedalus.",
  "/backend_/sources/",
  "/api/",
  "/source",
  "/sources",
  "/playlist",
  "/manifest",
  "/master",
  "/playback",
  "/hls/",
  "/stream/",
  "/streams/",
  "getsource",
  "get-source"
];


/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function sharedTmdb(url, fallback) {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return globalThis.vueoDiscoveryContext(url)
      .then(function(ctx) {
        if (ctx && ctx.tmdb) return ctx.tmdb;
        throw new Error("empty shared TMDB");
      })
      .catch(fallback);
  }
  return fallback();
}

function timeout(promise, ms, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "operation") + " timeout"));
    }, Math.max(1, Number(ms || 1)));

    Promise.resolve(promise).then(
      function(value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function blocked(url) {
  var s = String(url || "").toLowerCase();
  for (var i = 0; i < BLOCKED.length; i++) {
    if (s.indexOf(BLOCKED[i]) !== -1) return true;
  }
  return false;
}

function hostOf(url) {
  try { return new URL(String(url || "")).hostname.toLowerCase(); }
  catch (_) { return ""; }
}

function originOf(url) {
  try { return new URL(String(url || "")).origin; }
  catch (_) { return ""; }
}

function absUrl(value, base) {
  var s = String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .trim();

  if (!s || /^javascript:|^data:/i.test(s)) return "";
  try { return new URL(s, base || BASE + "/").toString(); }
  catch (_) { return ""; }
}

function fetchText(url, ms, headers) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };
  Object.keys(headers || {}).forEach(function(k) { h[k] = headers[k]; });

  return timeout(
    fetch(url, { method: "GET", headers: h, redirect: "follow" })
      .then(function(res) {
        return res.text().then(function(text) {
          return {
            ok: res.ok,
            status: res.status,
            url: res.url || url,
            text: String(text || ""),
            headers: res.headers
          };
        });
      }),
    ms,
    "fetch"
  );
}

function fetchJson(url, ms) {
  return timeout(
    fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      redirect: "follow"
    }).then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    ms,
    "json"
  );
}

function tmdbInfo(id, type) {
  var endpoint = type === "tv" ? "tv" : "movie";
  var url =
    "https://api.themoviedb.org/3/" + endpoint + "/" +
    encodeURIComponent(id) +
    "?api_key=" + TMDB_KEY;

  return sharedTmdb(url, function() {
    return fetchJson(url, 1500);
  }).then(function(data) {
    return {
      title: String(data && (data.title || data.name) || "").trim(),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0]
    };
  });
}


function zxcPlayerUrls(id, type, season, episode) {
  var base =
    type === "tv"
      ? "https://zxcstream.xyz/player/tv/" +
        encodeURIComponent(id) + "/" +
        encodeURIComponent(season) + "/" +
        encodeURIComponent(episode)
      : "https://zxcstream.xyz/player/movie/" +
        encodeURIComponent(id);

  return [
    base + "?autoplay=true&server=1",
    base + "?autoplay=true&server=2"
  ];
}

function isZxc(url) {
  return /(?:^|\.)zxc(?:stream|prime)\.xyz$/i.test(hostOf(url)) ||
         /(?:^|\.)player\.zxc(?:stream|prime)\.xyz$/i.test(hostOf(url));
}

function isWorkerBootstrap(url) {
  var h = hostOf(url);
  return /(?:^|\.)workers\.dev$/i.test(h) ||
         /(?:^|\.)(?:berkas|valstrax|burat|zinogre|daedalus)\./i.test(h);
}


function isStaticAssetUrl(url) {
  var s = String(url || "");
  var path = "";
  try { path = new URL(s).pathname.toLowerCase(); }
  catch (_) { path = s.toLowerCase(); }

  if (/\/_next\/static\//i.test(path)) return true;
  if (/\/static\/(?:media|chunks|css)\//i.test(path)) return true;
  if (/\.(?:woff2?|ttf|otf|eot|css|js|map|png|jpe?g|gif|svg|ico|avif|webp)(?:$|[?#])/i.test(path)) {
    return true;
  }
  return false;
}

function likelySourceEndpoint(url) {
  if (isStaticAssetUrl(url)) return false;

  try {
    var u = new URL(String(url || ""));
    var target = (u.pathname + "?" + u.searchParams.toString()).toLowerCase();

    return (
      /\/api\/|\/source(?:s)?(?:\/|$)|\/playlist(?:\/|$)|\/manifest(?:\/|$)|\/master(?:\/|$)|\/playback(?:\/|$)|\/hls\/|\/stream(?:s)?(?:\/|$)|getsource|get-source/.test(target)
    );
  } catch (_) {
    return false;
  }
}

function routeUrl(id, type) {
  return BASE + "/" + (type === "tv" ? "tv" : "movie") + "/" + encodeURIComponent(id);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pageMatches(html, info, id) {
  var raw = String(html || "");
  if (!raw) return false;
  if (raw.indexOf(String(id)) !== -1) return true;

  var text = visibleText(raw);
  var title = String(info && info.title || "").toLowerCase();
  var year = String(info && info.year || "");
  return !!title &&
    text.indexOf(title) !== -1 &&
    (!year || raw.indexOf(year) !== -1 || text.indexOf(year) !== -1);
}

function scriptUrls(html, pageUrl) {
  var out = [];
  var seen = {};
  var re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  var m;

  while ((m = re.exec(String(html || ""))) !== null) {
    var u = absUrl(m[1], pageUrl);
    if (!u || seen[u] || blocked(u)) continue;
    seen[u] = true;

    var score = 0;
    var l = u.toLowerCase();
    if (l.indexOf("/_next/") !== -1) score += 20;
    if (l.indexOf("page") !== -1) score += 10;
    if (l.indexOf("app") !== -1) score += 5;

    out.push({ url: u, score: score });
  }

  out.sort(function(a, b) { return b.score - a.score; });
  return out.slice(0, 7).map(function(x) { return x.url; });
}

function decodeLiteral(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function looksLikePlayer(url) {
  var u = String(url || "");
  if (!/^https?:\/\//i.test(u) || blocked(u)) return false;
  if (MEDIA_RE.test(u)) return true;

  var h = hostOf(u);
  if (!h || h === "cinemode.fun" || /themoviedb|tmdb|youtube|cloudflareinsights/i.test(h)) {
    return false;
  }

  var s = u.toLowerCase();
  return (
    /embed|player|watch|stream|video|movie|tv|vidsrc|vidlink|vidfast|2embed|autoembed|sora|abyss/.test(s)
  );
}

function specializePlayerUrl(url, id, type, season, episode) {
  var u = String(url || "").trim();
  if (!u) return "";

  u = u
    .replace(/\{(?:tmdb_?id|tmdb|id)\}/gi, String(id))
    .replace(/\$\{(?:tmdb_?id|tmdb|id)\}/gi, String(id))
    .replace(/\{season\}/gi, String(season))
    .replace(/\$\{season\}/gi, String(season))
    .replace(/\{episode\}/gi, String(episode))
    .replace(/\$\{episode\}/gi, String(episode));

  if (/[?&](?:tmdb|id)=$/i.test(u)) {
    u += encodeURIComponent(id);
  } else if (
    /\/(?:embed\/)?(?:movie|tv)\/$/i.test(u) ||
    /\/(?:movie|tv)\/embed\/$/i.test(u)
  ) {
    u += encodeURIComponent(id);
  }

  if (type === "tv" && String(u).indexOf(String(id)) !== -1) {
    if (!/[?&](?:season|s)=/i.test(u)) {
      u += (u.indexOf("?") === -1 ? "?" : "&") + "season=" + encodeURIComponent(season);
    }
    if (!/[?&](?:episode|e)=/i.test(u)) {
      u += "&episode=" + encodeURIComponent(episode);
    }
  }

  return u;
}

function bundlePlayerCandidates(text, pageUrl, id, type, season, episode) {
  var raw = decodeLiteral(String(text || ""));
  var out = [];
  var seen = {};

  function add(value) {
    var u = absUrl(value, pageUrl);
    if (!u) return;

    u = specializePlayerUrl(u, id, type, season, episode);
    if (!looksLikePlayer(u) || seen[u]) return;

    seen[u] = true;
    out.push(u);
  }

  var absRe = /https?:\/\/[^\s"'`<>\\]+/gi;
  var m;
  while ((m = absRe.exec(raw)) !== null) {
    add(m[0]);
    if (out.length >= 16) break;
  }

  var quoted = /["'`]([^"'`]{1,260})["'`]/g;
  while ((m = quoted.exec(raw)) !== null) {
    var s = String(m[1] || "");
    if (
      /embed|player|watch|vidsrc|vidlink|vidfast|2embed|autoembed|sora|abyss/i.test(s)
    ) {
      add(s);
    }
    if (out.length >= 20) break;
  }

  return out;
}

function inspectSiteBundles(page, id, type, season, episode) {
  var scripts = scriptUrls(page.text, page.url);
  var baseCandidates = bundlePlayerCandidates(
    page.text,
    page.url,
    id,
    type,
    season,
    episode
  );

  if (!scripts.length) {
    return Promise.resolve(baseCandidates);
  }

  console.log("[CineMode] site scripts=" + scripts.length);

  return Promise.all(
    scripts.map(function(u) {
      return fetchText(u, BUNDLE_TIMEOUT_MS, {
        "Accept": "*/*",
        "Referer": page.url
      }).then(function(x) {
        return x.ok ? x.text : "";
      }).catch(function() {
        return "";
      });
    })
  ).then(function(chunks) {
    var all = baseCandidates.slice();
    var seen = {};
    all.forEach(function(u) { seen[u] = true; });

    chunks.forEach(function(js) {
      bundlePlayerCandidates(
        js,
        page.url,
        id,
        type,
        season,
        episode
      ).forEach(function(u) {
        if (!seen[u]) {
          seen[u] = true;
          all.push(u);
        }
      });
    });

    var hosts = [];
    var hostSeen = {};
    all.forEach(function(u) {
      var h = hostOf(u);
      if (h && !hostSeen[h]) {
        hostSeen[h] = true;
        hosts.push(h);
      }
    });

    console.log(
      "[CineMode] site player hints=" + all.length +
      (hosts.length ? " hosts=" + hosts.slice(0, 6).join("|") : "")
    );

    return all.slice(0, 6);
  });
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function interactions(type, season, episode) {
  var out = [];
  if (type === "tv") {
    out.push("season " + season);
    out.push("s" + season);
    out.push("episode " + episode);
    out.push("ep " + episode);
    out.push("e" + episode);
  }

  [
    "watch now",
    "start watching",
    "watch",
    "play now",
    "play",
    "continue",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ].forEach(function(x) { out.push(x); });

  return out;
}

function webviewCapture(startUrl, type, season, episode, timeoutMs, playerStage, refererOverride) {
  if (!nativeAvailable()) return Promise.resolve([]);

  console.log(
    "[CineMode] webview stage=" + (playerStage ? "player" : "route") +
    " host=" + hostOf(startUrl) +
    " popup=allow timeout=" + timeoutMs
  );

  return globalThis.webviewResolve(startUrl, {
    referer: refererOverride || BASE + "/",
    directLoad: true,
    timeoutMs: timeoutMs,
    finishAfterFirstMs: playerStage ? 350 : 850,

    /*
     * CineMode is ad-supported and its watch action can navigate away from
     * cinemode.fun. Do not suppress the player popup/tab and do not lock the
     * main frame to the CineMode hostname.
     */
    suppressPopups: false,
    lockMainFrameHost: false,

    interactionTexts: interactions(type, season, episode),
    viewportWidth: 1080,
    viewportHeight: 1080,
    clickX: 540,
    clickY: 600,
    clickDelaysMs: playerStage
      ? [350, 850, 1450, 2200, 2850]
      : [450, 950, 1550, 2350, 3200],

    match: playerStage ? ZXC_MATCH : PLAYER_HINTS,
    blocked: BLOCKED,
    injectAbyssHook: true
  }).then(function(result) {
    var rows = result && Array.isArray(result.streams) ? result.streams : [];
    console.log(
      "[CineMode] webview " + (playerStage ? "player" : "route") +
      " captured=" + rows.length
    );
    return rows;
  }).catch(function(error) {
    console.log(
      "[CineMode] webview " + (playerStage ? "player" : "route") +
      " fail=" + (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function sanitiseHeaders(input, referer) {
  var out = {};
  var src = input && typeof input === "object" ? input : {};

  Object.keys(src).forEach(function(k) {
    var l = String(k || "").toLowerCase();
    if (
      l === "host" ||
      l === "connection" ||
      l === "content-length" ||
      l === "accept-encoding" ||
      l === "range" ||
      l.indexOf("sec-fetch-") === 0
    ) return;
    out[k] = String(src[k]);
  });

  out["User-Agent"] = out["User-Agent"] || out["user-agent"] || UA;
  delete out["user-agent"];

  var r = out.Referer || out.referer || referer || BASE + "/";
  delete out.referer;
  out.Referer = r;

  return out;
}

function inferQuality(url, label) {
  var s = (String(url || "") + " " + String(label || "")).toLowerCase();
  if (/2160|4k/.test(s)) return "2160p";
  if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Auto";
}

function totalBytes(res) {
  var range = "";
  var len = "";
  try {
    range = res.headers.get("content-range") || "";
    len = res.headers.get("content-length") || "";
  } catch (_) {}

  var m = /\/(\d+)\s*$/.exec(range);
  if (m) return Number(m[1] || 0);
  return Number(len || 0);
}

function verifyDirect(item) {
  var url = String(item && item.url || "");
  if (!/^https?:\/\//i.test(url) || blocked(url)) return Promise.resolve(null);

  var headers = sanitiseHeaders(item.headers, item.referer);
  headers.Accept = "*/*";

  if (!HLS_RE.test(url)) headers.Range = "bytes=0-1023";

  return timeout(
    fetch(url, {
      method: "GET",
      headers: headers,
      redirect: "follow"
    }).then(function(res) {
      var ct = "";
      try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

      if (!(res.status === 200 || res.status === 206)) return null;
      if (/text\/html|application\/json/.test(ct)) return null;

      if (HLS_RE.test(url) || /mpegurl/.test(ct)) {
        return res.text().then(function(text) {
          if (String(text || "").indexOf("#EXTM3U") === -1 && !/mpegurl/.test(ct)) return null;
          item.url = res.url || url;
          item.headers = headers;
          return item;
        }).catch(function() {
          return /mpegurl/.test(ct) ? item : null;
        });
      }

      var total = totalBytes(res);
      if (
        (/^video\//.test(ct) || /octet-stream/.test(ct)) &&
        (total === 0 || total > 2 * 1024 * 1024)
      ) {
        item.url = res.url || url;
        item.headers = headers;
        return item;
      }
      return null;
    }),
    VERIFY_MS,
    "verify"
  ).catch(function() {
    return null;
  });
}


function zxcPlayerReferer(tmdbId, type, season, episode) {
  if (type === "tv") {
    return "https://player.zxcstream.xyz/player/tv/" +
      encodeURIComponent(tmdbId) + "/" +
      encodeURIComponent(season) + "/" +
      encodeURIComponent(episode);
  }
  return "https://player.zxcstream.xyz/player/movie/" +
    encodeURIComponent(tmdbId);
}

function isNoiseRequest(url) {
  var h = hostOf(url);
  var s = String(url || "").toLowerCase();

  if (!h) return true;
  if (isStaticAssetUrl(url)) return true;
  if (/google-analytics|googletagmanager|cloudflareinsights|vercel-insights/.test(h)) return true;
  if (/favicon|registersw|service-worker|manifest\.json/.test(s)) return true;
  return false;
}

function genericSessionCandidate(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  if (isNoiseRequest(url) || blocked(url)) return false;
  if (isZxc(url) && /\/player\//i.test(String(url || ""))) return false;
  if (likelySourceEndpoint(url)) return false;

  /*
   * After ZXC's protected /backend_/sources call, the actual media/CDN
   * request may be extensionless. Keep any remaining non-static request as
   * a candidate and let verifyDirect decide by response content-type.
   */
  return true;
}

function capturedRows(rows, fallbackReferer) {
  var direct = [];
  var players = [];
  var endpoints = [];
  var session = [];
  var seenDirect = {};
  var seenPlayer = {};
  var seenEndpoint = {};
  var seenSession = {};

  (rows || []).forEach(function(row) {
    if (!row || !row.url) return;
    var url = String(row.url).trim();
    if (!url || blocked(url) || isNoiseRequest(url)) return;

    var referer =
      String(row.referer || row.referrer || fallbackReferer || BASE + "/");

    if (MEDIA_RE.test(url)) {
      if (seenDirect[url]) return;
      seenDirect[url] = true;
      direct.push({
        url: url,
        referer: referer,
        headers: sanitiseHeaders(row.headers, referer),
        label: row.label || "ZXC media",
        quality: inferQuality(url, row.label)
      });
      return;
    }

    if (likelySourceEndpoint(url)) {
      if (seenEndpoint[url]) return;
      seenEndpoint[url] = true;
      endpoints.push({
        url: url,
        referer: referer,
        headers: sanitiseHeaders(row.headers, referer),
        label: row.label || "source",
        method: row.method || row.requestMethod || "",
        body: row.body || row.postData || row.requestBody || ""
      });
      return;
    }

    if (isZxc(url) && /\/player\//i.test(url)) return;

    if (isWorkerBootstrap(url)) {
      if (!seenPlayer[url]) {
        seenPlayer[url] = true;
        players.push(url);
      }
      return;
    }

    if (genericSessionCandidate(url)) {
      if (!seenSession[url]) {
        seenSession[url] = true;
        session.push({
          url: url,
          referer: referer,
          headers: sanitiseHeaders(row.headers, referer),
          label: row.label || "ZXC session",
          quality: inferQuality(url, row.label)
        });
      }
      return;
    }

    if (!looksLikePlayer(url)) return;
    if (seenPlayer[url]) return;
    seenPlayer[url] = true;
    players.push(url);
  });

  return {
    direct: direct,
    players: players,
    endpoints: endpoints,
    session: session
  };
}

function endpointMeta(url) {
  try {
    var u = new URL(String(url || ""));
    var keys = [];
    u.searchParams.forEach(function(_, k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
    return {
      host: u.hostname,
      path: u.pathname,
      params: keys.join(",")
    };
  } catch (_) {
    return { host: hostOf(url), path: "?", params: "" };
  }
}

function printableKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.keys(value).slice(0, 16).join(",");
}

function tryJson(text) {
  var raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  return null;
}

function maybeB64Decode(value) {
  var raw = String(value || "").trim();
  if (raw.length < 20 || raw.length > 12000) return "";

  var compact = raw.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_=-]+$/.test(compact)) return "";

  compact = compact.replace(/-/g, "+").replace(/_/g, "/");
  while (compact.length % 4) compact += "=";

  try {
    if (typeof atob === "function") {
      var bin = atob(compact);
      var out = "";
      for (var i = 0; i < bin.length; i++) {
        var c = bin.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) {
          out += String.fromCharCode(c);
        } else {
          return "";
        }
      }
      return out;
    }
  } catch (_) {}

  try {
    return Buffer.from(compact, "base64").toString("utf8");
  } catch (_) {}

  return "";
}

function collectNestedStrings(value, out, depth) {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    out.push(value);

    var nested = tryJson(value);
    if (nested) collectNestedStrings(nested, out, depth + 1);

    var decoded = maybeB64Decode(value);
    if (decoded && decoded !== value) {
      out.push(decoded);
      var nested2 = tryJson(decoded);
      if (nested2) collectNestedStrings(nested2, out, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 40).forEach(function(v) {
      collectNestedStrings(v, out, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    Object.keys(value).slice(0, 60).forEach(function(k) {
      collectNestedStrings(value[k], out, depth + 1);
    });
  }
}

function sourceCandidatesFromResponse(text, baseUrl, referer, headers) {
  var strings = [];
  var parsed = tryJson(text);

  if (parsed) {
    collectNestedStrings(parsed, strings, 0);
  } else {
    strings.push(String(text || ""));
  }

  var merged = strings.join("\n");
  return extractMediaCandidates(merged, baseUrl, referer, headers);
}

function extractMediaCandidates(text, baseUrl, referer, headers) {
  var raw = decodeLiteral(String(text || ""));
  var out = [];
  var seen = {};

  function add(value) {
    var source = String(value || "").trim();
    if (!source) return;

    /*
     * Also accept protocol-relative and relative HLS/API paths from JSON.
     */
    var u = absUrl(source, baseUrl);
    if (!u || seen[u] || blocked(u)) return;
    seen[u] = true;

    if (
      MEDIA_RE.test(u) ||
      /m3u8|playlist|manifest|master|playback|\/hls\/|stream|video/i.test(u)
    ) {
      out.push({
        url: u,
        referer: referer || baseUrl,
        headers: headers || {},
        label: "ZXC source",
        quality: inferQuality(u, "")
      });
    }
  }

  var m;

  var absolute = /https?:\\?\/\\?\/[^\s"'`<>\\]+/gi;
  while ((m = absolute.exec(raw)) !== null && out.length < 24) add(m[0]);

  var protocolRelative = /["'](\/\/[^"'<>\\]+)["']/gi;
  while ((m = protocolRelative.exec(raw)) !== null && out.length < 24) add(m[1]);

  var props =
    /["'](?:url|file|src|source|sources|stream|playlist|manifest|playback|video)["']\s*:\s*["']([^"']+)["']/gi;
  while ((m = props.exec(raw)) !== null && out.length < 24) add(m[1]);

  var relative =
    /["'](\/[^"']*(?:m3u8|playlist|manifest|master|playback|hls|stream|video)[^"']*)["']/gi;
  while ((m = relative.exec(raw)) !== null && out.length < 24) add(m[1]);

  return out;
}

function resolveCapturedEndpoints(rows, tmdbId, type, season, episode) {
  var list = (rows || []).slice(0, 3);
  if (!list.length) return Promise.resolve(null);

  var playerRef = zxcPlayerReferer(tmdbId, type, season, episode);
  var playerOrigin = "https://player.zxcstream.xyz";

  return Promise.all(list.map(function(row, index) {
    var captured = sanitiseHeaders(row.headers, playerRef);
    var headers = {};

    Object.keys(captured || {}).forEach(function(k) {
      headers[k] = captured[k];
    });

    delete headers.Range;
    headers["User-Agent"] = headers["User-Agent"] || UA;
    headers["Accept"] = "application/json,text/plain,*/*";
    headers["Referer"] = playerRef;
    headers["Origin"] = playerOrigin;
    headers["Sec-Fetch-Dest"] = "empty";
    headers["Sec-Fetch-Mode"] = "cors";
    headers["Sec-Fetch-Site"] = "same-site";

    var method = String(row.method || "GET").toUpperCase();
    if (method !== "POST") method = "GET";

    var options = {
      method: method,
      headers: headers,
      redirect: "follow"
    };

    if (method === "POST" && row.body) {
      options.body = row.body;
    }

    var meta = endpointMeta(row.url);
    console.log(
      "[CineMode] source-replay#" + (index + 1) +
      " host=" + meta.host +
      " path=" + meta.path +
      " method=" + method
    );

    return timeout(
      fetch(row.url, options).then(function(res) {
        var ct = "";
        try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

        return res.text().then(function(text) {
          var parsed = tryJson(text);
          var err = parsed && parsed.error ? String(parsed.error).replace(/\s+/g, " ").slice(0, 120) : "";

          console.log(
            "[CineMode] source-replay#" + (index + 1) +
            " status=" + res.status +
            " ct=" + (ct || "?") +
            (err ? " error='" + err + "'" : "")
          );

          if (!(res.status >= 200 && res.status < 300)) return null;

          var candidates = sourceCandidatesFromResponse(
            text,
            res.url || row.url,
            playerRef,
            headers
          );

          return verifyFirst(candidates, 4);
        });
      }),
      1100,
      "source replay"
    ).catch(function() {
      return null;
    });
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}

function verifyFirst(list, limit) {
  var rows = (list || []).slice(0, Math.max(1, Number(limit || 3)));
  if (!rows.length) return Promise.resolve(null);

  return Promise.all(rows.map(function(row) {
    return verifyDirect(row);
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}


function zxcApiProbeUrls(playerUrl, tmdbId, type, season, episode) {
  var origin = originOf(playerUrl);
  if (!origin) return [];

  var mediaPath =
    type === "tv"
      ? encodeURIComponent(tmdbId) + "/" + encodeURIComponent(season) + "/" + encodeURIComponent(episode)
      : encodeURIComponent(tmdbId);

  return [
    origin + "/api/source/" + type + "/" + mediaPath,
    origin + "/api/sources/" + type + "/" + mediaPath,
    origin + "/api/stream/" + type + "/" + mediaPath,
    origin + "/api/streams/" + type + "/" + mediaPath
  ];
}

function probeZxcApis(playerUrl, tmdbId, type, season, episode) {
  var urls = zxcApiProbeUrls(playerUrl, tmdbId, type, season, episode);

  return Promise.all(urls.map(function(apiUrl) {
    return timeout(fetch(apiUrl, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Referer": playerUrl,
        "Origin": originOf(playerUrl)
      },
      redirect: "follow"
    }).then(function(res) {
      var ct = "";
      try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

      return res.text().then(function(text) {
        if (!(res.status >= 200 && res.status < 300)) return null;

        var candidates = sourceCandidatesFromResponse(
          text,
          res.url || apiUrl,
          playerUrl,
          {
            "User-Agent": UA,
            "Referer": playerUrl,
            "Origin": originOf(playerUrl)
          }
        );

        if (candidates.length) {
          console.log(
            "[CineMode] api-probe hit path=" +
            (function() {
              try { return new URL(res.url || apiUrl).pathname; } catch (_) { return "?"; }
            })() +
            " candidates=" + candidates.length
          );
        }

        return verifyFirst(candidates, 4);
      });
    }), 1050, "zxc api probe").catch(function() {
      return null;
    });
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}


function resolveWorkerBootstrap(urls, type, season, episode, startedAt, parentUrl) {
  var seen = {};
  var list = (urls || []).filter(function(url) {
    url = String(url || "").trim();
    if (!/^https?:\/\//i.test(url) || blocked(url) || MEDIA_RE.test(url)) return false;
    if (isZxc(url) && /\/player\//i.test(url)) return false;
    if (seen[url]) return false;
    seen[url] = true;
    return true;
  }).slice(0, 2);
  if (!list.length) return Promise.resolve(null);

  function next(index) {
    if (index >= list.length) return Promise.resolve(null);

    var remaining = BUDGET_MS - (Date.now() - startedAt) - 500;
    if (remaining < 1100) return Promise.resolve(null);

    var waitMs = Math.min(2200, Math.max(1000, remaining));

    console.log(
      "[CineMode] child-bootstrap attempt=" + (index + 1) +
      "/" + list.length +
      " host=" + hostOf(list[index]) +
      " refererHost=" + hostOf(parentUrl || BASE) +
      " timeout=" + waitMs
    );

    return webviewCapture(
      list[index],
      type,
      season,
      episode,
      waitMs,
      true,
      parentUrl || BASE + "/"
    ).then(function(rows) {
      var parsed = capturedRows(rows, list[index]);

      console.log(
        "[CineMode] child parsed direct=" + parsed.direct.length +
        " session=" + parsed.session.length +
        " endpoints=" + parsed.endpoints.length
      );

      return verifyFirst(parsed.direct, 6).then(function(hit) {
        if (hit) return hit;

        if (parsed.endpoints.length) {
          return resolveCapturedEndpoints(
            parsed.endpoints,
            "",
            type,
            season,
            episode
          );
        }

        return null;
      });
    }).then(function(hit) {
      if (hit) {
        console.log(
          "[CineMode] CHILD MEDIA HIT host=" + hostOf(hit.url)
        );
        return hit;
      }
      return next(index + 1);
    });
  }

  return next(0);
}

function resolvePlayerPages(urls, type, season, episode, startedAt, tmdbId) {
  var seen = {};
  var list = [];

  zxcPlayerUrls(tmdbId, type, season, episode).forEach(function(u) {
    if (!seen[u]) {
      seen[u] = true;
      list.push(u);
    }
  });

  (urls || []).forEach(function(u) {
    u = String(u || "").trim();
    if (!u || seen[u] || blocked(u)) return;
    if (!looksLikePlayer(u) || MEDIA_RE.test(u)) return;

    if (isZxc(u) && /\/player\//i.test(u)) return;

    seen[u] = true;
    list.push(u);
  });

  list = list.slice(0, 2);
  if (!list.length) return Promise.resolve(null);

  console.log(
    "[CineMode] player-stage candidates=" + list.length +
    " mode=sequential-fast"
  );

  function processRows(rows, playerUrl) {
    var capturedPaths = (rows || []).slice(0, 8).map(function(row) {
      try {
        return new URL(String(row && row.url || "")).pathname;
      } catch (_) {
        return "?";
      }
    }).join("|");

    console.log(
      "[CineMode] player capture paths=" +
      (capturedPaths || "none")
    );

    var parsed = capturedRows(rows, playerUrl);

    console.log(
      "[CineMode] player parsed host=" + hostOf(playerUrl) +
      " direct=" + parsed.direct.length +
      " session=" + parsed.session.length +
      " endpoints=" + parsed.endpoints.length +
      " childPlayers=" + parsed.players.length
    );

    return verifyFirst(parsed.direct, 6).then(function(hit) {
      if (hit) {
        console.log("[CineMode] DIRECT HIT host=" + hostOf(hit.url));
        return hit;
      }

      /*
       * Important: replay protected /backend_/sources requests BEFORE trying
       * generic session URLs. The worker root seen in browser capture can be a
       * tiny HTML/bootstrap page, while the protected source endpoint contains
       * the actual media URL.
       */
      if (parsed.endpoints.length) {
        console.log(
          "[CineMode] protected source replay count=" +
          parsed.endpoints.length
        );

        return resolveCapturedEndpoints(
          parsed.endpoints,
          tmdbId,
          type,
          season,
          episode
        ).then(function(endpointHit) {
          if (endpointHit) {
            console.log(
              "[CineMode] SOURCE REPLAY HIT host=" +
              hostOf(endpointHit.url)
            );
            return endpointHit;
          }

          return resolveWorkerBootstrap(
            parsed.players,
            type,
            season,
            episode,
            startedAt,
            playerUrl
          ).then(function(workerHit) {
            if (workerHit) return workerHit;

            return verifyFirst(parsed.session, 4).then(function(sessionHit) {
              if (sessionHit) {
                console.log(
                  "[CineMode] browser-session HIT host=" +
                  hostOf(sessionHit.url)
                );
                return sessionHit;
              }
              return null;
            });
          });
        });
      }

      return resolveWorkerBootstrap(
        parsed.players,
        type,
        season,
        episode,
        startedAt,
        playerUrl
      ).then(function(workerHit) {
        if (workerHit) return workerHit;

        return verifyFirst(parsed.session, 4).then(function(sessionHit) {
          if (sessionHit) {
            console.log(
              "[CineMode] browser-session HIT host=" +
              hostOf(sessionHit.url)
            );
            return sessionHit;
          }
          return null;
        });
      });
    });
  }

  function tryPlayer(index) {
    if (index >= list.length) return Promise.resolve(null);

    var elapsed = Date.now() - startedAt;
    var remaining = BUDGET_MS - elapsed - 450;

    if (remaining < 1200) {
      console.log(
        "[CineMode] stop player fallback remaining=" +
        remaining + "ms"
      );
      return Promise.resolve(null);
    }

    /*
     * Only one WebView is active at a time. Previous Promise.all() could leave
     * server #2 alive after server #1 already returned captured rows, causing
     * the outer VUEO 10s runtime timeout.
     */
    var attemptCap = index === 0 ? 4200 : 2600;
    var eachTimeout = Math.min(
      PLAYER_WEBVIEW_MS,
      attemptCap,
      Math.max(1100, remaining - 1200)
    );

    console.log(
      "[CineMode] player attempt=" + (index + 1) +
      "/" + list.length +
      " timeout=" + eachTimeout
    );

    return webviewCapture(
      list[index],
      type,
      season,
      episode,
      eachTimeout,
      true
    ).then(function(rows) {
      return processRows(rows, list[index]);
    }).then(function(hit) {
      if (hit) {
        console.log("[CineMode] EARLY PLAYER RETURN");
        return hit;
      }
      return tryPlayer(index + 1);
    });
  }

  return tryPlayer(0);
}

function toStream(hit, info, type, season, episode) {
  var suffix = type === "tv"
    ? " S" + String(season).padStart(2, "0") +
      "E" + String(episode).padStart(2, "0")
    : "";

  return {
    name: PROVIDER,
    title: (info.title || PROVIDER) + suffix,
    url: hit.url,
    quality: hit.quality || inferQuality(hit.url, hit.label),
    type: "direct",
    headers: sanitiseHeaders(hit.headers, hit.referer || BASE + "/")
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  var id = String(tmdbId || "").trim();
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = Math.max(1, Number(season || 1));
  var e = Math.max(1, Number(episode || 1));

  if (!id) return Promise.resolve([]);

  console.log(
    "[CineMode] v" + VERSION + " TMDB=" + id + " type=" + type +
    (type === "tv" ? " S" + s + "E" + e : "")
  );

  var work = tmdbInfo(id, type).then(function(info) {
    var route = routeUrl(id, type);

    console.log(
      "[CineMode] title='" + info.title + "' year=" + info.year +
      " route=" + route
    );

    return fetchText(route, PAGE_TIMEOUT_MS, {
      "Accept": "text/html,application/xhtml+xml,*/*"
    }).then(function(page) {
      if (!page.ok || !page.text) {
        throw new Error("CineMode detail route HTTP " + page.status);
      }

      console.log(
        "[CineMode] real-site page status=" + page.status +
        " bytes=" + page.text.length +
        " identity=" + pageMatches(page.text, info, id)
      );

      return true;
    }).catch(function(error) {
      var message = error && error.message ? error.message : String(error);

      if (/timeout/i.test(message) && nativeAvailable()) {
        console.log(
          "[CineMode] page preflight soft-timeout -> continue WebView elapsed=" +
          (Date.now() - startedAt) + "ms"
        );
        return true;
      }

      throw error;
    }).then(function() {
      if (!nativeAvailable()) return [];

      console.log(
        "[CineMode] real-site ZXC player confirmed -> browser-session capture"
      );

      return resolvePlayerPages(
        [],
        type,
        s,
        e,
        startedAt,
        id
      ).then(function(hit) {
        if (!hit) return [];
        console.log(
          "[CineMode] PLAYER HIT host=" + hostOf(hit.url) +
          " q=" + (hit.quality || "Auto") +
          " elapsed=" + (Date.now() - startedAt) + "ms"
        );
        return [toStream(hit, info, type, s, e)];
      });
    });
  });

  return timeout(work, BUDGET_MS, "CineMode provider")
    .then(function(streams) {
      var list = Array.isArray(streams) ? streams : [];
      console.log(
        "[CineMode] v" + VERSION +
        " playable sources=" + list.length +
        " elapsed=" + (Date.now() - startedAt) + "ms"
      );
      return list;
    })
    .catch(function(error) {
      console.log(
        "[CineMode] fail=" +
        (error && error.message ? error.message : String(error)) +
        " elapsed=" + (Date.now() - startedAt) + "ms"
      );
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};

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
module.exports = cloudbankDisplayInstall(module.exports, "CineMode", "cinemode");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
