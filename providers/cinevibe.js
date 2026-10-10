// Imported provider: cinevibe; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// Cinevibe Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach

// Constants
const BASE_URL = 'https://cinevibe.asia';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // Same key used by other providers
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const BROWSER_FINGERPRINT = "eyJzY3JlZW4iOiIzNjB4ODA2eDI0Iiwi";
const SESSION_ENTROPY = "pjght152dw2rb.ssst4bzleDI0Iiwibv78";

// Working headers for Cinevibe requests
const WORKING_HEADERS = {
    'Referer': BASE_URL + '/',
    'User-Agent': USER_AGENT,
    'X-CV-Fingerprint': BROWSER_FINGERPRINT,
    'X-CV-Session': SESSION_ENTROPY,
    'X-Requested-With': 'XMLHttpRequest'
};

// Utility Functions

/**
 * A 32-bit FNV-1a Hash Function
 */
function fnv1a32(s) {
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) & 0xffffffff;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * ROT13 encoding function
 */
function rot13(str) {
    return str.replace(/[A-Za-z]/g, function(char) {
        const code = char.charCodeAt(0);
        if (code >= 65 && code <= 90) {
            return String.fromCharCode(((code - 65 + 13) % 26) + 65);
        } else if (code >= 97 && code <= 122) {
            return String.fromCharCode(((code - 97 + 13) % 26) + 97);
        }
        return char;
    });
}

/**
 * Base64 encoding helper (using btoa for browser/React Native)
 */
function base64Encode(str) {
    try {
        // For React Native, we need to handle Unicode properly
        const utf8Bytes = unescape(encodeURIComponent(str));
        return btoa(utf8Bytes);
    } catch (error) {
        console.error('[Cinevibe] Base64 encode error:', error);
        throw error;
    }
}

/**
 * Base64 decoding helper (using atob for browser/React Native)
 */
function base64Decode(str) {
    try {
        const decoded = atob(str);
        return decodeURIComponent(escape(decoded));
    } catch (error) {
        console.error('[Cinevibe] Base64 decode error:', error);
        throw error;
    }
}

/**
 * Deterministic string obfuscator using layered reversible encodings
 * Equivalent to Python's custom_encode function
 */
function customEncode(e) {
    // Step 1: Base64 encode
    let encoded = base64Encode(e);
    
    // Step 2: Reverse string
    encoded = encoded.split('').reverse().join('');
    
    // Step 3: ROT13 encode
    encoded = rot13(encoded);
    
    // Step 4: Base64 encode again
    encoded = base64Encode(encoded);
    
    // Step 5: Replace characters
    encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    return encoded;
}

/**
 * Get movie/TV show details from TMDB
 */
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    console.log(`[Cinevibe] Fetching TMDB details for ${mediaType} ID: ${tmdbId}`);
    
    return fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json'
        }
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }).then(function(data) {
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
        const imdbId = data.imdb_id || null;
        
        console.log(`[Cinevibe] TMDB Info: "${title}" (${releaseYear || 'N/A'})`);
        
        return {
            title: title,
            releaseYear: releaseYear,
            imdbId: imdbId
        };
    }).catch(function(error) {
        console.error(`[Cinevibe] TMDB fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Generate token for Cinevibe API
 */
function generateToken(tmdbId, title, releaseYear, mediaType) {
    // Clean title for token (remove non-alphanumeric chars, lowercase)
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Time-based key: current time in milliseconds divided by 300000 (5 minutes)
    const timeWindow = Math.floor(Date.now() / 300000);
    const timeBasedKey = `${timeWindow}_${BROWSER_FINGERPRINT}_cinevibe_2025`;
    
    // Hash the time-based key
    const hashedKey = fnv1a32(timeBasedKey);
    
    // Current time in seconds divided by 600 (10 minutes)
    // Python: int(time.time() // 600) where time.time() is seconds
    const timeStamp = Math.floor(Date.now() / 1000 / 600);
    
    // Construct token string
    const tokenString = `${SESSION_ENTROPY}|${tmdbId}|${cleanTitle}|${releaseYear}||${hashedKey}|${timeStamp}|${BROWSER_FINGERPRINT}`;
    
    // Encode token
    const token = customEncode(tokenString);
    
    return token;
}

/**
 * Extract quality from stream source or URL
 */
function getQualityFromSource(source) {
    if (!source) {
        return 'Auto';
    }

    // Check label first
    if (source.label) {
        const label = source.label.toLowerCase();
        if (label.includes('2160') || label.includes('4k')) return '4K';
        if (label.includes('1440') || label.includes('2k')) return '1440p';
        if (label.includes('1080')) return '1080p';
        if (label.includes('720')) return '720p';
        if (label.includes('480')) return '480p';
        if (label.includes('360')) return '360p';
        if (label.includes('240')) return '240p';
        if (label.includes('auto')) return 'Auto';
        return source.label; // Use the label as quality if it's descriptive
    }

    // Check other possible quality fields
    if (source.quality) {
        const quality = source.quality.toLowerCase();
        if (quality.includes('2160') || quality.includes('4k')) return '4K';
        if (quality.includes('1440') || quality.includes('2k')) return '1440p';
        if (quality.includes('1080')) return '1080p';
        if (quality.includes('720')) return '720p';
        if (quality.includes('480')) return '480p';
        if (quality.includes('360')) return '360p';
        if (quality.includes('240')) return '240p';
        return source.quality;
    }

    // Try to extract from URL
    if (source.url) {
        const urlMatch = source.url.match(/(\d{3,4})[pP]/);
        if (urlMatch) {
            const res = parseInt(urlMatch[1]);
            if (res >= 2160) return '4K';
            if (res >= 1440) return '1440p';
            if (res >= 1080) return '1080p';
            if (res >= 720) return '720p';
            if (res >= 480) return '480p';
            if (res >= 360) return '360p';
            return '240p';
        }
    }

    // Default to Auto since Cinevibe provides adaptive streaming
    return 'Auto';
}

/**
 * Make HEAD request to detect stream quality
 */
function detectStreamQuality(url) {
    console.log(`[Cinevibe] Detecting quality for: ${url.substring(0, 50)}...`);

    return fetch(url, {
        method: 'HEAD',
        headers: WORKING_HEADERS
    }).then(function(response) {
        // Try to extract quality from Content-Disposition header filename
        let quality = 'Auto'; // Default fallback

        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;]*=([^;]*)/i);
            if (filenameMatch) {
                const filename = filenameMatch[1].replace(/["']/g, '');
                // Extract quality from filename (e.g., "Movie-720P.mp4", "Movie-1080P.mp4")
                const qualityMatch = filename.match(/-(\d{3,4})[pP]/i);
                if (qualityMatch) {
                    const res = parseInt(qualityMatch[1]);
                    if (res >= 2160) quality = '4K';
                    else if (res >= 1440) quality = '1440p';
                    else if (res >= 1080) quality = '1080p';
                    else if (res >= 720) quality = '720p';
                    else if (res >= 480) quality = '480p';
                    else if (res >= 360) quality = '360p';
                    else quality = '240p';
                }
            }
        }

        // Fallback: Check Content-Type for video format hints
        if (quality === 'Auto') {
            const contentType = response.headers.get('content-type');
            if (contentType) {
                if (contentType.includes('avc1.6400') || contentType.includes('hev1.2.4.L150') || contentType.includes('hvc1.2.4.L150')) {
                    quality = '4K';
                } else if (contentType.includes('avc1.6400') || contentType.includes('hev1.2.4.L120') || contentType.includes('hvc1.2.4.L120')) {
                    quality = '1440p';
                } else if (contentType.includes('avc1.4d00') || contentType.includes('hev1.1.6.L93') || contentType.includes('hvc1.1.6.L93')) {
                    quality = '1080p';
                } else if (contentType.includes('avc1.4200') || contentType.includes('hev1.1.6.L63') || contentType.includes('hvc1.1.6.L63')) {
                    quality = '720p';
                } else if (contentType.includes('avc1.42C0')) {
                    quality = '480p';
                }
            }
        }

        // Fallback: Check for resolution in custom headers
        if (quality === 'Auto') {
            const resolution = response.headers.get('x-resolution') || response.headers.get('resolution');
            if (resolution) {
                const resMatch = resolution.match(/(\d+)x(\d+)/);
                if (resMatch) {
                    const height = parseInt(resMatch[2]);
                    if (height >= 2160) quality = '4K';
                    else if (height >= 1440) quality = '1440p';
                    else if (height >= 1080) quality = '1080p';
                    else if (height >= 720) quality = '720p';
                    else if (height >= 480) quality = '480p';
                    else if (height >= 360) quality = '360p';
                    else quality = '240p';
                }
            }
        }

        // Fallback: Check Content-Length for file size estimation
        if (quality === 'Auto') {
            const contentLength = response.headers.get('content-length');
            if (contentLength && !isNaN(contentLength)) {
                const sizeGB = parseInt(contentLength) / (1024 * 1024 * 1024);
                const sizeMB = parseInt(contentLength) / (1024 * 1024);
                if (sizeGB >= 4) quality = '4K';
                else if (sizeGB >= 2) quality = '1440p';
                else if (sizeGB >= 1) quality = '1080p';
                else if (sizeMB >= 500) quality = '720p';
                else if (sizeMB >= 200) quality = '480p';
            }
        }

        return quality;

    }).catch(function(error) {
        console.log(`[Cinevibe] HEAD request failed, using Auto quality: ${error.message}`);
        return 'Auto';
    });
}

/**
 * Fetch streaming data from Cinevibe API
 */
function fetchStreams(tmdbId, mediaType, seasonNum, episodeNum, mediaInfo) {
    const { title, releaseYear } = mediaInfo;

    // Generate token
    const token = generateToken(tmdbId, title, releaseYear, mediaType);
    const timestamp = Date.now();

    // Build API URL
    const apiUrl = `${BASE_URL}/api/stream/fetch?server=cinebox-1&type=${mediaType}&mediaId=${tmdbId}&title=${encodeURIComponent(title)}&releaseYear=${releaseYear}&_token=${token}&_ts=${timestamp}`;

    console.log(`[Cinevibe] Fetching streams from API...`);

    return fetch(apiUrl, {
        method: 'GET',
        headers: WORKING_HEADERS
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`Cinevibe API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }).then(function(data) {
        console.log(`[Cinevibe] API response received`);

        if (!data || !data.sources || !Array.isArray(data.sources) || data.sources.length === 0) {
            throw new Error('No sources found in API response');
        }

        // Process sources and detect qualities
        const qualityPromises = data.sources.map(function(source, index) {
            if (!source || !source.url) {
                return Promise.resolve({
                    index: index,
                    source: source,
                    quality: 'Auto'
                });
            }

            return detectStreamQuality(source.url).then(function(quality) {
                return {
                    index: index,
                    source: source,
                    quality: quality
                };
            }).catch(function() {
                return {
                    index: index,
                    source: source,
                    quality: 'Auto'
                };
            });
        });

        return Promise.allSettled(qualityPromises).then(function(results) {
            const streams = [];

            results.forEach(function(result) {
                if (result.status === 'fulfilled') {
                    const { index, source, quality } = result.value;

                    // Build media title
                    let mediaTitle = title;
                    if (mediaType === 'tv' && seasonNum && episodeNum) {
                        mediaTitle = `${title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
                    } else if (releaseYear) {
                        mediaTitle = `${title} (${releaseYear})`;
                    }

                    streams.push({
                        name: `Cinevibe - ${quality}`,
                        title: mediaTitle,
                        url: source.url,
                        quality: quality,
                        size: 'Unknown',
                        headers: WORKING_HEADERS,
                        provider: 'cinevibe'
                    });
                }
            });

            console.log(`[Cinevibe] Found ${streams.length} streams with detected qualities`);

            return streams;
        });
    }).catch(function(error) {
        console.error(`[Cinevibe] Stream fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Main scraping function
 * @param {string} tmdbId - TMDB ID
 * @param {string} mediaType - "movie" or "tv"
 * @param {number} seasonNum - Season number (TV only)
 * @param {number} episodeNum - Episode number (TV only)
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[Cinevibe] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);
    
    // Check if TV series is supported (Python code shows it's not supported yet)
    if (mediaType === 'tv') {
        console.log('[Cinevibe] TV Series currently not supported');
        return Promise.resolve([]);
    }
    
    // Get TMDB details first
    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo.title || !mediaInfo.releaseYear) {
            throw new Error('Could not extract title and release year from TMDB response');
        }
        
        // Fetch streams from Cinevibe API
        return fetchStreams(tmdbId, mediaType, seasonNum, episodeNum, mediaInfo);
    }).catch(function(error) {
        console.error(`[Cinevibe] Scraping error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native environment
    global.CinevibeScraperModule = { getStreams };
}


/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "cinevibe", ["movie"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
