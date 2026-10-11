// Imported provider: desiflix; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
var _0x4d7322=_0x5931;(function(_0x274395,_0x42d5c2){var _0x5a6e0b={_0x535452:0x236,_0x3f0ba1:0x204,_0x449d58:0x23f,_0x246868:0x201,_0x58f74c:0x1ed},_0x1fad9e=_0x5931,_0x45ac1a=_0x274395();while(!![]){try{var _0x159651=-parseInt(_0x1fad9e(0x1ee))/0x1*(parseInt(_0x1fad9e(0x200))/0x2)+parseInt(_0x1fad9e(_0x5a6e0b._0x535452))/0x3+-parseInt(_0x1fad9e(_0x5a6e0b._0x3f0ba1))/0x4*(parseInt(_0x1fad9e(0x207))/0x5)+parseInt(_0x1fad9e(0x228))/0x6+parseInt(_0x1fad9e(0x21d))/0x7*(-parseInt(_0x1fad9e(_0x5a6e0b._0x449d58))/0x8)+-parseInt(_0x1fad9e(_0x5a6e0b._0x246868))/0x9+parseInt(_0x1fad9e(_0x5a6e0b._0x58f74c))/0xa*(parseInt(_0x1fad9e(0x21b))/0xb);if(_0x159651===_0x42d5c2)break;else _0x45ac1a['push'](_0x45ac1a['shift']());}catch(_0x21869f){_0x45ac1a['push'](_0x45ac1a['shift']());}}}(_0x27f4,0x21116));var __async=(_0x17326d,_0x3bf1f8,_0x9587a8)=>{return new Promise((_0x370d04,_0x1b7722)=>{var _0x10c202=_0x5931,_0x4088dc=_0x43429a=>{try{_0x259de0(_0x9587a8['next'](_0x43429a));}catch(_0x54d9d2){_0x1b7722(_0x54d9d2);}},_0x157564=_0x54cc36=>{var _0x34a148=_0x5931;try{_0x259de0(_0x9587a8[_0x34a148(0x239)](_0x54cc36));}catch(_0x41b979){_0x1b7722(_0x41b979);}},_0x259de0=_0x1f9f9b=>_0x1f9f9b[_0x10c202(0x234)]?_0x370d04(_0x1f9f9b[_0x10c202(0x235)]):Promise[_0x10c202(0x230)](_0x1f9f9b['value'])['then'](_0x4088dc,_0x157564);_0x259de0((_0x9587a8=_0x9587a8[_0x10c202(0x208)](_0x17326d,_0x3bf1f8))['next']());});},PROVIDER_NAME=_0x4d7322(0x1e8),DESIFLIX_BASE='https://manifest.desitvhub.eu.org',TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',FETCH_TIMEOUT=0x2ee0,USER_AGENT=_0x4d7322(0x222);function log(_0x59bee8){console['log']('['+PROVIDER_NAME+']\x20'+_0x59bee8);}function err(_0x5738fe){var _0x222701={_0x243566:0x23d},_0x4244da=_0x4d7322;console[_0x4244da(_0x222701._0x243566)]('['+PROVIDER_NAME+']\x20'+_0x5738fe);}function _0x5931(_0x231e7e,_0x4320d7){_0x231e7e=_0x231e7e-0x1e5;var _0x27f487=_0x27f4();var _0x5931a0=_0x27f487[_0x231e7e];if(_0x5931['ivjWSM']===undefined){var _0x285f6b=function(_0x39a065){var _0x7b51e2='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x17326d='',_0x3bf1f8='';for(var _0x9587a8=0x0,_0x370d04,_0x1b7722,_0x4088dc=0x0;_0x1b7722=_0x39a065['charAt'](_0x4088dc++);~_0x1b7722&&(_0x370d04=_0x9587a8%0x4?_0x370d04*0x40+_0x1b7722:_0x1b7722,_0x9587a8++%0x4)?_0x17326d+=String['fromCharCode'](0xff&_0x370d04>>(-0x2*_0x9587a8&0x6)):0x0){_0x1b7722=_0x7b51e2['indexOf'](_0x1b7722);}for(var _0x157564=0x0,_0x259de0=_0x17326d['length'];_0x157564<_0x259de0;_0x157564++){_0x3bf1f8+='%'+('00'+_0x17326d['charCodeAt'](_0x157564)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x3bf1f8);};_0x5931['tOfbOo']=_0x285f6b,_0x5931['gSBcIf']={},_0x5931['ivjWSM']=!![];}var _0x2de63d=_0x27f487[0x0],_0x1837e9=_0x231e7e+_0x2de63d,_0x2c12f1=_0x5931['gSBcIf'][_0x1837e9];return!_0x2c12f1?(_0x5931a0=_0x5931['tOfbOo'](_0x5931a0),_0x5931['gSBcIf'][_0x1837e9]=_0x5931a0):_0x5931a0=_0x2c12f1,_0x5931a0;}function raceTimeout(_0x31afe2){var _0x49ec66={_0x331f6b:0x1e6};return new Promise(function(_0x256f83,_0x3b6322){setTimeout(function(){var _0x44c5ad=_0x5931;_0x3b6322(new Error(_0x44c5ad(_0x49ec66._0x331f6b)+_0x31afe2+'ms'));},_0x31afe2);});}function fetchJson(_0x568905){var _0x986e8e={_0x3b2ab1:0x1f4,_0x291655:0x205};return __async(this,null,function*(){var _0x1d0b41=_0x5931;try{var _0x4f618d=fetch(_0x568905,{'headers':{'User-Agent':USER_AGENT,'Accept':_0x1d0b41(0x215)}}),_0x3a7a18=yield Promise['race']([_0x4f618d,raceTimeout(FETCH_TIMEOUT)]);if(_0x3a7a18&&_0x3a7a18['ok'])return yield _0x3a7a18[_0x1d0b41(_0x986e8e._0x3b2ab1)]();}catch(_0x365175){err('fetch\x20failed:\x20'+_0x568905+_0x1d0b41(_0x986e8e._0x291655)+(_0x365175['message']||''));}return null;});}function _0x27f4(){var _0x2b69a5=['ihr5Cgu9','mZG5mZzNz0X6t3G','tva0','BwfSyxLHBgfT','vgLTzw91Dca','l3n0CMvHBs9ZzxjPzxmV','rgvZAuzSAxG','D2vICMLW','C3bSAxq','p2fWAv9RzxK9','zxH0zxjUywXvCMW','mJbbCfflr0C','mZC0vw1IywjQ','mJe2mha','ihm9','C29YDa','ihWG8j+sVIa','DxjS','ANnVBG','Agv2yW','uMvXDwvZDdOGDg1KyKLKpq','EwvHCG','nZiWCa','qufd','8j+tPsbxruiTreW','rg9SyNKGvMLZAw9U','ihWG8j+tPIa','lM1Wna','Edi2nq','zgrWiduUmq','mte4r3b5D1ft','mtCYodCYow9NCevwrq','ChvZAa','BMfTzq','ntzXrNvzzLG','ic0+ia','rw5NBgLZAa','nJm3nJvgBe1AsKq','yxbWBhK','DgvSDwD1','mta4ma','ndGWCa','Aw1KyL9Pza','vgvSDwD1','zMLYC3rFywLYx2rHDgu','BgvUz3rO','Dg9mB3DLCKnHC2u','ndGW','mJe2ma','mta4mha','Adi2nq','yxbWBgLJyxrPB24VANnVBG','AgrYAxa','Dhj1zwHK','nY4X','8j+oPsa','t3jPz2LUywW','mZqXmZeZnxHTAwLXBq','lMPZB24','mJu5BKjRteDt','ihWG8j+mIca','CgfKu3rHCNq','8j+sVYbcBhvsyxK','zg9SyNKGDMLZAw9U','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYnc4WlJaUmcbtywzHCMKVntm3lJm2','sevwqYb4mJy0','tM8GC3rYzwfTCYbYzxr1CM5LzcbMCM9TierLC2LgBgL4','AgrY','igu9','8j+nVYa','mZaZnZq0wuXryLPf','zxH0zxjUywXFAwrZ','vhj1zuHe','zgq1lJe','vgfTAwW','Aw1KyKLK','ihWG8j+oPYa','ihnVCNrLzcbZDhjLyw1Z','CMvZB2X2zq','rgvZAuzSAxGGvgL0Bgu','DgL0Bgu','ihWG8j+uIIa','zg9Uzq','DMfSDwu','mteXmdyWzfLHDMT3','DgfTAwW','sevwqYb4mJy1','DgHYB3C','zw5NBgLZAa','C3rYzwfTCW','Aw5KzxHpzG','zxjYB3i'];_0x27f4=function(){return _0x2b69a5;};return _0x27f4();}function getTMDBDetails(_0xecda0e,_0x24c07e){var _0x21122e={_0x1e2887:0x1eb,_0x59edc8:0x231,_0x49ad48:0x20e,_0x27b1c1:0x1ea,_0x556d57:0x229,_0x47c6de:0x20c};return __async(this,null,function*(){var _0x35b860=_0x5931,_0x259e30=_0x24c07e==='tv'||_0x24c07e==='series',_0x482a5c=_0x259e30?'tv':'movie',_0x40b2a9='https://api.themoviedb.org/3/'+_0x482a5c+'/'+_0xecda0e+_0x35b860(_0x21122e._0x1e2887)+TMDB_API_KEY+'&append_to_response=external_ids',_0x12ce82=yield fetchJson(_0x40b2a9);if(!_0x12ce82)return{'title':'DesiFlix\x20Title','year':'','imdbId':null};return{'title':(_0x259e30?_0x12ce82['name']:_0x12ce82[_0x35b860(0x232)])||_0x35b860(_0x21122e._0x59edc8),'year':(_0x259e30?_0x12ce82[_0x35b860(_0x21122e._0x49ad48)]||'':_0x12ce82['release_date']||'')[_0x35b860(_0x21122e._0x27b1c1)]('-')[0x0],'imdbId':_0x12ce82['imdb_id']||_0x12ce82[_0x35b860(_0x21122e._0x556d57)]&&_0x12ce82[_0x35b860(0x229)][_0x35b860(_0x21122e._0x47c6de)]||null};});}function parseLanguage(_0x5efffd){var _0x9cda3f={_0x439681:0x23c,_0x1c2964:0x23a,_0x40cd7d:0x206,_0x409340:0x237,_0x110108:0x23c},_0x265e8b=_0x4d7322;if(_0x5efffd[_0x265e8b(_0x9cda3f._0x439681)]('multi')!==-0x1)return'Multi-Audio';var _0x421a93=_0x5efffd['indexOf'](_0x265e8b(_0x9cda3f._0x1c2964))!==-0x1||_0x5efffd['indexOf']('eng')!==-0x1,_0x2d30d3=_0x5efffd['indexOf']('hindi')!==-0x1||_0x5efffd[_0x265e8b(0x23c)]('hin')!==-0x1;if(_0x421a93&&_0x2d30d3||_0x5efffd[_0x265e8b(_0x9cda3f._0x439681)]('dual')!==-0x1)return'Dual-Audio';if(_0x2d30d3)return'Hindi';if(_0x421a93)return _0x265e8b(_0x9cda3f._0x40cd7d);if(_0x5efffd['indexOf'](_0x265e8b(_0x9cda3f._0x409340))!==-0x1)return _0x265e8b(0x22c);if(_0x5efffd[_0x265e8b(_0x9cda3f._0x110108)](_0x265e8b(0x209))!==-0x1)return _0x265e8b(0x20d);if(_0x5efffd['indexOf'](_0x265e8b(0x1e5))!==-0x1)return'Malayalam';if(_0x5efffd['indexOf']('kannada')!==-0x1)return'Kannada';return _0x265e8b(0x21a);}function buildDropdownMetadata(_0x3da196,_0x32fbf3,_0x103e2a,_0x4c6362,_0xae78a2,_0x229e52){var _0x1614b3={_0x3b03c9:0x231,_0x34bb7b:0x1f7,_0x18b68a:0x203,_0x3f9fbc:0x210,_0x11b24c:0x21f,_0x4f7c0d:0x212,_0x42d51e:0x23c,_0x3265d0:0x233,_0x9260b1:0x1f5,_0x5595df:0x1fe,_0x3fcd32:0x238,_0x5cfc99:0x214,_0x4876fc:0x1fe,_0x284eed:0x1ff,_0x589648:0x22a,_0x10985f:0x219,_0x2ce49b:0x22e,_0x22dac6:0x1fa,_0x59c289:0x23c,_0x5014cc:0x23c,_0x1455c5:0x240,_0x33f56f:0x23c,_0x51cd1f:0x225,_0x349993:0x23c,_0x2db75e:0x221,_0x39eb40:0x1fc},_0x45e741=_0x4d7322,_0x2c722e=_0x3da196['title']||_0x45e741(_0x1614b3._0x3b03c9),_0x146dbe=_0x3da196['year']?'\x20('+_0x3da196[_0x45e741(_0x1614b3._0x34bb7b)]+')':'',_0x5dee21=(_0x229e52[_0x45e741(0x232)]||'')+'\x20'+(_0x229e52[_0x45e741(_0x1614b3._0x18b68a)]||'')+'\x20'+(_0x229e52['url']||''),_0x4bc44d=_0x5dee21[_0x45e741(_0x1614b3._0x3f9fbc)](),_0x59c9bb=_0x45e741(0x227)+_0x2c722e+_0x146dbe;_0x103e2a&&_0x4c6362!=null&&_0xae78a2!=null&&(_0x59c9bb+='\x20|\x20S'+String(_0x4c6362)[_0x45e741(_0x1614b3._0x11b24c)](0x2,'0')+'E'+String(_0xae78a2)[_0x45e741(0x21f)](0x2,'0'));var _0x1abd08='💎';if(_0x32fbf3['indexOf'](_0x45e741(_0x1614b3._0x4f7c0d))!==-0x1||_0x32fbf3[_0x45e741(_0x1614b3._0x42d51e)]('4k')!==-0x1)_0x1abd08='🌟';else{if(_0x32fbf3['indexOf'](_0x45e741(0x20a))!==-0x1)_0x1abd08='🔥';}var _0xa6bb03=parseLanguage(_0x4bc44d),_0x573257=_0x4bc44d['match'](/(\d+(?:\.\d+)?\s*(?:gb|mb))/i),_0x2dac7d=_0x573257?_0x573257[0x1]['toUpperCase']():'Variable\x20Size',_0x430b04=_0x1abd08+'\x20'+_0x32fbf3+_0x45e741(0x1f2)+_0x2dac7d+_0x45e741(_0x1614b3._0x3265d0)+_0xa6bb03,_0x261585='x264';if(_0x4bc44d['indexOf'](_0x45e741(_0x1614b3._0x9260b1))!==-0x1&&(_0x4bc44d['indexOf'](_0x45e741(_0x1614b3._0x5595df))!==-0x1||_0x4bc44d['indexOf'](_0x45e741(0x214))!==-0x1))_0x261585=_0x45e741(_0x1614b3._0x3fcd32);else{if(_0x4bc44d['indexOf'](_0x45e741(_0x1614b3._0x9260b1))!==-0x1)_0x261585=_0x45e741(0x223);else(_0x4bc44d[_0x45e741(_0x1614b3._0x42d51e)](_0x45e741(0x1fe))!==-0x1||_0x4bc44d[_0x45e741(0x23c)](_0x45e741(_0x1614b3._0x5cfc99))!==-0x1)&&(_0x261585=_0x45e741(_0x1614b3._0x4876fc));}var _0x176bed=_0x45e741(0x1f9);if(_0x4bc44d['indexOf']('ddp5.1')!==-0x1||_0x4bc44d['indexOf'](_0x45e741(_0x1614b3._0x284eed))!==-0x1)_0x176bed='DDP5.1';else{if(_0x4bc44d['indexOf'](_0x45e741(0x22b))!==-0x1||_0x4bc44d['indexOf']('5.1')!==-0x1)_0x176bed='DD5.1';else{if(_0x4bc44d[_0x45e741(0x23c)](_0x45e741(0x218))!==-0x1)_0x176bed='7.1';else{if(_0x4bc44d['indexOf'](_0x45e741(0x217))!==-0x1)_0x176bed=_0x45e741(_0x1614b3._0x589648);}}}var _0x4cf26b=_0x4bc44d[_0x45e741(0x23c)]('atmos')!==-0x1?'\x20|\x20🔊\x20Atmos':'',_0x4831c7=_0x45e741(_0x1614b3._0x10985f)+_0x261585+_0x45e741(_0x1614b3._0x2ce49b)+_0x176bed+_0x4cf26b,_0x2f930f=_0x45e741(_0x1614b3._0x22dac6);if(_0x4bc44d['indexOf']('web-rip')!==-0x1||_0x4bc44d[_0x45e741(_0x1614b3._0x42d51e)](_0x45e741(0x1e9))!==-0x1)_0x2f930f='🌐\x20WEB-RIP';else{if(_0x4bc44d[_0x45e741(_0x1614b3._0x42d51e)]('bluray')!==-0x1)_0x2f930f=_0x45e741(0x220);else{if(_0x4bc44d[_0x45e741(_0x1614b3._0x59c289)](_0x45e741(0x216))!==-0x1)_0x2f930f='📺\x20HD-RIP';}}var _0x83022b=_0x229e52['url']&&_0x229e52['url'][_0x45e741(_0x1614b3._0x5014cc)](_0x45e741(0x1fd))!==-0x1?_0x45e741(_0x1614b3._0x1455c5):'MKV',_0x4fac72='SDR';if(_0x4bc44d['indexOf']('10bit')!==-0x1||_0x4bc44d[_0x45e741(_0x1614b3._0x33f56f)]('10-bit')!==-0x1)_0x4fac72=_0x4bc44d[_0x45e741(0x23c)](_0x45e741(_0x1614b3._0x51cd1f))!==-0x1?'10bit\x20HDR':'10bit';else{if(_0x4bc44d['indexOf']('hdr10+')!==-0x1)_0x4fac72='HDR10+';else{if(_0x4bc44d[_0x45e741(0x23c)]('hdr')!==-0x1)_0x4fac72='HDR';else(_0x4bc44d['indexOf']('dv')!==-0x1||_0x4bc44d[_0x45e741(_0x1614b3._0x349993)](_0x45e741(_0x1614b3._0x2db75e))!==-0x1)&&(_0x4fac72=_0x45e741(0x1fb));}}var _0x18afa2=_0x2f930f+_0x45e741(_0x1614b3._0x39eb40)+_0x83022b+_0x45e741(0x21e)+_0x4fac72,_0x30e4f1='📎\x20'+PROVIDER_NAME;return _0x59c9bb+'\x0a'+_0x430b04+'\x0a'+_0x4831c7+'\x0a'+_0x18afa2+'\x0a'+_0x30e4f1;}function getStreams(_0x151035,_0x1d5d5f,_0x4a4a6f,_0xe39a47){var _0x1d3ba2={_0x376f8b:0x23e,_0x3e88d4:0x226,_0x234014:0x23b,_0x5f2b9a:0x224,_0x5036b8:0x1f3,_0x5a64b4:0x1ec,_0xe7a027:0x232,_0x537b91:0x202},_0x2bcd9a={_0x3f06da:0x203},_0x29df05={_0x448346:0x23c,_0x266da8:0x23c};return __async(this,null,function*(){var _0x2cbeaf=_0x5931,_0x30b586=_0x1d5d5f==='tv'||_0x1d5d5f==='series';log(_0x2cbeaf(0x1f6)+_0x151035+_0x2cbeaf(_0x1d3ba2._0x376f8b)+_0x1d5d5f+_0x2cbeaf(0x1f0)+_0x4a4a6f+_0x2cbeaf(_0x1d3ba2._0x3e88d4)+_0xe39a47);var _0x21d9e5=yield getTMDBDetails(_0x151035,_0x1d5d5f),_0xcfc11=_0x21d9e5['imdbId']||_0x151035,_0x5e2034='';if(_0x30b586){var _0x8318cb=_0x4a4a6f!=null?_0x4a4a6f:0x1,_0x476b1f=_0xe39a47!=null?_0xe39a47:0x1;_0x5e2034=DESIFLIX_BASE+'/stream/series/'+_0xcfc11+':'+_0x8318cb+':'+_0x476b1f+'.json';}else _0x5e2034=DESIFLIX_BASE+'/stream/movie/'+_0xcfc11+_0x2cbeaf(0x21c);log('Fetching\x20streams\x20from:\x20'+_0x5e2034);var _0x1ff470=yield fetchJson(_0x5e2034);if((!_0x1ff470||!_0x1ff470[_0x2cbeaf(0x23b)]||!_0x1ff470[_0x2cbeaf(0x23b)]['length'])&&_0x21d9e5[_0x2cbeaf(0x22d)]){var _0x11e4d1=_0x30b586?DESIFLIX_BASE+_0x2cbeaf(0x1e7)+_0x151035+':'+(_0x4a4a6f||0x1)+':'+(_0xe39a47||0x1)+'.json':DESIFLIX_BASE+'/stream/movie/'+_0x151035+'.json';log('Retrying\x20with\x20fallback\x20endpoint:\x20'+_0x11e4d1),_0x1ff470=yield fetchJson(_0x11e4d1);}if(!_0x1ff470||!_0x1ff470[_0x2cbeaf(0x23b)]||!_0x1ff470[_0x2cbeaf(_0x1d3ba2._0x234014)][_0x2cbeaf(0x20f)])return log(_0x2cbeaf(_0x1d3ba2._0x5f2b9a)),[];var _0x143585=[],_0x4c94ec={};for(var _0x217402=0x0;_0x217402<_0x1ff470[_0x2cbeaf(_0x1d3ba2._0x234014)]['length'];_0x217402++){var _0x2af0ce=_0x1ff470['streams'][_0x217402],_0x336fb5=_0x2af0ce[_0x2cbeaf(_0x1d3ba2._0x5036b8)]||_0x2af0ce[_0x2cbeaf(_0x1d3ba2._0x5a64b4)];if(!_0x336fb5||_0x4c94ec[_0x336fb5])continue;_0x4c94ec[_0x336fb5]=!![];var _0x387647=((_0x2af0ce[_0x2cbeaf(_0x1d3ba2._0xe7a027)]||'')+'\x20'+(_0x2af0ce['name']||'')+'\x20'+_0x336fb5)['toLowerCase'](),_0xf21667='1080p';if(_0x387647[_0x2cbeaf(0x23c)]('2160')!==-0x1||_0x387647['indexOf']('4k')!==-0x1)_0xf21667=_0x2cbeaf(0x1ef);else{if(_0x387647['indexOf']('720')!==-0x1)_0xf21667='720p';else{if(_0x387647[_0x2cbeaf(0x23c)](_0x2cbeaf(0x211))!==-0x1)_0xf21667='480p';}}var _0x5c0eb6=parseLanguage(_0x387647),_0x2ae4a4=buildDropdownMetadata(_0x21d9e5,_0xf21667,_0x30b586,_0x4a4a6f,_0xe39a47,_0x2af0ce);_0x143585[_0x2cbeaf(_0x1d3ba2._0x537b91)]({'name':PROVIDER_NAME+'\x20|\x20'+_0xf21667+'\x20|\x20'+_0x5c0eb6,'title':_0x2ae4a4,'size':_0x2ae4a4,'description':_0x2ae4a4,'url':_0x336fb5,'quality':'','language':'','headers':{'User-Agent':USER_AGENT,'Referer':DESIFLIX_BASE+'/'}});}function _0x413fb1(_0x2c8dd3){var _0x59eef5=_0x2cbeaf,_0x5af0d2=_0x2c8dd3['toLowerCase']();if(_0x5af0d2[_0x59eef5(_0x29df05._0x448346)]('2160p')!==-0x1||_0x5af0d2[_0x59eef5(0x23c)]('4k')!==-0x1)return 0x870;if(_0x5af0d2[_0x59eef5(_0x29df05._0x266da8)](_0x59eef5(0x213))!==-0x1)return 0x438;if(_0x5af0d2['indexOf'](_0x59eef5(0x1f8))!==-0x1)return 0x2d0;if(_0x5af0d2[_0x59eef5(_0x29df05._0x266da8)](_0x59eef5(0x20b))!==-0x1)return 0x1e0;return 0x0;}return _0x143585[_0x2cbeaf(0x1f1)](function(_0x44ed16,_0x240b31){var _0x373e3e=_0x2cbeaf;return _0x413fb1(_0x240b31['name'])-_0x413fb1(_0x44ed16[_0x373e3e(_0x2bcd9a._0x3f06da)]);}),log('Returning\x20'+_0x143585['length']+_0x2cbeaf(0x22f)),_0x143585;});}typeof module!=='undefined'&&module['exports']?module['exports']={'getStreams':getStreams}:global['getStreams']=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "desiflix", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "DesiFlix", "desiflix");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
