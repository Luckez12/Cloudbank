// Imported provider: vidfast; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x2f4cb9=_0x42d0;(function(_0xd71400,_0x4ebb4c){const _0x1c797e={_0x306088:0x134,_0x2e05ee:0x12d,_0xed414b:0x121,_0x3d0edc:0x11e,_0x75aedf:0x140},_0x46f2f5=_0x42d0,_0x4990bf=_0xd71400();while(!![]){try{const _0x3c5c7d=parseInt(_0x46f2f5(0x116))/0x1*(-parseInt(_0x46f2f5(0x142))/0x2)+-parseInt(_0x46f2f5(_0x1c797e._0x306088))/0x3*(-parseInt(_0x46f2f5(0x13c))/0x4)+-parseInt(_0x46f2f5(_0x1c797e._0x2e05ee))/0x5*(parseInt(_0x46f2f5(0x122))/0x6)+-parseInt(_0x46f2f5(0xfe))/0x7+-parseInt(_0x46f2f5(_0x1c797e._0xed414b))/0x8*(parseInt(_0x46f2f5(0x10b))/0x9)+parseInt(_0x46f2f5(_0x1c797e._0x3d0edc))/0xa+parseInt(_0x46f2f5(_0x1c797e._0x75aedf))/0xb;if(_0x3c5c7d===_0x4ebb4c)break;else _0x4990bf['push'](_0x4990bf['shift']());}catch(_0x37fdc9){_0x4990bf['push'](_0x4990bf['shift']());}}}(_0x55f9,0x2bca0));var __defProp=Object[_0x2f4cb9(0x100)],__defProps=Object[_0x2f4cb9(0x136)],__getOwnPropDescs=Object[_0x2f4cb9(0x106)],__getOwnPropSymbols=Object[_0x2f4cb9(0x104)],__hasOwnProp=Object['prototype'][_0x2f4cb9(0x127)],__propIsEnum=Object[_0x2f4cb9(0x132)]['propertyIsEnumerable'],__defNormalProp=(_0x77a907,_0x2bdc2d,_0x5dd5e3)=>_0x2bdc2d in _0x77a907?__defProp(_0x77a907,_0x2bdc2d,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x5dd5e3}):_0x77a907[_0x2bdc2d]=_0x5dd5e3,__spreadValues=(_0x27347d,_0x3f6085)=>{const _0x17aaaf={_0x4246bc:0xfa},_0x1d0132=_0x2f4cb9;for(var _0x5dc583 in _0x3f6085||(_0x3f6085={}))if(__hasOwnProp[_0x1d0132(_0x17aaaf._0x4246bc)](_0x3f6085,_0x5dc583))__defNormalProp(_0x27347d,_0x5dc583,_0x3f6085[_0x5dc583]);if(__getOwnPropSymbols)for(var _0x5dc583 of __getOwnPropSymbols(_0x3f6085)){if(__propIsEnum[_0x1d0132(0xfa)](_0x3f6085,_0x5dc583))__defNormalProp(_0x27347d,_0x5dc583,_0x3f6085[_0x5dc583]);}return _0x27347d;},__spreadProps=(_0x3f444a,_0x4e8f50)=>__defProps(_0x3f444a,__getOwnPropDescs(_0x4e8f50)),__async=(_0x1d9281,_0x3ddae7,_0x393a24)=>{const _0x49342e={_0x53cc1c:0x130};return new Promise((_0x1bb2b2,_0xd7a452)=>{const _0x134bbe=_0x42d0;var _0x4d6dd6=_0x3ee842=>{try{_0x288ab2(_0x393a24['next'](_0x3ee842));}catch(_0x4d727e){_0xd7a452(_0x4d727e);}},_0x48bb8c=_0x1fc61e=>{try{_0x288ab2(_0x393a24['throw'](_0x1fc61e));}catch(_0x4e61b0){_0xd7a452(_0x4e61b0);}},_0x288ab2=_0x295b73=>_0x295b73[_0x134bbe(0x120)]?_0x1bb2b2(_0x295b73[_0x134bbe(0xff)]):Promise['resolve'](_0x295b73['value'])['then'](_0x4d6dd6,_0x48bb8c);_0x288ab2((_0x393a24=_0x393a24['apply'](_0x1d9281,_0x3ddae7))[_0x134bbe(_0x49342e._0x53cc1c)]());});},VIDFAST_API=_0x2f4cb9(0xf6),DECRYPT_API=_0x2f4cb9(0x137),HEADERS={'User-Agent':_0x2f4cb9(0x123),'Referer':'https://vidfast.vc/','X-Requested-With':_0x2f4cb9(0x126)};function generateM3u8(_0x4f3e7f){const _0x51424a={_0x114aac:0x131,_0x34737d:0x112,_0x247f07:0x101,_0x69a086:0xf7,_0x1cdd11:0x10e,_0x3d5057:0x105};return __async(this,arguments,function*(_0x616417,_0x35cabd={}){const _0x45961d=_0x42d0;try{console['log'](_0x45961d(0x13a)+_0x616417);const _0x2ff104=yield fetch(_0x616417,{'headers':_0x35cabd}),_0x5bfcd9=yield _0x2ff104[_0x45961d(0xf8)](),_0x5864cc=_0x616417[_0x45961d(0x10d)](0x0,_0x616417[_0x45961d(_0x51424a._0x114aac)]('/'))+'/',_0x197bd0=[],_0x11fdb1=/#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g;let _0x215013;while((_0x215013=_0x11fdb1[_0x45961d(_0x51424a._0x34737d)](_0x5bfcd9))!==null){const _0x256ad2=parseInt(_0x215013[0x1][_0x45961d(0x119)]('x')[0x1]);if(_0x256ad2<0x2d0)continue;const _0x39ba86=_0x256ad2+'p';let _0x31a7ef=_0x215013[0x2][_0x45961d(_0x51424a._0x247f07)]();if(!_0x31a7ef['startsWith'](_0x45961d(0x125))){if(_0x31a7ef[_0x45961d(0x115)]('/')){const _0x469059=new URL(_0x616417)['origin'];_0x31a7ef=_0x469059+_0x31a7ef;}else _0x31a7ef=_0x5864cc+_0x31a7ef;}_0x197bd0[_0x45961d(_0x51424a._0x69a086)]({'quality':_0x39ba86,'url':_0x31a7ef});}return _0x197bd0;}catch(_0x3ee653){return console[_0x45961d(_0x51424a._0x1cdd11)](_0x45961d(_0x51424a._0x3d5057),_0x3ee653),[];}});}function _0x42d0(_0x1661dd,_0x1d2f75){_0x1661dd=_0x1661dd-0xf3;const _0x55f91a=_0x55f9();let _0x42d09c=_0x55f91a[_0x1661dd];if(_0x42d0['NrLpIf']===undefined){var _0x213f45=function(_0x3996fc){const _0x6d1dc2='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x77a907='',_0x2bdc2d='';for(let _0x5dd5e3=0x0,_0x27347d,_0x3f6085,_0x5dc583=0x0;_0x3f6085=_0x3996fc['charAt'](_0x5dc583++);~_0x3f6085&&(_0x27347d=_0x5dd5e3%0x4?_0x27347d*0x40+_0x3f6085:_0x3f6085,_0x5dd5e3++%0x4)?_0x77a907+=String['fromCharCode'](0xff&_0x27347d>>(-0x2*_0x5dd5e3&0x6)):0x0){_0x3f6085=_0x6d1dc2['indexOf'](_0x3f6085);}for(let _0x3f444a=0x0,_0x4e8f50=_0x77a907['length'];_0x3f444a<_0x4e8f50;_0x3f444a++){_0x2bdc2d+='%'+('00'+_0x77a907['charCodeAt'](_0x3f444a)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x2bdc2d);};_0x42d0['iAwYUj']=_0x213f45,_0x42d0['sXTntF']={},_0x42d0['NrLpIf']=!![];}const _0x34c297=_0x55f91a[0x0],_0x40ff0c=_0x1661dd+_0x34c297,_0xfc6c5d=_0x42d0['sXTntF'][_0x40ff0c];return!_0xfc6c5d?(_0x42d09c=_0x42d0['iAwYUj'](_0x42d09c),_0x42d0['sXTntF'][_0x40ff0c]=_0x42d09c):_0x42d09c=_0xfc6c5d,_0x42d09c;}function _0x55f9(){const _0x32f96d=['CxvHBgL0Eq','yxv0BW','lM0ZDtG','4Ocl4Ocl4Ocl','mJu2mdy0mgP0vg1KCG','ue9tva','zg9Uzq','odeWnJy0A0Toy0Li','nKnLDe9TBW','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmI4WlJaUmcbtywzHCMKVntm3lJm2','nZiW','Ahr0Ca','we1mshr0CfjLCxvLC3q','AgfZt3DUuhjVCgvYDhK','qwrHChrPDMu','l2rLyY12AwrMyxn0','DwHK','zM9YrwfJAa','4Ocl4Ocl4Ocl4Ocl','mtC4odG5nu9dqvvcCG','ywXS','mta4ma','BMv4Da','BgfZDeLUzgv4t2y','ChjVDg90ExbL','C3rYAw5NAwz5','mZy2wMrTqMnL','ANnVBG','zgvMAw5LuhjVCgvYDgLLCW','Ahr0Chm6lY9LBMmTzgvJlMfWCc9HCgK','AxnbCNjHEq','Bg9N','w1zPzezHC3rDifbHCNnPBMCGBwfZDgvYig0ZDtG6ia','Dg9mB3DLCKnHC2u','nJq0BgXZv2PJ','BgvUz3rO','CMvZDwX0','w1zPzezHC3rDifjLDhvYBMLUzYa','ntC3ntCWngPdA1PRsW','lM1RDG','mtq2nJuYqu5fBhHJ','Aw5JBhvKzxm','y2f0y2G','Dg9Rzw4','Ahr0Chm6lY92AwrMyxn0lNzJ','ChvZAa','Dgv4Da','vxnLCI1bz2vUDa','y2fSBa','Bwf0y2G','BMfTzq','w1zPzezHC3rDievYCM9YoIa','nJiYoda0quzKAfPL','DMfSDwu','zgvMAw5LuhjVCgvYDhK','DhjPBq','w1zPzezHC3rDieXVywrPBMCGCgfNztOG','zxHWB3j0CW','z2v0t3DUuhjVCgvYDhLtEw1IB2XZ','w1zPzezHC3rDievYCM9YihbHCNnPBMCGttnvocWGCMv0DxjUAw5NigvTChr5lG','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9YCW','ihnLCNzLCIHZkq','w1zPzezHC3rDieLUy29TCgXLDguGzgvJCNLWDgLVBIbJB25MAwC','w1zPzezHC3rDie5VigvUy29KzwqGDg9Rzw4GzM91BMqGAw4GCgfNzq','C2vYDMvYCW','ouzsrgfoBa','rgvMyxvSDa','C3vIC3rYAw5N','D2fYBG','w1zPzezHC3rDia','C3rYzwfT','mJe2ma','zxHLyW','DxjS','qxv0BW','C3rHCNrZv2L0Aa','muTvvg1cDq','ndGW','w1zPzezHC3rDiezVDw5Kia','C3bSAxq'];_0x55f9=function(){return _0x32f96d;};return _0x55f9();}function getStreams(_0x202f3c,_0x218d90,_0x2bf00e,_0x516fb1){const _0x457b27={_0x5e9447:0xfb,_0x3b0064:0x109,_0x4482c3:0x13e,_0x43e6f7:0xf5,_0x4047c1:0x10a,_0x260e92:0x11f,_0x1a9e5d:0xf9,_0x5bf054:0x135,_0x3727cb:0x12e,_0x37c987:0x13f,_0x349df9:0xfd};return __async(this,null,function*(){const _0x2f86f5=_0x42d0;console['log']('[VidFast]\x20Fetching\x20streams\x20for\x20'+_0x218d90+'\x20'+_0x202f3c);try{const _0x47a21c=_0x218d90!=='tv'&&_0x2bf00e==null,_0x455a8e=_0x47a21c?VIDFAST_API+'/movie/'+_0x202f3c+'/':VIDFAST_API+'/tv/'+_0x202f3c+'/'+_0x2bf00e+'/'+_0x516fb1+'/';console['log'](_0x2f86f5(0x102)+_0x455a8e);const _0x46f5d8=yield fetch(_0x455a8e,{'headers':HEADERS}),_0x5962ee=yield _0x46f5d8[_0x2f86f5(0xf8)](),_0x57fc58=_0x5962ee[_0x2f86f5(_0x457b27._0x5e9447)](/\\"en\\":\\"(.*?)\\"/);if(!_0x57fc58||!_0x57fc58[0x1])return console['log'](_0x2f86f5(_0x457b27._0x3b0064)),[];const _0x42ec55=_0x57fc58[0x1],_0x4c6500=DECRYPT_API+'/enc-vidfast?text='+_0x42ec55+'&version=1',_0x5a839b=yield fetch(_0x4c6500),_0x4d369c=yield _0x5a839b['json'](),_0x1607a3=_0x4d369c[_0x2f86f5(_0x457b27._0x4482c3)];if(!_0x1607a3||!_0x1607a3['servers']||!_0x1607a3['stream']||!_0x1607a3[_0x2f86f5(_0x457b27._0x43e6f7)])return console[_0x2f86f5(0x139)](_0x2f86f5(0x108)),[];const _0x5bca7c=_0x1607a3[_0x2f86f5(_0x457b27._0x4047c1)],_0x24a2a9=_0x1607a3[_0x2f86f5(0x110)],_0x24a0a7=_0x1607a3[_0x2f86f5(0xf5)],_0x23b67c=__spreadProps(__spreadValues({},HEADERS),{'X-CSRF-Token':_0x24a0a7}),_0x4d0800=yield fetch(_0x5bca7c,{'method':'POST','headers':_0x23b67c}),_0x40e829=yield _0x4d0800['text'](),_0x2008fc=yield fetch(DECRYPT_API+'/dec-vidfast',{'method':_0x2f86f5(_0x457b27._0x260e92),'headers':{'Content-Type':'application/json','User-Agent':HEADERS[_0x2f86f5(_0x457b27._0x1a9e5d)]},'body':JSON['stringify']({'text':_0x40e829,'version':'1'})}),_0x4e54cb=yield _0x2008fc[_0x2f86f5(_0x457b27._0x5bf054)](),_0x3300c1=_0x4e54cb['result'];if(!Array[_0x2f86f5(0x138)](_0x3300c1)||_0x3300c1[_0x2f86f5(0x13d)]===0x0)return console['log']('[VidFast]\x20No\x20servers\x20in\x20decrypted\x20response'),[];console['log'](_0x2f86f5(0x118)+_0x3300c1['length']+_0x2f86f5(0x107));const _0x39e9a8=_0x3300c1['map'](_0xd7aa69=>fetchServerStream(_0xd7aa69,_0x24a2a9,_0x23b67c)[_0x2f86f5(0xf4)](()=>[])),_0x4a6cea=yield Promise[_0x2f86f5(_0x457b27._0x3727cb)](_0x39e9a8),_0x3ef87e=[];for(const _0x1a377f of _0x4a6cea){_0x1a377f['length']>0x0&&_0x3ef87e[_0x2f86f5(0xf7)](..._0x1a377f);}return console[_0x2f86f5(0x139)](_0x2f86f5(_0x457b27._0x37c987)+_0x3ef87e['length']+'\x20streams'),_0x3ef87e['map'](_0x3ef4e7=>__spreadProps(__spreadValues({},_0x3ef4e7),{'quality':getSortedQuality(_0x3ef4e7[_0x2f86f5(0x11a)])}));}catch(_0xd62aa4){return console['error'](_0x2f86f5(_0x457b27._0x349df9)+_0xd62aa4['message']),[];}});}function fetchServerStream(_0x823982,_0x22cd96,_0x16d7b4){const _0x4c3507={_0x5aeaac:0x10c,_0xab03d0:0x11f,_0x3f78f8:0x129,_0x466b68:0x135,_0x40f323:0x113,_0x36bd09:0xf3,_0x39be89:0xf3,_0x3824e7:0x11c,_0x583597:0x12b};return __async(this,null,function*(){const _0x5e8c03=_0x42d0;try{const _0x483542=_0x823982['data'];if(!_0x483542)return[];const _0x1e67f2=_0x823982[_0x5e8c03(0xfc)]||_0x5e8c03(_0x4c3507._0x5aeaac),_0x36c2bb=_0x823982['description']||'',_0x47d592=_0x22cd96+'/'+_0x483542,_0x45e706=yield fetch(_0x47d592,{'method':_0x5e8c03(_0x4c3507._0xab03d0),'headers':_0x16d7b4}),_0x1acbe4=yield _0x45e706['text']();if(!_0x1acbe4||_0x1acbe4[_0x5e8c03(0x101)]()==='')return[];const _0x523ba7=yield fetch(DECRYPT_API+_0x5e8c03(_0x4c3507._0x3f78f8),{'method':_0x5e8c03(0x11f),'headers':{'Content-Type':'application/json','User-Agent':HEADERS[_0x5e8c03(0xf9)]},'body':JSON[_0x5e8c03(0x133)]({'text':_0x1acbe4,'version':'1'})}),_0x62df33=yield _0x523ba7[_0x5e8c03(_0x4c3507._0x466b68)](),_0x3184de=_0x62df33['result'];if(!_0x3184de||!_0x3184de[_0x5e8c03(_0x4c3507._0x40f323)])return[];const _0x572747=_0x3184de[_0x5e8c03(0x113)],_0x3008db=_0x3184de['4kAvailable']===!![]||_0x36c2bb&&_0x36c2bb[_0x5e8c03(0x13b)]()[_0x5e8c03(_0x4c3507._0x36bd09)]('4k'),_0x5a279e=_0x3008db?'2160p':'1080p',_0x599ab6=_0x572747[_0x5e8c03(_0x4c3507._0x39be89)](_0x5e8c03(_0x4c3507._0x3824e7)),_0x413914=[{'name':'Vidfast\x20['+_0x1e67f2+']','title':_0x599ab6?'Auto':_0x36c2bb||_0x5a279e,'url':_0x572747,'quality':_0x599ab6?'Auto':_0x5a279e,'type':_0x599ab6?'m3u8':_0x572747['includes']('.mp4')||_0x572747[_0x5e8c03(0xf3)](_0x5e8c03(0x141))?'video':null,'headers':_0x16d7b4,'provider':'vidfast'}];if(_0x599ab6)try{const _0x12da89=yield generateM3u8(_0x572747,_0x16d7b4);_0x12da89[_0x5e8c03(_0x4c3507._0x583597)](_0xccafd5=>{const _0x9cbb25=_0x5e8c03;_0x413914['push']({'name':'Vidfast\x20['+_0x1e67f2+']','title':_0xccafd5[_0x9cbb25(0x11a)],'url':_0xccafd5[_0x9cbb25(0x113)],'quality':_0xccafd5[_0x9cbb25(0x11a)],'type':'m3u8','headers':_0x16d7b4,'provider':'vidfast'});});}catch(_0x41b10f){}return console['log'](_0x5e8c03(0x10f)+_0x1e67f2+':\x20found\x20stream\x20('+(_0x599ab6?_0x5e8c03(0x128):_0x5a279e)+')'),_0x413914['map'](_0x32671a=>__spreadProps(__spreadValues({},_0x32671a),{'quality':getSortedQuality(_0x32671a['quality'])}));}catch(_0x11cdd5){return[];}});}function getSortedQuality(_0x1fe144){const _0x496587={_0x49b33c:0x11b,_0x28e698:0x114,_0x5e5ac4:0x12a,_0x5abaf4:0x12f,_0x191847:0xf3,_0x1a0d0c:0xf3,_0x51a3c9:0x11d,_0x214893:0xf3,_0x5f1ee5:0x117},_0x23b4ff=_0x2f4cb9;if(!_0x1fe144)return'Auto';const _0x4cc223=_0x1fe144[_0x23b4ff(0x13b)]();if(_0x4cc223[_0x23b4ff(0xf3)](_0x23b4ff(_0x496587._0x49b33c)))return _0x23b4ff(_0x496587._0x28e698);if(_0x4cc223[_0x23b4ff(0xf3)](_0x23b4ff(0x111))||_0x4cc223['includes']('4k')||_0x4cc223[_0x23b4ff(0xf3)](_0x23b4ff(_0x496587._0x5e5ac4)))return'​'+_0x1fe144;if(_0x4cc223['includes'](_0x23b4ff(_0x496587._0x5abaf4))||_0x4cc223[_0x23b4ff(_0x496587._0x191847)]('fhd'))return'​​'+_0x1fe144;if(_0x4cc223['includes'](_0x23b4ff(0x124))||_0x4cc223[_0x23b4ff(_0x496587._0x1a0d0c)]('hd'))return _0x23b4ff(_0x496587._0x51a3c9)+_0x1fe144;if(_0x4cc223[_0x23b4ff(_0x496587._0x214893)](_0x23b4ff(_0x496587._0x5f1ee5))||_0x4cc223[_0x23b4ff(_0x496587._0x191847)]('sd'))return'​​​​'+_0x1fe144;if(_0x4cc223['includes']('360'))return'​​​​​'+_0x1fe144;return _0x23b4ff(0x12c)+_0x1fe144;}module[_0x2f4cb9(0x103)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidfast", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VidFast", "vidfast");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
