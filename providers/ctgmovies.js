// Imported provider: ctgmovies; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x52e89e=_0x4700;function _0x4700(_0x1f1acd,_0x4c5b78){_0x1f1acd=_0x1f1acd-0x174;const _0x43ffc6=_0x43ff();let _0x470027=_0x43ffc6[_0x1f1acd];if(_0x4700['syJmqm']===undefined){var _0x3248de=function(_0x15f01d){const _0x2ba528='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x306cc0='',_0x204961='';for(let _0x16208c=0x0,_0x196df4,_0x89087b,_0x2172aa=0x0;_0x89087b=_0x15f01d['charAt'](_0x2172aa++);~_0x89087b&&(_0x196df4=_0x16208c%0x4?_0x196df4*0x40+_0x89087b:_0x89087b,_0x16208c++%0x4)?_0x306cc0+=String['fromCharCode'](0xff&_0x196df4>>(-0x2*_0x16208c&0x6)):0x0){_0x89087b=_0x2ba528['indexOf'](_0x89087b);}for(let _0x4307dd=0x0,_0x458f7a=_0x306cc0['length'];_0x4307dd<_0x458f7a;_0x4307dd++){_0x204961+='%'+('00'+_0x306cc0['charCodeAt'](_0x4307dd)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x204961);};_0x4700['uFFspE']=_0x3248de,_0x4700['tylWwC']={},_0x4700['syJmqm']=!![];}const _0x35dd9a=_0x43ffc6[0x0],_0x280b9e=_0x1f1acd+_0x35dd9a,_0x4a490c=_0x4700['tylWwC'][_0x280b9e];return!_0x4a490c?(_0x470027=_0x4700['uFFspE'](_0x470027),_0x4700['tylWwC'][_0x280b9e]=_0x470027):_0x470027=_0x4a490c,_0x470027;}(function(_0x43812c,_0x54aa47){const _0x48a30b={_0x39f26c:0x1ec,_0x48fc37:0x1c7,_0x1295fe:0x1e5,_0x332f95:0x1e3,_0xff705e:0x18a,_0x47bbaa:0x1f1},_0x596a1e=_0x4700,_0x417e7c=_0x43812c();while(!![]){try{const _0x404066=parseInt(_0x596a1e(_0x48a30b._0x39f26c))/0x1+parseInt(_0x596a1e(_0x48a30b._0x48fc37))/0x2*(parseInt(_0x596a1e(0x1df))/0x3)+-parseInt(_0x596a1e(0x17c))/0x4*(-parseInt(_0x596a1e(0x18f))/0x5)+-parseInt(_0x596a1e(0x1b8))/0x6*(parseInt(_0x596a1e(_0x48a30b._0x1295fe))/0x7)+-parseInt(_0x596a1e(0x1cd))/0x8*(parseInt(_0x596a1e(_0x48a30b._0x332f95))/0x9)+parseInt(_0x596a1e(_0x48a30b._0xff705e))/0xa+-parseInt(_0x596a1e(_0x48a30b._0x47bbaa))/0xb;if(_0x404066===_0x54aa47)break;else _0x417e7c['push'](_0x417e7c['shift']());}catch(_0x4fac07){_0x417e7c['push'](_0x417e7c['shift']());}}}(_0x43ff,0xc836b));var TMDB_API_KEY=_0x52e89e(0x1ba),TMDB_BASE_URL=_0x52e89e(0x1cb),MAIN_URL='https://ctgmovies.com',DEFAULT_API_BASE='https://cockpit.103.109.92.178.nip.io/api/v1',UA='Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/125.0.0.0\x20Safari/537.36',AUTH_CONFIG={'token':'','cookie':''},WEB_HEADERS={'User-Agent':UA,'Accept':'application/json','Accept-Language':'en','Referer':MAIN_URL+'/','Origin':MAIN_URL},STREAM_HEADERS={'User-Agent':UA,'Accept':_0x52e89e(0x1b5),'Accept-Language':'en-US,en;q=0.9','Accept-Encoding':_0x52e89e(0x1bc),'Referer':MAIN_URL+'/','Sec-Fetch-Dest':'video','Sec-Fetch-Mode':_0x52e89e(0x1a7),'Sec-Fetch-Site':'cross-site','DNT':'1'};function encodeUrl(_0x306cc0){return encodeURIComponent(_0x306cc0||'');}function yearFromDate(_0x204961){const _0x257174=_0x52e89e;if(!_0x204961)return null;const _0x16208c=_0x204961[_0x257174(0x1d5)](/\d{4}/);return _0x16208c?parseInt(_0x16208c[0x0],0xa):null;}function cleanDisplayTitle(_0x196df4){const _0x59ced6={_0x55487b:0x1dc},_0x58d98f=_0x52e89e;if(!_0x196df4)return'';return _0x196df4[_0x58d98f(0x1dc)](/\b(1080p|720p|480p|2160p|4k|web[- ]?dl|webrip|bluray|hdrip|x264|x265|hevc|10bit|dual[- ]?audio|hindi[- ]?dubbed|dubbed|esub)\b/gi,'\x20')[_0x58d98f(_0x59ced6._0x55487b)](/\[[^\]]*\]/g,'\x20')['replace'](/\s+/g,'\x20')[_0x58d98f(0x1bd)]();}function normalizedTitle(_0x89087b){return cleanDisplayTitle(_0x89087b)['toLowerCase']()['replace'](/[^a-z0-9]+/g,'\x20')['trim']();}function optString(_0x2172aa,_0x4307dd){const _0xeb97fa={_0x435e1f:0x1e8},_0x364cb8=_0x52e89e;if(!_0x2172aa||_0x2172aa[_0x4307dd]==null)return null;let _0x458f7a=_0x2172aa[_0x4307dd];if(typeof _0x458f7a!==_0x364cb8(0x1e4))_0x458f7a=String(_0x458f7a);_0x458f7a=_0x458f7a['trim']();if(!_0x458f7a||_0x458f7a===_0x364cb8(_0xeb97fa._0x435e1f))return null;return _0x458f7a;}function optInt(_0x3152bb,_0x529129){if(!_0x3152bb||_0x3152bb[_0x529129]==null)return null;const _0x47b0c3=_0x3152bb[_0x529129];if(typeof _0x47b0c3==='number')return _0x47b0c3;const _0x1e1728=parseInt(String(_0x47b0c3),0xa);return isNaN(_0x1e1728)?null:_0x1e1728;}function resolveMediaUrl(_0x32103e){const _0x525a61={_0x43308a:0x1e0},_0x21cd6b=_0x52e89e;if(!_0x32103e)return'';if(_0x32103e['startsWith']('//'))return'https:'+_0x32103e;if(/^https?:\/\//i[_0x21cd6b(_0x525a61._0x43308a)](_0x32103e))return _0x32103e;if(_0x32103e[_0x21cd6b(0x187)]('/'))return MAIN_URL+_0x32103e;return _0x32103e;}function resolveSubtitleUrl(_0x206272){const _0x5cb94f={_0x164607:0x187,_0x1231b8:0x1d2},_0x15dd6b=_0x52e89e;if(!_0x206272)return'';if(_0x206272[_0x15dd6b(_0x5cb94f._0x164607)]('//'))return _0x15dd6b(_0x5cb94f._0x1231b8)+_0x206272;if(/^https?:\/\//i['test'](_0x206272))return _0x206272;if(_0x206272['startsWith']('/'))return MAIN_URL+_0x206272;return MAIN_URL+'/'+_0x206272;}function qualityFromUrl(_0x1ddb03){const _0x2392bf={_0x258bed:0x17d,_0x51c1a2:0x1b3,_0x2f8ca0:0x1b9},_0x3fe055=_0x52e89e;if(!_0x1ddb03)return'Unknown';const _0x3d5cf9=_0x1ddb03['match'](/(2160p|1440p|1080p|720p|576p|540p|480p|360p|4k|uhd)/i);if(_0x3d5cf9){const _0x46c84e=_0x3d5cf9[0x1][_0x3fe055(_0x2392bf._0x258bed)]();if(_0x46c84e==='4k'||_0x46c84e===_0x3fe055(_0x2392bf._0x51c1a2))return _0x3fe055(_0x2392bf._0x2f8ca0);return _0x46c84e;}return'Unknown';}function cleanSourceName(_0x51bf0e){const _0x43e7cc={_0x5ccc47:0x1c0},_0x122ae1=_0x52e89e;if(!_0x51bf0e)return'';let _0x2fc29d=_0x51bf0e['replace'](_0x122ae1(0x185),'')[_0x122ae1(0x1dc)](/:/g,'\x20')[_0x122ae1(0x1dc)](/-/g,'\x20')['trim']();return/^server\s*[a-z]$/i[_0x122ae1(0x1e0)](_0x2fc29d)&&(_0x2fc29d=_0x2fc29d['replace'](/server\s*([a-z])/i,function(_0x38629f,_0x215e51){const _0x57589f=_0x122ae1;return'Server\x20'+_0x215e51[_0x57589f(_0x43e7cc._0x5ccc47)]();})),_0x2fc29d;}function subtitleLabelFromUrl(_0x537a4b){const _0x49215e={_0x489d0a:0x1e1,_0x5a7b07:0x17d,_0x2c3698:0x1aa,_0x2a7241:0x1c4,_0x4a18a1:0x196},_0x3cf83a=_0x52e89e;if(!_0x537a4b)return'Subtitle';const _0xa21711=_0x537a4b[_0x3cf83a(_0x49215e._0x489d0a)]('?')[0x0][_0x3cf83a(_0x49215e._0x489d0a)]('/')['pop']()['replace'](/%20/g,'\x20'),_0x4e6ebb=_0xa21711[_0x3cf83a(_0x49215e._0x5a7b07)]();if(_0x4e6ebb['includes']('bangla')||_0x4e6ebb['includes'](_0x3cf83a(_0x49215e._0x2c3698))||_0x4e6ebb['includes'](_0x3cf83a(_0x49215e._0x2a7241)))return'Bangla';if(_0x4e6ebb[_0x3cf83a(_0x49215e._0x4a18a1)]('english')||_0x4e6ebb['includes']('eng'))return _0x3cf83a(0x179);if(_0x4e6ebb[_0x3cf83a(0x196)]('hindi')||_0x4e6ebb['includes']('hin'))return _0x3cf83a(0x1e6);return'Subtitle';}function formatBytes(_0x2cb7ec){const _0x325d31={_0x46436f:0x199,_0x524bf3:0x176,_0x1eb709:0x176,_0x8df58b:0x1f4},_0x47a05a=_0x52e89e;if(!_0x2cb7ec||_0x2cb7ec===0x0)return _0x47a05a(_0x325d31._0x46436f);const _0x195dd8=0x400,_0x535431=['Bytes','KB','MB','GB','TB'],_0x53308e=Math[_0x47a05a(0x1a3)](Math[_0x47a05a(_0x325d31._0x524bf3)](_0x2cb7ec)/Math[_0x47a05a(_0x325d31._0x1eb709)](_0x195dd8));return parseFloat((_0x2cb7ec/Math[_0x47a05a(_0x325d31._0x8df58b)](_0x195dd8,_0x53308e))['toFixed'](0x1))+'\x20'+_0x535431[_0x53308e];}function getTMDBDetails(_0x8dca7c,_0x38c07a){const _0x4679da={_0x219083:0x197},_0x1c9c99={_0x512860:0x1c2},_0x1425d2={_0x4398e1:0x174},_0x3e027c=_0x52e89e,_0x3d1053=_0x38c07a==='tv'?'tv':'movie',_0x27d001=TMDB_BASE_URL+'/'+_0x3d1053+'/'+_0x8dca7c+_0x3e027c(0x1a6)+TMDB_API_KEY+'&append_to_response=external_ids';return fetch(_0x27d001,{'headers':{'Accept':'application/json'},'skipSizeCheck':!![]})[_0x3e027c(_0x4679da._0x219083)](_0x552a9d=>{if(!_0x552a9d['ok'])throw new Error('TMDB\x20HTTP\x20'+_0x552a9d['status']);return _0x552a9d['json']();})[_0x3e027c(_0x4679da._0x219083)](_0x49e24c=>{const _0x2c67c4=_0x3e027c,_0x3bef18=_0x38c07a==='tv'?_0x49e24c['name']:_0x49e24c['title'],_0x475597=_0x38c07a==='tv'?_0x49e24c['first_air_date']:_0x49e24c[_0x2c67c4(_0x1425d2._0x4398e1)];return{'title':_0x3bef18,'year':_0x475597?parseInt(_0x475597[_0x2c67c4(0x1e1)]('-')[0x0],0xa):null,'imdbId':_0x49e24c['external_ids']&&_0x49e24c['external_ids']['imdb_id']||null};})[_0x3e027c(0x1b0)](_0x1d094e=>{const _0xb79ea1=_0x3e027c;return console[_0xb79ea1(_0x1c9c99._0x512860)]('[CTGMovies]\x20TMDB\x20fetch\x20failed:',_0x1d094e['message']),null;});}function queryString(_0x1705e3){const _0x521cdb={_0x3e4469:0x1d4,_0x416877:0x19b},_0x583ce7=_0x52e89e;_0x1705e3=_0x1705e3||{};const _0x55c7fc=Object[_0x583ce7(_0x521cdb._0x3e4469)](_0x1705e3)['filter'](_0x33f506=>_0x1705e3[_0x33f506]!=null)[_0x583ce7(0x182)](_0x384759=>encodeUrl(_0x384759)+'='+encodeUrl(String(_0x1705e3[_0x384759])));return _0x55c7fc[_0x583ce7(_0x521cdb._0x416877)]?'?'+_0x55c7fc[_0x583ce7(0x1d6)]('&'):'';}function buildApiUrl(_0x247cc4,_0x1e5990){const _0x46a549={_0x14b005:0x187},_0x3168b9=_0x52e89e,_0x131f2b=_0x247cc4[_0x3168b9(_0x46a549._0x14b005)]('/')?_0x247cc4:'/'+_0x247cc4;return DEFAULT_API_BASE+_0x131f2b+queryString(_0x1e5990);}function buildSameOriginUrl(_0x3c39fd,_0x18d1d7){const _0x140c9b={_0x302d8d:0x187},_0x50b44f=_0x52e89e,_0x129018=_0x3c39fd[_0x50b44f(_0x140c9b._0x302d8d)]('/')?_0x3c39fd:'/'+_0x3c39fd;return MAIN_URL+'/api/v1'+_0x129018+queryString(_0x18d1d7);}function getDetail(_0x169f63){const _0x2ea707={_0x1b4c57:0x192,_0x14360a:0x17b,_0x54d2a7:0x197},_0x567818=_0x52e89e;let _0x1f8184=_0x169f63[_0x567818(_0x2ea707._0x1b4c57)]||_0x567818(_0x2ea707._0x14360a);if(_0x1f8184==='movie')_0x1f8184='movies';return apiGet('/'+_0x1f8184+'/'+_0x169f63['id'])[_0x567818(_0x2ea707._0x54d2a7)](_0x297bce=>{if(!_0x297bce)return null;try{return JSON['parse'](_0x297bce);}catch(_0x2ca488){return null;}});}function apiHeaders(){const _0x55596c={_0x5c838e:0x1a5,_0x396058:0x1b2,_0x554dca:0x1bd,_0x3966a9:0x1ee},_0x4840fc=_0x52e89e,_0x1dba0e=Object[_0x4840fc(0x178)]({},WEB_HEADERS);if(AUTH_CONFIG['token']&&AUTH_CONFIG[_0x4840fc(_0x55596c._0x5c838e)]['trim']()){const _0x325268=AUTH_CONFIG['token']['trim']()['replace'](/^Bearer\s+/i,'');_0x1dba0e[_0x4840fc(0x1e2)]=_0x4840fc(0x1d8)+_0x325268,_0x1dba0e[_0x4840fc(0x1d3)]=_0x325268;}return AUTH_CONFIG[_0x4840fc(_0x55596c._0x396058)]&&AUTH_CONFIG['cookie'][_0x4840fc(_0x55596c._0x554dca)]()&&(_0x1dba0e[_0x4840fc(_0x55596c._0x3966a9)]=AUTH_CONFIG[_0x4840fc(_0x55596c._0x396058)]['trim']()),_0x1dba0e;}function apiGet(_0x5b9cc6,_0x82ba72){const _0x520a41={_0x191a9d:0x1c2},_0xffe710={_0x379636:0x197,_0x30bc4a:0x1cc,_0x105840:0x1b6},_0x11f48e=_0x52e89e,_0x5b5473=buildApiUrl(_0x5b9cc6,_0x82ba72),_0x1c0573=buildSameOriginUrl(_0x5b9cc6,_0x82ba72),_0x39e02a=apiHeaders();function _0x182623(_0x32f83c,_0x3c6962){return _0x3c6962=_0x3c6962||0x0,fetch(_0x32f83c,{'headers':_0x39e02a,'skipSizeCheck':!![]})['then'](_0x357bcd=>{const _0x13a147=_0x4700;if(_0x357bcd[_0x13a147(0x1cc)]>=0x1f4&&_0x357bcd['status']<0x258&&_0x3c6962<0x1)return new Promise(_0x4013e7=>setTimeout(_0x4013e7,0x12c))[_0x13a147(_0xffe710._0x379636)](()=>_0x182623(_0x32f83c,_0x3c6962+0x1));if(!_0x357bcd['ok'])throw new Error('HTTP\x20'+_0x357bcd[_0x13a147(_0xffe710._0x30bc4a)]);return _0x357bcd[_0x13a147(_0xffe710._0x105840)]();});}return _0x182623(_0x5b5473)['catch'](()=>_0x182623(_0x1c0573))[_0x11f48e(0x1b0)](_0x1dda93=>{const _0x1857cf=_0x11f48e;return console[_0x1857cf(_0x520a41._0x191a9d)]('[CTGMovies]\x20apiGet\x20'+_0x5b9cc6+_0x1857cf(0x1d9),_0x1dda93[_0x1857cf(0x18c)]),null;});}function toSearchItem(_0xe2fd2a,_0x341c01){const _0x534500={_0x41023e:0x1c5,_0x5d7784:0x190,_0x3924fe:0x19f,_0x2498e7:0x177,_0x4320a2:0x193},_0x1542eb=_0x52e89e,_0x1fdcd8=_0x341c01===_0x1542eb(0x17b),_0x2d0768=_0x341c01===_0x1542eb(_0x534500._0x41023e)||_0xe2fd2a['is_anime']===!![]&&_0x341c01!=='tv',_0x53dcf7=optString(_0xe2fd2a,_0x1542eb(_0x534500._0x5d7784))||optString(_0xe2fd2a,'name')||optString(_0xe2fd2a,_0x1542eb(_0x534500._0x3924fe));if(!_0x53dcf7)return null;const _0x210449=optString(_0xe2fd2a,'slug')||optString(_0xe2fd2a,'id')||optString(_0xe2fd2a,'_id');if(!_0x210449)return null;const _0x20f1a2=optString(_0xe2fd2a,'poster_url')||optString(_0xe2fd2a,'cover_url'),_0x2de495=optInt(_0xe2fd2a,_0x1542eb(_0x534500._0x2498e7))||yearFromDate(optString(_0xe2fd2a,'release_date'))||yearFromDate(optString(_0xe2fd2a,_0x1542eb(_0x534500._0x4320a2)));let _0x54e90c=_0x1fdcd8?'movie':_0x2d0768?_0x1542eb(0x1c5):'tv',_0x5dcd76=MAIN_URL+'/'+(_0x1fdcd8?'movies':_0x2d0768?_0x1542eb(0x1c5):'tv')+'/'+_0x210449;return{'title':cleanDisplayTitle(_0x53dcf7),'url':_0x5dcd76,'kind':_0x341c01,'id':_0x210449,'type':_0x54e90c,'poster':_0x20f1a2,'year':_0x2de495};}function parseSearchItems(_0x794105,_0x59df5d){const _0x3f06b3={_0x443332:0x17b},_0x2ca968=_0x52e89e;if(!_0x794105)return[];let _0x5930a9=_0x794105[_0x2ca968(0x1bd)](),_0x3ada66;try{const _0x273d16=JSON['parse'](_0x5930a9);if(Array['isArray'](_0x273d16))_0x3ada66=_0x273d16;else _0x273d16&&typeof _0x273d16===_0x2ca968(0x1f2)?_0x3ada66=_0x273d16[_0x2ca968(_0x3f06b3._0x443332)]||_0x273d16[_0x2ca968(0x1ed)]||_0x273d16['data']||[]:_0x3ada66=[];}catch(_0x27f4a6){return[];}const _0x52b019=[];for(const _0x592b0f of _0x3ada66){const _0x5a6a06=toSearchItem(_0x592b0f,_0x59df5d);if(_0x5a6a06)_0x52b019[_0x2ca968(0x19d)](_0x5a6a06);}return _0x52b019;}function searchCtg(_0x153f4c){const _0x57a05d={_0x543c80:0x19c,_0x1a6e02:0x197,_0x246868:0x188,_0x104238:0x1b0},_0x464056=_0x52e89e,_0x3cf7bd={'search':_0x153f4c},_0x24ab75=apiGet(_0x464056(_0x57a05d._0x543c80),_0x3cf7bd)[_0x464056(_0x57a05d._0x1a6e02)](_0x3ce19e=>parseSearchItems(_0x3ce19e,_0x464056(0x17b)))[_0x464056(0x1b0)](()=>[]),_0x53d37a=apiGet(_0x464056(_0x57a05d._0x246868),_0x3cf7bd)[_0x464056(0x197)](_0x1d9988=>parseSearchItems(_0x1d9988,'tv'))[_0x464056(_0x57a05d._0x104238)](()=>[]),_0x4cfb3b=apiGet(_0x464056(0x19e),_0x3cf7bd)[_0x464056(_0x57a05d._0x1a6e02)](_0x8ac47e=>parseSearchItems(_0x8ac47e,_0x464056(0x1c5)))['catch'](()=>[]);return Promise['all']([_0x24ab75,_0x53d37a,_0x4cfb3b])[_0x464056(_0x57a05d._0x1a6e02)](([_0x12d3b1,_0x31b65f,_0x2fa174])=>_0x12d3b1['concat'](_0x31b65f)[_0x464056(0x1b7)](_0x2fa174));}function findBestMatch(_0x471698,_0x169eeb,_0x5e24f9){const _0x2dac40={_0x53ad65:0x177,_0x53c02f:0x190,_0x15e753:0x196,_0x45f1ca:0x1f0},_0x3c11f1=_0x52e89e;if(!_0x169eeb['length'])return null;const _0x40130f=normalizedTitle(_0x471698['title']),_0x5741a6=_0x471698[_0x3c11f1(_0x2dac40._0x53ad65)];let _0x29343e=null,_0x452f18=-0x1;for(const _0x5db85b of _0x169eeb){const _0x445855=normalizedTitle(_0x5db85b[_0x3c11f1(_0x2dac40._0x53c02f)]);let _0x4c8e3d=-0x1;if(_0x445855===_0x40130f){_0x4c8e3d=0x64;if(_0x5741a6&&_0x5db85b[_0x3c11f1(0x177)]===_0x5741a6)_0x4c8e3d+=0x32;}else{if(_0x445855[_0x3c11f1(_0x2dac40._0x15e753)](_0x40130f)&&_0x40130f['length']>=0x4){_0x4c8e3d=0x3c;if(_0x5741a6&&_0x5db85b['year']===_0x5741a6)_0x4c8e3d+=0x1e;}else _0x40130f['includes'](_0x445855)&&_0x445855['length']>=0x4&&(_0x4c8e3d=0x28);}if(_0x5e24f9==='tv'&&(_0x5db85b['type']==='tv'||_0x5db85b['type']==='anime'))_0x4c8e3d+=0xa;if(_0x5e24f9===_0x3c11f1(_0x2dac40._0x45f1ca)&&(_0x5db85b[_0x3c11f1(0x184)]==='movie'||_0x5db85b[_0x3c11f1(0x184)]==='anime'))_0x4c8e3d+=0xa;_0x4c8e3d>_0x452f18&&(_0x452f18=_0x4c8e3d,_0x29343e=_0x5db85b);}return _0x452f18>=0x1e?_0x29343e:null;}function buildStreams(_0x3741c5,_0x14285e){const _0x42c6de={_0xecf79c:0x1ef,_0xf282fb:0x1a9,_0x4b2a54:0x1c6,_0x5f3a24:0x1e7,_0x5d2a6e:0x17d,_0x4029d4:0x1ad,_0x2b4bbe:0x196,_0x1cdd65:0x196,_0x46e94b:0x1c4,_0x1bbf29:0x1b1,_0x2cfa74:0x1d1,_0x51ec89:0x196,_0x45ead1:0x1de,_0x4daa35:0x196,_0x3e6d53:0x1ac,_0xc5c557:0x196,_0x29b535:0x1be,_0x488b53:0x1dd,_0x218b5d:0x17e,_0x188d7b:0x1a0,_0x4de779:0x1a8,_0x4b2b22:0x18b,_0x243bc0:0x1ae,_0x519ddd:0x1d0,_0x4e4bc4:0x1db,_0x4201c5:0x186,_0x48c030:0x1a4,_0x40dc8c:0x194,_0x2f680e:0x1c9,_0x4a0742:0x181,_0x55cf92:0x19d},_0x3f8495=new Set(),_0x16f72e=[];return _0x3741c5['forEach']((_0x4cb377,_0x2a2991)=>{const _0x6c7e9d=_0x4700;if(!_0x4cb377||_0x4cb377['broken']===!![])return;const _0x4c02b5=optString(_0x4cb377,_0x6c7e9d(0x19a))||optString(_0x4cb377,'file')||optString(_0x4cb377,'src')||optString(_0x4cb377,_0x6c7e9d(0x1b4));if(!_0x4c02b5)return;const _0x20f24a=resolveMediaUrl(_0x4c02b5);if(!_0x20f24a||_0x3f8495['has'](_0x20f24a))return;_0x3f8495[_0x6c7e9d(_0x42c6de._0xecf79c)](_0x20f24a);let _0x3c29dd=qualityFromUrl(_0x20f24a);const _0x527f8d=optString(_0x4cb377,'quality')||'';if(_0x3c29dd==='Unknown'){const _0xbc93f9=_0x527f8d['match'](/(2160|1440|1080|720|576|540|480|360)p?/i);if(_0xbc93f9){const _0x5ecfd5=parseInt(_0xbc93f9[0x1],0xa);_0x3c29dd=_0x5ecfd5>=0x870?_0x6c7e9d(0x1b9):_0x5ecfd5>=0x5a0?_0x6c7e9d(_0x42c6de._0xf282fb):_0x5ecfd5>=0x438?_0x6c7e9d(_0x42c6de._0x4b2a54):_0x5ecfd5>=0x2d0?_0x6c7e9d(_0x42c6de._0x5f3a24):_0x5ecfd5>=0x240?_0x6c7e9d(0x1da):_0x5ecfd5>=0x1e0?_0x6c7e9d(0x1bf):_0x5ecfd5>=0x168?'360p':'Unknown';}}const _0xe1d117=_0x3c29dd!=='Unknown'?_0x3c29dd[_0x6c7e9d(_0x42c6de._0x5d2a6e)]():_0x6c7e9d(_0x42c6de._0x4b2a54),_0x11a27e=(optString(_0x4cb377,_0x6c7e9d(_0x42c6de._0x4029d4))||'en')[_0x6c7e9d(_0x42c6de._0x5d2a6e)]();let _0x4d122a=_0x6c7e9d(0x179),_0x1adc98='🌍';if(_0x11a27e[_0x6c7e9d(_0x42c6de._0x2b4bbe)](_0x6c7e9d(0x1af))||_0x527f8d[_0x6c7e9d(_0x42c6de._0x5d2a6e)]()[_0x6c7e9d(_0x42c6de._0x1cdd65)]('hindi'))_0x4d122a='Hindi',_0x1adc98='🇮🇳';else{if(_0x11a27e[_0x6c7e9d(0x196)](_0x6c7e9d(_0x42c6de._0x46e94b))||_0x11a27e['includes']('bangla'))_0x4d122a=_0x6c7e9d(_0x42c6de._0x1bbf29),_0x1adc98='🇧🇩';else(_0x11a27e['includes'](_0x6c7e9d(0x1ce))||_0x11a27e==='en')&&(_0x4d122a='English',_0x1adc98=_0x6c7e9d(0x1d7));}const _0x2cf04f=(_0x20f24a+'\x20'+_0x527f8d+'\x20'+(_0x4cb377['group_source']||'')+'\x20'+(_0x4cb377[_0x6c7e9d(_0x42c6de._0x2cfa74)]||''))['toLowerCase']();let _0xcd7423='x264';if(_0x2cf04f[_0x6c7e9d(_0x42c6de._0x51ec89)](_0x6c7e9d(0x1ea))||_0x2cf04f[_0x6c7e9d(0x196)](_0x6c7e9d(0x191)))_0xcd7423='x265';else{if(_0x2cf04f[_0x6c7e9d(_0x42c6de._0x2b4bbe)](_0x6c7e9d(0x1cf)))_0xcd7423='HEVC';}let _0x51d353='WEB-DL';if(_0x2cf04f[_0x6c7e9d(0x196)]('webrip')||_0x2cf04f[_0x6c7e9d(0x196)](_0x6c7e9d(_0x42c6de._0x45ead1)))_0x51d353=_0x6c7e9d(0x1bb);else{if(_0x2cf04f[_0x6c7e9d(_0x42c6de._0x4daa35)](_0x6c7e9d(_0x42c6de._0x3e6d53))||_0x2cf04f[_0x6c7e9d(_0x42c6de._0xc5c557)]('blu-ray')||_0x2cf04f['includes'](_0x6c7e9d(_0x42c6de._0x29b535)))_0x51d353=_0x6c7e9d(_0x42c6de._0x488b53);else{if(_0x2cf04f['includes'](_0x6c7e9d(_0x42c6de._0x218b5d)))_0x51d353=_0x6c7e9d(0x183);}}let _0x256fe5=_0x6c7e9d(0x1a1);if(_0x20f24a[_0x6c7e9d(0x196)]('.mp4'))_0x256fe5=_0x6c7e9d(0x1eb);else{if(_0x20f24a['includes'](_0x6c7e9d(0x195)))_0x256fe5=_0x6c7e9d(_0x42c6de._0x188d7b);}const _0x539dc2=optInt(_0x4cb377,_0x6c7e9d(0x1a8))?formatBytes(optInt(_0x4cb377,_0x6c7e9d(_0x42c6de._0x4de779))):'Unknown';let _0x1f5abd='5.1\x20Surround',_0x4844c6=optString(_0x4cb377,_0x6c7e9d(0x1a2))||optString(_0x4cb377,'source_display')||_0x6c7e9d(_0x42c6de._0x4b2b22)+(_0x2a2991+0x1);const _0x2e878f=cleanSourceName(_0x4844c6),_0x11a46d='CTGMovies\x20|\x20'+_0xe1d117+'\x20|\x20'+_0x4d122a,_0x5d5662=_0x6c7e9d(_0x42c6de._0x243bc0)+_0x14285e[_0x6c7e9d(0x190)]+_0x6c7e9d(0x1ca)+(_0x14285e['year']||_0x6c7e9d(_0x42c6de._0x519ddd))+')',_0x4921ef='⭐\x20'+_0xe1d117+'\x20|\x20'+_0x1adc98+'\x20'+_0x4d122a+_0x6c7e9d(0x18d)+_0x539dc2,_0x37bdce='🔖\x20'+_0x256fe5+_0x6c7e9d(_0x42c6de._0x4e4bc4)+_0xcd7423+_0x6c7e9d(_0x42c6de._0x4201c5)+_0x1f5abd,_0x5e6e94='⛓️‍💥\x20'+_0x2e878f+'\x20|\x20☁️\x20'+_0x51d353,_0x15d868=_0x5d5662+'\x0a'+_0x4921ef+'\x0a'+_0x37bdce+'\x0a'+_0x5e6e94,_0x19832e=[],_0x34b375=['subtitle_tracks',_0x6c7e9d(0x1f3),_0x6c7e9d(_0x42c6de._0x48c030),_0x6c7e9d(_0x42c6de._0x40dc8c)];for(const _0x3e0e8a of _0x34b375){const _0x58ad43=_0x4cb377[_0x3e0e8a];if(Array[_0x6c7e9d(0x1c8)](_0x58ad43))for(const _0x16028e of _0x58ad43){const _0x352dc2=optString(_0x16028e,'url')||optString(_0x16028e,_0x6c7e9d(0x175))||optString(_0x16028e,'src');if(!_0x352dc2)continue;const _0x39da28=resolveSubtitleUrl(_0x352dc2);if(!_0x39da28||_0x19832e[_0x6c7e9d(_0x42c6de._0x2f680e)](_0x2b93be=>_0x2b93be['url']===_0x39da28))continue;const _0x523e07=optString(_0x16028e,_0x6c7e9d(_0x42c6de._0x4a0742))||optString(_0x16028e,_0x6c7e9d(0x1ad))||subtitleLabelFromUrl(_0x39da28);_0x19832e[_0x6c7e9d(0x19d)]({'url':_0x39da28,'lang':_0x523e07});}}_0x16f72e[_0x6c7e9d(_0x42c6de._0x55cf92)]({'name':_0x11a46d,'title':_0x15d868,'size':_0x15d868,'description':_0x15d868,'url':_0x20f24a,'quality':'','language':'','provider':'CTGMovies','headers':STREAM_HEADERS,'subtitles':_0x19832e[_0x6c7e9d(0x19b)]?_0x19832e:void 0x0});}),_0x16f72e;}function getMovieStreams(_0x1a749b,_0x478076){const _0x2da345={_0x2a915a:0x1b0},_0x2e7470=_0x52e89e;return getDetail(_0x1a749b)[_0x2e7470(0x197)](_0x22eaf3=>{const _0x5957aa=_0x2e7470;if(!_0x22eaf3||!_0x22eaf3['links'])return[];return buildStreams(_0x22eaf3[_0x5957aa(0x1c3)],_0x478076);})[_0x2e7470(_0x2da345._0x2a915a)](()=>[]);}function _0x43ff(){const _0xcc4ec=['DgL0Bgu','Adi2nq','A2LUza','zMLYC3rFywLYx2rHDgu','DhjHy2TZ','lM0ZDtG','Aw5JBhvKzxm','DgHLBG','zxbPC29Kzv9UDw1Izxi','vw5RBM93BG','DxjS','BgvUz3rO','l21VDMLLCW','ChvZAa','l2fUAw1L','zw5NBgLZAf90AxrSzq','ttnvoa','tuTw','z3jVDxbFC291CMnL','zMXVB3i','y2fWDgLVBNm','Dg9Rzw4','p2fWAv9RzxK9','BM8Ty29YCW','C2L6zv9IExrLCW','mtq0mha','yMvUz2fSAq','zxbPC29Kzq','yMX1CMf5','BgfUz3vHz2u','8j+nVYa','AgLU','y2f0y2G','qMfUz2XH','y29VA2LL','DwHK','BgLUAW','DMLKzw8VD2vIBsX2AwrLBY9Vz2CSDMLKzw8VkJTXptaUosXHChbSAwnHDgLVBI9Vz2C7Ct0WlJCSyxvKAw8VkJTXptaUnIWQlYO7Ct0WlJu','Dgv4Da','y29Uy2f0','mtyYnLzWC3fWtG','mJe2mha','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','v0vclvjPCa','AwrLBNrPDhK','DhjPBq','yNjYAxa','ndGWCa','Dg9vChbLCKnHC2u','zxHWB3j0CW','zxjYB3i','BgLUA3m','yMvU','yw5PBwu','mta4mha','odjPrNLYEfm','AxnbCNjHEq','C29Tzq','ic0Gka','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmW','C3rHDhvZ','nJu5otCYofDqALDOqW','zw5N','Agv2yW','mJaYnG','C291CMnLx2rPC3bSyxK','Ahr0Chm6','Ec1HDxrOlxrVA2vU','A2v5CW','Bwf0y2G','AM9PBG','8j+hUVcFH7G','qMvHCMvYia','igzHAwXLzdO','ntC2Ca','ihWG8j+oPsa','CMvWBgfJzq','qMX1uMf5','D2vIlxjPCa','nZiXndDXtffuzg8','DgvZDa','C3bSAxq','qxv0Ag9YAxPHDgLVBG','ovDWAvvnrq','C3rYAw5N','mJmYnJfosg1NC0G','sgLUzgK','nZiWCa','BNvSBa','C2vHC29Ux251BwjLCG','Edi2nq','tva0','odG2mdm2zhn0twne','CMvZDwX0CW','q29VA2LL','ywrK','Bw92Awu','mte5mdK4ndnosgrlzxa','B2jQzwn0','C3vIDgL0BgvZ','Cg93','CMvSzwfZzv9KyxrL','zMLSzq','Bg9N','EwvHCG','yxnZAwDU','rw5NBgLZAa','CgfKu3rHCNq','Bw92AwvZ','mJi4mJiWzwrIu3HQ','Dg9mB3DLCKnHC2u','AgrYAxa','Aw1KyKLK','zxbPC29Kzxm','BgfIzwW','BwfW','sersAxa','DhLWzq','yxv0BZO','ihWG8j+oPYa','C3rHCNrZv2L0Aa','l3r2','ywjZB2X1DgvFBNvTyMvY','otaWnde3meXxv3bIEq','u2vYDMvYia','BwvZC2fNzq','ihWG8j+sVIa','yNjVA2vU','nZvowfn2tvO'];_0x43ff=function(){return _0xcc4ec;};return _0x43ff();}function getEpisodeStreams(_0x5eddb8,_0x524e5b,_0x498f51,_0x9c9dbe){const _0xe55f7c={_0x6720db:0x180,_0x13ae54:0x189,_0x518a95:0x1c3};return getDetail(_0x5eddb8)['then'](_0x198edb=>{const _0x791408=_0x4700;if(!_0x198edb||!_0x198edb[_0x791408(_0xe55f7c._0x6720db)])return[];const _0x1587fa=[];for(const _0x3c6ae0 of _0x198edb['episodes']){const _0x55a6bc=optInt(_0x3c6ae0,_0x791408(0x198))||optInt(_0x3c6ae0,_0x791408(_0xe55f7c._0x13ae54)),_0x4398e7=optInt(_0x3c6ae0,_0x791408(0x1e9))||0x1;if(_0x4398e7!==_0x498f51||_0x55a6bc!==_0x9c9dbe)continue;const _0x3fc9a9=_0x3c6ae0[_0x791408(_0xe55f7c._0x518a95)]||[];for(const _0x4fc8b7 of _0x3fc9a9){if(_0x4fc8b7&&_0x4fc8b7[_0x791408(0x18e)]!==!![])_0x1587fa[_0x791408(0x19d)](_0x4fc8b7);}}return buildStreams(_0x1587fa,_0x524e5b);})['catch'](()=>[]);}function scrape(_0x22beb2){const _0x4e5299={_0x169c23:0x190,_0x4ead37:0x1f0,_0x9c6046:0x1ab},_0x31f166={_0x5f1d2e:0x19b},_0x531991=_0x52e89e,_0x245aaf=_0x22beb2&&_0x22beb2[_0x531991(_0x4e5299._0x169c23)],_0x1a28c7=_0x22beb2&&_0x22beb2['type']||_0x531991(_0x4e5299._0x4ead37),_0xb11ab8=_0x22beb2&&_0x22beb2['season'],_0x3dddfc=_0x22beb2&&_0x22beb2[_0x531991(_0x4e5299._0x9c6046)],_0x45d0bf=_0x22beb2&&_0x22beb2['year'];if(!_0x245aaf)return Promise['resolve']([]);const _0x533c06={'title':_0x245aaf,'year':_0x45d0bf||null,'imdbId':_0x22beb2&&_0x22beb2['imdbId']||null};return searchCtg(_0x245aaf)[_0x531991(0x197)](_0x571c46=>{const _0x2b2162=_0x531991;if(!_0x571c46[_0x2b2162(_0x31f166._0x5f1d2e)])return[];const _0x4a5a05=findBestMatch(_0x533c06,_0x571c46,_0x1a28c7);if(!_0x4a5a05)return[];if(_0x1a28c7==='tv'&&_0xb11ab8&&_0x3dddfc)return _0x533c06['title']=_0x533c06['title']+'\x20S'+String(_0xb11ab8)[_0x2b2162(0x17a)](0x2,'0')+'E'+String(_0x3dddfc)['padStart'](0x2,'0'),getEpisodeStreams(_0x4a5a05,_0x533c06,_0xb11ab8,_0x3dddfc);return getMovieStreams(_0x4a5a05,_0x533c06);})['catch'](()=>[]);}function getStreams(_0x129610,_0x4320ec=_0x52e89e(0x1f0),_0x5c7bd6=null,_0x1c7287=null){const _0xae5107=_0x52e89e;return getTMDBDetails(_0x129610,_0x4320ec)[_0xae5107(0x197)](_0x150dbc=>{const _0x1621e5=_0xae5107;if(!_0x150dbc||!_0x150dbc['title'])return[];return scrape({'title':_0x150dbc['title'],'year':_0x150dbc[_0x1621e5(0x177)],'type':_0x4320ec,'season':_0x5c7bd6,'episode':_0x1c7287,'imdbId':_0x150dbc[_0x1621e5(0x17f)]});})[_0xae5107(0x1b0)](()=>[]);}typeof module!=='undefined'&&module['exports']&&(module[_0x52e89e(0x1c1)]={'getStreams':getStreams,'scrape':scrape});

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "ctgmovies", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "CTGMovies", "ctgmovies");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
