// Imported provider: yflix; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// YFlix Scraper for Nuvio Local Scrapers
// React Native compatible version - Uses enc-dec.app database for accurate matching

// Headers for requests
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Connection': 'keep-alive'
};

const API = 'https://enc-dec.app/api';
const DB_API = 'https://enc-dec.app/db/flix';
const YFLIX_AJAX = 'https://1moviesz.to/ajax';

// Debug helpers
function createRequestId() {
  try {
    const rand = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36).slice(-6);
    return `${rand}${ts}`;
  } catch (e) {
    return String(Date.now());
  }
}

function logRid(rid, msg, extra) {
  try {
    if (extra !== undefined) {
      console.log(`[YFlix][rid:${rid}] ${msg}`, extra);
    } else {
      console.log(`[YFlix][rid:${rid}] ${msg}`);
    }
  } catch (e) {
    // ignore logging errors
  }
}

// Helper functions for HTTP requests (React Native compatible)
function getText(url) {
  return fetch(url, { headers: HEADERS })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    });
}

function getJson(url) {
  return fetch(url, { headers: HEADERS })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    });
}

function postJson(url, jsonBody, extraHeaders) {
  const body = JSON.stringify(jsonBody);
  const headers = Object.assign(
    {},
    HEADERS,
    { 'Content-Type': 'application/json', 'Content-Length': body.length.toString() },
    extraHeaders || {}
  );

  return fetch(url, {
    method: 'POST',
    headers,
    body
  }).then(response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  });
}

// Enc/Dec helpers
function encrypt(text) {
  return getJson(`${API}/enc-movies-flix?text=${encodeURIComponent(text)}`).then(j => j.result);
}

function decrypt(text) {
  return postJson(`${API}/dec-movies-flix`, { text: text }).then(j => j.result);
}

function parseHtml(html) {
  return postJson(`${API}/parse-html`, { text: html }).then(j => j.result);
}

function decryptRapidMedia(embedUrl) {
  const media = embedUrl.replace('/e/', '/media/').replace('/e2/', '/media/');
  return getJson(media)
    .then((mediaJson) => {
      const encrypted = mediaJson && mediaJson.result;
      if (!encrypted) throw new Error('No encrypted media result from RapidShare media endpoint');
      return postJson(`${API}/dec-rapid`, { text: encrypted, agent: HEADERS['User-Agent'] });
    })
    .then(j => j.result);
}

// Database lookup - replaces title matching
function findInDatabase(tmdbId, mediaType) {
  const type = mediaType === 'movie' ? 'movie' : 'tv';
  const url = `${DB_API}/find?tmdb_id=${tmdbId}&type=${type}`;

  return getJson(url)
    .then(results => {
      if (!results || results.length === 0) {
        return null;
      }
      return results[0]; // Return first match
    });
}

// HLS helpers (Promise-based)
function parseQualityFromM3u8(m3u8Text, baseUrl = '') {
  const streams = [];
  const lines = m3u8Text.split(/\r?\n/);
  let currentInfo = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = line.match(/BANDWIDTH=\s*(\d+)/i);
      const resMatch = line.match(/RESOLUTION=\s*(\d+)x(\d+)/i);

      currentInfo = {
        bandwidth: bwMatch ? parseInt(bwMatch[1]) : null,
        width: resMatch ? parseInt(resMatch[1]) : null,
        height: resMatch ? parseInt(resMatch[2]) : null,
        quality: null
      };

      if (currentInfo.height) {
        currentInfo.quality = `${currentInfo.height}p`;
      } else if (currentInfo.bandwidth) {
        const bps = currentInfo.bandwidth;
        if (bps >= 6_000_000) currentInfo.quality = '2160p';
        else if (bps >= 4_000_000) currentInfo.quality = '1440p';
        else if (bps >= 2_500_000) currentInfo.quality = '1080p';
        else if (bps >= 1_500_000) currentInfo.quality = '720p';
        else if (bps >= 800_000) currentInfo.quality = '480p';
        else if (bps >= 400_000) currentInfo.quality = '360p';
        else currentInfo.quality = '240p';
      }
    } else if (line && !line.startsWith('#') && currentInfo) {
      let streamUrl = line;
      if (!streamUrl.startsWith('http') && baseUrl) {
        try {
          const url = new URL(streamUrl, baseUrl);
          streamUrl = url.href;
        } catch (e) {
          // Ignore URL parsing errors
        }
      }

      streams.push({
        url: streamUrl,
        quality: currentInfo.quality || 'unknown',
        bandwidth: currentInfo.bandwidth,
        width: currentInfo.width,
        height: currentInfo.height,
        type: 'hls'
      });

      currentInfo = null;
    }
  }

  return {
    isMaster: m3u8Text.includes('#EXT-X-STREAM-INF'),
    streams: streams.sort((a, b) => (b.height || 0) - (a.height || 0))
  };
}

function enhanceStreamsWithQuality(streams) {
  const enhancedStreams = [];

  const tasks = streams.map(s => {
    if (s && s.url && typeof s.url === 'string' && s.url.includes('.m3u8')) {
      return getText(s.url)
        .then(text => {
          const info = parseQualityFromM3u8(text, s.url);
          if (info.isMaster && info.streams.length > 0) {
            info.streams.forEach(qualityStream => {
              enhancedStreams.push({
                ...s,
                ...qualityStream,
                masterUrl: s.url
              });
            });
          } else {
            enhancedStreams.push({
              ...s,
              quality: s.quality || 'unknown'
            });
          }
        })
        .catch(() => {
          enhancedStreams.push({
            ...s,
            quality: s.quality || 'Adaptive'
          });
        });
    } else {
      enhancedStreams.push(s);
    }
    return Promise.resolve();
  });

  return Promise.all(tasks).then(() => enhancedStreams);
}

function formatStreamsData(rapidResult) {
  const streams = [];
  const subtitles = [];
  const thumbnails = [];
  if (rapidResult && typeof rapidResult === 'object') {
    (rapidResult.sources || []).forEach(src => {
      const fileUrl = src && src.file;
      if (fileUrl) {
        streams.push({
          url: fileUrl,
          quality: fileUrl.includes('.m3u8') ? 'Adaptive' : 'unknown',
          type: fileUrl.includes('.m3u8') ? 'hls' : 'file',
          provider: 'rapidshare',
        });
      }
    });
    (rapidResult.tracks || []).forEach(tr => {
      if (tr && tr.kind === 'thumbnails' && tr.file) {
        thumbnails.push({ url: tr.file, type: 'vtt' });
      } else if (tr && (tr.kind === 'captions' || tr.kind === 'subtitles') && tr.file) {
        subtitles.push({ url: tr.file, language: tr.label || '', default: !!tr.default });
      }
    });
  }
  return { streams, subtitles, thumbnails, totalStreams: streams.length };
}

function runStreamFetch(eid, title, year, mediaType, seasonNum, episodeNum, rid) {
  logRid(rid, `runStreamFetch: start eid=${eid}`);

  return encrypt(eid)
    .then(encEid => {
      logRid(rid, 'links/list: enc(eid) ready');
      return getJson(`${YFLIX_AJAX}/links/list?eid=${eid}&_=${encEid}`);
    })
    .then(serversResp => parseHtml(serversResp.result))
    .then(servers => {
      const serverTypes = Object.keys(servers || {});
      const byTypeCounts = serverTypes.map(stype => ({ type: stype, count: Object.keys(servers[stype] || {}).length }));
      logRid(rid, 'servers available', byTypeCounts);

      const allStreams = [];
      const allSubtitles = [];
      const allThumbnails = [];

      const serverPromises = [];
      const lids = [];
      Object.keys(servers).forEach(serverType => {
        Object.keys(servers[serverType]).forEach(serverKey => {
          const lid = servers[serverType][serverKey].lid;
          lids.push(lid);
          const p = encrypt(lid)
            .then(encLid => {
              logRid(rid, `links/view: enc(lid) ready`, { serverType, serverKey, lid });
              return getJson(`${YFLIX_AJAX}/links/view?id=${lid}&_=${encLid}`);
            })
            .then(embedResp => {
              logRid(rid, `decrypt(embed)`, { serverType, serverKey, lid });
              return decrypt(embedResp.result);
            })
            .then(decrypted => {
              if (decrypted && typeof decrypted === 'object' && decrypted.url && decrypted.url.includes('rapidshare.cc')) {
                logRid(rid, `rapid.media → dec-rapid`, { lid });
                return decryptRapidMedia(decrypted.url)
                  .then(rapidData => formatStreamsData(rapidData))
                  .then(formatted => enhanceStreamsWithQuality(formatted.streams)
                    .then(enhanced => {
                      enhanced.forEach(s => {
                        s.serverType = serverType;
                        s.serverKey = serverKey;
                        s.serverLid = lid;
                        allStreams.push(s);
                      });
                      allSubtitles.push(...formatted.subtitles);
                      allThumbnails.push(...formatted.thumbnails);
                    })
                  );
              }
              return null;
            })
            .catch(() => null);
          serverPromises.push(p);
        });
      });
      const uniqueLids = Array.from(new Set(lids));
      logRid(rid, `fan-out: lids`, { total: lids.length, unique: uniqueLids.length });

      return Promise.all(serverPromises).then(() => {
        // Deduplicate streams by URL
        const seen = new Set();
        let dedupedStreams = allStreams.filter(s => {
          if (!s || !s.url) return false;
          if (seen.has(s.url)) return false;
          seen.add(s.url);
          return true;
        });
        logRid(rid, `streams: deduped`, { count: dedupedStreams.length });

        // Convert to Nuvio format
        const nuvioStreams = dedupedStreams.map(stream => ({
          name: `YFlix ${stream.serverType || 'Server'} - ${stream.quality || 'Unknown'}`,
          title: `${title}${year ? ` (${year})` : ''}${mediaType === 'tv' && seasonNum && episodeNum ? ` S${seasonNum}E${episodeNum}` : ''}`,
          url: stream.url,
          quality: stream.quality || 'Unknown',
          size: 'Unknown',
          headers: HEADERS,
          provider: 'yflix'
        }));

        return nuvioStreams;
      });
    });
}

// Main getStreams function
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve, reject) => {
    const rid = createRequestId();
    logRid(rid, `getStreams start tmdbId=${tmdbId} type=${mediaType} S=${seasonNum || ''} E=${episodeNum || ''}`);

    // Look up content in database by TMDB ID
    findInDatabase(tmdbId, mediaType)
      .then(dbResult => {
        if (!dbResult) {
          logRid(rid, 'no match found in database');
          resolve([]);
          return;
        }

        const info = dbResult.info;
        const episodes = dbResult.episodes;

        logRid(rid, `database match found`, {
          title: info.title_en,
          year: info.year,
          flixId: info.flix_id,
          episodeCount: info.episode_count
        });

        // Get the episode ID
        let eid = null;
        const selectedSeason = String(seasonNum || 1);
        const selectedEpisode = String(episodeNum || 1);

        if (episodes && episodes[selectedSeason] && episodes[selectedSeason][selectedEpisode]) {
          eid = episodes[selectedSeason][selectedEpisode].eid;
          logRid(rid, `found episode eid=${eid} for S${selectedSeason}E${selectedEpisode}`);
        } else {
          // Fallback: try to find any available episode
          const seasons = Object.keys(episodes || {});
          if (seasons.length > 0) {
            const firstSeason = seasons[0];
            const episodesInSeason = Object.keys(episodes[firstSeason] || {});
            if (episodesInSeason.length > 0) {
              const firstEp = episodesInSeason[0];
              eid = episodes[firstSeason][firstEp].eid;
              logRid(rid, `fallback: using S${firstSeason}E${firstEp}, eid=${eid}`);
            }
          }
        }

        if (!eid) {
          logRid(rid, 'no episode ID found');
          resolve([]);
          return;
        }

        // Fetch streams using the episode ID
        return runStreamFetch(eid, info.title_en, info.year, mediaType, seasonNum, episodeNum, rid);
      })
      .then(streams => {
        if (streams) {
          logRid(rid, `returning streams`, { count: streams.length });
          resolve(streams);
        } else {
          resolve([]);
        }
      })
      .catch(error => {
        logRid(rid, `ERROR ${error && error.message ? error.message : String(error)}`);
        resolve([]); // Return empty array on error, don't reject
      });
  });
}

// Export for React Native compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "yflix", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
