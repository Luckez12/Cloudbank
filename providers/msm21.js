"use strict";

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_PROVIDER_REPAIR_V17 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
function vueoTrace(stage, details) {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function vueoContextFromRaw(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

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



var PROVIDER_NAME = "MSM21";
var BASE_URL = "https://pencurimoviesubmalay26.site";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "ms-MY,ms;q=0.9,en-US;q=0.8,en;q=0.7"
};

var DNS_DEAD_HOSTS = Object.create(null);
var currentBaseUrl = BASE_URL.replace(/\/+$/, "");
var MIRROR_CACHE = Object.create(null);
var MIRROR_CACHE_TTL_MS = 90000;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "Request") + " timed out"));
    }, timeoutMs);

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

function requestText(url, headers, timeoutMs) {
  var request = fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (response && response.ok === false) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    return Promise.resolve(response.text()).then(function(text) {
      return {
        text: String(text || ""),
        url: String(response && response.url || url),
        status: Number(response && response.status || 0),
        headers: response && response.headers
      };
    });
  });

  return withSoftTimeout(request, timeoutMs || 1800, "MSM21 request " + url);
}

function requestJson(url, headers, timeoutMs) {
  return requestText(url, headers, timeoutMs).then(function(result) {
    try {
      return JSON.parse(result.text);
    } catch (_) {
      throw new Error("Invalid JSON from " + url);
    }
  });
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function updateBaseFromUrl(url) {
  try {
    var parsed = new URL(url);
    if (!parsed.origin) return;
    currentBaseUrl = trimSlash(parsed.origin);
  } catch (_) {}
}

function safeUrl(value, base) {
  var raw = decodeHtml(String(value || "").trim());
  if (!raw) return "";
  if (raw.indexOf("//") === 0) raw = "https:" + raw;
  try {
    return new URL(raw, base || currentBaseUrl).toString();
  } catch (_) {
    return raw;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&#(\d+);/g, function(full, number) {
      var code = Number(number);
      return isFinite(code) ? String.fromCharCode(code) : full;
    });
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttr(tag, name) {
  var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var quoted = new RegExp("\\b" + escaped + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  var match = String(tag || "").match(quoted);
  if (match) return decodeHtml(match[2]);

  var bare = new RegExp("\\b" + escaped + "\\s*=\\s*([^\\s>]+)", "i");
  match = String(tag || "").match(bare);
  return match ? decodeHtml(match[1]) : "";
}

function hasClass(tag, className) {
  var classes = getAttr(tag, "class").split(/\s+/);
  return classes.some(function(value) {
    return value.toLowerCase() === String(className || "").toLowerCase();
  });
}

function extractBalancedBlocksByClass(html, tagName, className) {
  var source = String(html || "");
  var escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var openRegex = new RegExp("<" + escapedTag + "\\b[^>]*>", "gi");
  var blocks = [];
  var open;

  while ((open = openRegex.exec(source))) {
    if (!hasClass(open[0], className)) continue;

    var start = open.index;
    var tokenRegex = new RegExp("<" + escapedTag + "\\b[^>]*>|<\\/" + escapedTag + "\\s*>", "gi");
    tokenRegex.lastIndex = openRegex.lastIndex;
    var depth = 1;
    var end = source.length;
    var token;

    while ((token = tokenRegex.exec(source))) {
      if (new RegExp("^<" + escapedTag + "\\b", "i").test(token[0])) depth += 1;
      else depth -= 1;
      if (depth === 0) {
        end = tokenRegex.lastIndex;
        break;
      }
    }

    blocks.push(source.slice(start, end));
    openRegex.lastIndex = end;
  }

  return blocks;
}

function extractBalancedBlocksByTag(html, tagName) {
  var source = String(html || "");
  var escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var openRegex = new RegExp("<" + escapedTag + "\\b[^>]*>", "gi");
  var blocks = [];
  var open;

  while ((open = openRegex.exec(source))) {
    var start = open.index;
    var tokenRegex = new RegExp("<" + escapedTag + "\\b[^>]*>|<\\/" + escapedTag + "\\s*>", "gi");
    tokenRegex.lastIndex = openRegex.lastIndex;
    var depth = 1;
    var end = source.length;
    var token;

    while ((token = tokenRegex.exec(source))) {
      if (new RegExp("^<" + escapedTag + "\\b", "i").test(token[0])) depth += 1;
      else depth -= 1;
      if (depth === 0) {
        end = tokenRegex.lastIndex;
        break;
      }
    }

    blocks.push(source.slice(start, end));
    openRegex.lastIndex = end;
  }

  return blocks;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 82;

  var leftWords = left.split(" ").filter(function(word) { return word.length > 1; });
  var rightWords = right.split(" ").filter(function(word) { return word.length > 1; });
  var set = Object.create(null);
  leftWords.forEach(function(word) { set[word] = true; });
  var matched = rightWords.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  var recall = matched / Math.max(rightWords.length, 1);
  var precision = matched / Math.max(leftWords.length, 1);
  return Math.round((recall * 0.72 + precision * 0.28) * 72);
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = Object.create(null);

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push({ title: text, priority: Number(priority || 0) });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var altRoot = data && data.alternative_titles;
  var altItems = altRoot && Array.isArray(altRoot.titles)
    ? altRoot.titles
    : altRoot && Array.isArray(altRoot.results)
      ? altRoot.results
      : [];

  altItems.forEach(function(item) {
    if (!item) return;
    var country = String(item.iso_3166_1 || "").toUpperCase();
    var priority = country === "US" || country === "GB"
      ? 86
      : country === "MY" || country === "ID"
        ? 82
        : 72;
    add(item.title || item.name, priority);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];

  translations.forEach(function(item) {
    var row = item && item.data && typeof item.data === "object" ? item.data : {};
    var lang = String(item && item.iso_639_1 || "").toLowerCase();
    var priority = lang === "en" ? 88 : (lang === "ms" || lang === "id" ? 80 : 68);
    add(row.title || row.name, priority);
  });

  output.sort(function(a, b) { return b.priority - a.priority; });
  return output.map(function(item) { return item.title; }).slice(0, 12);
}

function yearFrom(value) {
  var match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";
  return vueoSharedTmdb(url, function() {
    return requestJson(url, { "Accept": "application/json" }, 1400);
  }).then(function(data) {
    return {
      tmdbId: String(tmdbId),
      title: String(data && (data.title || data.name) || ""),
      originalTitle: String(data && (data.original_title || data.original_name) || ""),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0],
      aliases: collectTmdbAliases(data, mediaType)
    };
  });
}

function rewriteToCurrentDomain(url) {
  var absolute = safeUrl(url, currentBaseUrl);
  if (!absolute) return absolute;

  try {
    var target = new URL(absolute);
    var current = new URL(currentBaseUrl);
    var host = String(target.hostname || "").toLowerCase();
    var oldSite =
      host.indexOf("pencurimovie") !== -1 ||
      host.indexOf("movisubmalay") !== -1;

    if (!oldSite || !current.hostname) return absolute;

    target.protocol = current.protocol;
    target.hostname = current.hostname;
    target.port = current.port;
    return target.toString();
  } catch (_) {
    return absolute;
  }
}

function parseSearchResults(html, pageUrl) {
  var blocks = extractBalancedBlocksByClass(html, "div", "display-item");
  var results = [];
  var seen = Object.create(null);

  blocks.forEach(function(block, rank) {
    var anchorMatch = block.match(/<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>/i);
    if (!anchorMatch) return;

    var anchor = anchorMatch[0];
    var href = rewriteToCurrentDomain(safeUrl(getAttr(anchor, "href"), pageUrl));
    if (!href || seen[href]) return;

    var rawTitle = stripTags(getAttr(anchor, "title"));
    if (!rawTitle) {
      var h3 = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
      rawTitle = h3 ? stripTags(h3[1]) : "";
    }
    if (!rawTitle) return;

    var year = "";
    var yearMatch = rawTitle.match(/\s*\(((?:19|20)\d{2})\)\s*$/);
    if (yearMatch) year = yearMatch[1];

    var title = rawTitle.replace(/\s*\(((?:19|20)\d{2})\)\s*$/, "").trim() || rawTitle;
    var ptype = String(getAttr(anchor, "data-ptype") || "").toLowerCase();
    var isSeries = ptype.indexOf("tv") !== -1 || /\/tvshows\//i.test(href);

    seen[href] = true;
    results.push({
      title: title,
      year: year,
      href: href,
      isSeries: isSeries,
      rank: rank
    });
  });

  return results;
}

function scoreCandidate(item, info, mediaType) {
  var aliases = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases
    : [info && info.title, info && info.originalTitle];
  var score = 0;
  aliases.forEach(function(alias) {
    score = Math.max(score, titleScore(item.title, alias));
  });

  if (item.year && info.year && item.year === info.year) score += 30;
  if (mediaType === "tv" && item.isSeries) score += 24;
  if (mediaType === "movie" && !item.isSeries) score += 18;
  if (mediaType === "tv" && !item.isSeries) score -= 25;
  if (mediaType === "movie" && item.isSeries) score -= 25;
  score += Math.max(0, 12 - Number(item.rank || 0));
  return score;
}


function slugifyTitle(value) {
  var text = String(value || "");

  try {
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
  } catch (_) {}

  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function extractDetailIdentity(html) {
  var source = String(html || "");
  var title = "";

  var detailsTitle = source.match(
    /<[^>]*class\s*=\s*(["'])[^"']*\bdetails-title\b[^"']*\1[^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/i
  );
  if (detailsTitle) title = stripTags(detailsTitle[2]);

  if (!title) {
    var og = source.match(
      /<meta\b[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
    );
    if (!og) {
      og = source.match(
        /<meta\b[^>]*content\s*=\s*(["'])([\s\S]*?)\1[^>]*property\s*=\s*(["'])og:title\3[^>]*>/i
      );
      if (og) title = decodeHtml(og[2]);
    } else {
      title = decodeHtml(og[3]);
    }
  }

  if (!title) {
    var heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (heading) title = stripTags(heading[1]);
  }

  var original = source.match(/Original\s+title\s*:\s*([^<\r\n]+)/i);
  var year =
    yearFrom(title) ||
    yearFrom(original ? stripTags(original[1]) : "");

  if (!year) {
    var yearRow = source.match(
      />\s*Year\s*:\s*<\/[^>]+>[\s\S]{0,500}?<a\b[^>]*>([\s\S]*?)<\/a>/i
    );
    if (yearRow) year = yearFrom(stripTags(yearRow[1]));
  }

  return {
    title: String(title || "").replace(/\s*[-|]\s*movisubmalay.*$/i, "").trim(),
    year: year
  };
}

function isDirectPageMatch(result, info, mediaType) {
  if (!result || !result.text) return false;

  var url = String(result.url || "");
  var lowerUrl = url.toLowerCase();
  var body = String(result.text || "");

  if (mediaType === "movie" && lowerUrl.indexOf("/movies/") === -1) return false;
  if (mediaType === "tv" && lowerUrl.indexOf("/tvshows/") === -1) return false;

  /*
   * Canonical slug URLs are generated from TMDB title/year. If the site returned
   * a real detail page, do not burn several more seconds re-searching WordPress.
   */
  if (
    /(?:page not found|404 not found|nothing found)/i.test(body) ||
    body.length < 300
  ) {
    return false;
  }

  var expectedSlug = slugifyTitle(info.title);
  var pathSlug = "";
  try {
    var path = new URL(url).pathname.split("/").filter(Boolean);
    pathSlug = path.length ? path[path.length - 1] : "";
  } catch (_) {}

  if (expectedSlug && pathSlug.indexOf(expectedSlug) === 0) {
    if (info.year && pathSlug.indexOf(String(info.year)) !== -1) {
      vueoTrace("DIRECT_MATCH", { url: url, reason: "slug-year" });
      return true;
    }
    var quickIdentity = extractDetailIdentity(body);
    var quickScore = Math.max(
      titleScore(quickIdentity.title, info.title),
      titleScore(quickIdentity.title, info.originalTitle)
    );
    if (quickScore >= 52) {
      vueoTrace("DIRECT_MATCH", { url: url, reason: "slug-title", score: quickScore });
      return true;
    }
  }

  var identity = extractDetailIdentity(body);
  if (!identity.title) return false;

  var score = Math.max(
    titleScore(identity.title, info.title),
    titleScore(identity.title, info.originalTitle)
  );

  if (score < 52) return false;
  if (info.year && identity.year && String(info.year) !== String(identity.year)) return false;

  return true;
}

function buildDirectCandidates(info, mediaType) {
  var titles = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases.slice(0, 6)
    : [info.title, info.originalTitle];

  var output = [];
  var seen = Object.create(null);

  titles.forEach(function(title) {
    var slug = slugifyTitle(title);
    if (!slug) return;

    var paths;
    if (mediaType === "movie") {
      paths = info.year
        ? ["/movies/" + slug + "-" + info.year + "/", "/movies/" + slug + "/"]
        : ["/movies/" + slug + "/"];
    } else {
      paths = info.year
        ? ["/tvshows/" + slug + "/", "/tvshows/" + slug + "-" + info.year + "/"]
        : ["/tvshows/" + slug + "/"];
    }

    paths.forEach(function(path) {
      var url = trimSlash(currentBaseUrl) + path;
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });
  });

  return output;
}

function tryDirectTitlePage(info, mediaType) {
  var candidates = buildDirectCandidates(info, mediaType);
  if (!candidates.length) return Promise.resolve(null);

  function tryIndex(index) {
    if (index >= candidates.length) return Promise.resolve(null);

    var url = candidates[index];
    var timeoutMs = index === 0 ? 1400 : 700;

    return requestText(
      url,
      { "Referer": trimSlash(currentBaseUrl) + "/" },
      timeoutMs
    ).then(function(result) {
      updateBaseFromUrl(result.url || url);

      if (!isDirectPageMatch(result, info, mediaType)) {
        return tryIndex(index + 1);
      }

      console.log("[MSM21] direct permalink hit " + (result.url || url));
      return {
        href: result.url || url,
        title: info.title,
        year: info.year,
        isSeries: mediaType === "tv",
        __detailHtml: result.text
      };
    }).catch(function() {
      return tryIndex(index + 1);
    });
  }

  return tryIndex(0);
}

function searchSite(query) {
  var url = trimSlash(currentBaseUrl) + "/?s=" + encodeURIComponent(query);
  return requestText(url, { "Referer": trimSlash(currentBaseUrl) + "/" }, 2200)
    .then(function(result) {
      updateBaseFromUrl(result.url);
      return parseSearchResults(result.text, result.url || url);
    });
}

function browseArchiveMSM(info, mediaType) {
  var path = mediaType === "tv" ? "/tvshows/" : "/movies/";
  var url = trimSlash(currentBaseUrl) + path;
  return requestText(url, { "Referer": trimSlash(currentBaseUrl) + "/" }, 1800).then(function(result) {
    updateBaseFromUrl(result.url || url);
    var items = parseSearchResults(result.text, result.url || url);
    items.sort(function(a, b) { return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType); });
    var best = items[0] || null;
    if (best && scoreCandidate(best, info, mediaType) >= 45) {
      vueoTrace("ARCHIVE_MATCH", { title: best.title || "", score: scoreCandidate(best, info, mediaType) });
      return best;
    }
    return null;
  }).catch(function() { return null; });
}

function findBestTitle(info, mediaType) {
  return tryDirectTitlePage(info, mediaType).then(function(direct) {
    if (direct) return direct;

    console.log("[MSM21] direct permalink miss, using WordPress search");
    var queries = info && Array.isArray(info.aliases) && info.aliases.length
      ? info.aliases.slice(0, 5)
      : [info.title, info.originalTitle];

    function run(index) {
      if (index >= queries.length) return Promise.resolve(null);
      var query = String(queries[index] || "").trim();
      if (!query) return run(index + 1);
      return searchSite(query).then(function(items) {
        items.sort(function(a, b) { return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType); });
        var best = items[0] || null;
        if (best && scoreCandidate(best, info, mediaType) >= 45) return best;
        return run(index + 1);
      }).catch(function() { return run(index + 1); });
    }

    return run(0).then(function(best) {
      return best || browseArchiveMSM(info, mediaType);
    });
  }).then(function(best) {
    if (!best) throw new Error("MSM21 title not found");
    if (!best.__detailHtml && scoreCandidate(best, info, mediaType) < 40) {
      throw new Error("MSM21 match confidence too low");
    }
    return best;
  });
}

function parseEpisodeTarget(html, pageUrl, season, episode) {
  var requestedSeason = Number(season || 1);
  var requestedEpisode = Number(episode || 1);
  var lists = extractBalancedBlocksByClass(html, "ul", "episodes-list");
  var candidates = [];

  lists.forEach(function(list) {
    var openTag = (list.match(/^<ul\b[^>]*>/i) || [])[0] || "";
    var listId = getAttr(openTag, "id");
    var seasonMatch = String(listId || "").match(/-(\d+)\s*$/);
    var seasonNumber = seasonMatch ? Number(seasonMatch[1]) : 1;

    var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(list))) {
      var full = anchor[0];
      var tag = (full.match(/<a\b[^>]*>/i) || [])[0] || "";
      var href = rewriteToCurrentDomain(safeUrl(getAttr(tag, "href"), pageUrl));
      if (!href) continue;

      var epClass = full.match(
        /<[^>]*class\s*=\s*(["'])[^"']*\bep-num\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
      );
      var epText = epClass ? stripTags(epClass[2]) : stripTags(full);
      var epMatch = epText.match(/\d+/);
      if (!epMatch) continue;

      candidates.push({
        season: seasonNumber,
        episode: Number(epMatch[0]),
        href: href
      });
    }
  });

  var exact = candidates.find(function(item) {
    return item.season === requestedSeason && item.episode === requestedEpisode;
  });

  if (!exact && requestedSeason === 1) {
    exact = candidates.find(function(item) {
      return item.episode === requestedEpisode;
    });
  }

  if (!exact) {
    throw new Error(
      "MSM21 episode S" + requestedSeason + "E" + requestedEpisode + " not found"
    );
  }

  return exact.href;
}

function parsePlayerOptions(html) {
  var source = String(html || "");
  var output = [];
  var regex = /<li\b[^>]*class\s*=\s*(["'])[^"']*\bzetaflix_player_option\b[^"']*\1[^>]*>[\s\S]*?<\/li>/gi;
  var match;

  while ((match = regex.exec(source))) {
    var block = match[0];
    var open = (block.match(/<li\b[^>]*>/i) || [])[0] || "";
    var nume = String(getAttr(open, "data-nume") || "").trim();
    if (!nume || nume.toLowerCase() === "fake") continue;

    var post = String(getAttr(open, "data-post") || "").trim();
    var type = String(getAttr(open, "data-type") || "").trim();
    if (!post || !type) continue;

    var titleMatch = block.match(
      /<[^>]*class\s*=\s*(["'])[^"']*\bopt-titl\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
    );
    var nameMatch = block.match(
      /<[^>]*class\s*=\s*(["'])[^"']*\bopt-name\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
    );

    var label = [
      titleMatch ? stripTags(titleMatch[2]) : "",
      nameMatch ? stripTags(nameMatch[2]) : ""
    ].filter(Boolean).join(" ").trim();

    output.push({
      post: post,
      nume: nume,
      type: type,
      label: label || ("Server " + nume)
    });
  }

  return output;
}

var FAST_HINTS = ["fire", "wish", "byse", "mix", "dsv", "dood", "hgl", "playm", "voe"];

function isFastOption(option) {
  var value = String(option && option.label || "").toLowerCase();
  return FAST_HINTS.some(function(hint) { return value.indexOf(hint) !== -1; });
}

function fastPriority(option) {
  var value = String(option && option.label || "").toLowerCase();
  if (value.indexOf("fire") !== -1 || value.indexOf("wish") !== -1 || value.indexOf("hgl") !== -1) return 0;
  if (value.indexOf("playm") !== -1) return 1;
  if (value.indexOf("byse") !== -1) return 2;
  if (value.indexOf("voe") !== -1) return 3;
  if (value.indexOf("mix") !== -1) return 4;
  if (value.indexOf("dsv") !== -1 || value.indexOf("dood") !== -1) return 5;
  return 6;
}

function fallbackPriority(option) {
  var value = String(option && option.label || "").toLowerCase();
  if (value.indexOf("full hd") !== -1 || value.indexOf("server full") !== -1) return 0;
  if (value.indexOf("abyss") !== -1) return 1;
  if (value.indexOf("veev") !== -1) return 2;
  if (value.indexOf("player") !== -1 || value.indexOf("ezpla") !== -1 || value.indexOf("playe") !== -1) return 3;
  return 4;
}

function cacheKey(option, pageUrl) {
  return [pageUrl, option.post, option.nume, option.type].join("|");
}

function getCachedMirrors(key) {
  var entry = MIRROR_CACHE[key];
  if (!entry) return null;
  if (entry.expiresAt > Date.now()) return entry.mirrors;
  delete MIRROR_CACHE[key];
  return null;
}

function putCachedMirrors(key, mirrors) {
  MIRROR_CACHE[key] = {
    expiresAt: Date.now() + MIRROR_CACHE_TTL_MS,
    mirrors: mirrors
  };
}

function normaliseEmbedUrl(raw, pageUrl) {
  var cleaned = decodeHtml(String(raw || ""))
    .trim()
    .replace(/\\\//g, "/")
    .replace(/^["']|["']$/g, "");

  if (!cleaned || cleaned.charAt(0) === "#" || /^javascript:/i.test(cleaned)) return "";

  var resolved = safeUrl(cleaned, pageUrl);
  if (!/^https?:\/\//i.test(resolved)) return "";

  var lower = resolved.toLowerCase();
  var blocked = [
    "youtube.com", "youtu.be", "googlesyndication", "googletagmanager",
    "doubleclick.net", "google-analytics", "facebook.com", "telegram.me",
    "t.me/", "algiersreests", "morestamping", "decafeligiblyhad"
  ];
  if (blocked.some(function(part) { return lower.indexOf(part) !== -1; })) return "";

  return resolved;
}

function extractEmbedUrls(embedHtml, pageUrl) {
  var html = String(embedHtml || "").trim();
  if (!html) return [];

  var found = [];
  var seen = Object.create(null);

  function add(raw) {
    var resolved = normaliseEmbedUrl(raw, pageUrl);
    if (!resolved || seen[resolved]) return;
    seen[resolved] = true;
    found.push(resolved);
  }

  if (/^https?:\/\//i.test(html)) add(html);

  var tagRegex = /<(?:iframe|video|source)\b[^>]*>/gi;
  var tag;
  while ((tag = tagRegex.exec(html))) {
    add(
      getAttr(tag[0], "data-src") ||
      getAttr(tag[0], "src")
    );
  }

  if (!found.length) {
    var urlRegex = /https?:\/\/[^\s"'<>]+/gi;
    var url;
    while ((url = urlRegex.exec(html.replace(/\\\//g, "/")))) add(url[0]);
  }

  return found;
}

function fetchMirrors(option, pageUrl) {
  var key = cacheKey(option, pageUrl);
  var cached = getCachedMirrors(key);
  if (cached) return Promise.resolve(cached);

  var ajaxUrl = trimSlash(currentBaseUrl) + "/wp-admin/admin-ajax.php";
  return requestPostForm(
    ajaxUrl,
    {
      action: "zeta_player_ajax",
      post: option.post,
      nume: option.nume,
      type: option.type
    },
    {
      "Referer": pageUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT
    },
    1800
  ).then(function(result) {
    var payload = null;
    try {
      payload = JSON.parse(result.text);
    } catch (_) {}

    var embedHtml =
      payload && (payload.embed_url || payload.embedUrl) ||
      result.text ||
      "";

    var mirrors = extractEmbedUrls(embedHtml, pageUrl).map(function(url) {
      return { url: url, label: option.label };
    });

    if (mirrors.length) putCachedMirrors(key, mirrors);
    return mirrors;
  }).catch(function(error) {
    console.log(
      "[MSM21] AJAX failed server=" + option.label +
      " error=" + (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function collectStaticMirrors(html, pageUrl) {
  var mirrors = [];
  var seen = Object.create(null);

  function add(raw, label) {
    var url = normaliseEmbedUrl(raw, pageUrl);
    if (!url || seen[url]) return;
    seen[url] = true;
    mirrors.push({ url: url, label: label || "MSM21" });
  }

  var source = String(html || "");

  var tagRegex = /<(?:iframe|video|source)\b[^>]*>/gi;
  var match;
  while ((match = tagRegex.exec(source))) {
    add(
      getAttr(match[0], "data-src") || getAttr(match[0], "src"),
      "MSM21 Static"
    );
  }

  /*
   * Some current movie pages expose the loaded Full HD player as a normal
   * anchor rather than only as a player option.
   */
  var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  var anchor;
  while ((anchor = anchorRegex.exec(source))) {
    var href = anchor[2];
    var label = stripTags(anchor[3]);
    var lower = String(href || "").toLowerCase();

    if (
      /(?:palankyurok|player|embed|abyss|ezpla|seekp|p2pst|upns)/i.test(lower) ||
      /(?:full\s*hd|server\s*full|^\s*hd\s*$)/i.test(label)
    ) {
      add(href, label || "MSM21 Full HD");
    }
  }

  return mirrors;
}

function firstNonEmpty(tasks, timeoutMs) {
  return new Promise(function(resolve) {
    if (!tasks || !tasks.length) {
      resolve({ streams: [], subtitles: [] });
      return;
    }

    var done = false;
    var remaining = tasks.length;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      resolve({ streams: [], subtitles: [] });
    }, timeoutMs);

    tasks.forEach(function(task) {
      Promise.resolve(task).then(
        function(result) {
          if (done) return;
          var count = result && Array.isArray(result.streams) ? result.streams.length : 0;
          remaining -= 1;
          if (count > 0) {
            done = true;
            clearTimeout(timer);
            resolve(result);
          } else if (remaining <= 0) {
            done = true;
            clearTimeout(timer);
            resolve({ streams: [], subtitles: [] });
          }
        },
        function() {
          if (done) return;
          remaining -= 1;
          if (remaining <= 0) {
            done = true;
            clearTimeout(timer);
            resolve({ streams: [], subtitles: [] });
          }
        }
      );
    });
  });
}

function unescapeScriptText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u003a/gi, ":")
    .replace(/\\x3a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x26/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function isDirectMedia(url) {
  var value = String(url || "").toLowerCase();
  return (
    value.indexOf("/sora/") !== -1 ||
    /\.(?:m3u8|mp4|m4v)(?:$|[?#])/i.test(value)
  );
}

function inferQuality(url, label) {
  var value = (String(label || "") + " " + String(url || "")).toLowerCase();
  if (/\b2160p?\b|\b4k\b/.test(value)) return "2160p";
  if (/\b1440p?\b/.test(value)) return "1440p";
  if (/\b1080p?\b/.test(value)) return "1080p";
  if (/\b720p?\b/.test(value)) return "720p";
  if (/\b480p?\b/.test(value)) return "480p";
  if (/\b360p?\b/.test(value)) return "360p";
  return "Auto";
}

function getHeaderValue(headers, name) {
  try {
    if (headers && typeof headers.get === "function") {
      return headers.get(name) || headers.get(String(name || "").toLowerCase()) || "";
    }
  } catch (_) {}
  return "";
}

function requestRaw(url, options, timeoutMs, label) {
  var supplied = options || {};
  var fetchOptions = {
    method: supplied.method || "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, supplied.headers || {}),
    redirect: supplied.redirect || "follow"
  };

  if (supplied.body !== undefined) fetchOptions.body = supplied.body;

  var request = fetch(url, fetchOptions).then(function(response) {
    var status = Number(response && response.status || 0);
    var manualRedirect = fetchOptions.redirect === "manual" && status >= 300 && status < 400;

    if (!manualRedirect && response && response.ok === false) {
      throw new Error("HTTP " + status + " for " + url);
    }

    return Promise.resolve(response.text()).then(function(text) {
      return {
        text: String(text || ""),
        url: String(response && response.url || url),
        status: status,
        headers: response && response.headers
      };
    });
  });

  return withSoftTimeout(
    request,
    timeoutMs || 2200,
    label || "MSM21 extractor request"
  );
}

function requestPostForm(url, data, headers, timeoutMs) {
  var body = Object.keys(data || {}).map(function(key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(String(data[key] == null ? "" : data[key]));
  }).join("&");

  return requestRaw(url, {
    method: "POST",
    headers: Object.assign({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }, headers || {}),
    body: body,
    redirect: "follow"
  }, timeoutMs || 2200, "MSM21 POST " + url);
}

function extractDirectMedia(text, baseUrl) {
  var source = unescapeScriptText(text);
  var found = [];
  var seen = {};

  function add(value, label) {
    var url = safeUrl(value, baseUrl);
    if (!url || !isDirectMedia(url) || seen[url]) return;
    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label)
    });
  }

  var absoluteRegex =
    /https?:\/\/[^"'<>\\\s]+?(?:\.(?:m3u8|mp4|m4v)(?:\?[^"'<>\\\s]*)?|\/sora\/[^"'<>\\\s]*)/gi;
  var absolute;
  while ((absolute = absoluteRegex.exec(source))) add(absolute[0], "");

  var keyedRegex =
    /(?:file|src|source|url)\s*[:=]\s*(["'])([^"']+(?:\.(?:m3u8|mp4|m4v)(?:\?[^"']*)?|\/sora\/[^"']*))\1/gi;
  var keyed;
  while ((keyed = keyedRegex.exec(source))) add(keyed[2], keyed[0]);

  var sourceTagRegex = /<source\b[^>]*>/gi;
  var sourceTag;
  while ((sourceTag = sourceTagRegex.exec(source))) {
    add(getAttr(sourceTag[0], "src"), sourceTag[0]);
  }

  return found;
}


function decodeBase64Loose(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";

  try {
    if (typeof atob === "function") return atob(raw);
  } catch (_) {}

  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(raw, "base64").toString("utf8");
    }
  } catch (_) {}

  return "";
}

function extractBrowserPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = [];
  var seen = Object.create(null);

  function add(raw, label) {
    var value = unescapeScriptText(String(raw || "")).trim();
    if (!value) return;

    var url = safeUrl(value, baseUrl);
    if (!url || seen[url] || !isDirectMedia(url)) return;

    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label || "")
    });
  }

  var patterns = [
    /\b(?:file|src|source|url|video_url|videoUrl|hls_url|hlsUrl|currentSrc)\s*[:=]\s*(["'])(.*?)\1/gi,
    /\bloadSource\s*\(\s*(["'])(.*?)\1\s*\)/gi,
    /\bsetAttribute\s*\(\s*(["'])src\1\s*,\s*(["'])(.*?)\2\s*\)/gi,
    /\bfetch\s*\(\s*(["'])(.*?)\1/gi,
    /\bnew\s+Request\s*\(\s*(["'])(.*?)\1/gi,
    /\.open\s*\(\s*(["'])(?:GET|POST)\1\s*,\s*(["'])(.*?)\2/gi
  ];

  patterns.forEach(function(regex) {
    var match;
    while ((match = regex.exec(source))) {
      add(match[match.length - 1], match[0]);
    }
  });

  /*
   * PlayerX/Abyss variants often keep the media URL inside atob() or a JSON
   * blob. Decode likely base64 strings and rescan only when the decoded text
   * actually looks like a URL/player config.
   */
  var base64Regex = /(?:atob\s*\(\s*)?(["'])([A-Za-z0-9+/_=-]{48,})\1\s*\)?/g;
  var encoded;
  while ((encoded = base64Regex.exec(source))) {
    var decoded = decodeBase64Loose(
      String(encoded[2] || "").replace(/-/g, "+").replace(/_/g, "/")
    );
    if (!decoded || !/(?:https?:|\/sora\/|m3u8|mp4|m4v|file|source|fetch|xhr)/i.test(decoded)) continue;

    extractDirectMedia(decoded, baseUrl).forEach(function(item) {
      add(item.url, item.quality);
    });

    var inner = decoded.match(
      /https?:\/\/[^\s"'<>]+?(?:\.(?:m3u8|mp4|m4v)(?:\?[^\s"'<>]*)?|\/sora\/[^\s"'<>]*)/gi
    ) || [];
    inner.forEach(function(url) { add(url, ""); });
  }

  return found;
}

function extractJwPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = extractDirectMedia(source, baseUrl);
  extractBrowserPlayerMedia(source, baseUrl).forEach(function(item) {
    if (!found.some(function(existing) { return existing.url === item.url; })) {
      found.push(item);
    }
  });
  var seen = {};
  found.forEach(function(item) { seen[item.url] = true; });

  function add(raw, label, type) {
    var url = safeUrl(raw, baseUrl);
    if (!url || seen[url]) return;

    var lower = String(url).toLowerCase();
    var typeLower = String(type || "").toLowerCase();

    var looksPlayable =
      isDirectMedia(url) ||
      /\.txt(?:$|[?#])/i.test(url) ||
      typeLower.indexOf("mpegurl") !== -1 ||
      typeLower.indexOf("m3u8") !== -1 ||
      typeLower.indexOf("mp4") !== -1 ||
      typeLower.indexOf("video") !== -1;

    if (!looksPlayable) return;
    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label)
    });
  }

  var objectRegex = /\{[\s\S]{0,600}?\}/g;
  var objectMatch;
  while ((objectMatch = objectRegex.exec(source))) {
    var block = objectMatch[0];
    var file = block.match(/\b(?:file|src)\s*:\s*(["'])(.*?)\1/i);
    if (!file) continue;
    var label = (block.match(/\b(?:label|quality)\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    var type = (block.match(/\btype\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    add(file[2], label, type);
  }

  var bareFileRegex = /\b(?:file|src)\s*:\s*(["'])(https?:\/\/[^"']+)\1/gi;
  var bare;
  while ((bare = bareFileRegex.exec(source))) add(bare[2], "", "");

  return found;
}

function extractSubtitles(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var output = [];
  var seen = {};

  function add(url, label) {
    var absolute = safeUrl(url, baseUrl);
    if (!absolute || seen[absolute]) return;
    if (!/\.(?:vtt|srt)(?:$|[?#])/i.test(absolute)) return;

    seen[absolute] = true;
    var lower = String(label || "").toLowerCase();
    var lang = lower.indexOf("malay") !== -1 || /\bms\b/.test(lower) ? "ms" :
      lower.indexOf("indones") !== -1 || /\bid\b/.test(lower) ? "id" :
      lower.indexOf("english") !== -1 || /\ben\b/.test(lower) ? "en" : "und";

    output.push({
      label: label || (lang === "und" ? "Subtitle" : lang.toUpperCase()),
      language: label || lang,
      lang: lang,
      url: absolute,
      default: false,
      format: /\.srt(?:$|[?#])/i.test(absolute) ? "srt" : "vtt"
    });
  }

  var trackRegex = /<track\b[^>]*>/gi;
  var track;
  while ((track = trackRegex.exec(source))) {
    add(
      getAttr(track[0], "src"),
      getAttr(track[0], "label") || getAttr(track[0], "srclang")
    );
  }

  var objectRegex = /\{[\s\S]{0,500}?\}/g;
  var objectMatch;
  while ((objectMatch = objectRegex.exec(source))) {
    var block = objectMatch[0];
    var file = block.match(/\b(?:file|src)\s*:\s*(["'])(.*?\.(?:vtt|srt)(?:\?[^"']*)?)\1/i);
    if (!file) continue;
    var label = (block.match(/\b(?:label|srclang|language)\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    add(file[2], label);
  }

  var rawRegex = /https?:\/\/[^"'<>\\\s]+?\.(?:vtt|srt)(?:\?[^"'<>\\\s]*)?/gi;
  var raw;
  while ((raw = rawRegex.exec(source))) add(raw[0], "Subtitle");

  return output;
}

function extractIframes(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};
  var regex = /<iframe\b[^>]*>/gi;
  var match;

  while ((match = regex.exec(source))) {
    var tag = match[0];
    var raw =
      getAttr(tag, "data-src") ||
      getAttr(tag, "data-lazy-src") ||
      getAttr(tag, "src");

    var url = safeUrl(raw, baseUrl);
    if (!url || seen[url]) continue;

    var lower = url.toLowerCase();
    if (
      lower.indexOf("youtube.com") !== -1 ||
      lower.indexOf("youtu.be") !== -1 ||
      lower.indexOf("youtube-nocookie.com") !== -1 ||
      lower.indexOf("about:blank") === 0
    ) {
      continue;
    }

    seen[url] = true;
    output.push(url);
  }

  return output;
}

/*
 * Jsoup's "div.movieplay iframe" selector handles nested divs. A regex that
 * stops on the first </div> does not. This balanced scan mirrors the DOM
 * selector closely enough for the MSM21 server tabs.
 */
function extractMovieplayIframes(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};
  var openRegex = /<div\b[^>]*>/gi;
  var open;

  while ((open = openRegex.exec(source))) {
    var openTag = open[0];
    var className = getAttr(openTag, "class");
    if (!/(^|\s)movieplay(\s|$)/i.test(className)) continue;

    var blockStart = open.index;
    var scanStart = openRegex.lastIndex;
    var tokenRegex = /<div\b[^>]*>|<\/div\s*>/gi;
    tokenRegex.lastIndex = scanStart;

    var depth = 1;
    var endIndex = source.length;
    var token;
    while ((token = tokenRegex.exec(source))) {
      if (/^<div\b/i.test(token[0])) depth += 1;
      else depth -= 1;

      if (depth === 0) {
        endIndex = tokenRegex.lastIndex;
        break;
      }
    }

    var block = source.slice(blockStart, endIndex);
    extractIframes(block, baseUrl).forEach(function(url) {
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });

    openRegex.lastIndex = endIndex;
  }

  return output;
}

function extractRedirectTarget(text, baseUrl) {
  var source = unescapeScriptText(text);

  var meta = source.match(
    /<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1?[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
  );
  if (meta) {
    var target = meta[3].match(/url\s*=\s*(.+)$/i);
    if (target) return safeUrl(target[1].replace(/^["']|["']$/g, ""), baseUrl);
  }

  var locationMatch = source.match(
    /(?:window\.)?location(?:\.href)?\s*=\s*(["'])(https?:\/\/[^"']+)\1/i
  );
  return locationMatch ? safeUrl(locationMatch[2], baseUrl) : "";
}

function followRedirectCloudstream(url, referer) {
  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve("");

  return requestRaw(absolute, {
    method: "GET",
    headers: referer ? { "Referer": referer } : {},
    redirect: "manual"
  }, 1400, "MSM21 redirect " + absolute).then(function(result) {
    var location = getHeaderValue(result.headers, "location");
    if (location) return safeUrl(location, absolute);

    var meta = extractRedirectTarget(result.text, absolute);
    if (meta) return meta;

    /*
     * Some fetch implementations ignore redirect:"manual". In that case
     * response.url is already the final URL, which is still useful.
     */
    return result.url || absolute;
  }).catch(function() {
    return absolute;
  });
}

function mergeResolved(target, source) {
  var streamSeen = {};
  target.streams.forEach(function(item) { streamSeen[item.url] = true; });
  (source.streams || []).forEach(function(item) {
    if (!item || !item.url || streamSeen[item.url]) return;
    streamSeen[item.url] = true;
    target.streams.push(item);
  });

  var subtitleSeen = {};
  target.subtitles.forEach(function(item) { subtitleSeen[item.url] = true; });
  (source.subtitles || []).forEach(function(item) {
    if (!item || !item.url || subtitleSeen[item.url]) return;
    subtitleSeen[item.url] = true;
    target.subtitles.push(item);
  });

  return target;
}

function emptyResolved() {
  return { streams: [], subtitles: [] };
}

function resolvedFromText(text, pageUrl, headers) {
  return {
    streams: extractJwPlayerMedia(text, pageUrl).map(function(item) {
      return {
        url: item.url,
        quality: item.quality,
        referer: pageUrl,
        headers: headers || {}
      };
    }),
    subtitles: extractSubtitles(text, pageUrl)
  };
}

function extractScriptBodies(text) {
  var source = String(text || "");
  var scripts = [];
  var regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  var match;
  while ((match = regex.exec(source))) scripts.push(match[1]);
  return scripts;
}

/*
 * Cloudstream uses JsUnpacker/getAndUnpack for Dean Edwards P.A.C.K.E.R.
 * We intercept the packer's eval so the decoded source is returned instead
 * of executing the decoded player code.
 */
function unpackPackedScripts(text) {
  var source = String(text || "");
  var additions = [];

  extractScriptBodies(source).forEach(function(body) {
    if (body.indexOf("eval(function(p,a,c,k,e") === -1) return;

    try {
      var candidate = body.trim().replace(/;\s*$/, "");
      var factory = Function(
        "safeEval",
        "return (function(eval){ return (" + candidate + "); })(safeEval);"
      );
      var decoded = factory(function(code) { return String(code || ""); });
      if (decoded && typeof decoded === "string") additions.push(decoded);
    } catch (_) {}
  });

  return additions.length ? source + "\n" + additions.join("\n") : source;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return "";
  }
}

function hostOf(url) {
  try {
    return String(new URL(url).hostname || "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function hostMatches(host, domains) {
  var value = String(host || "").toLowerCase();
  return (domains || []).some(function(domain) {
    var d = String(domain || "").toLowerCase();
    return value === d || value.slice(-(d.length + 1)) === "." + d;
  });
}

var STREAMWISH_DOMAINS = [
  "streamwish.to", "mwish.pro", "dwish.pro", "embedwish.com", "hgcloud.to",
  "wishembed.pro", "kswplayer.info", "wishfast.top", "streamwish.site",
  "sfastwish.com", "strwish.xyz", "strwish.com", "flaswish.com", "awish.pro",
  "obeywish.com", "jodwish.com", "swhoi.com", "multimovies.cloud",
  "uqloads.xyz", "doodporn.xyz", "cdnwish.com", "asnwish.com",
  "nekowish.my.id", "neko-stream.click", "swdyu.com", "wishonly.site",
  "playerwish.com", "streamhls.to", "hlswish.com", "hglink.to"
];

var VIDHIDE_DOMAINS = [
  "vidhidepro.com", "vidhidehub.com", "vidhidevip.com", "vidhidepre.com",
  "smoothpre.com", "dhtpre.com", "peytonepre.com", "filelions.live",
  "filelions.online", "filelions.to", "kinoger.be", "vidhide.com",
  "rubyvidhub.com", "server2.shop"
];

var FILEMOON_DOMAINS = ["filemoon.to", "filemoon.in", "filemoon.sx"];
var STREAMTAPE_DOMAINS = [
  "streamtape.com", "streamtape.net", "streamtape.xyz",
  "watchadsontape.com", "shavetape.cash"
];
var DOOD_DOMAINS = [
  "dood.la", "dood.pm", "dood.to", "dood.so", "dood.ws", "dood.yt",
  "dood.li", "dood.watch", "dood.cx", "dood.sh", "dood.wf",
  "ds2play.com", "ds2video.com", "vide0.net", "myvidplay.com", "playmogo.com", "dsvplay.com"
];
var MIXDROP_DOMAINS = [
  "mixdrop.co", "mixdrop.bz", "mixdrop.ch", "mixdrop.to",
  "mixdrop.si", "mixdrop.ps", "mixdrop.ag", "mixdrop.top"
];
var VIDMOLY_DOMAINS = ["vidmoly.net", "vidmoly.me", "vidmoly.to", "vidmoly.biz"];
var LULU_DOMAINS = ["luluvdo.com", "luluvdoo.com", "lulustream.com", "kinoger.pw"];
var VOE_DOMAINS = [
  "voe.sx", "donaldlineelse.com", "charlestoughrace.com", "yip.su",
  "metagnathtuggers.com", "tubelessceliolymph.com", "simpulumlamerop.com",
  "urochsunloath.com", "nathanfromsubject.com"
];

function extractStreamWish(url, referer) {
  var origin = originOf(url);
  var resolvedUrl = url;

  try {
    var parsed = new URL(url);
    var match = parsed.pathname.match(/\/(?:f|e)\/([^/?#]+)/i);
    if (match) resolvedUrl = origin + "/" + match[1];
  } catch (_) {}

  var headers = {
    "Accept": "*/*",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Referer": origin + "/",
    "Origin": origin,
    "User-Agent": USER_AGENT
  };

  return requestRaw(resolvedUrl, {
    headers: Object.assign({}, headers, referer ? { "Referer": referer } : {}),
    redirect: "follow"
  }, 2500, "StreamWish " + resolvedUrl).then(function(result) {
    return resolvedFromText(result.text, result.url || resolvedUrl, headers);
  });
}

function extractVidHide(url, referer) {
  var embed = String(url || "")
    .replace("/d/", "/v/")
    .replace("/download/", "/v/")
    .replace("/file/", "/v/")
    .replace("/f/", "/v/");

  var origin = originOf(embed);
  var headers = {
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Origin": origin,
    "User-Agent": USER_AGENT
  };
  if (referer) headers["Referer"] = referer;

  return requestRaw(embed, {
    headers: headers,
    redirect: "follow"
  }, 2500, "VidHide " + embed).then(function(result) {
    return resolvedFromText(result.text, result.url || embed, headers);
  });
}

function extractFileMoon(url, referer) {
  var defaultHeaders = {
    "Referer": url,
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent": USER_AGENT
  };
  if (referer) defaultHeaders["Referer"] = referer;

  return requestRaw(url, {
    headers: defaultHeaders,
    redirect: "follow"
  }, 2400, "FileMoon " + url).then(function(initial) {
    var frames = extractIframes(initial.text, initial.url || url);

    if (!frames.length) {
      return resolvedFromText(initial.text, initial.url || url, defaultHeaders);
    }

    return requestRaw(frames[0], {
      headers: Object.assign({}, defaultHeaders, {
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": initial.url || url
      }),
      redirect: "follow"
    }, 2400, "FileMoon iframe " + frames[0]).then(function(frame) {
      return resolvedFromText(frame.text, frame.url || frames[0], defaultHeaders);
    });
  });
}

function randomToken(length) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var output = "";
  for (var i = 0; i < length; i++) {
    output += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return output;
}

function extractDood(url) {
  var embedUrl = String(url || "").replace("/d/", "/e/");

  return requestRaw(embedUrl, {
    redirect: "follow"
  }, 2200, "Dood " + embedUrl).then(function(page) {
    var base = originOf(page.url || embedUrl);
    var md5Match = page.text.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!md5Match) return emptyResolved();

    var md5Url = base + md5Match[0];
    return requestRaw(md5Url, {
      headers: { "Referer": page.url || embedUrl },
      redirect: "follow"
    }, 1800, "Dood pass_md5").then(function(md5) {
      var token = "";
      try {
        token = new URL(md5Url).pathname.split("/").filter(Boolean).pop() || "";
      } catch (_) {}

      var trueUrl = String(md5.text || "").trim() + randomToken(10) + "?token=" + token;
      if (!/^https?:\/\//i.test(trueUrl)) return emptyResolved();

      return {
        streams: [{
          url: trueUrl,
          quality: inferQuality(page.text, ""),
          referer: base + "/",
          headers: { "Referer": base + "/" }
        }],
        subtitles: []
      };
    });
  });
}

function extractMixDrop(url) {
  var embed = String(url || "").replace("/f/", "/e/");

  return requestRaw(embed, {
    redirect: "follow"
  }, 2300, "MixDrop " + embed).then(function(result) {
    var unpacked = unpackPackedScripts(result.text);
    var match = unpacked.match(/wurl.*?=.*?(["'])(.*?)\1\s*;/i);

    if (match && match[2]) {
      var direct = safeUrl(match[2], result.url || embed);
      return {
        streams: [{
          url: direct,
          quality: inferQuality(direct, ""),
          referer: url,
          headers: { "Referer": url }
        }],
        subtitles: extractSubtitles(unpacked, result.url || embed)
      };
    }

    return resolvedFromText(unpacked, result.url || embed, { "Referer": url });
  });
}

function extractVidmoly(url, referer) {
  var embed = String(url || "");
  if (embed.indexOf("/w/") !== -1) {
    embed = embed.replace("/w/", "/embed-") + ".html";
  }

  var headers = {
    "User-Agent": USER_AGENT,
    "Sec-Fetch-Dest": "iframe"
  };
  if (referer) headers["Referer"] = referer;

  return requestRaw(embed, {
    headers: headers,
    redirect: "follow"
  }, 2300, "Vidmoly " + embed).then(function(result) {
    return resolvedFromText(result.text, result.url || embed, headers);
  });
}

function extractLulu(url, referer) {
  var parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return Promise.resolve(emptyResolved());
  }

  var segments = parsed.pathname.split("/").filter(Boolean);
  var filecode = segments.length ? segments[segments.length - 1] : "";
  if (!filecode) return Promise.resolve(emptyResolved());

  var postUrl = parsed.origin + "/dl";
  return requestPostForm(postUrl, {
    op: "embed",
    file_code: filecode,
    auto: "1",
    referer: referer || ""
  }, referer ? { "Referer": referer } : {}, 2300).then(function(result) {
    return resolvedFromText(result.text, result.url || postUrl, {
      "Referer": referer || parsed.origin + "/"
    });
  });
}

function evalStringExpression(expression) {
  var expr = String(expression || "").trim().replace(/;\s*$/, "");
  if (!expr) return "";

  /*
   * StreamTape's Cloudstream extractor evaluates the small RHS expression used
   * to build the botlink. This equivalent evaluates only that extracted RHS.
   */
  try {
    return String(Function("return (" + expr + ");")() || "");
  } catch (_) {
    var protocolRelative = expr.match(/(["'])(\/\/[^"']+)\1/);
    return protocolRelative ? protocolRelative[2] : "";
  }
}

function extractStreamTape(url) {
  return requestRaw(url, {
    redirect: "follow"
  }, 2300, "StreamTape " + url).then(function(result) {
    var lines = String(result.text || "").split(/\r?\n/);
    var line = lines.find(function(value) {
      return value.indexOf("botlink').innerHTML") !== -1 ||
        value.indexOf('botlink").innerHTML') !== -1;
    });

    if (!line) return emptyResolved();

    var marker = line.indexOf(").innerHTML");
    if (marker === -1) return emptyResolved();

    var rhs = line.slice(marker + ").innerHTML".length).replace(/^\s*=\s*/, "");
    var value = evalStringExpression(rhs);
    if (!value) return emptyResolved();

    var direct = value.indexOf("//") === 0 ? "https:" + value : safeUrl(value, result.url || url);
    if (direct.indexOf("stream=1") === -1) {
      direct += (direct.indexOf("?") === -1 ? "?" : "&") + "stream=1";
    }

    return {
      streams: [{
        url: direct,
        quality: "Auto",
        referer: url,
        headers: { "Referer": url }
      }],
      subtitles: []
    };
  });
}

function base64DecodeText(value) {
  var input = String(value || "").replace(/\s+/g, "");

  try {
    if (typeof atob === "function") return atob(input);
  } catch (_) {}

  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(input, "base64").toString("binary");
    }
  } catch (_) {}

  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var output = "";
  var i = 0;

  while (i < input.length) {
    var enc1 = chars.indexOf(input.charAt(i++));
    var enc2 = chars.indexOf(input.charAt(i++));
    var enc3 = chars.indexOf(input.charAt(i++));
    var enc4 = chars.indexOf(input.charAt(i++));

    var chr1 = (enc1 << 2) | (enc2 >> 4);
    var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    var chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);
    if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
    if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
  }

  return output;
}

function rot13(value) {
  return String(value || "").replace(/[A-Za-z]/g, function(char) {
    var code = char.charCodeAt(0);
    var base = code >= 97 ? 97 : 65;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function decryptVoeF7(encoded) {
  try {
    var value = rot13(encoded);
    ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(function(pattern) {
      value = value.split(pattern).join("_");
    });
    value = value.replace(/_/g, "");

    var stage1 = base64DecodeText(value);
    var shifted = "";
    for (var i = 0; i < stage1.length; i++) {
      shifted += String.fromCharCode(stage1.charCodeAt(i) - 3);
    }

    var reversed = shifted.split("").reverse().join("");
    return JSON.parse(base64DecodeText(reversed));
  } catch (_) {
    return null;
  }
}

function extractVoe(url, referer) {
  function read(pageUrl) {
    return requestRaw(pageUrl, {
      headers: referer ? { "Referer": referer } : {},
      redirect: "follow"
    }, 2300, "Voe " + pageUrl);
  }

  return read(url).then(function(first) {
    var redirect = String(first.text || "").match(
      /window\.location\.href\s*=\s*'([^']+)'\s*;?/i
    );

    var pagePromise = redirect && redirect[1]
      ? read(safeUrl(redirect[1], first.url || url))
      : Promise.resolve(first);

    return pagePromise.then(function(page) {
      var script = String(page.text || "").match(
        /<script\b[^>]*type\s*=\s*(["'])application\/json\1[^>]*>([\s\S]*?)<\/script>/i
      );
      if (!script) return emptyResolved();

      var raw = String(script[2] || "").trim();
      var encoded = "";

      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) encoded = String(parsed[0] || "");
      } catch (_) {}

      if (!encoded) {
        var encodedMatch = raw.match(/^\s*\[\s*"([\s\S]*?)"\s*\]\s*$/);
        if (encodedMatch) encoded = encodedMatch[1];
      }

      var decrypted = decryptVoeF7(encoded);
      if (!decrypted) return emptyResolved();

      var streams = [];
      var origin = originOf(page.url || url);

      if (decrypted.source) {
        streams.push({
          url: safeUrl(decrypted.source, page.url || url),
          quality: inferQuality(decrypted.source, ""),
          referer: origin + "/",
          headers: { "Origin": origin, "Referer": origin + "/" }
        });
      }

      if (decrypted.direct_access_url) {
        streams.push({
          url: safeUrl(decrypted.direct_access_url, page.url || url),
          quality: inferQuality(decrypted.direct_access_url, ""),
          referer: url,
          headers: { "Referer": url }
        });
      }

      return { streams: streams, subtitles: [] };
    });
  });
}


function extractExternalScriptUrls(text, baseUrl) {
  var source = String(text || "");
  var output = [];
  var seen = Object.create(null);
  var regex = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  var match;
  var baseHost = hostOf(baseUrl);

  while ((match = regex.exec(source))) {
    var url = safeUrl(match[2], baseUrl);
    if (!url || seen[url]) continue;

    var host = hostOf(url);
    var lower = url.toLowerCase();

    /*
     * Keep the probe bounded. Same-host player scripts are highest value.
     * Also allow obvious player bundles.
     */
    if (
      host !== baseHost &&
      lower.indexOf("player") === -1 &&
      lower.indexOf("video") === -1 &&
      lower.indexOf("app.") === -1 &&
      lower.indexOf("bundle") === -1
    ) {
      continue;
    }

    seen[url] = true;
    output.push(url);
    if (output.length >= 3) break;
  }

  return output;
}

function scanExternalPlayerScripts(html, pageUrl, referer) {
  var scripts = extractExternalScriptUrls(html, pageUrl);
  if (!scripts.length) return Promise.resolve(emptyResolved());

  return firstNonEmpty(
    scripts.map(function(scriptUrl) {
      return requestRaw(
        scriptUrl,
        {
          headers: {
            "Referer": pageUrl,
            "Accept": "*/*"
          },
          redirect: "follow"
        },
        1100,
        "MSM21 player script " + scriptUrl
      ).then(function(script) {
        var resolved = resolvedFromText(
          script.text,
          script.url || scriptUrl,
          {
            "Referer": pageUrl
          }
        );

        if (resolved.streams.length) {
          console.log(
            "[MSM21] script stream hit host=" + hostOf(script.url || scriptUrl)
          );
        }
        return resolved;
      }).catch(function() {
        return emptyResolved();
      });
    }),
    1350
  );
}

function extractGenericHost(url, referer, depth) {
  return requestRaw(url, {
    headers: referer ? { "Referer": referer } : {},
    redirect: "follow"
  }, 2100, "Generic extractor " + url).then(function(result) {
    var finalUrl = result.url || url;
    var resolved = resolvedFromText(
      result.text,
      finalUrl,
      referer ? { "Referer": referer } : {}
    );

    if (resolved.streams.length) return resolved;

    /*
     * Cloudstream's WebView hook sees fetch/XHR/media requests produced by
     * external player bundles. Scan those bundles before trying nested iframes.
     */
    return scanExternalPlayerScripts(result.text, finalUrl, referer)
      .then(function(scriptResult) {
        mergeResolved(resolved, scriptResult);
        if (resolved.streams.length || Number(depth || 0) >= 1) return resolved;

        var nested = extractIframes(result.text, finalUrl).slice(0, 2);
        if (!nested.length) return resolved;

        return firstNonEmpty(
          nested.map(function(child) {
            return loadExtractorEquivalent(
              child,
              finalUrl,
              Number(depth || 0) + 1
            ).catch(function() {
              return emptyResolved();
            });
          }),
          1700
        ).then(function(child) {
          mergeResolved(resolved, child);
          return resolved;
        });
      });
  });
}


function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}


function sanitizeNativePlaybackHeaders(rawHeaders, mirrorUrl) {
  var blocked = {
    "host": true,
    "connection": true,
    "accept-encoding": true,
    "range": true,
    "origin": true
  };

  var headers = {};
  var input =
    rawHeaders && typeof rawHeaders === "object"
      ? rawHeaders
      : {};

  Object.keys(input).forEach(function(key) {
    var lower = String(key).toLowerCase();
    if (blocked[lower]) return;
    headers[String(key)] = String(input[key]);
  });

  headers["User-Agent"] =
    headers["User-Agent"] ||
    headers["user-agent"] ||
    USER_AGENT;
  headers["Accept"] =
    headers["Accept"] ||
    headers["accept"] ||
    "*/*";

  /*
   * Cloudstream sets ExtractorLink.referer to the player mirror URL even when
   * the intercepted WebView request carried another transient Referer.
   */
  delete headers["referer"];
  headers["Referer"] = mirrorUrl;

  return headers;
}

function nativeTransportScore(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf(".m3u8") !== -1) return 30;
  if (value.indexOf(".mp4") !== -1) return 20;
  if (value.indexOf(".m4v") !== -1) return 20;
  if (value.indexOf("/sora/") !== -1) return 10;
  return 0;
}

function resolveWithNativeWebView(url, referer, label) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve(emptyResolved());
  }

  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve(emptyResolved());

  console.log(
    "[" + PROVIDER_NAME + "] native WebView start host=" + hostOf(absolute)
  );

  return globalThis.webviewResolve(absolute, {
    referer: referer || absolute,
    timeoutMs: 13000,
    finishAfterFirstMs: 600,
    clickDelaysMs: [
      650,
      1300,
      2200,
      3400,
      5000,
      7000,
      9500,
      12000
    ],
    match: [
      "/sora/",
      ".m3u8",
      ".mp4",
      ".m4v"
    ],
    blocked: [
      "doubleclick",
      "googlesyndication",
      "/ads/",
      "vast"
    ],
    injectAbyssHook: true
  }).then(function(result) {
    var nativeStreams =
      result && Array.isArray(result.streams)
        ? result.streams
        : [];

    var streams = nativeStreams
      .map(function(item) {
        if (!item || !item.url) return null;

        var headers = sanitizeNativePlaybackHeaders(
          item.headers,
          absolute
        );

        return {
          url: String(item.url),
          quality: inferQuality(
            item.url,
            item.label || label || PROVIDER_NAME
          ),
          referer: absolute,
          headers: headers,
          serverLabel:
            label ||
            item.label ||
            "WebView"
        };
      })
      .filter(Boolean)
      .sort(function(a, b) {
        var transport =
          nativeTransportScore(b.url) -
          nativeTransportScore(a.url);
        if (transport !== 0) return transport;

        return String(a.quality || "").localeCompare(
          String(b.quality || "")
        );
      });

    console.log(
      "[" + PROVIDER_NAME + "] native WebView streams=" + streams.length
    );

    return {
      streams: streams,
      subtitles: []
    };
  }).catch(function(error) {
    console.log(
      "[" + PROVIDER_NAME + "] native WebView failed host=" +
      hostOf(absolute) +
      " error=" +
      (error && error.message ? error.message : String(error))
    );
    return emptyResolved();
  });
}

function extractorNameFor(url) {
  var host = hostOf(url);

  if (hostMatches(host, STREAMWISH_DOMAINS)) return "StreamWish";
  if (hostMatches(host, VIDHIDE_DOMAINS)) return "VidHidePro";
  if (hostMatches(host, FILEMOON_DOMAINS) || host.indexOf("filemoon") !== -1) return "FileMoon";
  if (hostMatches(host, DOOD_DOMAINS) || host.indexOf("dood.") !== -1) return "Dood";
  if (hostMatches(host, MIXDROP_DOMAINS) || host.indexOf("mixdrop.") !== -1) return "MixDrop";
  if (hostMatches(host, STREAMTAPE_DOMAINS) || host.indexOf("streamtape.") !== -1) return "StreamTape";
  if (hostMatches(host, VIDMOLY_DOMAINS) || host.indexOf("vidmoly.") !== -1) return "Vidmoly";
  if (hostMatches(host, LULU_DOMAINS) || host.indexOf("luluvdo") !== -1 || host.indexOf("lulustream") !== -1) return "LuluStream";
  if (hostMatches(host, VOE_DOMAINS) || host === "voe.sx") return "Voe";
  if (host === "bysesukior.com" || host.slice(-16) === ".bysesukior.com") return "ByseSX";
  if (
    host.indexOf("palankyurok.com") !== -1 ||
    host.indexOf("abyss") !== -1 ||
    host.indexOf("ezpla") !== -1 ||
    host.indexOf("seekp") !== -1 ||
    host.indexOf("p2pst") !== -1 ||
    host.indexOf("upns") !== -1
  ) return "BrowserPlayer";

  return "Generic";
}

function dispatchExtractor(url, referer, depth) {
  var name = extractorNameFor(url);
  console.log("[MSM21] extractor=" + name + " host=" + hostOf(url));

  var work;
  if (name === "StreamWish") work = extractStreamWish(url, referer);
  else if (name === "VidHidePro") work = extractVidHide(url, referer);
  else if (name === "FileMoon") work = extractFileMoon(url, referer);
  else if (name === "Dood") work = extractDood(url);
  else if (name === "MixDrop") work = extractMixDrop(url);
  else if (name === "StreamTape") work = extractStreamTape(url);
  else if (name === "Vidmoly") work = extractVidmoly(url, referer);
  else if (name === "LuluStream") work = extractLulu(url, referer);
  else if (name === "Voe") work = extractVoe(url, referer);
  else if (name === "ByseSX") work = extractGenericHost(url, referer, depth || 0);
  else if (name === "BrowserPlayer") work = resolveWithNativeWebView(url, referer, "BrowserPlayer");
  else work = extractGenericHost(url, referer, depth || 0);

  return Promise.resolve(work).then(function(resolved) {
    var streams = resolved && Array.isArray(resolved.streams) ? resolved.streams.length : 0;
    console.log("[MSM21] " + name + " streams=" + streams);

    /*
     * A recognised host can change its frontend. If the specific extraction
     * produced nothing, try the generic packed/JWPlayer parser before giving up.
     */
    if (streams) return resolved || emptyResolved();

    return extractGenericHost(url, referer, 1)
      .catch(function() {
        return resolved || emptyResolved();
      })
      .then(function(genericResolved) {
        var genericStreams =
          genericResolved && Array.isArray(genericResolved.streams)
            ? genericResolved.streams.length
            : 0;

        if (genericStreams) return genericResolved;

        return resolveWithNativeWebView(
          url,
          referer,
          name === "Generic" ? "WebView" : name
        );
      });
  });
}

function loadExtractorEquivalent(url, referer, depth) {
  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve(emptyResolved());

  if (isDirectMedia(absolute)) {
    return Promise.resolve({
      streams: [{
        url: absolute,
        quality: inferQuality(absolute, ""),
        referer: referer || absolute,
        headers: referer ? { "Referer": referer } : {}
      }],
      subtitles: []
    });
  }

  var directName = extractorNameFor(absolute);

  /*
   * Browser-only hosts are exactly why the native bridge exists. Do not spend
   * another HTTP redirect timeout before opening the WebView.
   */
  if (directName === "BrowserPlayer") {
    console.log("[MSM21] native direct host=" + hostOf(absolute));
    return resolveWithNativeWebView(
      absolute,
      referer || absolute,
      "BrowserPlayer"
    );
  }

  return followRedirectCloudstream(absolute, referer).then(function(finalUrl) {
    finalUrl = finalUrl || absolute;
    console.log(
      "[MSM21] iframe=" + hostOf(absolute) +
      (finalUrl !== absolute ? " redirect=" + hostOf(finalUrl) : "")
    );
    return dispatchExtractor(finalUrl, referer || absolute, depth || 0);
  });
}



function attachMirrorLabel(resolved, mirror) {
  var output = resolved || { streams: [], subtitles: [] };
  output.streams = (output.streams || []).map(function(stream) {
    var copy = Object.assign({}, stream);
    copy.serverLabel = mirror.label || PROVIDER_NAME;
    return copy;
  });
  return output;
}

function resolveMirror(mirror, pageUrl) {
  var mirrorHost = hostOf(mirror && mirror.url);
  if (mirrorHost && DNS_DEAD_HOSTS[mirrorHost]) {
    vueoTrace("HOST_SKIP", { host: mirrorHost, reason: "dns-dead" });
    return Promise.resolve({ streams: [], subtitles: [] });
  }
  return loadExtractorEquivalent(mirror.url, pageUrl, 0)
    .then(function(resolved) {
      return attachMirrorLabel(resolved, mirror);
    })
    .catch(function(error) {
      var message = error && error.message ? error.message : String(error);
      var failedHost = hostOf(mirror.url);
      if (failedHost && /(?:NXDOMAIN|unknown host|name or service not known|nodename nor servname)/i.test(message)) {
        DNS_DEAD_HOSTS[failedHost] = true;
        vueoTrace("HOST_DEAD", { host: failedHost, reason: "dns" });
      }
      console.log(
        "[MSM21] extractor failed server=" + mirror.label +
        " host=" + failedHost +
        " error=" + message
      );
      return { streams: [], subtitles: [] };
    });
}

function resolveOption(option, pageUrl) {
  return fetchMirrors(option, pageUrl).then(function(mirrors) {
    if (!mirrors.length) return { streams: [], subtitles: [] };
    return firstNonEmpty(
      mirrors.slice(0, 3).map(function(mirror) {
        return resolveMirror(mirror, pageUrl);
      }),
      15500
    );
  });
}

function resolvePlayback(html, pageUrl) {
  var options = parsePlayerOptions(html);
  var staticMirrors = collectStaticMirrors(html, pageUrl);

  console.log(
    "[MSM21] options=" +
    options.map(function(option) { return option.label; }).join(" | ")
  );

  if (staticMirrors.length) {
    console.log(
      "[MSM21] static mirrors=" +
      staticMirrors.map(function(mirror) { return hostOf(mirror.url); }).join(" | ")
    );
  }

  var fast = options
    .filter(isFastOption)
    .sort(function(a, b) { return fastPriority(a) - fastPriority(b); })
    .slice(0, 8);

  var preferredFallback = options
    .slice()
    .sort(function(a, b) { return fallbackPriority(a) - fallbackPriority(b); })
    .slice(0, 6);

  var candidates = [];
  var optionSeen = Object.create(null);

  fast.concat(preferredFallback).forEach(function(option) {
    var key = [option.post, option.nume, option.type].join("|");
    if (optionSeen[key]) return;
    optionSeen[key] = true;
    candidates.push(option);
  });

  var tasks = [];

  staticMirrors.slice(0, 3).forEach(function(mirror) {
    tasks.push(resolveMirror(mirror, pageUrl));
  });

  candidates.forEach(function(option) {
    tasks.push(resolveOption(option, pageUrl));
  });

  if (!tasks.length) {
    return Promise.resolve({ streams: [], subtitles: [] });
  }

  /*
   * Cloudstream starts several native hosts concurrently. Doing the same here
   * prevents a dead BrowserPlayer mirror from consuming the whole provider
   * budget before another server is tried.
   */
  return firstNonEmpty(tasks, 16500);
}

function buildStreams(resolved, info, mediaType, season, episode) {
  var subtitles = resolved && Array.isArray(resolved.subtitles)
    ? resolved.subtitles
    : [];
  var sources = resolved && Array.isArray(resolved.streams)
    ? resolved.streams
    : [];

  var seen = Object.create(null);
  var episodeLabel =
    mediaType === "tv"
      ? " S" + String(season || 1).padStart(2, "0") +
        "E" + String(episode || 1).padStart(2, "0")
      : "";

  return sources.map(function(source, index) {
    if (!source || !source.url || seen[source.url]) return null;
    seen[source.url] = true;

    var referer = source.referer || currentBaseUrl + "/";
    var server = source.serverLabel || PROVIDER_NAME;

    return {
      name: PROVIDER_NAME + " " + server,
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: source.url,
      quality: source.quality || inferQuality(source.url, ""),
      subtitles: subtitles,
      headers: Object.assign({
        "User-Agent": USER_AGENT,
        "Referer": referer
      }, source.headers || {})
    };
  }).filter(Boolean);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var requestedSeason = Number(season || 1);
  var requestedEpisode = Number(episode || 1);
  var info;

  console.log(
    "[MSM21] Request tmdbId=" + tmdbId +
    " type=" + type +
    (type === "tv" ? " S" + requestedSeason + "E" + requestedEpisode : "")
  );

  var work = getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestTitle(info, type);
    })
    .then(function(match) {
      var detailUrl = rewriteToCurrentDomain(match.href);

      var detailPromise = match.__detailHtml
        ? Promise.resolve({
            text: match.__detailHtml,
            url: detailUrl
          })
        : requestText(
            detailUrl,
            { "Referer": currentBaseUrl + "/" },
            1400
          );

      return detailPromise.then(function(detail) {
        updateBaseFromUrl(detail.url || detailUrl);

        var targetUrl =
          type === "tv"
            ? parseEpisodeTarget(
                detail.text,
                detail.url || detailUrl,
                requestedSeason,
                requestedEpisode
              )
            : (detail.url || detailUrl);

        if (type === "movie") {
          return {
            html: detail.text,
            url: targetUrl
          };
        }

        return requestText(
          targetUrl,
          { "Referer": detail.url || detailUrl },
          1400
        ).then(function(episodePage) {
          updateBaseFromUrl(episodePage.url || targetUrl);
          return {
            html: episodePage.text,
            url: episodePage.url || targetUrl
          };
        });
      });
    })
    .then(function(playbackPage) {
      return resolvePlayback(playbackPage.html, playbackPage.url);
    })
    .then(function(resolved) {
      var streams = buildStreams(
        resolved,
        info,
        type,
        type === "tv" ? requestedSeason : null,
        type === "tv" ? requestedEpisode : null
      );

      console.log("[MSM21] Direct streams found=" + streams.length);
      return streams;
    });

  return withSoftTimeout(work, 17000, "MSM21 provider")
    .catch(function(error) {
      console.error(
        "[MSM21] " +
        (error && error.message ? error.message : String(error))
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
function createMsmProvider(transportFetch) {
const REQUEST_MS = 3500;
const SCAN_MS = 6500;
var stopped = false;
var pendingRequests = [];
function stopScan() {
  stopped = true;
  pendingRequests.slice().forEach(function (cancel) { cancel(); });
}
function fetch(url, options) {
  if (stopped) return Promise.reject(new Error('scan_stopped'));
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var opts = Object.assign({}, options || {});
  if (controller) opts.signal = controller.signal;
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer;
    function remove() { clearTimeout(timer); var i = pendingRequests.indexOf(cancel); if (i >= 0) pendingRequests.splice(i, 1); }
    function cancel() { if (controller) controller.abort(); if (!done) { done = true; remove(); reject(new Error('request_cancelled')); } }
    pendingRequests.push(cancel);
    timer = setTimeout(cancel, REQUEST_MS);
    Promise.resolve().then(function () { return transportFetch(url, opts); }).then(function (res) {
      if (done || stopped) return;
      done = true;
      remove();
      // Headers can be inspected without downloading a full video body.
      resolve({ status: res.status, ok: res.ok, url: res.url || url, headers: res.headers,
        text: function () {
          return new Promise(function (readResolve, readReject) {
            var settled = false;
            function end(error, value) { if (settled) return; settled = true; clearTimeout(readTimer); var i = pendingRequests.indexOf(readCancel); if (i >= 0) pendingRequests.splice(i, 1); if (error) readReject(error); else readResolve(value); }
            function readCancel() { if (controller) controller.abort(); end(new Error('body_cancelled')); }
            pendingRequests.push(readCancel);
            var readTimer = setTimeout(readCancel, REQUEST_MS);
            if (stopped) return readCancel();
            Promise.resolve().then(function () { return res.text(); }).then(function (v) { end(null, v); }, function (e) { end(e); });
          });
        },
        cancel: function () { if (controller) controller.abort(); if (res.body && res.body.cancel) Promise.resolve(res.body.cancel()).catch(function () {}); }
      });
    }, function (error) { if (!done) { done = true; remove(); reject(error); } });
  });
}
function mediaAllowed(raw) {
  var host = hostOf(raw);
  return /^https?:\/\//i.test(raw) && host && !/(^|\.)(?:google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|mc\.yandex\.(?:ru|com)|pixel\.morphify\.(?:com|net)|static\.cloudflareinsights\.com)$/.test(host);
}
function signedQuery(raw, key, value) {
  var enc = function (s) { return encodeURIComponent(String(s)).replace(/[!'()*]/g, function(c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }).replace(/%20/g, '+'); };
  var clean = raw.split('#')[0]; var q = clean.indexOf('?');
  var pairs = (q < 0 ? '' : clean.slice(q + 1)).split('&').filter(function (p) { return p && p.split('=')[0] !== enc(key); });
  pairs.push(enc(key) + '=' + enc(value)); return (q < 0 ? clean : clean.slice(0, q)) + '?' + pairs.join('&');
}
function playerXUrl(raw, base) {
  if (/^https?:\/\//i.test(raw)) return raw; // Never normalize signed absolute URLs.
  if (/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  try { return new URL(raw, base).href; } catch (_) { return absoluteUrl(base.replace(/\/?$/, '/'), raw); }
}
function resolvePlayerX(url, pageUrl) {
  var host = hostOf(url);
  if (['playerx.player4me.online','playerx.rpmplay.online','playerx.seekplays.online','playerx.p2pstream.online','playerx.upns.live'].indexOf(host) < 0 || !/^https:\/\//.test(url)) return Promise.resolve([]);
  var id = url.indexOf('#') < 0 ? '' : url.split('#')[1].split('&')[0];
  if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) return Promise.resolve([]);
  var base = originOf(url); var headers = {'User-Agent':USER_AGENT,'Referer':base+'/','Origin':base};
  return fetchText(base + '/api/v1/video?id=' + encodeURIComponent(id) + '&w=1080&h=1080&r=' + encodeURIComponent(hostOf(pageUrl).replace(/^www\./,'')), {headers:headers}).then(function (hex) {
    hex = String(hex).trim();
    if (hex.length < 32 || hex.length > 2000000 || hex.length % 32 || !/^[0-9a-f]+$/i.test(hex)) return [];
    var C = require('crypto-js');
    // Both CryptoJS and VUEO's bridge accept a Base64 ciphertext string.
    var ciphertext = C.enc.Base64.stringify(C.enc.Hex.parse(hex));
    var decoded = C.AES.decrypt(ciphertext, C.enc.Utf8.parse('kiemtienmua911ca'), {iv:C.enc.Utf8.parse('1234567890oiuytr'),mode:C.mode.CBC,padding:C.pad.Pkcs7}).toString(C.enc.Utf8);
    var data = JSON.parse(decoded.replace(/^\uFEFF/,'')); var adjust = {};
    try { adjust = JSON.parse(data.streamingConfig || '{}').adjust || {}; } catch (_) {}
    var options = [];
    if (!(adjust.Cloudflare || {}).disabled) options.push(['Native',data.cfNative]);
    [['In-House','source'],['Tiktok','hlsVideoTiktok'],['Google','hlsVideoGoogle']].forEach(function (pair) {
      var cfg = adjust[pair[0]] || {}; var raw = data[pair[1]];
      if (cfg.disabled || typeof raw !== 'string' || !raw.trim()) return;
      if (cfg.domain) raw = raw.split('/hls/').join('/hlsmod/' + cfg.domain + '/');
      Object.keys(cfg.params || {}).forEach(function (k) { raw = signedQuery(raw,k,cfg.params[k]); });
      if (playerXUrl(raw,base).split('?')[0].indexOf('/v4/') >= 0) ['k','kx'].forEach(function (k) { if ((data.pk || {})[k]) raw = signedQuery(raw,k,data.pk[k]); });
      options.push([pair[0],raw]);
    });
    var seen = {};
    return options.map(function (pair) {
      if (typeof pair[1] !== 'string') return null;
      var media = playerXUrl(pair[1].trim(),base);
      if (!mediaAllowed(media) || seen[media]) return null; seen[media] = true;
      return {url:media,referer:base+'/',headers:headers,label:'PlayerX '+pair[0],mimeType:'application/x-mpegURL'};
    }).filter(Boolean);
  }).catch(function (error) { console.log('[MSM21] PLAYERX_FAILED host='+host+' error='+String(error && error.name || 'Error'));return []; });
}
function playbackHeaders(stream) {
  var headers = Object.assign({},stream.headers || {});
  function has(name) { return Object.keys(headers).some(function(k) { return k.toLowerCase() === name.toLowerCase(); }); }
  if (!has('User-Agent')) headers['User-Agent'] = USER_AGENT;
  if (!has('Accept')) headers.Accept = '*/*';
  if (stream.noReferer) { delete headers.Referer; delete headers.referer; }
  else if (!has('Referer')) headers.Referer = stream.referer || originOf(stream.url)+'/';
  return headers;
}
function checkSource(stream) {
  if (stopped || !mediaAllowed(stream.url)) return Promise.resolve(null);
  var hls = stream.mimeType === 'application/x-mpegURL' || /\.m3u8(?:[?#]|$)/i.test(stream.url);
  var headers = playbackHeaders(stream); if (!hls) headers.Range = 'bytes=0-511';
  return fetch(stream.url,{headers:headers}).then(function (res) {
    if ([200,206].indexOf(res.status) < 0 || !mediaAllowed(res.url)) { res.cancel();return null; }
    var responseType = res.headers && res.headers.get ? String(res.headers.get('content-type') || '') : '';
    if (hls || /mpegurl/i.test(responseType)) return res.text().then(function (body) {
      var text = String(body).trim().replace(/^\uFEFF/,''); if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) return null;
      var lines = text.split(/\r?\n/).map(function(l){return l.trim();});
      var master = lines.some(function (l,i) { return /^#EXT-X-STREAM-INF:/.test(l) && lines[i+1] && lines[i+1][0] !== '#' && mediaAllowed(playerXUrl(lines[i+1],res.url)); });
      var media = /^#EXTINF:/m.test(text) && lines.some(function(l){return l && l[0] !== '#' && mediaAllowed(playerXUrl(l,res.url));});
      return master || media ? Object.assign({},stream,{checkedHls:true,masterHls:master,mimeType:'application/x-mpegURL'}) : null;
    });
    var type = res.headers && res.headers.get ? String(res.headers.get('content-type') || '') : '';
    var range = res.headers && res.headers.get ? String(res.headers.get('content-range') || '') : '';
    res.cancel();
    return /^video\//i.test(type) || (/application\/octet-stream/i.test(type) && /\/\d+$/.test(range)) ? stream : null;
  }).catch(function(){return null;});
}
function firstResult(jobs) {
  if (!jobs.length) return Promise.resolve([]);
  return new Promise(function(resolve) {
    var remaining = jobs.length; var settled = false;
    jobs.forEach(function(job) { Promise.resolve(job).then(function(result) {
      if (settled) return;
      if (result && result.length) { settled = true; resolve(result); }
      else if (--remaining === 0) { settled = true;resolve([]); }
    }, function() { if (!settled && --remaining === 0) {settled=true;resolve([]);} }); });
  });
}
function firstChecked(streams, mirror, choice) {
  var seen = {};
  var candidates = (streams || []).filter(function(s) { if (!s || seen[s.url]) return false;seen[s.url]=true;return true; });
  // PlayerX Native is the master proxy advertised by its API; try HLS candidates before direct files.
  var hls = candidates.filter(function(s){return s.mimeType === 'application/x-mpegURL' || /\.m3u8(?:[?#]|$)/i.test(s.url);});
  var direct = candidates.filter(function(s){return hls.indexOf(s)<0;});
  function group(items) { return firstResult(items.map(function(s){return checkSource(s).then(function(v){
    if (!v) return [];v.label=mirror.label || v.label;v.choiceId=choice;return [v];
  });})); }
  return group(hls).then(function(result){return result.length ? result : group(direct);});
}
function scanPlayback(base, playback) {
  var options = extractPlayerOptions(playback.html);
  var jobs = options.length ? options.map(function(option) {
    var choice = option.post+'|'+option.nume+'|'+option.type;
    return fetchOptionMirrors(base,playback.url,option).then(function(mirrors){
      return firstResult(mirrors.map(function(mirror){return resolveMirror(mirror,playback.url,0).then(function(streams){return firstChecked(streams,mirror,choice);});}));
    });
  }) : collectStaticMirrors(playback.html,playback.url).map(function(mirror){
    return resolveMirror(mirror,playback.url,0).then(function(streams){return firstChecked(streams,mirror,mirror.url);});
  });
  // Keep one checked winner per website option. An empty/failed option is
  // complete immediately; it cannot cancel winners from other options.
  return new Promise(function (resolve) {
    var done = false;
    var remaining = jobs.length;
    var groups = [];
    var timer = setTimeout(finish, SCAN_MS);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopScan();
      resolve(groups);
    }

    function completed(result) {
      if (done) return;
      if (result && result.length) groups.push(result.slice(0, 1));
      if (--remaining === 0) finish();
    }

    if (!remaining) return finish();
    jobs.forEach(function (job) {
      Promise.resolve(job).then(completed, function () { completed([]); });
    });
  });
}

const PROVIDER = "MSM21";
const BASE_CANDIDATES = [
  "https://pencurimoviesubmalay26.site",
  "https://movisubmalay.org"
];
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const PLAYMATE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0";

var resolvedBasePromise = null;

function getCheerio() {
  return require("cheerio-without-node-native");
}

function fetchResponse(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
      if (res && res.cancel) res.cancel();
      throw new Error("HTTP " + (res ? res.status : "unknown") + " " + url);
    }
    return res.text().then(function (text) {
      return {
        text: text,
        url: res.url || url,
        status: res.status
      };
    });
  });
}

function fetchText(url, options) {
  return fetchResponse(url, options).then(function (x) { return x.text; });
}

function fetchJson(url, options) {
  return fetchText(url, options).then(function (text) {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : String(url || "").replace(/\/+$/, "");
}

function absoluteUrl(base, value) {
  var raw = String(value || "")
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/\\\//g, "/");

  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return "https:" + raw;

  var root = originOf(base);
  if (raw.charAt(0) === "/") return root + raw;

  var cleanBase = String(base || "").split("#")[0].split("?")[0];
  cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf("/") + 1);
  return cleanBase + raw;
}

function resolveBase() {
  // The current MSM21 domain is already known. Avoid a homepage probe because
  // VUEO gives providers a short scan budget and that probe can cost 1-2s.
  if (!resolvedBasePromise) {
    resolvedBasePromise = Promise.resolve(BASE_CANDIDATES[0]);
  }
  return resolvedBasePromise;
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();

  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}

  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripYear(value) {
  return String(value || "")
    .replace(/\s*\(((?:19|20)\d{2})\)\s*$/i, "")
    .trim();
}

function yearFromTitle(value) {
  var m = String(value || "").match(/\(((?:19|20)\d{2})\)\s*$/);
  return m ? Number(m[1]) : null;
}

function getTmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  }).then(function (data) {
    var altRoot = data.alternative_titles || {};
    var altItems = type === "movie"
      ? (Array.isArray(altRoot.titles) ? altRoot.titles : [])
      : (Array.isArray(altRoot.results) ? altRoot.results : []);

    return {
      title: type === "movie"
        ? (data.title || data.original_title || "")
        : (data.name || data.original_name || ""),
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4),
      alternativeTitles: altItems.map(function (x) {
        return x && x.title ? String(x.title).trim() : "";
      }).filter(Boolean)
    };
  });
}

function buildQueries(details) {
  var out = [];

  function add(v) {
    v = String(v || "").trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  }

  add(details.title);
  add(details.originalTitle);

  (details.alternativeTitles || []).slice(0, 3).forEach(add);
  return out.slice(0, 5);
}

function slugifyTitle(value) {
  var text = String(value || "").trim().toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}

  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function parsePageIdentity(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(String(html || ""));
  var rawTitle = String(
    $(".details-title h3").first().text() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    ""
  ).replace(/\s+/g, " ").trim();

  rawTitle = rawTitle
    .replace(/\s*[-–|]\s*movisubmalay(?:\.org)?\s*$/i, "")
    .trim();

  var year = yearFromTitle(rawTitle);
  if (!year) {
    $(".details-info p").each(function (_, el) {
      if (year) return;
      var row = $(el);
      var strong = String(row.find("strong").first().text() || "")
        .trim().replace(/:$/, "");
      if (/^year$/i.test(strong)) {
        var m = String(row.text() || "").match(/((?:19|20)\d{2})/);
        if (m) year = Number(m[1]);
      }
    });
  }

  return {
    title: stripYear(rawTitle),
    rawTitle: rawTitle,
    year: year
  };
}

function validateDirectPage(html, details, mediaType) {
  var identity = parsePageIdentity(html);
  if (!identity.title) return null;

  var accepted = acceptedTitleSet(details);
  if (!accepted[normalizeTitle(identity.title)]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(identity.year || 0);
  if (
    mediaType === "movie" &&
    targetYear && itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  return identity;
}

function tryDirectTitlePage(base, details, mediaType) {
  var slug = slugifyTitle(details.title || details.originalTitle || "");
  if (!slug) return Promise.resolve(null);

  var year = String(details.year || "").trim();
  var path = mediaType === "movie"
    ? "/movies/" + slug + (year ? "-" + year : "") + "/"
    : "/tvshows/" + slug + "/";
  var url = base + path;

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var identity = validateDirectPage(html, details, mediaType);
    if (!identity) return null;

    console.log("[MSM21] fast title='" + identity.rawTitle + "' url=" + url);
    return {
      title: identity.title,
      rawTitle: identity.rawTitle,
      year: identity.year,
      url: url,
      mediaType: mediaType,
      html: html
    };
  }).catch(function () {
    return null;
  });
}

function parseSearchResults(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var results = [];

  $("div.display-item").each(function (_, element) {
    var box = $(element);
    var anchor = box.find("div.item-box > a[href], a.ml-mask[href], a[href]").first();
    var href = absoluteUrl(pageUrl, anchor.attr("href"));
    if (!href) return;

    var rawTitle = String(
      anchor.attr("title") ||
      box.find(".item-desc-title h3, .item-data h3, h3").first().text() ||
      ""
    ).replace(/\s+/g, " ").trim();

    if (!rawTitle) return;

    var typeAttr = String(anchor.attr("data-ptype") || "").toLowerCase();
    var isTv = typeAttr.indexOf("tv") >= 0 || /\/tvshows\//i.test(href);

    results.push({
      title: stripYear(rawTitle),
      rawTitle: rawTitle,
      year: yearFromTitle(rawTitle),
      url: href,
      mediaType: isTv ? "tv" : "movie"
    });
  });

  return results;
}

function searchSite(base, query) {
  var url = base + "/?s=" + encodeURIComponent(query);

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    return parseSearchResults(html, url);
  });
}

function acceptedTitleSet(details) {
  var set = {};

  [details.title, details.originalTitle]
    .concat(details.alternativeTitles || [])
    .filter(Boolean)
    .forEach(function (title) {
      var n = normalizeTitle(title);
      if (n) set[n] = true;
    });

  return set;
}

function scoreCandidate(item, details, mediaType) {
  if (!item || item.mediaType !== mediaType) return null;

  var targets = acceptedTitleSet(details);
  var title = normalizeTitle(item.title);

  if (!targets[title]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(item.year || 0);

  if (
    mediaType === "movie" &&
    targetYear &&
    itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  var score = 100;
  if (title === normalizeTitle(details.title)) score += 40;
  if (targetYear && itemYear && targetYear === itemYear) score += 30;
  return score;
}

function findBestTitle(base, details, mediaType) {
  var queries = buildQueries(details);
  var index = 0;
  var seen = {};

  function next() {
    if (index >= queries.length) {
      var sample = Object.keys(seen).slice(0, 8).map(function (key) {
        var x = seen[key];
        return x.rawTitle + " [" + x.mediaType + "]";
      }).join(" | ");

      console.log(
        "[MSM21] no title match for '" + details.title + "'" +
        (sample ? " candidates=" + sample : "")
      );
      return Promise.resolve(null);
    }

    var query = queries[index++];
    return searchSite(base, query).then(function (items) {
      items.forEach(function (item) {
        if (!seen[item.url]) seen[item.url] = item;
      });

      var ranked = items.map(function (item) {
        return { item: item, score: scoreCandidate(item, details, mediaType) };
      }).filter(function (x) {
        return typeof x.score === "number";
      }).sort(function (a, b) {
        return b.score - a.score;
      });

      if (ranked.length) {
        console.log(
          "[MSM21] matched title='" + ranked[0].item.rawTitle +
          "' url=" + ranked[0].item.url
        );
        return ranked[0].item;
      }

      return next();
    }).catch(function (error) {
      console.log("[MSM21] search failed query='" + query + "' error=" + error.message);
      return next();
    });
  }

  return next();
}

function findTitleFast(base, details, mediaType) {
  return tryDirectTitlePage(base, details, mediaType).then(function (direct) {
    if (direct) return direct;
    return findBestTitle(base, details, mediaType);
  });
}

function episodeNumberFromElement($, el) {
  var node = $(el);
  var text = node.find(".ep-num").first().text() || node.text() || "";
  var m = String(text).match(/(\d+)/);
  if (m) return Number(m[1]);

  var href = String(node.attr("href") || "");
  m = href.match(/(?:episode|ep)[-_\/]?(\d+)/i);
  return m ? Number(m[1]) : null;
}

function findEpisodeUrl(html, pageUrl, season, episode) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var wantedSeason = Number(season || 1);
  var wantedEpisode = Number(episode || 1);
  var found = "";

  $("ul.episodes-list").each(function (_, listEl) {
    if (found) return;

    var list = $(listEl);
    var id = String(list.attr("id") || "");
    var seasonMatch = id.match(/(\d+)\s*$/);
    var listSeason = seasonMatch ? Number(seasonMatch[1]) : 1;

    if (listSeason !== wantedSeason) return;

    list.find("li a[href]").each(function (_, aEl) {
      if (found) return;
      var ep = episodeNumberFromElement($, aEl);
      if (ep === wantedEpisode) {
        found = absoluteUrl(pageUrl, $(aEl).attr("href"));
      }
    });
  });

  if (found) return found;

  $("a[href]").each(function (_, aEl) {
    if (found) return;

    var a = $(aEl);
    var href = absoluteUrl(pageUrl, a.attr("href"));
    var text = String(a.text() || "").replace(/\s+/g, " ").trim();
    var combined = (href + " " + text).toLowerCase();

    var sOk =
      new RegExp("(?:season|s)[-_ /]?" + wantedSeason + "(?:\\D|$)", "i").test(combined) ||
      wantedSeason === 1;

    var eOk =
      new RegExp("(?:episode|ep|e)[-_ /]?" + wantedEpisode + "(?:\\D|$)", "i").test(combined);

    if (sOk && eOk) found = href;
  });

  return found;
}

function loadPlaybackPage(base, item, mediaType, season, episode) {
  var pagePromise = item && item.html
    ? Promise.resolve(item.html)
    : fetchText(item.url, {
        headers: {
          "Accept": "text/html,*/*",
          "Referer": base + "/",
          "User-Agent": USER_AGENT
        }
      });

  return pagePromise.then(function (html) {
    if (mediaType === "movie") {
      return {
        url: item.url,
        html: html
      };
    }

    var episodeUrl = findEpisodeUrl(html, item.url, season, episode);

    if (!episodeUrl) {
      console.log(
        "[MSM21] episode not found S" + Number(season || 1) +
        "E" + Number(episode || 1)
      );
      return null;
    }

    console.log("[MSM21] episode url=" + episodeUrl);

    return fetchText(episodeUrl, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": item.url,
        "User-Agent": USER_AGENT
      }
    }).then(function (episodeHtml) {
      return {
        url: episodeUrl,
        html: episodeHtml
      };
    });
  });
}

function collectStaticMirrors(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw, label) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || /youtube\.com|youtu\.be|facebook\.com|t\.me\//i.test(url)) return;
    found[url] = label || "MSM21";
  }

  $(
    ".player-display iframe[src], .player-display iframe[data-src]," +
    " iframe.metaframe[src], iframe.metaframe[data-src]," +
    " video[src], video source[src], iframe[src], iframe[data-src]"
  ).each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src"), "MSM21");
  });

  return Object.keys(found).map(function (url) {
    return { url: url, label: found[url] };
  });
}

function extractPlayerOptions(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var out = [];

  $("[data-post][data-nume][data-type]").each(function (_, el) {
    var node = $(el);
    var nume = String(node.attr("data-nume") || "").trim();
    var post = String(node.attr("data-post") || "").trim();
    var type = String(node.attr("data-type") || "").trim();

    if (!nume || /^fake$/i.test(nume) || !post || !type) return;

    var label = node.text().replace(/\s+/g, " ").trim() || ("Server " + nume);

    out.push({
      post: post,
      nume: nume,
      type: type,
      label: label
    });
  });

  var seen = {};
  return out.filter(function (x) {
    var key = x.post + "|" + x.nume + "|" + x.type;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function extractUrlsFromEmbedHtml(embedHtml, pageUrl) {
  var cheerio = getCheerio();
  var html = String(embedHtml || "").trim();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || /youtube\.com|youtu\.be|facebook\.com|t\.me\//i.test(url)) return;
    found[url] = true;
  }

  if (/^https?:\/\//i.test(html)) add(html);

  $("iframe[src], iframe[data-src], video[src], source[src]").each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src"));
  });

  var clean = html.replace(/\\\//g, "/");
  var matches = clean.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
  matches.slice(0, 20).forEach(add);

  return Object.keys(found);
}

function fetchOptionMirrors(base, pageUrl, option) {
  var body =
    "action=zeta_player_ajax" +
    "&post=" + encodeURIComponent(option.post) +
    "&nume=" + encodeURIComponent(option.nume) +
    "&type=" + encodeURIComponent(option.type);

  return fetchText(base + "/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": pageUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT
    },
    body: body
  }).then(function (text) {
    var data;

    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    var embed = data && (
      data.embed_url ||
      data.embedUrl ||
      data.url ||
      data.result
    );

    if (!embed) embed = text;

    return extractUrlsFromEmbedHtml(embed, pageUrl).map(function (url) {
      return {
        url: url,
        label: option.label
      };
    });
  }).catch(function (error) {
    console.log(
      "[MSM21] ajax option failed " + option.label + " error=" + error.message
    );
    return [];
  });
}

function isLikelyStreamUrl(raw) {
  var value = String(raw || "").toLowerCase();
  if (!/^https?:\/\//i.test(String(raw || ""))) return false;

  return /\.(?:m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(value) ||
    value.indexOf("/sora/") >= 0 ||
    value.indexOf("manifest.m3u8") >= 0 ||
    value.indexOf("master.m3u8") >= 0 ||
    /[?&](?:mime|type)=video/i.test(value);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function unpackPacker(source) {
  var text = String(source || "");
  var marker = "eval(function(p,a,c,k,e,d)";
  if (text.indexOf(marker) === -1) return text;

  var re = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/;
  var match = re.exec(text);
  if (!match) return text;

  var payload = match[1]
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
  var radix = Number(match[2]);
  var count = Number(match[3]);
  var symtab = match[4].split("|");

  function encodeBase(num, base) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (num < base) return chars.charAt(num);
    return encodeBase(Math.floor(num / base), base) + chars.charAt(num % base);
  }

  for (var i = count - 1; i >= 0; i--) {
    if (!symtab[i]) continue;
    var word = encodeBase(i, radix);
    payload = payload.replace(
      new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"),
      symtab[i]
    );
  }

  return payload;
}

function resolveMixDrop(url, referer) {
  if (!/(?:mixdrop|mxdrop|mdy48tn97)/i.test(url)) {
    return Promise.resolve([]);
  }

  var embedUrl = String(url).replace("/f/", "/e/");

  return fetchText(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || embedUrl,
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var match = unpacked.match(/wurl.*?=.*?["']([^"']+)["'];?/i);
    if (!match) return [];

    var streamUrl = String(match[1] || "");
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];

    return [{
      url: streamUrl,
      referer: embedUrl,
      label: "MixDrop"
    }];
  }).catch(function () {
    return [];
  });
}

function resolveStreamWish(url, referer) {
  if (!/(?:streamwish|hglink|wish|filelions|filelion|rapidplayers|dwish|embedwish|flaswish|cdnwish|hlswish)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || url,
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var candidates = mediaUrlsFromText(unpacked, url);

    if (!candidates.length) {
      var matches = unpacked.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
      candidates = matches.filter(isLikelyStreamUrl);
    }

    return candidates.map(function (streamUrl) {
      return {
        url: streamUrl,
        referer: url,
        label: "StreamWish"
      };
    });
  }).catch(function () {
    return [];
  });
}

function rot13(value) {
  return String(value || "").replace(/[a-zA-Z]/g, function (c) {
    var code = c.charCodeAt(0);
    var base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function base64DecodeBinary(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(input || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var output = "";
  var i = 0;

  while (i < clean.length) {
    var e1 = chars.indexOf(clean.charAt(i++));
    var e2 = chars.indexOf(clean.charAt(i++));
    var c3 = clean.charAt(i++);
    var c4 = clean.charAt(i++);
    var e3 = c3 === "=" ? 64 : chars.indexOf(c3);
    var e4 = c4 === "=" ? 64 : chars.indexOf(c4);

    if (e1 < 0 || e2 < 0) break;

    var b1 = (e1 << 2) | (e2 >> 4);
    output += String.fromCharCode(b1);

    if (e3 !== 64 && e3 >= 0) {
      var b2 = ((e2 & 15) << 4) | (e3 >> 2);
      output += String.fromCharCode(b2);
    }

    if (e4 !== 64 && e4 >= 0 && e3 >= 0) {
      var b3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(b3);
    }
  }

  return output;
}

function binaryToUtf8(binary) {
  try {
    var encoded = "";
    for (var i = 0; i < binary.length; i++) {
      encoded += "%" + ("0" + binary.charCodeAt(i).toString(16)).slice(-2);
    }
    return decodeURIComponent(encoded);
  } catch (_) {
    return binary;
  }
}

function decryptVoe(encoded) {
  try {
    var step1 = rot13(encoded);
    var patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

    patterns.forEach(function (pattern) {
      step1 = step1.split(pattern).join("_");
    });

    var step2 = step1.replace(/_/g, "");
    var step3 = base64DecodeBinary(step2);
    var step4 = "";

    for (var i = 0; i < step3.length; i++) {
      step4 += String.fromCharCode(step3.charCodeAt(i) - 3);
    }

    var step5 = step4.split("").reverse().join("");
    var decoded = binaryToUtf8(base64DecodeBinary(step5));
    return JSON.parse(decoded);
  } catch (_) {
    return null;
  }
}

function resolveVoe(url, referer) {
  if (!/(?:voe\.|voe\.sx|tubeless|simpulum|urochs|nathanfromsubject|yip\.su|metagnath|donaldlineelse|charlestoughrace)/i.test(url)) {
    return Promise.resolve([]);
  }

  function load(target) {
    return fetchResponse(target, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": referer || target,
        "User-Agent": USER_AGENT
      }
    });
  }

  return load(url).then(function (response) {
    var redirect = response.text.match(/window\.location\.href\s*=\s*'([^']+)'/i);

    if (redirect) {
      return load(absoluteUrl(response.url || url, redirect[1]));
    }

    return response;
  }).then(function (response) {
    var cheerio = getCheerio();
    var $ = cheerio.load(response.text);
    var raw = $("script[type='application/json']").first().text().trim();

    if (!raw) return [];

    var encoded = raw;
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) encoded = String(parsed[0] || "");
    } catch (_) {
      encoded = raw.replace(/^\s*\[\s*"/, "").replace(/"\s*\]\s*$/, "");
    }

    var data = decryptVoe(encoded);
    if (!data) return [];

    var out = [];

    if (data.source && isLikelyStreamUrl(data.source)) {
      out.push({
        url: data.source,
        referer: response.url || url,
        label: "VOE"
      });
    }

    if (data.direct_access_url && isLikelyStreamUrl(data.direct_access_url)) {
      out.push({
        url: data.direct_access_url,
        referer: response.url || url,
        label: "VOE MP4"
      });
    }

    return out;
  }).catch(function () {
    return [];
  });
}

function mediaUrlsFromText(text, baseUrl) {
  var input = decodeHtmlEntities(String(text || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  var found = {};

  function add(raw) {
    raw = String(raw || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/["'\\]+$/g, "");

    var url = absoluteUrl(baseUrl, raw);
    if (!url) return;

    if (isLikelyStreamUrl(url)) {
      found[url] = true;
    }
  }

  var absolute = input.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
  absolute.forEach(add);

  var protocolRelative = input.match(/\/\/[a-z0-9.-]+\/[^\s"'<>\\]+/ig) || [];
  protocolRelative.forEach(add);

  return Object.keys(found);
}

function nestedFramesFromHtml(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (
      !url ||
      url === pageUrl ||
      /youtube\.com|youtu\.be|facebook\.com|googlesyndication|doubleclick/i.test(url)
    ) {
      return;
    }
    found[url] = true;
  }

  $("iframe[src], iframe[data-src], [data-video], [data-url], [data-embed]").each(function (_, el) {
    var node = $(el);
    add(
      node.attr("data-src") ||
      node.attr("src") ||
      node.attr("data-video") ||
      node.attr("data-url") ||
      node.attr("data-embed")
    );
  });

  return Object.keys(found).slice(0, 6);
}

function randomToken(length) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var out = "";
  for (var i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function resolvePlaymate(url) {
  if (!/playmate\.to/i.test(String(url || ""))) {
    return Promise.resolve([]);
  }

  var cleanUrl = String(url || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
  var id = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
  if (!id) return Promise.resolve([]);

  return fetchJson("https://playmate.to/api/s", {
    method: "POST",
    headers: {
      "Accept": "application/json,*/*",
      "Content-Type": "application/json",
      "User-Agent": PLAYMATE_USER_AGENT
    },
    body: JSON.stringify({ c: id, d: "web" })
  }).then(function (data) {
    var streamUrl = String(data && data.sx || "").trim();
    if (!/^https?:\/\//i.test(streamUrl)) return [];

    console.log("[MSM21] Playmate direct=" + hostOf(streamUrl));
    return [{
      url: streamUrl,
      label: "Playmate",
      noReferer: true,
      headers: {
        "Accept": "*/*",
        "User-Agent": PLAYMATE_USER_AGENT
      }
    }];
  }).catch(function (error) {
    console.log("[MSM21] Playmate resolver error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function resolveDood(url, referer) {
  if (!/(?:dood|dsvplay|ds2play|vide0\.net|myvidplay)/i.test(url)) {
    return Promise.resolve([]);
  }

  var embedUrl = String(url).replace("/d/", "/e/");

  return fetchResponse(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(embedUrl) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var html = response.text;
    var finalEmbedUrl = response.url || embedUrl;
    var host = originOf(finalEmbedUrl);
    var passMatch = html.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!passMatch) return [];

    var passPath = passMatch[0];
    var passUrl = /^https?:\/\//i.test(passPath) ? passPath : host + passPath;
    var token = passUrl.substring(passUrl.lastIndexOf("/") + 1);
    if (!token) return [];

    return fetchText(passUrl, {
      headers: {
        "Accept": "*/*",
        "Referer": finalEmbedUrl,
        "User-Agent": USER_AGENT
      }
    }).then(function (prefix) {
      var base = String(prefix || "").trim();
      if (!/^https?:\/\//i.test(base)) return [];

      var finalUrl = base + randomToken(10) + "?token=" + encodeURIComponent(token);
      console.log("[MSM21] Dood direct=" + hostOf(finalUrl));

      return [{
        url: finalUrl,
        referer: host + "/",
        label: "Dood",
        headers: {
          "Accept": "*/*",
          "Referer": host + "/",
          "User-Agent": USER_AGENT
        }
      }];
    });
  }).catch(function (error) {
    console.log("[MSM21] Dood resolver error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function collectMediaFromObject(value, baseUrl, out, depth) {
  if (depth > 7 || value == null) return;

  if (typeof value === "string") {
    var clean = decodeHtmlEntities(value).replace(/\\\//g, "/").trim();

    if (/^https?:\/\//i.test(clean) && isLikelyStreamUrl(clean)) {
      out[clean] = true;
    }

    mediaUrlsFromText(clean, baseUrl).forEach(function (url) {
      out[url] = true;
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(function (x) {
      collectMediaFromObject(x, baseUrl, out, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      var child = value[key];

      if (
        typeof child === "string" &&
        /^(?:file|url|src|source|stream|playlist|hls|video)$/i.test(key)
      ) {
        var candidate = decodeHtmlEntities(child).replace(/\\\//g, "/").trim();
        if (/^https?:\/\//i.test(candidate) && isLikelyStreamUrl(candidate)) {
          out[candidate] = true;
        }
      }

      collectMediaFromObject(child, baseUrl, out, depth + 1);
    });
  }
}

function resolveAbyss(url) {
  if (!/(?:abyss\.|playhydrax\.com)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Origin": originOf(url),
      "Referer": originOf(url) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var match =
      html.match(/const\s+datas\s*=\s*"([^"]+)"/i) ||
      html.match(/datas\s*[:=]\s*'([^']+)'/i);

    if (!match) {
      console.log("[MSM21] Abyss datas not found host=" + hostOf(url));
      return [];
    }

    return fetchJson("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ text: match[1] })
    }).then(function (data) {
      if (!data || Number(data.status) !== 200) {
        console.log("[MSM21] Abyss decrypt failed");
        return [];
      }

      var found = {};
      collectMediaFromObject(data.result, url, found, 0);

      var urls = Object.keys(found);
      console.log("[MSM21] Abyss streams=" + urls.length);

      return urls.map(function (streamUrl) {
        return {
          url: streamUrl,
          referer: url,
          label: "Abyss"
        };
      });
    });
  }).catch(function (error) {
    console.log(
      "[MSM21] Abyss resolver error=" +
      (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function resolveGeneric(url, referer, depth) {
  if (/(?:playerx\.|p2pstream\.|upns\.live|ezpla|rpmpl|seekp)/i.test(url)) {
    console.log("[MSM21] JS-only mirror skipped host=" + hostOf(url));
    return Promise.resolve([]);
  }
  if (isLikelyStreamUrl(url)) {
    return Promise.resolve([{
      url: url,
      referer: referer || originOf(url) + "/",
      label: "Direct"
    }]);
  }

  if (depth > 1) return Promise.resolve([]);

  return fetchResponse(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(url) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var finalUrl = response.url || url;
    var direct = mediaUrlsFromText(response.text, finalUrl).map(function (streamUrl) {
      return {
        url: streamUrl,
        referer: finalUrl,
        label: "Direct"
      };
    });

    if (direct.length) return direct;

    var frames = nestedFramesFromHtml(response.text, finalUrl).slice(0, 3);
    if (!frames.length) return [];

    return Promise.all(frames.map(function (frame) {
      return resolveMirror({
        url: frame,
        label: "Nested"
      }, finalUrl, depth + 1);
    })).then(function (groups) {
      var out = [];
      groups.forEach(function (group) {
        out = out.concat(group);
      });
      return out;
    });
  }).catch(function () {
    return [];
  });
}

function resolveMirror(mirror, pageUrl, depth) {
  var url = String(mirror && mirror.url || "");
  if (!url) return Promise.resolve([]);

  var host = hostOf(url);

  function finish(streams) {
    return (streams || []).map(function (stream) {
      if (!stream.label || stream.label === "Direct" || stream.label === "Nested") {
        stream.label = mirror.label || stream.label || host || "MSM21";
      }
      return stream;
    });
  }

  return resolvePlayerX(url, pageUrl)
    .then(function (streams) {
      if (streams.length) return streams;
      return resolvePlaymate(url);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveDood(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveAbyss(url);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveMixDrop(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveStreamWish(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveVoe(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveGeneric(url, pageUrl, depth || 0);
    })
    .then(function (streams) {
      if (!streams.length) {
        console.log(
          "[MSM21] unresolved host=" + (host || "?") +
          " label='" + String(mirror.label || "") + "'"
        );
      }
      return finish(streams);
    });
}

function qualityFromUrl(url) {
  var value = String(url || "").toLowerCase();
  var m = value.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/);
  if (m) return m[1] + "p";
  if (/4k/.test(value)) return "2160p";
  return "Auto";
}

function formatStreams(streams) {
  var seen = {};
  var out = [];

  streams.forEach(function (stream) {
    var url = String(stream && stream.url || "").trim();
    if (!url || seen[url]) return;
    seen[url] = true;

    var quality = stream.checkedHls ? "Auto" : qualityFromUrl(url);
    var label = String(stream.label || "MSM21").replace(/\bMalaySub\b/ig, "").replace(/\s+/g, " ").trim() || "MSM21";
    var headers = playbackHeaders(stream);

    out.push({
      name: PROVIDER,
      title: label + " • " + quality + " • MalaySub",
      url: url,
      quality: quality,
      headers: headers,
      mimeType: stream.mimeType || undefined
    });
  });

  return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);

  console.log(
    "[MSM21] TMDB=" + tmdbId +
    " type=" + mediaType +
    (mediaType === "tv" ? " S" + season + "E" + episode : "")
  );

  var base;

  return resolveBase()
    .then(function (resolved) {
      base = resolved;
      return getTmdbDetails(tmdbId, mediaType);
    })
    .then(function (details) {
      return findTitleFast(base, details, mediaType);
    })
    .then(function (item) {
      if (!item) return null;
      return loadPlaybackPage(base, item, mediaType, season, episode);
    })
    .then(function (playback) {
      if (!playback) return [];
      return scanPlayback(base, playback);
    })
    .then(function (groups) {
      if (!Array.isArray(groups)) return [];

      var flat = [];
      groups.forEach(function (group) {
        flat = flat.concat(group || []);
      });

      var streams = formatStreams(flat);
      console.log("[MSM21] v1.0.6 checked sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[MSM21] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

return { getStreams };
}

// Each invocation owns its cancellation state; simultaneous scans cannot cancel one another.
module.exports = { getStreams: function () {
  return createMsmProvider(fetch).getStreams.apply(null, arguments);
} };

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
module.exports = cloudbankDisplayInstall(module.exports, "MSM21", "msm21");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
