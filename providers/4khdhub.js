// 4KHDHub 1.9.0: one bounded engine, audited site flow.
/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_PROVIDER_REPAIR_V17 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
/* FOURK_MEMORY_SCOPE_GUARD_V1 */
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
        original_language: raw.originalLanguage || raw.original_language || '',
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

/* VUEO_TITLE_PROFILE_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
/* FOURK_MEMORY_SCOPE_GUARD_V1 */
function buildTitleProfile(d) {
  var titles = [d.title || d.name, d.original_title || d.original_name];
  var alternatives = d.alternative_titles || {};
  (alternatives.titles || alternatives.results || []).forEach(function(x) { titles.push(x.title); });
  return { aliases: titles.filter(function(x, i) { return x && titles.indexOf(x) === i; }) };
}
function fourKState() { return { active: true, deadline: Date.now() + 18300, requests: [], cache: Object.create(null) }; }
function fourKStop(state) {
  state.active = false;
  state.requests.slice().forEach(function(cancel) { cancel(); });
}
function fourKEngine(state) {
const PROVIDER = '4KHDHub', VERSION = '1.9.0';
const BASES = ['https://4khdhub.one', 'https://4khdhub.fans'];
const TMDB_BASE = 'https://api.themoviedb.org/3', TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';
function log(message) { if (state.active) console.log('[4KHDHub] ' + message); }
function header(res, key) { try { return String(res.headers.get(key) || ''); } catch (_) { return ''; } }
function fetchResp(url, options) {
  if (!state.active || Date.now() >= state.deadline) return Promise.reject(Error('deadline'));
  var opts = Object.assign({}, options || {});
  opts.headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
  var key = String(opts.method || 'GET') + ' ' + url;
  if (state.cache[key]) return state.cache[key];
  var task = new Promise(function(resolve, reject) {
    var done = false, controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) opts.signal = controller.signal;
    function finish(error, value) {
      if (done) return; done = true; clearTimeout(timer);
      var at = state.requests.indexOf(cancel); if (at >= 0) state.requests.splice(at, 1);
      if (error) { if (controller) controller.abort(); reject(error); } else resolve(value);
    }
    function cancel() { finish(Error('cancelled')); }
    var timer = setTimeout(function() { finish(Error('request timeout')); }, Math.min(5500, state.deadline - Date.now()));
    state.requests.push(cancel);
    Promise.resolve().then(function() { if (!state.active || done) throw Error('stopped'); return fetch(url, opts); }).then(function(res) {
      if (done || !state.active) throw Error('stopped');
      var type = header(res, 'content-type').toLowerCase();
      var result = { status: res.status, ok: res.ok, url: res.url || url, headers: res.headers, text: '' };
      // Read only small HTML/manifest/JSON bodies. File probes never consume a video body.
      if (opts.method === 'HEAD' || opts.headers.Range || /^video\//.test(type) || /octet-stream|matroska/.test(type)) {
        if (res.body && typeof res.body.cancel === 'function') Promise.resolve(res.body.cancel()).catch(function() {});
        finish(null, result); return;
      }
      return res.text().then(function(text) { result.text = text; finish(null, result); });
    }).catch(function(e) { finish(e); });
  });
  state.cache[key] = task;
  return task;
}
function fetchText(url, options) { return fetchResp(url, options).then(function(x) { if (!x.ok) throw Error('HTTP ' + x.status); return x.text; }); }
function fetchJson(url, options) { return fetchText(url, options).then(function(t) { return JSON.parse(t); }); }
function cheerio() { return require("cheerio-without-node-native"); }

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
  return m ? m[1] + "p" : /\b4k\b/i.test(v || "") ? "2160p" : "Unknown";
}
function displayQuality(q) {
  q = String(q || "Unknown");
  return q === "2160p" ? "4K" : q;
}
function mediaLike(url) {
  var clean = String(url || "").split("?")[0].toLowerCase();
  return /\.(mkv|mp4|m3u8|mpd|webm|m4v)$/.test(clean);
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
  var url = TMDB_BASE + '/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  var raw = typeof globalThis !== 'undefined' ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
  if (typeof raw === 'string') { try { raw=JSON.parse(raw); } catch (_) { raw=null; } }
  var contextId=raw && (raw.tmdbId || raw.tmdb && raw.tmdb.id);
  if (contextId && String(contextId)!==String(tmdbId)) return fetchJson(url);
  return vueoSharedTmdb(url, function() { return fetchJson(url); });
}
function tmdbInfo(d, mediaType) {
  var profile = buildTitleProfile(d), tv = mediaType === 'tv';
  return { title: String(tv ? d.name || d.original_name || '' : d.title || d.original_title || '').trim(),
    aliases: profile.aliases, year: parseYear(tv ? d.first_air_date : d.release_date), language: d.original_language || '' };
}
function buildDiscoveryQueries4K(info) { return unique([info.title].concat(info.aliases || [])).slice(0, 3); }
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
  if (c.type !== (mediaType === 'tv' ? 'series' : 'movie')) return -9999;
  if (!normalizeTitle(c.title) || !(info.aliases || [info.title]).some(function(a) { return normalizeTitle(a) === normalizeTitle(c.title); })) return -9999;
  if (c.year && info.year && c.year !== info.year) return -9999;
  return c.year === info.year ? 1500 : 1000;
}
function parse4KSearchCards(html, base, info, mediaType) {
  var $ = cheerio().load(String(html || ""));
  var map = {};
  $("a[href]").each(function (_, el) {
    var href = absoluteUrl(base, $(el).attr("href"));
    var m = href.match(/\/(.+?)-(movie|series)-(\d+)\/?(?:[?#].*)?$/i);
    var card = $(el).closest('.movie-card');
    var format = String(card.find('.movie-card-format').text() || '').toLowerCase();
    var cardType = /series/.test(format) ? 'series' : /movies?/.test(format) ? 'movie' : '';
    if (!m && !cardType) return;
    if (map[href]) return;
    var context = candidateText($, el);
    map[href] = {
      url: href,
      type: m ? m[2].toLowerCase() : cardType,
      title: String(card.find(".movie-card-title").text() || "").trim() || titleFromAnchor($, el, href),
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
  var queries = buildDiscoveryQueries4K(info);
  var bases = BASES;
  var deadline = state.deadline;
  function tryBase(bi) {
    if (bi >= bases.length || Date.now() >= deadline) return Promise.resolve(null);
    var base = bases[bi];
    function tryQuery(qi) {
      if (Date.now() >= deadline) return Promise.resolve(null);
      if (qi >= queries.length) return tryBase(bi + 1);
      var q = queries[qi];
      var url = base + "/?s=" + encodeURIComponent(q);
      return fetchText(url, { headers: { "Referer": base + "/" } }).then(function (html) {
        var items = parse4KSearchCards(html, base, info, mediaType);
        var best = items[0] || null;
        console.log("[4KHDHub] search host=" + base + " query='" + q + "' items=" + items.length + " match=" + (best ? "yes" : "no"));
        if (best) return { base: base, item: best };
        return tryQuery(qi + 1);
      }).catch(function (e) {
        log("search failed " + hostOf(base));
        return tryQuery(qi + 1);
      });
    }
    return tryQuery(0);
  }
  return tryBase(0);
}

function extractCandidateUrlsFromHtml($, el, base) {
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
    var links = extractCandidateUrlsFromHtml($, el, detailUrl);
    if (!links.length) return;
    blocks.push({ text: text, quality: qualityFromText(text), links: links });
  });
  if (!blocks.length) {
    var links = [];
    $("a[href]").each(function (_, a) {
      var href = absoluteUrl(detailUrl, $(a).attr("href"));
      if (/hubcloud|hubdrive|hblinks|hubstream\.dad/i.test(href)) links.push(href);
    });
    if (links.length) blocks.push({ text: "", quality: "Unknown", links: unique(links) });
  }
  return blocks;
}
function parseTvBlocks(html, detailUrl, season, episode) {
  var $ = cheerio().load(String(html || ""));
  var blocks = [];
  $("div.episodes-list div.season-item").each(function (_, sEl) {
    var sText = String($(sEl).find("div.episode-number").text() || $(sEl).text() || "");
    var sm = sText.match(/\b(?:Season\s*|S)0*(\d{1,2})\b/i) || sText.trim().match(/^0*(\d{1,2})$/);
    var s = sm ? Number(sm[1]) : 0;
    if (s !== Number(season)) return;
    $(sEl).find("div.episode-download-item").each(function (_, eEl) {
      var eText = String($(eEl).find("div.episode-file-info span.badge-psa").text() || $(eEl).text() || "");
      var em = eText.match(/Episode-?0*(\d{1,3})/i) || eText.match(/\bE0*(\d{1,3})\b/i);
      var e = em ? Number(em[1]) : 0;
      if (e !== Number(episode)) return;
      var text = String($(eEl).text() || "").replace(/\s+/g, " ").trim();
      var links = extractCandidateUrlsFromHtml($, eEl, detailUrl);
      if (links.length) blocks.push({ text: text, quality: qualityFromText(text), links: links });
    });
  });
  if (!blocks.length) {
    $("div.download-item").each(function (_, el) {
      var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
      var m = text.match(/\bS0*(\d{1,2})E0*(\d{1,3})\b/i);
      if (!m || Number(m[1]) !== Number(season) || Number(m[2]) !== Number(episode)) return;
      var links = extractCandidateUrlsFromHtml($, el, detailUrl);
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


function cleanUrl(value, base) {
  try { var u = new URL(String(value || '').trim(), base || undefined); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; }
}
function decodeGate(html) {
  var pieces = [], re = /s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g, m;
  while ((m = re.exec(html))) pieces.push(m[1] || m[2] || '');
  if (!pieces.length) return null;
  try {
    var obj = JSON.parse(b64decode(rot13(b64decode(b64decode(pieces.join(''))))));
    var direct = cleanUrl(b64decode(obj.o || ''));
    if (direct) return { url: direct };
    var data = b64decode(obj.data || ''), blog = cleanUrl(obj.blog_url);
    return data && blog ? { url: blog + '?re=' + encodeURIComponent(data), plainRedirect: true } : null;
  } catch (_) { return null; }
}
function looksPlayable(page) {
  var ct = header(page, 'content-type').toLowerCase(), cd = header(page, 'content-disposition');
  if (!page.ok || /html|json|javascript|text\/plain/.test(ct)) return false;
  return /^video\//.test(ct) || /octet-stream|matroska|mpegurl|dash\+xml/.test(ct) || /attachment/i.test(cd) && /\.(mkv|mp4|webm|m4v)/i.test(cd);
}
function deadPage(html) {
  return /file (?:not found|has been (?:deleted|removed))|file you are trying to access cannot be found|no such (?:key|file)|<Code>NoSuchKey<\/Code>/i.test(html);
}
function mediaFilename(text) {
  var m = /([^/\r\n<>]+\.(?:mkv|mp4|webm|m4v))\b/i.exec(text || ''); return m ? m[1].trim() : '';
}
function validEpisode(text, release) {
  if (release.season == null) return true;
  var re = /\bS0*(\d{1,2})[ ._-]*E0*(\d{1,4})\b/ig, m;
  while ((m = re.exec(text || ''))) if (Number(m[1]) !== release.season || Number(m[2]) !== release.episode) return false;
  return true;
}
function pageCandidates(html, base) {
  var $ = cheerio().load(html), out = [];
  function add(href, label, force) {
    var url = cleanUrl(href, base); if (!url || url === base || /telegram|t\.me|discord|tinyurl|winexch/i.test(hostOf(url))) return;
    var known = /(?:hubcloud|hubdrive|hblinks|hubstream|hubcdn|pixeldrain|pixelserver|gpdl|greenmotors|workers\.dev|r2\.cloudflarestorage\.com)/i.test(hostOf(url));
    if (force || known || mediaLike(url)) out.push({ url: url, label: label || hostOf(url) });
  }
  // The current gpdl landing page assigns its query link to downloadBtn in public JavaScript.
  if (/params\.get\(\s*['"]link['"]\s*\)/.test(html) && /downloadBtn/.test(html)) {
    try { add(new URL(base).searchParams.get('link'), '10Gbps', true); } catch (_) {}
  }
  var gate = decodeGate(html); if (gate) add(gate.url, 'Gate', true);
  var redirect = /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]|location\.(?:replace|assign)\(\s*['"]([^'"]+)['"]|\b(?:var|let|const)\s+url\s*=\s*['"]([^'"]+)['"]/g, m;
  while ((m = redirect.exec(html))) add((m[1] || m[2] || m[3]).replace(/\\\//g, '/'), 'Continue', true);
  $('meta[http-equiv]').each(function(_, el) { if (/refresh/i.test($(el).attr('http-equiv') || '')) { var m = /url\s*=\s*['"]?([^'"]+)/i.exec($(el).attr('content') || ''); if (m) add(m[1], 'Continue', true); } });
  $('a[href]').each(function(_, el) {
    var a = $(el), label = a.text().replace(/\s+/g, ' ').trim(), href = a.attr('href');
    if (/telegram|how to|tutorial|privacy|contact|login|copyright/i.test(label)) return;
    var forced = a.attr('id') === 'download' || /hubcloud\.php|[?&]link=/.test(href || '') && /download|server|gbps/i.test(label);
    add(href, label, forced);
  });
  // HubCDN's reurl value is a public redirect, not a media response.
  var rr = /\breurl\s*=\s*['"]([^'"]+)/i.exec(html);
  if (rr) {
    var q = /[?&]r=([^&]+)/.exec(rr[1]);
    if (q) { var decoded = b64decode(q[1]), link = /(?:^|[?&])link=(.+)$/.exec(decoded); if (link) add(link[1], 'HubCDN', true); }
  }
  var seen = {};
  return out.filter(function(x) { if (seen[x.url]) return false; seen[x.url] = true; return true; }).sort(function(a, b) { return rank(b) - rank(a); });
}
function rank(x) {
  if (/workers\.dev/.test(hostOf(x.url))) return 1100;
  if (/r2\.cloudflarestorage\.com/.test(hostOf(x.url))) return 1000;
  if (mediaLike(x.url)) return 950;
  if (/gpdl|fsl|10gbps|download file/i.test(x.label + ' ' + hostOf(x.url))) return 900;
  if (/hubcloud/.test(hostOf(x.url))) return 800;
  if (/hubdrive/.test(hostOf(x.url))) return 200;
  if (x.label === 'Gate' || x.label === 'Continue') return 1200;
  return 500;
}
async function resolveServer(url, referer, release, depth, path) {
  url = cleanUrl(url, referer); depth = depth || 0; path = path || [];
  if (!url || !state.active || Date.now() >= state.deadline || depth > 7 || path.indexOf(url) >= 0) return null;
  path = path.concat(url);
  var isManifest = /\.m3u8(?:$|[?#])/i.test(url), host = hostOf(url), page;
  var headers = { Referer: referer || '', 'User-Agent': UA };
  try {
    // A file host is not a video URL by itself. Known file paths are checked without downloading the file.
    if (!isManifest && (mediaLike(url) || /workers\.dev|r2\.cloudflarestorage\.com|googleusercontent\.com|pixeldrain|pixel\.hubcloud/i.test(host))) {
      if (/pixeldrain\.[^/]+\/u\//i.test(url)) url = url.replace(/\/u\/([^/?#]+).*/, '/api/file/$1?download');
      page = await fetchResp(url, { method: 'HEAD', headers: headers });
      if ((page.status === 403 || page.status === 405) && /workers\.dev|r2\.cloudflarestorage\.com/.test(host)) {
        page = await fetchResp(url, { headers: Object.assign({}, headers, { Range: 'bytes=0-1' }) });
      }
      if (looksPlayable(page)) {
        var name = decodeURIComponent(String(page.url || url).split('?')[0]);
        if (!validEpisode(name + ' ' + header(page, 'content-disposition'), release)) { log('host filename mismatches episode'); return null; }
        return { url: page.url, referer: /workers\.dev|r2\.cloudflarestorage\.com/.test(host) ? '' : referer, label: host,
          mimeType: header(page, 'content-type'), fileName: release.fileName, verified: true };
      }
      if (!page.ok || !/html/i.test(header(page, 'content-type'))) { log('file unavailable host=' + host + ' HTTP=' + page.status); return null; }
    }
    page = await fetchResp(url, { headers: headers });
    if (!page.ok) { log('page failed host=' + host + ' HTTP=' + page.status); return null; }
    if (looksPlayable(page) && !isManifest && !/mpegurl|dash\+xml/i.test(header(page, 'content-type'))) {
      if (!validEpisode(header(page, 'content-disposition') + ' ' + decodeURIComponent(page.url), release)) return null;
      return { url: page.url, referer: referer, label: host, verified: true, mimeType: header(page, 'content-type') };
    }
    if (isManifest || /^\s*#EXTM3U/.test(page.text)) {
      if (!/^\s*#EXTM3U(?:\s|$)/.test(page.text)) return null;
      return { url: page.url, referer: referer, label: host, isHls: true, isMaster: /#EXT-X-STREAM-INF:/.test(page.text), mimeType: 'application/vnd.apple.mpegurl', verified: true };
    }
    if (deadPage(page.text)) { log('file missing host=' + host); return null; }
    var $ = cheerio().load(page.text), fileText = $('h4,h5,.card-header,.file-name').text();
    if (!validEpisode(fileText, release)) { log('page filename mismatches episode'); return null; }
    var direct = cleanUrl(page.text.trim());
    var options = direct ? [{url:direct,label:'Continue'}] : pageCandidates(page.text, page.url);
    log('resolve host=' + host + ' candidates=' + options.length);
    for (var i = 0; i < Math.min(options.length, 5) && state.active && Date.now() < state.deadline; i++) {
      var next = options[i].url, wrapped;
      try { wrapped = new URL(next).searchParams.get('link'); } catch (_) {}
      if (wrapped && cleanUrl(wrapped)) next = cleanUrl(wrapped);
      if (/buzzserver/i.test(options[i].label) && !/\/download(?:[?#]|$)/.test(next)) next = next.replace(/\/$/, '') + '/download';
      var result = await resolveServer(next, page.url, release, depth + 1, path);
      if (result) { if (result.label === hostOf(result.url)) result.label = options[i].label; return result; }
    }
  } catch (_) { log('request failed host=' + host); }
  return null;
}
function releaseBytes(text) {
  var m = /\b(\d+(?:\.\d+)?)\s*(GB|MB)\b/i.exec(text || '');
  return m ? Number(m[1]) * (/GB/i.test(m[2]) ? 1073741824 : 1048576) : Infinity;
}
function releaseInfo(block, info, type, season, episode) {
  var languages = [], names = {English:'en',Hindi:'hi',Japanese:'ja',Korean:'ko',Chinese:'zh',Tamil:'ta',Telugu:'te',Malay:'ms',Indonesian:'id',French:'fr',German:'de',Spanish:'es'};
  Object.keys(names).forEach(function(name) { if (new RegExp('\\b' + name + '\\b', 'i').test(block.text || '')) languages.push(names[name]); });
  if (languages.length && info.language && languages.indexOf(info.language) < 0) return null;
  if (!languages.length && /\b(?:dubbed|hindi only)\b/i.test(block.text || '')) return null;
  return {quality:block.quality || 'Unknown', fileName:mediaFilename(block.text), audioLanguages:languages,
    season:type === 'tv' ? Number(season) : null, episode:Number(episode)};
}
function buildStream(hit, release) {
  return { name: PROVIDER, title: PROVIDER + ' • ' + (hit.label || hostOf(hit.url)), url:hit.url,
    quality: hit.isMaster ? 'auto' : release.quality, qualitySource:hit.isMaster ? 'manifest' : 'release',
    fileName:hit.isMaster ? '' : release.fileName, audioLanguages:release.audioLanguages, server:hit.label || hostOf(hit.url),
    mimeType:hit.mimeType || '', headers:{'User-Agent':UA, Referer:hit.referer || ''}, subtitles:[],
    playbackVerified:false, sourceVerified:!!hit.verified };
}
async function getStreams(id, type, season, episode) {
  log('v' + VERSION + ' TMDB=' + id + ' type=' + type + (type === 'tv' ? ' S' + season + 'E' + episode : ''));
  var d = await tmdbDetails(id, type); if (!state.active || d && d.id && String(d.id)!==String(id)) return [];
  var info = tmdbInfo(d || {}, type); if (!info.title) return [];
  var found = await findDetail(info, type); if (!found || !state.active) { log('title not found'); return []; }
  log('matched title=' + found.item.title + ' year=' + found.item.year);
  var html = await fetchText(found.item.url, {headers:{Referer:found.base + '/'}});
  var blocks = type === 'tv' ? parseTvBlocks(html,found.item.url,season,episode) : parseMovieBlocks(html,found.item.url);
  var tasks = [], groups = {};
  blocks.forEach(function(block) {
    var release = releaseInfo(block,info,type,season,episode); if (!release) return;
    // Keep small encodes ahead of REMUX; include all release alternatives lazily.
    var key = release.quality; if (!groups[key]) groups[key] = [];
    groups[key].push({block:block,release:release});
  });
  Object.keys(groups).sort(function(a,b) { return parseInt(b) - parseInt(a); }).forEach(function(key) {
    groups[key].sort(function(a,b) {
      var small = releaseBytes(a.block.text) - releaseBytes(b.block.text);
      return small && isFinite(small) ? small : blockScore(b.block,key) - blockScore(a.block,key);
    });
  });
  for(var slot=0;slot<3;slot++) Object.keys(groups).forEach(function(key) {
    var item = groups[key][slot]; if (!item) return;
    // Resolve all HubCloud alternatives before repeating known missing HubDrive copies.
    item.block.links.slice().sort(function(a,b) { return serverScore(b)-serverScore(a); }).forEach(function(url) {
      tasks.push({url:url,release:item.release,linkIndex:item.block.links.indexOf(url)});
    });
  });
  tasks.sort(function(a,b) { return a.linkIndex - b.linkIndex; });
  log('episode/release blocks=' + blocks.length + ' candidate links=' + tasks.length);
  var index = 0, seen = {};
  async function worker() {
    while (state.active && Date.now() < state.deadline && index < tasks.length && state.results.length < 4) {
      var task = tasks[index++];
      var hit = await resolveServer(task.url,found.item.url,task.release,0,[]);
      if (hit && state.active && !seen[hit.url]) { seen[hit.url]=true; state.results.push(buildStream(hit,task.release)); log('source found host=' + hostOf(hit.url)); }
    }
  }
  await Promise.all([worker(),worker()]);
  return state.results;
}
return {getStreams:getStreams, parseSearch:parse4KSearchCards, parseTvBlocks:parseTvBlocks, parseMovieBlocks:parseMovieBlocks,
  resolveServer:resolveServer, pageCandidates:pageCandidates, scoreSearchCandidate:scoreSearchCandidate, releaseInfo:releaseInfo};

}
module.exports = {getStreams:function(id,type,season,episode) {
  type = type === 'series' ? 'tv' : type;
  if (!/^\d+$/.test(String(id || '')) || (type !== 'movie' && type !== 'tv')) return Promise.resolve([]);
  if (type === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
  var state = fourKState(); state.results = [];
  var timer;
  var end = new Promise(function(resolve) { timer=setTimeout(function() { fourKStop(state); resolve(state.results); },Math.max(0,state.deadline-Date.now())); });
  var run = fourKEngine(state).getStreams(String(id),type,Number(season),Number(episode)).catch(function() { return state.results; });
  return Promise.race([run,end]).then(function(rows) {
    clearTimeout(timer); fourKStop(state);
    console.log('[4KHDHub] v1.9.0 sources=' + rows.length);
    return rows;
  });
}};

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
