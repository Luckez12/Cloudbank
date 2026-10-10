// Imported provider: videasy-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// VideoEasy Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based (no async/await)
// Extracts streaming links using TMDB ID for all VideoEasy servers

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Connection': 'keep-alive'
};

// VideoEasy API configuration
const API = 'https://enc-dec.app/api';
const TMDB_API_KEY = 'd131017ccc6e5462a81c9304d21476de';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// VideoEasy server configurations
const SERVERS = {
  'Neon': {
    url: 'https://api.videasy.net/myflixerzupcloud/sources-with-title',
    language: 'Original'
  },
  'Sage': {
    url: 'https://api.videasy.net/1movies/sources-with-title',
    language: 'Original'
  },
  'Cypher': {
    url: 'https://api.videasy.net/moviebox/sources-with-title',
    language: 'Original'
  },
  'Yoru': {
    url: 'https://api.videasy.net/cdn/sources-with-title',
    language: 'Original',
    moviesOnly: true
  },
  'Reyna': {
    url: 'https://api.videasy.net/primewire/sources-with-title',
    language: 'Original'
  },
  'Omen': {
    url: 'https://api.videasy.net/onionplay/sources-with-title',
    language: 'Original'
  },
  'Breach': {
    url: 'https://api.videasy.net/m4uhd/sources-with-title',
    language: 'Original'
  },
  'Vyse': {
    url: 'https://api.videasy.net/hdmovie/sources-with-title',
    language: 'Original'
  },
  'Ghost': {
    url: 'https://api.videasy.net/primesrcme/sources-with-title',
    language: 'Original'
  },
  'Killjoy': {
    url: 'https://api.videasy.net/meine/sources-with-title',
    language: 'German',
    params: { language: 'german' }
  },
  'Harbor': {
    url: 'https://api.videasy.net/meine/sources-with-title',
    language: 'Italian',
    params: { language: 'italian' }
  },
  'Chamber': {
    url: 'https://api.videasy.net/meine/sources-with-title',
    language: 'French',
    params: { language: 'french' },
    moviesOnly: true
  },
  'Fade': {
    url: 'https://api.videasy.net/hdmovie/sources-with-title',
    language: 'Hindi'
  },
  'Gekko': {
    url: 'https://api.videasy.net/cuevana-latino/sources-with-title',
    language: 'Latin'
  },
  'Kayo': {
    url: 'https://api.videasy.net/cuevana-spanish/sources-with-title',
    language: 'Spanish'
  },
  'Raze': {
    url: 'https://api.videasy.net/superflix/sources-with-title',
    language: 'Portuguese'
  },
  'Phoenix': {
    url: 'https://api.videasy.net/overflix/sources-with-title',
    language: 'Portuguese'
  },
  'Astra': {
    url: 'https://api.videasy.net/visioncine/sources-with-title',
    language: 'Portuguese'
  }
};

// HTTP request helper using fetch (React Native compatible)
function requestRaw(method, urlString, options) {
  return fetch(urlString, {
    method: method,
    headers: (options && options.headers) || {},
    body: (options && options.body) || undefined
  }).then(response => {
    return response.text().then(body => {
      if (response.ok) {
        return { 
          status: response.status, 
          headers: response.headers, 
          body: body 
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${body}`);
      }
    });
  });
}

// Get text from URL
function getText(url) {
  return requestRaw('GET', url, { headers: HEADERS }).then((res) => res.body);
}

// Get JSON from URL
function getJson(url) {
  return requestRaw('GET', url, { headers: HEADERS }).then((res) => {
    try {
      return JSON.parse(res.body);
    } catch (e) {
      throw new Error(`Invalid JSON from GET ${url}: ${e.message}`);
    }
  });
}

// Post JSON to URL
function postJson(url, jsonBody, extraHeaders) {
  const body = JSON.stringify(jsonBody);
  const headers = Object.assign(
    {},
    HEADERS,
    { 'Content-Type': 'application/json' },
    extraHeaders || {}
  );
  return requestRaw('POST', url, { headers, body }).then((res) => {
    try {
      return JSON.parse(res.body);
    } catch (e) {
      throw new Error(`Invalid JSON from POST ${url}: ${e.message}`);
    }
  });
}

// Decrypt VideoEasy data
function decryptVideoEasy(encryptedText, tmdbId) {
  return postJson(`${API}/dec-videasy`, { text: encryptedText, id: tmdbId })
    .then((response) => response.result);
}

// Fetch movie details from TMDB
function fetchMovieDetails(tmdbId) {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  return getJson(url)
    .then((data) => ({
      id: data.id,
      title: data.title,
      year: data.release_date ? data.release_date.split('-')[0] : '',
      imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : '',
      mediaType: 'movie',
      overview: data.overview,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '',
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : ''
    }));
}

// Fetch TV show details from TMDB
function fetchTvDetails(tmdbId) {
  const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  return getJson(url)
    .then((data) => ({
      id: data.id,
      title: data.name,
      year: data.first_air_date ? data.first_air_date.split('-')[0] : '',
      imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : '',
      mediaType: 'tv',
      overview: data.overview,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '',
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : '',
      numberOfSeasons: data.number_of_seasons,
      numberOfEpisodes: data.number_of_episodes
    }));
}

// Auto-detect media type and fetch details
function fetchMediaDetails(tmdbId, mediaType = null) {
  if (mediaType === 'movie') {
    return fetchMovieDetails(tmdbId);
  } else if (mediaType === 'tv') {
    return fetchTvDetails(tmdbId);
  } else {
    // Try movie first, then TV if movie fails
    return fetchMovieDetails(tmdbId)
      .catch(() => fetchTvDetails(tmdbId));
  }
}

// Build VideoEasy API URL
function buildVideoEasyUrl(serverConfig, mediaType, title, year, tmdbId, imdbId, seasonId = null, episodeId = null) {
  const params = {
    title: title,
    mediaType: mediaType,
    year: year,
    tmdbId: tmdbId,
    imdbId: imdbId
  };

  // Add server-specific parameters
  if (serverConfig.params) {
    Object.keys(serverConfig.params).forEach(key => {
      params[key] = serverConfig.params[key];
    });
  }

  // Add TV show specific parameters
  if (mediaType === 'tv' && seasonId && episodeId) {
    params.seasonId = seasonId;
    params.episodeId = episodeId;
  }

  // Build query string manually for React Native compatibility
  const queryString = Object.keys(params)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
    .join('&');

  return `${serverConfig.url}?${queryString}`;
}

// Normalize language codes/names to readable format
function normalizeLanguageName(language) {
  if (!language || typeof language !== 'string') {
    return '';
  }
  
  const languageMap = {
    'en': 'English',
    'eng': 'English',
    'english': 'English',
    'hi': 'Hindi',
    'hin': 'Hindi',
    'hindi': 'Hindi',
    'de': 'German',
    'ger': 'German',
    'german': 'German',
    'it': 'Italian',
    'ita': 'Italian',
    'italian': 'Italian',
    'fr': 'French',
    'fre': 'French',
    'french': 'French',
    'es': 'Spanish',
    'spa': 'Spanish',
    'spanish': 'Spanish',
    'pt': 'Portuguese',
    'por': 'Portuguese',
    'portuguese': 'Portuguese',
    'ar': 'Arabic',
    'ara': 'Arabic',
    'arabic': 'Arabic',
    'zh': 'Chinese',
    'chi': 'Chinese',
    'chinese': 'Chinese',
    'ja': 'Japanese',
    'jpn': 'Japanese',
    'japanese': 'Japanese',
    'ko': 'Korean',
    'kor': 'Korean',
    'korean': 'Korean',
    'bn': 'Bengali',
    'ben': 'Bengali',
    'bengali': 'Bengali',
    'ta': 'Tamil',
    'tam': 'Tamil',
    'tamil': 'Tamil',
    'te': 'Telugu',
    'tel': 'Telugu',
    'telugu': 'Telugu',
    'ml': 'Malayalam',
    'mal': 'Malayalam',
    'malayalam': 'Malayalam',
    'kn': 'Kannada',
    'kan': 'Kannada',
    'kannada': 'Kannada',
    'mr': 'Marathi',
    'mar': 'Marathi',
    'marathi': 'Marathi',
    'gu': 'Gujarati',
    'guj': 'Gujarati',
    'gujarati': 'Gujarati',
    'pa': 'Punjabi',
    'pan': 'Punjabi',
    'punjabi': 'Punjabi',
    'ur': 'Urdu',
    'urd': 'Urdu',
    'urdu': 'Urdu',
    'fa': 'Persian',
    'per': 'Persian',
    'persian': 'Persian',
    'tr': 'Turkish',
    'tur': 'Turkish',
    'turkish': 'Turkish',
    'vi': 'Vietnamese',
    'vie': 'Vietnamese',
    'vietnamese': 'Vietnamese',
    'th': 'Thai',
    'tha': 'Thai',
    'thai': 'Thai',
    'id': 'Indonesian',
    'ind': 'Indonesian',
    'indonesian': 'Indonesian'
  };
  
  const normalized = language.toLowerCase().trim();
  return languageMap[normalized] || language; // Return mapped name or original if not found
}

// Extract quality from URL
function extractQualityFromUrl(url) {
  const qualityPatterns = [
    /(\d{3,4})p/i,  // 1080p, 720p, etc.
    /(\d{3,4})k/i,  // 1080k, 720k, etc.
    /quality[_-]?(\d{3,4})/i,  // quality-1080, quality_720, etc.
    /res[_-]?(\d{3,4})/i,  // res-1080, res_720, etc.
    /(\d{3,4})x\d{3,4}/i,  // 1920x1080, 1280x720, etc.
    /\/MTA4MA==\//i,  // Base64 encoded "1080"
    /\/NzIw\//i,  // Base64 encoded "720"
    /\/MzYw\//i,  // Base64 encoded "360"
    /\/NDgw\//i,  // Base64 encoded "480"
    /\/MTkyMA==\//i,  // Base64 encoded "1920"
    /\/MTI4MA==\//i,  // Base64 encoded "1280"
  ];

  for (const pattern of qualityPatterns) {
    const match = url.match(pattern);
    if (match) {
      if (pattern.source.includes('MTA4MA==')) return '1080p';
      if (pattern.source.includes('NzIw')) return '720p';
      if (pattern.source.includes('MzYw')) return '360p';
      if (pattern.source.includes('NDgw')) return '480p';
      if (pattern.source.includes('MTkyMA==')) return '1080p';
      if (pattern.source.includes('MTI4MA==')) return '720p';

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

  return 'unknown';
}

// Parse HLS playlist to extract quality information
function parseHlsPlaylist(url) {
  return getText(url)
    .then((content) => {
      const resolutions = [];
      const bandwidths = [];

      // Extract all RESOLUTION values
      const resolutionMatches = content.match(/RESOLUTION=(\d+x\d+)/g) || [];
      resolutionMatches.forEach(res => {
        const height = parseInt(res.split('x')[1].replace('RESOLUTION=', ''));
        resolutions.push(height);
      });

      // Extract all BANDWIDTH values
      const bandwidthMatches = content.match(/BANDWIDTH=(\d+)/g) || [];
      bandwidthMatches.forEach(bw => {
        const bandwidth = parseInt(bw.replace('BANDWIDTH=', ''));
        bandwidths.push(bandwidth);
      });

      // If we found resolutions, use the highest one
      if (resolutions.length > 0) {
        const maxResolution = Math.max(...resolutions);
        if (maxResolution >= 1080) return '1080p';
        else if (maxResolution >= 720) return '720p';
        else if (maxResolution >= 480) return '480p';
        else if (maxResolution >= 360) return '360p';
        else return '240p';
      }

      // If no resolutions but we have bandwidth, estimate quality
      if (bandwidths.length > 0) {
        const maxBandwidth = Math.max(...bandwidths);
        if (maxBandwidth >= 5000000) return '1080p';
        else if (maxBandwidth >= 3000000) return '720p';
        else if (maxBandwidth >= 1500000) return '480p';
        else if (maxBandwidth >= 800000) return '360p';
        else return '240p';
      }

      // Check if it's a master playlist
      if (content.includes('#EXT-X-STREAM-INF')) {
        return 'adaptive';
      }

      return 'unknown';
    })
    .catch(() => 'unknown');
}

// Format streams for Nuvio
function formatStreamsForNuvio(mediaData, serverName, serverConfig, mediaDetails) {
  if (!mediaData || typeof mediaData !== 'object' || !mediaData.sources) {
    return [];
  }

  const streams = [];

  // Process sources
  mediaData.sources.forEach((source) => {
    if (source.url) {
      let quality = source.quality || extractQualityFromUrl(source.url);
      let detectedLanguage = '';

      // If quality is still unknown and it's an HLS stream, try to parse it
      if (quality === 'unknown' && source.url.includes('.m3u8')) {
        parseHlsPlaylist(source.url).then((parsedQuality) => {
          quality = parsedQuality === 'adaptive' ? 'Adaptive' : parsedQuality;
        });
      }

      // Clean up quality values - remove provider names and invalid quality strings
      if (quality && typeof quality === 'string') {
        // Check if it's a provider name instead of quality
        const providerNames = ['streamwish', 'voesx', 'filemoon', 'fileions', 'filelions', 'streamtape', 'streamlare', 'doodstream', 'upstream', 'mixdrop'];
        const isProviderName = providerNames.some(provider =>
          quality.toLowerCase().includes(provider.toLowerCase())
        );

        if (isProviderName) {
          // If it's a provider name, try to extract quality from URL or set to unknown
          quality = extractQualityFromUrl(source.url);
          if (quality === 'unknown') {
            // Default for HLS streams with unknown quality
            quality = 'Adaptive';
          }
        }

        // Clean up other invalid quality strings
        if (quality.includes('GB') || quality.includes('MB') || quality.includes('|')) {
          quality = extractQualityFromUrl(source.url);
          if (quality === 'unknown') {
            quality = 'Adaptive';
          }
        }

        // Check if quality field contains language information (common in Vyse server)
        const languageNames = ['english', 'hindi', 'german', 'italian', 'spanish', 'portuguese', 'french', 'arabic', 'chinese', 'japanese', 'korean', 'bengali', 'tamil', 'telugu', 'malayalam', 'kannada', 'marathi', 'gujarati', 'punjabi', 'urdu', 'persian', 'turkish', 'vietnamese', 'thai', 'indonesian'];
        const isLanguageName = languageNames.some(lang =>
          quality.toLowerCase().includes(lang.toLowerCase())
        );

        if (isLanguageName) {
          // Extract language from quality field
          detectedLanguage = normalizeLanguageName(quality);
          // Try to extract actual quality from URL
          quality = extractQualityFromUrl(source.url);
          if (quality === 'unknown') {
            quality = 'Adaptive';
          }
        }

        // Handle generic quality terms
        if (quality.toLowerCase() === 'hd' || quality.toLowerCase() === 'high') {
          // Try to extract specific quality from URL
          const urlQuality = extractQualityFromUrl(source.url);
          if (urlQuality !== 'unknown') {
            quality = urlQuality;
          } else {
            quality = '720p'; // Default HD to 720p
          }
        }

        if (quality.toLowerCase() === 'sd' || quality.toLowerCase() === 'standard') {
          quality = '480p'; // Default SD to 480p
        }

        if (quality.toLowerCase() === 'auto') {
          quality = 'Auto';
        }
        if (quality.toLowerCase() === 'adaptive') {
          quality = 'Adaptive';
        }
      }

      // Determine stream type and create appropriate headers
      let streamType = 'unknown';
      let headers = Object.assign({}, HEADERS, {
        'Referer': 'https://api.videasy.net/',
        'Origin': 'https://player.videasy.net'
      });

      if (source.url.includes('.m3u8')) {
        streamType = 'hls';
        headers = Object.assign(headers, {
          'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*'
        });
      } else if (source.url.includes('.mp4')) {
        streamType = 'mp4';
        headers = Object.assign(headers, {
          'Accept': 'video/mp4,*/*',
          'Range': 'bytes=0-'
        });
      } else if (source.url.includes('.mkv')) {
        streamType = 'mkv';
        headers = Object.assign(headers, {
          'Accept': 'video/x-matroska,*/*',
          'Range': 'bytes=0-'
        });
      }

      const title = `${mediaDetails.title} (${mediaDetails.year})`;

      // Extract and normalize language information if available
      let languageInfo = '';
      if (source.language) {
        const normalizedLanguage = normalizeLanguageName(source.language);
        if (normalizedLanguage) {
          languageInfo = ` [${normalizedLanguage}]`;
        }
      } else if (detectedLanguage) {
        // Use detected language from quality field (Vyse server case)
        languageInfo = ` [${detectedLanguage}]`;
      }

      streams.push({
        name: `VIDEASY ${serverName} (${serverConfig.language})${languageInfo} - ${quality}`,
        title: title,
        url: source.url,
        quality: quality,
        size: 'Unknown',
        headers: headers,
        provider: 'videasy'
      });
    }
  });

  return streams;
}

// Fetch streams from a single server
function fetchFromServer(serverName, serverConfig, mediaType, title, year, tmdbId, imdbId, seasonId, episodeId) {
  console.log(`[VideoEasy] Fetching from ${serverName} (${serverConfig.language})...`);

  // Skip movie-only servers for TV shows
  if (mediaType === 'tv' && serverConfig.moviesOnly) {
    console.log(`[VideoEasy] Skipping ${serverName} - movies only`);
    return Promise.resolve([]);
  }

  const url = buildVideoEasyUrl(serverConfig, mediaType, title, year, tmdbId, imdbId, seasonId, episodeId);

  return getText(url)
    .then((encryptedData) => {
      if (!encryptedData || encryptedData.trim() === '') {
        throw new Error('No encrypted data received');
      }
      return decryptVideoEasy(encryptedData, tmdbId);
    })
    .then((decryptedData) => {
      const streams = formatStreamsForNuvio(decryptedData, serverName, serverConfig, { title, year });
      console.log(`[VideoEasy] ✅ Found ${streams.length} stream(s) from ${serverName}`);
      return streams;
    })
    .catch((error) => {
      console.log(`[VideoEasy] ❌ Error from ${serverName}: ${error.message}`);
      return [];
    });
}

// Main function to extract streaming links for Nuvio
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[VideoEasy] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

  return new Promise((resolve, reject) => {
    // First, fetch media details from TMDB
    fetchMediaDetails(tmdbId, mediaType)
      .then((mediaDetails) => {
        console.log(`[VideoEasy] Found: ${mediaDetails.title} (${mediaDetails.year})`);

        const serverPromises = Object.keys(SERVERS).map(serverName => {
          const serverConfig = SERVERS[serverName];
          // Double-encode title as per Phisher's implementation
          const doubleEncodedTitle = encodeURIComponent(encodeURIComponent(mediaDetails.title).replace(/\+/g, "%20"));
          return fetchFromServer(
            serverName,
            serverConfig,
            mediaDetails.mediaType,
            doubleEncodedTitle,
            mediaDetails.year,
            tmdbId,
            mediaDetails.imdbId,
            seasonNum,
            episodeNum
          );
        });

        return Promise.all(serverPromises)
          .then((results) => {
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

              // Handle adaptive/auto streams (put them first)
              if (q === 'Adaptive' || q === 'Auto') return 4000;

              // Handle unknown quality (put at end)
              if (q === 'unknown') return 0;

              // Try to parse as number (for custom resolutions like 840p)
              const numQuality = parseInt(q);
              if (!isNaN(numQuality) && numQuality > 0) {
                return numQuality;
              }

              // Default for unrecognized qualities
              return 1;
            };

            uniqueStreams.sort((a, b) => {
              const qualityA = getQualityValue(a.quality);
              const qualityB = getQualityValue(b.quality);
              return qualityB - qualityA;
            });

            console.log(`[VideoEasy] Total streams found: ${uniqueStreams.length}`);
            resolve(uniqueStreams);
          });
      })
      .catch((error) => {
        console.error(`[VideoEasy] Error fetching media details: ${error.message}`);
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
  module.exports = cloudbankWrapProvider(originalModule.exports, "videasy-v2", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VIDEASY V2", "videasy-v2");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
