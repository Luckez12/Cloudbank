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
module.exports = cloudbankDisplayInstall(module.exports, "Cinevibe", "cinevibe");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
