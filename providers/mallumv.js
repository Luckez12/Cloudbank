// Imported provider: mallumv; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// MalluMV scraper for Nuvio
// Scrapes content from mallumv.fit with multi-step download link extraction

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c"; // This will be replaced by Nuvio
const BASE_URL = 'https://mallumv.gay';

// Temporarily disable URL validation for faster results
global.URL_VALIDATION_ENABLED = true;

// Required headers for playback (following README format)
const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Origin': 'https://mallumv.gay',
    'Referer': 'https://mallumv.gay/',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'DNT': '1'
};

// === HubCloud Extractor Functions (from DVDPlay) ===

// Utility functions for HubCloud
function getBaseUrl(url) {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
        return '';
    }
}

// Base64 and encoding utilities
function base64Decode(str) {
    try {
        return decodeURIComponent(escape(atob(str)));
    } catch (e) {
        return '';
    }
}

function base64Encode(str) {
    try {
        return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
        return '';
    }
}

function rot13(str) {
    return (str || '').replace(/[A-Za-z]/g, function (char) {
        var start = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start);
    });
}

function getIndexQuality(str) {
    const match = (str || '').match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : null;
}

function cleanTitle(title) {
    const decodedTitle = decodeFilename(title);
    const parts = decodedTitle.split(/[.\-_]/);

    const qualityTags = ['WEBRip', 'WEB-DL', 'WEB', 'BluRay', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS', 'R5', 'DVDScr', 'BRRip', 'BDRip', 'DVD', 'PDTV', 'HD'];
    const audioTags = ['AAC', 'AC3', 'DTS', 'MP3', 'FLAC', 'DD5', 'EAC3', 'Atmos'];
    const subTags = ['ESub', 'ESubs', 'Subs', 'MultiSub', 'NoSub', 'EnglishSub', 'HindiSub'];
    const codecTags = ['x264', 'x265', 'H264', 'HEVC', 'AVC'];

    const startIndex = parts.findIndex(part =>
        qualityTags.some(tag => part.toLowerCase().includes(tag.toLowerCase()))
    );

    const endIndex = parts.map((part, index) => {
        const hasTag = [...subTags, ...audioTags, ...codecTags].some(tag =>
            part.toLowerCase().includes(tag.toLowerCase())
        );
        return hasTag ? index : -1;
    }).filter(index => index !== -1).pop() || -1;

    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
        return parts.slice(startIndex, endIndex + 1).join('.');
    } else if (startIndex !== -1) {
        return parts.slice(startIndex).join('.');
    } else {
        return parts.slice(-3).join('.');
    }
}

function decodeFilename(filename) {
    if (!filename) return filename;

    try {
        let decoded = filename;

        if (decoded.startsWith('UTF-8')) {
            decoded = decoded.substring(5);
        }

        decoded = decodeURIComponent(decoded);

        return decoded;
    } catch (error) {
        return filename;
    }
}

function getFilenameFromUrl(url) {
    return new Promise((resolve) => {
        try {
            fetch(url, { method: 'HEAD', timeout: 10000 })
                .then(response => {
                    const contentDisposition = response.headers.get('content-disposition');
                    let filename = null;

                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
                        if (filenameMatch && filenameMatch[1]) {
                            filename = filenameMatch[1].replace(/["']/g, '');
                        }
                    }

                    if (!filename) {
                        const urlObj = new URL(url);
                        const pathParts = urlObj.pathname.split('/');
                        filename = pathParts[pathParts.length - 1];
                        if (filename && filename.includes('.')) {
                            filename = filename.replace(/\.[^.]+$/, '');
                        }
                    }

                    const decodedFilename = decodeFilename(filename);
                    resolve(decodedFilename || null);
                })
                .catch(() => resolve(null));
        } catch (error) {
            resolve(null);
        }
    });
}

// Main HubCloud extraction function (from DVDPlay)
function extractHubCloudLinks(url, referer = 'HubCloud') {
    var origin;
    try { origin = new URL(url).origin; } catch (e) { origin = ''; }

    // Helper function for absolute URL resolution
    function toAbsolute(href, base) {
        try {
            return new URL(href, base).href;
        } catch (e) {
            return href;
        }
    }

    return makeHTTPRequest(url, { parseHTML: true })
        .then(response => {
            const $ = response.$;

            var href;
            if (url.indexOf('hubcloud.php') !== -1) {
                href = url;
            } else {
                // Check for token-based HubCloud URLs (newer format)
                var tokenMatch = url.match(/\/video\/([^\/\?]+)(\?token=([^&\s]+))?/);
                if (tokenMatch) {
                    var videoId = tokenMatch[1];
                    var token = tokenMatch[3];
                    if (token) {
                        // Use the token-based URL format
                        href = origin + '/video/' + videoId + '?token=' + token;
                    } else {
                        // Try to find token in the page
                        var tokenFromPage = $.html().match(/token=([^"'\s&]+)/);
                        if (tokenFromPage) {
                            href = origin + '/video/' + videoId + '?token=' + tokenFromPage[1];
                        } else {
                            href = url; // Use original URL as fallback
                        }
                    }
                } else {
                    // Traditional approach for older HubCloud formats
                    var rawHref = $('#download').attr('href') || $('a[href*="hubcloud.php"]').attr('href') || $('.download-btn').attr('href') || $('a[href*="download"]').attr('href');
                    if (!rawHref) throw new Error('Download element not found');
                    href = toAbsolute(rawHref, origin);
                }
            }

            return makeHTTPRequest(href, { parseHTML: true }).then(function (secondResponse) {
                return { firstResponse: response, secondResponse: secondResponse, href: href };
            });
        })
        .then(response => {
            const $$ = response.secondResponse.$; // Use $$ for the second cheerio instance like 4KHDHub
            const href = response.href;

            // Helper function to resolve intermediate HubCloud URLs (.fans/?id= and .workers.dev/?id=)
            function resolveHubCloudUrl(url) {
                console.log(`[MalluMV] Resolving HubCloud URL: ${url.substring(0, 50)}...`);

                // If it's already an R2 Cloudflare URL, it's already resolved
                if (url.includes('r2.cloudflarestorage.com')) {
                    console.log(`[MalluMV] URL already resolved (R2): ${url.substring(0, 50)}...`);
                    return Promise.resolve(url);
                }

                // Extract the actual download URL from 360news4u.net/dl.php?link= URLs FIRST
                if (url.includes('360news4u.net/dl.php?link=')) {
                    console.log(`[MalluMV] 🔍 Processing 360news4u.net URL: ${url.substring(0, 100)}...`);
                    const linkMatch = url.match(/360news4u\.net\/dl\.php\?link=([^&\s]+)/);
                    console.log(`[MalluMV] 🔍 Regex match result:`, linkMatch);

                    if (linkMatch && linkMatch[1]) {
                        const actualUrl = decodeURIComponent(linkMatch[1]);
                        console.log(`[MalluMV] ✅ Extracted Google Drive URL from 360news4u.net: ${actualUrl.substring(0, 80)}...`);
                        return Promise.resolve(actualUrl);
                    } else {
                        console.log(`[MalluMV] ❌ Failed to extract URL from 360news4u.net link`);
                        console.log(`[MalluMV] ❌ Full URL for debugging: ${url}`);
                    }
                }

                // Extract the actual download URL from gamerxyt.com/dl.php?link= URLs
                if (url.includes('gamerxyt.com/dl.php?link=')) {
                    console.log(`[MalluMV] 🔍 Processing gamerxyt.com URL: ${url.substring(0, 100)}...`);
                    const linkMatch = url.match(/gamerxyt\.com\/dl\.php\?link=([^&\s]+)/);

                    if (linkMatch && linkMatch[1]) {
                        const actualUrl = decodeURIComponent(linkMatch[1]);
                        console.log(`[MalluMV] ✅ Extracted URL from gamerxyt.com: ${actualUrl.substring(0, 80)}...`);
                        // Recursively resolve the extracted URL to ensure it's fully resolved
                        return resolveHubCloudUrl(actualUrl);
                    } else {
                        console.log(`[MalluMV] ❌ Failed to extract URL from gamerxyt.com link`);
                    }
                }

                // If it's a direct Google Drive download URL, it might be final
                if (url.includes('video-downloads.googleusercontent.com')) {
                    console.log(`[MalluMV] Google Drive download URL found: ${url.substring(0, 50)}...`);
                    return Promise.resolve(url);
                }

                return fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    },
                    redirect: 'manual' // Don't follow redirects automatically
                }).then(response => {
                    if (response.status >= 300 && response.status < 400) {
                        // Follow redirect manually
                        const location = response.headers.get('location');
                        if (location) {
                            console.log(`[MalluMV] Following redirect to: ${location.substring(0, 50)}...`);
                            // Recursively resolve the redirect URL
                            return resolveHubCloudUrl(location);
                        }
                    }

                    // If no redirect, check if this is already a direct file URL
                    if (response.status === 200 && response.headers.get('content-type')?.includes('video/')) {
                        console.log(`[MalluMV] Direct file URL found: ${url.substring(0, 50)}...`);
                        return url;
                    }

                    // Check if it's a direct S3/R2 URL in the response
                    if (response.status === 200) {
                        console.log(`[MalluMV] Checking for direct URL in response...`);
                        return response.text().then(text => {
                            // Look for "Download Here" button/link (common in .fans/?id= pages)
                            // Try multiple patterns to catch different HTML structures
                            const downloadHerePatterns = [
                                /<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*Download Here/i,
                                /<a[^>]*>Download Here[^<]*<\/a>/i,
                                /href=["']([^"']+)["'][^>]*>[^<]*Download Here/i,
                                /<a[^>]*href=["']([^"']+)["'][^>]*class[^>]*download/i,
                                /<a[^>]*class[^>]*download[^>]*href=["']([^"']+)["']/i
                            ];

                            for (const pattern of downloadHerePatterns) {
                                const downloadHereMatch = text.match(pattern);
                                if (downloadHereMatch) {
                                    // Extract href from the matched link
                                    let downloadUrl = null;
                                    if (downloadHereMatch[1]) {
                                        downloadUrl = downloadHereMatch[1];
                                    } else {
                                        // Try to extract from the full match
                                        const hrefMatch = downloadHereMatch[0].match(/href=["']([^"']+)["']/i);
                                        if (hrefMatch && hrefMatch[1]) {
                                            downloadUrl = hrefMatch[1];
                                        }
                                    }

                                    if (downloadUrl && !downloadUrl.startsWith('#') && downloadUrl !== url) {
                                        console.log(`[MalluMV] Found "Download Here" link: ${downloadUrl.substring(0, 50)}...`);
                                        // Resolve relative URLs to absolute
                                        try {
                                            const absoluteUrl = new URL(downloadUrl, url).href;
                                            return resolveHubCloudUrl(absoluteUrl);
                                        } catch (e) {
                                            return resolveHubCloudUrl(downloadUrl);
                                        }
                                    }
                                }
                            }

                            // Look for any download button/link with href
                            const downloadLinkMatch = text.match(/<a[^>]*href=["']([^"']+)["'][^>]*>.*?[Dd]ownload/i);
                            if (downloadLinkMatch && downloadLinkMatch[1]) {
                                const downloadUrl = downloadLinkMatch[1];
                                // Skip if it's a fragment, relative path without extension, or the same URL
                                if (!downloadUrl.startsWith('#') &&
                                    (downloadUrl.startsWith('http') || downloadUrl.includes('/') || downloadUrl.includes('.'))) {
                                    console.log(`[MalluMV] Found download link: ${downloadUrl.substring(0, 50)}...`);
                                    try {
                                        const absoluteUrl = new URL(downloadUrl, url).href;
                                        return resolveHubCloudUrl(absoluteUrl);
                                    } catch (e) {
                                        return resolveHubCloudUrl(downloadUrl);
                                    }
                                }
                            }

                            // Look for meta refresh redirects
                            const metaRefreshMatch = text.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"';]+)/i);
                            if (metaRefreshMatch && metaRefreshMatch[1]) {
                                const redirectUrl = metaRefreshMatch[1].trim();
                                console.log(`[MalluMV] Found meta refresh redirect: ${redirectUrl.substring(0, 50)}...`);
                                try {
                                    const absoluteUrl = new URL(redirectUrl, url).href;
                                    return resolveHubCloudUrl(absoluteUrl);
                                } catch (e) {
                                    return resolveHubCloudUrl(redirectUrl);
                                }
                            }

                            // Look for JavaScript redirects (window.location, location.href, etc.)
                            const jsRedirectMatch = text.match(/(?:window\.location|location\.href|location\.replace)\s*[=:]\s*["']([^"']+)["']/i);
                            if (jsRedirectMatch && jsRedirectMatch[1]) {
                                const redirectUrl = jsRedirectMatch[1];
                                console.log(`[MalluMV] Found JavaScript redirect: ${redirectUrl.substring(0, 50)}...`);
                                try {
                                    const absoluteUrl = new URL(redirectUrl, url).href;
                                    return resolveHubCloudUrl(absoluteUrl);
                                } catch (e) {
                                    return resolveHubCloudUrl(redirectUrl);
                                }
                            }

                            // Look for direct download URLs in the response (R2 Cloudflare)
                            const directUrlMatch = text.match(/(https?:\/\/[^"'\s]+\.r2\.cloudflarestorage\.com[^"'\s]*)/);
                            if (directUrlMatch) {
                                console.log(`[MalluMV] Found direct R2 URL in response: ${directUrlMatch[1].substring(0, 50)}...`);
                                return directUrlMatch[1];
                            }

                            // Look for other direct download patterns (video files)
                            const otherDirectMatch = text.match(/(https?:\/\/[^"'\s]+\/[^"'\s]*\.(mkv|mp4|avi|m4v)[^"'\s]*)/i);
                            if (otherDirectMatch) {
                                console.log(`[MalluMV] Found direct file URL: ${otherDirectMatch[1].substring(0, 50)}...`);
                                return otherDirectMatch[1];
                            }

                            // Look for Google Drive, Pixeldrain, or other cloud storage URLs
                            const cloudStorageMatch = text.match(/(https?:\/\/[^"'\s]*(?:video-downloads\.googleusercontent\.com|pixeldrain\.(?:net|dev)|sharepoint\.com|onedrive\.live\.com)[^"'\s]*)/i);
                            if (cloudStorageMatch) {
                                console.log(`[MalluMV] Found cloud storage URL: ${cloudStorageMatch[1].substring(0, 50)}...`);
                                return resolveHubCloudUrl(cloudStorageMatch[1]);
                            }

                            // Return original URL if we can't find a direct URL
                            console.log(`[MalluMV] No direct URL found, returning original`);
                            return url;
                        });
                    }

                    // Return original URL if we can't resolve it
                    console.log(`[MalluMV] Could not resolve URL, returning original`);
                    return url;
                }).catch(error => {
                    console.log(`[MalluMV] Error resolving URL: ${error.message}`);
                    return url;
                });
            }

            function buildTask(buttonText, buttonLink, headerDetails, size, quality) {
                const qualityLabel = quality ? (' - ' + quality + 'p') : ' - Unknown';

                // Pixeldrain normalization (from 4KHDHub)
                const pd = buttonLink.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
                if (pd && pd[1]) buttonLink = 'https://pixeldrain.net/api/file/' + pd[1];

                // Handle intermediate HubCloud URLs (.fans/?id=, .workers.dev/?id=, and redirect URLs)
                if (buttonLink.includes('.fans/?id=') || buttonLink.includes('.workers.dev/?id=') ||
                    buttonLink.includes('360news4u.net/dl.php') || buttonLink.includes('gamerxyt.com/dl.php')) {
                    return resolveHubCloudUrl(buttonLink)
                        .then(resolvedUrl => {
                            // If resolution failed and we still have an intermediate URL, try one more time
                            if (resolvedUrl.includes('.workers.dev/?id=') &&
                                !resolvedUrl.includes('r2.cloudflarestorage.com') &&
                                !resolvedUrl.includes('video-downloads.googleusercontent.com') &&
                                !resolvedUrl.includes('360news4u.net/dl.php') &&
                                !resolvedUrl.includes('gamerxyt.com/dl.php')) {
                                console.log(`[MalluMV] Second attempt to resolve: ${resolvedUrl.substring(0, 50)}...`);
                                return resolveHubCloudUrl(resolvedUrl);
                            }
                            return resolvedUrl;
                        })
                        .then(resolvedUrl => {
                            return getFilenameFromUrl(resolvedUrl)
                                .then(actualFilename => {
                                    const displayFilename = actualFilename || headerDetails || 'Unknown';
                                    const titleParts = [];
                                    if (displayFilename) titleParts.push(displayFilename);
                                    if (size) titleParts.push(size);
                                    const finalTitle = titleParts.join('\n');

                                    let name;
                                    if (buttonText.includes('FSL Server')) name = 'MalluMV - FSL Server' + qualityLabel;
                                    else if (buttonText.includes('S3 Server')) name = 'MalluMV - S3 Server' + qualityLabel;
                                    else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = 'MalluMV - Pixeldrain' + qualityLabel;
                                    else if (buttonText.includes('Download File')) name = 'MalluMV - HubCloud' + qualityLabel;
                                    else name = 'MalluMV - HubCloud' + qualityLabel;

                                    return {
                                        name: name,
                                        title: finalTitle,
                                        url: resolvedUrl,
                                        quality: quality ? quality + 'p' : 'Unknown',
                                        size: size || 'Unknown',
                                        headers: WORKING_HEADERS,
                                        provider: 'mallumv'
                                    };
                                })
                                .catch(() => {
                                    const displayFilename = headerDetails || 'Unknown';
                                    const titleParts = [];
                                    if (displayFilename) titleParts.push(displayFilename);
                                    if (size) titleParts.push(size);
                                    const finalTitle = titleParts.join('\n');

                                    const name = 'MalluMV - HubCloud' + qualityLabel;
                                    return {
                                        name: name,
                                        title: finalTitle,
                                        url: resolvedUrl,
                                        quality: quality ? quality + 'p' : 'Unknown',
                                        size: size || 'Unknown',
                                        headers: WORKING_HEADERS,
                                        provider: 'mallumv'
                                    };
                                });
                        });
                }

                return getFilenameFromUrl(buttonLink)
                    .then(actualFilename => {
                        const displayFilename = actualFilename || headerDetails || 'Unknown';
                        const titleParts = [];
                        if (displayFilename) titleParts.push(displayFilename);
                        if (size) titleParts.push(size);
                        const finalTitle = titleParts.join('\n');

                        let name;
                        if (buttonText.includes('FSL Server')) name = 'MalluMV - FSL Server' + qualityLabel;
                        else if (buttonText.includes('S3 Server')) name = 'MalluMV - S3 Server' + qualityLabel;
                        else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = 'MalluMV - Pixeldrain' + qualityLabel;
                        else if (buttonText.includes('Download File')) name = 'MalluMV - HubCloud' + qualityLabel;
                        else name = 'MalluMV - HubCloud' + qualityLabel;

                        return {
                            name: name,
                            title: finalTitle,
                            url: buttonLink,
                            quality: quality ? quality + 'p' : 'Unknown',
                            size: size || 'Unknown',
                            headers: WORKING_HEADERS,
                            provider: 'mallumv'
                        };
                    })
                    .catch(() => {
                        const displayFilename = headerDetails || 'Unknown';
                        const titleParts = [];
                        if (displayFilename) titleParts.push(displayFilename);
                        if (size) titleParts.push(size);
                        const finalTitle = titleParts.join('\n');

                        const name = 'MalluMV - HubCloud' + qualityLabel;
                        return {
                            name: name,
                            title: finalTitle,
                            url: buttonLink,
                            quality: quality ? quality + 'p' : 'Unknown',
                            size: size || 'Unknown',
                            headers: WORKING_HEADERS,
                            provider: 'mallumv'
                        };
                    });
            }

            // Iterate per card to capture per-quality sections (from 4KHDHub)
            const tasks = [];
            const cards = $$('.card');
            if (cards.length > 0) {
                cards.each(function (ci, card) {
                    const $card = $$(card);
                    const header = $card.find('div.card-header').text() || $$('div.card-header').first().text() || '';
                    const size = $card.find('i#size').text() || $$('i#size').first().text() || '';
                    const quality = getIndexQuality(header);
                    const headerDetails = cleanTitle(header);

                    let localBtns = $card.find('div.card-body h2 a.btn');
                    if (localBtns.length === 0) localBtns = $card.find('a.btn, .btn, a[href]');

                    localBtns.each(function (i, el) {
                        const $btn = $$(el);
                        const text = ($btn.text() || '').trim();
                        let link = $btn.attr('href');

                        if (!link) return;
                        link = toAbsolute(link, href);

                        // Only consider plausible buttons (from 4KHDHub)
                        const isPlausible = /(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file)/i.test(link) ||
                            text.toLowerCase().includes('download');

                        if (!isPlausible) return;

                        tasks.push(buildTask(text, link, headerDetails, size, quality));
                    });
                });
            }

            // Fallback: whole page buttons (from 4KHDHub)
            if (tasks.length === 0) {
                let buttons = $$.root().find('div.card-body h2 a.btn');
                if (buttons.length === 0) {
                    const altSelectors = ['a.btn', '.btn', 'a[href]'];
                    for (const selector of altSelectors) {
                        buttons = $$.root().find(selector);
                        if (buttons.length > 0) break;
                    }
                }

                const size = $$('i#size').first().text() || '';
                const header = $$('div.card-header').first().text() || '';
                const quality = getIndexQuality(header);
                const headerDetails = cleanTitle(header);

                buttons.each(function (i, el) {
                    const $btn = $$(el);
                    const text = ($btn.text() || '').trim();
                    let link = $btn.attr('href');

                    if (!link) return;
                    link = toAbsolute(link, href);

                    tasks.push(buildTask(text, link, headerDetails, size, quality));
                });
            }

            if (tasks.length === 0) return [];
            return Promise.all(tasks).then(arr => (arr || []).filter(x => !!x));
        })
        .catch(error => {
            console.error(`[MalluMV] HubCloud extraction error for ${url}:`, error.message);
            return [];
        });
}

// Utility functions (reused from DVDPlay)
function normalizeTitle(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateSimilarity(str1, str2) {
    var s1 = normalizeTitle(str1);
    var s2 = normalizeTitle(str2);
    if (s1 === s2) return 1.0;
    var len1 = s1.length;
    var len2 = s2.length;
    if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
    if (len2 === 0) return 0.0;
    var matrix = Array(len1 + 1).fill(null).map(function () { return Array(len2 + 1).fill(0); });
    for (var i = 0; i <= len1; i++) matrix[i][0] = i;
    for (var j = 0; j <= len2; j++) matrix[0][j] = j;
    for (i = 1; i <= len1; i++) {
        for (j = 1; j <= len2; j++) {
            var cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    var maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
}

function findBestMatch(results, query) {
    if (!results || results.length === 0) return null;
    if (results.length === 1) return results[0];

    var scored = results.map(function (r) {
        var score = 0;
        if (normalizeTitle(r.title) === normalizeTitle(query)) score += 100;
        var sim = calculateSimilarity(r.title, query); score += sim * 50;
        if (normalizeTitle(r.title).indexOf(normalizeTitle(query)) !== -1) score += 15; // quick containment bonus
        var lengthDiff = Math.abs(r.title.length - query.length);
        score += Math.max(0, 10 - lengthDiff / 5);
        if (/(19|20)\d{2}/.test(r.title)) score += 5;
        return { item: r, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });

    // Only return the best match if it has a reasonable similarity score
    // Require at least 30% similarity or exact match to avoid wrong movies
    const bestMatch = scored[0];
    const similarity = calculateSimilarity(bestMatch.item.title, query);

    if (similarity < 0.3 && normalizeTitle(bestMatch.item.title) !== normalizeTitle(query)) {
        console.log(`[MalluMV] Best match "${bestMatch.item.title}" has low similarity (${(similarity * 100).toFixed(1)}%) with "${query}" - rejecting`);
        return null;
    }

    return bestMatch.item;
}

function parseQualityForSort(qualityString) {
    const match = (qualityString || '').match(/(\d{3,4})p/i);
    return match ? parseInt(match[1], 10) : 0;
}

function parseSizeForSort(sizeString) {
    if (!sizeString) return 0;

    const match = sizeString.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    // Convert everything to MB for comparison
    if (unit === 'GB') {
        return value * 1024; // Convert GB to MB
    } else if (unit === 'MB') {
        return value;
    }

    return 0;
}

// Extract quality from text - improved to handle numeric values and normalize labels
// Extract quality from text - improved to handle numeric values and normalize labels
function extractQuality(text) {
    if (!text) return 'Unknown';

    // First, look for specific resolution values (prioritize these)
    const resolutionMatch = text.match(/(4K|2160p|1080p|720p|480p|360p)/i);
    if (resolutionMatch) {
        const quality = resolutionMatch[1].toUpperCase();
        // Normalize 4K to standard format
        if (quality === '4K') return '4K';
        return quality;
    }

    // Look for numeric quality values followed by 'p' (e.g., 2160p, 1080p) - stricter check
    const strictNumericMatch = text.match(/(\d{3,4})[pP]/);
    if (strictNumericMatch) {
        const numericValue = parseInt(strictNumericMatch[1], 10);
        if (numericValue >= 2160) return '4K';
        else if (numericValue >= 1440) return '1440p';
        else if (numericValue >= 1080) return '1080p';
        else if (numericValue >= 720) return '720p';
        else if (numericValue >= 480) return '480p';
        else if (numericValue >= 360) return '360p';
        else if (numericValue >= 240) return '240p';
    }

    // If no specific resolution found, look for quality indicators
    const qualityMatch = text.match(/(WEB-DL|BluRay|HDRip|DVDRip|HDTV|CAM|TS|R5|DVDScr|BRRip|BDRip|DVD|PDTV|HD)/i);
    if (qualityMatch) {
        return qualityMatch[1];
    }

    return 'Unknown';
}

// Extract size from text
function extractSize(text) {
    const sizeMatch = (text || '').match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    return sizeMatch ? sizeMatch[1] + sizeMatch[2] : null;
}

// Get service name from URL
function getServiceName(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        if (hostname.includes('sharepoint')) return 'OneDrive';
        if (hostname.includes('hubcloud')) return 'HubCloud';
        if (hostname.includes('pixeldrain')) return 'Pixeldrain';
        if (hostname.includes('gofile')) return 'GoFile';

        // Extract domain name for unknown services
        const parts = hostname.split('.');
        if (parts.length >= 2) {
            return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
        }

        return 'Unknown Service';
    } catch (error) {
        return 'Unknown Service';
    }
}

// Helper function for HTTP requests with HTML parsing support
function makeHTTPRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        };

        const fetchOptions = {
            method: options.method || 'GET',
            headers: {
                ...defaultHeaders,
                ...options.headers
            },
            redirect: 'follow'
        };

        fetch(url, fetchOptions)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return response.text().then(data => {
                    if (options.parseHTML && data) {
                        const cheerio = require('cheerio-without-node-native');
                        const $ = cheerio.load(data);
                        resolve({ $: $, body: data, statusCode: response.status, headers: Object.fromEntries(response.headers) });
                    } else {
                        resolve({ body: data, statusCode: response.status, headers: Object.fromEntries(response.headers) });
                    }
                });
            })
            .catch(error => {
                console.error(`[MalluMV] Request failed for ${url}: ${error.message}`);
                reject(error);
            });
    });
}

// Search for content on MalluMV
function searchContent(title, year, mediaType) {
    const searchQuery = title.trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    const searchUrl = `${BASE_URL}/search.php?q=${encodedQuery}`;

    console.log(`[MalluMV] Searching for: "${searchQuery}" at ${searchUrl}`);

    return makeHTTPRequest(searchUrl)
        .then(response => response.body)
        .then(html => {
            // Check if search returned "No Result Found" - if so, return empty results
            if (html.includes('No Result Found. Showing Recent Movies:')) {
                console.log(`[MalluMV] No exact results found for "${title}" - returning empty results`);
                return [];
            }

            // Look for movie page links (without leading slash)
            const moviePageRegex = /<a href="(movie\/\d+\/[^"]+\.xhtml)">/g;
            const results = [];
            let match;

            while ((match = moviePageRegex.exec(html)) !== null) {
                const movieUrl = new URL('/' + match[1], BASE_URL).href;

                // Extract title from the link text (look for the text between <a> tags)
                const linkTextMatch = html.substring(match.index).match(/<a href="[^"]+">\s*<p class="home">\s*<font[^>]*>\s*<b>\s*»\s*([^<]+)/);
                const extractedTitle = linkTextMatch ? linkTextMatch[1].trim() : title;

                results.push({
                    title: extractedTitle,
                    url: movieUrl
                });
            }

            console.log(`[MalluMV] Found ${results.length} search results`);
            return results;
        })
        .catch(error => {
            console.log(`[MalluMV] Search failed: ${error.message}`);
            return [];
        });
}

// Extract download links from movie page
function extractDownloadLinks(pageUrl) {
    console.log(`[MalluMV] Extracting download links from: ${pageUrl}`);

    return makeHTTPRequest(pageUrl)
        .then(response => response.body)
        .then(html => {
            const downloadLinks = [];

            // Look for confirm page links with full titles
            // Pattern matches: [» Title with details](confirm/url)
            const confirmRegex = /\[»\s*([^\]]+)\]\((\/confirm\/\d+\/\d+\/[^)]+\.xhtml)\)/g;
            let match;

            while ((match = confirmRegex.exec(html)) !== null) {
                const confirmUrl = new URL(match[2], BASE_URL).href;
                const fullTitle = match[1].trim()
                    .replace(/&raquo;/g, '»')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");

                // Extract quality and size from full title
                const quality = extractQuality(fullTitle);
                const size = extractSize(fullTitle);

                downloadLinks.push({
                    url: confirmUrl,
                    text: fullTitle,
                    quality: quality,
                    size: size,
                    fullTitle: fullTitle
                });
            }

            // Fallback: if no matches found with the new pattern, try the old pattern
            if (downloadLinks.length === 0) {
                const fallbackRegex = /<a class="touh" href="(\/confirm\/\d+\/\d+\/[^"]+\.xhtml)">([^<]+)<\/a>/g;
                let fallbackMatch;

                while ((fallbackMatch = fallbackRegex.exec(html)) !== null) {
                    const confirmUrl = new URL(fallbackMatch[1], BASE_URL).href;
                    const linkText = fallbackMatch[2].trim()
                        .replace(/&raquo;/g, '»')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'");

                    // Extract quality and size from link text
                    const quality = extractQuality(linkText);
                    const size = extractSize(linkText);

                    downloadLinks.push({
                        url: confirmUrl,
                        text: linkText,
                        quality: quality,
                        size: size,
                        fullTitle: linkText
                    });
                }
            }

            console.log(`[MalluMV] Found ${downloadLinks.length} download links`);
            return downloadLinks;
        })
        .catch(error => {
            console.error(`[MalluMV] Error extracting download links from ${pageUrl}: ${error.message}`);
            return [];
        });
}

// Process confirm page to get internal page URL
function processConfirmLink(confirmPageUrl) {
    console.log(`[MalluMV] Processing confirm page: ${confirmPageUrl}`);

    return makeHTTPRequest(confirmPageUrl)
        .then(response => response.body)
        .then(html => {
            // Look for the "Confirm Download" link that leads to internal page
            const internalMatch = html.match(/<a class="touch" href="(\/internal\/\d+\/\d+\/[^"]+\.xhtml)">/);

            if (internalMatch) {
                const internalUrl = new URL(internalMatch[1], BASE_URL).href;
                console.log(`[MalluMV] Found internal page URL: ${internalUrl}`);
                return internalUrl;
            } else {
                console.log(`[MalluMV] No internal page URL found in confirm page`);
                return null;
            }
        })
        .catch(error => {
            console.error(`[MalluMV] Error processing confirm link ${confirmPageUrl}: ${error.message}`);
            return null;
        });
}

// Process internal page to get final download URL
function processInternalLink(internalPageUrl, quality, size, fullTitle) {
    console.log(`[MalluMV] Processing internal page: ${internalPageUrl}`);

    return makeHTTPRequest(internalPageUrl)
        .then(response => response.body)
        .then(html => {
            // Check for HubCloud links FIRST
            const hubCloudMatch = html.match(/<a href=["'](https:\/\/[^"']*hubcloud\.[^"']*)["']/);
            if (hubCloudMatch) {
                const hubCloudUrl = hubCloudMatch[1];
                console.log(`[MalluMV] Found HubCloud URL, extracting streams...`);

                // Use DVDPlay's HubCloud extractor
                return extractHubCloudLinks(hubCloudUrl, 'MalluMV')
                    .then(streams => {
                        // Update stream names and metadata
                        return streams.map(stream => {
                            const finalQuality = quality || stream.quality;
                            let newName = stream.name.replace('DVDPlay', 'MalluMV');

                            // If quality is improved/available and name has 'Unknown', update it
                            if (finalQuality && finalQuality !== 'Unknown') {
                                if (newName.includes(' - Unknown')) {
                                    newName = newName.replace(' - Unknown', ' - ' + finalQuality);
                                    // Add 'p' if missing
                                    if (!newName.endsWith('p') && /^\d+$/.test(finalQuality)) {
                                        newName += 'p';
                                    }
                                }
                            }

                            return {
                                ...stream,
                                name: newName,
                                size: size || stream.size,
                                quality: finalQuality
                            };
                        });
                    });
            }

            // Fall back to direct download patterns
            const downloadPatterns = [
                // OneDrive/SharePoint pattern
                /<a href=["'](https:\/\/[^"']*sharepoint\.com[^"']*download\.aspx[^"']*)["']/,
                // Pixeldrain pattern
                /<a href=["'](https:\/\/[^"']*pixeldrain\.[^"']*)["']/,
                // Generic download link
                /<a href=["'](https:\/\/[^"']*)["'][^>]*>Download/
            ];

            for (const pattern of downloadPatterns) {
                const match = html.match(pattern);
                if (match) {
                    const downloadUrl = match[1];
                    const serviceName = getServiceName(downloadUrl);
                    const qualityLabel = quality ? (' - ' + quality) : '';

                    console.log(`[MalluMV] Found download URL: ${downloadUrl.substring(0, 80)}...`);

                    return [{
                        name: `MalluMV - ${serviceName}${qualityLabel}`,
                        title: fullTitle || `${quality || 'Unknown'} Quality`,
                        url: downloadUrl,
                        quality: quality || 'Unknown',
                        size: size || 'Unknown',
                        headers: WORKING_HEADERS,
                        provider: 'mallumv'
                    }];
                }
            }

            console.log(`[MalluMV] No download URL found in internal page`);
            return [];
        })
        .catch(error => {
            console.error(`[MalluMV] Error processing internal link ${internalPageUrl}: ${error.message}`);
            return [];
        });
}

// TMDB helper
function getTMDBDetails(tmdbId, mediaType) {
    var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    return makeHTTPRequest(url).then(function (res) { return JSON.parse(res.body); }).then(function (data) {
        if (mediaType === 'movie') {
            return { title: data.title, original_title: data.original_title, year: data.release_date ? data.release_date.split('-')[0] : null };
        } else {
            return { title: data.name, original_title: data.original_name, year: data.first_air_date ? data.first_air_date.split('-')[0] : null };
        }
    }).catch(function () { return null; });
}

// Filter and deduplicate streams (match hdhub4u.js quality standards)
function filterAndDeduplicateStreams(streams) {
    // Filter suspicious URLs
    const suspicious = ['www-google-com.cdn.ampproject.org', 'bloggingvector.shop', 'cdn.ampproject.org'];
    const filtered = streams.filter(stream => {
        const url = (stream.url || '').toLowerCase();

        // Filter ZIP files
        if (url.includes('.zip') || (stream.title && stream.title.toLowerCase().includes('.zip'))) {
            return false;
        }

        // Filter suspicious AMP/redirect URLs
        if (suspicious.some(pattern => url.includes(pattern))) {
            return false;
        }

        // Filter base64 encoded URLs (likely intermediate redirects)
        if (url.includes('/aHR0cHM6') || url.includes('/foo/aHR0')) {
            return false;
        }

        return true;
    });

    // Resolve gamerxyt.com/dl.php?link= URLs to extract actual Google Drive URLs
    const resolvedStreams = filtered.map(stream => {
        const url = stream.url;

        // Check if it's a gamerxyt.com/dl.php?link= URL
        if (url.includes('gamerxyt.com/dl.php?link=')) {
            try {
                // Extract the actual Google Drive URL from the link parameter
                const linkMatch = url.match(/gamerxyt\.com\/dl\.php\?link=([^&\s]+)/);
                if (linkMatch && linkMatch[1]) {
                    const actualUrl = decodeURIComponent(linkMatch[1]);
                    console.log(`[MalluMV] Resolved gamerxyt URL: ${url.substring(0, 80)}... -> ${actualUrl.substring(0, 80)}...`);

                    return {
                        ...stream,
                        url: actualUrl
                    };
                }
            } catch (error) {
                console.log(`[MalluMV] Failed to resolve gamerxyt URL: ${error.message}`);
            }
        }

        return stream;
    });

    // Deduplicate by URL
    const seenUrls = new Set();
    const unique = resolvedStreams.filter(stream => {
        if (seenUrls.has(stream.url)) return false;
        seenUrls.add(stream.url);
        return true;
    });

    return unique;
}

// Main function that Nuvio will call
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[MalluMV] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    var tmdbType = (mediaType === 'series' ? 'tv' : mediaType);
    return getTMDBDetails(tmdbId, tmdbType).then(function (tmdb) {
        if (!tmdb || !tmdb.title) return [];

        console.log(`[MalluMV] TMDB Info: "${tmdb.title}" (${tmdb.year})`);

        // Search for content
        return searchContent(tmdb.title, tmdb.year, mediaType).then(searchResults => {
            if (searchResults.length === 0) {
                console.log(`[MalluMV] No search results found`);
                return [];
            }

            // Find best match
            const selectedResult = findBestMatch(searchResults, tmdb.title);
            if (!selectedResult) {
                console.log(`[MalluMV] No suitable match found for "${tmdb.title}"`);
                return [];
            }
            console.log(`[MalluMV] Selected result: "${selectedResult.title}"`);

            // Extract download links from movie page
            return extractDownloadLinks(selectedResult.url).then(downloadLinks => {
                if (downloadLinks.length === 0) {
                    console.log(`[MalluMV] No download links found`);
                    return [];
                }

                // Process each download link: confirm → internal → final
                const streamPromises = downloadLinks.map(downloadLink => {
                    return processConfirmLink(downloadLink.url)
                        .then(internalUrl => {
                            if (!internalUrl) return [];
                            return processInternalLink(internalUrl, downloadLink.quality, downloadLink.size, downloadLink.fullTitle);
                        })
                        .catch(error => {
                            console.error(`[MalluMV] Error processing download link: ${error.message}`);
                            return [];
                        });
                });

                return Promise.all(streamPromises).then(nestedStreams => {
                    // Flatten array of arrays
                    let allStreams = nestedStreams.flat();

                    // Filter out empty results
                    let validStreams = allStreams.filter(stream => stream !== null && stream.url);

                    // Remove duplicates based on URL
                    const uniqueStreams = Array.from(new Map(validStreams.map(stream => [stream.url, stream])).values());

                    // Sort by size first (largest first), then by quality (highest first)
                    uniqueStreams.sort((a, b) => {
                        // Parse sizes to numbers for comparison
                        const sizeA = parseSizeForSort(a.size);
                        const sizeB = parseSizeForSort(b.size);

                        // If sizes are different, sort by size (largest first)
                        if (sizeA !== sizeB) {
                            return sizeB - sizeA;
                        }

                        // If sizes are equal, sort by quality (highest first)
                        const qualityA = parseQualityForSort(a.quality);
                        const qualityB = parseQualityForSort(b.quality);
                        return qualityB - qualityA;
                    });

                    // Filter and deduplicate streams (match hdhub4u.js quality)
                    const filteredStreams = filterAndDeduplicateStreams(uniqueStreams);

                    console.log(`[MalluMV] Successfully processed ${uniqueStreams.length} streams`);
                    console.log(`[MalluMV] After filtering: ${filteredStreams.length} quality streams`);
                    return filteredStreams;
                });
            });
        });
    }).catch(function (error) {
        console.error(`[MalluMV] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export for React Native
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "mallumv", ["movie"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "MalluMV", "mallumv");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
