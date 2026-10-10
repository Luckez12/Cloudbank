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
module.exports = cloudbankDisplayInstall(module.exports, "VidnestAnime", "vidnest-anime");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
