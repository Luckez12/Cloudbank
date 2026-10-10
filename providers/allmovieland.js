// Imported provider: allmovieland; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x585d93=_0x1535;(function(_0x5bc967,_0x4704d9){const _0x240f7e=_0x1535,_0x5dfe66=_0x5bc967();while(!![]){try{const _0x34ac68=-parseInt(_0x240f7e(0xab))/0x1*(-parseInt(_0x240f7e(0xd0))/0x2)+parseInt(_0x240f7e(0xc4))/0x3*(parseInt(_0x240f7e(0xaa))/0x4)+parseInt(_0x240f7e(0x98))/0x5+parseInt(_0x240f7e(0xdb))/0x6+-parseInt(_0x240f7e(0x87))/0x7+-parseInt(_0x240f7e(0xe6))/0x8*(-parseInt(_0x240f7e(0xaf))/0x9)+-parseInt(_0x240f7e(0x8f))/0xa*(parseInt(_0x240f7e(0xa2))/0xb);if(_0x34ac68===_0x4704d9)break;else _0x5dfe66['push'](_0x5dfe66['shift']());}catch(_0x122c06){_0x5dfe66['push'](_0x5dfe66['shift']());}}}(_0x1ca4,0xda8b3));var __create=Object[_0x585d93(0x8d)],__defProp=Object[_0x585d93(0x96)],__defProps=Object['defineProperties'],__getOwnPropDesc=Object[_0x585d93(0xb1)],__getOwnPropDescs=Object[_0x585d93(0xcf)],__getOwnPropNames=Object[_0x585d93(0xcb)],__getOwnPropSymbols=Object[_0x585d93(0xa6)],__getProtoOf=Object[_0x585d93(0xac)],__hasOwnProp=Object[_0x585d93(0xb0)][_0x585d93(0x88)],__propIsEnum=Object['prototype'][_0x585d93(0x93)],__defNormalProp=(_0x2272e3,_0xab69db,_0x2d1cea)=>_0xab69db in _0x2272e3?__defProp(_0x2272e3,_0xab69db,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x2d1cea}):_0x2272e3[_0xab69db]=_0x2d1cea,__spreadValues=(_0x4bc988,_0x51d5a0)=>{const _0x535d00=_0x585d93;for(var _0x121b6c in _0x51d5a0||(_0x51d5a0={}))if(__hasOwnProp[_0x535d00(0xe7)](_0x51d5a0,_0x121b6c))__defNormalProp(_0x4bc988,_0x121b6c,_0x51d5a0[_0x121b6c]);if(__getOwnPropSymbols)for(var _0x121b6c of __getOwnPropSymbols(_0x51d5a0)){if(__propIsEnum[_0x535d00(0xe7)](_0x51d5a0,_0x121b6c))__defNormalProp(_0x4bc988,_0x121b6c,_0x51d5a0[_0x121b6c]);}return _0x4bc988;},__spreadProps=(_0x2408c2,_0x231be8)=>__defProps(_0x2408c2,__getOwnPropDescs(_0x231be8)),__copyProps=(_0x49facb,_0x5a8e9a,_0x4cb84b,_0x5de8ad)=>{const _0xee573a=_0x585d93;if(_0x5a8e9a&&typeof _0x5a8e9a===_0xee573a(0x9c)||typeof _0x5a8e9a===_0xee573a(0xc1)){for(let _0x549c2a of __getOwnPropNames(_0x5a8e9a))if(!__hasOwnProp['call'](_0x49facb,_0x549c2a)&&_0x549c2a!==_0x4cb84b)__defProp(_0x49facb,_0x549c2a,{'get':()=>_0x5a8e9a[_0x549c2a],'enumerable':!(_0x5de8ad=__getOwnPropDesc(_0x5a8e9a,_0x549c2a))||_0x5de8ad[_0xee573a(0xb5)]});}return _0x49facb;},__toESM=(_0x2bf915,_0x453623,_0x3b6817)=>(_0x3b6817=_0x2bf915!=null?__create(__getProtoOf(_0x2bf915)):{},__copyProps(_0x453623||!_0x2bf915||!_0x2bf915[_0x585d93(0xce)]?__defProp(_0x3b6817,_0x585d93(0xda),{'value':_0x2bf915,'enumerable':!![]}):_0x3b6817,_0x2bf915)),__async=(_0x3be590,_0x2163a4,_0x206f1d)=>{return new Promise((_0x21fad8,_0x177450)=>{const _0x24bbdc=_0x1535;var _0x59b2f7=_0x39c5f8=>{const _0x13220e=_0x1535;try{_0x24c22d(_0x206f1d[_0x13220e(0x91)](_0x39c5f8));}catch(_0x2e2a51){_0x177450(_0x2e2a51);}},_0x1c9322=_0x47bf87=>{const _0x1092ad=_0x1535;try{_0x24c22d(_0x206f1d[_0x1092ad(0xbb)](_0x47bf87));}catch(_0x2c4275){_0x177450(_0x2c4275);}},_0x24c22d=_0x1b6dbd=>_0x1b6dbd['done']?_0x21fad8(_0x1b6dbd['value']):Promise['resolve'](_0x1b6dbd[_0x24bbdc(0x8c)])['then'](_0x59b2f7,_0x1c9322);_0x24c22d((_0x206f1d=_0x206f1d['apply'](_0x3be590,_0x2163a4))[_0x24bbdc(0x91)]());});},import_cheerio_without_node_native=__toESM(require(_0x585d93(0xa0))),TMDB_API_KEY=_0x585d93(0xb3),TMDB_BASE_URL=_0x585d93(0xdc),MAIN_URL='https://allmovieland.you',HEADERS={'User-Agent':_0x585d93(0xd6),'Accept':_0x585d93(0xc8),'Accept-Language':_0x585d93(0xe4)};function _0x1ca4(){const _0x5e6a46=['l3bSyxLSAxn0lW','w0fSBe1VDMLLtgfUzf0GtM8GCdmGsLnptIbMB3vUzcbPBIbLBwjLzc4','r0vu','mta1odHiDwjszxy','ntqZody5AvfnrMXQ','z2v0uhjVDg90ExbLt2y','Dgv4Da','lNr4Da','ouHNvef0qW','ChjVDg90ExbL','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9Y','AgfZ','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','yM9KEsa+ihnJCMLWDa','zw51BwvYywjSzq','w0fSBe1VDMLLtgfUzf0Gq291BgqGBM90igzPBMqGCgXHEwvYigrVBwfPBIbVCIbjrc4','zxjYB3i','zxH0zxjUywXFAwrZ','vw5RBM93BG','BMfTzq','DgHYB3C','qwXStw92Awvmyw5Kic0G','Bg9Hza','Bwf0y2G','BwfW','Aw1KyL9Pza','zNvUy3rPB24','kd88pvWOkvTCzcHCxv0Rkd89xcKP','zxHWB3j0CW','mtuYneHLsxnoBq','C3bSAxq','iIaO','AhrTBa','Dgv4Dc9ODg1SlgfWCgXPy2f0Aw9Ul3HODg1Sk3HTBcXHChbSAwnHDgLVBI94BwW7Ct0WlJKSAw1Hz2uVyxzPzIXPBwfNzs93zwjWlcOVkJTXptaUoa','w0fSBe1VDMLLtgfUzf0Gve1eqIbjBMzVoIaI','zgL2lNrHyNnFx2nVBNrLBNqGC2nYAxb0','z2v0t3DUuhjVCgvYDhLoyw1LCW','qwXStw92Awvmyw5K','EwvHCG','x19LC01VzhvSzq','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9YCW','mKH5CfrqyG','BgvUz3rO','AhjLzG','zM9SzgvY','yxr0CG','C3rHCNrZv2L0Aa','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeZnY4WlJaUmcbtywzHCMKVntm3lJm2','zMLYC3rFywLYx2rHDgu','zMLUza','Bw92Awu','zgvMyxvSDa','otqXmZGZohPxDK9qsa','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmW','zMLSDgvY','zwfJAa','w0fSBe1VDMLLtgfUzf0GrMv0y2HPBMCGC3rYzwfTCYbMB3iGve1eqIbjrdOG','yxbWBgLJyxrPB24VANnVBG','zMLSzq','ysa+igGZ','l2LUzgv4lNbOCd9ZDg9YEt0','zw4TvvmSzw47Ct0WlJu','C2L6zq','mtK0nJq4ogXxuxfhzG','y2fSBa','Bg9N','ywXS','ywXSBw92AwvSyw5K','jMrVpxnLyxjJAczZDwjHy3rPB249C2vHCMnO','CMvWBgfJzq','nZG1mdm3nevMwfDkwa','AgfZt3DUuhjVCgvYDhK','CMvSzwfZzv9KyxrL','w0fSBe1VDMLLtgfUzf0GtM8GC3rYzwfTCYbMB3vUzcbMB3iGDgHLihjLCxvLC3rLzcbTzwrPys4','ChvZAa','DMfSDwu','y3jLyxrL','zxbPC29Kzq','mtm3nZa0mtboAwHxCMO','yxj0AwnSzs5ZAg9YDc1TAwq','BMv4Da','A2v5','ChjVCgvYDhLjC0vUDw1LCMfIBgu','w0fSBe1VDMLLtgfUzf0GrMfPBgvKihrVigv4DhjHy3qGC3rYzwfToIa','w0fSBe1VDMLLtgfUzf0Gu2vSzwn0zwq6ici','zgvMAw5LuhjVCgvYDhK','p2fWAv9RzxK9','ntm0otq1mfjkDMDvuW','Ahr0Ca','DhjPBq','tI9b','B2jQzwn0','DgL0Bgu','zxzLCNK','CgfYC2u','y2HLzxjPBY13AxrOB3v0lw5VzguTBMf0AxzL','vxnLCI1bz2vUDa','mJjTyvbbD0q','BgfZDa','BwvZC2fNzq','ue9tva','z2v0t3DUuhjVCgvYDhLtEw1IB2XZ'];_0x1ca4=function(){return _0x5e6a46;};return _0x1ca4();}function getTMDBDetails(_0x2aebb6,_0x12d1ab){return __async(this,null,function*(){const _0xc42d13=_0x1535;var _0x4b6787;const _0x88c99f=_0x12d1ab==='tv'?'tv':_0xc42d13(0xd9),_0x36c80f=TMDB_BASE_URL+'/'+_0x88c99f+'/'+_0x2aebb6+_0xc42d13(0x97)+TMDB_API_KEY+'&append_to_response=external_ids',_0x3f44a0=yield fetch(_0x36c80f,{'method':_0xc42d13(0xa9),'headers':{'Accept':_0xc42d13(0xe0),'User-Agent':'Mozilla/5.0'}});if(!_0x3f44a0['ok'])throw new Error('TMDB\x20API\x20error:\x20'+_0x3f44a0['status']);const _0x1c16a5=yield _0x3f44a0['json'](),_0x4fe47f=_0x12d1ab==='tv'?_0x1c16a5[_0xc42d13(0xba)]:_0x1c16a5['title'],_0x4b9608=_0x12d1ab==='tv'?_0x1c16a5[_0xc42d13(0xd7)]:_0x1c16a5[_0xc42d13(0x89)],_0x5d5561=_0x4b9608?parseInt(_0x4b9608[_0xc42d13(0xc5)]('-')[0x0]):null;return{'title':_0x4fe47f,'year':_0x5d5561,'imdbId':((_0x4b6787=_0x1c16a5[_0xc42d13(0xb8)])==null?void 0x0:_0x4b6787[_0xc42d13(0xc0)])||null,'data':_0x1c16a5};});}function normalizeTitle(_0x40dc60){const _0x27878f=_0x585d93;if(!_0x40dc60)return'';return _0x40dc60['toLowerCase']()[_0x27878f(0x86)](/\b(the|a|an)\b/g,'')[_0x27878f(0x86)](/[:\-_]/g,'\x20')[_0x27878f(0x86)](/\s+/g,'\x20')['replace'](/[^\w\s]/g,'')[_0x27878f(0x9a)]();}function calculateTitleSimilarity(_0x2700af,_0x2844df){const _0x4d1634=_0x585d93,_0x2754bb=normalizeTitle(_0x2700af),_0x2228a7=normalizeTitle(_0x2844df);if(_0x2754bb===_0x2228a7)return 0x1;const _0x316f42=_0x2754bb[_0x4d1634(0xc5)](/\s+/)[_0x4d1634(0xdd)](_0x52a881=>_0x52a881[_0x4d1634(0xd1)]>0x0),_0x2b902d=_0x2228a7['split'](/\s+/)[_0x4d1634(0xdd)](_0x5f008e=>_0x5f008e[_0x4d1634(0xd1)]>0x0);if(_0x316f42[_0x4d1634(0xd1)]===0x0||_0x2b902d[_0x4d1634(0xd1)]===0x0)return 0x0;const _0x1fcca6=new Set(_0x316f42),_0x2f4a0d=new Set(_0x2b902d),_0x3912f4=_0x316f42[_0x4d1634(0xdd)](_0x338654=>_0x2f4a0d[_0x4d1634(0xb2)](_0x338654)),_0x3232a5=new Set([..._0x316f42,..._0x2b902d]),_0x12e40d=_0x3912f4[_0x4d1634(0xd1)]/_0x3232a5[_0x4d1634(0xe5)],_0x114b72=_0x2b902d[_0x4d1634(0xdd)](_0x12bdf3=>!_0x1fcca6[_0x4d1634(0xb2)](_0x12bdf3))[_0x4d1634(0xd1)];let _0x1153bc=_0x12e40d-_0x114b72*0.05;return _0x316f42[_0x4d1634(0xd1)]>0x0&&_0x316f42[_0x4d1634(0x9e)](_0x451666=>_0x2f4a0d[_0x4d1634(0xb2)](_0x451666))&&(_0x1153bc+=0.2),_0x1153bc;}function findBestTitleMatch(_0x1a9474,_0x45cfa2){const _0x5af6a3=_0x585d93;if(!_0x45cfa2||_0x45cfa2['length']===0x0)return null;let _0x506ece=null,_0xddfc75=0x0;for(const _0x3f31e9 of _0x45cfa2){let _0x5f02cd=calculateTitleSimilarity(_0x1a9474['title'],_0x3f31e9[_0x5af6a3(0x9d)]);if(_0x1a9474[_0x5af6a3(0xcd)]&&_0x3f31e9[_0x5af6a3(0xcd)]){const _0x255d12=Math['abs'](_0x1a9474['year']-_0x3f31e9[_0x5af6a3(0xcd)]);if(_0x255d12===0x0)_0x5f02cd+=0.2;else{if(_0x255d12<=0x1)_0x5f02cd+=0.1;else{if(_0x255d12>0x5)_0x5f02cd-=0.3;}}}_0x5f02cd>_0xddfc75&&_0x5f02cd>0.3&&(_0xddfc75=_0x5f02cd,_0x506ece=_0x3f31e9);}return _0x506ece;}function _0x1535(_0x27e78a,_0xcd143){_0x27e78a=_0x27e78a-0x86;const _0x1ca48d=_0x1ca4();let _0x1535ac=_0x1ca48d[_0x27e78a];if(_0x1535['XSMvjz']===undefined){var _0x5b699d=function(_0x1fbf4e){const _0x24ca80='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x2272e3='',_0xab69db='';for(let _0x2d1cea=0x0,_0x4bc988,_0x51d5a0,_0x121b6c=0x0;_0x51d5a0=_0x1fbf4e['charAt'](_0x121b6c++);~_0x51d5a0&&(_0x4bc988=_0x2d1cea%0x4?_0x4bc988*0x40+_0x51d5a0:_0x51d5a0,_0x2d1cea++%0x4)?_0x2272e3+=String['fromCharCode'](0xff&_0x4bc988>>(-0x2*_0x2d1cea&0x6)):0x0){_0x51d5a0=_0x24ca80['indexOf'](_0x51d5a0);}for(let _0x2408c2=0x0,_0x231be8=_0x2272e3['length'];_0x2408c2<_0x231be8;_0x2408c2++){_0xab69db+='%'+('00'+_0x2272e3['charCodeAt'](_0x2408c2)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0xab69db);};_0x1535['UvLulp']=_0x5b699d,_0x1535['sqlSnP']={},_0x1535['XSMvjz']=!![];}const _0x1a041b=_0x1ca48d[0x0],_0x4159fb=_0x27e78a+_0x1a041b,_0x961c0=_0x1535['sqlSnP'][_0x4159fb];return!_0x961c0?(_0x1535ac=_0x1535['UvLulp'](_0x1535ac),_0x1535['sqlSnP'][_0x4159fb]=_0x1535ac):_0x1535ac=_0x961c0,_0x1535ac;}function getStreams(_0x557378,_0x5e7559=_0x585d93(0xd9),_0x2c24f0=null,_0xa15d0c=null){return __async(this,null,function*(){const _0x4b221f=_0x1535;console[_0x4b221f(0xe8)](_0x4b221f(0xdf)+_0x557378+',\x20Type:\x20'+_0x5e7559);try{const _0x4120bf=yield getTMDBDetails(_0x557378,_0x5e7559);console['log'](_0x4b221f(0xc9)+_0x4120bf[_0x4b221f(0x9d)]+'\x22\x20('+(_0x4120bf[_0x4b221f(0xcd)]||_0x4b221f(0x9b))+')');const _0x17e515=_0x4120bf[_0x4b221f(0x9d)],_0x4e358c=MAIN_URL+_0x4b221f(0xe3)+encodeURIComponent(_0x17e515)+_0x4b221f(0xeb),_0x59312e=yield fetch(_0x4e358c,{'headers':HEADERS}),_0x3908e7=yield _0x59312e[_0x4b221f(0xad)](),_0x54f259=import_cheerio_without_node_native[_0x4b221f(0xda)][_0x4b221f(0xbd)](_0x3908e7),_0x186d64=[];_0x54f259(_0x4b221f(0x90))[_0x4b221f(0xde)]((_0x3e65f7,_0xc5f9f2)=>{const _0x504c80=_0x4b221f,_0x3c7620=_0x54f259(_0xc5f9f2)[_0x504c80(0xd8)](_0x504c80(0xe2))['text']()[_0x504c80(0x9a)](),_0x256940=_0x54f259(_0xc5f9f2)[_0x504c80(0xd8)]('a')[_0x504c80(0xd4)]('href'),_0x5e0f21=_0x3c7620['match'](new RegExp(_0x504c80(0xc2))),_0x4e2544=_0x5e0f21?parseInt(_0x5e0f21[0x0]):null;_0x186d64[_0x504c80(0x8b)]({'title':_0x3c7620,'href':_0x256940,'year':_0x4e2544});});if(_0x186d64[_0x4b221f(0xd1)]===0x0)return console[_0x4b221f(0xe8)]('[AllMovieLand]\x20No\x20search\x20results\x20found.'),[];const _0x3bb101=findBestTitleMatch(_0x4120bf,_0x186d64),_0x34e089=_0x3bb101||_0x186d64[0x0];console[_0x4b221f(0xe8)](_0x4b221f(0x95)+_0x34e089[_0x4b221f(0x9d)]+_0x4b221f(0xc6)+_0x34e089[_0x4b221f(0xd2)]+')');const _0x450560=yield fetch(_0x34e089[_0x4b221f(0xd2)],{'headers':HEADERS}),_0x36ade9=yield _0x450560[_0x4b221f(0xad)](),_0x16773f=import_cheerio_without_node_native[_0x4b221f(0xda)]['load'](_0x36ade9),_0x1eb60e=_0x16773f(_0x4b221f(0xca))[_0x4b221f(0xc7)]()||'',_0x17503d=_0x1eb60e[_0x4b221f(0xbe)](/const AwsIndStreamDomain\s*=\s*'([^']+)'/),_0x3058d2=_0x17503d?_0x17503d[0x1][_0x4b221f(0x86)](/\/$/,''):null,_0x78315c=_0x1eb60e[_0x4b221f(0xbe)](/src:\s*'([^']+)'/),_0x5c2c01=_0x78315c?_0x78315c[0x1]:null;if(!_0x3058d2||!_0x5c2c01)return console[_0x4b221f(0xe8)](_0x4b221f(0xb6)),[];const _0x57c41d=_0x3058d2+'/play/'+_0x5c2c01,_0x3d0b4b=yield fetch(_0x57c41d,{'headers':__spreadProps(__spreadValues({},HEADERS),{'Referer':_0x34e089['href']})}),_0x439dc4=yield _0x3d0b4b[_0x4b221f(0xad)](),_0x3004ae=import_cheerio_without_node_native[_0x4b221f(0xda)][_0x4b221f(0xbd)](_0x439dc4),_0x56742f=_0x3004ae(_0x4b221f(0xb4))[_0x4b221f(0xa3)]()[_0x4b221f(0xc7)]()||'',_0x539e26=_0x56742f[_0x4b221f(0xbe)](/let\s+p3\s*=\s*(\{.*\});/);if(!_0x539e26)return console[_0x4b221f(0xe8)](_0x4b221f(0xa8)),[];const _0x351c54=JSON[_0x4b221f(0x9f)](_0x539e26[0x1]);let _0x3b59e0=_0x351c54[_0x4b221f(0xe1)]['replace'](/\\\//g,'/');if(!_0x3b59e0[_0x4b221f(0xd5)](_0x4b221f(0x99)))_0x3b59e0=''+_0x3058d2+_0x3b59e0;const _0x3ad049=yield fetch(_0x3b59e0,{'method':_0x4b221f(0xa5),'headers':__spreadProps(__spreadValues({},HEADERS),{'X-CSRF-TOKEN':_0x351c54[_0x4b221f(0x92)],'Referer':_0x57c41d})}),_0x48b3a6=yield _0x3ad049[_0x4b221f(0xad)]();let _0x267f03=[];const _0x20ddc1=JSON[_0x4b221f(0x9f)](_0x48b3a6[_0x4b221f(0x86)](/,\]/g,']'));if(_0x5e7559===_0x4b221f(0xd9))_0x267f03=_0x20ddc1[_0x4b221f(0xdd)](_0x21c86c=>_0x21c86c&&_0x21c86c['file']);else{if(_0x5e7559==='tv'){const _0x2332d6=_0x20ddc1['find'](_0x4e06e5=>_0x4e06e5['id']==_0x2c24f0);if(_0x2332d6&&_0x2332d6[_0x4b221f(0xd3)]){const _0x445e05=_0x2332d6[_0x4b221f(0xd3)][_0x4b221f(0xd8)](_0x18558c=>_0x18558c[_0x4b221f(0x8e)]==_0xa15d0c);_0x445e05&&_0x445e05[_0x4b221f(0xd3)]&&(_0x267f03=_0x445e05['folder'][_0x4b221f(0xdd)](_0x714d85=>_0x714d85&&_0x714d85[_0x4b221f(0xe1)]));}}}if(_0x267f03[_0x4b221f(0xd1)]===0x0)return console[_0x4b221f(0xe8)](_0x4b221f(0x8a)),[];const _0x4742a2=[];return yield Promise[_0x4b221f(0xe9)](_0x267f03[_0x4b221f(0xbf)](_0x4cac34=>__async(this,null,function*(){const _0x4589ca=_0x4b221f;try{const _0x18efde=_0x4cac34[_0x4589ca(0xe1)][_0x4589ca(0x86)](/^~/,''),_0x2e0e93=_0x3058d2+_0x4589ca(0xa7)+_0x18efde+_0x4589ca(0xae),_0x3d19f2=yield fetch(_0x2e0e93,{'method':_0x4589ca(0xa5),'headers':__spreadProps(__spreadValues({},HEADERS),{'X-CSRF-TOKEN':_0x351c54[_0x4589ca(0x92)],'Referer':_0x57c41d})}),_0x171484=(yield _0x3d19f2['text']())[_0x4589ca(0x9a)]();if(_0x171484&&_0x171484[_0x4589ca(0xd5)](_0x4589ca(0x99))){const _0x5a4747=_0x4cac34[_0x4589ca(0x9d)]||_0x4589ca(0xb9);_0x4742a2[_0x4589ca(0x8b)]({'name':_0x4589ca(0xcc),'title':_0x4589ca(0xbc)+_0x5a4747,'url':_0x171484,'quality':_0x5a4747,'headers':{'Referer':_0x3058d2+'/','Origin':_0x3058d2,'User-Agent':HEADERS[_0x4589ca(0xa1)]},'provider':_0x4589ca(0xea)});}}catch(_0x21d4de){console[_0x4589ca(0xb7)](_0x4589ca(0x94)+_0x21d4de[_0x4589ca(0xa4)]);}}))),_0x4742a2;}catch(_0x2c0cf5){return console[_0x4b221f(0xb7)]('[AllMovieLand]\x20Error:\x20'+_0x2c0cf5['message']),[];}});}module[_0x585d93(0xc3)]={'getStreams':getStreams};
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "allmovieland", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AllMovieLand", "allmovieland");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
