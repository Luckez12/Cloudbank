// Imported provider: fibwatch; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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


/* VUEO_TITLE_PROFILE_V1 */
function buildTitleProfile(tmdb) {
  var primary = String(tmdb.title || tmdb.name || "").trim();
  var aliases = [];
  function add(value) {
    value = String(value || "").trim();
    if (value && aliases.indexOf(value) === -1) aliases.push(value);
  }
  add(primary);
  add(tmdb.original_title || tmdb.original_name);
  var alternate = tmdb.alternative_titles || {};
  (alternate.titles || alternate.results || []).forEach(function(item) { add(item.title); });
  return { title: primary, aliases: aliases };
}


/* CLOUDBANK_NUVIO_ADAPTER_V1 */
function cloudbankWrapProvider(provider, providerId, supportedTypes) {
  var upstream = provider.getStreams;
  var adapted = {};
  Object.keys(provider).forEach(function(key) { adapted[key] = provider[key]; });
  adapted.getStreams = function(tmdbId, mediaType, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    var type = mediaType === "series" ? "tv" : mediaType;
    if (supportedTypes.indexOf(type) === -1 || !String(tmdbId || "").trim()) return Promise.resolve([]);
    if (type === "tv" && (!Number.isInteger(Number(season)) || Number(season) < 0 ||
        !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(tmdbId);
    args[1] = type;
    if (type === "tv") { args[2] = Number(season); args[3] = Number(episode); }
    return new Promise(function(resolve) {
      var finished = false;
      var timer = setTimeout(function() { finish([]); }, 19000);
      function finish(value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var seen = Object.create(null);
        var streams = Array.isArray(value) ? value.filter(function(stream) {
          if (!stream || typeof stream.url !== "string" || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return false;
          // Preserve separate audio/server entries sharing the same media URL.
          var key = JSON.stringify([stream.url, stream.name, stream.headers, stream.subtitles]);
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }) : [];
        resolve(streams);
      }
      Promise.resolve().then(function() { return upstream.apply(provider, args); }).then(finish, function() { finish([]); });
    });
  };
  return adapted;
}

function cloudbankMetadataFetch(nativeFetch) {
  return function(url, options) {
    var text = typeof url === "string" ? url : url && url.url;
    var match = typeof text === "string" && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(text);
    var method = options && options.method ? String(options.method).toUpperCase() : "GET";
    if (!match || method !== "GET") return nativeFetch(url, options);
    // Shared metadata covers details only; search/find/season/episode requests stay upstream.
    var response;
    return vueoSharedTmdb(text, function() {
      return nativeFetch(url, options).then(function(value) {
        response = value;
        if (!value.ok) throw new Error("TMDB HTTP " + value.status);
        return value.json();
      });
    }).then(function(tmdb) {
      var profile = buildTitleProfile(tmdb);
      if (!profile.title) throw new Error("TMDB title unavailable");
      var body = JSON.stringify(tmdb);
      return {
        ok: true, status: 200, statusText: "OK", url: text,
        headers: response ? response.headers : { get: function(name) {
          return String(name).toLowerCase() === "content-type" ? "application/json" : null;
        } },
        json: function() { return Promise.resolve(JSON.parse(body)); },
        text: function() { return Promise.resolve(body); }
      };
    });
  };
}

(function() {
  var originalModule = { exports: {} };
  var originalRequire = typeof require === "function" ? require : null;
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported embedded module: " + name);
    if (!originalRequire) throw new Error("Runtime module unavailable: " + name);
    return originalRequire(name);
  }
  (function(module, exports, require, fetch, self) {
/* CLOUDBANK_UPSTREAM_SOURCE_START */
const cheerio = require('cheerio-without-node-native');

const DEFAULT_BASE = 'https://fibwatch.art';
const DOMAIN_LIST = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function absolute(base, value) {
  if (!value) return '';
  try { return new URL(value, base).href; } catch (_) { return value; }
}

function getBase() {
  return fetch(DOMAIN_LIST, { headers: { 'User-Agent': UA } })
    .then(r => r.ok ? r.json() : {})
    .then(data => data.fibwatch || DEFAULT_BASE)
    .catch(() => DEFAULT_BASE);
}

function tmdbDetails(id, type) {
  return fetch(`https://api.themoviedb.org/3/${type === 'tv' ? 'tv' : 'movie'}/${id}?api_key=${TMDB_KEY}`, { headers: { 'User-Agent': UA } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`TMDB ${r.status}`)))
    .then(data => ({ title: type === 'tv' ? data.name : data.title, year: Number(((type === 'tv' ? data.first_air_date : data.release_date) || '').slice(0, 4)) || null }));
}

function search(base, title) {
  const url = `${base}/search?keyword=${encodeURIComponent(title)}&page_id=1`;
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': `${base}/`, 'Cookie': 'pop_up_18=yes' } })
    .then(r => r.ok ? r.text() : '')
    .then(html => {
      const $ = cheerio.load(html);
      const results = [];
      $('div.video-thumb').each((_, el) => {
        const card = $(el);
        const a = card.find('a[href]').first();
        const img = card.find('img').first();
        const name = (card.find('p.hptag').text() || img.attr('alt') || '').trim();
        if (a.attr('href') && name) results.push({ url: absolute(base, a.attr('href')), title: name, image: absolute(base, img.attr('src')) });
      });
      return results;
    });
}

function normalize(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function bestMatch(results, title, year) {
  const target = normalize(title);
  let best = null, bestScore = 0;
  for (const item of results) {
    const candidate = normalize(item.title);
    let score = candidate === target ? 2 : (candidate.includes(target) || target.includes(candidate) ? 1 : 0);
    const y = Number((item.title.match(/\b(19|20)\d{2}\b/) || [])[0]);
    if (year && y) score += y === year ? 0.3 : -0.2;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return bestScore >= 1 ? best : null;
}

function findVideoId($) {
  return $('#video-id').attr('value') || $('input#video-id').val() || '';
}

function extractPageStreams(base, pageUrl, title) {
  return fetch(pageUrl, { headers: { 'User-Agent': UA, 'Referer': `${base}/`, 'Cookie': 'pop_up_18=yes' } })
    .then(r => r.ok ? r.text() : '')
    .then(html => {
      const $ = cheerio.load(html);
      const pageTitle = $('meta[property="og:title"]').attr('content') || title;
      const videoId = findVideoId($);
      if (!videoId) {
        const direct = [];
        const videoUrl = html.match(/var\s+VIDEO_URL\s*=\s*["']([^"']+)["']/i);
        if (videoUrl) direct.push({ name: 'FibWatch', title: pageTitle, url: absolute(base, videoUrl[1]), quality: 'Auto', headers: { Referer: pageUrl } });
        return direct;
      }
      return fetch(`${base}/ajax/resolution_switcher.php?video_id=${encodeURIComponent(videoId)}`, { headers: { 'User-Agent': UA, 'Referer': pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Cookie': 'pop_up_18=yes' } })
        .then(r => r.ok ? r.text() : '')
        .then(data => {
          const out = [];
          const text = typeof data === 'string' ? data : JSON.stringify(data);
          const push = (url, label) => {
            const absoluteUrl = absolute(base, url);
            if (/^https?:/i.test(absoluteUrl) && !out.some(s => s.url === absoluteUrl)) out.push({ name: 'FibWatch', title: label || pageTitle, url: absoluteUrl, quality: (label || absoluteUrl).match(/(2160p|1080p|720p|480p|360p|4k)/i)?.[0] || 'Auto', headers: { Referer: pageUrl } });
          };
          try {
            const json = JSON.parse(text);
            const walk = obj => {
              if (!obj) return;
              if (typeof obj === 'string' && /^(https?:)?\/\//i.test(obj) && /\.(m3u8|mp4|mkv)(\?|$)/i.test(obj)) push(obj);
              else if (Array.isArray(obj)) obj.forEach(walk);
              else if (typeof obj === 'object') Object.keys(obj).forEach(k => walk(obj[k]));
            };
            walk(json);
          } catch (_) {
            const re = /(?:https?:)?\\?\/?\\?["']?([^\s"'<>]+\.(?:m3u8|mp4|mkv)(?:\?[^\s"'<>]*)?)/gi;
            let m;
            while ((m = re.exec(text))) push(m[1].replace(/\\\//g, '/'));
          }
          return out;
        });
  });
}

function episodePage(base, seriesUrl, season, episode) {
  return fetch(seriesUrl, { headers: { 'User-Agent': UA, 'Referer': `${base}/`, 'Cookie': 'pop_up_18=yes' } })
    .then(r => r.ok ? r.text() : '')
    .then(html => {
      const $ = cheerio.load(html);
      const videoId = findVideoId($);
      if (!videoId) return null;
      return fetch(`${base}/ajax/episodes.php?video_id=${encodeURIComponent(videoId)}`, {
        headers: { 'User-Agent': UA, 'Referer': seriesUrl, 'Cookie': 'pop_up_18=yes', 'X-Requested-With': 'XMLHttpRequest' }
      }).then(r => r.ok ? r.text() : '').then(body => {
        let data;
        try { data = JSON.parse(body); } catch (_) { data = null; }
        const items = data && (data.episodes || data.data || data.items);
        const episodeText = `s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`;
        if (Array.isArray(items)) {
          const found = items.find(item => {
            const text = `${item.display || ''} ${item.title || ''}`.toLowerCase();
            const match = text.match(/s\s*(\d{1,2})\s*e\s*(\d{1,3})/i);
            if (match) return Number(match[1]) === Number(season) && Number(match[2]) === Number(episode);
            const seasonMatch = text.match(/\bseason\s*(\d+)\b/i);
            const episodeMatch = text.match(/\bepisode\s*(\d+)\b/i);
            return Number(seasonMatch && seasonMatch[1]) === Number(season) && Number(episodeMatch && episodeMatch[1]) === Number(episode);
          });
          if (found && found.url) return absolute(base, found.url);
        }
        const $episodes = cheerio.load(body);
        let href = null;
        $episodes('a[href], .video-wrapper a[href]').each((_, el) => {
          if (href) return;
          const text = `${$episodes(el).text()} ${$episodes(el).attr('title') || ''}`.toLowerCase();
          const match = text.match(/s\s*(\d{1,2})\s*e\s*(\d{1,3})/i);
          const seasonMatch = text.match(/\bseason\s*(\d+)\b/i);
          const episodeMatch = text.match(/\bepisode\s*(\d+)\b/i);
          if ((match && Number(match[1]) === Number(season) && Number(match[2]) === Number(episode)) ||
              (Number(seasonMatch && seasonMatch[1]) === Number(season) && Number(episodeMatch && episodeMatch[1]) === Number(episode))) href = $episodes(el).attr('href');
        });
        return href ? absolute(base, href) : null;
      });
    });
}

function getStreams(tmdbId, mediaType = 'movie', season, episode) {
  return Promise.all([getBase(), tmdbDetails(tmdbId, mediaType)])
    .then(([base, media]) => search(base, media.title).then(results => ({ base, media, results })))
    .then(({ base, media, results }) => {
      const match = bestMatch(results, media.title, media.year);
      if (!match) return [];
      if (mediaType === 'tv' && season != null && episode != null) {
        return episodePage(base, match.url, season, episode)
          .then(url => url ? extractPageStreams(base, url, `${match.title} S${season}E${episode}`) : []);
      }
      return extractPageStreams(base, match.url, match.title);
    })
    .catch(error => { console.error('[FibWatch] Stream lookup failed:', error.message); return []; });
}

module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "fibwatch", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
