// 4KHDHub Scraper for Nuvio Local Scrapers
// React Native compatible – no Node core modules, no async/await

const cheerio = require('cheerio-without-node-native');
console.log('[4KHDHub] Using cheerio-without-node-native for DOM parsing');

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_PROVIDER_REPAIR_V17 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
/* FOURK_MEMORY_SCOPE_GUARD_V1 */
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



// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';

// Disable URL validation for faster results
global.DISABLE_4KHDHUB_URL_VALIDATION = true;

// Caches (in-memory only)
let domainsCache = null;
let domainsInFlight = null;
let resolvedUrlsCache = {}; // key -> array of resolved file-host URLs

// Headers
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
};

// Polyfill atob/btoa for Node test environments if missing (kept lightweight, no imports)
if (typeof atob === 'undefined') {
  try {
    // eslint-disable-next-line no-undef
    global.atob = function (b64) { return Buffer.from(b64, 'base64').toString('binary'); };
  } catch (e) {
    // ignore for RN
  }
}
if (typeof btoa === 'undefined') {
  try {
    // eslint-disable-next-line no-undef
    global.btoa = function (str) { return Buffer.from(str, 'binary').toString('base64'); };
  } catch (e) {
    // ignore for RN
  }
}

// Helper: HTTP
function makeRequest(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  }).then(function (response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

// Base64 and misc helpers (RN-safe)
function base64Decode(str) {
  try {
    // Convert base64 -> binary string -> UTF-8
    // escape/unescape is deprecated but works in RN environments for this use case
    // eslint-disable-next-line no-undef
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    return '';
  }
}

function base64Encode(str) {
  try {
    // eslint-disable-next-line no-undef
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    return '';
  }
}

function rot13(str) {
  return (str || '').replace(/[A-Za-z]/g, function (char) {
    var start = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start);
  });
}

function decodeFilename(filename) {
  if (!filename) return filename;
  try {
    var decoded = filename;
    if (decoded.indexOf('UTF-8') === 0) {
      decoded = decoded.substring(5);
    }
    return decodeURIComponent(decoded);
  } catch (e) {
    return filename;
  }
}

function getIndexQuality(str) {
  var match = (str || '').match(/(\d{3,4})[pP]/);
  return match ? parseInt(match[1], 10) : 2160;
}

function cleanTitle(title) {
  var decodedTitle = decodeFilename(title || '');
  var parts = decodedTitle.split(/[.\-_]/);
  var qualityTags = ['WEBRip','WEB-DL','WEB','BluRay','HDRip','DVDRip','HDTV','CAM','TS','R5','DVDScr','BRRip','BDRip','DVD','PDTV','HD'];
  var audioTags = ['AAC','AC3','DTS','MP3','FLAC','DD5','EAC3','Atmos'];
  var subTags = ['ESub','ESubs','Subs','MultiSub','NoSub','EnglishSub','HindiSub'];
  var codecTags = ['x264','x265','H264','HEVC','AVC'];

  var startIndex = parts.findIndex(function (part) {
    return qualityTags.some(function (tag) { return part.toLowerCase().indexOf(tag.toLowerCase()) !== -1; });
  });

  var endIndex = parts.map(function (part, index) {
    var hasTag = subTags.concat(audioTags).concat(codecTags).some(function (tag) {
      return part.toLowerCase().indexOf(tag.toLowerCase()) !== -1;
    });
    return hasTag ? index : -1;
  }).filter(function (i) { return i !== -1; }).pop() || -1;

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    return parts.slice(startIndex, endIndex + 1).join('.');
  } else if (startIndex !== -1) {
    return parts.slice(startIndex).join('.');
  } else {
    return parts.slice(-3).join('.');
  }
}

function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = Object.create(null);

  function add(value, priority) {
    var text = String(value || '').trim();
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
    var country = String(item.iso_3166_1 || '').toUpperCase();
    var priority = country === 'US' || country === 'GB' ? 86 : (country === 'MY' || country === 'ID' ? 82 : 72);
    add(item.title || item.name, priority);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];
  translations.forEach(function(item) {
    var row = item && item.data && typeof item.data === 'object' ? item.data : {};
    var lang = String(item && item.iso_639_1 || '').toLowerCase();
    var priority = lang === 'en' ? 88 : (lang === 'ms' || lang === 'id' ? 80 : 68);
    add(row.title || row.name, priority);
  });

  output.sort(function(a, b) { return b.priority - a.priority; });
  return output.map(function(item) { return item.title; }).slice(0, 12);
}

function cleanDiscoveryTitle4K(value) {
  return normalizeTitle(
    String(value || '')
      .replace(/\[(?:[^\]]{0,140})\]/g, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ')
      .replace(/\bseason\s*\d{1,2}\b/gi, ' ')
      .replace(/\bs\d{1,2}\b/gi, ' ')
      .replace(/\b(?:2160p|1080p|720p|480p|4k|web[- ]?dl|webrip|bluray|hevc|h26[45]|10bit|dual audio|full movie|full series|all episodes)\b/gi, ' ')
  );
}

function bestAliasSimilarity4K(candidate, info) {
  var aliases = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases
    : [info && info.title, info && info.originalTitle];
  var cleanCandidate = cleanDiscoveryTitle4K(candidate);
  var best = 0;
  aliases.forEach(function(alias) {
    var cleanAlias = cleanDiscoveryTitle4K(alias);
    best = Math.max(best, calculateSimilarity(candidate, alias));
    if (cleanCandidate && cleanAlias) {
      if (cleanCandidate === cleanAlias) best = Math.max(best, 1);
      else if (cleanCandidate.indexOf(cleanAlias) !== -1 || cleanAlias.indexOf(cleanCandidate) !== -1) best = Math.max(best, 0.92);
      else best = Math.max(best, calculateSimilarity(cleanCandidate, cleanAlias));
    }
  });
  return best;
}

function buildDiscoveryQueries4K(info, mediaType, season) {
  var output = [];
  var seen = Object.create(null);
  var aliases = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases
    : [info && info.title, info && info.originalTitle];

  function add(value) {
    var text = String(value || '').trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push(text);
  }

  aliases.slice(0, 6).forEach(function(alias) {
    add(alias);
    if (mediaType === 'tv' && season) add(alias + ' season ' + season);
    if (info && info.year) add(alias + ' ' + info.year);
  });

  return output.slice(0, 8);
}

function calculateSimilarity(str1, str2) {
  var s1 = normalizeTitle(str1);
  var s2 = normalizeTitle(str2);
  if (s1 === s2) return 1.0;
  var len1 = s1.length;
  var len2 = s2.length;
  if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
  if (len2 === 0) return 0.0;
  var matrix = Array(len1 + 1).fill(null).map(function () { return Array(len2 + 1).fill(0); });
  for (var i = 0; i <= len1; i++) matrix[i][0] = i;
  for (var j = 0; j <= len2; j++) matrix[0][j] = j;
  for (i = 1; i <= len1; i++) {
    for (j = 1; j <= len2; j++) {
      var cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  var maxLen = Math.max(len1, len2);
  return (maxLen - matrix[len1][len2]) / maxLen;
}

function findBestMatch(results, info, mediaType, season) {
  if (!results || results.length === 0) return null;
  var scored = results.map(function(r) {
    var score = bestAliasSimilarity4K(r.title, info) * 100;
    var rYear = null;
    var yMatch = String(r.year || r.title || '').match(/(19|20)\d{2}/);
    if (yMatch) rYear = parseInt(yMatch[0], 10);
    var targetYear = parseInt(info && info.year, 10);
    if (targetYear && !isNaN(targetYear)) {
      if (rYear === targetYear) score += 28;
      else if (rYear && Math.abs(rYear - targetYear) <= 1) score += 8;
      else if (rYear) score -= 34;
    }

    if (mediaType === 'tv' && season) {
      var explicitSeason = String(r.title || '').match(/\bseason\s*(\d{1,2})\b/i) || String(r.title || '').match(/\bs(\d{1,2})\b/i);
      if (explicitSeason) {
        if (Number(explicitSeason[1]) === Number(season)) score += 26;
        else score -= 120;
      }
    }
    return { item: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  if (!scored.length || scored[0].score < 55) return null;
  vueoTrace('CANDIDATE', { count: results.length, title: scored[0].item.title || '', score: Math.round(scored[0].score) });
  return scored[0].item;
}

// URL utils – replicate UHDMovies validation style
function validateVideoUrl(url, timeout) {
  console.log('[4KHDHub] Validating URL: ' + (url.substring(0, 100)) + '...');
  return fetch(url, {
    method: 'HEAD',
    headers: {
      'Range': 'bytes=0-1',
      'User-Agent': DEFAULT_HEADERS['User-Agent']
    }
  }).then(function (response) {
    if (response.ok || response.status === 206) {
      console.log('[4KHDHub] ✓ URL validation successful (' + response.status + ')');
      return true;
    } else {
      console.log('[4KHDHub] ✗ URL validation failed with status: ' + response.status);
      return false;
    }
  }).catch(function (error) {
    console.log('[4KHDHub] ✗ URL validation failed: ' + (error && error.message));
    return false;
  });
}

function getFilenameFromUrl(url) {
  try {
    // Commented out HEAD request for filename fetch
    // return fetch(url, {
    //   method: 'HEAD',
    //   headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] }
    // }).then(function (res) {
    //   var cd = res.headers.get('content-disposition');
    //   var filename = null;
    //   if (cd) {
    //     var match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    //     if (match && match[1]) filename = (match[1] || '').replace(/["']/g, '');
    //   }
    //   if (!filename) {
    //     try {
    //       var uo = new URL(url);
    //       filename = uo.pathname.split('/').pop() || '';
    //       if (filename && filename.indexOf('.') !== -1) filename = filename.replace(/\.[^.]+$/, '');
    //     } catch (e) { /* ignore */ }
    //   }
    //   var decoded = decodeFilename(filename || '');
    //   return decoded || null;
    // }).catch(function () { return null; });
    
    // Fallback to URL-based filename extraction without HEAD request
    try {
      var uo = new URL(url);
      var filename = uo.pathname.split('/').pop() || '';
      if (filename && filename.indexOf('.') !== -1) filename = filename.replace(/\.[^.]+$/, '');
      var decoded = decodeFilename(filename || '');
      return Promise.resolve(decoded || null);
    } catch (e) { 
      return Promise.resolve(null); 
    }
  } catch (e) {
    return Promise.resolve(null);
  }
}

// Domains
function getDomains() {
  if (domainsCache) return Promise.resolve(domainsCache);
  if (domainsInFlight) return domainsInFlight;
  domainsInFlight = makeRequest(DOMAINS_URL)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      domainsCache = data || {};
      domainsInFlight = null;
      return domainsCache;
    })
    .catch(function() {
      domainsInFlight = null;
      return null;
    });
  return domainsInFlight;
}

// Resolve redirect link style used by 4KHDHub
function getRedirectLinks(url) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var combined = '';
    var m;
    while ((m = regex.exec(html)) !== null) {
      var val = m[1] || m[2];
      if (val) combined += val;
    }
    try {
      var decoded = base64Decode(rot13(base64Decode(base64Decode(combined))));
      var obj = JSON.parse(decoded);
      var encodedurl = base64Decode(obj.o || '').trim();
      var data = base64Decode(obj.data || '').trim();
      var blog = (obj.blog_url || '').trim();
      if (encodedurl) return encodedurl;
      if (blog && data) {
        return makeRequest(blog + '?re=' + data).then(function (r) { return r.text(); }).then(function (txt) { return (txt || '').trim(); }).catch(function () { return ''; });
      }
      return '';
    } catch (e) {
      return '';
    }
  }).catch(function () { return ''; });
}

function parse4KSearchCards(html, baseUrl) {
  var $ = cheerio.load(String(html || ''));
  var results = [];
  var seen = Object.create(null);

  function add(title, href, poster, year) {
    title = String(title || '').trim();
    href = String(href || '').trim();
    if (!title || !href) return;
    var absoluteUrl = href.indexOf('http') === 0 ? href : (baseUrl + (href.indexOf('/') === 0 ? '' : '/') + href);
    if (seen[absoluteUrl]) return;
    seen[absoluteUrl] = true;
    results.push({ title: title, url: absoluteUrl, poster: poster || '', year: year || '' });
  }

  $('a').each(function(i, el) {
    var $el = $(el);
    add(
      $el.find('h3.movie-card-title').text(),
      $el.attr('href'),
      $el.find('img').attr('src'),
      $el.find('p.movie-card-meta').text()
    );
  });

  $('div.card-grid a').each(function(i, el) {
    var $el = $(el);
    add($el.find('h3').text(), $el.attr('href'), $el.find('img').attr('src'), $el.text());
  });

  if (!results.length) {
    $('a[href]').each(function(i, el) {
      var $el = $(el);
      var href = $el.attr('href') || '';
      var title = $el.find('h2,h3').first().text() || $el.attr('title') || $el.text();
      if (!title || !href) return;
      if (!/movie|season|series|\/(?:19|20)\d{2}\//i.test(String(title) + ' ' + href)) return;
      add(title, href, $el.find('img').attr('src'), $el.text());
    });
  }

  return results;
}

// Search content
function searchContent(query) {
  return getDomains().then(function (domains) {
    if (!domains || !domains['4khdhub']) throw new Error('Failed to get domain information');
    var baseUrl = domains['4khdhub'];
    var searchUrl = baseUrl + '/?s=' + encodeURIComponent(query);
    return makeRequest(searchUrl).then(function (res) { return res.text(); }).then(function (html) {
      return parse4KSearchCards(html, baseUrl);
    });
  });
}

function extractCandidateUrlsFromHtml(html, baseUrl) {
  var $ = cheerio.load(String(html || ''));
  var output = [];
  var seen = Object.create(null);
  var selectors = [
    'div.download-item a',
    '.download-item a',
    'a[href*="hubdrive"]',
    'a[href*="hubcloud"]',
    'a[href*="pixeldrain"]',
    'a[href*="buzz"]',
    'a[href*="10gbps"]',
    'a[href*="drive"]',
    'a.btn[href]'
  ];
  selectors.forEach(function(selector) {
    $(selector).each(function(i, el) {
      var href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try { href = new URL(href, baseUrl).href; } catch (_) {}
      var lower = href.toLowerCase();
      if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(lower)) return;
      if (!/hubdrive|hubcloud|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|id=|download|s3|fsl|gamerxyt/i.test(lower)) return;
      if (seen[href]) return;
      seen[href] = true;
      output.push(href);
    });
  });
  return output.slice(0, 12);
}

// Load content page and collect download links (and episodes for TV)
function loadContent(url) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var title = ($('h1.page-title').text() || '').split('(')[0].trim();
    var poster = $('meta[property="og:image"]').attr('content') || '';
    var tags = [];
    $('div.mt-2 span.badge').each(function (i, el) { tags.push($(el).text()); });
    var year = parseInt(($('div.mt-2 span').first().text() || '').replace(/[^0-9]/g, ''), 10) || null;
    var description = $('div.content-section p.mt-4').text().trim() || '';
    var trailer = $('#trailer-btn').attr('data-trailer-url') || '';
    var isMovie = tags.indexOf('Movies') !== -1;

    // V17/V18: keep only extractor-worthy URLs; navigation links never enter the queue.
    var hrefs = extractCandidateUrlsFromHtml(html, url);

    var content = { title: title, poster: poster, tags: tags, year: year, description: description, trailer: trailer, type: isMovie ? 'movie' : 'series' };
    if (isMovie) {
      content.downloadLinks = hrefs;
      return content;
    }

    // Series handling (best-effort; falls back to general links)
    var episodesMap = {};
    $('div.episodes-list div.season-item').each(function (i, seasonEl) {
      var $season = $(seasonEl);
      var seasonText = $season.find('div.episode-number').text() || '';
      var seasonMatch = seasonText.match(/S?([1-9][0-9]*)/);
      var seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
      $season.find('div.episode-download-item').each(function (j, epEl) {
        var $ep = $(epEl);
        var epText = $ep.find('div.episode-file-info span.badge-psa').text() || '';
        var epMatch = epText.match(/Episode-0*([1-9][0-9]*)/);
        var episodeNum = epMatch ? parseInt(epMatch[1], 10) : null;
        var epLinks = [];
        $ep.find('a').each(function (k, a) {
          var h = $(a).attr('href'); if (h && h.trim()) epLinks.push(h);
        });
        if (seasonNum && episodeNum && epLinks.length > 0) {
          var key = seasonNum + '-' + episodeNum;
          if (!episodesMap[key]) episodesMap[key] = { season: seasonNum, episode: episodeNum, downloadLinks: [] };
          episodesMap[key].downloadLinks = episodesMap[key].downloadLinks.concat(epLinks);
        }
      });
    });

    var episodes = Object.keys(episodesMap).map(function (k) {
      var ep = episodesMap[k];
      ep.downloadLinks = Array.from(new Set(ep.downloadLinks));
      return ep;
    });

    if (episodes.length === 0 && hrefs.length > 0) {
      content.episodes = [{ season: 1, episode: 1, downloadLinks: hrefs }];
    } else {
      content.episodes = episodes;
    }
    return content;
  });
}

// Extract HubCloud links -> [{name,title,url,quality}]
function extractHubCloudLinks(url, referer) {
  var origin;
  try { origin = new URL(url).origin; } catch (e) { origin = ''; }

  function toAbsolute(href, base) {
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  function resolveBuzzServer(buttonLink) {
    var baseOrigin = (function () { try { return new URL(buttonLink).origin; } catch (e) { return origin; } })();
    var dlUrl = buttonLink.replace(/\/?$/, '') + '/download';
    return fetch(dlUrl, { headers: { 'Referer': buttonLink, 'User-Agent': DEFAULT_HEADERS['User-Agent'] }, redirect: 'manual' })
      .then(function (res) {
        var hx = res.headers.get('hx-redirect') || res.headers.get('location');
        if (hx) return toAbsolute(hx, baseOrigin);
        // Fallback: if manual redirect unsupported, use final response URL
        return res.url || buttonLink;
      }).catch(function () { return buttonLink; });
  }

  function resolveTenGbps(initialLink, headerDetails, size, qualityLabel, quality) {
    var current = initialLink;
    var baseOrigin = (function () { try { return new URL(initialLink).origin; } catch (e) { return origin; } })();
    var maxHops = 6;
    function step() {
      return fetch(current, { redirect: 'manual', headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] } })
        .then(function (res) {
          var loc = res.headers.get('location');
          if (!loc) {
            // Try current as final
            return null;
          }
          if (loc.indexOf('id=') !== -1) {
            var linkParam = (loc.split('link=')[1] || '').trim();
            if (linkParam) {
              try { linkParam = decodeURIComponent(linkParam); } catch (e) { /* ignore */ }
              return linkParam;
            }
            return null;
          } else {
            current = toAbsolute(loc, baseOrigin);
            return step();
          }
        });
    }
    return step().then(function (finalUrl) {
      if (!finalUrl) return null;
      return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
        var displayFilename = actualFilename || headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        var finalTitle = titleParts.join('\n');
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality };
      }).catch(function () {
        var displayFilename = headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        var finalTitle = titleParts.join('\n');
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality };
      });
    }).catch(function () { return null; });
  }

  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var href = url;
    if (url.indexOf('hubcloud.php') === -1) {
      var rawHref = $('#download').attr('href') || $('a[href*="hubcloud.php"]').attr('href') || $('.download-btn').attr('href') || $('a[href*="download"]').attr('href');
      if (!rawHref) throw new Error('Download element not found');
      href = toAbsolute(rawHref, origin);
    }
    return makeRequest(href).then(function (res2) { return res2.text(); }).then(function (html2) {
      var $$ = cheerio.load(html2);

      function buildTask(buttonText, buttonLink, headerDetails, size, quality) {
        var qualityLabel = quality ? (' - ' + quality + 'p') : '';
        // Pixeldrain normalization
        var pd = buttonLink.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
        if (pd && pd[1]) buttonLink = 'https://pixeldrain.net/api/file/' + pd[1];

        if (buttonText.indexOf('BuzzServer') !== -1) {
          return resolveBuzzServer(buttonLink).then(function (finalUrl) {
            return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
              var displayFilename = actualFilename || headerDetails || 'Unknown';
              var titleParts = [];
              if (displayFilename) titleParts.push(displayFilename);
              if (size) titleParts.push(size);
              var finalTitle = titleParts.join('\n');
            return { name: '4KHDHub - BuzzServer' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality, size: size || null, fileName: actualFilename || null };
            }).catch(function () {
              var displayFilename = headerDetails || 'Unknown';
              var titleParts = [];
              if (displayFilename) titleParts.push(displayFilename);
              if (size) titleParts.push(size);
              var finalTitle = titleParts.join('\n');
            return { name: '4KHDHub - BuzzServer' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality, size: size || null, fileName: null };
            });
          }).catch(function () { return null; });
        }
        if (buttonText.indexOf('10Gbps') !== -1) {
          return resolveTenGbps(buttonLink, headerDetails, size, qualityLabel, quality);
        }
        return getFilenameFromUrl(buttonLink).then(function (actualFilename) {
          var displayFilename = actualFilename || headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          var finalTitle = titleParts.join('\n');
          var name;
          if (buttonText.indexOf('FSL Server') !== -1) name = '4KHDHub - FSL Server' + qualityLabel;
          else if (buttonText.indexOf('S3 Server') !== -1) name = '4KHDHub - S3 Server' + qualityLabel;
          else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = '4KHDHub - Pixeldrain' + qualityLabel;
          else if (buttonText.indexOf('Download File') !== -1) name = '4KHDHub - HubCloud' + qualityLabel;
          else name = '4KHDHub - HubCloud' + qualityLabel;
        return { name: name, title: finalTitle, url: buttonLink, quality: quality, size: size || null, fileName: actualFilename || null };
        }).catch(function () {
          var displayFilename = headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          var finalTitle = titleParts.join('\n');
          var name = '4KHDHub - HubCloud' + qualityLabel;
        return { name: name, title: finalTitle, url: buttonLink, quality: quality, size: size || null, fileName: null };
        });
      }

      // Iterate per card to capture per-quality sections.
      // FOURK_MEMORY_SCOPE_GUARD_V1: collect plain values first; start async work only after DOM traversal.
      var taskSpecs = [];
      var cards = $$('.card');
      if (cards.length > 0) {
        cards.each(function (ci, card) {
          var $card = $$(card);
          var header = $card.find('div.card-header').text() || $$('div.card-header').first().text() || '';
          var size = $card.find('i#size').text() || $$('i#size').first().text() || '';
          var quality = getIndexQuality(header);
          var headerDetails = cleanTitle(header);
          var localBtns = $card.find('div.card-body h2 a.btn');
          if (localBtns.length === 0) localBtns = $card.find('a.btn, .btn, a[href]');
          localBtns.each(function (i, el) {
            var $btn = $$(el);
            var text = ($btn.text() || '').trim();
            var link = $btn.attr('href');
            if (!link) return;
            link = toAbsolute(link, href);
            // Only consider plausible buttons
            if (!/(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file)/i.test(link) && text.toLowerCase().indexOf('download') === -1) return;
            taskSpecs.push({ text: text, link: link, headerDetails: headerDetails, size: size, quality: quality });
          });
        });
      }

      // Fallback: whole page buttons. V17: never feed navigation/privacy/sign links into extractors.
      if (taskSpecs.length === 0) {
        var buttons = $$.root().find('div.card-body h2 a.btn');
        if (buttons.length === 0) {
          var altSelectors = ['a.btn', '.btn', 'a[href]'];
          for (var si = 0; si < altSelectors.length && buttons.length === 0; si++) {
            buttons = $$.root().find(altSelectors[si]);
          }
        }
        var size = $$('i#size').first().text() || '';
        var header = $$('div.card-header').first().text() || '';
        var quality = getIndexQuality(header);
        var headerDetails = cleanTitle(header);
        buttons.each(function (i, el) {
          var $btn = $$(el);
          var text = ($btn.text() || '').trim();
          var link = $btn.attr('href');
          if (!link) return;
          link = toAbsolute(link, href);
          var lowerLink = String(link || '').toLowerCase();
          var lowerText = String(text || '').toLowerCase();
          if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(lowerLink)) return;
          if (lowerLink === String(origin || '').toLowerCase() + '/' || lowerLink === String(href || '').toLowerCase()) return;
          if (!/(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file|gamerxyt)/i.test(lowerLink) && lowerText.indexOf('download') === -1) return;
          taskSpecs.push({ text: text, link: link, headerDetails: headerDetails, size: size, quality: quality });
        });
      }

      if (taskSpecs.length === 0) return [];
      var boundedSpecs = taskSpecs.slice(0, 10);
      $ = null;
      $$ = null;
      return Promise.all(boundedSpecs.map(function(spec) {
        return buildTask(spec.text, spec.link, spec.headerDetails, spec.size, spec.quality);
      })).then(function (arr) { return (arr || []).filter(function (x) { return !!x; }); });
    });
  }).catch(function () { return []; });
}

// Extract HubDrive links (wrapper around HubCloud if needed)
function extractHubDriveLinks(url, referer) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var size = $('i#size').text() || '';
    var header = $('div.card-header').text() || '';
    var quality = getIndexQuality(header);
    var headerDetails = cleanTitle(header);
    var filename = (headerDetails || header || 'Unknown').replace(/^4kHDHub\.com\s*[-_]?\s*/i, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ').trim();
    var primaryBtn = $('.btn.btn-primary.btn-user.btn-success1.m-1').attr('href') || $('a.btn.btn-primary').attr('href') || $('a[href*="download"]').attr('href') || $('a.btn').attr('href');
    if (!primaryBtn) return [];
    if ((primaryBtn || '').toLowerCase().indexOf('hubcloud') !== -1) {
      return extractHubCloudLinks(primaryBtn, '4KHDHub');
    }
    var qualityLabel = quality ? (' - ' + quality + 'p') : '';
    return getFilenameFromUrl(primaryBtn).then(function (actualFilename) {
      var displayFilename = actualFilename || filename || 'Unknown';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      if (size) titleParts.push(size);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubDrive' + qualityLabel, title: finalTitle, url: primaryBtn, quality: quality }];
    }).catch(function () {
      var displayFilename = filename || 'Unknown';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      if (size) titleParts.push(size);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubDrive' + qualityLabel, title: finalTitle, url: primaryBtn, quality: quality }];
    });
  }).catch(function () { return []; });
}

// Dispatcher for a single link to final streams
function processExtractorLink(link) {
  var lower = (link || '').toLowerCase();
  if (lower.indexOf('hubdrive') !== -1) {
    return extractHubDriveLinks(link, '4KHDHub');
  } else if (lower.indexOf('hubcloud') !== -1) {
    return extractHubCloudLinks(link, '4KHDHub');
  } else if (lower.indexOf('workers.dev') !== -1 || lower.indexOf('r2.dev') !== -1) {
    // Cloudflare Workers / R2 links – treat as HubCloud direct files
    return getFilenameFromUrl(link).then(function (actualFilename) {
      var displayFilename = actualFilename || 'HubCloud File';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubCloud - 1080p', title: finalTitle, url: link, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      return [{ name: '4KHDHub - HubCloud - 1080p', title: 'HubCloud File', url: link, quality: 1080, size: null, fileName: null }];
    });
  } else if (lower.indexOf('pixeldrain') !== -1) {
    // Normalize pixeldrain URLs to API endpoint
    var converted = link;
    var m = link.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
    if (m && m[1]) converted = 'https://pixeldrain.net/api/file/' + m[1];
    return getFilenameFromUrl(converted).then(function (actualFilename) {
      var displayFilename = actualFilename || 'Pixeldrain File';
      var title = displayFilename + '\nPixeldrain';
      return [{ name: '4KHDHub - Pixeldrain - 1080p', title: title, url: converted, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      var title = 'Pixeldrain File\nPixeldrain';
      return [{ name: '4KHDHub - Pixeldrain - 1080p', title: title, url: converted, quality: 1080, size: null, fileName: null }];
    });
  } else if (/\.m(ov|p4|kv)$|\.avi$/i.test(link)) {
    // Direct video link
    var filename = (function () {
      try { return decodeFilename(new URL(link).pathname.split('/').pop().replace(/\.[^/.]+$/, '').replace(/[._]/g, ' ')); } catch (e) { return 'Direct Link'; }
    })();
    return getFilenameFromUrl(link).then(function (actualFilename) {
      var displayFilename = actualFilename || filename || 'Unknown';
      return [{ name: '4KHDHub Direct Link', title: displayFilename + '\n[Direct Link]', url: link, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      return [{ name: '4KHDHub Direct Link', title: filename + '\n[Direct Link]', url: link, quality: 1080, size: null, fileName: null }];
    });
  }
  return Promise.resolve([]);
}

// Convert a list of resolved hosting URLs to final stream entries
function extractStreamingLinks(downloadLinks) {
  var tasks = (downloadLinks || []).map(function (lnk) {
    return processExtractorLink(lnk).then(function (res) { return res || []; }).catch(function () { return []; });
  });
  return Promise.all(tasks).then(function (arrs) {
    var flat = [].concat.apply([], arrs).filter(function (x) { return x && x.url; });
    // Filter out .zip and suspicious AMP
    var suspicious = ['www-google-com.cdn.ampproject.org', 'bloggingvector.shop', 'cdn.ampproject.org'];
    flat = flat.filter(function (x) {
      var u = (x.url || '').toLowerCase();
      if (u.endsWith('.zip')) return false;
      return !suspicious.some(function (p) { return u.indexOf(p) !== -1; });
    });
    // Deduplicate by URL
    var seen = {};
    var unique = [];
    flat.forEach(function (x) { if (!seen[x.url]) { seen[x.url] = 1; unique.push(x); } });
    return unique;
  });
}

// TMDB helper
function getTMDBDetails(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&append_to_response=alternative_titles,translations,external_ids';
  return vueoSharedTmdb(url, function() {
    return makeRequest(url).then(function(res) { return res.json(); });
  }).then(function(data) {
    if (mediaType === 'movie') {
      return { title: data.title, originalTitle: data.original_title, year: data.release_date ? data.release_date.split('-')[0] : null, aliases: collectTmdbAliases(data, mediaType) };
    }
    return { title: data.name, originalTitle: data.original_name, year: data.first_air_date ? data.first_air_date.split('-')[0] : null, aliases: collectTmdbAliases(data, mediaType) };
  }).catch(function() { return null; });
}

// Main entry – Promise-based, no async/await
function getStreams(tmdbId, type, season, episode) {
  type = type || 'movie';
  var cacheKey = '4khdhub_resolved_urls_v1_' + tmdbId + '_' + type + (season ? ('_s' + season + 'e' + (episode || '')) : '');
  var disableValidation = ((typeof URL_VALIDATION_ENABLED !== 'undefined') && (URL_VALIDATION_ENABLED === false)) ||
                          ((typeof DISABLE_4KHDHUB_URL_VALIDATION !== 'undefined') && (DISABLE_4KHDHUB_URL_VALIDATION === true));

  function finalizeToStreams(links) {
    var tasks = links.map(function (link) { return disableValidation ? Promise.resolve(true) : validateVideoUrl(link.url); });
    return Promise.all(tasks).then(function (vals) {
      var validated = links.filter(function (l, idx) { return !!vals[idx]; });
      return validated.map(function (l) {
        return {
          name: l.name,
          title: l.title || l.name,
          url: l.url,
          quality: (l.quality ? (l.quality + 'p') : '1080p'),
          size: l.size || null,
          fileName: l.fileName || null,
          type: 'direct',
          behaviorHints: { bingeGroup: '4khdhub-streams' }
        };
      });
    });
  }

  var cached = resolvedUrlsCache[cacheKey];
  if (cached && cached.length > 0) {
    return extractStreamingLinks(cached).then(function (streams) { return finalizeToStreams(streams); });
  }

  var tmdbType = (type === 'series' ? 'tv' : type);
  return getTMDBDetails(tmdbId, tmdbType).then(function (tmdb) {
    if (!tmdb || !tmdb.title) return [];
    var queries = buildDiscoveryQueries4K(tmdb, tmdbType, season);
    function findCandidate(index) {
      if (index >= queries.length) return Promise.resolve(null);
      return searchContent(queries[index]).then(function(results) {
        var best = findBestMatch(results || [], tmdb, tmdbType, season);
        return best || findCandidate(index + 1);
      }).catch(function() { return findCandidate(index + 1); });
    }

    return findCandidate(0).then(function (best) {
      if (!best) return [];
      return loadContent(best.url).then(function (content) {
        var downloadLinks = [];
        if (type === 'movie') {
          downloadLinks = content.downloadLinks || [];
        } else if ((type === 'series' || type === 'tv') && season && episode) {
          var target = (content.episodes || []).find(function (ep) { return ep.season === parseInt(season, 10) && ep.episode === parseInt(episode, 10); });
          downloadLinks = target ? (target.downloadLinks || []) : [];
        }
        if (!downloadLinks || downloadLinks.length === 0) return [];

        downloadLinks = downloadLinks.filter(function(lnk) {
          var value = String(lnk || '').toLowerCase();
          if (!value) return false;
          if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(value)) return false;
          return /hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|id=|gamerxyt/i.test(value);
        }).slice(0, 10);
        vueoTrace("EXTRACT_QUEUE", { links: downloadLinks.length });
        if (!downloadLinks.length) return [];

        // Resolve redirect-style links to file hosts
        var resolverTasks = downloadLinks.map(function (lnk) {
          var needs = (lnk || '').toLowerCase().indexOf('id=') !== -1;
          if (needs) {
            return getRedirectLinks(lnk).then(function (r) { return r && r.trim() ? r : null; }).catch(function () { return null; });
          }
          return Promise.resolve(lnk);
        });

        return Promise.all(resolverTasks).then(function (resolvedArr) {
          var resolved = resolvedArr.filter(function (x) { return x && x.trim(); });
          if (resolved.length === 0) return [];
          resolvedUrlsCache[cacheKey] = resolved; // cache in-memory
          return extractStreamingLinks(resolved).then(function (links) { return finalizeToStreams(links); });
        });
      });
    });
  }).catch(function () { return []; });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  // RN global
  // eslint-disable-next-line no-undef
  global.getStreams = getStreams;
}



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
const PROVIDER = "4KHDHub";
const VERSION = "1.1.0";
const BASES = ["https://4khdhub.one", "https://4khdhub.fans"];
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const MULTI_FIRST_GRACE_MS = 1800;
const MULTI_ABSOLUTE_MS = 5200;
const QUALITY_TASK_LIMIT = 2;

function cheerio() { return require("cheerio-without-node-native"); }

function fetchResp(url, options) {
  var opts = options || {};
  opts.headers = Object.assign({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  }, opts.headers || {});
  return fetch(url, opts).then(function (res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    return res.text().then(function (text) {
      return { text: text, url: res.url || url, status: res.status, headers: res.headers };
    });
  });
}

function fetchText(url, options) { return fetchResp(url, options).then(function (x) { return x.text; }); }
function fetchJson(url, options) { return fetchText(url, options).then(function (t) { return JSON.parse(String(t || "").replace(/^\uFEFF/, "")); }); }

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}
function absoluteUrl(base, href) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return "https:" + href;
  var origin = originOf(base);
  if (!origin) return href;
  if (href.charAt(0) === "/") return origin + href;
  return String(base || "").replace(/[#?].*$/, "").replace(/\/[^/]*$/, "/") + href;
}
function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^/:?#]+)/i);
  return m ? m[1].toLowerCase() : "?";
}
function normalizeTitle(v) {
  var s = String(v || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s.replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function parseYear(v) {
  var m = String(v || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}
function qualityFromText(v) {
  var m = String(v || "").match(/\b(2160|1080|720|480|360)p\b/i);
  return m ? m[1] + "p" : "Auto";
}
function displayQuality(q) {
  q = String(q || "Auto");
  return q === "2160p" ? "4K" : q;
}
function mediaLike(url) {
  var clean = String(url || "").split("?")[0].toLowerCase();
  return /\.(mkv|mp4|m3u8|mpd|webm|m4v)$/.test(clean) || /workers\.dev/i.test(url);
}
function unique(arr) {
  var seen = {};
  return (arr || []).filter(function (x) {
    x = String(x || "").trim();
    if (!x || seen[x]) return false;
    seen[x] = 1; return true;
  });
}
function b64decode(v) {
  try {
    if (typeof atob === "function") return atob(String(v || ""));
  } catch (_) {}
  try {
    var CryptoJS = require("crypto-js");
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(String(v || "")));
  } catch (_) { return ""; }
}
function rot13(v) {
  return String(v || "").replace(/[a-zA-Z]/g, function (c) {
    var base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });
}

function tmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return fetchJson(TMDB_BASE + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=en-US", {
    headers: { "Accept": "application/json" }
  });
}
function tmdbInfo(d, mediaType) {
  var tv = mediaType === "tv";
  return {
    title: String(tv ? (d.name || d.original_name || "") : (d.title || d.original_title || "")).trim(),
    aliases: unique([tv ? d.name : d.title, tv ? d.original_name : d.original_title]),
    year: parseYear(tv ? d.first_air_date : d.release_date)
  };
}

function candidateText($, el) {
  var cur = $(el);
  var texts = [];
  for (var i = 0; i < 5 && cur && cur.length; i++) {
    var t = String(cur.text() || "").replace(/\s+/g, " ").trim();
    if (t && texts.indexOf(t) < 0) texts.push(t);
    if (/(?:19|20)\d{2}/.test(t) && t.length > 10) break;
    cur = cur.parent();
  }
  return texts.join(" ");
}
function titleFromAnchor($, el, href) {
  var a = $(el);
  var img = a.find("img").first();
  var alt = String(img.attr("alt") || "").replace(/^Poster Image of\s+/i, "").trim();
  if (alt) return alt.replace(/\s+•.*$/, "").replace(/\s+\((?:19|20)\d{2}\)$/, "").trim();
  var title = String(a.attr("title") || "").trim();
  if (title) return title.replace(/\s+•.*$/, "").replace(/\s+\((?:19|20)\d{2}\)$/, "").trim();
  var slug = String(href || "").replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "").replace(/\/$/, "")
    .replace(/-(movie|series)-\d+$/i, "").replace(/-/g, " ");
  return slug.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
function scoreSearchCandidate(c, info, mediaType) {
  var wantedType = mediaType === "tv" ? "series" : "movie";
  if (c.type !== wantedType) return -9999;
  var nt = normalizeTitle(c.title);
  var bestTitle = 0;
  (info.aliases || [info.title]).forEach(function (a) {
    var na = normalizeTitle(a);
    if (!na) return;
    if (nt === na) bestTitle = Math.max(bestTitle, 1000);
    else if (nt.indexOf(na) >= 0 || na.indexOf(nt) >= 0) bestTitle = Math.max(bestTitle, 650);
  });
  if (!bestTitle) return -9999;
  var score = bestTitle;
  if (c.year && info.year) {
    if (c.year === info.year) score += 500;
    else if (Math.abs(c.year - info.year) === 1) score += 100;
    else score -= 700;
  }
  return score;
}
function parseSearch(html, base, info, mediaType) {
  var $ = cheerio().load(String(html || ""));
  var map = {};
  $("a[href]").each(function (_, el) {
    var href = absoluteUrl(base, $(el).attr("href"));
    var m = href.match(/\/(.+?)-(movie|series)-(\d+)\/?(?:[?#].*)?$/i);
    if (!m) return;
    if (map[href]) return;
    var context = candidateText($, el);
    map[href] = {
      url: href,
      type: m[2].toLowerCase(),
      title: titleFromAnchor($, el, href),
      year: parseYear(context),
      context: context
    };
  });
  var items = Object.keys(map).map(function (k) { return map[k]; });
  items.forEach(function (x) { x.score = scoreSearchCandidate(x, info, mediaType); });
  items.sort(function (a, b) { return b.score - a.score; });
  return items.filter(function (x) { return x.score > 0; });
}
function findDetail(info, mediaType) {
  var queries = unique([info.title].concat(info.aliases || []));
  function tryBase(bi) {
    if (bi >= BASES.length) return Promise.resolve(null);
    var base = BASES[bi];
    function tryQuery(qi) {
      if (qi >= queries.length) return tryBase(bi + 1);
      var q = queries[qi];
      var url = base + "/?s=" + encodeURIComponent(q);
      return fetchText(url, { headers: { "Referer": base + "/" } }).then(function (html) {
        var items = parseSearch(html, base, info, mediaType);
        var best = items[0] || null;
        console.log("[4KHDHub] search host=" + base + " query='" + q + "' items=" + items.length + " match=" + (best ? "yes" : "no"));
        if (best) return { base: base, item: best };
        return tryQuery(qi + 1);
      }).catch(function (e) {
        console.log("[4KHDHub] search fail host=" + base + " error=" + (e && e.message ? e.message : String(e)));
        return tryQuery(qi + 1);
      });
    }
    return tryQuery(0);
  }
  return tryBase(0);
}

function linksFromBlock($, el, base) {
  var out = [];
  $(el).find("a[href]").each(function (_, a) {
    var href = absoluteUrl(base, $(a).attr("href"));
    if (/^https?:\/\//i.test(href)) out.push(href);
  });
  return unique(out);
}
function parseMovieBlocks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var blocks = [];
  $("div.download-item").each(function (_, el) {
    var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
    var links = linksFromBlock($, el, detailUrl);
    if (!links.length) return;
    blocks.push({ text: text, quality: qualityFromText(text), links: links });
  });
  if (!blocks.length) {
    var links = [];
    $("a[href]").each(function (_, a) {
      var href = absoluteUrl(detailUrl, $(a).attr("href"));
      if (/hubcloud|hubdrive/i.test(href)) links.push(href);
    });
    if (links.length) blocks.push({ text: "", quality: "Auto", links: unique(links) });
  }
  return blocks;
}
function parseTvBlocks(html, detailUrl, season, episode) {
  var $ = cheerio().load(String(html || ""));
  var blocks = [];
  $("div.episodes-list div.season-item").each(function (_, sEl) {
    var sText = String($(sEl).find("div.episode-number").text() || $(sEl).text() || "");
    var sm = sText.match(/\bS?0*(\d{1,2})\b/i);
    var s = sm ? Number(sm[1]) : 0;
    if (s !== Number(season)) return;
    $(sEl).find("div.episode-download-item").each(function (_, eEl) {
      var eText = String($(eEl).find("div.episode-file-info span.badge-psa").text() || $(eEl).text() || "");
      var em = eText.match(/Episode-?0*(\d{1,3})/i) || eText.match(/\bE0*(\d{1,3})\b/i);
      var e = em ? Number(em[1]) : 0;
      if (e !== Number(episode)) return;
      var text = String($(eEl).text() || "").replace(/\s+/g, " ").trim();
      var links = linksFromBlock($, eEl, detailUrl);
      if (links.length) blocks.push({ text: text, quality: qualityFromText(text), links: links });
    });
  });
  if (!blocks.length) {
    $("div.download-item").each(function (_, el) {
      var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
      var m = text.match(/\bS0*(\d{1,2})E0*(\d{1,3})\b/i);
      if (!m || Number(m[1]) !== Number(season) || Number(m[2]) !== Number(episode)) return;
      var links = linksFromBlock($, el, detailUrl);
      if (links.length) blocks.push({ text: text, quality: qualityFromText(text), links: links });
    });
  }
  return blocks;
}
function blockScore(b, targetQuality) {
  var t = String(b.text || "").toLowerCase();
  var q = String(b.quality || "Auto");
  var score = 0;

  if (targetQuality && q === targetQuality) score += 1000;
  if (/web-dl/.test(t)) score += 100;
  if (/sdr/.test(t)) score += 70;
  if (/av1/.test(t)) score -= 80;
  if (/dv|dolby vision/.test(t)) score -= 35;
  if (/hdr/.test(t) && !/sdr/.test(t)) score -= 10;

  if (q === "2160p") {
    if (/h265|hevc|x265/.test(t)) score += 90;
    if (/h264|x264|avc/.test(t)) score += 35;
  } else {
    if (/h264|x264|avc/.test(t)) score += 120;
    if (/h265|hevc|x265/.test(t)) score += 35;
  }

  return score;
}

function serverScore(url) {
  var u = String(url || "").toLowerCase();
  if (/hubcloud/.test(u)) return 100;
  if (/hubdrive/.test(u)) return 70;
  if (/workers\.dev/.test(u) || mediaLike(u)) return 120;
  return 30;
}

function resolveFourKRedirect(url) {
  if (!/[?&]id=/i.test(url)) return Promise.resolve(url);
  return fetchText(url).then(function (html) {
    var joined = "";
    var re = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var m;
    while ((m = re.exec(html))) joined += m[1] || m[2] || "";
    if (!joined) return url;
    try {
      var first = b64decode(joined);
      var second = b64decode(first);
      var rotated = rot13(second);
      var payload = b64decode(rotated);
      var obj = JSON.parse(payload);
      var direct = b64decode(obj.o || "").trim();
      if (direct) return direct;
      var data = b64decode(obj.data || "").trim();
      var blog = String(obj.blog_url || "").trim();
      if (!data || !blog) return url;
      return fetchText(blog + "?re=" + encodeURIComponent(data)).then(function (x) { return String(x || "").trim() || url; });
    } catch (_) { return url; }
  }).catch(function () { return url; });
}

function decodeWrapperLink(url) {
  var s = String(url || "");
  var m = s.match(/[?&]link=([^&]+)/i);
  if (!m) return s;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function toPixel(url) {
  if (/\/api\/file\//i.test(url)) return url;
  var m = String(url || "").match(/^(https?:\/\/[^/]+)\/(?:u\/)?([^/?#]+)/i);
  return m ? m[1] + "/api/file/" + m[2] + "?download" : url;
}
function headerGet(res, name) {
  try { return String(res && res.headers && res.headers.get ? (res.headers.get(name) || "") : ""); } catch (_) { return ""; }
}
function contentTotalBytes(res) {
  var cr = headerGet(res, "content-range");
  var m = cr.match(/\/(\d+)\s*$/);
  if (m) return Number(m[1]) || 0;
  var cl = Number(headerGet(res, "content-length") || 0);
  return isFinite(cl) ? cl : 0;
}
function inspectMediaResponse(res, originalUrl) {
  var ct = headerGet(res, "content-type").toLowerCase().split(";")[0].trim();
  var cd = headerGet(res, "content-disposition").toLowerCase();
  var finalUrl = String((res && res.url) || originalUrl || "");
  var total = contentTotalBytes(res);
  var okStatus = !!res && res.status >= 200 && res.status < 400;
  var isText = /^(text\/html|text\/plain|application\/json|application\/javascript)/.test(ct);
  var isManifest = /mpegurl|dash\+xml/.test(ct) || /\.(m3u8|mpd)(?:$|[?#])/i.test(finalUrl);
  var mediaType = /^video\//.test(ct) || /octet-stream|matroska|mp4/.test(ct);
  var attachment = /attachment/.test(cd);
  var fileLike = mediaLike(finalUrl);
  var sizeOk = !total || total >= 10 * 1024 * 1024 || isManifest;
  var playable = okStatus && !isText && sizeOk && (isManifest || mediaType || attachment || fileLike);
  return { playable: playable, url: finalUrl, type: ct, total: total };
}
function rangeProbe(url, referer) {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Range": "bytes=0-1",
      "Referer": referer || ""
    }
  }).then(function (res) {
    var x = inspectMediaResponse(res, url);
    console.log("[4KHDHub] range probe host=" + hostOf(url) + " status=" + res.status + " type=" + x.type + " MB=" + (x.total ? Math.round(x.total / 1048576) : "?") + " playable=" + x.playable);
    return x.playable ? x.url : null;
  });
}
function probeFinal(url, referer) {
  return fetch(url, {
    method: "HEAD",
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Referer": referer || ""
    }
  }).then(function (res) {
    var x = inspectMediaResponse(res, url);
    console.log("[4KHDHub] head probe host=" + hostOf(url) + " status=" + res.status + " type=" + x.type + " MB=" + (x.total ? Math.round(x.total / 1048576) : "?") + " playable=" + x.playable);
    if (x.playable) return x.url;
    if (/^(text\/html|application\/json)/.test(x.type)) return null;
    return rangeProbe(url, referer).catch(function () { return null; });
  }).catch(function () {
    return rangeProbe(url, referer).catch(function (e) {
      console.log("[4KHDHub] probe fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
      return null;
    });
  });
}

function collectAnchors(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  $("a[href]").each(function (_, a) {
    var href = absoluteUrl(base, $(a).attr("href"));
    if (!/^https?:\/\//i.test(href)) return;
    var label = String($(a).text() || $(a).attr("download") || "Server").replace(/\s+/g, " ").trim();
    out.push({ url: href, label: label });
  });
  var raw = String(html || "").match(/https?:\/\/[^\s'"<>\\]+/g) || [];
  raw.forEach(function (u) {
    u = u.replace(/\\\//g, "/").replace(/[),;]+$/, "");
    if (/workers\.dev|hubcdn\.fans/i.test(u)) out.push({ url: u, label: "Direct" });
  });
  var seen = {};
  return out.filter(function (x) {
    if (!x.url || seen[x.url]) return false;
    seen[x.url] = 1; return true;
  });
}
function buttonScore(x) {
  var u = String(x.url || "").toLowerCase();
  var l = String(x.label || "").toLowerCase();
  if (/workers\.dev/.test(u)) return 1000;
  if (/pixeldrain|pixelserver/.test(u + " " + l)) return 950;
  if (/10gbps|fsl server|download file|s3 server|fslv2|mega server|pdl server/.test(l)) return 900;
  if (mediaLike(u)) return 880;
  if (/hubcdn\.fans/.test(u)) return 850;
  if (/buzzserver/.test(l)) return 820;
  if (/hubcdn/.test(u)) return 700;
  if (/hblinks/.test(u)) return 650;
  if (/hubdrive/.test(u)) return 500;
  return 100;
}

function resolveHubCdn(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }).then(function (html) {
    var m = String(html).match(/reurl\s*=\s*["']([^"']+)/i);
    var encoded = m && m[1] ? String(m[1]).split("?r=")[1] : "";
    if (!encoded) {
      m = String(html).match(/[?&]r=([A-Za-z0-9+/=]+)/);
      encoded = m ? m[1] : "";
    }
    var decoded = b64decode(encoded || "");
    var link = decoded ? decoded.substring(decoded.lastIndexOf("link=") + 5) : "";
    if (!link || link === decoded && decoded.indexOf("link=") < 0) return null;
    return probeFinal(link, url).then(function (p) { return p || null; });
  }).catch(function () { return null; });
}

function resolveHblinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }).then(function (html) {
    var links = collectAnchors(html, url).map(function (x) { return x.url; }).filter(function (u) {
      return /hubcloud|hubdrive|hubcdn|workers\.dev|pixeldrain|hdstream4u|hubstream/i.test(u) || mediaLike(u);
    });
    return resolveCandidates(links.slice(0, 4), url);
  }).catch(function () { return null; });
}

function resolveHubDrive(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || BASES[0] + "/" } }).then(function (html) {
    var links = collectAnchors(html, url).map(function (x) { return x.url; }).filter(function (u) {
      return u !== url && (/hubcloud|hubcdn|hblinks|workers\.dev|pixeldrain|hdstream4u|hubstream/i.test(u) || mediaLike(u));
    });
    console.log("[4KHDHub] HubDrive candidates=" + links.length);
    return resolveCandidates(links.slice(0, 5), url);
  }).catch(function (e) {
    console.log("[4KHDHub] HubDrive fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveHubCloud(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || BASES[0] + "/" } }).then(function (landingHtml) {
    var $ = cheerio().load(String(landingHtml || ""));
    var next = String($("#download[href]").first().attr("href") || $("a[href*='hubcloud.php']").first().attr("href") || "").trim();
    if (!next) {
      var m = String(landingHtml).match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i) || String(landingHtml).match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
      next = m ? m[1] : "";
    }
    next = next ? absoluteUrl(url, next) : url;
    var pagePromise = next === url ? Promise.resolve(landingHtml) : fetchText(next, { headers: { "Referer": url } });
    return pagePromise.then(function (html) {
      var buttons = collectAnchors(html, next).sort(function (a, b) { return buttonScore(b) - buttonScore(a); });
      console.log("[4KHDHub] HubCloud buttons=" + buttons.length + " host=" + hostOf(next));
      function tryButton(i) {
        if (i >= buttons.length || i >= 6) return Promise.resolve(null);
        var x = buttons[i];
        var u = x.url;
        var l = String(x.label || "").toLowerCase();
        if (/privacy|contact|home|login|telegram|discord|4khdhub/i.test(l) && !/download|server|10gbps/.test(l)) return tryButton(i + 1);
        if (/workers\.dev/i.test(u) || mediaLike(u)) {
          return probeFinal(u, next).then(function (p) {
            return p ? { url: p, referer: /workers\.dev/i.test(u) ? "" : next, label: x.label || "Direct" } : tryButton(i + 1);
          });
        }
        if (/pixeldrain|pixelserver/i.test(u + " " + l)) {
          var pixel = toPixel(u);
          return probeFinal(pixel, next).then(function (p) {
            return p ? { url: p, referer: next, label: "PixelDrain" } : tryButton(i + 1);
          });
        }
        if (/hubcdn\.fans/i.test(u)) {
          return probeFinal(u, next).then(function (p) { return p ? { url: p, referer: "", label: "Fast 10Gbps" } : tryButton(i + 1); });
        }
        if (/hubcdn/i.test(u)) {
          return resolveHubCdn(u, next).then(function (p) { return p ? { url: p, referer: u, label: "HubCDN" } : tryButton(i + 1); });
        }
        if (/hblinks/i.test(u)) {
          return resolveHblinks(u, next).then(function (p) { return p ? p : tryButton(i + 1); });
        }
        if (/hubdrive/i.test(u)) {
          return resolveHubDrive(u, next).then(function (p) { return p ? p : tryButton(i + 1); });
        }
        var unwrapped = decodeWrapperLink(u);
        if (/buzzserver/.test(l) && !/\/download(?:$|[?#])/i.test(unwrapped)) unwrapped = unwrapped.replace(/\/$/, "") + "/download";
        if (/10gbps|fsl server|download file|s3 server|fslv2|mega server|pdl server|buzzserver/.test(l)) {
          return probeFinal(unwrapped, next).then(function (p) { return p ? { url: p, referer: next, label: x.label || "Direct" } : tryButton(i + 1); });
        }
        return tryButton(i + 1);
      }
      return tryButton(0);
    });
  }).catch(function (e) {
    console.log("[4KHDHub] HubCloud fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveServer(url, referer) {
  url = String(url || "").trim();
  if (!url) return Promise.resolve(null);
  return resolveFourKRedirect(url).then(function (resolved) {
    resolved = String(resolved || url);
    if (/workers\.dev/i.test(resolved) || mediaLike(resolved)) {
      return probeFinal(resolved, referer).then(function (p) {
        return p ? { url: p, referer: /workers\.dev/i.test(resolved) ? "" : (referer || ""), label: "Direct" } : null;
      });
    }
    if (/pixeldrain/i.test(resolved)) {
      var pixel = toPixel(resolved);
      return probeFinal(pixel, referer).then(function (p) {
        return p ? { url: p, referer: referer || "", label: "PixelDrain" } : null;
      });
    }
    if (/hubcloud/i.test(resolved)) return resolveHubCloud(resolved, referer);
    if (/hubdrive/i.test(resolved)) return resolveHubDrive(resolved, referer);
    if (/hubcdn/i.test(resolved)) return resolveHubCdn(resolved, referer).then(function (p) { return p ? { url: p, referer: resolved, label: "HubCDN" } : null; });
    if (/hblinks/i.test(resolved)) return resolveHblinks(resolved, referer);
    return probeFinal(resolved, referer).then(function (p) { return p ? { url: p, referer: referer || "", label: hostOf(resolved) } : null; });
  });
}
function resolveCandidates(links, referer) {
  links = unique(links).sort(function (a, b) { return serverScore(b) - serverScore(a); });
  function next(i) {
    if (i >= links.length) return Promise.resolve(null);
    return resolveServer(links[i], referer).then(function (r) { return r || next(i + 1); }).catch(function () { return next(i + 1); });
  }
  return next(0);
}

function buildStream(result, quality, detailUrl) {
  return {
    name: PROVIDER,
    title: "4KHDHub • " + displayQuality(quality) + " • " + (result.label || hostOf(result.url)),
    url: result.url,
    quality: displayQuality(quality),
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Referer": result.referer || detailUrl
    }
  };
}

function resolveOneQuality(blocks, targetQuality, detailUrl) {
  var matches = (blocks || []).filter(function (b) {
    return String(b.quality || "") === targetQuality;
  }).sort(function (a, b) {
    return blockScore(b, targetQuality) - blockScore(a, targetQuality);
  }).slice(0, QUALITY_TASK_LIMIT);

  if (!matches.length) {
    console.log("[4KHDHub] quality " + displayQuality(targetQuality) + " unavailable");
    return Promise.resolve(null);
  }

  console.log(
    "[4KHDHub] quality " + displayQuality(targetQuality) +
    " candidates=" + matches.length
  );

  function tryBlock(i) {
    if (i >= matches.length) return Promise.resolve(null);
    var b = matches[i];
    var links = b.links.slice().sort(function (a, c) {
      return serverScore(c) - serverScore(a);
    });

    console.log(
      "[4KHDHub] try quality=" + displayQuality(targetQuality) +
      " block=" + (i + 1) +
      " servers=" + links.map(hostOf).join("|")
    );

    return resolveCandidates(links, detailUrl).then(function (r) {
      if (!r || !r.url) return tryBlock(i + 1);

      console.log(
        "[4KHDHub] READY host=" + hostOf(r.url) +
        " q=" + displayQuality(targetQuality) +
        " label='" + (r.label || "Direct") + "'"
      );

      return buildStream(r, targetQuality, detailUrl);
    }).catch(function () {
      return tryBlock(i + 1);
    });
  }

  return tryBlock(0);
}

function resolveBlocks(blocks, detailUrl) {
  var targets = ["2160p", "1080p", "720p"];
  var available = targets.filter(function (q) {
    return (blocks || []).some(function (b) { return b.quality === q; });
  });

  console.log(
    "[4KHDHub] blocks=" + (blocks || []).length +
    " available=" + available.map(displayQuality).join(",")
  );

  if (!available.length) {
    /* Keep compatibility for older posts with only Auto/unknown quality. */
    var fallback = (blocks || []).slice().sort(function (a, b) {
      return blockScore(b) - blockScore(a);
    }).slice(0, 2);

    function fallbackNext(i) {
      if (i >= fallback.length) return Promise.resolve([]);
      return resolveCandidates(fallback[i].links, detailUrl).then(function (r) {
        if (!r || !r.url) return fallbackNext(i + 1);
        var q = fallback[i].quality || "Auto";
        return [buildStream(r, q, detailUrl)];
      }).catch(function () { return fallbackNext(i + 1); });
    }
    return fallbackNext(0);
  }

  var ready = [];
  var pending = available.length;
  var firstResolved = false;
  var resolveFirst;
  var resolveAll;

  var firstGood = new Promise(function (resolve) { resolveFirst = resolve; });
  var allDone = new Promise(function (resolve) { resolveAll = resolve; });

  available.forEach(function (q) {
    resolveOneQuality(blocks, q, detailUrl).then(function (stream) {
      if (stream) {
        ready.push(stream);
        if (!firstResolved) {
          firstResolved = true;
          resolveFirst(true);
        }
      }
    }).catch(function () {
      /* One slow/broken quality must not hold the other qualities. */
    }).then(function () {
      pending--;
      if (pending <= 0) resolveAll(true);
    });
  });

  var grace = firstGood.then(function () {
    return new Promise(function (resolve) {
      setTimeout(resolve, MULTI_FIRST_GRACE_MS);
    });
  });

  var absolute = new Promise(function (resolve) {
    setTimeout(resolve, MULTI_ABSOLUTE_MS);
  });

  return Promise.race([allDone, grace, absolute]).then(function () {
    var rank = { "4K": 3, "1080p": 2, "720p": 1 };
    var seen = {};
    var finalStreams = ready.filter(function (s) {
      if (!s || !s.url || seen[s.quality]) return false;
      seen[s.quality] = true;
      return true;
    }).sort(function (a, b) {
      return (rank[b.quality] || 0) - (rank[a.quality] || 0);
    });

    console.log(
      "[4KHDHub] multi-quality ready=" +
      finalStreams.map(function (s) { return s.quality + ":" + hostOf(s.url); }).join(",")
    );

    return finalStreams;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);
  var startedAt = Date.now();
  console.log("[4KHDHub] v" + VERSION + " TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : ""));
  var info;
  var detail;
  return tmdbDetails(tmdbId, mediaType)
    .then(function (d) {
      info = tmdbInfo(d || {}, mediaType);
      console.log("[4KHDHub] title='" + info.title + "' year=" + info.year);
      if (!info.title) return null;
      return findDetail(info, mediaType);
    })
    .then(function (found) {
      if (!found || !found.item) {
        console.log("[4KHDHub] title not found");
        return [];
      }
      detail = found.item;
      console.log("[4KHDHub] matched title='" + detail.title + "' year=" + (detail.year || "?") + " url=" + detail.url);
      return fetchText(detail.url, { headers: { "Referer": found.base + "/" } }).then(function (html) {
        var blocks = mediaType === "tv" ? parseTvBlocks(html, detail.url, season, episode) : parseMovieBlocks(html, detail.url);
        if (mediaType === "tv") console.log("[4KHDHub] episode blocks=" + blocks.length);
        return resolveBlocks(blocks, detail.url);
      });
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[4KHDHub] v" + VERSION + " playable sources=" + streams.length + " elapsed=" + (Date.now() - startedAt) + "ms");
      return streams;
    })
    .catch(function (e) {
      console.log("[4KHDHub] error=" + (e && e.message ? e.message : String(e)));
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
module.exports = cloudbankDisplayInstall(module.exports, "4KHDHub", "4khdhub");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
