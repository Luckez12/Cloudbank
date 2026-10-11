// Imported provider: kurage; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x58353f=_0x5ea7;function _0x5ea7(_0x5e171b,_0x1dfae9){_0x5e171b=_0x5e171b-0x115;const _0x4ec00a=_0x4ec0();let _0x5ea7db=_0x4ec00a[_0x5e171b];if(_0x5ea7['oAoYdE']===undefined){var _0x390fb4=function(_0x4f087f){const _0x4b9854='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x4c2529='',_0xf0d22d='';for(let _0xd0f73a=0x0,_0x3f0e1d,_0x2c110c,_0x2385c1=0x0;_0x2c110c=_0x4f087f['charAt'](_0x2385c1++);~_0x2c110c&&(_0x3f0e1d=_0xd0f73a%0x4?_0x3f0e1d*0x40+_0x2c110c:_0x2c110c,_0xd0f73a++%0x4)?_0x4c2529+=String['fromCharCode'](0xff&_0x3f0e1d>>(-0x2*_0xd0f73a&0x6)):0x0){_0x2c110c=_0x4b9854['indexOf'](_0x2c110c);}for(let _0xfee7a9=0x0,_0x2e851a=_0x4c2529['length'];_0xfee7a9<_0x2e851a;_0xfee7a9++){_0xf0d22d+='%'+('00'+_0x4c2529['charCodeAt'](_0xfee7a9)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0xf0d22d);};_0x5ea7['kfSCYg']=_0x390fb4,_0x5ea7['HmzvvQ']={},_0x5ea7['oAoYdE']=!![];}const _0x3a0e15=_0x4ec00a[0x0],_0x5b516c=_0x5e171b+_0x3a0e15,_0x1a2831=_0x5ea7['HmzvvQ'][_0x5b516c];return!_0x1a2831?(_0x5ea7db=_0x5ea7['kfSCYg'](_0x5ea7db),_0x5ea7['HmzvvQ'][_0x5b516c]=_0x5ea7db):_0x5ea7db=_0x1a2831,_0x5ea7db;}(function(_0x309d49,_0x1d1ac2){const _0x11a661={_0x3487df:0x11c,_0x104902:0x163,_0x277bbf:0x157,_0x5b688d:0x135,_0x36df7b:0x160,_0x120afb:0x143,_0x5d063f:0x123,_0x24f2de:0x155,_0xab6507:0x159,_0x41e712:0x15d},_0xc5b68c=_0x5ea7,_0x1e4268=_0x309d49();while(!![]){try{const _0x9b0217=-parseInt(_0xc5b68c(_0x11a661._0x3487df))/0x1*(-parseInt(_0xc5b68c(_0x11a661._0x104902))/0x2)+-parseInt(_0xc5b68c(0x167))/0x3*(parseInt(_0xc5b68c(0x12e))/0x4)+parseInt(_0xc5b68c(0x14e))/0x5*(-parseInt(_0xc5b68c(_0x11a661._0x277bbf))/0x6)+parseInt(_0xc5b68c(_0x11a661._0x5b688d))/0x7*(parseInt(_0xc5b68c(_0x11a661._0x36df7b))/0x8)+parseInt(_0xc5b68c(_0x11a661._0x120afb))/0x9*(parseInt(_0xc5b68c(0x11a))/0xa)+-parseInt(_0xc5b68c(_0x11a661._0x5d063f))/0xb*(-parseInt(_0xc5b68c(_0x11a661._0x24f2de))/0xc)+parseInt(_0xc5b68c(_0x11a661._0xab6507))/0xd*(-parseInt(_0xc5b68c(_0x11a661._0x41e712))/0xe);if(_0x9b0217===_0x1d1ac2)break;else _0x1e4268['push'](_0x1e4268['shift']());}catch(_0xba9abc){_0x1e4268['push'](_0x1e4268['shift']());}}}(_0x4ec0,0x8cb8d));var __defProp=Object[_0x58353f(0x133)],__defProps=Object['defineProperties'],__getOwnPropDescs=Object['getOwnPropertyDescriptors'],__getOwnPropSymbols=Object['getOwnPropertySymbols'],__hasOwnProp=Object[_0x58353f(0x151)]['hasOwnProperty'],__propIsEnum=Object[_0x58353f(0x151)][_0x58353f(0x136)],__defNormalProp=(_0x4c2529,_0xf0d22d,_0xd0f73a)=>_0xf0d22d in _0x4c2529?__defProp(_0x4c2529,_0xf0d22d,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0xd0f73a}):_0x4c2529[_0xf0d22d]=_0xd0f73a,__spreadValues=(_0x3f0e1d,_0x2c110c)=>{const _0x208ed2=_0x58353f;for(var _0x2385c1 in _0x2c110c||(_0x2c110c={}))if(__hasOwnProp['call'](_0x2c110c,_0x2385c1))__defNormalProp(_0x3f0e1d,_0x2385c1,_0x2c110c[_0x2385c1]);if(__getOwnPropSymbols)for(var _0x2385c1 of __getOwnPropSymbols(_0x2c110c)){if(__propIsEnum[_0x208ed2(0x11f)](_0x2c110c,_0x2385c1))__defNormalProp(_0x3f0e1d,_0x2385c1,_0x2c110c[_0x2385c1]);}return _0x3f0e1d;},__spreadProps=(_0xfee7a9,_0x2e851a)=>__defProps(_0xfee7a9,__getOwnPropDescs(_0x2e851a)),__async=(_0x5c523a,_0x4cf45c,_0xbbf5e1)=>{const _0x48ab50={_0xa9f8e3:0x128};return new Promise((_0x5bc88e,_0x2f6717)=>{const _0x55f25e={_0x23a930:0x121},_0x426d25=_0x5ea7;var _0x5a3fd5=_0x49d615=>{const _0x27aedb=_0x5ea7;try{_0x4a91b3(_0xbbf5e1[_0x27aedb(_0x55f25e._0x23a930)](_0x49d615));}catch(_0x11ea2b){_0x2f6717(_0x11ea2b);}},_0x58b612=_0xf94934=>{const _0x1b7332=_0x5ea7;try{_0x4a91b3(_0xbbf5e1[_0x1b7332(_0x48ab50._0xa9f8e3)](_0xf94934));}catch(_0x28a232){_0x2f6717(_0x28a232);}},_0x4a91b3=_0x2dad2e=>_0x2dad2e['done']?_0x5bc88e(_0x2dad2e['value']):Promise['resolve'](_0x2dad2e[_0x426d25(0x138)])[_0x426d25(0x146)](_0x5a3fd5,_0x58b612);_0x4a91b3((_0xbbf5e1=_0xbbf5e1['apply'](_0x5c523a,_0x4cf45c))['next']());});},KURAGE_BASE='https://kurage.live',TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',ANILIST_URL=_0x58353f(0x166),ARM_BASE='https://arm.haglund.dev/api/v2',CINEMETA_URL='https://v3-cinemeta.strem.io/meta',DEFAULT_HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/120.0.0.0\x20Safari/537.36','Accept':_0x58353f(0x134),'Accept-Language':_0x58353f(0x14f),'Origin':KURAGE_BASE,'Referer':KURAGE_BASE+'/'};function fetchText(_0x1caee2){return __async(this,arguments,function*(_0x101775,_0x5dba55={}){const _0x48138e=_0x5ea7,_0x4b5f74=yield fetch(_0x101775,__spreadProps(__spreadValues({},_0x5dba55),{'headers':__spreadValues(__spreadValues({},DEFAULT_HEADERS),_0x5dba55[_0x48138e(0x144)]||{})}));if(!_0x4b5f74['ok'])throw new Error('HTTP\x20'+_0x4b5f74[_0x48138e(0x12d)]+':\x20'+_0x101775);return yield _0x4b5f74['text']();});}function fetchJson(_0x1e17b4){return __async(this,arguments,function*(_0x4ad1ec,_0x1cb9ec={}){const _0x1eb7d8=yield fetchText(_0x4ad1ec,_0x1cb9ec);return JSON['parse'](_0x1eb7d8);});}function getSyncInfo(_0x1d852b,_0x151384,_0x2c2ed1,_0x446f5a){const _0x3d6c17={_0x3daeaa:0x168,_0x4bea9b:0x145,_0x330783:0x124,_0x95b324:0x140,_0x595a16:0x130};return __async(this,null,function*(){const _0x3b0964={_0x2bb396:0x13c,_0x171955:0x120,_0xcad33e:0x140,_0x2f5e2b:0x13d,_0x964d8d:0x161,_0x1c75e8:0x169,_0x515d37:0x122},_0x21b968=_0x5ea7,_0x129b2e=_0x415e93=>__async(this,null,function*(){const _0x5e2a30=_0x5ea7,_0x503cc2=_0x151384===_0x5e2a30(0x168)?'movie':'series',_0x42e6c9=CINEMETA_URL+'/'+_0x503cc2+'/'+_0x415e93+'.json';try{const _0x5077dc=yield fetchJson(_0x42e6c9),_0x26f5f0=_0x5077dc['meta'];if(!_0x26f5f0)throw new Error('No\x20Cinemata\x20metadata');if(_0x151384==='movie')return{'date':_0x26f5f0[_0x5e2a30(0x13c)]?_0x26f5f0[_0x5e2a30(_0x3b0964._0x2bb396)][_0x5e2a30(_0x3b0964._0x171955)]('T')[0x0]:null,'title':_0x26f5f0[_0x5e2a30(0x169)],'dayIndex':0x1,'runtime':_0x26f5f0[_0x5e2a30(_0x3b0964._0xcad33e)]||_0x5e2a30(0x12b)};const _0x4d0e73=_0x26f5f0[_0x5e2a30(_0x3b0964._0x2f5e2b)]||[],_0x1076d5=_0x4d0e73['find'](_0x36ec1d=>_0x36ec1d['season']==_0x2c2ed1&&_0x36ec1d['episode']==_0x446f5a);if(!_0x1076d5||!_0x1076d5['released'])return{'date':null,'title':null,'dayIndex':0x1,'runtime':'24m'};const _0x59cef5=_0x1076d5[_0x5e2a30(_0x3b0964._0x2bb396)]['split']('T')[0x0],_0x4a8232=_0x4d0e73['filter'](_0x3ef849=>_0x3ef849['season']==_0x2c2ed1&&_0x3ef849[_0x5e2a30(0x13c)]&&_0x3ef849[_0x5e2a30(0x13c)]['split']('T')[0x0]===_0x59cef5&&parseInt(_0x3ef849['episode'])<parseInt(_0x446f5a))[_0x5e2a30(_0x3b0964._0x964d8d)]+0x1;return{'date':_0x59cef5,'title':_0x1076d5[_0x5e2a30(_0x3b0964._0x1c75e8)]||null,'dayIndex':_0x4a8232,'runtime':_0x26f5f0[_0x5e2a30(_0x3b0964._0xcad33e)]||_0x5e2a30(_0x3b0964._0x515d37)};}catch(_0x24169c){return{'date':null,'title':null,'dayIndex':0x1,'runtime':'24m'};}}),_0x5397c3=_0x21b968(0x148)+(_0x151384==='movie'?'movie':'tv')+'/'+_0x1d852b,[_0x3cd5e6,_0x3a3f1a]=yield Promise['all']([fetchJson(_0x5397c3+(_0x151384===_0x21b968(0x168)?'':'/external_ids')+('?api_key='+TMDB_API_KEY)),fetchJson(_0x5397c3+('?api_key='+TMDB_API_KEY))]);let _0x16c1d6=_0x3cd5e6[_0x21b968(0x132)]||null;const _0x2d0242=_0x3a3f1a['name']||_0x3a3f1a['title']||null;if(!_0x16c1d6)try{const _0x2ca554=yield fetchJson(ARM_BASE+_0x21b968(0x154)+_0x1d852b);_0x16c1d6=Array['isArray'](_0x2ca554)&&_0x2ca554[_0x21b968(0x161)]>0x0?_0x2ca554[0x0][_0x21b968(0x127)]:null;}catch(_0x56b588){}if(!_0x16c1d6)throw new Error('No\x20IMDb\x20ID\x20found\x20for\x20TMDB\x20'+_0x1d852b);const _0x2c3bd5=yield _0x129b2e(_0x16c1d6);let _0x26b763=_0x2c3bd5['date'];if(_0x151384===_0x21b968(_0x3d6c17._0x3daeaa)&&_0x3a3f1a['release_date'])_0x26b763=_0x3a3f1a[_0x21b968(0x11d)];if(!_0x26b763)throw new Error('Could\x20not\x20find\x20release\x20date\x20for\x20ID\x20'+_0x16c1d6);const _0x35ac6c=_0x3a3f1a[_0x21b968(0x140)]?_0x3a3f1a['runtime']+'m':_0x2c3bd5['runtime']?_0x2c3bd5[_0x21b968(0x140)][_0x21b968(_0x3d6c17._0x4bea9b)]()[_0x21b968(_0x3d6c17._0x330783)]('m')?_0x2c3bd5[_0x21b968(_0x3d6c17._0x95b324)]:_0x2c3bd5['runtime']+'m':_0x21b968(0x122);return{'imdbId':_0x16c1d6,'tmdbId':_0x1d852b,'releaseDate':_0x26b763,'title':_0x2d0242,'episodeTitle':_0x2c3bd5[_0x21b968(_0x3d6c17._0x595a16)],'dayIndex':_0x2c3bd5[_0x21b968(0x118)],'episode':_0x446f5a,'duration':_0x35ac6c};});}function resolveAnilistId(_0x3daa3e){const _0x35ec31={_0x3d2229:0x14d,_0x2e8bd1:0x158,_0xef8238:0x13f,_0x515e10:0x147,_0x4fae99:0x162,_0x5ac1c7:0x126,_0x1aa730:0x141,_0x3aad67:0x116,_0x4b16ba:0x139,_0xf5552:0x16b,_0x34f79b:0x141,_0x10e370:0x116,_0x1fc841:0x11e,_0x3a59b3:0x161,_0x18a941:0x150};return __async(this,null,function*(){const _0x32e1b8=_0x5ea7;var _0x3f6201,_0xd41751;const {releaseDate:_0x107e3a,title:_0x43b110,episode:_0x16224b,episodeTitle:_0x443d4b,dayIndex:_0x5cbc04}=_0x3daa3e;if(!_0x107e3a||!/^\d{4}-\d{2}-\d{2}/['test'](_0x107e3a))return null;const _0x28284c='query($search:String){Page(perPage:20){media(search:$search,type:ANIME){id\x20type\x20format\x20title{romaji\x20english}startDate{year\x20month\x20day}endDate{year\x20month\x20day}episodes\x20streamingEpisodes{title}}}}';try{const _0x1edad7=yield fetchJson(ANILIST_URL,{'method':_0x32e1b8(_0x35ec31._0x3d2229),'headers':{'Content-Type':_0x32e1b8(_0x35ec31._0x2e8bd1)},'body':JSON['stringify']({'query':_0x28284c,'variables':{'search':_0x43b110}})}),_0xc6d3bc=((_0xd41751=(_0x3f6201=_0x1edad7['data'])==null?void 0x0:_0x3f6201[_0x32e1b8(_0x35ec31._0xef8238)])==null?void 0x0:_0xd41751['media'])||[];if(_0xc6d3bc[_0x32e1b8(0x161)]===0x0)return null;const _0x4c5b38=new Date(_0x107e3a);for(const _0x142a44 of _0xc6d3bc){const _0x428304=_0x142a44['startDate'],_0x46d78e=_0x428304['year']&&_0x428304['month']&&_0x428304['day']?_0x428304['year']+'-'+String(_0x428304[_0x32e1b8(_0x35ec31._0x515e10)])[_0x32e1b8(0x15a)](0x2,'0')+'-'+String(_0x428304['day'])['padStart'](0x2,'0'):null;if(!_0x46d78e)continue;const _0x1c2fc6=new Date(_0x46d78e),_0x1de188=Math['ceil'](Math[_0x32e1b8(_0x35ec31._0x4fae99)](_0x4c5b38[_0x32e1b8(0x126)]()-_0x1c2fc6[_0x32e1b8(_0x35ec31._0x5ac1c7)]())/(0x3e8*0x3c*0x3c*0x18));let _0x389649=![];if(_0x142a44[_0x32e1b8(_0x35ec31._0x1aa730)]===_0x32e1b8(_0x35ec31._0x3aad67)||_0x142a44[_0x32e1b8(0x141)]===_0x32e1b8(0x12a)||_0x142a44['episodes']===0x1){if(_0x1de188<=0x2)_0x389649=!![];}else{const _0x20bc6a=new Date(_0x1c2fc6);_0x20bc6a['setDate'](_0x20bc6a['getDate']()-0x2);if(_0x4c5b38>=_0x20bc6a){if(_0x142a44['endDate']&&_0x142a44[_0x32e1b8(_0x35ec31._0x4b16ba)]['year']){const _0x299545=new Date(_0x142a44['endDate']['year'],(_0x142a44[_0x32e1b8(0x139)]['month']||0xc)-0x1,_0x142a44[_0x32e1b8(_0x35ec31._0x4b16ba)][_0x32e1b8(_0x35ec31._0xf5552)]||0x1f);_0x299545['setDate'](_0x299545[_0x32e1b8(0x15f)]()+0x2);if(_0x4c5b38<=_0x299545)_0x389649=!![];}else _0x389649=!![];}}if(_0x389649){const _0x2c2600=_0x142a44[_0x32e1b8(_0x35ec31._0x34f79b)]!==_0x32e1b8(_0x35ec31._0x10e370)&&_0x142a44[_0x32e1b8(_0x35ec31._0x34f79b)]!=='SPECIAL'&&_0x142a44[_0x32e1b8(0x131)]!==0x1;let _0x359785=_0x2c2600&&_0x16224b?_0x16224b:_0x5cbc04||0x1;const _0x3415fb=_0x142a44[_0x32e1b8(_0x35ec31._0x1fc841)]||[];if(_0x3415fb['length']>0x1&&_0x443d4b){const _0x356602=_0x443d4b[_0x32e1b8(0x115)]()['replace'](/[^a-z0-9]/g,'');for(let _0x2d1e3e=0x0;_0x2d1e3e<_0x3415fb[_0x32e1b8(_0x35ec31._0x3a59b3)];_0x2d1e3e++){const _0x137cad=(_0x3415fb[_0x2d1e3e]['title']||'')['toLowerCase']()[_0x32e1b8(_0x35ec31._0x18a941)](/[^a-z0-9]/g,'');if(_0x137cad&&(_0x137cad[_0x32e1b8(0x165)](_0x356602)!==-0x1||_0x356602['indexOf'](_0x137cad)!==-0x1)){_0x359785=_0x2d1e3e+0x1;break;}}}return{'alId':_0x142a44['id'],'episode':_0x359785};}}}catch(_0xa3e291){}return null;});}function getStreams(_0x2f293c,_0x307e15,_0x5affbb,_0x20dbd9){const _0x1a6f7d={_0x4ea72c:0x153,_0x422cfc:0x15c,_0x532f03:0x12c,_0x4798fa:0x117,_0xcc78c2:0x119,_0x35a217:0x158,_0x5323e7:0x15e};return __async(this,null,function*(){const _0x46d7b6={_0x3655c1:0x14c},_0x135f8a={_0x1d546d:0x13e,_0x466fc4:0x137,_0x4f353d:0x12f,_0x4d2fbf:0x13a,_0x20f822:0x142,_0x734be3:0x11b,_0x138b89:0x14a,_0x1945f5:0x16a},_0x11c46a=_0x5ea7;try{const _0x595a2f=yield getSyncInfo(_0x2f293c,_0x307e15,_0x5affbb,_0x20dbd9),_0x438e73=yield resolveAnilistId(_0x595a2f);if(!_0x438e73||!_0x438e73['alId'])return console['log'](_0x11c46a(_0x1a6f7d._0x4ea72c)+_0x2f293c),[];const {alId:_0x688ae2,episode:_0x24b8f8}=_0x438e73;console[_0x11c46a(0x13b)](_0x11c46a(_0x1a6f7d._0x422cfc)+_0x688ae2+',\x20Episode:\x20'+_0x24b8f8);const _0x3d0623={'0':{'json':{'id':_0x688ae2}},'1':{'json':{'animeId':_0x688ae2,'episode':_0x24b8f8,'language':_0x11c46a(_0x1a6f7d._0x532f03)}},'2':{'json':{'animeId':_0x688ae2,'episode':_0x24b8f8,'language':_0x11c46a(_0x1a6f7d._0x4798fa)}}},_0x4d504b=KURAGE_BASE+_0x11c46a(_0x1a6f7d._0xcc78c2)+encodeURIComponent(JSON['stringify'](_0x3d0623)),_0x1afd11=yield fetchJson(_0x4d504b,{'headers':{'trpc-accept':_0x11c46a(_0x1a6f7d._0x35a217),'x-trpc-source':_0x11c46a(_0x1a6f7d._0x5323e7)}}),_0x1738e0=[];return _0x1afd11[_0x11c46a(0x16c)](_0x4dc964=>{const _0x2d00fc=_0x11c46a;var _0x1e232e,_0x33736c,_0x3d2c9e;const _0x2cbc91=((_0x3d2c9e=(_0x33736c=(_0x1e232e=_0x4dc964['result'])==null?void 0x0:_0x1e232e['data'])==null?void 0x0:_0x33736c['json'])==null?void 0x0:_0x3d2c9e[_0x2d00fc(_0x46d7b6._0x3655c1)])||[];_0x2cbc91[_0x2d00fc(0x16c)](_0x55a323=>{const _0x3764bf=_0x2d00fc,_0x23e5ac=_0x55a323[_0x3764bf(_0x135f8a._0x1d546d)][_0x3764bf(_0x135f8a._0x466fc4)]('/')?''+KURAGE_BASE+_0x55a323['url']:_0x55a323['url'];let _0x56f05b={};try{const _0x2901e8=new URL(_0x23e5ac),_0x2dcd4=_0x2901e8[_0x3764bf(0x14b)]['get']('headers');_0x2dcd4&&(_0x56f05b=JSON[_0x3764bf(0x152)](atob(_0x2dcd4)));}catch(_0x5e4a24){}const _0x2158a1=(_0x55a323['language']||_0x3764bf(0x12c))[_0x3764bf(0x149)](),_0x5b1fb0=_0x2158a1==='SUB'?'Original\x20(SUB)':_0x3764bf(_0x135f8a._0x4f353d);let _0xd826f1=[];_0x307e15===_0x3764bf(0x168)?_0xd826f1=[_0x3764bf(_0x135f8a._0x4d2fbf)+_0x595a2f['title'],'🎞️\x20MP4\x20|\x20⚡\x20Auto\x20|\x20🌍\x20'+_0x5b1fb0+'\x20|\x20⏱️\x20'+_0x595a2f[_0x3764bf(_0x135f8a._0x20f822)]]:_0xd826f1=[_0x3764bf(_0x135f8a._0x4d2fbf)+_0x595a2f['title'],_0x3764bf(0x125)+_0x5affbb+'E'+_0x20dbd9+'\x20-\x20'+(_0x595a2f['episodeTitle']||_0x3764bf(0x156)+_0x24b8f8),_0x3764bf(0x15b)+_0x5b1fb0+_0x3764bf(_0x135f8a._0x734be3)+_0x595a2f['duration']];const _0x11fa8f=_0xd826f1['join']('\x0a');_0x1738e0[_0x3764bf(0x164)]({'name':_0x3764bf(_0x135f8a._0x138b89)+_0x55a323['label']+']\x20('+_0x2158a1+')','title':_0x11fa8f,'url':_0x23e5ac,'quality':'Auto','headers':__spreadValues(__spreadValues({},DEFAULT_HEADERS),_0x56f05b),'provider':'kurage','type':_0x55a323['sourceType']||_0x3764bf(_0x135f8a._0x1945f5)});});}),_0x1738e0;}catch(_0x4c1fcd){return console['error']('[Kurage]\x20Error:\x20'+_0x4c1fcd[_0x11c46a(0x129)]),[];}});}module['exports']={'getStreams':getStreams};function _0x4ec0(){const _0xaae07e=['Aw5JBhvKzxm','8j+oPsbt','z2v0vgLTzq','Aw1KyG','DgHYB3C','BwvZC2fNzq','u1bfq0Lbta','tI9b','C3vI','C3rHDhvZ','nhrny3Dwrq','rw5NBgLZAcaOrfvckq','DgL0Bgu','zxbPC29Kzxm','Aw1KyL9Pza','zgvMAw5LuhjVCgvYDhK','yxbWBgLJyxrPB24VANnVBIWGDgv4Dc9WBgfPBIWGkI8Q','nJy1whvyChrW','ChjVCgvYDhLjC0vUDw1LCMfIBgu','C3rHCNrZv2L0Aa','DMfSDwu','zw5Krgf0zq','8j+oRca','Bg9N','CMvSzwfZzwq','DMLKzw9Z','DxjS','ugfNzq','CNvUDgLTzq','zM9YBwf0','zhvYyxrPB24','ndC3mtC3m2XytwnTyW','AgvHzgvYCW','Dg9tDhjPBMC','DgHLBG','Bw9UDgG','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','Dg9vChbLCKnHC2u','s3vYywDLihWGqxv0BYb8ifS','C2vHCMnOugfYyw1Z','C2vYDMvYCW','ue9tva','nwn1r3nXCW','zw4TvvmSzw47Ct0WlJK','CMvWBgfJzq','ChjVDg90ExbL','CgfYC2u','w0T1CMfNzv0Gq291BgqGBM90ihjLC29SDMuGqw5PtgLZDcbjrcbMB3iGve1eqIa','l3rOzw1VDMLLzgi/Awq9','nte2qKnKqKnz','rxbPC29Kzsa','ntG0ntG2nKv0z0zeDG','yxbWBgLJyxrPB24VANnVBG','mJiWndaXnJfeq3LmBvO','CgfKu3rHCNq','8j+oNU+4JYbnudqGFcdIMQeGqxv0BYb8ipcFJi0G','w0T1CMfNzv0GuMvZB2X2zwqGDg8Gqw5PtgLZDcbjrdOG','mtr3y1PWBgS','BMv4DgPZlxjLywn0','z2v0rgf0zq','odi5mdr3te96uhi','BgvUz3rO','ywjZ','mJi1nJmZmgDAEgf0zG','ChvZAa','Aw5KzxHpzG','Ahr0Chm6lY9NCMfWAhfSlMfUAwXPC3qUy28','mJq0nZC2m3nLwxDoDq','Bw92Awu','BMfTzq','Bxa0','zgf5','zM9YrwfJAa','Dg9mB3DLCKnHC2u','tu9wsuu','zhvI','zgf5sw5KzxG','l2fWAs90CNbJl2nHDgfSB2CUyw5PBgLZDeLUzM8SzxbPC29KzxmUC291CMnLlgvWAxnVzgvZlNnVDxjJzt9IyxrJAd0XjMLUChv0pq','mJbPAKHOzxy','ihWG4O+X77Ipia','mwnuteLduW','CMvSzwfZzv9KyxrL','C3rYzwfTAw5NrxbPC29Kzxm','y2fSBa','C3bSAxq','BMv4Da','mJrT','mJi3nde0EwzhvK9Y'];_0x4ec0=function(){return _0xaae07e;};return _0x4ec0();}

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "kurage", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();

/* CLOUDBANK_VERSION_MERGE_ADAPTER_START */
function cloudbankVersionMerge(engines, providerId) {
  var primary = engines[0].provider;
  var merged = Object.assign({}, primary);
  function platform(args) {
    var options = args[4];
    var hint = options && options.platform || (typeof globalThis !== 'undefined' && (globalThis.VUEO_PLATFORM || globalThis.PLATFORM || globalThis.platform));
    if (!hint && typeof navigator !== 'undefined') hint = navigator.userAgent;
    hint = String(hint || '').toLowerCase();
    if (/ios|iphone|ipad/.test(hint)) return 'ios';
    if (/android/.test(hint)) return 'android';
    return hint;
  }
  function available(engine, args) {
    if (!engine.enabled) return false;
    if (!engine.disabledPlatforms.length) return true;
    var current = platform(args);
    // Preserve source platform restrictions when the host cannot identify its platform.
    return !!current && engine.disabledPlatforms.indexOf(current) < 0;
  }
  function key(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + key(value[k]); }).join(',') + '}';
  }
  function combine(results) {
    var seen = Object.create(null), out = [];
    results.forEach(function(rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(function(stream) {
        if (!stream || typeof stream.url !== 'string' || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return;
        var identity;
        try { identity = key([stream.url, stream.name || '', stream.headers || {}, stream.subtitles || [], stream.audio || stream.language || '', stream.quality || '']); }
        catch (_) { identity = String(stream.url) + '/' + String(stream.name || ''); }
        if (seen[identity]) return;
        seen[identity] = true;
        out.push(Object.assign({}, stream, { provider: providerId }));
      });
    });
    return out;
  }
  merged.getStreams = function(id, type, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    type = type === 'series' ? 'tv' : type;
    if (!String(id || '').trim() || (type !== 'movie' && type !== 'tv')) return Promise.resolve([]);
    if (type === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(id); args[1] = type;
    if (type === 'tv') { args[2] = Number(season); args[3] = Number(episode); }
    var deadline = Date.now() + 18500;
    var active = engines.filter(function(engine) { return available(engine, args); });
    var results = active.map(function() { return []; });
    return new Promise(function(resolve) {
      var done = false, primaryDone = false, alternateStarted = false, alternateDone = false;
      var timers = [];
      function finish() {
        if (done) return; done = true;
        timers.forEach(clearTimeout);
        resolve(combine(results));
      }
      function attempt(index, ms, next) {
        if (done || Date.now() >= deadline) { next(); return; }
        var settled = false;
        var timer = setTimeout(function() { settle([]); }, Math.min(ms, deadline - Date.now())); timers.push(timer);
        function settle(rows) {
          if (settled || done) return; settled = true; clearTimeout(timer);
          results[index] = Array.isArray(rows) ? rows : [];
          next();
        }
        Promise.resolve().then(function() { return active[index].provider.getStreams.apply(active[index].provider, args); }).then(settle, function() { settle([]); });
      }
      function alternate(index) {
        if (done) return;
        if (index >= active.length) { alternateDone = true; if (primaryDone) finish(); return; }
        attempt(index, 6000, function() {
          if (combine([results[index]]).length) { alternateDone = true; if (primaryDone) finish(); }
          else alternate(index + 1);
        });
      }
      function startAlternate() {
        if (alternateStarted || done) return; alternateStarted = true; alternate(1);
      }
      if (!active.length) { finish(); return; }
      timers.push(setTimeout(finish, 18500));
      // A fast successful primary starts no duplicate engine. A slow or failed one unlocks the fallback.
      timers.push(setTimeout(startAlternate, 5000));
      attempt(0, 18500, function() {
        primaryDone = true;
        if (combine([results[0]]).length) { finish(); return; }
        startAlternate();
        if (alternateDone) finish();
      });
    });
  };
  // Preserve primary settings and add missing alternate controls/options under the same provider ID.
  if (engines.some(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; })) {
    merged.onSettings = function() {
      var args = arguments;
      return Promise.all(engines.filter(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; }).map(function(engine) {
        return new Promise(function(resolve) {
          var timer = setTimeout(function() { resolve([]); }, 1500);
          Promise.resolve().then(function() { return engine.provider.onSettings.apply(engine.provider, args); }).then(function(value) { clearTimeout(timer); resolve(value); }, function() { clearTimeout(timer); resolve([]); });
        });
      })).then(function(values) {
        if (values.length && !Array.isArray(values[0])) return values[0];
        var out = [], keys = Object.create(null), headers = Object.create(null);
        values.forEach(function(rows) {
          if (!Array.isArray(rows)) return;
          rows.forEach(function(setting) {
            if (!setting || typeof setting !== 'object') return;
            if (!setting.key) {
              var identity = key(setting); if (!headers[identity]) { headers[identity] = true; out.push(setting); } return;
            }
            var existing = keys[setting.key];
            if (!existing) { existing = Object.assign({}, setting); if (Array.isArray(setting.options)) existing.options = setting.options.slice(); keys[setting.key] = existing; out.push(existing); return; }
            if (existing.type === setting.type && Array.isArray(existing.options) && Array.isArray(setting.options)) {
              setting.options.forEach(function(option) { if (!existing.options.some(function(current) { return current.value === option.value; })) existing.options.push(option); });
            }
          });
        });
        return out;
      });
    };
  }
  return merged;
}
function cloudbankMergedBudgetFetch(nativeFetch, deadline) {
  function bounded(run) {
    var remaining = Math.min(2200, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(new Error('Merged engine budget exhausted'));
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Merged engine request timeout')); }, remaining);
      Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
    });
  }
  return function(url, options) {
    return bounded(function() { return nativeFetch(url, options); }).then(function(response) {
      return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: response.headers,
        text: function() { return bounded(function() { return response.text(); }); },
        json: function() { return bounded(function() { return response.json(); }); },
        arrayBuffer: function() { return bounded(function() { return response.arrayBuffer(); }); } };
    });
  };
}
function cloudbankMergedMetadataFetch(nativeFetch) {
  return function(url, options) {
    var raw = typeof url === 'string' ? url : url && url.url;
    var match = typeof raw === 'string' && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || options && options.method && String(options.method).toUpperCase() !== 'GET' || typeof vueoSharedTmdb !== 'function') return nativeFetch(url, options);
    var context = typeof globalThis !== 'undefined' ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === 'string') { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    if (contextId && String(contextId) !== match[2]) return nativeFetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return nativeFetch(url, options).then(function(response) { if (!response.ok) throw new Error('TMDB HTTP ' + response.status); return response.json(); });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw, headers: { get: function(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); } };
    });
  };
}
/* CLOUDBANK_VERSION_MERGE_ADAPTER_END */

var cloudbankMergedEngines = [{ id: "kurage", enabled: true, disabledPlatforms: [], provider: module.exports }];
cloudbankMergedEngines.push({ id: "kurage-v2", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:kurage-v2 */
/**
 * kurage - Built from src/kurage/
 * Generated: 2026-06-02T14:17:12.167Z
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/kurage/constants.js
var KURAGE_BASE = "https://kurage.live";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var ANILIST_URL = "https://graphql.anilist.co";
var ARM_BASE = "https://arm.haglund.dev/api/v2";
var CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": KURAGE_BASE,
  "Referer": KURAGE_BASE + "/"
};

// src/kurage/utils.js
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const response = yield fetch(url, __spreadProps(__spreadValues({}, options), {
      headers: __spreadValues(__spreadValues({}, DEFAULT_HEADERS), options.headers || {})
    }));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return yield response.text();
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const text = yield fetchText(url, options);
    return JSON.parse(text);
  });
}
function getSyncInfo(id, mediaType, season, episode) {
  return __async(this, null, function* () {
    const getCinemetaInfo = (imdbId2) => __async(this, null, function* () {
      const type = mediaType === "movie" ? "movie" : "series";
      const url = `${CINEMETA_URL}/${type}/${imdbId2}.json`;
      try {
        const data = yield fetchJson(url);
        const meta = data.meta;
        if (!meta)
          throw new Error("No Cinemata metadata");
        if (mediaType === "movie")
          return { date: meta.released ? meta.released.split("T")[0] : null, title: meta.name, dayIndex: 1 };
        const videos = meta.videos || [];
        const target = videos.find((v) => v.season == season && v.episode == episode);
        if (!target || !target.released)
          return { date: null, title: null, dayIndex: 1 };
        const targetDate = target.released.split("T")[0];
        const dayIndex = videos.filter((v) => v.season == season && v.released && v.released.split("T")[0] === targetDate && parseInt(v.episode) < parseInt(episode)).length + 1;
        return { date: targetDate, title: target.name || null, dayIndex };
      } catch (e) {
        return { date: null, title: null, dayIndex: 1 };
      }
    });
    const tmdbBase = `https://api.themoviedb.org/3/${mediaType === "movie" ? "movie" : "tv"}/${id}`;
    const [details, base] = yield Promise.all([
      fetchJson(tmdbBase + (mediaType === "movie" ? "" : "/external_ids") + `?api_key=${TMDB_API_KEY}`),
      fetchJson(tmdbBase + `?api_key=${TMDB_API_KEY}`)
    ]);
    let imdbId = details.imdb_id || null;
    const title = base.name || base.title || null;
    if (!imdbId) {
      try {
        const armData = yield fetchJson(`${ARM_BASE}/themoviedb?id=${id}`);
        imdbId = Array.isArray(armData) && armData.length > 0 ? armData[0].imdb : null;
      } catch (e) {
      }
    }
    if (!imdbId)
      throw new Error(`No IMDb ID found for TMDB ${id}`);
    const cMeta = yield getCinemetaInfo(imdbId);
    let finalDate = cMeta.date;
    if (mediaType === "movie" && base.release_date)
      finalDate = base.release_date;
    if (!finalDate)
      throw new Error(`Could not find release date for ID ${imdbId}`);
    return {
      imdbId,
      tmdbId: id,
      releaseDate: finalDate,
      title,
      episodeTitle: cMeta.title,
      dayIndex: cMeta.dayIndex,
      episode
    };
  });
}
function resolveAnilistId(syncInfo) {
  return __async(this, null, function* () {
    var _a, _b;
    const { releaseDate, title, episode, episodeTitle, dayIndex } = syncInfo;
    if (!releaseDate || !/^\d{4}-\d{2}-\d{2}/.test(releaseDate))
      return null;
    const query = "query($search:String){Page(perPage:20){media(search:$search,type:ANIME){id type format title{romaji english}startDate{year month day}endDate{year month day}episodes streamingEpisodes{title}}}}";
    try {
      const json = yield fetchJson(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { search: title } })
      });
      const candidates = ((_b = (_a = json.data) == null ? void 0 : _a.Page) == null ? void 0 : _b.media) || [];
      if (candidates.length === 0)
        return null;
      const targetDate = new Date(releaseDate);
      for (const anime of candidates) {
        const s = anime.startDate;
        const startStr = s.year && s.month && s.day ? `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}` : null;
        if (!startStr)
          continue;
        const startDate = new Date(startStr);
        const diffDays = Math.ceil(Math.abs(targetDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
        let isMatch = false;
        if (anime.format === "MOVIE" || anime.format === "SPECIAL" || anime.episodes === 1) {
          if (diffDays <= 2)
            isMatch = true;
        } else {
          const startLimit = new Date(startDate);
          startLimit.setDate(startLimit.getDate() - 2);
          if (targetDate >= startLimit) {
            if (anime.endDate && anime.endDate.year) {
              const endDate = new Date(anime.endDate.year, (anime.endDate.month || 12) - 1, anime.endDate.day || 31);
              endDate.setDate(endDate.getDate() + 2);
              if (targetDate <= endDate)
                isMatch = true;
            } else {
              isMatch = true;
            }
          }
        }
        if (isMatch) {
          const isTV = anime.format !== "MOVIE" && anime.format !== "SPECIAL" && anime.episodes !== 1;
          let episodeNum = isTV && episode ? episode : dayIndex || 1;
          const episodes = anime.streamingEpisodes || [];
          if (episodes.length > 1 && episodeTitle) {
            const cleanTarget = episodeTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
            for (let j = 0; j < episodes.length; j++) {
              const cleanAl = (episodes[j].title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              if (cleanAl && (cleanAl.indexOf(cleanTarget) !== -1 || cleanTarget.indexOf(cleanAl) !== -1)) {
                episodeNum = j + 1;
                break;
              }
            }
          }
          return { alId: anime.id, episode: episodeNum };
        }
      }
    } catch (e) {
    }
    return null;
  });
}

// src/kurage/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const syncInfo = yield getSyncInfo(tmdbId, mediaType, season, episode);
      const resolved = yield resolveAnilistId(syncInfo);
      if (!resolved || !resolved.alId) {
        console.log(`[Kurage] Could not resolve AniList ID for TMDB ${tmdbId}`);
        return [];
      }
      const { alId, episode: alEp } = resolved;
      console.log(`[Kurage] Resolved to AniList ID: ${alId}, Episode: ${alEp}`);
      const input = {
        "0": { "json": { "id": alId } },
        "1": { "json": { "animeId": alId, "episode": alEp, "language": "sub" } },
        "2": { "json": { "animeId": alId, "episode": alEp, "language": "dub" } }
      };
      const url = `${KURAGE_BASE}/api/trpc/catalog.anilistInfo,episodes.source,episodes.source?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
      const data = yield fetchJson(url, {
        headers: {
          "trpc-accept": "application/json",
          "x-trpc-source": "nextjs-react"
        }
      });
      const allStreams = [];
      data.forEach((r) => {
        var _a, _b, _c;
        const servers = ((_c = (_b = (_a = r.result) == null ? void 0 : _a.data) == null ? void 0 : _b.json) == null ? void 0 : _c.servers) || [];
        servers.forEach((server) => {
          const url2 = server.url.startsWith("/") ? `${KURAGE_BASE}${server.url}` : server.url;
          let extraHeaders = {};
          try {
            const urlObj = new URL(url2);
            const headersParam = urlObj.searchParams.get("headers");
            if (headersParam) {
              extraHeaders = JSON.parse(atob(headersParam));
            }
          } catch (e) {
          }
          const lang = (server.language || "sub").toUpperCase();
          allStreams.push({
            name: `[${lang}] Kurage - ${server.label}`,
            title: `${syncInfo.title} - ${alEp}`,
            url: url2,
            quality: "Auto",
            headers: __spreadValues(__spreadValues({}, DEFAULT_HEADERS), extraHeaders),
            provider: "kurage",
            type: server.sourceType || "mp4"
          });
        });
      });
      return allStreams;
    } catch (e) {
      console.error(`[Kurage] Error: ${e.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_MERGED_ENGINE_END:kurage-v2 */
  })(embedded, embedded.exports, portableRequire, cloudbankMergedBudgetFetch(cloudbankMergedMetadataFetch(fetch), deadline), typeof globalThis !== "undefined" ? globalThis : global);
  return Object.assign({}, embedded.exports);
  }
  var settingsProvider = createEngine(Date.now() + 6000);
  return Object.assign({}, settingsProvider, { getStreams: function() {
    // A fresh request scope prevents an expired scan from borrowing a later scan's deadline.
    var engine = createEngine(Date.now() + 6000);
    return engine.getStreams.apply(engine, arguments);
  } });
})() });
module.exports = cloudbankVersionMerge(cloudbankMergedEngines, "kurage");
if (typeof globalThis !== "undefined") { globalThis.getStreams = module.exports.getStreams; if (module.exports.onSettings) globalThis.onSettings = module.exports.onSettings; }

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
module.exports = cloudbankDisplayInstall(module.exports, "Kurage", "kurage");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
