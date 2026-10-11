// Imported provider: vidnest; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// Vidnest Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach only
// Extracts streaming links using TMDB ID for Vidnest servers with AES-GCM decryption

// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Vidnest Configuration
const VIDNEST_BASE_URL = 'https://first.vidnest.fun';
const VIDNEST_PROXY_URL = 'https://vidnest.animanga.fun/proxy';
const PASSPHRASE = 'A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6o=';
const SERVERS = ['hollymoviehd', 'primesrc', 'ophim', 'flixhq', 'vidlink', 'rogflix'];

// Working headers for Vidnest API (exact headers from browser)
const WORKING_HEADERS = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'origin': 'https://vidnest.fun',
    'referer': 'https://vidnest.fun/',
    'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
};

// Headers for stream playback (separate from API headers)
const PLAYBACK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'DNT': '1'
};

// React Native-safe Base64 utilities (no Buffer dependency)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function base64ToBytes(base64) {
    if (!base64) return new Uint8Array(0);
    
    // Remove padding
    let input = String(base64).replace(/=+$/, '');
    let output = '';
    let bc = 0, bs, buffer, idx = 0;
    
    while ((buffer = input.charAt(idx++))) {
        buffer = BASE64_CHARS.indexOf(buffer);
        if (~buffer) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) {
                output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
            }
        }
    }
    
    // Convert string to bytes
    const bytes = new Uint8Array(output.length);
    for (let i = 0; i < output.length; i++) {
        bytes[i] = output.charCodeAt(i);
    }
    return bytes;
}

function bytesToBase64(bytes) {
    if (!bytes || bytes.length === 0) return '';
    
    let output = '';
    let i = 0;
    const len = bytes.length;
    
    while (i < len) {
        const a = bytes[i++];
        const b = i < len ? bytes[i++] : 0;
        const c = i < len ? bytes[i++] : 0;
        
        const bitmap = (a << 16) | (b << 8) | c;
        
        output += BASE64_CHARS.charAt((bitmap >> 18) & 63);
        output += BASE64_CHARS.charAt((bitmap >> 12) & 63);
        output += i - 2 < len ? BASE64_CHARS.charAt((bitmap >> 6) & 63) : '=';
        output += i - 1 < len ? BASE64_CHARS.charAt(bitmap & 63) : '=';
    }
    
    return output;
}

// Node.js compatible atob function
function atob(str) {
    return base64ToBytes(str).map(byte => String.fromCharCode(byte)).join('');
}

// AES-GCM Decryption using server (React Native compatible)
function decryptAesGcm(encryptedB64, passphraseB64) {
    console.log('[Vidnest] Starting AES-GCM decryption via server...');
    
    // Use local server for development, remote for production
    const decryptServerUrl = process.env.DECRYPT_SERVER_URL || 'https://aesdec.nuvioapp.space/decrypt';
    
    return fetch(decryptServerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            encryptedData: encryptedB64,
            passphrase: passphraseB64
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        console.log('[Vidnest] Server decryption successful');
        return data.decrypted;
    })
    .catch(error => {
        console.error(`[Vidnest] Server decryption failed: ${error.message}`);
        throw error;
    });
}

// Validate stream URL accessibility
function validateStreamUrl(url, headers) {
    console.log(`[Vidnest] Validating stream URL: ${url.substring(0, 60)}...`);
    
    // Skip validation for HLS streams (.m3u8) - they're often protected and return 403
    // but work fine in video players
    if (url.includes('.m3u8') || url.includes('/streamsvr/') || url.includes('/stream2/')) {
        console.log(`[Vidnest] Skipping validation for HLS/protected stream`);
        return Promise.resolve(true);
    }
    
    return fetch(url, {
        method: 'HEAD',
        headers: headers,
        timeout: 5000
    })
    .then(response => {
        // Accept 200 OK, 206 Partial Content, 302 redirects, or 403 (protected but valid)
        const isValid = response.ok || response.status === 206 || response.status === 302 || response.status === 403;
        console.log(`[Vidnest] URL validation result: ${response.status} - ${isValid ? 'VALID' : 'INVALID'}`);
        return isValid;
    })
    .catch(error => {
        console.log(`[Vidnest] URL validation failed: ${error.message}`);
        // For protected streams, assume valid even if validation fails
        if (url.includes('.m3u8') || url.includes('/streamsvr/') || url.includes('/stream2/')) {
            return true;
        }
        return false;
    });
}

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    const defaultHeaders = { ...WORKING_HEADERS };
    
    return fetch(url, {
        method: options.method || 'GET',
        headers: { ...defaultHeaders, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    }).catch(function(error) {
        console.error(`[Vidnest] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

// Get movie/TV show details from TMDB
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    return makeRequest(url)
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            const title = mediaType === 'tv' ? data.name : data.title;
            const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
            const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
            
            return {
                title: title,
                year: year,
                imdbId: data.external_ids?.imdb_id || null
            };
        });
}

// Extract quality from URL or response
function extractQuality(url) {
    if (!url) return 'Unknown';
    
    // Try to extract quality from URL patterns
    const qualityPatterns = [
        /(\d{3,4})p/i,  // 1080p, 720p, etc.
        /(\d{3,4})k/i,  // 1080k, 720k, etc.
        /quality[_-]?(\d{3,4})/i,  // quality-1080, quality_720, etc.
        /res[_-]?(\d{3,4})/i,  // res-1080, res_720, etc.
        /(\d{3,4})x\d{3,4}/i,  // 1920x1080, 1280x720, etc.
    ];

    for (const pattern of qualityPatterns) {
        const match = url.match(pattern);
        if (match) {
            const qualityNum = parseInt(match[1]);
            if (qualityNum >= 240 && qualityNum <= 4320) {
                return `${qualityNum}p`;
            }
        }
    }

    // Additional quality detection based on URL patterns
    if (url.includes('1080') || url.includes('1920')) return '1080p';
    if (url.includes('720') || url.includes('1280')) return '720p';
    if (url.includes('480') || url.includes('854')) return '480p';
    if (url.includes('360') || url.includes('640')) return '360p';
    if (url.includes('240') || url.includes('426')) return '240p';

    return 'Unknown';
}

// Wrap URLs through Vidnest proxy if needed (for flashstream.cc and other protected domains)
function wrapUrlWithProxy(url) {
    // Check if URL needs proxying (flashstream.cc returns 403 without proxy)
    // Also check for patterns that typically need proxy (streamsvr, /pl/, etc.)
    if (url.includes('flashstream.cc') || 
        url.includes('streamsvr/') || 
        url.includes('/pl/') ||
        url.includes('rogflix') ||
        (url.includes('lethe399key.com') && url.includes('/stream2/'))) {
        
        // Determine origin and referer based on URL domain
        let origin = 'https://flashstream.cc';
        let referer = 'https://flashstream.cc/';
        
        if (url.includes('lethe399key.com')) {
            origin = 'https://lethe399key.com';
            referer = 'https://lethe399key.com/';
        }
        
        const proxyHeaders = {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.5',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'cross-site',
            'origin': origin,
            'referer': referer
        };
        
        const encodedUrl = encodeURIComponent(url);
        const encodedHeaders = encodeURIComponent(JSON.stringify(proxyHeaders));
        const proxiedUrl = `${VIDNEST_PROXY_URL}?url=${encodedUrl}&headers=${encodedHeaders}`;
        
        console.log(`[Vidnest] Wrapping URL through proxy: ${url.substring(0, 60)}...`);
        return proxiedUrl;
    }
    
    return url;
}

// Process Vidnest API response
function processVidnestResponse(data, serverName, mediaInfo, seasonNum, episodeNum) {
    const streams = [];
    
    try {
        console.log(`[Vidnest] Processing response from ${serverName}:`, JSON.stringify(data, null, 2));
        
        // Handle different response formats for different servers
        let sources = [];
        
        // Standard format: sources or streams array
        if (data.sources && Array.isArray(data.sources)) {
            sources = data.sources;
        } else if (data.streams && Array.isArray(data.streams)) {
            sources = data.streams;
        }
        // Flixhq format: url directly in response
        else if (data.url && typeof data.url === 'string') {
            sources = [{ url: data.url, type: 'hls', headers: data.headers, subtitles: data.subtitles }];
        }
        // Vidlink format: data field contains the URL
        else if (data.data && typeof data.data === 'string') {
            sources = [{ url: data.data, type: 'hls', headers: data.headers, provider: data.provider }];
        }
        // Check if response has success field
        else if (data.success && (data.sources || data.streams)) {
            sources = data.sources || data.streams || [];
        }
        
        if (!Array.isArray(sources) || sources.length === 0) {
            console.log(`[Vidnest] ${serverName}: No sources/streams found in response`);
            return streams;
        }
        
        // Process each source
        sources.forEach((source, index) => {
            if (!source) return;
            
            // Extract video URL from various possible fields
            let videoUrl = source.file || source.url || source.src || source.link;
            
            if (!videoUrl) {
                console.log(`[Vidnest] ${serverName}: Source ${index} has no video URL`);
                return;
            }
            
            // Wrap URL through Vidnest proxy if needed (for flashstream.cc)
            videoUrl = wrapUrlWithProxy(videoUrl);
            
            // Extract language information
            let languageInfo = '';
            if (source.language) {
                languageInfo = ` [${source.language}]`;
            }
            
            // Extract label/source information for better naming
            let labelInfo = '';
            if (source.label) {
                labelInfo = ` - ${source.label}`;
            } else if (source.source) {
                labelInfo = ` - ${source.source}`;
            }
            
            // Create media title
            let mediaTitle = mediaInfo.title || 'Unknown';
            if (mediaInfo.year) {
                mediaTitle += ` (${mediaInfo.year})`;
            }
            if (seasonNum && episodeNum) {
                mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            }
            
            // Use "auto" quality for all streams
            const quality = 'auto';
            
            streams.push({
                name: `Vidnest ${serverName.charAt(0).toUpperCase() + serverName.slice(1)}${labelInfo}${languageInfo}`,
                title: mediaTitle,
                url: videoUrl,
                quality: quality,
                size: 'Unknown',
                provider: 'vidnest'
            });
            
            console.log(`[Vidnest] ${serverName}: Added ${quality}${languageInfo} stream: ${videoUrl.substring(0, 60)}...`);
        });
        
    } catch (error) {
        console.error(`[Vidnest] Error processing ${serverName} response: ${error.message}`);
    }
    
    return streams;
}

// Fetch streams from a single server
function fetchFromServer(serverName, mediaType, tmdbId, mediaInfo, seasonNum, episodeNum) {
    console.log(`[Vidnest] Fetching from ${serverName}...`);
    
    // Build API URL
    let apiUrl;
    if (mediaType === 'tv' && seasonNum && episodeNum) {
        apiUrl = `${VIDNEST_BASE_URL}/${serverName}/${mediaType}/${tmdbId}/${seasonNum}/${episodeNum}`;
    } else {
        apiUrl = `${VIDNEST_BASE_URL}/${serverName}/${mediaType}/${tmdbId}`;
    }
    
    // Handle special query parameters for specific servers
    // Flixhq supports ?server=upcloud parameter
    if (serverName === 'flixhq') {
        apiUrl += '?server=upcloud';
    }
    
    console.log(`[Vidnest] ${serverName} API URL: ${apiUrl}`);
    
    return makeRequest(apiUrl)
        .then(function(response) {
            return response.text();
        })
        .then(function(responseText) {
            console.log(`[Vidnest] ${serverName} response length: ${responseText.length} characters`);
            
            // Try to parse as JSON first
            try {
                const data = JSON.parse(responseText);
                
                // Check if response contains encrypted data
                if (data.encrypted && data.data) {
                    console.log(`[Vidnest] ${serverName}: Detected encrypted response, decrypting...`);
                    
                    return decryptAesGcm(data.data, PASSPHRASE)
                        .then(function(decryptedText) {
                            console.log(`[Vidnest] ${serverName}: Decryption successful`);
                            
                            try {
                                const decryptedData = JSON.parse(decryptedText);
                                return processVidnestResponse(decryptedData, serverName, mediaInfo, seasonNum, episodeNum);
                            } catch (parseError) {
                                console.error(`[Vidnest] ${serverName}: JSON parse error after decryption: ${parseError.message}`);
                                return [];
                            }
                        });
                } else {
                    // Process non-encrypted response
                    return processVidnestResponse(data, serverName, mediaInfo, seasonNum, episodeNum);
                }
            } catch (parseError) {
                console.error(`[Vidnest] ${serverName}: Invalid JSON response: ${parseError.message}`);
                return [];
            }
        })
        .catch(function(error) {
            console.error(`[Vidnest] ${serverName} error: ${error.message}`);
            return [];
        });
}

// Main function to extract streaming links for Nuvio
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[Vidnest] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);
    
    return new Promise((resolve, reject) => {
        // First, fetch media details from TMDB
        getTMDBDetails(tmdbId, mediaType)
            .then(function(mediaInfo) {
                console.log(`[Vidnest] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);
                
                // Process both servers in parallel
                const serverPromises = SERVERS.map(serverName => {
                    return fetchFromServer(serverName, mediaType, tmdbId, mediaInfo, seasonNum, episodeNum);
                });
                
                return Promise.all(serverPromises)
                    .then(function(results) {
                        // Combine all streams from all servers
                        const allStreams = [];
                        results.forEach(streams => {
                            allStreams.push(...streams);
                        });
                        
                        // Remove duplicate streams by URL
                        const uniqueStreams = [];
                        const seenUrls = new Set();
                        allStreams.forEach(stream => {
                            if (!seenUrls.has(stream.url)) {
                                seenUrls.add(stream.url);
                                uniqueStreams.push(stream);
                            }
                        });
                        
                        // Validate all streams in parallel
                        console.log(`[Vidnest] Validating ${uniqueStreams.length} streams...`);
                        const validationPromises = uniqueStreams.map(stream => 
                            validateStreamUrl(stream.url, PLAYBACK_HEADERS)
                                .then(isValid => ({ stream, isValid }))
                        );
                        
                        return Promise.all(validationPromises)
                            .then(function(results) {
                                const validStreams = results
                                    .filter(r => r.isValid)
                                    .map(r => r.stream);
                                
                                console.log(`[Vidnest] Filtered ${uniqueStreams.length - validStreams.length} broken links`);
                                
                                // Sort streams by quality (highest first)
                        const getQualityValue = (quality) => {
                            const q = quality.toLowerCase().replace(/p$/, ''); // Remove trailing 'p'
                            
                            // Handle specific quality names
                            if (q === '4k' || q === '2160') return 2160;
                            if (q === '1440') return 1440;
                            if (q === '1080') return 1080;
                            if (q === '720') return 720;
                            if (q === '480') return 480;
                            if (q === '360') return 360;
                            if (q === '240') return 240;
                            
                            // Handle unknown quality (put at end)
                            if (q === 'unknown') return 0;
                            
                            // Try to parse as number
                            const numQuality = parseInt(q);
                            if (!isNaN(numQuality) && numQuality > 0) {
                                return numQuality;
                            }
                            
                            // Default for unrecognized qualities
                            return 1;
                        };
                        
                                validStreams.sort((a, b) => {
                                    const qualityA = getQualityValue(a.quality);
                                    const qualityB = getQualityValue(b.quality);
                                    return qualityB - qualityA;
                                });
                                
                                console.log(`[Vidnest] Total valid streams found: ${validStreams.length}`);
                                resolve(validStreams);
                            });
                    });
            })
            .catch(function(error) {
                console.error(`[Vidnest] Error fetching media details: ${error.message}`);
                resolve([]); // Return empty array on error for Nuvio compatibility
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
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidnest", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Vidnest", "vidnest");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
