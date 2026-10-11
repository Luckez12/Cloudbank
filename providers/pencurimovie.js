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



var PROVIDER_NAME = "PencuriMovie";
var FALLBACK_BASE_URL = "https://ww21.pencurimovie.sbs";
var DOMAIN_CONFIG_URL = "https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ms;q=0.8,id;q=0.7"
};

var cachedBaseUrl = null;
var cachedBaseUrlPromise = null;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(new Error((label || "Request") + " timed out"));
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
        url: String(response && response.url || url)
      };
    });
  });

  var requestLabel = "PencuriMovie request";
  try {
    var parsedLabel = new URL(url);
    requestLabel += " " + parsedLabel.hostname + parsedLabel.pathname + parsedLabel.search;
  } catch (_) {}
  return withSoftTimeout(request, timeoutMs || 2200, requestLabel);
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

function safeUrl(value, base) {
  var raw = decodeHtml(String(value || "").trim());
  if (!raw) return "";
  if (raw.indexOf("//") === 0) raw = "https:" + raw;
  try {
    return new URL(raw, base || FALLBACK_BASE_URL).toString();
  } catch (_) {
    return raw;
  }
}

function updateBaseFromUrl(url) {
  try {
    var parsed = new URL(url);
    if (parsed && parsed.origin && parsed.hostname.indexOf("pencurimovie") !== -1) {
      cachedBaseUrl = trimSlash(parsed.origin);
    }
  } catch (_) {}
}

function getBaseUrl() {
  if (cachedBaseUrl) return Promise.resolve(cachedBaseUrl);

  /*
   * Fast path: use the currently verified live domain immediately.
   * Do not make every provider run depend on GitHub Website.json.
   */
  cachedBaseUrl = FALLBACK_BASE_URL;
  return Promise.resolve(cachedBaseUrl);
}

function refreshBaseUrl() {
  if (cachedBaseUrlPromise) return cachedBaseUrlPromise;

  cachedBaseUrlPromise = requestJson(DOMAIN_CONFIG_URL, {}, 900)
    .then(function(data) {
      var values = data && data.pencurimovie;
      var first = Array.isArray(values) ? values[0] : values;
      var resolved = trimSlash(first);
      if (!resolved || resolved.indexOf("http") !== 0) {
        throw new Error("PencuriMovie domain config is empty");
      }
      cachedBaseUrl = resolved;
      return cachedBaseUrl;
    })
    .catch(function() {
      return cachedBaseUrl || FALLBACK_BASE_URL;
    })
    .then(function(value) {
      cachedBaseUrlPromise = null;
      return value;
    });

  return cachedBaseUrlPromise;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, function(_, num) {
      var code = Number(num);
      return isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttr(tag, name) {
  var pattern = new RegExp(
    "\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
    "i"
  );
  var match = String(tag || "").match(pattern);
  if (match) return decodeHtml(match[2]);

  pattern = new RegExp(
    "\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s*=\\s*([^\\s>]+)",
    "i"
  );
  match = String(tag || "").match(pattern);
  return match ? decodeHtml(match[1]) : "";
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]*(?:dub|sub)[^\]]*\]/g, " ")
    .replace(/\b(?:malay\s*dub(?:bed)?|sub\s*indo|indo\s*sub|english\s*sub)\b/g, " ")
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

  var a = left.split(" ").filter(function(word) { return word.length > 1; });
  var b = right.split(" ").filter(function(word) { return word.length > 1; });
  var set = {};
  a.forEach(function(word) { set[word] = true; });

  var matched = b.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  var recall = matched / Math.max(b.length, 1);
  var precision = matched / Math.max(a.length, 1);
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
  var url =
    "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY +
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

function parseSearchResults(html, baseUrl) {
  var results = [];
  var seen = {};

  function addFromBlock(block) {
    var anchorMatch = String(block || "").match(/<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>/i);
    if (!anchorMatch) return;

    var tag = anchorMatch[0];
    var href = safeUrl(getAttr(tag, "href"), baseUrl);
    if (!href || seen[href]) return;

    var title = getAttr(tag, "oldtitle") || getAttr(tag, "title");
    if (title) title = title.split("(")[0].trim();

    if (!title) {
      var h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      title = h2 ? stripTags(h2[1]) : "";
    }

    if (!title) return;

    var rawYear = yearFrom(getAttr(tag, "oldtitle")) || yearFrom(block);
    var isSeries =
      /mli-eps/i.test(block) ||
      /\/series(?:\/|$)/i.test(href) ||
      /tvseason/i.test(block);

    seen[href] = true;
    results.push({
      title: title,
      href: href,
      year: rawYear,
      isSeries: isSeries
    });
  }

  var cardRegex =
    /<div\b[^>]*class\s*=\s*(["'])[^"']*\bml-item\b[^"']*\1[^>]*>([\s\S]*?)(?=<div\b[^>]*class\s*=\s*(["'])[^"']*\bml-item\b[^"']*\3[^>]*>|$)/gi;
  var card;
  while ((card = cardRegex.exec(html))) {
    addFromBlock(card[0]);
  }

  if (!results.length) {
    var anchorRegex = /<a\b[^>]*(?:oldtitle|title)\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(html))) {
      addFromBlock(anchor[0]);
    }
  }

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

  if (info.year && item.year && info.year === item.year) score += 28;
  if (mediaType === "tv" && item.isSeries) score += 24;
  if (mediaType === "movie" && !item.isSeries) score += 18;
  if (mediaType === "tv" && !item.isSeries) score -= 24;

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

function extractPageIdentity(html) {
  var source = String(html || "");
  var title = "";

  var heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) heading = source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (!heading) heading = source.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
  if (heading) title = stripTags(heading[1]);

  if (!title) {
    var og = source.match(
      /<meta\b[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
    );
    if (og) title = decodeHtml(og[3]);
  }

  var original = source.match(/Original\s+title\s*:\s*([^<\r\n]+)/i);

  return {
    title: String(title || "").replace(/\s*[-|]\s*pencuri.*$/i, "").trim(),
    year: yearFrom(original ? stripTags(original[1]) : title)
  };
}

function isDirectPencuriMatch(result, info, mediaType) {
  if (!result || !result.text) return false;

  var body = String(result.text || "");
  var finalUrl = String(result.url || "");
  var lower = finalUrl.toLowerCase();

  if (
    body.length < 300 ||
    /(?:page not found|404 not found|nothing found)/i.test(body)
  ) {
    return false;
  }

  if (mediaType === "tv" && !/\/(?:series|tvshows)\//i.test(lower)) return false;
  if (mediaType === "movie" && /\/(?:series|tvshows)\//i.test(lower)) return false;

  var slug = slugifyTitle(info.title);
  var pathSlug = "";
  try {
    var parts = new URL(finalUrl).pathname.split("/").filter(Boolean);
    pathSlug = parts.length ? parts[parts.length - 1] : "";
  } catch (_) {}

  if (slug && pathSlug.indexOf(slug) === 0) return true;

  var identity = extractPageIdentity(body);
  var score = Math.max(
    titleScore(identity.title, info.title),
    titleScore(identity.title, info.originalTitle)
  );

  if (score < 52) return false;
  if (info.year && identity.year && String(info.year) !== String(identity.year)) {
    return false;
  }

  return true;
}

function buildPencuriDirectCandidates(baseUrl, info, mediaType) {
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
        ? ["/" + slug + "-" + info.year + "/", "/" + slug + "/"]
        : ["/" + slug + "/"];
    } else {
      paths = info.year
        ? [
            "/series/" + slug + "-" + info.year + "/",
            "/tvshows/" + slug + "-" + info.year + "/",
            "/series/" + slug + "/",
            "/tvshows/" + slug + "/"
          ]
        : [
            "/series/" + slug + "/",
            "/tvshows/" + slug + "/"
          ];
    }

    paths.forEach(function(path) {
      var url = trimSlash(cachedBaseUrl || baseUrl) + path;
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });
  });

  return output;
}

function tryDirectPencuriPage(baseUrl, info, mediaType) {
  var candidates = buildPencuriDirectCandidates(baseUrl, info, mediaType);
  if (!candidates.length) return Promise.resolve(null);

  function tryIndex(index) {
    if (index >= candidates.length) return Promise.resolve(null);

    var url = candidates[index];
    var timeoutMs = index === 0 ? 1400 : 700;

    return requestText(
      url,
      { "Referer": trimSlash(cachedBaseUrl || baseUrl) + "/" },
      timeoutMs
    ).then(function(result) {
      updateBaseFromUrl(result.url || url);

      if (!isDirectPencuriMatch(result, info, mediaType)) {
        return tryIndex(index + 1);
      }

      console.log(
        "[PencuriMovie] direct permalink hit " + (result.url || url)
      );

      return {
        title: info.title,
        href: result.url || url,
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

function searchSite(baseUrl, query) {
  function run(domain) {
    var url = trimSlash(domain) + "/?s=" + encodeURIComponent(query);
    return requestText(url, { "Referer": trimSlash(domain) + "/" }, 1800)
      .then(function(result) {
        updateBaseFromUrl(result.url);
        return parseSearchResults(result.text, result.url);
      });
  }

  return run(baseUrl).catch(function(firstError) {
    return refreshBaseUrl().then(function(refreshed) {
      if (!refreshed || trimSlash(refreshed) === trimSlash(baseUrl)) {
        throw firstError;
      }
      console.log("[PencuriMovie] Retrying with refreshed domain " + refreshed);
      return run(refreshed);
    });
  });
}

function browsePencuriLanding(baseUrl, info, mediaType) {
  var domain = trimSlash(cachedBaseUrl || baseUrl);
  var paths = mediaType === "tv" ? ["/tvshows/", "/series/", "/"] : ["/movies/", "/"];

  function run(index) {
    if (index >= paths.length) return Promise.resolve(null);
    var url = domain + paths[index];
    return requestText(url, { "Referer": domain + "/" }, 1500).then(function(result) {
      updateBaseFromUrl(result.url || url);
      var items = parseSearchResults(result.text, result.url || url);
      items.sort(function(a, b) { return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType); });
      var best = items[0] || null;
      if (best && scoreCandidate(best, info, mediaType) >= 45) {
        vueoTrace("LANDING_MATCH", { title: best.title || "", score: scoreCandidate(best, info, mediaType) });
        return best;
      }
      return run(index + 1);
    }).catch(function() { return run(index + 1); });
  }

  return run(0);
}

function findBestTitle(baseUrl, info, mediaType) {
  return tryDirectPencuriPage(baseUrl, info, mediaType).then(function(direct) {
    if (direct) return direct;

    console.log("[PencuriMovie] direct permalink miss, using site search");
    var queries = info && Array.isArray(info.aliases) && info.aliases.length
      ? info.aliases.slice(0, 5)
      : [info.title, info.originalTitle];

    function run(index) {
      if (index >= queries.length) return Promise.resolve(null);
      var query = String(queries[index] || "").trim();
      if (!query) return run(index + 1);
      return searchSite(cachedBaseUrl || baseUrl, query).then(function(items) {
        items.sort(function(a, b) { return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType); });
        var best = items[0] || null;
        if (best && scoreCandidate(best, info, mediaType) >= 45) return best;
        return run(index + 1);
      }).catch(function() { return run(index + 1); });
    }

    return run(0).then(function(best) {
      return best || browsePencuriLanding(cachedBaseUrl || baseUrl, info, mediaType);
    });
  }).then(function(best) {
    if (!best) throw new Error("No PencuriMovie title match");
    if (!best.__detailHtml && scoreCandidate(best, info, mediaType) < 40) {
      throw new Error("PencuriMovie match confidence too low");
    }
    return best;
  });
}

function parseEpisodeTarget(html, pageUrl, requestedSeason, requestedEpisode) {
  var seasonNumber = Number(requestedSeason || 1);
  var episodeNumber = Number(requestedEpisode || 1);
  var matches = [];

  var seasonRegex =
    /<div\b[^>]*class\s*=\s*(["'])[^"']*\btvseason\b[^"']*\1[^>]*>([\s\S]*?)(?=<div\b[^>]*class\s*=\s*(["'])[^"']*\btvseason\b[^"']*\3[^>]*>|$)/gi;

  var seasonBlock;
  while ((seasonBlock = seasonRegex.exec(html))) {
    var block = seasonBlock[0];
    var strong = block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    var blockSeason = strong ? Number((stripTags(strong[1]).match(/season\s*(\d+)/i) || [])[1]) : null;

    var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(block))) {
      var tagAndText = anchor[0];
      var tag = (tagAndText.match(/<a\b[^>]*>/i) || [])[0] || "";
      var text = stripTags(tagAndText);
      var epMatch = text.match(/episode\s*(\d+)/i);
      if (!epMatch) continue;

      var href = safeUrl(getAttr(tag, "href"), pageUrl);
      if (!href) continue;

      matches.push({
        season: blockSeason || 1,
        episode: Number(epMatch[1]),
        href: href,
        name: text.replace(/^.*?episode\s*\d+\s*[-:]?\s*/i, "").trim()
      });
    }
  }

  if (!matches.length) {
    var allAnchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var any;
    while ((any = allAnchorRegex.exec(html))) {
      var item = any[0];
      var itemTag = (item.match(/<a\b[^>]*>/i) || [])[0] || "";
      var itemText = stripTags(item);
      var itemEp = itemText.match(/episode\s*(\d+)/i);
      if (!itemEp) continue;
      var itemHref = safeUrl(getAttr(itemTag, "href"), pageUrl);
      if (!itemHref) continue;
      matches.push({
        season: 1,
        episode: Number(itemEp[1]),
        href: itemHref,
        name: ""
      });
    }
  }

  var exact = matches.find(function(item) {
    return item.season === seasonNumber && item.episode === episodeNumber;
  });

  if (!exact && seasonNumber === 1) {
    exact = matches.find(function(item) {
      return item.episode === episodeNumber;
    });
  }

  if (!exact) {
    throw new Error(
      "PencuriMovie episode S" + seasonNumber + "E" + episodeNumber + " not found"
    );
  }

  return exact;
}


function unescapeScriptText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(url || ""));
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
    label || "PencuriMovie extractor request"
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
  }, timeoutMs || 2200, "PencuriMovie POST " + url);
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

  var absoluteRegex = /https?:\/\/[^"'<>\\\s]+?\.(?:m3u8|mp4)(?:\?[^"'<>\\\s]*)?/gi;
  var absolute;
  while ((absolute = absoluteRegex.exec(source))) add(absolute[0], "");

  var keyedRegex =
    /(?:file|src|source|url)\s*[:=]\s*(["'])([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)\1/gi;
  var keyed;
  while ((keyed = keyedRegex.exec(source))) add(keyed[2], keyed[0]);

  var sourceTagRegex = /<source\b[^>]*>/gi;
  var sourceTag;
  while ((sourceTag = sourceTagRegex.exec(source))) {
    add(getAttr(sourceTag[0], "src"), sourceTag[0]);
  }

  return found;
}

function extractJwPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = extractDirectMedia(source, baseUrl);
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
 * selector closely enough for the PencuriMovie server tabs.
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
  }, 1400, "PencuriMovie redirect " + absolute).then(function(result) {
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
  "ds2play.com", "ds2video.com", "vide0.net", "myvidplay.com", "playmogo.com"
];
var MIXDROP_DOMAINS = [
  "mixdrop.co", "mixdrop.bz", "mixdrop.ch", "mixdrop.to",
  "mixdrop.si", "mixdrop.ps", "mixdrop.ag"
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

function extractGenericHost(url, referer, depth) {
  return requestRaw(url, {
    headers: referer ? { "Referer": referer } : {},
    redirect: "follow"
  }, 2300, "Generic extractor " + url).then(function(result) {
    var resolved = resolvedFromText(
      result.text,
      result.url || url,
      referer ? { "Referer": referer } : {}
    );

    if (resolved.streams.length || Number(depth || 0) >= 1) return resolved;

    var nested = extractIframes(result.text, result.url || url).slice(0, 2);
    if (!nested.length) return resolved;

    return Promise.all(nested.map(function(child) {
      return loadExtractorEquivalent(child, result.url || url, Number(depth || 0) + 1)
        .catch(function() { return emptyResolved(); });
    })).then(function(children) {
      children.forEach(function(child) { mergeResolved(resolved, child); });
      return resolved;
    });
  });
}


function firstNonEmptyResolved(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve(emptyResolved());
  }

  return new Promise(function(resolve) {
    var pending = tasks.length;
    var settled = false;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value || emptyResolved());
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          var count =
            value && Array.isArray(value.streams)
              ? value.streams.length
              : 0;

          if (count > 0) {
            finish(value);
            return;
          }

          pending -= 1;
          if (pending <= 0) finish(emptyResolved());
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish(emptyResolved());
        });
    });

    setTimeout(function() {
      finish(emptyResolved());
    }, timeoutMs);
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
  console.log("[PencuriMovie] extractor=" + name + " host=" + hostOf(url));

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
  else if (name === "BrowserPlayer") work = resolveWithNativeWebView(url, referer, "BrowserPlayer");
  else work = extractGenericHost(url, referer, depth || 0);

  return Promise.resolve(work).then(function(resolved) {
    var streams = resolved && Array.isArray(resolved.streams) ? resolved.streams.length : 0;
    console.log("[PencuriMovie] " + name + " streams=" + streams);

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
  if (directName === "BrowserPlayer") {
    console.log("[PencuriMovie] native direct host=" + hostOf(absolute));
    return resolveWithNativeWebView(
      absolute,
      referer || absolute,
      "BrowserPlayer"
    );
  }

  return followRedirectCloudstream(absolute, referer).then(function(finalUrl) {
    finalUrl = finalUrl || absolute;
    console.log(
      "[PencuriMovie] iframe=" + hostOf(absolute) +
      (finalUrl !== absolute ? " redirect=" + hostOf(finalUrl) : "")
    );
    return dispatchExtractor(finalUrl, referer || absolute, depth || 0);
  });
}

function hostPriorityForPencuri(url) {
  var host = hostOf(url).toLowerCase();
  if (/playmogo|dood|streamtape|voe|vidhide|filemoon/.test(host)) return 0;
  if (/hgcloud|hubcloud/.test(host)) return 1;
  if (/abyss|browser|embed/.test(host)) return 9;
  return 4;
}

function resolvePencuriFramesFast(frames, pageUrl) {
  var ordered = (frames || []).slice().sort(function(a, b) {
    return hostPriorityForPencuri(a) - hostPriorityForPencuri(b);
  });
  var nativeFirst = ordered.filter(function(frame) {
    return extractorNameFor(frame) !== "BrowserPlayer";
  }).slice(0, 4);
  var browserFallback = ordered.filter(function(frame) {
    return extractorNameFor(frame) === "BrowserPlayer";
  }).slice(0, 1);

  if (nativeFirst.length) {
    return firstNonEmptyResolved(
      nativeFirst.map(function(frame) {
        return loadExtractorEquivalent(frame, pageUrl, 0).catch(function() { return emptyResolved(); });
      }),
      6200
    ).then(function(result) {
      if (result && result.streams && result.streams.length) {
        vueoTrace("EXTRACT_FAST", { host: hostOf(result.streams[0].url), streams: result.streams.length });
        return result;
      }
      if (!browserFallback.length) return result || emptyResolved();
      return firstNonEmptyResolved(
        browserFallback.map(function(frame) {
          return loadExtractorEquivalent(frame, pageUrl, 0).catch(function() { return emptyResolved(); });
        }),
        6000
      );
    });
  }

  return firstNonEmptyResolved(
    browserFallback.map(function(frame) {
      return loadExtractorEquivalent(frame, pageUrl, 0).catch(function() { return emptyResolved(); });
    }),
    6000
  );
}

function resolveMovieplayFrames(html, pageUrl) {
  var direct = extractJwPlayerMedia(html, pageUrl);
  var resolved = {
    streams: direct.map(function(item) {
      return {
        url: item.url,
        quality: item.quality,
        referer: pageUrl,
        headers: { "Referer": pageUrl }
      };
    }),
    subtitles: extractSubtitles(html, pageUrl)
  };

  if (resolved.streams.length) return Promise.resolve(resolved);

  var frames = extractMovieplayIframes(html, pageUrl);
  if (!frames.length) {
    throw new Error("PencuriMovie movieplay iframe not found");
  }

  console.log("[PencuriMovie] movieplay iframes=" + frames.length);

  /*
   * Cloudstream calls loadExtractor for every iframe in div.movieplay.
   * Run them in parallel so multiple servers do not multiply total latency.
   */
  return resolvePencuriFramesFast(frames, pageUrl).then(function(child) {
    mergeResolved(resolved, child);
    return resolved;
  });
}

function resolvePlaybackPage(pageUrl) {
  return requestText(pageUrl, {}, 1800).then(function(result) {
    updateBaseFromUrl(result.url);
    return resolveMovieplayFrames(result.text, result.url || pageUrl);
  });
}

function buildStreams(resolved, info, mediaType, season, episode) {
  var subtitles = resolved && Array.isArray(resolved.subtitles) ? resolved.subtitles : [];
  var sources = resolved && Array.isArray(resolved.streams) ? resolved.streams : [];
  var seen = {};

  var episodeLabel =
    mediaType === "tv"
      ? " S" + String(season || 1).padStart(2, "0") +
        "E" + String(episode || 1).padStart(2, "0")
      : "";

  return sources.map(function(source, index) {
    if (!source || !source.url || seen[source.url]) return null;
    seen[source.url] = true;

    var referer = source.referer || cachedBaseUrl || FALLBACK_BASE_URL;

    return {
      name:
        PROVIDER_NAME +
        (sources.length > 1 ? " Server " + (index + 1) : ""),
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

  console.log(
    "[PencuriMovie] Request tmdbId=" + tmdbId +
    " type=" + type +
    (type === "tv" ? " S" + requestedSeason + "E" + requestedEpisode : "")
  );

  var info;
  var baseUrl;

  var work = Promise.all([
    getTmdbInfo(tmdbId, type),
    getBaseUrl()
  ])
    .then(function(values) {
      info = values[0];
      baseUrl = values[1];

      if (!info || !info.title) throw new Error("TMDB title is empty");

      return findBestTitle(baseUrl, info, type);
    })
    .then(function(match) {
      var detailPromise = match.__detailHtml
        ? Promise.resolve({
            text: match.__detailHtml,
            url: match.href
          })
        : requestText(
            match.href,
            { "Referer": trimSlash(cachedBaseUrl || baseUrl) + "/" },
            1400
          );

      return detailPromise.then(function(detail) {
        updateBaseFromUrl(detail.url || match.href);

        if (type === "movie") {
          return {
            targetUrl: detail.url || match.href,
            detailHtml: detail.text
          };
        }

        var selected = parseEpisodeTarget(
          detail.text,
          detail.url || match.href,
          requestedSeason,
          requestedEpisode
        );

        return {
          targetUrl: selected.href,
          detailHtml: null
        };
      });
    })
    .then(function(target) {
      if (target.detailHtml && type === "movie") {
        return resolveMovieplayFrames(target.detailHtml, target.targetUrl);
      }

      return resolvePlaybackPage(target.targetUrl);
    })
    .then(function(resolved) {
      var streams = buildStreams(
        resolved,
        info,
        type,
        type === "tv" ? requestedSeason : null,
        type === "tv" ? requestedEpisode : null
      );

      console.log("[PencuriMovie] Direct streams found=" + streams.length);
      return streams;
    });

  return withSoftTimeout(work, 16800, "PencuriMovie provider")
    .catch(function(error) {
      console.error(
        "[PencuriMovie] " +
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
const PROVIDER = "PencuriMovie";
const VERSION = "1.0.8";
const BASE = "https://ww44.pencurimovie.baby";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const PLAYMATE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0";

function getCheerio() {
  return require("cheerio-without-node-native");
}

function fetchResponse(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
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
    .replace(/\\\//g, "/")
    .replace(/^['\"]|['\"]$/g, "");

  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return "https:" + raw;

  var root = originOf(base);
  if (raw.charAt(0) === "/") return root + raw;

  var cleanBase = String(base || "").split("#")[0].split("?")[0];
  cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf("/") + 1);
  return cleanBase + raw;
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function stripYear(value) {
  return String(value || "")
    .replace(/\s*\(((?:19|20)\d{2})\)\s*$/i, "")
    .trim();
}

function yearFromText(value) {
  var m = String(value || "").match(/(?:\(|\b)((?:19|20)\d{2})(?:\)|\b)/);
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

function parsePageIdentity(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(String(html || ""));
  var rawTitle = String(
    $("div.mvic-desc h3").first().text() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    ""
  ).replace(/\s+/g, " ").trim();

  rawTitle = rawTitle
    .replace(/\s*[-|]\s*Pencuri\s*Movie.*$/i, "")
    .trim();

  var year = yearFromText(rawTitle);
  if (!year) {
    $("div.mvic-info p").each(function (_, el) {
      if (year) return;
      var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
      if (/Release\s*:/i.test(text)) year = yearFromText(text);
    });
  }

  return {
    title: stripYear(rawTitle),
    rawTitle: rawTitle,
    year: year
  };
}

function validatePage(html, details, mediaType) {
  var identity = parsePageIdentity(html);
  if (!identity.title) return null;

  var accepted = acceptedTitleSet(details);
  if (!accepted[normalizeTitle(identity.title)]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(identity.year || 0);
  if (mediaType === "movie" && targetYear && itemYear && Math.abs(targetYear - itemYear) > 1) {
    return null;
  }

  return identity;
}

function tryDirectPage(details, mediaType) {
  var slug = slugifyTitle(details.title || details.originalTitle || "");
  var year = String(details.year || "").trim();
  if (!slug) return Promise.resolve(null);

  var paths = mediaType === "movie"
    ? ["/" + slug + (year ? "-" + year : "") + "/"]
    : [
        "/series/" + slug + (year ? "-" + year : "") + "/",
        "/series/" + slug + "/",
        "/" + slug + (year ? "-" + year : "") + "/"
      ];

  var index = 0;
  function next() {
    if (index >= paths.length) return Promise.resolve(null);
    var url = BASE + paths[index++];
    return fetchText(url, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": BASE + "/",
        "User-Agent": USER_AGENT
      }
    }).then(function (html) {
      var identity = validatePage(html, details, mediaType);
      if (!identity) return next();
      console.log("[PencuriMovie] fast title='" + identity.rawTitle + "' url=" + url);
      return {
        title: identity.title,
        rawTitle: identity.rawTitle,
        year: identity.year,
        url: url,
        mediaType: mediaType,
        html: html
      };
    }).catch(function () {
      return next();
    });
  }

  return next();
}

function parseSearchResults(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var results = [];

  $("div.ml-item").each(function (_, element) {
    var box = $(element);
    var a = box.find("a[href]").first();
    var href = absoluteUrl(pageUrl, a.attr("href"));
    if (!href || href.indexOf("pencurimovie") === -1) return;

    var rawTitle = String(
      a.attr("oldtitle") ||
      a.attr("title") ||
      box.find("h2").first().text() ||
      ""
    ).replace(/\s+/g, " ").trim();
    if (!rawTitle) return;

    var eps = box.find("span.mli-eps").length > 0;
    var isTv = eps || /\/series\//i.test(href);

    results.push({
      title: stripYear(rawTitle),
      rawTitle: rawTitle,
      year: yearFromText(rawTitle),
      url: href,
      mediaType: isTv ? "tv" : "movie"
    });
  });

  return results;
}

function scoreCandidate(item, details, mediaType) {
  if (!item || item.mediaType !== mediaType) return null;
  var accepted = acceptedTitleSet(details);
  var title = normalizeTitle(item.title);
  if (!accepted[title]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(item.year || 0);
  if (mediaType === "movie" && targetYear && itemYear && Math.abs(targetYear - itemYear) > 1) {
    return null;
  }

  var score = 100;
  if (title === normalizeTitle(details.title)) score += 40;
  if (targetYear && itemYear && targetYear === itemYear) score += 30;
  return score;
}

function searchSite(query) {
  var url = BASE + "/?s=" + encodeURIComponent(query);
  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": BASE + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    return parseSearchResults(html, url);
  });
}

function findBestTitle(details, mediaType) {
  var queries = [];
  function add(v) {
    v = String(v || "").trim();
    if (v && queries.indexOf(v) === -1) queries.push(v);
  }
  add(details.title);
  add(details.originalTitle);
  (details.alternativeTitles || []).slice(0, 2).forEach(add);

  var index = 0;
  function next() {
    if (index >= queries.length) return Promise.resolve(null);
    var query = queries[index++];
    return searchSite(query).then(function (items) {
      var ranked = items.map(function (item) {
        return { item: item, score: scoreCandidate(item, details, mediaType) };
      }).filter(function (x) {
        return typeof x.score === "number";
      }).sort(function (a, b) {
        return b.score - a.score;
      });

      if (ranked.length) {
        console.log("[PencuriMovie] matched title='" + ranked[0].item.rawTitle + "' url=" + ranked[0].item.url);
        return ranked[0].item;
      }
      return next();
    }).catch(function () {
      return next();
    });
  }

  return next();
}

function findTitle(details, mediaType) {
  return tryDirectPage(details, mediaType).then(function (item) {
    if (item) return item;
    return findBestTitle(details, mediaType);
  });
}

function findEpisodeUrl(html, pageUrl, season, episode) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var wantedSeason = Number(season || 1);
  var wantedEpisode = Number(episode || 1);
  var found = "";

  $("div.tvseason").each(function (_, seasonEl) {
    if (found) return;
    var box = $(seasonEl);
    var seasonText = String(box.find("strong").first().text() || "");
    var sm = seasonText.match(/Season\s*(\d+)/i);
    var currentSeason = sm ? Number(sm[1]) : 1;
    if (currentSeason !== wantedSeason) return;

    box.find("div.les-content a[href]").each(function (_, aEl) {
      if (found) return;
      var a = $(aEl);
      var text = String(a.text() || "").replace(/\s+/g, " ").trim();
      var em = text.match(/Episode\s*(\d+)/i);
      if (!em) em = String(a.attr("href") || "").match(/(?:episode|ep)[-_\/]?(\d+)/i);
      var currentEpisode = em ? Number(em[1]) : null;
      if (currentEpisode === wantedEpisode) {
        found = absoluteUrl(pageUrl, a.attr("href"));
      }
    });
  });

  return found;
}

function loadPlaybackPage(item, mediaType, season, episode) {
  var rootPromise = item && item.html
    ? Promise.resolve(item.html)
    : fetchText(item.url, {
        headers: {
          "Accept": "text/html,*/*",
          "Referer": BASE + "/",
          "User-Agent": USER_AGENT
        }
      });

  return rootPromise.then(function (html) {
    if (mediaType === "movie") {
      return { url: item.url, html: html };
    }

    var episodeUrl = findEpisodeUrl(html, item.url, season, episode);
    if (!episodeUrl) {
      console.log("[PencuriMovie] episode not found S" + season + "E" + episode);
      return null;
    }

    console.log("[PencuriMovie] episode url=" + episodeUrl);
    return fetchText(episodeUrl, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": item.url,
        "User-Agent": USER_AGENT
      }
    }).then(function (episodeHtml) {
      return { url: episodeUrl, html: episodeHtml };
    });
  });
}

function cleanCandidateUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&");
}

function isBlockedFrame(url) {
  var lower = String(url || "").toLowerCase();
  return !/^https?:\/\//i.test(url) ||
    /youtube\.com|youtu\.be|google\.com\/recaptcha|doubleclick|googlesyndication|facebook\.com|instagram\.com|t\.me\//i.test(lower) ||
    /\.(?:jpg|jpeg|png|gif|webp|svg|css|js|woff2?|ttf|ico)(?:[?#]|$)/i.test(lower);
}

function extractUrlsFromScripts(html) {
  var clean = String(html || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  var out = {};
  var patterns = [
    /(?:src|file|url|embed|video|player|data-src|data-video|data-url)["']?\s*[:=]\s*["'](https?:[^"'\s<]+)["']/ig,
    /(https?:\/\/[^\s"'<>\\]+)/ig
  ];
  patterns.forEach(function (regex) {
    var m;
    while ((m = regex.exec(clean))) {
      var candidate = m[1] || m[0];
      if (candidate) out[candidate] = true;
      if (Object.keys(out).length >= 40) break;
    }
  });
  return Object.keys(out);
}

function collectEmbedUrls(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw, label) {
    var cleaned = cleanCandidateUrl(raw);
    var url = absoluteUrl(pageUrl, cleaned);
    if (!url || url === pageUrl || isBlockedFrame(url)) return;
    if (originOf(url) === originOf(pageUrl) && url.split("#")[0] === pageUrl.split("#")[0]) return;
    if (!found[url]) found[url] = label || "Server";
  }

  // Read tab targets first so website server numbers survive generic discovery.
  $(".player_nav .idTabs a[href]").each(function (_, el) {
    var tab = $(el);
    var target = String(tab.attr("href") || "");
    if (!/^#[A-Za-z0-9_-]+$/.test(target)) return;
    var label = tab.closest("li").find(".les-title strong").first().text() || tab.text() || "Server";
    $(target).find("iframe, [data-src], [data-video], [data-url], [data-embed], [data-link]").each(function (_, frame) {
      var node = $(frame);
      ["data-src", "src", "data-video", "data-url", "data-embed", "data-link"].forEach(function (attr) {
        add(node.attr(attr), String(label).replace(/\s+/g, " ").trim());
      });
    });
  });

  var selectors = [
    "div.movieplay iframe",
    "div.movieplay [data-src]",
    "div.movieplay [data-video]",
    "div.movieplay [data-url]",
    "div.movieplay [data-embed]",
    "div.movieplay [data-link]",
    "div#movieplay iframe",
    "div#movieplay [data-src]",
    "div#movieplay [data-video]",
    "div#movieplay [data-url]",
    "div#player iframe",
    "div#player [data-src]",
    "div#player [data-video]",
    "div#player [data-url]",
    "div.player iframe",
    "div.player [data-src]",
    "div.player [data-video]",
    "div.player [data-url]",
    "div.playbox iframe",
    "div.playbox [data-src]",
    "[id*=server] iframe",
    "[id*=server] [data-src]",
    "[id*=server] [data-video]",
    "[id*=server] [data-url]",
    "[class*=server] iframe",
    "[class*=server] [data-src]",
    "[class*=server] [data-video]",
    "[class*=server] [data-url]"
  ].join(", ");

  $(selectors).each(function (_, el) {
    var node = $(el);
    var label = String(
      node.attr("title") ||
      node.attr("data-name") ||
      node.closest("li,div").find("span,strong").first().text() ||
      "Server"
    ).replace(/\s+/g, " ").trim();

    [
      node.attr("data-src"),
      node.attr("src"),
      node.attr("data-video"),
      node.attr("data-url"),
      node.attr("data-embed"),
      node.attr("data-link"),
      node.attr("data-player"),
      node.attr("href")
    ].forEach(function (v) { add(v, label); });
  });

  if (!Object.keys(found).length) {
    $("iframe, [data-src], [data-video], [data-url], [data-embed], [data-link], [data-player]").each(function (_, el) {
      var node = $(el);
      [
        node.attr("data-src"), node.attr("src"), node.attr("data-video"),
        node.attr("data-url"), node.attr("data-embed"), node.attr("data-link"),
        node.attr("data-player")
      ].forEach(function (v) { add(v, "Server"); });
    });
  }

  if (!Object.keys(found).length) {
    extractUrlsFromScripts(html).forEach(function (url) { add(url, "Script"); });
  }

  return Object.keys(found).map(function (url) {
    return { url: url, label: found[url] };
  });
}

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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

function mediaUrlsFromText(text, baseUrl) {
  var input = decodeHtmlEntities(String(text || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  var found = {};

  function add(raw) {
    raw = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/["'\\]+$/g, "");
    var url = absoluteUrl(baseUrl, raw);
    if (url && isLikelyStreamUrl(url)) found[url] = true;
  }

  (input.match(/https?:\/\/[^\s"'<>\\]+/ig) || []).forEach(add);
  (input.match(/\/\/[a-z0-9.-]+\/[^\s"'<>\\]+/ig) || []).forEach(add);
  return Object.keys(found);
}

function unpackPacker(source) {
  var text = String(source || "");
  if (text.indexOf("eval(function(p,a,c,k,e,d)") === -1) return text;
  var re = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/;
  var match = re.exec(text);
  if (!match) return text;

  var payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
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
    payload = payload.replace(new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), symtab[i]);
  }
  return payload;
}

function resolvePlaymate(url) {
  if (!/playmate\.to/i.test(url)) return Promise.resolve([]);
  var clean = String(url).split("#")[0].split("?")[0].replace(/\/+$/, "");
  var id = clean.substring(clean.lastIndexOf("/") + 1);
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
    return [{
      url: streamUrl,
      label: "Playmate",
      noReferer: true,
      headers: { "Accept": "*/*", "User-Agent": PLAYMATE_USER_AGENT }
    }];
  }).catch(function () { return []; });
}

function randomToken(length) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var out = "";
  for (var i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function resolveDood(url, referer) {
  if (!/(?:dood|dsvplay|ds2play|vide0\.net|myvidplay)/i.test(url)) return Promise.resolve([]);
  var embedUrl = String(url).replace("/d/", "/e/");

  return fetchResponse(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(embedUrl) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var finalEmbedUrl = response.url || embedUrl;
    var host = originOf(finalEmbedUrl);
    var passMatch = response.text.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!passMatch) return [];
    var passUrl = /^https?:\/\//i.test(passMatch[0]) ? passMatch[0] : host + passMatch[0];
    var token = passUrl.substring(passUrl.lastIndexOf("/") + 1);
    if (!token) return [];

    return fetchText(passUrl, {
      headers: { "Accept": "*/*", "Referer": finalEmbedUrl, "User-Agent": USER_AGENT }
    }).then(function (prefix) {
      var base = String(prefix || "").trim();
      if (!/^https?:\/\//i.test(base)) return [];
      var finalUrl = base + randomToken(10) + "?token=" + encodeURIComponent(token);
      return [{
        url: finalUrl,
        referer: host + "/",
        label: "Dood",
        headers: { "Accept": "*/*", "Referer": host + "/", "User-Agent": USER_AGENT }
      }];
    });
  }).catch(function () { return []; });
}

function resolveMixDrop(url, referer) {
  if (!/(?:mixdrop|mxdrop|mdy48tn97)/i.test(url)) return Promise.resolve([]);
  var embedUrl = String(url).replace("/f/", "/e/");
  return fetchText(embedUrl, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || embedUrl, "User-Agent": USER_AGENT }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var match = unpacked.match(/wurl.*?=.*?["']([^"']+)["'];?/i);
    if (!match) return [];
    var streamUrl = String(match[1] || "");
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];
    return [{ url: streamUrl, referer: embedUrl, label: "MixDrop" }];
  }).catch(function () { return []; });
}

function isHgCloud(url) {
  return /^(?:www\.)?(?:hgcloud\.to|hglink\.to|dhcplay\.com|gradehgplus\.com|hanerix\.com|audinifer\.com|vibuxer\.com)$/i.test(hostOf(url));
}

function packedPlayerStreams(response, label) {
  var unpacked = unpackPacker(response.text);
  var candidates = {};
  var re = /["']?(?:hls[234]|file)["']?\s*:\s*["']([^"']+)["']/gi;
  var match;
  while ((match = re.exec(unpacked))) {
    var value = decodeHtmlEntities(match[1]).replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=");
    var url = absoluteUrl(response.url, value);
    // HGCloud hls3 may be an obfuscated master.txt; use native playlists only.
    if (/^https?:\/\//i.test(url) && /\.m3u8$/i.test(url.split(/[?#]/)[0])) candidates[url] = true;
  }
  if (!Object.keys(candidates).length) mediaUrlsFromText(unpacked, response.url).forEach(function (url) { candidates[url] = true; });
  return Object.keys(candidates).map(function (url) {
    return { url: url, referer: response.url, label: label };
  });
}

function resolveStreamWish(url, referer) {
  var hg = isHgCloud(url);
  if (!hg && !/(?:streamwish|wish|filelions|filelion|rapidplayers|dwish|embedwish|flaswish|cdnwish|hlswish|vidhide|vidhidepro|filemoon)/i.test(url)) return Promise.resolve([]);
  function load(target) {
    return fetchResponse(target, {
      headers: { "Accept": "text/html,*/*", "Referer": referer || url, "User-Agent": USER_AGENT }
    }).then(function (response) { return packedPlayerStreams(response, hg ? "HGCloud" : "StreamHost"); }).catch(function () { return []; });
  }
  return load(url).then(function (streams) {
    if (streams.length || !hg || !/^(hgcloud\.to|hglink\.to|dhcplay\.com|gradehgplus\.com)$/i.test(hostOf(url))) return streams;
    var match = String(url).match(/^https?:\/\/[^/]+\/(?:e\/|f\/)?([A-Za-z0-9_-]+)\/?(\?[^#]*)?(?:#.*)?$/);
    if (!match) return [];
    // Native mirrors from the working Cloudstream HGCloud extractor; preserve video ID/query.
    var hosts = ["hanerix.com", "audinifer.com", "vibuxer.com"];
    function next(index) {
      if (index >= hosts.length) return Promise.resolve([]);
      return load("https://" + hosts[index] + "/e/" + match[1] + (match[2] || "")).then(function (found) {
        return found.length ? found : next(index + 1);
      });
    }
    return next(0);
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
    output += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64 && e3 >= 0) output += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== 64 && e4 >= 0 && e3 >= 0) output += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return output;
}

function binaryToUtf8(binary) {
  try {
    var encoded = "";
    for (var i = 0; i < binary.length; i++) encoded += "%" + ("0" + binary.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(encoded);
  } catch (_) {
    return binary;
  }
}

function decryptVoe(encoded) {
  try {
    var step1 = rot13(encoded);
    ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(function (pattern) {
      step1 = step1.split(pattern).join("_");
    });
    var step2 = step1.replace(/_/g, "");
    var step3 = base64DecodeBinary(step2);
    var step4 = "";
    for (var i = 0; i < step3.length; i++) step4 += String.fromCharCode(step3.charCodeAt(i) - 3);
    var step5 = step4.split("").reverse().join("");
    return JSON.parse(binaryToUtf8(base64DecodeBinary(step5)));
  } catch (_) {
    return null;
  }
}

function voeJsonPayloads(html) {
  // Read raw script bodies: Android's HTML selector bridge may normalize script text.
  var found = [];
  var scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  var match;
  while ((match = scripts.exec(String(html || "")))) {
    if (/\btype\s*=\s*(?:["']application\/json["']|application\/json)(?:\s|$)/i.test(match[1])) found.push(match[2].trim());
  }
  return found;
}

function voeMediaUrl(value, base) {
  // Accept decoder-owned source fields even when the current engine omits .m3u8/.mp4.
  // Do not scrape arbitrary page URLs: Voe embeds a dummy test video on the same page.
  var raw = String(value || "").trim(); // JSON.parse already decoded escapes; signed fields must remain exact.
  if (!raw || /^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  var url = /^https?:\/\//i.test(raw) ? raw : absoluteUrl(base, raw);
  return /^https?:\/\//i.test(url) ? url : "";
}

function resolveVoe(url, referer) {
  if (!/(?:voe\.|tubeless|simpulum|urochs|nathanfromsubject|yip\.su|metagnath|donaldlineelse|charlestoughrace|jeremyparticipantanything)/i.test(hostOf(url))) return Promise.resolve([]);
  function load(target, depth) {
    return fetchResponse(target, {
      headers: { "Accept": "text/html,*/*", "Referer": referer || url, "User-Agent": USER_AGENT }
    }).then(function (response) {
      var redirect = response.text.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
      if (redirect && depth < 2 && redirect[1] !== response.url) return load(absoluteUrl(response.url, redirect[1]), depth + 1);
      return response;
    });
  }
  return load(url, 0).then(function (response) {
    var out = [];
    var seen = {};
    voeJsonPayloads(response.text).forEach(function (raw) {
      var encoded = raw;
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) encoded = String(parsed[0] || "");
        else if (typeof parsed === "string") encoded = parsed;
        else return;
      } catch (_) { return; }
      var data = decryptVoe(encoded);
      if (!data) return;
      function add(value, label, hls) {
        var media = voeMediaUrl(value, response.url);
        if (!media || seen[media]) return;
        seen[media] = true;
        out.push({ url: media, referer: hls ? "https://voe.sx/" : url, label: label, voe: true,
          mimeType: hls ? "application/x-mpegURL" : null,
          headers: hls ? { "Origin": "https://voe.sx/" } : {} });
      }
      add(data.source, "VOE", true);
      add(data.direct_access_url, "VOE MP4", false);
    });
    console.log("[PencuriMovie] VOE decoded sources=" + out.length);
    return out;
  }).catch(function () { return []; });
}

function collectMediaFromObject(value, baseUrl, out, depth) {
  if (depth > 7 || value == null) return;
  if (typeof value === "string") {
    var clean = decodeHtmlEntities(value).replace(/\\\//g, "/").trim();
    if (/^https?:\/\//i.test(clean) && isLikelyStreamUrl(clean)) out[clean] = true;
    mediaUrlsFromText(clean, baseUrl).forEach(function (url) { out[url] = true; });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(function (x) { collectMediaFromObject(x, baseUrl, out, depth + 1); });
    return;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (typeof child === "string" && /^(?:file|url|src|source|stream|playlist|hls|video)$/i.test(key)) {
        var candidate = decodeHtmlEntities(child).replace(/\\\//g, "/").trim();
        if (/^https?:\/\//i.test(candidate) && isLikelyStreamUrl(candidate)) out[candidate] = true;
      }
      collectMediaFromObject(child, baseUrl, out, depth + 1);
    });
  }
}

function resolveAbyss(url) {
  if (!/(?:abyss\.|playhydrax\.com)/i.test(url)) return Promise.resolve([]);
  return fetchText(url, {
    headers: { "Accept": "text/html,*/*", "Origin": originOf(url), "Referer": originOf(url) + "/", "User-Agent": USER_AGENT }
  }).then(function (html) {
    var match = html.match(/const\s+datas\s*=\s*"([^"]+)"/i) || html.match(/datas\s*[:=]\s*'([^']+)'/i);
    if (!match) return [];
    return fetchJson("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ text: match[1] })
    }).then(function (data) {
      if (!data || Number(data.status) !== 200) return [];
      var found = {};
      collectMediaFromObject(data.result, url, found, 0);
      return Object.keys(found).map(function (streamUrl) {
        return { url: streamUrl, referer: url, label: "Abyss" };
      });
    });
  }).catch(function () { return []; });
}

function resolveStreamTape(url, referer) {
  if (!/(?:streamtape|strtape|stape|shavetape|streamta\.pe)/i.test(url)) return Promise.resolve([]);
  return fetchText(url, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || url, "User-Agent": USER_AGENT }
  }).then(function (html) {
    var clean = String(html || "").replace(/\\\//g, "/");
    var match = clean.match(/id=["']robotlink["'][^>]*>([^<]+)/i) ||
      clean.match(/id=["']norobotlink["'][^>]*>([^<]+)/i) ||
      clean.match(/(?:robotlink|norobotlink).*?innerHTML\s*=\s*['"]([^'"]+)/i);
    if (!match) return [];
    var streamUrl = String(match[1] || "").trim();
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];
    return [{ url: streamUrl, referer: url, label: "StreamTape" }];
  }).catch(function () { return []; });
}

function nestedFramesFromHtml(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};
  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || url === pageUrl || isBlockedFrame(url)) return;
    found[url] = true;
  }
  $("iframe[src], iframe[data-src], [data-video], [data-url], [data-embed], [data-link]").each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src") || node.attr("data-video") || node.attr("data-url") || node.attr("data-embed") || node.attr("data-link"));
  });
  return Object.keys(found).slice(0, 4);
}

function resolveGeneric(url, referer, depth) {
  if (isLikelyStreamUrl(url)) {
    return Promise.resolve([{ url: url, referer: referer || originOf(url) + "/", label: "Direct" }]);
  }
  if (depth > 1) return Promise.resolve([]);

  return fetchResponse(url, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || originOf(url) + "/", "User-Agent": USER_AGENT }
  }).then(function (response) {
    var finalUrl = response.url || url;
    var unpacked = unpackPacker(response.text);
    var direct = mediaUrlsFromText(unpacked, finalUrl).map(function (streamUrl) {
      return { url: streamUrl, referer: finalUrl, label: "Direct" };
    });
    if (direct.length) return direct;

    var frames = nestedFramesFromHtml(response.text, finalUrl);
    if (!frames.length) return [];
    return Promise.all(frames.map(function (frame) {
      return resolveMirror({ url: frame, label: "Nested" }, finalUrl, depth + 1);
    })).then(function (groups) {
      var out = [];
      groups.forEach(function (group) { out = out.concat(group || []); });
      return out;
    });
  }).catch(function () { return []; });
}

function mirrorPriority(mirror) {
  var value = (String(mirror && mirror.label || "") + " " + String(mirror && mirror.url || "")).toLowerCase();
  if (isLikelyStreamUrl(mirror.url)) return 0;
  if (/playmate|playm/.test(value)) return 1;
  if (isHgCloud(mirror.url) || /streamwish|wish|filelion|vidhide|filemoon/.test(value)) return 2;
  if (/voe/.test(value)) return 3;
  if (/mixdrop|mxdrop/.test(value)) return 4;
  if (/dsvplay|dood/.test(value)) return 5;
  if (/streamtape|stape/.test(value)) return 6;
  if (/abyss|playhydrax/.test(value)) return 7;
  return 10;
}

function resolveMirror(mirror, pageUrl, depth) {
  var url = String(mirror && mirror.url || "");
  if (!url) return Promise.resolve([]);
  var host = hostOf(url);

  function finish(streams) {
    return (streams || []).map(function (stream) {
      if (!stream.label || stream.label === "Direct" || stream.label === "Nested") {
        stream.label = mirror.label || stream.label || host || "Server";
      }
      return stream;
    });
  }

  return resolvePlaymate(url)
    .then(function (streams) { return streams.length ? streams : resolveStreamWish(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveVoe(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveMixDrop(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveDood(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveStreamTape(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveAbyss(url); })
    .then(function (streams) { return streams.length ? streams : resolveGeneric(url, pageUrl, depth || 0); })
    .then(function (streams) {
      if (!streams.length) console.log("[PencuriMovie] unresolved host=" + (host || "?") + " url=" + url);
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
    var key = String(stream.choiceId || "") + "|" + url;
    if (!url || seen[key]) return;
    seen[key] = true;

    var quality = stream.hlsVerified ? "Auto" : qualityFromUrl(url);
    var label = String(stream.label || "Server").trim();
    var headers = checkHeaders(stream);

    out.push({
      name: PROVIDER,
      title: label + " • " + quality + " • MalaySub",
      url: url,
      quality: quality,
      headers: headers,
      mimeType: stream.hlsVerified ? "application/x-mpegURL" : (stream.mimeType || undefined)
    });
  });

  return out;
}

// The same short validation budget applies to every host/candidate.
const MEDIA_CHECK_MS = 2000;
function checkedRequest(url, options, read) {
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var opts = Object.assign({}, options || {});
  if (controller) opts.signal = controller.signal;
  var cancel;
  var request = new Promise(function (resolve) {
    var settled = false;
    var timer;
    cancel = function () {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (controller) controller.abort();
      resolve(null);
    };
    timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (controller) controller.abort();
      resolve(null);
    }, MEDIA_CHECK_MS);
    Promise.resolve().then(function () { return fetch(url, opts); }).then(read).then(function (result) {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(result);
    }, function () {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(null);
    });
  });
  request.cancel = function () { cancel(); };
  return request;
}

function checkHeaders(stream) {
  var headers = Object.assign({}, stream.headers || {});
  if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
  if (!headers.Accept) headers.Accept = "*/*";
  if (stream.noReferer) { delete headers.Referer; delete headers.referer; }
  else if (!headers.Referer && !headers.referer) headers.Referer = stream.referer || originOf(stream.url) + "/";
  return headers;
}

function isHlsStream(stream) {
  return /\.m3u8(?:[?#]|$)|\/engine\/hls\d*\//i.test(stream.url) || String(stream.label || "").toUpperCase() === "VOE";
}

function checkMedia(stream, hls) {
  var headers = checkHeaders(stream);
  if (!hls) headers.Range = "bytes=0-0";
  return checkedRequest(stream.url, { headers: headers }, function (res) {
    if (!res || (res.status !== 200 && res.status !== 206)) return null;
    if (hls) return res.text().then(function (body) {
      var text = String(body || "").replace(/^\uFEFF/, "").trim();
      if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) return null;
      var media = /^#EXTINF:/m.test(text) && /^(?!#)\S+/m.test(text);
      var lines = text.split(/\r?\n/).map(function (line) { return line.trim(); });
      var master = lines.some(function (line, index) {
        if (!/^#EXT-X-STREAM-INF:/.test(line)) return false;
        var next = index + 1;
        while (next < lines.length && (!lines[next] || lines[next][0] === "#")) next++;
        return next < lines.length && !/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(lines[next]) && /^https?:\/\//i.test(absoluteUrl(res.url || stream.url, lines[next]));
      });
      if (!media && !master) return null;
      // Keep Auto master playback, as Cloudstream generateM3u8(returnThis=true) does.
      // Use the actual HTTP response URL when VOE redirects a signed playlist.
      var verifiedUrl = stream.voe && /^https?:\/\//i.test(res.url || "") ? res.url : stream.url;
      return Object.assign({}, stream, { url: verifiedUrl, hlsVerified: true });
    });
    var type = res.headers && res.headers.get ? String(res.headers.get("content-type") || "").toLowerCase() : "";
    var range = res.headers && res.headers.get ? String(res.headers.get("content-range") || "") : "";
    var total = range.match(/\/(\d+)$/);
    if (res.body && typeof res.body.cancel === "function") Promise.resolve(res.body.cancel()).catch(function () {});
    if (!/^video\//.test(type) && !(/^application\/octet-stream/.test(type) && total && Number(total[1]) >= 65536)) return null;
    return stream;
  });
}

function firstChecked(candidates, hls) {
  // First valid response wins within this website choice only. Empty/error cannot win.
  return new Promise(function (resolve) {
    if (!candidates.length) { resolve(null); return; }
    var pending = candidates.length;
    var won = false;
    var probes = candidates.map(function (stream) { return checkMedia(stream, hls); });
    probes.forEach(function (probe) {
      probe.then(function (checked) {
        if (checked && !won) {
          won = true; resolve(checked);
          probes.forEach(function (other) { if (other !== probe && other.cancel) other.cancel(); });
        }
        pending--;
        if (!pending && !won) resolve(null);
      }).catch(function () { pending--; if (!pending && !won) resolve(null); });
    });
  });
}

function selectServerStream(streams, mirror, ordinal) {
  var seen = Object.create(null);
  var unique = (streams || []).filter(function (stream) {
    if (!stream || !/^https?:\/\//i.test(stream.url) || seen[stream.url]) return false;
    seen[stream.url] = true; return true;
  });
  var hls = unique.filter(isHlsStream);
  var direct = unique.filter(function (stream) { return !isHlsStream(stream); });
  return firstChecked(hls, true).then(function (winner) {
    return winner || firstChecked(direct, false);
  }).then(function (winner) {
    if (!winner) return [];
    var extractor = String(winner.label || "Server").replace(/\s+MP4$/i, "");
    if (/^(Direct|Nested|Server|Script)$/i.test(extractor)) extractor = hostOf(mirror.url) || "Server";
    if (/^dood$/i.test(extractor)) extractor = "DoodStream";
    if (/^voe$/i.test(extractor)) extractor = "Voe";
    var label = String(mirror.label || "").trim();
    var number = label.match(/^server[\s_-]*(\d+)$/i);
    var name = number ? extractor + " " + number[1] : !label || /^(Server|Script)$/i.test(label) ? extractor + " " + ordinal : label.toLowerCase() === extractor.toLowerCase() ? extractor + " " + ordinal : label + " • " + extractor;
    winner.label = name;
    winner.choiceId = mirror.url;
    return [winner];
  });
}

function resolveMirrors(mirrors, pageUrl) {
  var selected = (mirrors || []).slice().sort(function (a, b) {
    return mirrorPriority(a) - mirrorPriority(b);
  });

  console.log("[PencuriMovie] mirrors=" + mirrors.length);
  console.log("[PencuriMovie] mirror hosts=" + selected.map(function (x) {
    return hostOf(x.url) + "[" + String(x.label || "") + "]";
  }).join(" | "));

  return Promise.all(selected.map(function (mirror) {
    return resolveMirror(mirror, pageUrl, 0).then(function (streams) {
      return selectServerStream(streams, mirror, (mirrors || []).indexOf(mirror) + 1);
    }).catch(function () { return []; });
  })).then(function (groups) {
    var flat = [];
    groups.forEach(function (group) { flat = flat.concat(group || []); });
    return flat;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);

  console.log("[PencuriMovie] TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : ""));
  console.log("[PencuriMovie] base=" + BASE);

  return getTmdbDetails(tmdbId, mediaType)
    .then(function (details) {
      return findTitle(details, mediaType);
    })
    .then(function (item) {
      if (!item) {
        console.log("[PencuriMovie] title not found");
        return null;
      }
      return loadPlaybackPage(item, mediaType, season, episode);
    })
    .then(function (playback) {
      if (!playback) return [];
      var mirrors = collectEmbedUrls(playback.html, playback.url);
      return resolveMirrors(mirrors, playback.url);
    })
    .then(function (resolved) {
      var streams = formatStreams(resolved || []);
      console.log("[PencuriMovie] v" + VERSION + " checked sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[PencuriMovie] error=" + (error && error.message ? error.message : String(error)));
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
module.exports = cloudbankDisplayInstall(module.exports, "PencuriMovie", "pencurimovie");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
