// Imported provider: purstream; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
    if (!match || method !== "GET" || /[?&]language=fr-FR(?:&|$)/i.test(text)) return nativeFetch(url, options);
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
function _0x506c(){var _0x3aa6ed=['AxrLBxm','l3nLyxjJAc1IyxiVC2vHCMnOlW','jMXHBMD1ywDLpwvUlvvt','ntm0mJmWowvqA3LqCG','ihWG8j+xO++4JYa','l2fWAs92mq','Bw92AwvZ','mJaZmda5odbPEe1wzxq','C291CMnLx25HBwu','nZiW','EwvHCG','odG0mdrMshPpAuS','DxjSCW','rhvHBc1bDwrPBW','DgL0Bgu','mJmXntC0neXfCe1NAW','ndGYmdzRvgDfvgC','otK4mJK1Dejvq3D0','Dg9vChbLCKnHC2u','ChvYC3rYzwfT','B3jPz2LUywXFDgL0Bgu','y2X1yG','nKnKywXqtq','Btn1oa','m2TArLPACq','B3jPzW','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','C3bSAxq','tvvmveK','l3nLyxnVBI8','CMvMzxjLCG','Ahr0Chm6lY9HCgKUChvYC3rYzwfTlG','Bw92Awu','ic0G','zMLYC3rFywLYx2rHDgu','C291CMnLCW','mta4mha','ANnVBG','Dg9mB3DLCKnHC2u','CMvSzwfZzv9KyxrL','rfvbta','wdi2nq','DxjS','iokaOIa','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','zgf0yq','zM9YBwf0','zxHWB3j0CW','zhvYyxrPB24','uhvYC3rYzwfTihWG','vK9tva','BMfTzq','nZiWCa','8j+hQ/cFH7C','vK9tvezs','ttnvoa','DgHLBG','sc4YnJu','zxbPC29Kzv9YDw5FDgLTzq','Bwf0y2G','ihWG','BgvUz3rO','ywjZ','nZjXCg1srMC','l2vWAxnVzguV','mteXndi5u1vrDNHt','sc4YnJq','CMvWBgfJzq','Aw5KzxHpzG','z2v0u3rYzwfTCW','l21LzgLHlW','p2fWAv9RzxK9','CNvUDgLTzq','l3nOzwv0','y2f0y2G','l3n0CMvHBs8'];_0x506c=function(){return _0x3aa6ed;};return _0x506c();}var _0x580258=_0x1911;(function(_0x38a1c2,_0x17aa85){var _0x51a50e={_0x56420f:0x22a,_0x2a43bc:0x22e,_0x4d4e63:0x230,_0x31df36:0x222,_0x1785d0:0x212,_0x5c1eac:0x226},_0x1dc573=_0x1911,_0x1bffda=_0x38a1c2();while(!![]){try{var _0x1b9042=-parseInt(_0x1dc573(0x1eb))/0x1*(-parseInt(_0x1dc573(0x22f))/0x2)+-parseInt(_0x1dc573(_0x51a50e._0x56420f))/0x3+-parseInt(_0x1dc573(_0x51a50e._0x2a43bc))/0x4+-parseInt(_0x1dc573(_0x51a50e._0x4d4e63))/0x5+parseInt(_0x1dc573(0x235))/0x6*(-parseInt(_0x1dc573(_0x51a50e._0x31df36))/0x7)+parseInt(_0x1dc573(_0x51a50e._0x1785d0))/0x8*(-parseInt(_0x1dc573(0x214))/0x9)+parseInt(_0x1dc573(_0x51a50e._0x5c1eac))/0xa;if(_0x1b9042===_0x17aa85)break;else _0x1bffda['push'](_0x1bffda['shift']());}catch(_0x3ce656){_0x1bffda['push'](_0x1bffda['shift']());}}}(_0x506c,0x66790));var DOMAINS_URL='https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json',PURSTREAM_FALLBACK=_0x580258(0x234),PURSTREAM_API='https://api.purstream.'+PURSTREAM_FALLBACK+_0x580258(0x224),PURSTREAM_REFERER='https://purstream.'+PURSTREAM_FALLBACK+'/',PURSTREAM_UA='Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/120.0.0.0\x20Safari/537.36',TMDB_KEY='f3d757824f08ea2cff45eb8f47ca3a1e',_cachedEndpoint=null;function getTmdbDetails(_0x2f23a7,_0x21f96b){var _0x51a677={_0x304943:0x1f3,_0x2c882c:0x21a,_0x13bce8:0x221},_0x511197={_0x43fc6a:0x206,_0x706d36:0x21b},_0x2d3d5f={_0x2046ce:0x1f8},_0x117f97=_0x580258,_0x2f14da='https://api.themoviedb.org/3/'+(_0x21f96b==='tv'?'tv':_0x117f97(_0x51a677._0x304943))+'/'+_0x2f23a7+_0x117f97(_0x51a677._0x2c882c)+TMDB_KEY+_0x117f97(_0x51a677._0x13bce8);return fetch(_0x2f14da)['then'](function(_0x4c9287){var _0x2c9698=_0x117f97;return _0x4c9287[_0x2c9698(_0x2d3d5f._0x2046ce)]();})['then'](function(_0x273189){var _0x48ac8a=_0x117f97,_0x2c562c=_0x273189[_0x48ac8a(0x1fa)]||_0x273189['first_air_date']||'';return{'enName':_0x273189['title']||_0x273189[_0x48ac8a(_0x511197._0x43fc6a)]||'Purstream','year':_0x2c562c?_0x2c562c[_0x48ac8a(0x1ee)]('-')[0x0]:'','duration':_0x21f96b==='movie'&&_0x273189[_0x48ac8a(_0x511197._0x706d36)]?_0x273189[_0x48ac8a(_0x511197._0x706d36)]+'\x20min':_0x21f96b==='tv'&&_0x273189[_0x48ac8a(0x20d)]&&_0x273189[_0x48ac8a(0x20d)][_0x48ac8a(0x210)]>0x0?_0x273189['episode_run_time'][0x0]+'\x20min':''};})[_0x117f97(0x21d)](function(){return{'enName':'Purstream','year':'','duration':''};});}function getEpisodeInfo(_0x525c63,_0x3fa140,_0x45d76b){var _0x458986={_0x4ccced:0x213,_0x13d35c:0x20b},_0x2e20d5={_0x102ad0:0x206},_0x41680b=_0x580258;if(!_0x525c63||!_0x3fa140||!_0x45d76b)return Promise['resolve'](null);var _0x31e309=_0x41680b(0x1ed)+_0x525c63+_0x41680b(0x1f0)+_0x3fa140+_0x41680b(_0x458986._0x4ccced)+_0x45d76b+'?api_key='+TMDB_KEY+'&language=en-US';return fetch(_0x31e309)['then'](function(_0x4507ae){var _0x5d4da4=_0x41680b;return _0x4507ae[_0x5d4da4(0x1f8)]();})[_0x41680b(_0x458986._0x13d35c)](function(_0x4fc03a){var _0x22c940=_0x41680b;return{'name':_0x4fc03a[_0x22c940(_0x2e20d5._0x102ad0)]||null,'duration':_0x4fc03a['runtime']?_0x4fc03a['runtime']+'\x20min':null};})[_0x41680b(0x21d)](function(){return null;});}function buildPurstreamTitle(_0x24c2f6,_0x310b87,_0x2a3025,_0x3c8c25,_0x159a42,_0x480a76,_0x3e322a,_0x45fd1d){var _0x4f39b4={_0x18495a:0x208,_0x2c7450:0x231,_0x15d8dd:0x1fb,_0x5c503c:0x229,_0xcb2aa9:0x20a,_0x354e3a:0x231,_0x3b9acf:0x215,_0x470736:0x217,_0x4b0b3a:0x20c,_0x24c330:0x203,_0x4a70af:0x20f,_0xa79864:0x1fe},_0xdadf3c=_0x580258,_0x33741f=_0x310b87['toLowerCase']()['replace'](/p/g,'')+'p',_0x201113='🔥',_0x31c5b6='VF',_0x4ca89f=_0xdadf3c(_0x4f39b4._0x18495a),_0x13dd2c=(String(_0x45fd1d)+'\x20'+String(_0x2a3025))[_0xdadf3c(_0x4f39b4._0x2c7450)]();if(_0x13dd2c[_0xdadf3c(0x217)](_0xdadf3c(0x1ef))!==-0x1||_0x13dd2c['indexOf'](_0xdadf3c(_0x4f39b4._0x15d8dd))!==-0x1)_0x31c5b6='Dual-Audio',_0x4ca89f='🇺🇸\x20•\x20🇫🇷';else _0x13dd2c['indexOf'](_0xdadf3c(0x205))!==-0x1&&(_0x31c5b6='VOSTFR',_0x4ca89f='🇺🇸\x20•\x20🇫🇷');var _0x4b9c9f='🎬\x20';_0x159a42&&_0x480a76?_0x4b9c9f+='S'+_0x159a42+'\x20E'+_0x480a76+(_0x3e322a&&_0x3e322a[_0xdadf3c(0x206)]?_0xdadf3c(0x1f4)+_0x3e322a['name']:'')+'\x20|\x20'+_0x24c2f6['enName']:_0x4b9c9f+=_0x24c2f6['enName']+(_0x24c2f6[_0xdadf3c(_0x4f39b4._0x5c503c)]?'\x20-\x20'+_0x24c2f6['year']:'');var _0x555470=_0x201113+'\x20'+_0x33741f+'\x20|\x20🔊\x20'+_0x31c5b6+_0xdadf3c(0x223)+_0x4ca89f,_0x176d23=(_0x3c8c25||_0xdadf3c(_0x4f39b4._0xcb2aa9))[_0xdadf3c(_0x4f39b4._0x354e3a)](),_0x41647d=_0xdadf3c(_0x4f39b4._0x3b9acf);(_0x13dd2c['indexOf']('HEVC')!==-0x1||_0x13dd2c['indexOf'](_0xdadf3c(0x1fc))!==-0x1||_0x13dd2c[_0xdadf3c(_0x4f39b4._0x470736)]('H265')!==-0x1)&&(_0x41647d=_0xdadf3c(_0x4f39b4._0x4b0b3a));var _0x3109f5=_0x3e322a&&_0x3e322a[_0xdadf3c(0x203)]?_0x3e322a[_0xdadf3c(_0x4f39b4._0x24c330)]:_0x24c2f6[_0xdadf3c(_0x4f39b4._0x24c330)],_0x446916=_0x3109f5?_0xdadf3c(_0x4f39b4._0x4a70af)+_0x3109f5:'',_0x2ba5be='🎯\x20'+_0x176d23+_0xdadf3c(_0x4f39b4._0xa79864)+_0x41647d+'\x20|\x20🎧\x20AAC'+_0x446916;return _0x4b9c9f+'\x0a'+_0x555470+'\x0a'+_0x2ba5be;}function detectPurstreamDomain(){var _0x27cee8={_0x2cecd8:0x20b,_0x278a89:0x21d},_0x3a49ed={_0x53d990:0x232,_0x35f2c1:0x1f2,_0x132ccc:0x224},_0x37cf5b=_0x580258;if(_cachedEndpoint)return Promise['resolve'](_cachedEndpoint);return fetch(DOMAINS_URL)['then'](function(_0x4b1733){if(!_0x4b1733['ok'])throw new Error();return _0x4b1733['json']();})[_0x37cf5b(_0x27cee8._0x2cecd8)](function(_0x464d75){var _0x354ff4=_0x37cf5b,_0x18f47a=_0x464d75[_0x354ff4(_0x3a49ed._0x53d990)]||PURSTREAM_FALLBACK;return _cachedEndpoint={'api':_0x354ff4(_0x3a49ed._0x35f2c1)+_0x18f47a+_0x354ff4(_0x3a49ed._0x132ccc),'referer':'https://purstream.'+_0x18f47a+'/'},_cachedEndpoint;})[_0x37cf5b(_0x27cee8._0x278a89)](function(){return{'api':'https://api.purstream.'+PURSTREAM_FALLBACK+'/api/v1','referer':'https://purstream.'+PURSTREAM_FALLBACK+'/'};});}function applyPurstreamDomain(_0x5d8c19){var _0x4e111c={_0x320bdd:0x1f1},_0x4b4f98=_0x580258;PURSTREAM_API=_0x5d8c19['api'],PURSTREAM_REFERER=_0x5d8c19[_0x4b4f98(_0x4e111c._0x320bdd)];}function cleanTitle(title) {
  var value = String(title || '').toLowerCase();
  if (typeof value.normalize === 'function') value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Keep non-Latin titles: Korean aliases must never collapse to an empty key.
  return value.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function extractYear(_0x43b6be){var _0x171acd={_0x393eef:0x20e},_0x11dca0=_0x580258;if(!_0x43b6be)return null;var _0x3d72f1=String(_0x43b6be)[_0x11dca0(_0x171acd._0x393eef)](/(\d{4})/);return _0x3d72f1?parseInt(_0x3d72f1[0x1],0xa):null;}function getTmdbSearchMeta(id, type) {
  var base = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + id;
  function details(language) {
    return fetch(base + '?api_key=' + TMDB_KEY + '&language=' + language + '&append_to_response=alternative_titles').then(function(response) {
      if (response.ok === false) throw new Error('TMDB HTTP ' + response.status);
      return response.json();
    });
  }
  return Promise.all([details('en-US'), details('fr-FR').catch(function() { return null; })]).then(function(values) {
    var primary = values[0], french = values[1] || {}, aliases = [];
    function add(title) {
      title = String(title || '').trim();
      if (cleanTitle(title) && aliases.indexOf(title) === -1) aliases.push(title);
    }
    add(french.title || french.name);
    add(primary.title || primary.name);
    add(primary.original_title || primary.original_name);
    [primary, french].forEach(function(meta) {
      var alternatives = meta.alternative_titles || {};
      (alternatives.titles || alternatives.results || []).forEach(function(item) { add(item.title); });
    });
    return { fr: french.title || french.name, orig: primary.original_title || primary.original_name,
      year: extractYear(primary.release_date || primary.first_air_date), aliases: aliases, tmdbId: String(id) };
  });
}
function findPurstreamIdByTitle(title, type, year, meta) {
  meta = meta || {};
  var queries = [], seen = Object.create(null);
  [title].concat(meta.aliases || []).forEach(function(value) {
    var key = cleanTitle(value);
    if (key && !seen[key]) { seen[key] = true; queries.push(String(value)); }
  });
  queries = queries.slice(0, 6);
  var acceptedTitles = Object.keys(seen);
  function candidates(body) {
    var groups = body && body.data && body.data.items || {}, result = [];
    ['movies', 'series', 'tv'].forEach(function(key) {
      var group = groups[key];
      var items = Array.isArray(group) ? group : group && group.items;
      if (Array.isArray(items)) result = result.concat(items);
    });
    return result;
  }
  function select(items) {
    var matches = [], ids = Object.create(null);
    items.forEach(function(item) {
      if (!item || item.id == null || !String(item.id).trim()) return;
      var candidateType = String(item.media_type || item.type || '').toLowerCase();
      if ((candidateType === 'movie' && type !== 'movie') ||
          (['tv', 'series', 'show'].indexOf(candidateType) !== -1 && type !== 'tv')) return;
      var mappedId = item.tmdb_id != null ? item.tmdb_id : item.tmdbId;
      if (mappedId != null && meta.tmdbId && String(mappedId) !== meta.tmdbId) return;
      var byId = mappedId != null && meta.tmdbId && String(mappedId) === meta.tmdbId;
      var titles = [item.title, item.name, item.original_title, item.original_name];
      var byTitle = titles.some(function(value) { var key = cleanTitle(value); return key && acceptedTitles.indexOf(key) !== -1; });
      if (!byId && !byTitle) return;
      var candidateYear = extractYear(item.release_date || item.first_air_date || item.year);
      // A title alone cannot distinguish remakes when the release year is missing.
      if (!byId && year && (!candidateYear || Math.abs(year - candidateYear) > 1)) return;
      var key = String(item.id), rank = byId ? -1 : year && candidateYear ? Math.abs(year - candidateYear) : 0;
      if (!ids[key]) { ids[key] = true; matches.push({ id: item.id, rank: rank }); }
    });
    matches.sort(function(a, b) { return a.rank - b.rank; });
    if (!matches.length || matches.length > 1 && matches[0].rank === matches[1].rank) return null;
    return matches[0].id;
  }
  function search(index) {
    if (index >= queries.length) throw new Error('Purstream: no verified title/year match');
    return fetch(PURSTREAM_API + '/search-bar/search/' + encodeURIComponent(queries[index]), {
      headers: { 'User-Agent': PURSTREAM_UA, Referer: PURSTREAM_REFERER }
    }).then(function(response) {
      if (response.ok === false) throw new Error('Purstream search HTTP ' + response.status);
      return response.json();
    }).then(function(body) {
      var id = select(candidates(body));
      return id != null ? id : search(index + 1);
    });
  }
  return Promise.resolve().then(function() { return search(0); });
}
function fetchMovieSources(_0x49430b){var _0x4c2d0b={_0x50c9e8:0x219,_0x531ce5:0x21c},_0x554abb={_0xd3fcd6:0x1f8},_0x8dafd7=_0x580258;return fetch(PURSTREAM_API+_0x8dafd7(_0x4c2d0b._0x50c9e8)+_0x49430b+_0x8dafd7(_0x4c2d0b._0x531ce5),{'headers':{'User-Agent':PURSTREAM_UA,'Referer':PURSTREAM_REFERER}})[_0x8dafd7(0x20b)](function(_0x46650d){var _0xdaec5b=_0x8dafd7;return _0x46650d[_0xdaec5b(_0x554abb._0xd3fcd6)]();})['then'](function(_0x245ec2){var _0x244c94=_0x8dafd7;return _0x245ec2['data']['items'][_0x244c94(0x22b)]||[];});}function fetchEpisodeSources(_0x259bef,_0x1b9d37,_0x2dd536){var _0x32d93e={_0x4d7262:0x21e,_0x21445a:0x20b},_0x751dc3={_0x363a56:0x1f8},_0x12b369=_0x580258;return fetch(PURSTREAM_API+_0x12b369(_0x32d93e._0x4d7262)+_0x259bef+'/episode?season='+(_0x1b9d37||0x1)+'&episode='+(_0x2dd536||0x1),{'headers':{'User-Agent':PURSTREAM_UA,'Referer':PURSTREAM_REFERER}})[_0x12b369(_0x32d93e._0x21445a)](function(_0x4b363d){var _0x3e2e7a=_0x12b369;return _0x4b363d[_0x3e2e7a(_0x751dc3._0x363a56)]();})['then'](function(_0x57ed4f){var _0x366a6f=_0x12b369;return _0x57ed4f[_0x366a6f(0x200)]['items'][_0x366a6f(0x1f6)]||[];});}function parseLang(_0x1b1bbc){var _0x12fd0c={_0x288936:0x231,_0x404031:0x217,_0x4a566e:0x209},_0x32fbcc=_0x580258,_0x58076f=(_0x1b1bbc||'')[_0x32fbcc(_0x12fd0c._0x288936)]();if(_0x58076f[_0x32fbcc(_0x12fd0c._0x404031)]('VOSTFR')!==-0x1)return _0x32fbcc(_0x12fd0c._0x4a566e);if(_0x58076f[_0x32fbcc(_0x12fd0c._0x404031)]('VF')!==-0x1)return'VF';return _0x32fbcc(0x22c);}function parseQuality(_0x11d4c6){var _0x1c4e1e={_0x4dce8f:0x217,_0x4aa00c:0x228,_0x360d99:0x207},_0x2718b2=_0x580258,_0x364254=(_0x11d4c6||'')[_0x2718b2(0x231)]();if(_0x364254[_0x2718b2(_0x1c4e1e._0x4dce8f)]('4K')!==-0x1)return'4K';if(_0x364254[_0x2718b2(0x217)]('1080')!==-0x1)return _0x2718b2(0x1f7);if(_0x364254[_0x2718b2(0x217)](_0x2718b2(_0x1c4e1e._0x4aa00c))!==-0x1)return _0x2718b2(_0x1c4e1e._0x360d99);return'HD';}function normalizeMovieSources(_0x29ba99,_0x22ed47){var _0x175a0e={_0x25f6be:0x236},_0x86ce77={_0x3c58b8:0x20e};return _0x29ba99['filter'](function(_0x4fc8fa){var _0x4b0294=_0x1911;return _0x4fc8fa[_0x4b0294(0x1fd)]&&(_0x4fc8fa['url']['match'](/\.m3u8/i)||_0x4fc8fa['url'][_0x4b0294(_0x86ce77._0x3c58b8)](/\.mp4/i));})['map'](function(_0x1e197e){var _0x269d05=_0x1911,_0x56fac8=parseQuality(_0x1e197e['name']),_0x168dce=_0x1e197e['url']['match'](/\.mp4/i)?'mp4':_0x269d05(_0x175a0e._0x25f6be),_0x53c8d3=parseLang(_0x1e197e['name']),_0x217d9a=buildPurstreamTitle(_0x22ed47,_0x56fac8,_0x53c8d3,_0x168dce,null,null,null,_0x1e197e['name']);return{'name':'Purstream\x20|\x20'+_0x56fac8['toLowerCase']()+_0x269d05(0x20f)+_0x53c8d3,'title':_0x217d9a,'size':_0x217d9a,'description':_0x217d9a,'url':_0x1e197e[_0x269d05(0x1fd)],'quality':'','language':'','format':_0x168dce,'headers':{'User-Agent':PURSTREAM_UA,'Referer':PURSTREAM_REFERER}};});}function _0x1911(_0x5d112d,_0x4880d7){_0x5d112d=_0x5d112d-0x1eb;var _0x506c76=_0x506c();var _0x191140=_0x506c76[_0x5d112d];if(_0x1911['WKkMLS']===undefined){var _0x2654f8=function(_0x412246){var _0x31a8f7='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x2f23a7='',_0x21f96b='';for(var _0x2f14da=0x0,_0x4c9287,_0x273189,_0x2c562c=0x0;_0x273189=_0x412246['charAt'](_0x2c562c++);~_0x273189&&(_0x4c9287=_0x2f14da%0x4?_0x4c9287*0x40+_0x273189:_0x273189,_0x2f14da++%0x4)?_0x2f23a7+=String['fromCharCode'](0xff&_0x4c9287>>(-0x2*_0x2f14da&0x6)):0x0){_0x273189=_0x31a8f7['indexOf'](_0x273189);}for(var _0x525c63=0x0,_0x3fa140=_0x2f23a7['length'];_0x525c63<_0x3fa140;_0x525c63++){_0x21f96b+='%'+('00'+_0x2f23a7['charCodeAt'](_0x525c63)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x21f96b);};_0x1911['DEJoAK']=_0x2654f8,_0x1911['PhDUJk']={},_0x1911['WKkMLS']=!![];}var _0x129e7d=_0x506c76[0x0],_0x3a8f72=_0x5d112d+_0x129e7d,_0xd390b7=_0x1911['PhDUJk'][_0x3a8f72];return!_0xd390b7?(_0x191140=_0x1911['DEJoAK'](_0x191140),_0x1911['PhDUJk'][_0x3a8f72]=_0x191140):_0x191140=_0xd390b7,_0x191140;}function normalizeEpisodeSources(_0x3ffa77,_0x296e79,_0x46ea42,_0x42f2bb,_0x38e282){var _0x464bdd={_0x5a3d3d:0x201,_0x4513e4:0x204};return _0x3ffa77['map'](function(_0x533f4c){var _0x5f38de=_0x1911,_0xcb09c0=parseQuality(_0x533f4c[_0x5f38de(0x227)]),_0x40dc85=_0x533f4c[_0x5f38de(_0x464bdd._0x5a3d3d)]||'m3u8',_0xa6c753=parseLang(_0x533f4c[_0x5f38de(0x227)]),_0x2f09cb=buildPurstreamTitle(_0x296e79,_0xcb09c0,_0xa6c753,_0x40dc85,_0x46ea42,_0x42f2bb,_0x38e282,_0x533f4c['source_name']);return{'name':_0x5f38de(_0x464bdd._0x4513e4)+_0xcb09c0[_0x5f38de(0x1f9)]()+'\x20|\x20'+_0xa6c753,'title':_0x2f09cb,'size':_0x2f09cb,'description':_0x2f09cb,'url':_0x533f4c['stream_url'],'quality':'','language':'','format':_0x40dc85,'headers':{'User-Agent':PURSTREAM_UA,'Referer':PURSTREAM_REFERER}};});}function getStreams(_0x4baaaa,_0x126066,_0x539bb1,_0x523727){var _0x145974={_0xe84e73:0x1ec},_0x14929b=_0x580258;return Promise['all']([getTmdbDetails(_0x4baaaa,_0x126066),_0x126066==='tv'?getEpisodeInfo(_0x4baaaa,_0x539bb1,_0x523727):Promise['resolve'](null),detectPurstreamDomain(),getTmdbSearchMeta(_0x4baaaa,_0x126066)])[_0x14929b(0x20b)](function(_0x765f04){var _0x3b4f6b={_0x983d65:0x20b},_0x4caf4e=_0x14929b,_0x558699=_0x765f04[0x0],_0x3f90af=_0x765f04[0x1],_0x455d6e=_0x765f04[0x2],_0x400448=_0x765f04[0x3];return applyPurstreamDomain(_0x455d6e),findPurstreamIdByTitle(_0x400448['fr'],_0x126066,_0x400448['year'],_0x400448)['then'](function(_0x2cac7b){var _0x2c0ec2=_0x4caf4e;return _0x126066==='tv'?fetchEpisodeSources(_0x2cac7b,_0x539bb1,_0x523727)[_0x2c0ec2(_0x3b4f6b._0x983d65)](function(_0x5cea48){return normalizeEpisodeSources(_0x5cea48,_0x558699,_0x539bb1,_0x523727,_0x3f90af);}):fetchMovieSources(_0x2cac7b)['then'](function(_0x5023fe){return normalizeMovieSources(_0x5023fe,_0x558699);});});})['catch'](function(){return[];});}typeof module!=='undefined'&&module[_0x580258(0x202)]?module[_0x580258(0x202)]={'getStreams':getStreams}:global[_0x580258(0x218)]=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "purstream", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Purstream", "purstream");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
