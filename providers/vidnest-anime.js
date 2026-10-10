// Imported provider: vidnest-anime; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// VidnestAnime Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach only
// Extracts anime streaming links using AniList IDs for Vidnest anime servers with AES-GCM decryption

// VidnestAnime Configuration
const VIDNEST_BASE_URL = 'https://backend.vidnest.fun';
const PASSPHRASE = 'A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6o=';

// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Anime Servers Configuration
const ANIME_SERVERS = {
    'hindi': {
        url: (id, ep) => `${VIDNEST_BASE_URL}/animeworld/${id}/${ep}/server/my%20server`,
        language: 'Hindi',
        needsDecryption: true
    },
    'satoru': {
        url: (id, ep) => `${VIDNEST_BASE_URL}/satoru/${id}/${ep}`,
        language: 'Original',
        needsDecryption: true
    },
    'miko': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/wave`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    },
    'pahe': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/pahe`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    },
    'anya': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/anya`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    }
};

// Working headers for VidnestAnime API
const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://vidnest.fun/',
    'Origin': 'https://vidnest.fun',
    'DNT': '1'
};

// React Native-safe Base64 utilities (reused from vidnest.js)
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
    console.log('[VidnestAnime] Starting AES-GCM decryption via server...');
    
    return fetch('https://aesdec.nuvioapp.space/decrypt', {
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
        console.log('[VidnestAnime] Server decryption successful');
        return data.decrypted;
    })
    .catch(error => {
        console.error(`[VidnestAnime] Server decryption failed: ${error.message}`);
        throw error;
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
        console.error(`[VidnestAnime] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

// Get TMDB details to extract title and year
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
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
                year: year
            };
        });
}

// Map TMDB ID to AniList ID using AniList GraphQL API
function mapTMDBToAniList(tmdbId, title, year) {
    console.log(`[VidnestAnime] Mapping TMDB ${tmdbId} to AniList...`);
    
    // Try searching by title and year
    const query = `
        query ($search: String, $year: Int) {
            Media(search: $search, seasonYear: $year, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
                id
                title {
                    romaji
                    english
                    native
                }
                seasonYear
            }
        }
    `;
    
    return fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            query: query,
            variables: { 
                search: title, 
                year: year 
            }
        })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.data && data.data.Media) {
            const anilistId = data.data.Media.id;
            console.log(`[VidnestAnime] Mapped to AniList ID: ${anilistId} (${data.data.Media.title.english || data.data.Media.title.romaji})`);
            return anilistId;
        }
        throw new Error(`No AniList mapping found for "${title}" (${year})`);
    });
}

// Get episode count for previous seasons to calculate absolute episode number
function getTMDBSeasonEpisodeCounts(tmdbId, targetSeason) {
    console.log(`[VidnestAnime] Fetching season info for TMDB ${tmdbId}, seasons 1-${targetSeason}`);
    
    // Fetch all seasons up to the target season
    const seasonPromises = [];
    for (let s = 1; s < targetSeason; s++) {
        const url = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${s}?api_key=${TMDB_API_KEY}`;
        seasonPromises.push(
            makeRequest(url)
                .then(function(response) {
                    return response.json();
                })
                .then(function(data) {
                    return data.episodes ? data.episodes.length : 0;
                })
                .catch(function(error) {
                    console.error(`[VidnestAnime] Failed to fetch season ${s}: ${error.message}`);
                    return 0; // Return 0 if season fetch fails
                })
        );
    }
    
    return Promise.all(seasonPromises)
        .then(function(episodeCounts) {
            const totalPreviousEpisodes = episodeCounts.reduce((sum, count) => sum + count, 0);
            console.log(`[VidnestAnime] Previous seasons episode counts: ${episodeCounts.join(', ')} = ${totalPreviousEpisodes} total`);
            return totalPreviousEpisodes;
        });
}

// Get anime metadata from ani.zip API
function getAnimeMetadata(anilistId, episodeNum) {
    console.log(`[VidnestAnime] Fetching metadata for AniList ID: ${anilistId}, Episode: ${episodeNum}`);
    
    return makeRequest(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            const episode = data.episodes?.[String(episodeNum)] || null;
            
            return {
                anilistId: anilistId, // Store the AniList ID
                title: data.title?.english || data.titles?.en || `Anime ID: ${anilistId}`,
                episodeTitle: episode?.title || null,
                poster: episode?.image || data.images?.find(i => i.coverType === 'Poster')?.url || '',
                year: data.year || null
            };
        })
        .catch(function(error) {
            console.error(`[VidnestAnime] Failed to fetch anime metadata: ${error.message}`);
            // Return fallback metadata
            return {
                anilistId: anilistId, // Store the AniList ID
                title: `Anime ID: ${anilistId}`,
                episodeTitle: null,
                poster: '',
                year: null
            };
        });
}

// Fetch streams from a single anime server
function fetchFromAnimeServer(serverName, serverConfig, anilistId, episodeNum, subDub) {
    console.log(`[VidnestAnime] Fetching from ${serverName}...`);
    
    // Build URL based on server config
    const url = serverConfig.supportsSubDub 
        ? serverConfig.url(anilistId, episodeNum, subDub || 'sub')
        : serverConfig.url(anilistId, episodeNum);
    
    console.log(`[VidnestAnime] ${serverName} API URL: ${url}`);
    
    return makeRequest(url)
        .then(function(response) {
            return response.text();
        })
        .then(function(responseText) {
            console.log(`[VidnestAnime] ${serverName} response length: ${responseText.length} characters`);
            
            // Try to parse as JSON first
            try {
                const data = JSON.parse(responseText);
                
                // Check if response contains encrypted data
                if (serverConfig.needsDecryption && data.encrypted && data.data) {
                    console.log(`[VidnestAnime] ${serverName}: Detected encrypted response, decrypting...`);
                    
                    return decryptAesGcm(data.data, PASSPHRASE)
                        .then(function(decryptedText) {
                            console.log(`[VidnestAnime] ${serverName}: Decryption successful`);
                            
                            try {
                                const decryptedData = JSON.parse(decryptedText);
                                return processAnimeResponse(decryptedData, serverName, serverConfig, subDub);
                            } catch (parseError) {
                                console.error(`[VidnestAnime] ${serverName}: JSON parse error after decryption: ${parseError.message}`);
                                return [];
                            }
                        });
                } else {
                    // Process non-encrypted response
                    return processAnimeResponse(data, serverName, serverConfig, subDub);
                }
            } catch (parseError) {
                console.error(`[VidnestAnime] ${serverName}: Invalid JSON response: ${parseError.message}`);
                return [];
            }
        })
        .catch(function(error) {
            console.error(`[VidnestAnime] ${serverName} error: ${error.message}`);
            return [];
        });
}

// Process anime server response
function processAnimeResponse(data, serverName, serverConfig, subDub) {
    const streams = [];
    
    try {
        console.log(`[VidnestAnime] Processing response from ${serverName}`);
        
        // Handle different response formats
        const sources = data.sources || data.streams || [];
        const subtitles = data.subtitles || [];
        const intro = data.intro || null;
        const outro = data.outro || null;
        
        if (!Array.isArray(sources) || sources.length === 0) {
            console.log(`[VidnestAnime] ${serverName}: No sources/streams array found`);
            return streams;
        }
        
        // Determine language based on subDub parameter and server config
        let language = serverConfig.language;
        if (serverConfig.supportsSubDub && subDub) {
            if (subDub === 'dub') {
                language = 'Dub';
            } else if (subDub === 'sub') {
                language = 'Sub';
            }
        }
        
        // Process each source
        sources.forEach((source, index) => {
            if (!source) return;
            
            // Extract video URL from various possible fields
            const videoUrl = source.file || source.url || source.src || source.link;
            
            if (!videoUrl) {
                console.log(`[VidnestAnime] ${serverName}: Source ${index} has no video URL`);
                return;
            }
            
            // Process subtitles
            const processedSubtitles = subtitles.map(sub => ({
                file: sub.file || sub.url,
                kind: sub.kind || 'subtitles',
                label: sub.label || sub.lang || 'Unknown',
                default: sub.default || false
            }));
            
            // Use source-specific headers for miko server (requires Referer), default headers for others
            const streamHeaders = (serverName === 'miko' && source.headers) ? source.headers : WORKING_HEADERS;
            
            streams.push({
                name: `VidnestAnime ${serverName.charAt(0).toUpperCase() + serverName.slice(1)} [${language}] - Adaptive`,
                url: videoUrl,
                quality: 'Adaptive',
                subtitles: processedSubtitles,
                intro: intro,
                outro: outro,
                headers: streamHeaders,
                provider: 'vidnest-anime'
            });
            
            console.log(`[VidnestAnime] ${serverName}: Added ${language} stream with ${processedSubtitles.length} subtitles`);
            console.log(`[VidnestAnime] ${serverName}: Stream URL: ${videoUrl}`);
            
            // Log complete stream object for testing
            console.log(`[VidnestAnime] ${serverName}: Complete Stream Object:`, JSON.stringify({
                name: `VidnestAnime ${serverName.charAt(0).toUpperCase() + serverName.slice(1)} [${language}] - Adaptive`,
                url: videoUrl,
                quality: 'Adaptive',
                subtitles: processedSubtitles,
                intro: intro,
                outro: outro,
                headers: streamHeaders,
                provider: 'vidnest-anime'
            }, null, 2));
        });
        
    } catch (error) {
        console.error(`[VidnestAnime] Error processing ${serverName} response: ${error.message}`);
    }
    
    return streams;
}

// Main function to extract anime streaming links for Nuvio
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[VidnestAnime] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}, S${seasonNum}E${episodeNum}`);
    
    return new Promise(function(resolve, reject) {
        // Step 1: Get TMDB details
        getTMDBDetails(tmdbId, mediaType)
            .then(function(tmdbInfo) {
                console.log(`[VidnestAnime] TMDB: "${tmdbInfo.title}" (${tmdbInfo.year})`);
                
                // Step 2: Map to AniList ID
                return mapTMDBToAniList(tmdbId, tmdbInfo.title, tmdbInfo.year);
            })
            .then(function(anilistId) {
                // Step 3: Calculate absolute episode number for TV shows
                const season = seasonNum || 1;
                const episode = episodeNum || 1;
                
                if (mediaType === 'tv' && season > 1) {
                    // For seasons > 1, calculate absolute episode number
                    return getTMDBSeasonEpisodeCounts(tmdbId, season)
                        .then(function(previousEpisodesCount) {
                            const absoluteEpisode = previousEpisodesCount + episode;
                            console.log(`[VidnestAnime] Converted S${season}E${episode} → Absolute Episode ${absoluteEpisode}`);
                            return { anilistId: anilistId, absoluteEpisode: absoluteEpisode };
                        });
                } else {
                    // Season 1 or movie: episode number is already absolute
                    return { anilistId: anilistId, absoluteEpisode: episode };
                }
            })
            .then(function(data) {
                // Step 4: Fetch anime metadata from ani.zip
                return getAnimeMetadata(data.anilistId, data.absoluteEpisode)
                    .then(function(metadata) {
                        metadata.anilistId = data.anilistId;
                        metadata.absoluteEpisode = data.absoluteEpisode;
                        return metadata;
                    });
            })
            .then(function(metadata) {
                console.log(`[VidnestAnime] Anime: "${metadata.title}" - Episode ${metadata.absoluteEpisode}`);
                
                // Step 5: Process all servers in parallel - fetch both SUB and DUB
                const serverPromises = [];
                
                Object.entries(ANIME_SERVERS).forEach(function([serverName, serverConfig]) {
                    if (serverConfig.supportsSubDub) {
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'sub'));
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'dub'));
                    } else {
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'sub'));
                    }
                });
                
                return Promise.all(serverPromises)
                    .then(function(results) {
                        // Combine all streams
                        const allStreams = [];
                        results.forEach(function(streams) {
                            allStreams.push(...streams);
                        });
                        
                        // Add metadata to streams
                        allStreams.forEach(function(stream) {
                            stream.title = metadata.episodeTitle 
                                ? `${metadata.title} - ${metadata.episodeTitle}`
                                : `${metadata.title} - Episode ${metadata.absoluteEpisode}`;
                            stream.poster = metadata.poster;
                        });
                        
                        // Remove duplicates
                        const uniqueStreams = [];
                        const seenUrls = new Set();
                        allStreams.forEach(function(stream) {
                            if (!seenUrls.has(stream.url)) {
                                seenUrls.add(stream.url);
                                uniqueStreams.push(stream);
                            }
                        });
                        
                        // Sort streams
                        const sortedStreams = uniqueStreams.sort(function(a, b) {
                            const getPriority = function(stream) {
                                const name = stream.name.toLowerCase();
                                if (name.includes('satoru') && name.includes('original')) return 1;
                                if (name.includes('hindi')) return 2;
                                if (name.includes('[sub]')) return 3;
                                if (name.includes('[dub]')) return 4;
                                return 5;
                            };
                            return getPriority(a) - getPriority(b);
                        });
                        
                        console.log(`[VidnestAnime] Total streams found: ${sortedStreams.length}`);
                        resolve(sortedStreams);
                    });
            })
            .catch(function(error) {
                console.error(`[VidnestAnime] Error: ${error.message}`);
                resolve([]); // Return empty array on error
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
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidnest-anime", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
