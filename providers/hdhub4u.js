// HDHub4u Scraper for Nuvio Local Scrapers
// React Native compatible version with full original functionality

const cheerio = require('cheerio-without-node-native');

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_PROVIDER_REPAIR_V17 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
function vueoTrace(stage, details) {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function vueoContextFromRaw(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

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



// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// HDHub4u Configuration
let MAIN_URL = "https://new8.hdhub4u.cl";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
let domainCacheTimestamp = 0;
let domainFetchInFlight = null;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Cookie": "xla=s4t",
    "Referer": `${MAIN_URL}/`,
};

// =================================================================================
// UTILITY FUNCTIONS (from Utils.kt)
// =================================================================================

// Format bytes to human readable size
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Extract server name from source string
function extractServerName(source) {
    if (!source) return 'Unknown';

    // Handle different source formats
    if (source.startsWith('HubCloud')) {
        // Extract server type (FSL Server, S3 Server, BuzzServer, 10Gbps, etc.)
        const serverMatch = source.match(/HubCloud(?:\s*-\s*([^[\]]+))?/);
        return serverMatch ? (serverMatch[1] || 'Download') : 'HubCloud';
    }

    if (source.startsWith('Pixeldrain')) return 'Pixeldrain';
    if (source.startsWith('StreamTape')) return 'StreamTape';
    if (source.startsWith('HubCdn')) return 'HubCdn';
    if (source.startsWith('HbLinks')) return 'HbLinks';
    if (source.startsWith('Hubstream')) return 'Hubstream';

    // For other sources, clean up the hostname
    return source.replace(/^www\./, '').split('.')[0];
}

/**
 * Applies a ROT13 cipher to a string.
 * Replicates the `pen()` function from Utils.kt.
 * @param {string} value The input string.
 * @returns {string} The ROT13'd string.
 */
function rot13(value) {
    return value.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

// React Native-safe Base64 polyfill (no Buffer dependency)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function atob(value) {
    if (!value) return '';
    let input = String(value).replace(/=+$/, '');
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
    return output;
}

function btoa(value) {
    if (value == null) return '';
    let str = String(value);
    let output = '';
    let i = 0;
    while (i < str.length) {
        const chr1 = str.charCodeAt(i++);
        const chr2 = str.charCodeAt(i++);
        const chr3 = str.charCodeAt(i++);

        const enc1 = chr1 >> 2;
        const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        let enc4 = chr3 & 63;

        if (isNaN(chr2)) {
            enc3 = 64;
            enc4 = 64;
        } else if (isNaN(chr3)) {
            enc4 = 64;
        }

        output +=
            BASE64_CHARS.charAt(enc1) +
            BASE64_CHARS.charAt(enc2) +
            BASE64_CHARS.charAt(enc3) +
            BASE64_CHARS.charAt(enc4);
    }
    return output;
}

/**
 * Cleans title by extracting quality and codec information.
 * Replicates the `cleanTitle` function from Utils.kt.
 * @param {string} title The title string to clean.
 * @returns {string} The cleaned title with quality/codec info.
 */
function cleanTitle(title) {
    const parts = title.split(/[.\-_]/);

    const qualityTags = [
        "WEBRip", "WEB-DL", "WEB", "BluRay", "HDRip", "DVDRip", "HDTV",
        "CAM", "TS", "R5", "DVDScr", "BRRip", "BDRip", "DVD", "PDTV", "HD"
    ];

    const audioTags = [
        "AAC", "AC3", "DTS", "MP3", "FLAC", "DD5", "EAC3", "Atmos"
    ];

    const subTags = [
        "ESub", "ESubs", "Subs", "MultiSub", "NoSub", "EnglishSub", "HindiSub"
    ];

    const codecTags = [
        "x264", "x265", "H264", "HEVC", "AVC"
    ];

    const startIndex = parts.findIndex(part =>
        qualityTags.some(tag => part.toLowerCase().includes(tag.toLowerCase()))
    );

    let endIndex = -1;
    for (let e = parts.length - 1; e >= 0; e--) {
        const part = parts[e];
        if (subTags.some(tag => part.toLowerCase().includes(tag.toLowerCase())) ||
            audioTags.some(tag => part.toLowerCase().includes(tag.toLowerCase())) ||
            codecTags.some(tag => part.toLowerCase().includes(tag.toLowerCase()))) { endIndex = e; break; }
    }

    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
        return parts.slice(startIndex, endIndex + 1).join(".");
    } else if (startIndex !== -1) {
        return parts.slice(startIndex).join(".");
    } else {
        return parts.slice(-3).join(".");
    }
}

/**
 * Fetches the latest domain for HDHub4u.
 * Replicates the `getDomains` function from the provider.
 */
function fetchAndUpdateDomain() {
    const now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) return Promise.resolve();
    if (domainFetchInFlight) return domainFetchInFlight;
    domainFetchInFlight = fetch(DOMAINS_URL, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }).then(function(response) {
        if (!response.ok) return null;
        return response.json();
    }).then(function(data) {
        if (data && data.HDHUB4u) {
            let newDomain;
            try {
                const parsed = new URL(String(data.HDHUB4u));
                if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)hdhub4u\.[a-z]+$/i.test(parsed.hostname) || parsed.hostname.endsWith('.free') || parsed.username || parsed.password) return null;
                newDomain = parsed.origin;
            } catch (_) { return null; }
            if (newDomain !== MAIN_URL) {
                MAIN_URL = newDomain;
                HEADERS.Referer = MAIN_URL + '/';
            }
        }
        domainCacheTimestamp = Date.now();
    }).catch(function(error) {
        console.error('[HDHub4u] Failed to fetch latest domains: ' + error.message);
    }).then(function() {
        domainFetchInFlight = null;
    });
    return domainFetchInFlight;
}

/**
 * Gets the current domain, ensuring it's always up to date.
 * Should be called before any main site requests.
 */
function getCurrentDomain() {
    return fetchAndUpdateDomain().then(function() {
        return MAIN_URL;
    });
}

/**
 * Resolves obfuscated redirector links (e.g., hubdrive.fit/?id=...).
 * This is a direct translation of the `getRedirectLinks` function from `Utils.kt`.
 * @param {string} url The obfuscated URL.
 * @returns {Promise<string>} The resolved direct link.
 */
function getRedirectLinks(url) {
    return fetch(url, { headers: HEADERS })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.text();
        })
        .then(doc => {
            const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let combinedString = '';
            let match;
            while ((match = regex.exec(doc)) !== null) {
                const extractedValue = match[1] || match[2];
                if (extractedValue) {
                    combinedString += extractedValue;
                }
            }

            if (!combinedString) {
                console.error("[getRedirectLinks] Could not find encoded strings in page.");
                return url;
            }

            const decodedString = atob(rot13(atob(atob(combinedString))));
            const jsonObject = JSON.parse(decodedString);

            const encodedUrl = atob(jsonObject.o || '').trim();
            if (encodedUrl) {
                return encodedUrl;
            }

            const data = btoa(jsonObject.data || '').trim();
            const wpHttp = (jsonObject.blog_url || '').trim();
            if (wpHttp && data) {
                return fetch(`${wpHttp}?re=${data}`, { headers: HEADERS })
                    .then(directLinkResponse => directLinkResponse.text())
                    .then(text => text.trim());
            }

            return url; // Return original url if logic fails
        })
        .catch(e => {
            console.error(`[getRedirectLinks] Error processing link ${url}:`, e.message);
            return url; // Fallback to original URL
        });
}

// =================================================================================
// EXTRACTORS (from Extractors.kt)
// =================================================================================

/**
 * Extract direct download link from Pixeldrain.
 * Pixeldrain direct link format: https://pixeldrain.com/api/file/{id}?download
 */
function pixelDrainExtractor(link) {
    return Promise.resolve().then(() => {
        let fileId;
        // link can be pixeldrain.com/u/{id} or pixeldrain.dev/... or pixeldrain.xyz/...
        const match = link.match(/(?:file|u)\/([A-Za-z0-9]+)/);
        if (match) {
            fileId = match[1];
        } else {
            fileId = link.split('/').pop();
        }
        if (!fileId) {
            return [{ source: 'Pixeldrain', quality: 'Unknown', url: link }];
        }

        // Fetch file info to get the name, size, and determine quality
        const infoUrl = `https://pixeldrain.com/api/file/${fileId}/info`;
        let fileInfo = { name: '', quality: 'Unknown', size: 0 };

        return fetch(infoUrl, { headers: HEADERS })
            .then(response => response.json())
            .then(info => {
                if (info && info.name) {
                    fileInfo.name = info.name;
                    fileInfo.size = info.size || 0;

                    // Infer quality from filename
                    const qualityMatch = info.name.match(/(\d{3,4})p/);
                    if (qualityMatch) {
                        fileInfo.quality = qualityMatch[0];
                    }
                }
                const directUrl = `https://pixeldrain.com/api/file/${fileId}?download`;
                return [{
                    source: 'Pixeldrain',
                    quality: fileInfo.quality,
                    url: directUrl,
                    name: fileInfo.name,
                    size: fileInfo.size,
                }];
            })
            .catch(e => {
                console.warn(`[Pixeldrain] Could not fetch file info for ${fileId}:`, e.message);
                const directUrl = `https://pixeldrain.com/api/file/${fileId}?download`;
                return [{
                    source: 'Pixeldrain',
                    quality: fileInfo.quality,
                    url: directUrl,
                    name: fileInfo.name,
                    size: fileInfo.size,
                }];
            });
    }).catch(e => {
        console.error('[Pixeldrain] extraction failed', e.message);
        return [{ source: 'Pixeldrain', quality: 'Unknown', url: link }];
    });
}

/**
 * Extract streamable URL from StreamTape.
 * This function normalizes the URL to streamtape.com and tries to find the direct video link.
 */
function streamTapeExtractor(link) {
    // Streamtape has many domains, but .com is usually the most reliable for video pages.
    const url = new URL(link);
    url.hostname = 'streamtape.com';
    const normalizedLink = url.toString();

    return fetch(normalizedLink, { headers: HEADERS })
        .then(res => res.text())
        .then(data => {
            // Regex to find something like: document.getElementById('videolink').innerHTML = ...
            const match = data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/);

            if (match && match[1]) {
                const scriptContent = match[1];
                // The script might contain a direct URL part or a function call to build it. We look for the direct part.
                const urlPartMatch = scriptContent.match(/'(\/\/streamtape\.com\/get_video[^']+)'/);

                if (urlPartMatch && urlPartMatch[1]) {
                    const videoSrc = 'https:' + urlPartMatch[1];
                    return [{ source: 'StreamTape', quality: 'Stream', url: videoSrc }];
                }
            }

            // A simpler, secondary regex if the above fails (e.g., the script is not complex).
            const simpleMatch = data.match(/'(\/\/streamtape\.com\/get_video[^']+)'/);
            if (simpleMatch && simpleMatch[0]) {
                const videoSrc = 'https:' + simpleMatch[0].slice(1, -1); // remove quotes
                return [{ source: 'StreamTape', quality: 'Stream', url: videoSrc }];
            }

            // If we reach here, the link is likely dead or protected. Return nothing.
            return [];
        })
        .catch(e => {
            // A 404 error just means the link is dead. We can ignore it and return nothing.
            if (!e.response || e.response.status !== 404) {
                console.error(`[StreamTape] An unexpected error occurred for ${normalizedLink}:`, e.message);
            }
            return []; // Return empty array on any failure
        });
}

function hubStreamExtractor(url, referer) {
    return fetch(url, { headers: { ...HEADERS, Referer: referer } })
        .then(response => {
            // For now, return the URL as-is since VidStack extraction is complex
            return [{ source: 'Hubstream', quality: 'Unknown', url }];
        })
        .catch(e => {
            console.error(`[Hubstream] Failed to extract from ${url}:`, e.message);
            return [];
        });
}

function hbLinksExtractor(url, referer) {
    return fetch(url, { headers: { ...HEADERS, Referer: referer } })
        .then(response => response.text())
        .then(data => {
            const $ = cheerio.load(data);
            const links = $('h3 a, div.entry-content p a').map((i, el) => $(el).attr('href')).get();

            const finalLinks = [];
            const promises = links.map(link => loadExtractor(link, url));

            return Promise.all(promises)
                .then(results => {
                    results.forEach(extracted => finalLinks.push(...extracted));
                    return finalLinks;
                });
        });
}

function hubCdnExtractor(url, referer) {
    return fetch(url, { headers: { ...HEADERS, Referer: referer } })
        .then(response => response.text())
        .then(data => {
            const encodedMatch = data.match(/r=([A-Za-z0-9+/=]+)/);
            if (encodedMatch && encodedMatch[1]) {
                const m3u8Data = atob(encodedMatch[1]);
                const m3u8Link = m3u8Data.substring(m3u8Data.lastIndexOf('link=') + 5);
                return [{
                    source: 'HubCdn',
                    quality: 'M3U8',
                    url: m3u8Link,
                }];
            }
            return [];
        })
        .catch(() => []);
}

function hubDriveExtractor(url, referer) {
    return fetch(url, { headers: { ...HEADERS, Referer: referer } })
        .then(response => response.text())
        .then(data => {
            const $ = cheerio.load(data);
            const href = $('.btn.btn-primary.btn-user.btn-success1.m-1').attr('href');
            if (href) {
                return loadExtractor(href, url);
            }
            return [];
        })
        .catch(() => []);
}

function hubCloudExtractor(url, referer) {
    let currentUrl = url;
    // Replicate domain change logic from HubCloud extractor
    if (currentUrl.includes("hubcloud.ink")) {
        currentUrl = currentUrl.replace("hubcloud.ink", "hubcloud.dad");
    }

    return fetch(currentUrl, { headers: { ...HEADERS, Referer: referer } })
        .then(pageResponse => pageResponse.text())
        .then(pageData => {
            let finalUrl = currentUrl;

            if (!currentUrl.includes("hubcloud.php")) {
                const scriptUrlMatch = pageData.match(/var url = '([^']*)'/);
                if (scriptUrlMatch && scriptUrlMatch[1]) {
                    finalUrl = scriptUrlMatch[1];
                    return fetch(finalUrl, { headers: { ...HEADERS, Referer: currentUrl } })
                        .then(secondResponse => secondResponse.text())
                        .then(secondData => ({ pageData: secondData, finalUrl }));
                }
            }
            return { pageData, finalUrl };
        })
        .then(({ pageData, finalUrl }) => {
            const $ = cheerio.load(pageData);
            const size = $('i#size').text().trim();
            const header = $('div.card-header').text().trim();

            // Use the same quality detection logic as Kotlin code
            const getIndexQuality = (str) => {
                const match = (str || '').match(/(\d{3,4})[pP]/);
                return match ? parseInt(match[1]) : 2160; // Default to 4K if not found
            };

            const quality = getIndexQuality(header);
            const headerDetails = cleanTitle(header);

            // Build label extras like in Kotlin code
            const labelExtras = (() => {
                let extras = '';
                if (headerDetails) extras += `[${headerDetails}]`;
                if (size) extras += `[${size}]`;
                return extras;
            })();

            // Convert human-readable size to bytes for consistency
            const sizeInBytes = (() => {
                if (!size) return 0;
                const sizeMatch = size.match(/([\d.]+)\s*(GB|MB|KB)/i);
                if (!sizeMatch) return 0;

                const value = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2].toUpperCase();

                if (unit === 'GB') return value * 1024 * 1024 * 1024;
                if (unit === 'MB') return value * 1024 * 1024;
                if (unit === 'KB') return value * 1024;
                return 0;
            })();

            const links = [];
            const elements = $('div.card-body h2 a.btn').get();

                // Process each element, converting async operations to promises
            const processElements = elements.map(element => {
                const link = $(element).attr('href');
                const text = $(element).text();
                const sourceName = text.trim();

                // Use the actual file name from the HubCloud page header (full name, not cleaned)
                const fileName = header || headerDetails || 'Unknown';

                if (text.includes("Download File")) {
                    links.push({ source: `HubCloud ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                    return Promise.resolve();
                } else if (text.includes("FSL Server")) {
                    links.push({ source: `HubCloud - FSL Server ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                    return Promise.resolve();
                } else if (text.includes("S3 Server")) {
                    links.push({ source: `HubCloud - S3 Server ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                    return Promise.resolve();
                } else if (text.includes("BuzzServer")) {
                    return fetch(`${link}/download`, {
                        method: 'GET',
                        headers: { ...HEADERS, Referer: link },
                        redirect: 'manual' // Do not follow redirects automatically
                    })
                    .then(buzzResp => {
                        if (buzzResp.status >= 300 && buzzResp.status < 400) {
                            // It's a redirect, get the location header
                            const location = buzzResp.headers.get('location');
                            if (location && location.includes('hx-redirect=')) {
                                const hxRedirectMatch = location.match(/hx-redirect=([^&]+)/);
                                if (hxRedirectMatch) {
                                    const dlink = decodeURIComponent(hxRedirectMatch[1]);
                                    links.push({ source: `HubCloud - BuzzServer ${labelExtras}`, quality, url: dlink, size: sizeInBytes, fileName });
                                }
                            }
                        }
                    })
                    .catch(e => {
                        console.error("[HubCloud] BuzzServer redirect failed for", link, e.message);
                    });
                } else if (link.includes("pixeldra")) {
                    links.push({ source: `Pixeldrain ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                    return Promise.resolve();
                } else if (text.includes("10Gbps")) {
                    let currentRedirectUrl = link;
                    let finalLink = null;

                    const processRedirects = (i) => {
                        if (i >= 5) return Promise.resolve(finalLink);

                        return fetch(currentRedirectUrl, {
                            method: 'GET',
                            redirect: 'manual' // Don't follow redirects automatically
                        })
                            .then(response => {
                                if (response.status >= 300 && response.status < 400) {
                                    const location = response.headers.get('location');
                                    if (location) {
                                        if (location.includes("link=")) {
                                            finalLink = location.substring(location.indexOf("link=") + 5);
                                            return finalLink;
                                        }
                                        currentRedirectUrl = new URL(location, currentRedirectUrl).toString();
                                        return processRedirects(i + 1);
                                    }
                                }
                                return finalLink;
                            })
                            .catch(e => {
                                console.error("[HubCloud] 10Gbps redirect failed for", currentRedirectUrl, e.message);
                                return finalLink;
                            });
                    };

                    return processRedirects(0).then(finalLink => {
                        if (finalLink) {
                            links.push({ source: `HubCloud - 10Gbps ${labelExtras}`, quality, url: finalLink, size: sizeInBytes, fileName });
                        }
                    });
                } else {
                    // For other buttons, try the generic extractor
                    return loadExtractor(link, finalUrl).then(extracted => {
                        links.push(...extracted);
                    });
                }
            });

            return Promise.all(processElements).then(() => links);
        })
        .catch(() => []);
}

/**
 * Main extractor dispatcher. Determines which specific extractor to use based on the URL.
 * Replicates the `loadExtractor` logic flow.
 * @param {string} url The URL of the hoster page.
 * @param {string} referer The referer URL.
 * @returns {Promise<Array<{quality: string, url: string, source: string}>>} A list of final links.
 */
function loadExtractor(url, referer = MAIN_URL) {
    const hostname = new URL(url).hostname;

    // Some links from the main site are redirectors that need to be resolved first.
    if (url.includes("?id=") || hostname.includes('techyboy4u')) {
        return getRedirectLinks(url)
            .then(finalLink => {
                if (!finalLink) {
                    return []; // Stop if redirect fails
                }
                // Recursively call loadExtractor with the new link
                return loadExtractor(finalLink, url);
            });
    }

    if (hostname.includes('hubcloud')) {
        return hubCloudExtractor(url, referer);
    }
    if (hostname.includes('hubdrive')) {
        return hubDriveExtractor(url, referer);
    }
    if (hostname.includes('hubcdn')) {
        return hubCdnExtractor(url, referer);
    }
    if (hostname.includes('hblinks')) {
        return hbLinksExtractor(url, referer);
    }
    if (hostname.includes('hubstream')) {
        return hubStreamExtractor(url, referer);
    }
    if (hostname.includes('pixeldrain')) {
        return pixelDrainExtractor(url);
    }
    if (hostname.includes('streamtape')) {
        return streamTapeExtractor(url);
    }
    if (hostname.includes('hdstream4u')) {
        // This is VidHidePro, often a simple redirect. For this script, we assume it's a direct link.
        return Promise.resolve([{ source: 'HdStream4u', quality: 'Unknown', url }]);
    }

    // Skip unsupported hosts like linkrit.com
    if (hostname.includes('linkrit')) {
        return Promise.resolve([]);
    }

    // Default case for unknown extractors, use the hostname as the source.
    const sourceName = hostname.replace(/^www\./, '');
    return Promise.resolve([{ source: sourceName, quality: 'Unknown', url }]);
}

// =================================================================================
// MAIN PROVIDER LOGIC (from HDhub4uProvider.kt)
// =================================================================================

/**
 * Searches for media on HDHub4u.
 * @param {string} query The search term.
 * @returns {Promise<Array<{title: string, url: string, poster: string}>>} A list of search results.
 */
function search(query) {
    return getCurrentDomain()
        .then(currentDomain => {
            const searchUrl = `${currentDomain}/?s=${encodeURIComponent(query)}`;
            return fetch(searchUrl, { headers: HEADERS });
        })
        .then(response => response.text())
        .then(data => {
            const $ = cheerio.load(data);
            return $('.recent-movies > li.thumb').map((i, el) => {
                const element = $(el);
                const title = element.find('figcaption:nth-child(2) > a:nth-child(1) > p:nth-child(1)').text().trim();

                // Extract year from title (look for 4-digit numbers in parentheses or after title)
                const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
                const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;

                return {
                    title: title,
                    url: element.find('figure:nth-child(1) > a:nth-child(2)').attr('href'),
                    poster: element.find('figure:nth-child(1) > img:nth-child(1)').attr('src'),
                    year: year
                };
            }).get();
        });
}

/**
 * Fetches enhanced metadata from Cinemeta API using IMDB ID.
 * Replicates the Cinemeta integration from the Kotlin provider.
 */
function getCinemetaData(imdbId, tvType) {
    if (!imdbId) return Promise.resolve(null);

    const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${tvType}/${imdbId}.json`;
    return fetch(cinemetaUrl)
        .then(response => response.json())
        .catch(e => {
            console.error(`[Cinemeta] Failed to fetch metadata for ${imdbId}:`, e.message);
            return null;
        });
}

/**
 * Fetches the media page and extracts all hoster links.
 * This combines the logic of `load()` and `loadLinks()` from the Kotlin provider.
 * @param {string} mediaUrl The URL of the movie or TV show page.
 * @returns {Promise<Array<any>>} A list of all final, extracted download links.
 */
function getDownloadLinks(mediaUrl) {
    return getCurrentDomain()
        .then(currentDomain => {
            HEADERS.Referer = `${currentDomain}/`;
            return fetch(mediaUrl, { headers: HEADERS });
        })
        .then(response => response.text())
        .then(data => {
            const $ = cheerio.load(data);

            const typeRaw = $('h1.page-title span').text();
            const isMovie = typeRaw.toLowerCase().includes('movie');

            // Extract title and season number like in Kotlin code
            const title = $('.page-body h2[data-ved="2ahUKEwjL0NrBk4vnAhWlH7cAHRCeAlwQ3B0oATAfegQIFBAM"], h2[data-ved="2ahUKEwiP0pGdlermAhUFYVAKHV8tAmgQ3B0oATAZegQIDhAM"]').text();
            const seasonMatch = title.match(/\bSeason\s*(\d+)\b/i);
            const seasonNumber = seasonMatch ? parseInt(seasonMatch[1]) : null;

            let initialLinks = [];

            if (isMovie) {
                // Replicate the exact Kotlin selector: "h3 a:matches(480|720|1080|2160|4K), h4 a:matches(480|720|1080|2160|4K)"
                // Find anchor tags inside h3/h4 whose text contains quality numbers
                const qualityLinks = $('h3 a, h4 a').filter((i, el) => {
                    const linkText = $(el).text();
                    return linkText.match(/480|720|1080|2160|4K/i);
                });

                initialLinks = qualityLinks.map((i, el) => ({ url: $(el).attr('href') })).get();

                // Remove duplicates and invalid URLs
                const seen = new Set();
                initialLinks = initialLinks.filter(link => {
                    if (!link.url || seen.has(link.url)) {
                        return false;
                    }
                    seen.add(link.url);
                    return true;
                });

                console.log(`Found ${initialLinks.length} initial hoster links. Now extracting...`);

                // Process all links in parallel
                const promises = initialLinks.map(linkInfo =>
                    loadExtractor(linkInfo.url, mediaUrl)
                        .then(extractedLinks => extractedLinks)
                        .catch(e => {
                            console.error(`Failed to extract from ${linkInfo.url}:`, e.message);
                            return [];
                        })
                );

                return Promise.all(promises)
                    .then(results => {
                        const allFinalLinks = [];
                        results.forEach(res => allFinalLinks.push(...res));

                        // Remove exact duplicate URLs and zip files
                        const seenUrls = new Set();
                        const uniqueFinalLinks = allFinalLinks.filter(link => {
                            // Filter out zip files
                            if (link.url && (link.url.includes('.zip') || (link.name && link.name.toLowerCase().includes('.zip')))) {
                                return false;
                            }
                            // Filter out duplicates
                            if (seenUrls.has(link.url)) {
                                return false;
                            }
                            seenUrls.add(link.url);
                            return true;
                        });

                        return { finalLinks: uniqueFinalLinks, isMovie };
                    });
            } else { // TV Series
                const episodeLinksMap = new Map();

                // First, look for quality-specific redirect links (like 1080p techyboy4u.com links)
                $('h3 a, h4 a').each((i, element) => {
                    const $el = $(element);
                    const text = $el.text();
                    const href = $el.attr('href');

                    // Check if this is a quality link (1080p, 720p, etc.) that might lead to episode links
                    if (text.match(/1080|720|4K|2160/i) && href && href.includes('techyboy4u.com')) {
                        // This is likely a redirect to a page with episode links
                        initialLinks.push({ url: href, isQualityRedirect: true });
                    }
                });

                // Then, try to find episode links in h4 elements (common structure)
                $('h4').each((i, element) => {
                    const $el = $(element);
                    const text = $el.text();
                    // Match both "EPiSODE 1" and "E01" formats
                    const episodeMatch = text.match(/(?:EPiSODE\s*(\d+)|E(\d+))/i);

                    if (episodeMatch) {
                        const epNum = parseInt(episodeMatch[1] || episodeMatch[2]);
                        if (!episodeLinksMap.has(epNum)) episodeLinksMap.set(epNum, []);

                        // Get all links from this h4 element
                        const links = $el.find('a').map((i, a) => $(a).attr('href')).get();
                        episodeLinksMap.get(epNum).push(...links);
                    }
                });

                // If no episodes found in h4, try the original logic with h3/h4
                if (episodeLinksMap.size === 0) {
                    const processElementsPromises = $('h3, h4').get().map(element => {
                        const $el = $(element);
                        const title = $el.text();
                        // Match both "EPiSODE 1" and "E01" formats
                        const episodeMatch = title.match(/(?:EPiSODE\s*(\d+)|E(\d+))/i);
                        const epNum = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;

                        const isDirectLinkBlock = $el.find('a').text().match(/1080|720|4K|2160/i);

                        if (isDirectLinkBlock) {
                            const redirectLinks = $el.find('a').map((i, a) => $(a).attr('href')).get();
                            return Promise.all(redirectLinks.map(redirectLink =>
                                getRedirectLinks(redirectLink)
                                    .then(resolvedUrl =>
                                        fetch(resolvedUrl, { headers: HEADERS })
                                            .then(episodeDocPage => episodeDocPage.text())
                                            .then(episodeDocData => {
                                                const $$ = cheerio.load(episodeDocData);
                                                $$('h5 a').each((i, linkEl) => {
                                                    const linkText = $$(linkEl).text();
                                                    const linkHref = $$(linkEl).attr('href');
                                                    const innerEpMatch = linkText.match(/Episode\s*(\d+)/i);
                                                    if (innerEpMatch && linkHref) {
                                                        const innerEpNum = parseInt(innerEpMatch[1]);
                                                        if (!episodeLinksMap.has(innerEpNum)) episodeLinksMap.set(innerEpNum, []);
                                                        episodeLinksMap.get(innerEpNum).push(linkHref);
                                                    }
                                                });
                                            })
                                    )
                                    .catch(e => {
                                        console.error(`Error resolving direct link block: ${redirectLink}`, e.message);
                                    })
                            ));
                        } else if (epNum) {
                            if (!episodeLinksMap.has(epNum)) episodeLinksMap.set(epNum, []);

                            // Get links from current h3/h4
                            const baseLinks = $el.find('a').map((i, a) => $(a).attr('href')).get();
                            episodeLinksMap.get(epNum).push(...baseLinks);

                            // Get links from sibling elements until the next <hr>
                            let nextElement = $el.next();
                            while (nextElement.length && nextElement.get(0).tagName !== 'hr' && nextElement.get(0).tagName !== 'h3' && nextElement.get(0).tagName !== 'h4') {
                                const siblingLinks = nextElement.find('a').map((i, a) => $(a).attr('href')).get();
                                episodeLinksMap.get(epNum).push(...siblingLinks);
                                nextElement = nextElement.next();
                            }
                            return Promise.resolve();
                        } else {
                            return Promise.resolve();
                        }
                    });

                    return Promise.all(processElementsPromises)
                        .then(() => {
                            // Continue with the rest of the TV series logic
                            episodeLinksMap.forEach((links, epNum) => {
                                // Flatten and unique links per episode
                                const uniqueLinks = [...new Set(links)];
                                initialLinks.push(...uniqueLinks.map(link => ({ url: link, episode: epNum })));
                            });

                            console.log(`Found ${initialLinks.length} initial hoster links. Now extracting...`);

                            // Process all links in parallel
                            const promises = initialLinks.map(linkInfo => {
                                if (linkInfo.isQualityRedirect) {
                                    // Handle quality redirect links (like techyboy4u.com)
                                    return getRedirectLinks(linkInfo.url)
                                        .then(resolvedUrl =>
                                            fetch(resolvedUrl, { headers: HEADERS })
                                                .then(episodeDocPage => episodeDocPage.text())
                                                .then(episodeDocData => {
                                                    const $$ = cheerio.load(episodeDocData);

                                                    // Extract episode links from h5 elements
                                                    const episodeLinks = [];
                                                    $$('h5 a').each((i, linkEl) => {
                                                        const linkText = $$(linkEl).text();
                                                        const linkHref = $$(linkEl).attr('href');
                                                        const episodeMatch = linkText.match(/Episode\s*(\d+)/i);
                                                        if (episodeMatch && linkHref) {
                                                            const epNum = parseInt(episodeMatch[1]);
                                                            episodeLinks.push({ url: linkHref, episode: epNum });
                                                        }
                                                    });

                                                    // Also look for h3 links (pack downloads, etc.) but exclude zip files
                                                    $$('h3 a').each((i, linkEl) => {
                                                        const linkHref = $$(linkEl).attr('href');
                                                        const linkText = $$(linkEl).text();
                                                        if (linkHref && !linkHref.includes('magnet:') && !linkHref.includes('.zip') && !linkText.toLowerCase().includes('pack')) {
                                                            episodeLinks.push({ url: linkHref, episode: null }); // Individual downloads only
                                                        }
                                                    });

                                                    // Process each episode link
                                                    const episodePromises = episodeLinks.map(epLink =>
                                                        loadExtractor(epLink.url, resolvedUrl)
                                                            .then(extractedLinks => extractedLinks.map(finalLink => ({ ...finalLink, episode: epLink.episode })))
                                                            .catch(e => {
                                                                console.error(`Failed to extract episode link ${epLink.url}:`, e.message);
                                                                return [];
                                                            })
                                                    );

                                                    return Promise.all(episodePromises)
                                                        .then(episodeResults => episodeResults.flat());
                                                })
                                        );
                                } else {
                                    // Handle regular links
                                    return loadExtractor(linkInfo.url, mediaUrl)
                                        .then(extractedLinks => extractedLinks.map(finalLink => ({ ...finalLink, episode: linkInfo.episode })))
                                        .catch(e => {
                                            console.error(`Failed to extract from ${linkInfo.url}:`, e.message);
                                            return [];
                                        });
                                }
                            });

                            return Promise.all(promises)
                                .then(results => {
                                    const allFinalLinks = [];
                                    results.forEach(res => allFinalLinks.push(...res));

                                    // Remove exact duplicate URLs and zip files
                                    const seenUrls = new Set();
                                    const uniqueFinalLinks = allFinalLinks.filter(link => {
                                        // Filter out zip files
                                        if (link.url && (link.url.includes('.zip') || (link.name && link.name.toLowerCase().includes('.zip')))) {
                                            return false;
                                        }
                                        // Filter out duplicates
                                        if (seenUrls.has(link.url)) {
                                            return false;
                                        }
                                        seenUrls.add(link.url);
                                        return true;
                                    });

                                    return { finalLinks: uniqueFinalLinks, isMovie };
                                });
                        });
                } else {
                    // Episodes found in h4, continue normally
                    episodeLinksMap.forEach((links, epNum) => {
                        // Flatten and unique links per episode
                        const uniqueLinks = [...new Set(links)];
                        initialLinks.push(...uniqueLinks.map(link => ({ url: link, episode: epNum })));
                    });

                    console.log(`Found ${initialLinks.length} initial hoster links. Now extracting...`);

                    // Process all links in parallel
                    const promises = initialLinks.map(linkInfo => {
                        if (linkInfo.isQualityRedirect) {
                            // Handle quality redirect links (like techyboy4u.com)
                            return getRedirectLinks(linkInfo.url)
                                .then(resolvedUrl =>
                                    fetch(resolvedUrl, { headers: HEADERS })
                                        .then(episodeDocPage => episodeDocPage.text())
                                        .then(episodeDocData => {
                                            const $$ = cheerio.load(episodeDocData);

                                            // Extract episode links from h5 elements
                                            const episodeLinks = [];
                                            $$('h5 a').each((i, linkEl) => {
                                                const linkText = $$(linkEl).text();
                                                const linkHref = $$(linkEl).attr('href');
                                                const episodeMatch = linkText.match(/Episode\s*(\d+)/i);
                                                if (episodeMatch && linkHref) {
                                                    const epNum = parseInt(episodeMatch[1]);
                                                    episodeLinks.push({ url: linkHref, episode: epNum });
                                                }
                                            });

                                            // Also look for h3 links (pack downloads, etc.) but exclude zip files
                                            $$('h3 a').each((i, linkEl) => {
                                                const linkHref = $$(linkEl).attr('href');
                                                const linkText = $$(linkEl).text();
                                                if (linkHref && !linkHref.includes('magnet:') && !linkHref.includes('.zip') && !linkText.toLowerCase().includes('pack')) {
                                                    episodeLinks.push({ url: linkHref, episode: null }); // Individual downloads only
                                                }
                                            });

                                            // Process each episode link
                                            const episodePromises = episodeLinks.map(epLink =>
                                                loadExtractor(epLink.url, resolvedUrl)
                                                    .then(extractedLinks => extractedLinks.map(finalLink => ({ ...finalLink, episode: epLink.episode })))
                                                    .catch(e => {
                                                        console.error(`Failed to extract episode link ${epLink.url}:`, e.message);
                                                        return [];
                                                    })
                                            );

                                            return Promise.all(episodePromises)
                                                .then(episodeResults => episodeResults.flat());
                                        })
                                );
                        } else {
                            // Handle regular links
                            return loadExtractor(linkInfo.url, mediaUrl)
                                .then(extractedLinks => extractedLinks.map(finalLink => ({ ...finalLink, episode: linkInfo.episode })))
                                .catch(e => {
                                    console.error(`Failed to extract from ${linkInfo.url}:`, e.message);
                                    return [];
                                });
                        }
                    });

                    return Promise.all(promises)
                        .then(results => {
                            const allFinalLinks = [];
                            results.forEach(res => allFinalLinks.push(...res));

                            // Remove exact duplicate URLs and zip files
                            const seenUrls = new Set();
                            const uniqueFinalLinks = allFinalLinks.filter(link => {
                                // Filter out zip files
                                if (link.url && (link.url.includes('.zip') || (link.name && link.name.toLowerCase().includes('.zip')))) {
                                    return false;
                                }
                                // Filter out duplicates
                                if (seenUrls.has(link.url)) {
                                    return false;
                                }
                                seenUrls.add(link.url);
                                return true;
                            });

                            return { finalLinks: uniqueFinalLinks, isMovie };
                        });
                }
            }
        });
}

/**
 * Get movie/TV show details from TMDB
 * @param {string} tmdbId TMDB ID
 * @param {string} mediaType "movie" or "tv"
 * @returns {Promise<Object>} Media details
 */
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
    const url = TMDB_BASE_URL + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&append_to_response=alternative_titles,translations,external_ids';
    return vueoSharedTmdb(url, function() {
        return fetch(url).then(function(response) { return response.json(); });
    }).then(function(data) {
        const title = mediaType === 'movie' ? data.title : data.name;
        const releaseDate = mediaType === 'movie' ? data.release_date : data.first_air_date;
        const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
        return {
            title: title,
            year: year,
            imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : null,
            aliases: collectTmdbAliases(data, mediaType)
        };
    });
}

/**
 * Improved title matching utilities
 */

/**
 * Normalizes a title for better matching
 * @param {string} title The title to normalize
 * @returns {string} Normalized title
 */
function normalizeTitle(title) {
    if (!title) return '';

    return title
        // Convert to lowercase
        .toLowerCase()
        // Remove common articles
        .replace(/\b(the|a|an)\b/g, '')
        // Normalize punctuation and spaces
        .replace(/[:\-_]/g, ' ')
        .replace(/\s+/g, ' ')
        // Remove special characters but keep alphanumeric and spaces
        .replace(/[^\w\s]/g, '')
        .trim();
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = Object.create(null);

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push({ title: text, priority: Number(priority || 0) });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var altRoot = data && data.alternative_titles;
  var altItems = altRoot && Array.isArray(altRoot.titles)
    ? altRoot.titles
    : altRoot && Array.isArray(altRoot.results)
      ? altRoot.results
      : [];

  altItems.forEach(function(item) {
    if (!item) return;
    var country = String(item.iso_3166_1 || "").toUpperCase();
    var priority = country === "US" || country === "GB"
      ? 86
      : country === "MY" || country === "ID"
        ? 82
        : 72;
    add(item.title || item.name, priority);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];

  translations.forEach(function(item) {
    var row = item && item.data && typeof item.data === "object" ? item.data : {};
    var lang = String(item && item.iso_639_1 || "").toLowerCase();
    var priority = lang === "en" ? 88 : (lang === "ms" || lang === "id" ? 80 : 68);
    add(row.title || row.name, priority);
  });

  output.sort(function(a, b) { return b.priority - a.priority; });
  return output.map(function(item) { return item.title; }).slice(0, 12);
}

/**
 * Calculates similarity score between two titles
 * @param {string} title1 First title
 * @param {string} title2 Second title
 * @returns {number} Similarity score (0-1)
 */
function calculateTitleSimilarity(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);

    // Exact match after normalization
    if (norm1 === norm2) return 1.0;

    // Substring matches
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

    // Word-based similarity
    const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

/**
 * Finds the best title match from search results
 * @param {Object} mediaInfo TMDB media info
 * @param {Array} searchResults Search results array
 * @param {string} mediaType "movie" or "tv"
 * @param {number} season Season number for TV shows
 * @returns {Object|null} Best matching result
 */
function cleanDiscoveryTitleHD(value) {
    return normalizeTitle(
        String(value || '')
            .replace(/\[(?:[^\]]{0,140})\]/g, ' ')
            .replace(/\b(?:19|20)\d{2}\b/g, ' ')
            .replace(/\bseason\s*\d{1,2}\b/gi, ' ')
            .replace(/\bs\d{1,2}\b/gi, ' ')
            .replace(/\b(?:2160p|1080p|720p|480p|4k|web[- ]?dl|webrip|bluray|hevc|h26[45]|10bit|dual audio|full movie|full series|all episodes)\b/gi, ' ')
    );
}

function bestAliasSimilarityHD(mediaInfo, candidateTitle) {
    var aliases = mediaInfo && Array.isArray(mediaInfo.aliases) && mediaInfo.aliases.length
        ? mediaInfo.aliases
        : [mediaInfo && mediaInfo.title, mediaInfo && mediaInfo.originalTitle];
    var best = 0;
    var cleanCandidate = cleanDiscoveryTitleHD(candidateTitle);
    aliases.forEach(function(alias) {
        var cleanAlias = cleanDiscoveryTitleHD(alias);
        best = Math.max(best, calculateTitleSimilarity(candidateTitle, alias));
        if (cleanCandidate && cleanAlias) {
            if (cleanCandidate === cleanAlias) best = Math.max(best, 1);
            else if (cleanCandidate.indexOf(cleanAlias) !== -1 || cleanAlias.indexOf(cleanCandidate) !== -1) best = Math.max(best, 0.92);
            else best = Math.max(best, calculateTitleSimilarity(cleanCandidate, cleanAlias));
        }
    });
    return best;
}

function buildDiscoveryQueriesHD(mediaInfo, mediaType, season) {
    var output = [];
    var seen = Object.create(null);
    var aliases = mediaInfo && Array.isArray(mediaInfo.aliases) && mediaInfo.aliases.length
        ? mediaInfo.aliases
        : [mediaInfo && mediaInfo.title, mediaInfo && mediaInfo.originalTitle];

    function add(value) {
        var text = String(value || '').trim();
        var key = normalizeTitle(text);
        if (!text || !key || seen[key]) return;
        seen[key] = true;
        output.push(text);
    }

    aliases.slice(0, 6).forEach(function(alias) {
        add(alias);
        if (mediaType === 'tv' && season) add(alias + ' season ' + season);
        if (mediaInfo && mediaInfo.year) add(alias + ' ' + mediaInfo.year);
    });

    return output.slice(0, 8);
}

function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
    if (!searchResults || searchResults.length === 0) return null;
    var bestMatch = null;
    var bestScore = -999;

    searchResults.forEach(function(result) {
        var score = bestAliasSimilarityHD(mediaInfo, result.title) * 100;
        if (mediaInfo.year && result.year) {
            var diff = Math.abs(Number(mediaInfo.year) - Number(result.year));
            if (diff === 0) score += 24;
            else if (diff <= 1) score += 8;
            else if (diff > 4) score -= 32;
        }
        if (mediaType === 'tv' && season) {
            var raw = String(result.title || '');
            var seasonMatch = raw.match(/\bseason\s*(\d{1,2})\b/i) || raw.match(/\bs(\d{1,2})\b/i);
            if (seasonMatch) {
                if (Number(seasonMatch[1]) === Number(season)) score += 28;
                else score -= 100;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = result;
        }
    });

    if (!bestMatch || bestScore < 55) return null;
    vueoTrace('CANDIDATE', { count: searchResults.length, title: bestMatch.title || '', score: Math.round(bestScore) });
    return bestMatch;
}

function searchDiscoveryHD(mediaInfo, mediaType, season) {
    var queries = buildDiscoveryQueriesHD(mediaInfo, mediaType, season);
    function run(index) {
        if (index >= queries.length) return Promise.resolve(null);
        return search(queries[index]).then(function(results) {
            var best = findBestTitleMatch(mediaInfo, results || [], mediaType, season);
            return best || run(index + 1);
        }).catch(function() { return run(index + 1); });
    }
    return run(0);
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID
 * @param {string} mediaType "movie" or "tv"
 * @param {number} season Season number (TV only)
 * @param {number} episode Episode number (TV only)
 * @returns {Promise<Array>} Array of stream objects
 */
function slugifyHDHub(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[’'`]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

function pageTitleHDHub(html) {
    const $ = cheerio.load(String(html || ''));
    return ($('h1.page-title').first().text() || $('h1').first().text() || $('meta[property="og:title"]').attr('content') || '').trim();
}

function tryDirectHDHubPage(mediaInfo, mediaType, season) {
    return getCurrentDomain().then(function(domain) {
        const aliases = mediaInfo && Array.isArray(mediaInfo.aliases) && mediaInfo.aliases.length ? mediaInfo.aliases : [mediaInfo.title];
        const year = mediaInfo.year ? String(mediaInfo.year) : '';
        let paths = [];
        aliases.slice(0, 3).forEach(function(alias) {
            const slug = slugifyHDHub(alias);
            if (!slug) return;
            if (mediaType === 'movie') {
                if (year) {
                    paths.push(
                        '/' + slug + '-' + year + '-webrip-hindi-full-movie/',
                        '/' + slug + '-' + year + '-hindi-webrip-full-movie/',
                        '/' + slug + '-' + year + '-english-webrip-full-movie/',
                        '/' + slug + '-' + year + '-webrip-full-movie/'
                    );
                }
            } else if (season) {
                paths.push(
                    '/' + slug + '-season-' + season + '-hindi-webrip-all-episodes/',
                    '/' + slug + '-season-' + season + '-webrip-hindi-full-series/',
                    '/' + slug + '-season-' + season + '-webrip-all-episodes/'
                );
            }
        });
        function probe(index) {
            if (index >= paths.length) return Promise.resolve(null);
            const url = domain.replace(/\/+$/, '') + paths[index];
            return fetch(url, { headers: HEADERS }).then(function(response) {
                if (!response.ok) return null;
                return response.text().then(function(html) {
                    if (!html || html.length < 2000 || /page not found|404 not found/i.test(html)) return null;
                    const title = pageTitleHDHub(html);
                    const score = calculateTitleSimilarity(mediaInfo.title, title) + (year && title.indexOf(year) !== -1 ? 0.4 : 0);
                    if (score < 0.55) return null;
                    vueoTrace('DIRECT_MATCH', { title: title, url: url, score: Math.round(score * 100) });
                    return { title: title, url: url, year: mediaInfo.year };
                });
            }).catch(function() { return null; }).then(function(hit) {
                return hit || probe(index + 1);
            });
        }
        return probe(0);
    });
}

function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    console.log(`[HDHub4u] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${season}E:${episode}` : ''}`);

    // First, get movie/TV show details from TMDB
    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo.title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[HDHub4u] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);

        console.log(`[HDHub4u] Discovery title: "${mediaInfo.title}"`);

        return tryDirectHDHubPage(mediaInfo, mediaType, season).then(function(directHit) {
            if (directHit) return directHit;
            return searchDiscoveryHD(mediaInfo, mediaType, season);
        }).then(function(selectedMedia) {
            if (!selectedMedia) {
                console.log('[HDHub4u] No confident match found');
                return [];
            }
            console.log(`[HDHub4u] Selected: "${selectedMedia.title}" (${selectedMedia.url})`);

            return getDownloadLinks(selectedMedia.url).then(function(result) {
                const { finalLinks, isMovie } = result;

                // Filter by episode if specified for TV shows
                let filteredLinks = finalLinks;
                if (mediaType === 'tv' && episode !== null) {
                    filteredLinks = finalLinks.filter(function(link) {
                        return link.episode === episode;
                    });
                    console.log(`[HDHub4u] Filtered to ${filteredLinks.length} links for episode ${episode}`);
                }

                // Convert to Nuvio format, filtering out unknown quality links
                const streams = filteredLinks
                    .filter(function(link) {
                        // Skip links with unknown quality - these are usually just redirects
                        if (typeof link.quality !== 'number' || link.quality === 0) {
                            return false;
                        }
                        return true;
                    })
                    .map(function(link) {
                        // Use the actual file name from HubCloud page if available, otherwise fallback to TMDB title
                        let mediaTitle = link.fileName && link.fileName !== 'Unknown' ? link.fileName : mediaInfo.title;
                        if (mediaType === 'tv' && season && episode && link.episode && !link.fileName) {
                            mediaTitle = `${mediaInfo.title} S${String(season).padStart(2, '0')}E${String(link.episode).padStart(2, '0')}`;
                        } else if (mediaType === 'tv' && season && episode && !link.fileName) {
                            mediaTitle = `${mediaInfo.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
                        } else if (mediaInfo.year && !link.fileName) {
                            mediaTitle = `${mediaInfo.title} (${mediaInfo.year})`;
                        }

                        // Format size and extract server name
                        const formattedSize = formatBytes(link.size);
                        const serverName = extractServerName(link.source);

                        // Create quality string
                        let qualityStr = 'Unknown';
                        if (typeof link.quality === 'number') {
                            if (link.quality >= 2160) qualityStr = '4K';
                            else if (link.quality >= 1440) qualityStr = '1440p';
                            else if (link.quality >= 1080) qualityStr = '1080p';
                            else if (link.quality >= 720) qualityStr = '720p';
                            else if (link.quality >= 480) qualityStr = '480p';
                            else if (link.quality >= 360) qualityStr = '360p';
                            else qualityStr = '240p';
                        }

                        return {
                            name: `HDHub4u ${serverName}`,
                            title: mediaTitle,
                            url: link.url,
                            quality: qualityStr,
                            size: formattedSize,
                            headers: link.headers || HEADERS,
                            subtitles: link.subtitles || [],
                            provider: 'hdhub4u'
                        };
                    });

                // Sort by quality
                const qualityOrder = { '4K': 4, '2160p': 4, '1440p': 3, '1080p': 2, '720p': 1, '480p': 0, '360p': -1, 'Unknown': -2 };
                streams.sort(function(a, b) {
                    return (qualityOrder[b.quality] || -3) - (qualityOrder[a.quality] || -3);
                });

                console.log(`[HDHub4u] Found ${streams.length} streams`);
                return streams;
            });
        });
    }).catch(function(error) {
        console.error(`[HDHub4u] Scraping error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native environment
    global.HDHub4uScraperModule = { getStreams };
}

/* CLOUDBANK_TEST_PLUGIN_ADAPTATION_START */
// Test-Plugin is an additional extraction/discovery engine. Existing Cloudbank
// discovery and native-host fallbacks remain available in the same provider.
var cloudbankLegacyProvider = module.exports;
function createHdHubEngine() {
  var stopTransferred;
  var transferredModule = { exports: {} };
  function metadataFetch(url, options) {
    var raw = typeof url === "string" ? url : url && url.url;
    var match = typeof raw === "string" && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || (options && options.method && String(options.method).toUpperCase() !== "GET")) return fetch(url, options);
    // Reject an explicitly stale host context instead of displaying another title.
    var context = typeof globalThis !== "undefined" ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === "string") { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    var stale = contextId && String(contextId) !== match[2];
    if (stale) return fetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return fetch(url, options).then(function(response) {
        if (!response.ok) throw new Error("TMDB HTTP " + response.status);
        return response.json();
      });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw,
        headers: { get: function(name) { return String(name).toLowerCase() === "content-type" ? "application/json" : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); },
        text: function() { return Promise.resolve(body); } };
    });
  }
  (function(module, exports, fetch) {
/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */
"use strict";

var hdTransport=fetch,hdActive=true,hdPending=[];
function hdStop(){hdActive=false;hdPending.slice().forEach(function(cancel){cancel();});}
stopTransferred=hdStop;
fetch=function(url,options){
 if(!hdActive)return Promise.reject(new Error('HDHub4u stopped'));
 var controller=typeof AbortController==='function'?new AbortController():null,opts=Object.assign({},options||{});if(controller)opts.signal=controller.signal;
 return new Promise(function(resolve,reject){var done=false;function finish(err,v){if(done)return;done=true;hdPending=hdPending.filter(function(x){return x!==cancel;});if(err)reject(err);else resolve(v);}function cancel(){if(controller)controller.abort();finish(new Error('HDHub4u cancelled'));}hdPending.push(cancel);
 Promise.resolve().then(function(){if(!hdActive)throw Error('HDHub4u stopped');return hdTransport(url,opts);}).then(function(r){finish(null,r);},function(e){finish(e);});
 });
};
var PROVIDER = "HDHub4u";
var VERSION = "1.8.0-cloudbank";
var PRIMARY_BASE = "https://new8.hdhub4u.cl";
var FALLBACK_BASES = ["https://new6.hdhub4u.cl", "https://new6.hdhub4u.fo", "https://hdhub4u.frl"];
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var SEARCH_BASE = "https://search.hdhub4u.glass/collections/post/documents/search";
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var PROVIDER_BUDGET_MS = 17500;
var VERIFY_TIMEOUT_MS = 1350;
var SEEK_VERIFY_TIMEOUT_MS = 1450;
var SEEK_PROBE_OFFSET = 1048576;
var MULTI_TASK_TIMEOUT_MS = 3000;

function cheerio() { return require("cheerio-without-node-native"); }

function trace(stage, details) {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function withTimeout(promise, ms, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "operation") + " timeout"));
    }, Math.max(1, Number(ms || 1)));
    Promise.resolve(promise).then(function(v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, function(e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

function mergeHeaders(extra) {
  var out = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "xla=s4t"
  };
  Object.keys(extra || {}).forEach(function(k) { out[k] = extra[k]; });
  return out;
}

function fetchResponse(url, options, timeoutMs) {
  var opts = options || {};
  opts.headers = mergeHeaders(opts.headers || {});
  return withTimeout(fetch(url, opts), timeoutMs || 2100, "HTTP").then(function(res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    return res;
  });
}

function fetchText(url, options, timeoutMs) {
  var opts = options || {};
  opts.headers = mergeHeaders(opts.headers || {});
  return withTimeout(Promise.resolve().then(function() { return fetch(url, opts); }).then(function(res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
    return res.text().then(function(text) {
      return { text: text, url: res.url || url, status: res.status, headers: res.headers };
    });
  }), timeoutMs || 2100, "HTTP body");
}

function fetchJson(url, options, timeoutMs) {
  return fetchText(url, options, timeoutMs).then(function(x) {
    return JSON.parse(String(x.text || "").replace(/^\uFEFF/, ""));
  });
}

function vueoSharedTmdb(url, fallback) {
  function normalize(raw) {
    var ctx = raw;
    if (typeof raw === "string") {
      try { ctx = JSON.parse(raw); } catch (_) { ctx = null; }
    }
    if (!ctx || ctx.error) return null;
    if (ctx.tmdb && typeof ctx.tmdb === "object") return ctx.tmdb;
    if (!ctx.title) return null;
    return {
      id: ctx.tmdbId,
      title: ctx.mediaType === "movie" ? ctx.title : undefined,
      name: ctx.mediaType === "tv" ? ctx.title : undefined,
      original_title: ctx.mediaType === "movie" ? (ctx.originalTitle || ctx.title) : undefined,
      original_name: ctx.mediaType === "tv" ? (ctx.originalTitle || ctx.title) : undefined,
      release_date: ctx.mediaType === "movie" && ctx.year ? String(ctx.year) + "-01-01" : "",
      first_air_date: ctx.mediaType === "tv" && ctx.year ? String(ctx.year) + "-01-01" : "",
      original_language: ctx.originalLanguage || ctx.original_language || "",
      external_ids: { imdb_id: ctx.imdbId || "" }
    };
  }

  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve(globalThis.vueoDiscoveryContext(url)).then(function(raw) {
          var shared = normalize(raw);
          if (shared) return shared;
          throw new Error("shared context empty");
        }).catch(function() { return fallback(); });
      }
    }
  } catch (_) {}
  return fallback();
}

function normalizeTitle(v) {
  var s = String(v || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s.replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function cleanDiscoveryTitle(v) {
  return normalizeTitle(String(v || "")
    .replace(/\[(?:[^\]]{0,160})\]/g, " ")
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bseason\s*\d{1,2}\b/gi, " ")
    .replace(/\bs\d{1,2}\b/gi, " ")
    .replace(/\b(?:2160p|1080p|720p|480p|4k|ds4k|web[- ]?dl|webrip|hdrip|bluray|hevc|h26[45]|10bit|dual audio|multi audio|full movie|full series|all episodes|hindi dubbed|english)\b/gi, " "));
}

function parseYear(v) {
  var m = String(v || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}

function unique(arr) {
  var seen = Object.create(null);
  return (arr || []).filter(function(v) {
    var key = String(v || "").trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function collectAliases(data) {
  var out = [];
  var seen = Object.create(null);
  function add(v) {
    var text = String(v || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    out.push(text);
  }
  add(data && (data.title || data.name));
  add(data && (data.original_title || data.original_name));
  var alt = data && data.alternative_titles;
  var rows = alt && Array.isArray(alt.titles) ? alt.titles : (alt && Array.isArray(alt.results) ? alt.results : []);
  rows.slice(0, 8).forEach(function(x) { add(x && (x.title || x.name)); });
  return out.slice(0, 6);
}

function tmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles,external_ids";
  return vueoSharedTmdb(url, function() {
    return fetchJson(url, { headers: { "Accept": "application/json" } }, 1600);
  }).then(function(d) {
    return {
      title: String(type === "tv" ? (d.name || d.original_name || "") : (d.title || d.original_title || "")).trim(),
      originalLanguage: hdAudioCode(d.original_language),
      year: parseYear(type === "tv" ? d.first_air_date : d.release_date),
      aliases: collectAliases(d || {})
    };
  });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function absoluteUrl(base, href) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return "https:" + href;
  try { return new URL(href, base).toString(); } catch (_) {}
  var origin = originOf(base);
  return href.charAt(0) === "/" ? origin + href : origin + "/" + href;
}

function hostOf(url) {
  try { return new URL(String(url || "")).hostname.toLowerCase(); } catch (_) { return "?"; }
}

function b64decode(v) {
  try { if (typeof atob === "function") return atob(String(v || "")); } catch (_) {}
  try { return require("crypto-js").enc.Utf8.stringify(require("crypto-js").enc.Base64.parse(String(v || ""))); } catch (_) { return ""; }
}

function b64encode(v) {
  try { if (typeof btoa === "function") return btoa(String(v || "")); } catch (_) {}
  try { return require("crypto-js").enc.Base64.stringify(require("crypto-js").enc.Utf8.parse(String(v || ""))); } catch (_) { return ""; }
}

function rot13(v) {
  return String(v || "").replace(/[a-zA-Z]/g, function(c) {
    var base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });
}

var hdhubDomainCache = null, hdhubDomainCachedAt = 0, hdhubDomainCheckedAt = 0, hdhubDomainInFlight = null;
function discoverCurrentBase() {
  if (hdhubDomainCache && Date.now() - hdhubDomainCachedAt < 4 * 60 * 60 * 1000) return Promise.resolve(hdhubDomainCache);
  if (hdhubDomainInFlight) return hdhubDomainInFlight;
  if (!hdhubDomainCache && hdhubDomainCheckedAt && Date.now() - hdhubDomainCheckedAt < 5 * 60 * 1000) return Promise.resolve(null);
  hdhubDomainInFlight = fetchJson(DOMAINS_URL, { headers: { "Accept": "application/json" } }, 1200).then(function(data) {
    var raw = data && data.HDHUB4u;
    try {
      var parsed = new URL(String(raw || ''));
      if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)hdhub4u\.[a-z]+$/i.test(parsed.hostname) || parsed.hostname.endsWith(".free") || parsed.username || parsed.password) return null;
      hdhubDomainCache = parsed.origin; hdhubDomainCachedAt = Date.now();
      return hdhubDomainCache;
    } catch (_) { return null; }
  }).catch(function() { return null; }).then(function(value) { hdhubDomainCheckedAt = Date.now(); hdhubDomainInFlight = null; return value; });
  return hdhubDomainInFlight;
}

function parseSearch(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);

  $(".recent-movies > li.thumb, li.thumb, article").each(function(_, el) {
    var root = $(el);
    var a = root.find("a[href]").first();
    var href = absoluteUrl(base, a.attr("href"));
    if (!href || seen[href]) return;
    var title = String(root.find("figcaption p").first().text() || root.find("h2,h3").first().text() || a.attr("title") || root.text() || "")
      .replace(/\s+/g, " ").trim();
    if (!title) return;
    seen[href] = true;
    out.push({ title: title, url: href, year: parseYear(title) });
  });

  if (!out.length) {
    $("a[href]").each(function(_, el) {
      var a = $(el);
      var href = absoluteUrl(base, a.attr("href"));
      var text = String(a.text() || a.attr("title") || "").replace(/\s+/g, " ").trim();
      if (!href || !text || seen[href]) return;
      if (!/(?:19|20)\d{2}|season\s*\d+/i.test(text)) return;
      seen[href] = true;
      out.push({ title: text, url: href, year: parseYear(text) });
    });
  }
  return out;
}

function scoreCandidate(c, info, mediaType, season) {
  var wanted = cleanDiscoveryTitle(info.title);
  var cand = cleanDiscoveryTitle(c.title);
  if (!wanted || !cand) return -9999;
  var score = -9999;

  (info.aliases && info.aliases.length ? info.aliases : [info.title]).forEach(function(alias) {
    var a = cleanDiscoveryTitle(alias);
    if (!a) return;
    if (cand === a) score = Math.max(score, 1000);
    else if (cand.indexOf(a) >= 0 || a.indexOf(cand) >= 0) score = Math.max(score, 820);
  });
  if (score < 0) return score;

  if (info.year && c.year) {
    var diff = Math.abs(Number(info.year) - Number(c.year));
    if (diff === 0) score += 450;
    else if (diff === 1) score += mediaType === "tv" && Number(season == null ? 1 : season) > 1 ? 120 : 40;
    else if (diff > 2) score -= 900;
  }

  if (mediaType === "tv") {
    var sm = String(c.title || "").match(/\bseason\s*(\d{1,2})\b/i);
    if (sm && Number(sm[1]) === Number(season == null ? 1 : season)) score += 350;
    else if (sm) return -99999;
  } else if (/\bseason\s*\d+/i.test(c.title || "")) {
    score -= 900;
  }
  return score;
}

function bestSearchResult(items, info, mediaType, season) {
  var scored = (items || []).map(function(x) {
    x.score = scoreCandidate(x, info, mediaType, season);
    return x;
  }).filter(function(x) { return x.score > 0; });
  scored.sort(function(a, b) { return b.score - a.score; });
  var best = scored[0] || null;
  if (best) trace("CANDIDATE", { title: best.title, score: best.score, count: items.length });
  return best;
}


function rewriteHdhubUrl(url, base) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.charAt(0) === "/") return String(base || PRIMARY_BASE).replace(/\/+$/, "") + raw;
  if (!/^https?:\/\//i.test(raw)) return absoluteUrl(base || PRIMARY_BASE, raw);
  try {
    var u = new URL(raw);
    if (/hdhub4u\./i.test(u.hostname)) {
      var b = new URL(base || PRIMARY_BASE);
      u.protocol = b.protocol;
      u.hostname = b.hostname;
      u.port = b.port;
      return u.toString();
    }
  } catch (_) {}
  return raw;
}

function searchApi(base, query, info, mediaType, season) {
  var url = SEARCH_BASE +
    "?q=" + encodeURIComponent(query) +
    "&query_by=post_title,category" +
    "&query_by_weights=4,2" +
    "&sort_by=sort_by_date:desc" +
    "&limit=15" +
    "&highlight_fields=none" +
    "&use_cache=true" +
    "&page=1";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "Referer": String(base || PRIMARY_BASE) + "/"
    }
  }, 1700).then(function(data) {
    var hits = data && Array.isArray(data.hits) ? data.hits : [];
    var items = hits.map(function(hit) {
      var d = hit && hit.document ? hit.document : {};
      var title = String(d.post_title || d.title || "").replace(/\s+/g, " ").trim();
      return {
        title: title,
        url: rewriteHdhubUrl(d.permalink || d.url || "", base),
        year: parseYear(title)
      };
    }).filter(function(x) { return x.title && x.url; });

    var best = bestSearchResult(items, info, mediaType, season);
    console.log(
      "[HDHub4u] search-api query='" + query +
      "' items=" + items.length +
      " match=" + (best ? "yes" : "no")
    );
    return best ? { base: base, item: best } : null;
  });
}

function searchOne(base, query, info, mediaType, season) {
  var url = base + "/?s=" + encodeURIComponent(query);
  return fetchText(url, { headers: { "Referer": base + "/" } }, 2200).then(function(x) {
    var items = parseSearch(x.text, base);
    var best = bestSearchResult(items, info, mediaType, season);
    console.log("[HDHub4u] search host=" + base + " query='" + query + "' items=" + items.length + " match=" + (best ? "yes" : "no"));
    return best ? { base: base, item: best } : null;
  });
}

function findDetail(info, mediaType, season) {
  var queries = unique([info.title].concat((info.aliases || []).slice(0, 1)));
  return discoverCurrentBase().then(function(current) {
    var bases = unique([current || PRIMARY_BASE, PRIMARY_BASE].concat(FALLBACK_BASES));
    var base = bases[0];
    function tryApi(i) {
      if (i >= queries.length) return Promise.resolve(null);
      return searchApi(base, queries[i], info, mediaType, season).then(function(hit) {
        return hit || tryApi(i + 1);
      }).catch(function() { return tryApi(i + 1); });
    }
    function trySite(i) {
      if (i >= bases.length) return Promise.resolve(null);
      return searchOne(bases[i], info.title, info, mediaType, season).then(function(hit) {
        return hit || trySite(i + 1);
      }).catch(function() { return trySite(i + 1); });
    }
    return tryApi(0).then(function(hit) { return hit || trySite(0); });
  });
}

function qualityNumber(text) {
  var value = String(text || "");
  if (/\b(?:2160p|4k)\b/i.test(value)) return 2160;
  var m = value.match(/\b(1440|1080|720|480|360)p?\b/i);
  return m ? Number(m[1]) : 0;
}

function qualityLabel(q) {
  if (q >= 2160) return "4K";
  if (q >= 1440) return "1440p";
  if (q >= 1080) return "1080p";
  if (q >= 720) return "720p";
  if (q >= 480) return "480p";
  if (q >= 360) return "360p";
  return "Auto";
}

function movieBlocks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  $("h3 a[href], h4 a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    var q = qualityNumber(text);
    if (!href || !q || seen[href]) return;
    seen[href] = true;
    out.push({ url: href, text: text, quality: q });
  });
  return out;
}

function episodeDirectBlocks(html, detailUrl, episode) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  var wanted = Number(episode || 1);

  $("h3, h4, h5").each(function(_, el) {
    var row = $(el);
    var text = String(row.text() || "").replace(/\s+/g, " ").trim();
    var em = text.match(/(?:episode|ep)\s*[-:#]?\s*0*(\d{1,3})/i) || text.match(/\bE0*(\d{1,3})\b/i);
    if (!em || Number(em[1]) !== wanted) return;

    function collect(node) {
      node.find("a[href]").each(function(_, aEl) {
        var a = $(aEl);
        var href = absoluteUrl(detailUrl, a.attr("href"));
        var label = String(a.text() || node.text() || "").replace(/\s+/g, " ").trim();
        if (!href || seen[href] || /\.zip(?:$|[?#])/i.test(href)) return;
        seen[href] = true;
        out.push({ url: href, text: label, quality: qualityNumber(label) });
      });
    }

    collect(row);
    var next = row.next();
    var guard = 0;
    while (next && next.length && guard++ < 8) {
      var tag = String(next.get(0) && next.get(0).tagName || "").toLowerCase();
      if (/^(h3|h4|h5|hr)$/.test(tag)) break;
      collect(next);
      next = next.next();
    }
  });
  return out;
}

function qualityRedirects(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  $("h3 a[href], h4 a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    if (!href || !qualityNumber(text)) return;
    if (/techyboy4u|[?&]id=/i.test(href)) out.push({ url: href, text: text, quality: qualityNumber(text) });
  });
  return out;
}

function blockScore(block) {
  var q = Number(block.quality || 0);
  var t = String(block.text || "").toLowerCase();
  var score = q === 1080 ? 1000 : q === 720 ? 800 : q === 480 ? 650 : q === 2160 ? 600 : 400;
  if (/x264|h264|avc/.test(t)) score += 120;
  if (/10bit|hevc|x265|h265/.test(t)) score -= 35;
  if (/web-dl/.test(t)) score += 50;
  return score;
}

function getRedirectLinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || PRIMARY_BASE + "/" } }, 1700).then(function(x) {
    var doc = x.text;
    var re = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var combined = "";
    var m;
    while ((m = re.exec(doc))) combined += m[1] || m[2] || "";
    if (!combined) return x.url || url;
    try {
      var decoded = b64decode(rot13(b64decode(b64decode(combined))));
      var obj = JSON.parse(decoded);
      var direct = b64decode(obj.o || "").trim();
      if (direct) return direct;
      var data = b64decode(obj.data || "").trim();
      var blog = String(obj.blog_url || "").trim();
      if (blog && data) {
        return fetchText(blog + "?re=" + encodeURIComponent(data), { headers: { "Referer": url } }, 1500)
          .then(function(y) { return String(y.text || "").trim() || url; });
      }
    } catch (_) {}
    return x.url || url;
  }).catch(function() { return url; });
}

function headerGet(res, name) {
  try { return String(res && res.headers && res.headers.get ? (res.headers.get(name) || "") : ""); } catch (_) { return ""; }
}

function responseMediaInfo(res, originalUrl) {
  var ct = headerGet(res, "content-type").toLowerCase().split(";")[0].trim();
  var cd = headerGet(res, "content-disposition").toLowerCase();
  var finalUrl = String((res && res.url) || originalUrl || "");
  var cr = headerGet(res, "content-range");
  var m = cr.match(/\/(\d+)\s*$/);
  var total = m ? Number(m[1]) : Number(headerGet(res, "content-length") || 0);
  var html = /text\/html|application\/json|javascript/.test(ct);
  var manifest = /mpegurl|dash\+xml/.test(ct) || /\.(?:m3u8|mpd)(?:$|[?#])/i.test(finalUrl);
  var media = /^video\//.test(ct) || /octet-stream|matroska|mp4/.test(ct) || /attachment/.test(cd) || /\.(?:mp4|mkv|webm|m4v)(?:$|[?#])/i.test(finalUrl);
  var sizeOk = !total || total >= 8 * 1024 * 1024 || manifest;
  return { playable: !!res && res.status >= 200 && res.status < 400 && !html && sizeOk && (manifest || media), url: finalUrl, total: total, type: ct };
}

function parseContentRangeStart(value) {
  var m = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  return m ? Number(m[1]) : -1;
}

function isR2Storage(url) {
  var host = hostOf(url);
  return /(?:^|\.)r2\.cloudflarestorage\.com$/i.test(host) ||
         /(?:^|\.)r2\.dev$/i.test(host);
}

function verifySeekRange(url, referer, total) {
  /*
   * A 0-1 probe only proves that the file exists. VUEO fast-forward needs
   * a non-zero byte-range request to be honoured as 206, otherwise the
   * player can fall back to byte 0 and appear to restart the video.
   */
  var maxStart =
    total && total > SEEK_PROBE_OFFSET + 4096
      ? Math.min(
          Math.max(SEEK_PROBE_OFFSET, Math.floor(total / 4)),
          Math.max(SEEK_PROBE_OFFSET, total - 4096)
        )
      : SEEK_PROBE_OFFSET;

  var end = maxStart + 1023;

  return withTimeout(fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: mergeHeaders({
      "Accept": "*/*",
      "Range": "bytes=" + maxStart + "-" + end,
      "Referer": referer || ""
    })
  }), SEEK_VERIFY_TIMEOUT_MS, "seek-range").then(function(res) {
    var cr = headerGet(res, "content-range");
    var start = parseContentRangeStart(cr);
    var ok = res.status === 206 && start === maxStart;

    console.log(
      "[HDHub4u] seek-probe host=" +
      hostOf((res && res.url) || url) +
      " status=" +
      res.status +
      " start=" +
      start +
      " expected=" +
      maxStart +
      " ok=" +
      ok
    );

    return ok;
  }).catch(function() {
    return false;
  });
}

function verifyDirect(url, referer) {
  function finish(res, originalUrl) {
    var info = responseMediaInfo(res, originalUrl);
    if (!info.playable) return Promise.resolve(null);

    var manifest =
      /mpegurl|dash\+xml/.test(info.type) ||
      /\.(?:m3u8|mpd)(?:$|[?#])/i.test(info.url);

    if (manifest) {
      console.log(
        "[HDHub4u] verify host=" +
        hostOf(info.url) +
        " status=" +
        res.status +
        " manifest=true ok=true"
      );
      return Promise.resolve({
        url: info.url,
        seekable: true,
        weakSeek: false,
        total: info.total || 0
      });
    }

    console.log(
      "[HDHub4u] verify host=" +
      hostOf(info.url) +
      " status=" +
      res.status +
      " MB=" +
      (info.total ? Math.round(info.total / 1048576) : "?") +
      " ok=true"
    );

    if(isR2Storage(info.url)){
      console.log('[HDHub4u] reject R2 playback host='+hostOf(info.url)+' reason=VUEO-seek-restart');
      return Promise.resolve(null);
    }
    return verifySeekRange(
      info.url,
      referer,
      info.total || 0
    ).then(function(seekable) {

      if (!seekable) {
        console.log(
          "[HDHub4u] reject non-seekable host=" +
          hostOf(info.url)
        );
        return null;
      }

      return {
        url: info.url,
        seekable: true,
        weakSeek: false,
        total: info.total || 0
      };
    });
  }

  function range() {
    return withTimeout(fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: mergeHeaders({
        "Accept": "*/*",
        "Range": "bytes=0-1",
        "Referer": referer || ""
      })
    }), VERIFY_TIMEOUT_MS, "range").then(function(res) {
      return finish(res, url);
    });
  }

  return withTimeout(fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: mergeHeaders({
      "Accept": "*/*",
      "Referer": referer || ""
    })
  }), VERIFY_TIMEOUT_MS, "head").then(function(res) {
    var info = responseMediaInfo(res, url);
    if (info.playable) return finish(res, url);
    if (/text\/html|application\/json/.test(info.type)) return null;
    return range().catch(function() { return null; });
  }).catch(function() {
    return range().catch(function() { return null; });
  });
}

function pixelDirect(url) {
  var m = String(url || "").match(/pixeldrain\.(?:com|dev|xyz)\/(?:u\/|api\/file\/)?([A-Za-z0-9]+)/i);
  return m ? "https://pixeldrain.com/api/file/" + m[1] + "?download" : url;
}

function collectAnchors(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  $("a[href]").each(function(_, el) {
    var a = $(el);
    var url = absoluteUrl(base, a.attr("href"));
    if (!/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    out.push({ url: url, label: String(a.text() || a.attr("download") || "").replace(/\s+/g, " ").trim() });
  });
  return out;
}

function serverScore(url, label) {
  var s = (String(url || "") + " " + String(label || "")).toLowerCase();

  /* Playback/seek priority, not download-speed priority. */
  if (/hubcdn/.test(s)) return 1250;
  if (/pixeldrain/.test(s)) return 1200;
  if (/workers\.dev/.test(s)) return 1150;
  if (/fsl server|s3 server/.test(s)) return 1080;
  if (/10gbps/.test(s)) return 1000;
  if (/hubcloud/.test(s)) return 900;
  if (/hubdrive/.test(s)) return 840;
  if (/hblinks/.test(s)) return 780;
  if (/streamtape/.test(s)) return 650;
  if (/download file/.test(s)) return 500;
  if (/r2\.cloudflarestorage\.com|r2\.dev/.test(s)) return 50;
  return 300;
}


function hlsHeaders(referer, origin) {
  var h = {
    "User-Agent": UA,
    "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    "Referer": referer || ""
  };
  if (origin) h["Origin"] = origin;
  return h;
}

function normalizeEscapedUrl(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/\\u0026/gi, "&")
       .replace(/\\u003d/gi, "=")
       .replace(/\\u002f/gi, "/")
       .replace(/\\\//g, "/")
       .replace(/&amp;/gi, "&");
  try { s = JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (_) {}
  return s;
}

function parseHlsVariants(body, playlistUrl, referer, headers, fallbackQuality) {
  var lines = String(body || "").replace(/\r/g, "").split("\n");
  var variants = [];
  var seen = Object.create(null);

  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || "").trim();
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;

    var attrs = line.substring(line.indexOf(":") + 1);
    var rm = attrs.match(/\bRESOLUTION\s*=\s*(\d+)x(\d+)/i);
    var bm = attrs.match(/\bBANDWIDTH\s*=\s*(\d+)/i);
    var q = rm ? Number(rm[2]) : 0;

    var j = i + 1;
    while (j < lines.length && (!String(lines[j] || "").trim() || /^#/.test(String(lines[j] || "").trim()))) j++;
    if (j >= lines.length) continue;

    var child = normalizeEscapedUrl(String(lines[j] || "").trim());
    if (/^\/\//.test(child)) child = "https:" + child;
    child = absoluteUrl(playlistUrl, child);
    if (!/^https?:\/\//i.test(child) || seen[child]) continue;
    seen[child] = true;

    variants.push({
      url: child,
      referer: referer || "",
      headers: headers || {},
      isHls: true,
      quality: q || Number(fallbackQuality || 0),
      bandwidth: bm ? Number(bm[1]) : 0
    });
  }

  if (!variants.length) {
    return [{
      url: playlistUrl,
      referer: referer || "",
      headers: headers || {},
      isHls: true,
      quality: Number(fallbackQuality || 0),
      bandwidth: 0
    }];
  }

  variants.sort(function(a, b) {
    if (b.quality !== a.quality) return b.quality - a.quality;
    return b.bandwidth - a.bandwidth;
  });

  return variants;
}

function verifyHls(url, referer, extraHeaders, fallbackQuality) {
  url = normalizeEscapedUrl(url);
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(null);

  var origin = "";
  try { origin = new URL(referer || url).origin; } catch (_) {}
  var headers = hlsHeaders(referer, origin);
  Object.keys(extraHeaders || {}).forEach(function(k) { headers[k] = extraHeaders[k]; });

  return fetchText(url, { headers: headers, redirect: "follow" }, 1650).then(function(x) {
    var body = String(x.text || "");
    var ct = headerGet({ headers: x.headers }, "content-type").toLowerCase();
    var finalUrl = String(x.url || url);
    var ok = /^\s*#EXTM3U(?:\s|$)/i.test(body);
    if (!ok) {
      console.log("[HDHub4u] HLS reject host=" + hostOf(finalUrl) + " ct=" + (ct || "?"));
      return null;
    }

    var audioLanguages = unique(String(body).split(/\r?\n/).filter(function(line){return /^#EXT-X-MEDIA:/i.test(line)&&/\bTYPE=AUDIO\b/i.test(line);}).map(function(line){var m=line.match(/\bLANGUAGE="([^"]+)"/i);return m?hdAudioCode(m[1]):'';}).filter(Boolean));
    var playlistHeights = Array.from(body.matchAll(/RESOLUTION=\d+x(\d+)/g)).map(function(m){return Number(m[1]);});
    var variants = parseHlsVariants(body, finalUrl, referer, headers, fallbackQuality);
    variants.forEach(function(v){v.audioLanguages=audioLanguages;v.playlistHeights=playlistHeights;});
    var qualities = variants.map(function(v) { return qualityLabel(v.quality); }).join(",");

    console.log(
      "[HDHub4u] HLS verified host=" + hostOf(finalUrl) +
      " variants=" + variants.length +
      " q=" + qualities
    );

    if (/#EXT-X-STREAM-INF:/i.test(body)) {
      return { url: finalUrl, referer: referer || "", headers: headers, isHls: true,
        isMaster: true, quality: 0, audioLanguages: audioLanguages, playlistHeights: playlistHeights };
    }
    return variants[0];
  }).catch(function() {
    return null;
  });
}

function unbasePacker(word, radix) {
  var alphabet62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var alphabet95 = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
  var alphabet = null;
  if (radix > 36) {
    if (radix <= 62) alphabet = alphabet62.substring(0, radix);
    else if (radix <= 95) alphabet = alphabet95.substring(0, radix);
  }
  if (!alphabet) {
    var n = parseInt(word, radix);
    return isNaN(n) ? -1 : n;
  }
  var out = 0;
  for (var i = 0; i < word.length; i++) {
    var p = alphabet.indexOf(word.charAt(i));
    if (p < 0) return -1;
    out = out * radix + p;
  }
  return out;
}

function unpackPacker(js) {
  var raw = String(js || "");
  if (!/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(raw)) return "";
  var m = raw.match(/\}\s*\('([\s\S]*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) {
    m = raw.match(/\}\s*\("([\s\S]*)",\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*?)"\.split\("\|"\)/);
  }
  if (!m) return "";

  var payload = String(m[1] || "").replace(/\\'/g, "'");
  var radix = Number(m[2] || 36);
  var count = Number(m[3] || 0);
  var symtab = String(m[4] || "").split("|");
  if (!count || symtab.length < count) return "";

  return payload.replace(/\b[a-zA-Z0-9_]+\b/g, function(word) {
    var n = unbasePacker(word, radix);
    return n >= 0 && n < symtab.length && symtab[n] ? symtab[n] : word;
  });
}

function extractHlsUrls(text, base) {
  var raw = String(text || "");
  var sources = [];
  var seen = Object.create(null);

  function add(v) {
    var u = normalizeEscapedUrl(v);
    if (!u) return;
    if (/^\/\//.test(u)) u = "https:" + u;
    if (/^\//.test(u)) u = absoluteUrl(base, u);
    if (!/^https?:\/\//i.test(u)) return;
    if (!/\.m3u8(?:$|[?#])/i.test(u) && !/m3u8/i.test(u)) return;
    if (seen[u]) return;
    seen[u] = true;
    sources.push(u);
  }

  var patterns = [
    /(?:file|source|src)\s*[:=]\s*["']([^"']+)["']/gi,
    /["'](https?:\\?\/\\?\/[^"']+?m3u8[^"']*)["']/gi,
    /(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/gi
  ];

  patterns.forEach(function(rex) {
    var m;
    while ((m = rex.exec(raw)) !== null) add(m[1]);
  });
  return sources;
}

function resolveHdstream4u(url, referer) {
  var input = String(url || "");
  var embed = input
    .replace("/download/", "/v/")
    .replace("/file/", "/v/")
    .replace("/embed/", "/v/")
    .replace("/d/", "/v/")
    .replace("/f/", "/v/");

  console.log("[HDHub4u] try WATCH host=" + hostOf(input));

  return fetchText(embed, {
    headers: {
      "Referer": referer || "",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site"
    }
  }, 1900).then(function(x) {
    var raw = String(x.text || "");
    var scripts = [];
    var $ = cheerio().load(raw);
    $("script").each(function(_, el) {
      var t = String($(el).html() || "");
      if (t) scripts.push(t);
    });

    var joined = scripts.join("\n");
    var unpacked = unpackPacker(joined);
    var candidates = extractHlsUrls(unpacked || joined, x.url);

    if (!candidates.length && unpacked) {
      candidates = extractHlsUrls(joined, x.url);
    }

    console.log("[HDHub4u] WATCH HLS candidates=" + candidates.length);

    function next(i) {
      if (i >= candidates.length || i >= 3) return Promise.resolve(null);
      var origin = originOf(x.url);
      return verifyHls(candidates[i], x.url, {
        "Origin": origin,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site"
      }).then(function(hit) {
        if (hit) {
          var pageQ = qualityNumber(raw) || 1080;
          hit.label = "WATCH";
          if (!hit.quality) hit.quality = pageQ;
          if (Array.isArray(hit.variants)) {
            hit.variants.forEach(function(v) {
              v.label = "WATCH";
              if (!v.quality) v.quality = pageQ;
            });
          }
          return hit;
        }
        return next(i + 1);
      });
    }
    return next(0);
  }).catch(function(e) {
    console.log("[HDHub4u] WATCH fail=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function getCryptoJS() {
  return require("crypto-js");
}

function resolveHubstream(url, referer) {
  var rawUrl = String(url || "");
  var hash = "";
  try {
    var u = new URL(rawUrl);
    hash = String(u.hash || "").replace(/^#/, "");
    if (!hash) {
      var parts = u.pathname.split("/").filter(Boolean);
      hash = parts.length ? parts[parts.length - 1] : "";
    }
  } catch (_) {
    hash = rawUrl.split("#").pop().split("/").pop();
  }

  if (!hash) return Promise.resolve(null);

  var base = originOf(rawUrl) || "https://hubstream.art";
  var api = base + "/api/v1/video?id=" + encodeURIComponent(hash);
  console.log("[HDHub4u] try PLAYER-2 host=" + hostOf(rawUrl) + " id=" + hash.slice(0, 8));

  return fetchText(api, {
    headers: {
      "Accept": "text/plain,*/*",
      "Referer": rawUrl,
      "Origin": base
    }
  }, 1700).then(function(x) {
    var encoded = String(x.text || "").trim();
    if (!/^[0-9a-f]+$/i.test(encoded) || encoded.length < 32) return null;

    var CryptoJS = getCryptoJS();
    var key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
    var ivs = ["1234567890oiuytr", "0123456789abcdef"];

    function decryptAt(i) {
      if (i >= ivs.length) return Promise.resolve(null);
      try {
        var iv = CryptoJS.enc.Utf8.parse(ivs[i]);
        var dec = CryptoJS.AES.decrypt(
          { ciphertext: CryptoJS.enc.Hex.parse(encoded) },
          key,
          { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        var text = dec.toString(CryptoJS.enc.Utf8);
        var m = text && text.match(/"source"\s*:\s*"([^"]+)"/i);
        var source = m ? normalizeEscapedUrl(m[1]) : "";
        var subtitles = [];
        try {
          var payload = JSON.parse(text);
          var entries = payload.subtitle || payload.subtitles || {};
          Object.keys(entries).forEach(function(language) {
            var value = entries[language];
            var raw = typeof value === 'string' ? value : value && (value.url || value.file);
            var subtitleUrl = raw && absoluteUrl(base + '/', normalizeEscapedUrl(raw).split('#')[0]);
            if (/^https?:\/\//i.test(subtitleUrl || '')) subtitles.push({ language: language, url: subtitleUrl,
              headers: { "User-Agent": UA, "Referer": rawUrl, "Origin": base } });
          });
        } catch (_) {}
        if (!source) return decryptAt(i + 1);

        var tries = [source];
        if (/^http:\/\//i.test(source)) tries.push(source.replace(/^http:/i, "https:"));

        function verifyAt(j) {
          if (j >= tries.length) return decryptAt(i + 1);
          return verifyHls(tries[j], rawUrl, {
            "Origin": base,
            "Referer": rawUrl
          }).then(function(hit) {
            if (hit) {
              hit.label = "PLAYER-2";
              hit.subtitles = subtitles;
              if (!hit.quality) hit.quality = 0;
              if (Array.isArray(hit.variants)) {
                hit.variants.forEach(function(v) {
                  v.label = "PLAYER-2";
                  if (!v.quality) v.quality = 0;
                });
              }
              return hit;
            }
            return verifyAt(j + 1);
          });
        }
        return verifyAt(0);
      } catch (_) {
        return decryptAt(i + 1);
      }
    }

    return decryptAt(0);
  }).catch(function(e) {
    console.log("[HDHub4u] PLAYER-2 fail=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function siteStreamLinks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  var counts = { watch: 0, player2: 0, hubcdn: 0 };

  $("a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var label = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    if (!href || seen[href]) return;

    var host = hostOf(href);
    var kind = "";
    var priority = 0;
    var q = qualityNumber(label);

    if (/hubstream|vidstack/i.test(host)) {
      kind = "player2";
      priority = 1300;
      counts.player2++;
    } else if (/hdstream4u/i.test(host)) {
      kind = "watch";
      priority = 1200;
      counts.watch++;
    } else if (/hubcdn/i.test(host)) {
      kind = "hubcdn";
      priority = 900;
      counts.hubcdn++;
    } else {
      return;
    }

    seen[href] = true;
    out.push({ url: href, label: label, kind: kind, priority: priority, quality: q });
  });

  console.log(
    "[HDHub4u] site-stream links watch=" + counts.watch +
    " player2=" + counts.player2 +
    " hubcdn=" + counts.hubcdn
  );

  return out.sort(function(a, b) {
    return b.priority - a.priority;
  });
}

function resolveSiteStream(item, detailUrl) {
  if (!item || !item.url) return Promise.resolve(null);
  if (item.kind === "player2") return resolveHubstream(item.url, detailUrl);
  if (item.kind === "watch") return resolveHdstream4u(item.url, detailUrl);
  if (item.kind === "hubcdn") return resolveHubCdn(item.url, detailUrl);
  return Promise.resolve(null);
}

function resolveHubCdn(url, referer) {
  console.log("[HDHub4u] try HubCDN host=" + hostOf(url));
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var data = String(x.text || "");
    var direct = "";

    var reurl = data.match(/\b(?:var|let|const)\s+reurl\s*=\s*["']([^"']+)["']/i);
    if (reurl && reurl[1]) {
      var val = normalizeEscapedUrl(reurl[1]);
      var rm = val.match(/[?&]r=([^&]+)/i);
      if (rm) {
        try {
          var decoded = b64decode(decodeURIComponent(rm[1]));
          var idx = decoded.lastIndexOf("link=");
          direct = idx >= 0 ? decoded.substring(idx + 5) : decoded;
        } catch (_) {}
      } else {
        var lm = val.match(/[?&]link=([^&]+)/i);
        if (lm) {
          try { direct = decodeURIComponent(lm[1]); } catch (_) { direct = lm[1]; }
        } else if (/^https?:\/\//i.test(val)) {
          direct = val;
        }
      }
    }

    if (!direct) {
      var encoded = data.match(/[?&]r=([A-Za-z0-9+/=]+)/i) || data.match(/\br=([A-Za-z0-9+/=]{16,})/i);
      if (encoded && encoded[1]) {
        try {
          var decoded2 = b64decode(encoded[1]);
          var idx2 = decoded2.lastIndexOf("link=");
          direct = idx2 >= 0 ? decoded2.substring(idx2 + 5) : decoded2;
        } catch (_) {}
      }
    }

    direct = normalizeEscapedUrl(direct);
    if (!direct) return null;

    return verifyHls(direct, url, { "Referer": url }).then(function(hit) {
      if (!hit) return null;
      hit.label = "HubCDN";
      if (!hit.quality) hit.quality = 480;
      if (Array.isArray(hit.variants)) {
        hit.variants.forEach(function(v) {
          v.label = "HubCDN";
          if (!v.quality) v.quality = 480;
        });
      }
      return hit;
    });
  }).catch(function() { return null; });
}

function resolveHblinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var links = collectAnchors(x.text, x.url).filter(function(a) {
      return /hubcloud|hubdrive|hubcdn|hubstream|vidstack|hdstream4u|pixeldrain|workers\.dev|streamtape/i.test(a.url);
    }).sort(function(a, b) { return serverScore(b.url, b.label) - serverScore(a.url, a.label); });
    return resolveCandidates(links.slice(0, 4), x.url);
  }).catch(function() { return null; });
}

function resolveHubDrive(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var $ = cheerio().load(x.text);
    var href = String($(".btn.btn-primary.btn-user.btn-success1.m-1[href]").first().attr("href") || "").trim();
    if (href) return resolveServer(absoluteUrl(x.url, href), x.url);
    var links = collectAnchors(x.text, x.url).filter(function(a) {
      return a.url !== x.url && /hubcloud|hubcdn|hblinks|pixeldrain|workers\.dev/i.test(a.url);
    });
    return resolveCandidates(links.slice(0, 4), x.url);
  }).catch(function() { return null; });
}

function resolveDownloadLanding(url,referer,depth){
 depth=depth||0;if(!hdActive||depth>3)return Promise.resolve(null);
 if(/gpdl\.|cryptonewz\./i.test(hostOf(url))){
 return fetchText(url,{headers:{Referer:referer||''}},2200).then(function(page){
 var target='';try{var u=new URL(page.url),q=u.searchParams.get('link');if(q&&/downloadBtn/.test(page.text)&&/params\.get\(\s*['"]link['"]\s*\)/.test(page.text))target=q;}catch(_){}
 if(!target){var $=cheerio().load(page.text);target=$('#downloadBtn[href]').attr('href')||'';}
 target=absoluteUrl(page.url,target);if(!/^https?:\/\//i.test(target)||target===page.url)return null;
 return resolveDownloadLanding(target,page.url,depth+1);
 }).catch(function(){return null;});
 }
 return verifyDirect(url,referer);
}
function resolveHubCloud(url, referer) {
  url = String(url || "").replace("hubcloud.ink", "hubcloud.dad");
  return fetchText(url, { headers: { "Referer": referer || PRIMARY_BASE + "/" } }, 1900).then(function(first) {
    var html = first.text;
    var pageUrl = first.url;
    var m = html.match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i);
    if (m && m[1]) {
      var next = absoluteUrl(pageUrl, m[1]);
      return fetchText(next, { headers: { "Referer": pageUrl } }, 1700).then(function(second) {
        return { html: second.text, pageUrl: second.url };
      }).catch(function() { return { html: html, pageUrl: pageUrl }; });
    }
    return { html: html, pageUrl: pageUrl };
  }).then(function(page) {
    var buttons = collectAnchors(page.html, page.pageUrl).filter(function(b){
      if(/\/tg\/go(?:[?#]|$)|telegram|tinyurl|winexch/i.test(b.url)||/tutorial|how to|privacy|contact|login|watch online/i.test(b.label))return false;
      return /hubcloud|hubdrive|hubcdn|hblinks|pixeldrain|workers\.dev|googleusercontent|gpdl\.|r2\.cloudflarestorage/i.test(hostOf(b.url))&&/download|server|gbps|hubcloud|hubdrive|hubcdn/i.test(b.label);
    }).sort(function(a, b) {
      return serverScore(b.url, b.label) - serverScore(a.url, a.label);
    });
    console.log("[HDHub4u] HubCloud buttons=" + buttons.length + " host=" + hostOf(page.pageUrl));

    function acceptOrContinue(hit, index) {
      if (!hit) return next(index + 1);
      if (hit.weakSeek || isR2Storage(hit.url)) {
        console.log(
          "[HDHub4u] skip weak-seek host=" +
          hostOf(hit.url) +
          " label='" +
          (hit.label || "") +
          "'"
        );
        return next(index + 1);
      }
      return hit;
    }

    function next(i) {
      if (i >= buttons.length || i >= 12) {
        return Promise.resolve(null);
      }

      var b = buttons[i];
      var u = b.url;
      var label = String(b.label || "").toLowerCase();

      if (
        /privacy|telegram|contact|home|login/.test(label) &&
        !/download|server|10gbps/.test(label)
      ) {
        return next(i + 1);
      }

      if (/pixeldrain/i.test(u)) {
        var pd = pixelDirect(u);
        return verifyDirect(pd, page.pageUrl).then(function(v) {
          return acceptOrContinue(
            v
              ? {
                  url: v.url,
                  referer: page.pageUrl,
                  label: "PixelDrain",
                  weakSeek: !!v.weakSeek
                }
              : null,
            i
          );
        });
      }

      if (/hubcdn/i.test(u)) {
        return resolveHubCdn(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (/hblinks/i.test(u)) {
        return resolveHblinks(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (/hubdrive/i.test(u)) {
        return resolveHubDrive(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (
        /workers\.dev|\.(?:mp4|mkv|webm|m3u8|m4v)(?:$|[?#])/i.test(u) ||
        /fsl server|s3 server|download file|10gbps|buzzserver/i.test(label)
      ) {
        var direct = u;
        var lm = direct.match(/[?&]link=([^&]+)/i);

        if (lm) {
          try {
            direct = decodeURIComponent(lm[1]);
          } catch (_) {
            direct = lm[1];
          }
        }

        if (
          /buzzserver/i.test(label) &&
          !/\/download(?:$|[?#])/i.test(direct)
        ) {
          direct = direct.replace(/\/$/, "") + "/download";
        }

        return resolveDownloadLanding(direct, page.pageUrl).then(function(v) {
          return acceptOrContinue(
            v
              ? {
                  url: v.url,
                  referer: page.pageUrl,
                  label: b.label || "Direct",
                  weakSeek: !!v.weakSeek
                }
              : null,
            i
          );
        });
      }

      return next(i + 1);
    }
    return next(0);
  }).catch(function(e) {
    console.log("[HDHub4u] HubCloud fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveStreamTape(url, referer) {
  try {
    var u = new URL(url);
    u.hostname = "streamtape.com";
    url = u.toString();
  } catch (_) {}
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var m = x.text.match(/['"](\/\/streamtape\.com\/get_video[^'"<>]+)['"]/i);
    if (!m) return null;
    var direct = "https:" + m[1].replace(/&amp;/g, "&");
    return verifyDirect(direct, x.url).then(function(v) { return v ? { url: v.url, referer: x.url, label: "StreamTape", weakSeek: !!v.weakSeek } : null; });
  }).catch(function() { return null; });
}

function resolveServer(url, referer) {
  url = String(url || "").trim();
  if (!url) return Promise.resolve(null);
  return (/techyboy4u|[?&]id=/i.test(url) ? getRedirectLinks(url, referer) : Promise.resolve(url)).then(function(resolved) {
    resolved = String(resolved || url).trim();
    var host = hostOf(resolved);
    if (/hubstream|vidstack/i.test(host)) return resolveHubstream(resolved, referer);
    if (/hdstream4u/i.test(host)) return resolveHdstream4u(resolved, referer);
    if (/pixeldrain/i.test(host)) {
      var pd = pixelDirect(resolved);
      return verifyDirect(pd, referer).then(function(v) { return v ? { url: v.url, referer: referer || "", label: "PixelDrain", weakSeek: !!v.weakSeek } : null; });
    }
    if (/hubcloud/i.test(host)) return resolveHubCloud(resolved, referer);
    if (/hubdrive/i.test(host)) return resolveHubDrive(resolved, referer);
    if (/hubcdn/i.test(host)) return resolveHubCdn(resolved, referer);
    if (/hblinks/i.test(host)) return resolveHblinks(resolved, referer);
    if (/streamtape/i.test(host)) return resolveStreamTape(resolved, referer);
    if (/linkrit/i.test(host)) return null;
    if (/workers\.dev|\.(?:mp4|mkv|webm|m3u8|m4v)(?:$|[?#])/i.test(resolved)) {
      return verifyDirect(resolved, referer).then(function(v) { return v ? { url: v.url, referer: referer || "", label: host, weakSeek: !!v.weakSeek } : null; });
    }
    return null;
  }).catch(function() { return null; });
}

function resolveCandidates(items, referer) {
  var sorted = (items || []).slice().sort(function(a, b) {
    return serverScore(b.url, b.label) - serverScore(a.url, a.label);
  });
  function next(i) {
    if (i >= sorted.length) return Promise.resolve(null);
    return resolveServer(sorted[i].url, referer).then(function(v) {
      return v || next(i + 1);
    }).catch(function() { return next(i + 1); });
  }
  return next(0);
}

function resolveTvQualityRedirect(block, detailUrl, episode) {
  return getRedirectLinks(block.url, detailUrl).then(function(resolvedPage) {
    if (!resolvedPage || resolvedPage === block.url) return null;
    return fetchText(resolvedPage, { headers: { "Referer": block.url } }, 1800).then(function(x) {
      var $ = cheerio().load(x.text);
      var links = [];
      $("h5 a[href], h4 a[href], h3 a[href]").each(function(_, el) {
        var a = $(el);
        var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
        var m = text.match(/(?:episode|ep)\s*[-:#]?\s*0*(\d{1,3})/i) || text.match(/\bE0*(\d{1,3})\b/i);
        if (!m || Number(m[1]) !== Number(episode)) return;
        var href = absoluteUrl(x.url, a.attr("href"));
        if (href && !/\.zip(?:$|[?#])/i.test(href)) links.push({ url: href, label: text });
      });
      console.log("[HDHub4u] TV redirect q=" + qualityLabel(block.quality) + " episode links=" + links.length);
      return resolveCandidates(links, x.url);
    });
  }).catch(function() { return null; });
}

function expandResolvedHit(hit, fallbackQuality) {
  if (!hit) return [];
  var rows = Array.isArray(hit.variants) && hit.variants.length ? hit.variants.slice() : [hit];
  return rows.map(function(row) {
    var out = {};
    Object.keys(row || {}).forEach(function(k) { out[k] = row[k]; });
    if (!out.quality && !out.isMaster) out.quality = Number(fallbackQuality || hit.quality || 0);
    if (!out.label) out.label = hit.label || "";
    if (!out.referer) out.referer = hit.referer || "";
    if (!out.headers) out.headers = hit.headers || {};
    if (!out.subtitles) out.subtitles = hit.subtitles || [];
    if (typeof out.isHls !== "boolean") out.isHls = !!hit.isHls;
    return out;
  });
}

function preferredMovieBlock(blocks, quality) {
  var rows = (blocks || []).filter(function(b) {
    return Number(b.quality || 0) === Number(quality);
  });

  rows.sort(function(a, b) {
    function score(x) {
      var t = String(x.text || "").toLowerCase();
      var s = 0;
      if (/x264|h264|avc/.test(t)) s += 80;
      if (/web-dl/.test(t)) s += 40;
      if (/10bit|hevc|x265|h265/.test(t)) s -= 10;
      if (/6\.8gb|remux/.test(t)) s -= 20;
      return s;
    }
    return score(b) - score(a);
  });

  return rows[0] || null;
}

function dedupeMovieHits(hits) {
  var seen = Object.create(null), out = [];
  (hits || []).forEach(function(hit) {
    if (!hit || !/^https?:\/\//i.test(hit.url || '')) return;
    var key = JSON.stringify([hit.url, hit.headers || {}, hit.subtitles || []]);
    if (seen[key]) return;
    seen[key] = true; out.push(hit);
  });
  return out.sort(function(a, b) {
    if (!!a.isMaster !== !!b.isMaster) return a.isMaster ? -1 : 1;
    return Number(b.quality || 0) - Number(a.quality || 0);
  });
}

function hdAudioCode(value){var x=String(value||'').toLowerCase().trim();return ({eng:'en',english:'en',hin:'hi',hindi:'hi',jpn:'ja',japanese:'ja',kor:'ko',korean:'ko',tam:'ta',tamil:'ta',tel:'te',telugu:'te',malay:'ms',msa:'ms'})[x]||x;}
function hdDeclaredAudio(text){var names=String(text||'').match(/\b(?:english|hindi|japanese|korean|tamil|telugu|malay)\b/gi)||[];return unique(names.map(hdAudioCode));}
function hdEligible(hit,info){
 if(!hit||!hit.url)return false;
 if(!hit.isMaster&&Number(hit.quality)>0&&Number(hit.quality)<720)return false;
 if(Array.isArray(hit.playlistHeights)&&hit.playlistHeights.length&&Math.max.apply(null,hit.playlistHeights)<720)return false;
 var original=info&&info.originalLanguage,audios=hit.audioLanguages||[];
 if(original&&audios.length&&audios.indexOf(original)<0)return false;
 return true;
}
function hdFirstEligible(tasks,info,budget){
 return new Promise(function(resolve){
  if(!tasks.length){resolve([]);return;}
  var ended=false,pending=tasks.length,timer=setTimeout(function(){finish([]);},budget);
  function finish(rows){if(ended)return;ended=true;clearTimeout(timer);resolve(rows);}
  tasks.forEach(function(run){Promise.resolve().then(run).then(function(rows){
   if(ended)return;rows=(Array.isArray(rows)?rows:[]).filter(function(hit){return hdEligible(hit,info);});
   if(rows.length)finish(dedupeMovieHits(rows));
  }).catch(function(){}).then(function(){pending--;if(!pending)finish([]);});});
 });
}
function resolveMoviePage(html,detailUrl,info){
 var streamLinks=siteStreamLinks(html,detailUrl).slice(0,2);
 var fast=streamLinks.filter(function(item){var a=hdDeclaredAudio(item.label);return !info.originalLanguage||!a.length||a.indexOf(info.originalLanguage)>=0;}).map(function(item){return function(){return resolveSiteStream(item,detailUrl).then(function(hit){return expandResolvedHit(hit,item.quality||0);});};});
 console.log('[HDHub4u] FAST: site-stream tasks='+fast.length+'; stop on first eligible HLS; no quality grace');
 return hdFirstEligible(fast,info,MULTI_TASK_TIMEOUT_MS).then(function(hits){
  if(hits.length){console.log('[HDHub4u] FAST: source ready; download fallback not started');return hits;}
  var blocks=movieBlocks(html,detailUrl),tasks=[];
  [2160,1080,720].forEach(function(q){var block=preferredMovieBlock(blocks,q);if(!block)return;
   var a=hdDeclaredAudio(block.text);if(info.originalLanguage&&a.length&&a.indexOf(info.originalLanguage)<0)return;
   tasks.push(function(){return resolveServer(block.url,detailUrl).then(function(hit){if(!hit)return [];hit.quality=q;return expandResolvedHit(hit,q);});});
  });
  console.log('[HDHub4u] FALLBACK: quality tasks='+tasks.length);
  return hdFirstEligible(tasks,info,MULTI_TASK_TIMEOUT_MS);
 });
}

function resolveTvPage(html, detailUrl, episode) {
  var direct = episodeDirectBlocks(html, detailUrl, episode).sort(function(a, b) { return blockScore(b) - blockScore(a); });
  console.log("[HDHub4u] TV direct episode links=" + direct.length);
  if (direct.length) {
    function tryDirect(i) {
      if (i >= direct.length || i >= 6) return Promise.resolve(null);
      var block = direct[i];
      return resolveServer(block.url, detailUrl).then(function(v) {
        if (v) {
          v.quality = block.quality || 0;
          return v;
        }
        return tryDirect(i + 1);
      }).catch(function() { return tryDirect(i + 1); });
    }
    return tryDirect(0);
  }

  var redirects = qualityRedirects(html, detailUrl).sort(function(a, b) { return blockScore(b) - blockScore(a); });
  console.log("[HDHub4u] TV quality redirects=" + redirects.length);
  function next(i) {
    if (i >= redirects.length || i >= 5) return Promise.resolve(null);
    var b = redirects[i];
    return resolveTvQualityRedirect(b, detailUrl, episode).then(function(v) {
      if (v) { v.quality = b.quality; return v; }
      return next(i + 1);
    });
  }
  return next(0);
}

function toStream(hit, info, mediaType, season, episode) {
  var suffix = mediaType === "tv" ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0") : "";
  var headers = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Referer": hit.referer || ""
  };
  Object.keys(hit.headers || {}).forEach(function(k) {
    headers[k] = hit.headers[k];
  });

  return {
    name: PROVIDER,
    title: info.title + suffix + " • " + (hit.isMaster ? "Auto" : qualityLabel(hit.quality)) + " • " + (hit.label || hostOf(hit.url)),
    url: hit.url,
    quality: hit.isMaster ? "Auto" : qualityLabel(hit.quality),
    type: hit.isHls ? "hls" : "direct",
    mimeType: hit.isHls ? "application/x-mpegURL" : undefined,
    headers: headers,
    audioLanguages: hit.audioLanguages || [],
    audioLanguage: (hit.audioLanguages || []).indexOf(info.originalLanguage) >= 0 ? info.originalLanguage : undefined,
    subtitles: hit.subtitles || []
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  var started = Date.now();
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = season == null ? 1 : Math.max(0, Number(season));
  var e = Math.max(1, Number(episode || 1));
  var info;

  console.log("[HDHub4u] v" + VERSION + " TMDB=" + tmdbId + " type=" + type + (type === "tv" ? " S" + s + "E" + e : ""));

  var work = Promise.all([tmdbInfo(tmdbId, type), discoverCurrentBase()]).then(function(values) {
    info = values[0];
    console.log("[HDHub4u] title='" + info.title + "' year=" + (info.year || "?"));
    if (!info.title) return null;
    return findDetail(info, type, s);
  }).then(function(found) {
    if (!found || !found.item) {
      console.log("[HDHub4u] title not found");
      return null;
    }
    console.log("[HDHub4u] matched title='" + found.item.title + "' url=" + found.item.url);
    return fetchText(found.item.url, { headers: { "Referer": found.base + "/" } }, 2200).then(function(page) {
      if (type === "movie") return resolveMoviePage(page.text, page.url, info);
      return resolveTvPage(page.text, page.url, e);
    });
  }).then(function(result) {
    var hits = type === "movie"
      ? (Array.isArray(result) ? result : (result ? [result] : []))
      : (result ? [result] : []);

    if (!hits.length) return [];

    var streams = hits.filter(function(hit) {
      return hdEligible(hit, info);
    }).map(function(hit) {
      console.log(
        "[HDHub4u] READY host=" + hostOf(hit.url) +
        " q=" + qualityLabel(hit.quality) +
        " mode=" + (hit.isHls ? "hls" : "direct") +
        " source=" + (hit.label || "?") +
        " elapsed=" + (Date.now() - started) + "ms"
      );
      return toStream(hit, info, type, s, e);
    });

    streams.sort(function(a, b) {
      if ((a.quality === "Auto") !== (b.quality === "Auto")) return a.quality === "Auto" ? -1 : 1;
      return qualityNumber(b.quality) - qualityNumber(a.quality);
    });

    return streams;
  });

  return withTimeout(work, PROVIDER_BUDGET_MS, "HDHub4u provider").then(function(streams) {
    streams = Array.isArray(streams) ? streams : [];
    console.log("[HDHub4u] v" + VERSION + " playable sources=" + streams.length + " elapsed=" + (Date.now() - started) + "ms");
    return streams;
  }).catch(function(err) {
    console.log("[HDHub4u] error=" + (err && err.message ? err.message : String(err)) + " elapsed=" + (Date.now() - started) + "ms");
    return [];
  });
}

module.exports = { getStreams: getStreams };

/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */
  })(transferredModule, transferredModule.exports, metadataFetch);
  transferredModule.exports.stop=stopTransferred;
  return transferredModule.exports;
}
var cloudbankTestPluginProvider=createHdHubEngine();
function cloudbankTestPluginAttempt(provider, args, ms) {
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function() { finish([]); }, ms);
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Array.isArray(value) ? value.filter(function(item) {
        return item && typeof item.url === "string" && /^https?:\/\//i.test(item.url);
      }) : []);
    }
    Promise.resolve().then(function() {
      return provider.getStreams.apply(provider, args);
    }).then(finish, function() { finish([]); });
  });
}
module.exports = Object.assign({}, cloudbankLegacyProvider, {
  getStreams: function(id, type, season, episode) {
    type = type === "series" ? "tv" : type;
    if (!String(id || "").trim() || (type !== "movie" && type !== "tv")) return Promise.resolve([]);
    if (type === "tv" && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    var args = [String(id), type, season, episode];
    var engine=createHdHubEngine();
    return cloudbankTestPluginAttempt(engine,args,18000).then(function(streams){engine.stop();return streams;},function(){engine.stop();return [];});
  }
});
/* CLOUDBANK_TEST_PLUGIN_ADAPTATION_END */

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
/* HDHUB_POLISH_V171_START */
function hdhubPolish(provider){
 function audioCode(v){var x=String(v||'').toLowerCase();return ({eng:'en',english:'en',hin:'hi',hindi:'hi',jpn:'ja',japanese:'ja',kor:'ko',korean:'ko',tam:'ta',tamil:'ta',tel:'te',telugu:'te'})[x]||x;}
 function eligibleOutput(row,requestedId){
  if(!row)return false;var q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(row.quality||''));if(q&&Number(q[1])<720)return false;
  var ctx=typeof globalThis!=='undefined'?globalThis.VUEO_DISCOVERY_CONTEXT:null;
  if(typeof ctx==='string'){try{ctx=JSON.parse(ctx);}catch(_){ctx=null;}}
  var id=ctx&&(ctx.tmdbId||ctx.tmdb&&ctx.tmdb.id),original=ctx&&audioCode(ctx.originalLanguage||ctx.original_language||ctx.tmdb&&ctx.tmdb.original_language);
  if(!original||!id||String(id)!==String(requestedId))return true;
  var audio=audioCode(row.audioLanguage),many=Array.isArray(row.audioLanguages)?row.audioLanguages.map(audioCode):[];
  if(many.length)return many.indexOf(original)>=0;
  if(audio&&audio!==original&&!row.isMultiAudio&&!row.isDualAudio)return false;
  return row.isDubbed!==true||audio===original;
 }

 function language(v){var x=String(v||'').trim().toLowerCase().replace(/_/g,'-');return ({english:'en',eng:'en',malay:'ms',melayu:'ms',msa:'ms',may:'ms'})[x]||x;}
 var original=provider.getStreams;
 return Object.assign({},provider,{getStreams:function(){var args=arguments;return Promise.resolve().then(function(){return original.apply(provider,args);}).then(function(rows){return (Array.isArray(rows)?rows:[]).filter(function(row){return eligibleOutput(row,args[0]);}).map(function(row){
  var out=Object.assign({},row);
  if(/\.m3u8(?:[?#]|$)/i.test(out.url||'')||/^(hls|application\/x-mpegurl)$/i.test(out.type||'')){out.type='hls';out.mimeType='application/x-mpegURL';}
  var seen={};out.subtitles=(Array.isArray(out.subtitles)?out.subtitles:[]).map(function(track){
   if(!track)return null;var code=language(track.language||track.lang||track.srclang||track.label),u=track.url||track.file||track.src;
   if(!/^(en|ms)(?:-|$)/.test(code)||!/^https?:\/\//i.test(u||'')||seen[u])return null;seen[u]=true;
   var t=Object.assign({},track,{url:u,language:code,lang:code});
   var format=String(t.mimeType||t.format||t.type||'').toLowerCase();
   if(/\.vtt(?:[?#]|$)/i.test(u)||/^(vtt|text\/vtt)$/.test(format))t.mimeType='text/vtt';
   else if(/\.srt(?:[?#]|$)/i.test(u)||/srt|subrip/.test(format))t.mimeType='application/x-subrip';
   else if(/\.(ass|ssa)(?:[?#]|$)/i.test(u))t.mimeType='text/x-ssa';
   return t;
  }).filter(Boolean);
  return out;
 });});}});
}
module.exports=hdhubPolish(module.exports);
/* HDHUB_POLISH_V171_END */

module.exports = cloudbankDisplayInstall(module.exports, "HDHub4u", "hdhub4u");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
