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

/* CLOUDBANK_STREAM_DISPLAY_START */
/* CLOUDBANK_STREAM_DISPLAY_V1
 * Embedded in each provider: the app downloads standalone JavaScript files.
 * Presentation only. No network requests and no changes to playback fields.
 */
function cloudbankDisplayInstall(provider, providerName, providerId) {
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
    var contentTitle = clean(meta.title || meta.name);
    if (contentTitle) text = text.split(contentTitle).join("");
    var quality = usable(stream.quality);
    var resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p?\b/i.exec(quality);
    if (!resolution) resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p\b/i.exec(text);
    var qualityLabel = resolution ? (resolution[1] === "2160" ? "4K" : resolution[1] + "p") : (/\b4k\b/i.test(quality + " " + text) ? "4K" : "");
    var release = /\b(WEB[ ._-]?DL|WEB[ ._-]?RIP|BLU[ ._-]?RAY|BD[ ._-]?REMUX|REMUX|DVD[ ._-]?RIP|HD[ ._-]?RIP|HDTV|HDCAM|CAM)\b/i.exec(text);
    var releaseLabel = release ? release[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/^WEB-?DL$/.test(releaseLabel)) releaseLabel = "WEB-DL";
    if (/^WEB-?RIP$/.test(releaseLabel)) releaseLabel = "WEBRip";
    if (/^BLU-?RAY$/.test(releaseLabel)) releaseLabel = "BluRay";
    if (/REMUX/.test(releaseLabel)) releaseLabel = "Remux";
    var codec = /\b(HEVC|H[ ._-]?265|X265|AVC|H[ ._-]?264|X264|AV1)\b/i.exec(text);
    var codecLabel = codec ? (/265|HEVC/i.test(codec[1]) ? "HEVC" : /264|AVC/i.test(codec[1]) ? "H.264" : "AV1") : "";
    var hdr = /\b(DOLBY[ ._-]?VISION|HDR10\+|HDR10|HDR|SDR)(?!\w)/i.exec(text);
    var hdrLabel = hdr ? (/DOLBY/i.test(hdr[1]) ? "Dolby Vision" : hdr[1].toUpperCase()) : "";
    var videoLine = unique([qualityLabel, releaseLabel, codecLabel, hdrLabel]).join(" · ");
    if (videoLine) lines.push(videoLine);
    var audioLang = language(stream.audioLanguage || stream.language || stream.lang);
    var audioLanguages = Array.isArray(stream.audioLanguages) ? unique(stream.audioLanguages.map(language)) : [];
    if (!audioLang && audioLanguages.length === 1) audioLang = audioLanguages[0];
    var explicitAudio = /\b(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese|Spanish|French|Arabic)[ -]Audio\b/i.exec(text);
    if (!audioLang && explicitAudio) audioLang = language(explicitAudio[1]);
    // MovieBlast exposes its language as a trailing parenthesised code.
    var parenthesised = /\(([A-Za-z]{2,3})\)\s*$/.exec(clean(originalTitle));
    if (!audioLang && parenthesised) audioLang = language(parenthesised[1]);
    var audioLabel = audioLang ? audioLang + " Audio" : "";
    if (audioLanguages.length > 1) audioLabel = "Multi Audio (" + audioLanguages.join(", ") + ")";
    if (/^original$/i.test(clean(stream.audioLanguage))) audioLabel = "Original Audio";
    if (/\bdual[- ]audio\b/i.test(text)) audioLabel = "Dual Audio" + (audioLang ? " (" + audioLang + ")" : "");
    else if (/\b(?:multi[- ]audio|multilingual)\b/i.test(text)) audioLabel = "Multi Audio" + (audioLang ? " (" + audioLang + ")" : "");
    var audioCodec = /\b(DOLBY[ ._-]?ATMOS|ATMOS|TRUEHD|DTS[ ._-]?HD[ ._-]?MA|DTS[ ._-]?HD|DTS[ ._-]?X|DTS|E[ ._-]?AC[ ._-]?3|DDP|AC[ ._-]?3|AAC|FLAC|OPUS)\b/i.exec(text);
    var audioCodecLabel = audioCodec ? audioCodec[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/ATMOS/.test(audioCodecLabel)) audioCodecLabel = "Dolby Atmos";
    if (audioCodecLabel === "TRUEHD") audioCodecLabel = "Dolby TrueHD";
    if (/^(E-?AC-?3|DDP)$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital Plus";
    if (/^AC-?3$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital";
    var channels = /\b(7\.1|6\.1|5\.1|2\.0)\b/.exec(text);
    var audioLine = unique([audioLabel, [audioCodecLabel, channels ? channels[1] : ""].filter(Boolean).join(" ")]).join(" · ");
    if (audioLine) lines.push(audioLine);
    var subs = Array.isArray(stream.subtitles) ? unique(stream.subtitles.map(function(sub) {
      return sub && (language(sub.language) || language(sub.lang) || language(sub.code) || language(sub.id));
    })) : [];
    if (subs.length) lines.push("Subtitles: " + subs.join(", "));
    var server = usable(stream.serverName || stream.server || stream.sourceName);
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
    var size = usable(stream.size || stream.fileSize || (stream.behaviorHints && stream.behaviorHints.videoSize));
    if (!size) { var sm = /\b(\d+(?:\.\d+)?)\s*(GB|MB|TB|GiB|MiB)\b/i.exec(text); if (sm) size = sm[1] + " " + sm[2]; }
    if (/^\d+(?:\.\d+)?$/.test(size)) {
      var bytes = Number(size);
      size = bytes > 0 ? (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + " GB" : (bytes / 1048576).toFixed(1) + " MB") : "";
    } else if (!/^\d+(?:\.\d+)?\s*(?:GB|MB|TB|GiB|MiB)$/i.test(size)) size = "";
    var minutes = Number(stream.runtimeMinutes || (type === "movie" ? meta.runtime : 0));
    var duration = minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) + " min" : "";
    if (!duration) { var dm = /\b(\d+)\s*min(?:utes)?\b/i.exec(clean(stream.duration) + " " + text); if (dm && Number(dm[1]) > 0) duration = dm[1] + " min"; }
    lines.push(unique([formatLabel, server, size, duration]).join(" · "));
    output.name = "";
    output.title = lines.join("\n");
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
module.exports = cloudbankDisplayInstall(module.exports, "YFlix", "yflix");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
