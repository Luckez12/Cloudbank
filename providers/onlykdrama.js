// Imported provider: onlykdrama; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
'use strict';var _0xbb3974=_0x147b;(function(_0x4426d2,_0x1591e3){var _0x38e1c9=_0x147b,_0x40f0f1=_0x4426d2();while(!![]){try{var _0xf8074d=-parseInt(_0x38e1c9(0x11b))/0x1+-parseInt(_0x38e1c9(0x114))/0x2+-parseInt(_0x38e1c9(0x10b))/0x3*(parseInt(_0x38e1c9(0x116))/0x4)+-parseInt(_0x38e1c9(0x100))/0x5*(parseInt(_0x38e1c9(0x126))/0x6)+parseInt(_0x38e1c9(0xff))/0x7*(-parseInt(_0x38e1c9(0xf8))/0x8)+parseInt(_0x38e1c9(0xf7))/0x9+parseInt(_0x38e1c9(0x106))/0xa;if(_0xf8074d===_0x1591e3)break;else _0x40f0f1['push'](_0x40f0f1['shift']());}catch(_0x54b78a){_0x40f0f1['push'](_0x40f0f1['shift']());}}}(_0x932f,0xcba5a));var PROVIDER_NAME='OnlyKDrama',SITE_URL=_0xbb3974(0x11f),TMDB_URL=_0xbb3974(0x104),FILEPRESS_ORIGIN=_0xbb3974(0xfb),DEFAULT_HEADERS={'User-Agent':_0xbb3974(0x136),'Accept-Language':_0xbb3974(0xf0)},STOP_WORDS={'a':!![],'an':!![],'and':!![],'at':!![],'by':!![],'for':!![],'from':!![],'in':!![],'of':!![],'on':!![],'the':!![],'to':!![],'tv':!![]};function mergeHeaders(_0x27457d,_0x45029c){var _0x1d9f84=_0xbb3974,_0x1b0d01={},_0x5cd293;for(_0x5cd293 in _0x27457d){Object[_0x1d9f84(0x130)][_0x1d9f84(0x10d)][_0x1d9f84(0x12c)](_0x27457d,_0x5cd293)&&(_0x1b0d01[_0x5cd293]=_0x27457d[_0x5cd293]);}if(!_0x45029c)return _0x1b0d01;for(_0x5cd293 in _0x45029c){Object[_0x1d9f84(0x130)][_0x1d9f84(0x10d)][_0x1d9f84(0x12c)](_0x45029c,_0x5cd293)&&(_0x1b0d01[_0x5cd293]=_0x45029c[_0x5cd293]);}return _0x1b0d01;}function fetchText(_0x4ff150,_0x1a3cef){var _0xfa9d46=_0xbb3974,_0x4a2aeb=_0x1a3cef||{};return _0x4a2aeb[_0xfa9d46(0x113)]=mergeHeaders(DEFAULT_HEADERS,_0x4a2aeb[_0xfa9d46(0x113)]||{}),fetch(_0x4ff150,_0x4a2aeb)[_0xfa9d46(0x133)](function(_0x4acd18){var _0x23a477=_0xfa9d46;if(!_0x4acd18['ok'])throw new Error(_0x23a477(0x13a)+_0x4acd18['status']+_0x23a477(0x115)+_0x4ff150);return _0x4acd18[_0x23a477(0x122)]();});}function fetchJson(_0x4a0b42,_0x5ebb7d){var _0x466425=_0xbb3974,_0x3c6c6b=_0x5ebb7d||{};return _0x3c6c6b[_0x466425(0x113)]=mergeHeaders(DEFAULT_HEADERS,_0x3c6c6b[_0x466425(0x113)]||{}),fetch(_0x4a0b42,_0x3c6c6b)[_0x466425(0x133)](function(_0x520aea){var _0x60bce=_0x466425;if(!_0x520aea['ok'])throw new Error('HTTP\x20'+_0x520aea[_0x60bce(0x13f)]+_0x60bce(0x115)+_0x4a0b42);return _0x520aea[_0x60bce(0x128)]();});}function decodeHtml(_0x32ce18){var _0x152e22=_0xbb3974;if(!_0x32ce18)return'';return _0x32ce18['replace'](/&#(\d+);/g,function(_0x3af2a5,_0x149eb4){var _0x45fda9=_0x147b;return String[_0x45fda9(0x119)](parseInt(_0x149eb4,0xa));})[_0x152e22(0x13e)](/&amp;/g,'&')[_0x152e22(0x13e)](/&quot;/g,'\x22')[_0x152e22(0x13e)](/&#39;/g,'\x27')[_0x152e22(0x13e)](/&apos;/g,'\x27')[_0x152e22(0x13e)](/&lt;/g,'<')[_0x152e22(0x13e)](/&gt;/g,'>');}function safeDecode(_0x17c60a){if(!_0x17c60a)return'';try{return decodeURIComponent(_0x17c60a);}catch(_0x669afc){return _0x17c60a;}}function safeEncodeUrl(_0x4cd907){var _0x3d06f0=_0xbb3974;if(!_0x4cd907)return'';return String(_0x4cd907)['replace'](/ /g,_0x3d06f0(0x129))[_0x3d06f0(0x13e)](/\[/g,'%5B')[_0x3d06f0(0x13e)](/\]/g,_0x3d06f0(0x10e));}function stripTags(_0x14cc94){var _0x47af41=_0xbb3974;return decodeHtml((_0x14cc94||'')['replace'](/<[^>]+>/g,'\x20')[_0x47af41(0x13e)](/\s+/g,'\x20')[_0x47af41(0xfd)]());}function normalizeText(_0x47cf1e){var _0x14b1b4=_0xbb3974;return decodeHtml(_0x47cf1e||'')[_0x14b1b4(0x13b)]()['replace'](/&#8212;/g,'\x20')[_0x14b1b4(0x13e)](/[\u2019'`]/g,'')[_0x14b1b4(0x13e)](/[^a-z0-9]+/g,'\x20')[_0x14b1b4(0x13e)](/\s+/g,'\x20')['trim']();}function uniqueTokens(_0x8dd3e2){var _0x28d60a=_0xbb3974,_0x549cc9=normalizeText(_0x8dd3e2)['split']('\x20'),_0x5265fe={},_0x4d5bc7=[],_0x3f2348,_0x2861f0;for(_0x3f2348=0x0;_0x3f2348<_0x549cc9[_0x28d60a(0x123)];_0x3f2348+=0x1){_0x2861f0=_0x549cc9[_0x3f2348];if(!_0x2861f0||_0x2861f0[_0x28d60a(0x123)]<0x2||STOP_WORDS[_0x2861f0]||_0x5265fe[_0x2861f0])continue;_0x5265fe[_0x2861f0]=!![],_0x4d5bc7[_0x28d60a(0x101)](_0x2861f0);}return _0x4d5bc7;}function escapeRegex(_0x37705e){var _0xcf1e04=_0xbb3974;return String(_0x37705e||'')[_0xcf1e04(0x13e)](/[.*+?^${}()|[\]\\]/g,'\x5c$&');}function extractQuality(_0x5da079){var _0x37ba1d=_0xbb3974,_0x4b24d4=String(_0x5da079||'')[_0x37ba1d(0xf1)](/\b(2160p|1440p|1080p|720p|540p|480p|360p)\b/i);return _0x4b24d4?_0x4b24d4[0x1][_0x37ba1d(0x10f)]():'HD';}function getFirstMatch(_0x40ace4,_0x3800d8){var _0x371944=_0xbb3974,_0x22d078,_0x334c0b;for(_0x22d078=0x0;_0x22d078<_0x3800d8[_0x371944(0x123)];_0x22d078+=0x1){_0x334c0b=_0x40ace4[_0x371944(0xf1)](_0x3800d8[_0x22d078]);if(_0x334c0b&&_0x334c0b[0x1])return stripTags(_0x334c0b[0x1]);}return'';}function getTmdbInfo(_0x599b,_0x58c67f){var _0x144841=_0xbb3974,_0x534344=_0x58c67f==='movie'?_0x144841(0x12e):'tv',_0x43bfbf=TMDB_URL+'/'+_0x534344+'/'+encodeURIComponent(String(_0x599b))+'?language=en-US';return fetchText(_0x43bfbf)[_0x144841(0x133)](function(_0x478406){var _0x2b2592=_0x144841,_0x595b88=getFirstMatch(_0x478406,[/<meta property="og:title" content="([^"]+)"/i,/<title>([\s\S]*?)<\/title>/i,/"name":"([^"]+)"/i]),_0x1cb8bd=_0x478406[_0x2b2592(0xf1)](/<title>[\s\S]*?\b((?:19|20)\d{2})\b[\s\S]*?<\/title>/i)||_0x478406[_0x2b2592(0xf1)](/\b((?:19|20)\d{2})\b/);return{'title':_0x595b88[_0x2b2592(0x13e)](/\s+\(TV Series.*$/i,'')[_0x2b2592(0x13e)](/\s+\(\d{4}\).*$/i,'')[_0x2b2592(0xfd)](),'year':_0x1cb8bd?_0x1cb8bd[0x1]:''};});}function buildSearchQueries(_0x2256fe,_0x37fed6){var _0x54b7ac=_0xbb3974,_0x4d3b43=[],_0xd6d3e9=decodeHtml(_0x2256fe||'')[_0x54b7ac(0x13e)](/[:\-]/g,'\x20')[_0x54b7ac(0x13e)](/\s+/g,'\x20')['trim'](),_0x3a71b6={};function _0x3d1b79(_0x13f1e3){var _0x5080a3=_0x54b7ac,_0x4fca43=normalizeText(_0x13f1e3);if(!_0x4fca43||_0x3a71b6[_0x4fca43])return;_0x3a71b6[_0x4fca43]=!![],_0x4d3b43[_0x5080a3(0x101)](_0x13f1e3);}return _0x3d1b79(_0x2256fe),_0x3d1b79(_0xd6d3e9),_0x37fed6&&(_0x3d1b79(_0x2256fe+'\x20'+_0x37fed6),_0x3d1b79(_0xd6d3e9+'\x20'+_0x37fed6)),_0x4d3b43;}function _0x932f(){var _0x53a734=['CMvZB2X2zq','AgvHzgvYCW','mJa5odq1neD0qu1fzq','igzVCIa','mJaWmJy5nKTetfPprq','DgL0Bgu','BgfIzwW','zNjVBunOyxjdB2rL','l2fWAs9MAwXLl2rVD25Syw9KmI8','mJm1mdaWuMXHrhvj','C2XPy2u','l2rYyw1HlW','C2nVCMu','Ahr0Chm6lY9VBMX5A2rYyw1HlNnOB3a','yxbWBgLJyxrPB24VEc13D3CTzM9YBs11CMXLBMnVzgvKoYbJAgfYC2v0pvvurI04','BNvTzq','Dgv4Da','BgvUz3rO','Dg9tDhjPBMC','C2fTzs1VCMLNAw4','mZyZndC4mK9mu3nAta','BwvZC2fNzq','ANnVBG','jtiW','lZ9Zpq','Bg9N','y2fSBa','Aw5KzxG','Bw92Awu','zxHLyW','ChjVDg90ExbL','ue9tva','kd86w15blvOWltLDFcqP','DgHLBG','C29YDa','zgf0ys1UDw1L','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeZnI4WlJaUmcbtywzHCMKVntm3lJm2','l2zPBguV','y2f0y2G','C3rYAw5NAwz5','sfruuca','Dg9mB3DLCKnHC2u','DhLWzq','l3DWlwfKBwLUl2fKBwLUlwfQyxGUCgHW','CMvWBgfJzq','C3rHDhvZ','y29Uy2f0','EwvHCG','l21VDMLLCY8','rtaQ','zw1IzwrFDxjS','C291CMnL','zgf0yq','zw4TvvmSzw47Ct0WlJK','Bwf0y2G','BwfW','we1mshr0CfjLCxvLC3q','zgf0ys1WB3n0','kd86xNXBxKeTwJaTov0PuZaQ','l2fWAs9MAwXLl2rVD25Syw9KlW','mtaXmdG3mxPnrNDjzW','mJaWogXWwKTdAa','DxjS','ChvIBgLJrg93BMXHB2q','Ahr0Chm6lY9UzxC1lMzPBgvWCMvZCY53AwTP','Aw5KzxHpzG','DhjPBq','Ahr0Chm6lY9KCML2zs5NB29NBguUy29Tl3vJp2LKpq','mtC4ndnfB3zcq2q','nw1osMTtta','ChvZAa','rxbPC29KzvXZkJaQ','Aw5KzxHeB3DUBgfVza','Ahr0Chm6lY93D3CUDgHLBw92AwvKyI5VCMC','y2XVDwreB3DUBgfVza','ndC1mZy2ndbysxHQthK','y2XVDwrsmKrVD25Syw9K','ChvIBgLJvxnLCKrVD25Syw9K','DgvZDa','y29YCW','ovfPrw14vG','C2vHCMnOugfYyw1Z','AgfZt3DUuhjVCgvYDhK','jtve','Dg9vChbLCKnHC2u','AxnbCNjHEq','zg9Vx3bSyxLLCL9HAMf4'];_0x932f=function(){return _0x53a734;};return _0x932f();}function extractCandidateUrls(_0x194a70,_0x5b5dd4){var _0x1d75b2=_0xbb3974,_0x3b83b2=_0x5b5dd4===_0x1d75b2(0x12e)?_0x1d75b2(0xeb):_0x1d75b2(0x11d),_0x5da032=/href=["'](https?:\/\/onlykdrama\.shop\/[^"'#?]+)["']/gi,_0x7e1139=[],_0xb890b0={},_0x13229f;while(_0x13229f=_0x5da032['exec'](_0x194a70)){if(_0x13229f[0x1][_0x1d75b2(0xfc)](_0x3b83b2)===-0x1||_0xb890b0[_0x13229f[0x1]])continue;_0xb890b0[_0x13229f[0x1]]=!![],_0x7e1139[_0x1d75b2(0x101)](_0x13229f[0x1]);}return _0x7e1139;}function scoreCandidateUrl(_0x15a2d4,_0x13f8f3,_0x18d18a,_0x22eb4c){var _0x179eaf=_0xbb3974,_0x44d01f=_0x22eb4c===_0x179eaf(0x12e)?_0x15a2d4[_0x179eaf(0xfc)](_0x179eaf(0xeb))!==-0x1?0xa:0x0:_0x15a2d4[_0x179eaf(0xfc)]('/drama/')!==-0x1?0xa:0x0,_0x2be248=uniqueTokens(_0x13f8f3),_0x30f5d6=normalizeText(_0x15a2d4),_0x344096;for(_0x344096=0x0;_0x344096<_0x2be248[_0x179eaf(0x123)];_0x344096+=0x1){_0x30f5d6['indexOf'](_0x2be248[_0x344096])!==-0x1&&(_0x44d01f+=0xc);}return _0x18d18a&&_0x30f5d6['indexOf'](String(_0x18d18a))!==-0x1&&(_0x44d01f+=0xf),_0x44d01f;}function collectCandidatePages(_0x1175ab,_0x5a1c83,_0x5854e8,_0x29c8b8,_0x84dcae){var _0x45aacd=_0xbb3974;if(_0x29c8b8>=_0x1175ab['length'])return Promise[_0x45aacd(0x112)](rankCandidatePages(_0x84dcae,_0x5854e8,_0x5a1c83));return fetchText(SITE_URL+_0x45aacd(0x12a)+encodeURIComponent(_0x1175ab[_0x29c8b8]))[_0x45aacd(0x133)](function(_0x51a767){var _0x524b3a=_0x45aacd;return collectCandidatePages(_0x1175ab,_0x5a1c83,_0x5854e8,_0x29c8b8+0x1,_0x84dcae[_0x524b3a(0xe9)](extractCandidateUrls(_0x51a767,_0x5a1c83)));})[_0x45aacd(0x138)](function(){return collectCandidatePages(_0x1175ab,_0x5a1c83,_0x5854e8,_0x29c8b8+0x1,_0x84dcae);});}function rankCandidatePages(_0x41cb39,_0x100bc1,_0x53999a){var _0x5b290d=_0xbb3974,_0x416d16={},_0x5a7761=[],_0x182110;for(_0x182110=0x0;_0x182110<_0x41cb39[_0x5b290d(0x123)];_0x182110+=0x1){if(_0x416d16[_0x41cb39[_0x182110]])continue;_0x416d16[_0x41cb39[_0x182110]]=!![],_0x5a7761[_0x5b290d(0x101)]({'url':_0x41cb39[_0x182110],'score':scoreCandidateUrl(_0x41cb39[_0x182110],_0x100bc1[_0x5b290d(0x117)],_0x100bc1[_0x5b290d(0xea)],_0x53999a),'index':_0x182110});}return _0x5a7761[_0x5b290d(0x134)](function(_0x2b4053,_0x216d28){var _0x33f92b=_0x5b290d;if(_0x216d28['score']!==_0x2b4053[_0x33f92b(0x11e)])return _0x216d28[_0x33f92b(0x11e)]-_0x2b4053['score'];return _0x2b4053[_0x33f92b(0x12d)]-_0x216d28[_0x33f92b(0x12d)];}),_0x5a7761[_0x5b290d(0x11c)](0x0,0x8)[_0x5b290d(0xf2)](function(_0xabef99){var _0x56445c=_0x5b290d;return _0xabef99[_0x56445c(0xf9)];});}function getOnlyKDramaTitle(_0x1cf9e4){return getFirstMatch(_0x1cf9e4,[/<div class="data">\s*<h1>([\s\S]*?)<\/h1>/i,/<h1[^>]*>([\s\S]*?)<\/h1>/i,/<meta property="og:title" content="([^"]+)"/i]);}function titleLooksRelevant(_0x4f9d3f,_0x4d93f3,_0xab0497){var _0xec54b4=_0xbb3974,_0xe52cd6=uniqueTokens(_0x4f9d3f),_0x353454=uniqueTokens(_0x4d93f3),_0x357022=0x0,_0xe1d081,_0x22757e={},_0x4ea942=String(_0x4f9d3f||'')[_0xec54b4(0xf1)](/\b((?:19|20)\d{2})\b/),_0xb730ee=_0x4ea942?_0x4ea942[0x1]:'';for(_0xe1d081=0x0;_0xe1d081<_0xe52cd6['length'];_0xe1d081+=0x1){_0x22757e[_0xe52cd6[_0xe1d081]]=!![];}for(_0xe1d081=0x0;_0xe1d081<_0x353454[_0xec54b4(0x123)];_0xe1d081+=0x1){_0x22757e[_0x353454[_0xe1d081]]&&(_0x357022+=0x1);}if(_0xab0497&&_0xb730ee&&_0xb730ee!==String(_0xab0497))return![];if(_0x353454[_0xec54b4(0x123)]<=0x2)return _0x357022>=0x1;return _0x357022>=0x2;}function extractAttr(_0x167f63,_0x2de330){var _0x426db1=_0xbb3974,_0x284835=_0x167f63[_0x426db1(0xf1)](new RegExp(_0x2de330+'=[\x27\x22]([^\x27\x22]+)[\x27\x22]','i'));return _0x284835?_0x284835[0x1]:'';}function extractMovieOptions(_0x27d2d2){var _0x40f31e=_0xbb3974,_0x4cd156=/<li[^>]*class=['"][^'"]*dooplay_player_option[^'"]*['"][^>]*>[\s\S]*?<\/li>/gi,_0x3d6c27=[],_0xbae690;while(_0xbae690=_0x4cd156['exec'](_0x27d2d2)){_0x3d6c27[_0x40f31e(0x101)]({'label':stripTags(_0xbae690[0x0]),'post':extractAttr(_0xbae690[0x0],_0x40f31e(0xf4)),'type':extractAttr(_0xbae690[0x0],'data-type'),'nume':extractAttr(_0xbae690[0x0],_0x40f31e(0x135))});}return _0x3d6c27;}function extractDirectMovieUrl(_0xd3a475){var _0xe71d98=_0xbb3974;if(!_0xd3a475)return'';try{var _0x496a07=new URL(_0xd3a475),_0xc25403=_0x496a07[_0xe71d98(0x10c)]['get'](_0xe71d98(0xee));if(_0xc25403)return _0xc25403;}catch(_0x200c87){return _0xd3a475;}return _0xd3a475;}function buildStream(_0x5e1cc7,_0x58dc97,_0x2a09fe){return{'name':PROVIDER_NAME,'title':_0x5e1cc7,'url':safeEncodeUrl(_0x58dc97),'quality':_0x2a09fe||'HD'};}function resolveMoviePage(_0x35816b,_0x23fec6){var _0xb91a6e=_0xbb3974,_0x37f3f5=extractMovieOptions(_0x23fec6),_0x41199b=null,_0x158cf4;for(_0x158cf4=0x0;_0x158cf4<_0x37f3f5['length'];_0x158cf4+=0x1){if(/fast stream/i[_0xb91a6e(0x109)](_0x37f3f5[_0x158cf4][_0xb91a6e(0x118)])&&_0x37f3f5[_0x158cf4]['post']&&_0x37f3f5[_0x158cf4][_0xb91a6e(0x121)]){_0x41199b=_0x37f3f5[_0x158cf4];break;}}if(!_0x41199b)return Promise[_0xb91a6e(0x112)]([]);return fetchJson(SITE_URL+_0xb91a6e(0x13d),{'method':_0xb91a6e(0x131),'headers':{'Content-Type':_0xb91a6e(0x120),'X-Requested-With':_0xb91a6e(0xf3),'Referer':_0x35816b},'body':new URLSearchParams({'action':_0xb91a6e(0x111),'post':_0x41199b['post'],'nume':_0x41199b[_0xb91a6e(0x121)],'type':_0x41199b[_0xb91a6e(0x13c)]||'movie'})[_0xb91a6e(0x124)]()})[_0xb91a6e(0x133)](function(_0x435f10){var _0x100262=_0xb91a6e,_0x22f75c=extractDirectMovieUrl(_0x435f10&&_0x435f10[_0x100262(0xed)]);if(!_0x22f75c)return[];return[buildStream('Fast\x20Stream',_0x22f75c,extractQuality(safeDecode(_0x22f75c)))];});}function extractEpisodeAnchors(_0x3eaf3d){var _0x5b7d19=_0xbb3974,_0x14d802=/<a[^>]+href=["'](https:\/\/new5\.filepress\.wiki\/file\/([A-Za-z0-9]+))["'][^>]*>([\s\S]*?)<\/a>/gi,_0x1ae13a=[],_0x47fcaa={},_0x293ce0;while(_0x293ce0=_0x14d802[_0x5b7d19(0x12f)](_0x3eaf3d)){if(_0x47fcaa[_0x293ce0[0x2]])continue;_0x47fcaa[_0x293ce0[0x2]]=!![],_0x1ae13a['push']({'url':_0x293ce0[0x1],'fileId':_0x293ce0[0x2],'text':stripTags(_0x293ce0[0x3])});}return _0x1ae13a;}function episodeMatches(_0x1a8a51,_0x13cf5d,_0x357635,_0x33f7c3){var _0x2002d5=_0xbb3974,_0x588edb=escapeRegex(String(_0x357635)),_0x5cbaca=new RegExp(_0x2002d5(0xf5)+escapeRegex(String(_0x13cf5d))+_0x2002d5(0xec)+_0x588edb+_0x2002d5(0x132),'i'),_0x377d02=new RegExp('(?:^|[^A-Z0-9])E0*'+_0x588edb+_0x2002d5(0x132),'i'),_0x4d50c8=new RegExp(_0x2002d5(0x102)+_0x588edb+'(?:[^0-9]|$)','i');if(_0x5cbaca[_0x2002d5(0x109)](_0x1a8a51))return!![];if(_0x33f7c3)return![];if(_0x13cf5d>0x1)return![];return _0x377d02[_0x2002d5(0x109)](_0x1a8a51)||_0x4d50c8[_0x2002d5(0x109)](_0x1a8a51);}function pickEpisodeAnchor(_0x32a402,_0x524870,_0x434c96){var _0x580374=_0xbb3974,_0x478f23=_0x32a402['some'](function(_0x5b1295){var _0x16bf18=_0x147b;return/S\d{1,2}E\d{1,2}/i[_0x16bf18(0x109)](_0x5b1295[_0x16bf18(0x122)]);}),_0x31017f;for(_0x31017f=0x0;_0x31017f<_0x32a402[_0x580374(0x123)];_0x31017f+=0x1){if(episodeMatches(_0x32a402[_0x31017f][_0x580374(0x122)],_0x524870,_0x434c96,_0x478f23))return _0x32a402[_0x31017f];}return null;}function _0x147b(_0x548107,_0x25c094){_0x548107=_0x548107-0xe9;var _0x932fbe=_0x932f();var _0x147b4b=_0x932fbe[_0x548107];if(_0x147b['NHwfUV']===undefined){var _0x4aae85=function(_0x2ed5a1){var _0x3ea6d2='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x27457d='',_0x45029c='';for(var _0x1b0d01=0x0,_0x5cd293,_0x4ff150,_0x1a3cef=0x0;_0x4ff150=_0x2ed5a1['charAt'](_0x1a3cef++);~_0x4ff150&&(_0x5cd293=_0x1b0d01%0x4?_0x5cd293*0x40+_0x4ff150:_0x4ff150,_0x1b0d01++%0x4)?_0x27457d+=String['fromCharCode'](0xff&_0x5cd293>>(-0x2*_0x1b0d01&0x6)):0x0){_0x4ff150=_0x3ea6d2['indexOf'](_0x4ff150);}for(var _0x4a2aeb=0x0,_0x4acd18=_0x27457d['length'];_0x4a2aeb<_0x4acd18;_0x4a2aeb++){_0x45029c+='%'+('00'+_0x27457d['charCodeAt'](_0x4a2aeb)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x45029c);};_0x147b['sjOoCq']=_0x4aae85,_0x147b['egRVXI']={},_0x147b['NHwfUV']=!![];}var _0x3cc641=_0x932fbe[0x0],_0x3c2eec=_0x548107+_0x3cc641,_0x8926c3=_0x147b['egRVXI'][_0x3c2eec];return!_0x8926c3?(_0x147b4b=_0x147b['sjOoCq'](_0x147b4b),_0x147b['egRVXI'][_0x3c2eec]=_0x147b4b):_0x147b4b=_0x8926c3,_0x147b4b;}function filePressHeaders(_0x328989){var _0x3fc5f3=_0xbb3974;return{'Accept':'application/json,\x20text/plain,\x20*/*','Content-Type':'application/json','Origin':FILEPRESS_ORIGIN,'Referer':FILEPRESS_ORIGIN+_0x3fc5f3(0x137)+_0x328989,'Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':_0x3fc5f3(0x10a),'Sec-Fetch-Site':_0x3fc5f3(0x125)};}function extractFilePressUrl(_0x3a7e0c,_0x3d8e6d){var _0xb65030=_0xbb3974;if(_0x3d8e6d===_0xb65030(0x103)||_0x3d8e6d===_0xb65030(0x105)||_0x3d8e6d===_0xb65030(0x107))return Array[_0xb65030(0x110)](_0x3a7e0c)&&_0x3a7e0c[0x0]?_0x3a7e0c[0x0]:'';if(_0x3d8e6d===_0xb65030(0xfa)||_0x3d8e6d===_0xb65030(0x108))return _0x3a7e0c?_0xb65030(0xfe)+_0x3a7e0c:'';return'';}function resolveFilePressWithMethod(_0x4418bf,_0x2d5930,_0x128346){var _0x5a1882=_0xbb3974;if(_0x128346>=_0x2d5930[_0x5a1882(0x123)])return Promise[_0x5a1882(0x112)]('');var _0x6630f4=_0x2d5930[_0x128346],_0x4ed149=filePressHeaders(_0x4418bf);return fetchJson(FILEPRESS_ORIGIN+_0x5a1882(0xf6),{'method':_0x5a1882(0x131),'headers':_0x4ed149,'body':JSON['stringify']({'id':_0x4418bf,'method':_0x6630f4,'captchaValue':''})})[_0x5a1882(0x133)](function(_0x8d1889){var _0x29c9ae=_0x5a1882;if(!_0x8d1889||!_0x8d1889[_0x29c9ae(0x13f)]||!_0x8d1889[_0x29c9ae(0xef)])return resolveFilePressWithMethod(_0x4418bf,_0x2d5930,_0x128346+0x1);return fetchJson(FILEPRESS_ORIGIN+_0x29c9ae(0x11a),{'method':'POST','headers':_0x4ed149,'body':JSON[_0x29c9ae(0x139)]({'id':_0x8d1889[_0x29c9ae(0xef)],'method':_0x6630f4,'captchaValue':''})})['then'](function(_0xbd3e2a){var _0x4f624c=_0x29c9ae,_0x2a84f7=_0xbd3e2a&&_0xbd3e2a[_0x4f624c(0x13f)]?extractFilePressUrl(_0xbd3e2a['data'],_0x6630f4):'';if(_0x2a84f7)return _0x2a84f7;return resolveFilePressWithMethod(_0x4418bf,_0x2d5930,_0x128346+0x1);});})[_0x5a1882(0x138)](function(){return resolveFilePressWithMethod(_0x4418bf,_0x2d5930,_0x128346+0x1);});}function resolveEpisodePage(_0x586747,_0x280dbd,_0x6ffd4a){var _0xcb91ec=_0xbb3974,_0x4c04c5=pickEpisodeAnchor(extractEpisodeAnchors(_0x586747),_0x280dbd,_0x6ffd4a);if(!_0x4c04c5)return Promise[_0xcb91ec(0x112)]([]);return resolveFilePressWithMethod(_0x4c04c5['fileId'],[_0xcb91ec(0x103),_0xcb91ec(0xfa),_0xcb91ec(0x108)],0x0)[_0xcb91ec(0x133)](function(_0x2d4378){var _0x17d0fb=_0xcb91ec;if(!_0x2d4378)return[];return[buildStream(_0x4c04c5['text']||'Episode\x20'+_0x6ffd4a,_0x2d4378,extractQuality(_0x4c04c5[_0x17d0fb(0x122)]))];});}function tryCandidatePages(_0x46ac1a,_0x32887c,_0xc1fa27,_0x5312cb,_0x506609,_0x119d18){var _0x1a53ab=_0xbb3974;if(_0x32887c>=_0x46ac1a[_0x1a53ab(0x123)])return Promise[_0x1a53ab(0x112)]([]);return fetchText(_0x46ac1a[_0x32887c])[_0x1a53ab(0x133)](function(_0x3c375d){var _0x156f0a=_0x1a53ab,_0x2fb4ca=getOnlyKDramaTitle(_0x3c375d);if(!titleLooksRelevant(_0x2fb4ca,_0x5312cb[_0x156f0a(0x117)],_0x5312cb[_0x156f0a(0xea)]))return tryCandidatePages(_0x46ac1a,_0x32887c+0x1,_0xc1fa27,_0x5312cb,_0x506609,_0x119d18);return(_0xc1fa27===_0x156f0a(0x12e)?resolveMoviePage(_0x46ac1a[_0x32887c],_0x3c375d):resolveEpisodePage(_0x3c375d,_0x506609,_0x119d18))['then'](function(_0x492942){var _0x4ade33=_0x156f0a;if(_0x492942&&_0x492942[_0x4ade33(0x123)])return _0x492942;return tryCandidatePages(_0x46ac1a,_0x32887c+0x1,_0xc1fa27,_0x5312cb,_0x506609,_0x119d18);})['catch'](function(){return tryCandidatePages(_0x46ac1a,_0x32887c+0x1,_0xc1fa27,_0x5312cb,_0x506609,_0x119d18);});})['catch'](function(){return tryCandidatePages(_0x46ac1a,_0x32887c+0x1,_0xc1fa27,_0x5312cb,_0x506609,_0x119d18);});}function getStreams(_0x164a51,_0x361684,_0x4384f9,_0x40d098){var _0x1d01f9=_0xbb3974,_0x362d08=_0x361684===_0x1d01f9(0x12e)?_0x1d01f9(0x12e):'tv',_0x83e84d=Number(_0x4384f9)||0x1,_0x3123bb=Number(_0x40d098)||0x1;return getTmdbInfo(_0x164a51,_0x362d08)[_0x1d01f9(0x133)](function(_0x5b1747){var _0x1354cb=_0x1d01f9;if(!_0x5b1747||!_0x5b1747['title'])return[];return collectCandidatePages(buildSearchQueries(_0x5b1747[_0x1354cb(0x117)],_0x5b1747[_0x1354cb(0xea)]),_0x362d08,_0x5b1747,0x0,[])[_0x1354cb(0x133)](function(_0x30862c){return tryCandidatePages(_0x30862c,0x0,_0x362d08,_0x5b1747,_0x83e84d,_0x3123bb);});})[_0x1d01f9(0x138)](function(_0x56cd9a){var _0x452f58=_0x1d01f9;return console[_0x452f58(0x12b)]('['+PROVIDER_NAME+']\x20'+_0x56cd9a[_0x452f58(0x127)]),[];});}module['exports']={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "onlykdrama", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🫰 OnlyKDrama", "onlykdrama");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
