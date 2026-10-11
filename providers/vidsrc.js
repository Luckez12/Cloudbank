// Imported provider: vidsrc; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
var _0x10161d=_0x3d0b;(function(_0x4ad937,_0x4d8e3c){var _0x122664={_0x313ca2:0x12d,_0x229d60:0x123,_0x16e77c:0x134,_0x594b55:0x14d},_0x12e890=_0x3d0b,_0x8844c4=_0x4ad937();while(!![]){try{var _0x41fdce=-parseInt(_0x12e890(0x133))/0x1*(-parseInt(_0x12e890(0x114))/0x2)+parseInt(_0x12e890(0xff))/0x3*(-parseInt(_0x12e890(0x100))/0x4)+parseInt(_0x12e890(0x124))/0x5*(parseInt(_0x12e890(0x108))/0x6)+-parseInt(_0x12e890(0x107))/0x7*(-parseInt(_0x12e890(0x127))/0x8)+parseInt(_0x12e890(_0x122664._0x313ca2))/0x9*(parseInt(_0x12e890(_0x122664._0x229d60))/0xa)+parseInt(_0x12e890(0xfd))/0xb*(-parseInt(_0x12e890(_0x122664._0x16e77c))/0xc)+parseInt(_0x12e890(_0x122664._0x594b55))/0xd;if(_0x41fdce===_0x4d8e3c)break;else _0x8844c4['push'](_0x8844c4['shift']());}catch(_0x2966e0){_0x8844c4['push'](_0x8844c4['shift']());}}}(_0x5e39,0xd47d2));var __async=(_0x46e79d,_0x2eca92,_0xb92204)=>{var _0x183d63={_0x339596:0x12e},_0x2b96b0={_0x34b802:0x13a};return new Promise((_0x6ab048,_0x569803)=>{var _0x4f05ce=_0x3d0b,_0xbf13c=_0x5e9f0b=>{var _0xe59dc4=_0x3d0b;try{_0x32ba86(_0xb92204[_0xe59dc4(0x11f)](_0x5e9f0b));}catch(_0x122bfe){_0x569803(_0x122bfe);}},_0x42a348=_0x3fc4f6=>{var _0x3e1faa=_0x3d0b;try{_0x32ba86(_0xb92204[_0x3e1faa(_0x2b96b0._0x34b802)](_0x3fc4f6));}catch(_0x6743e3){_0x569803(_0x6743e3);}},_0x32ba86=_0x4a6426=>_0x4a6426['done']?_0x6ab048(_0x4a6426[_0x4f05ce(0x11d)]):Promise['resolve'](_0x4a6426[_0x4f05ce(0x11d)])[_0x4f05ce(0x103)](_0xbf13c,_0x42a348);_0x32ba86((_0xb92204=_0xb92204[_0x4f05ce(_0x183d63._0x339596)](_0x46e79d,_0x2eca92))[_0x4f05ce(0x11f)]());});},BASEDOM='https://whisperingauroras.com',UA='Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/128.0.0.0\x20Safari/537.36',TMDB_API_KEY=_0x10161d(0x150);function safeFetch(_0x38c7d2,_0x22c1f2,_0x2470b2){var _0x3e0cb2={_0x45ac16:0x138,_0x2e8254:0x10a},_0x36a12d={_0x6fbd93:0x152},_0x4cedae=_0x10161d;_0x2470b2=_0x2470b2||0x1f40;var _0x1c90ea,_0x28bb5c;try{_0x1c90ea=new AbortController(),_0x28bb5c=setTimeout(function(){var _0x13a933=_0x3d0b;_0x1c90ea[_0x13a933(_0x36a12d._0x6fbd93)]();},_0x2470b2);}catch(_0x5c632b){_0x1c90ea=null;}var _0x20e058=Object['assign']({'method':_0x4cedae(_0x3e0cb2._0x45ac16)},_0x22c1f2||{});if(_0x1c90ea)_0x20e058[_0x4cedae(0x117)]=_0x1c90ea['signal'];return fetch(_0x38c7d2,_0x20e058)['then'](function(_0x4c01c8){if(_0x28bb5c)clearTimeout(_0x28bb5c);return _0x4c01c8;})[_0x4cedae(_0x3e0cb2._0x2e8254)](function(_0x40c68b){if(_0x28bb5c)clearTimeout(_0x28bb5c);throw _0x40c68b;});}function bMGyx71TzQLfdonN(_0x1a8754){var _0x5ac2c2={_0x4b9fec:0x159,_0x26cef1:0x118},_0x399bc8=_0x10161d,_0x487118=0x3,_0x3abed3=[];if(typeof _0x1a8754!=='string')return'';for(var _0x5dc1a0=0x0;_0x5dc1a0<_0x1a8754['length'];_0x5dc1a0+=_0x487118){_0x3abed3[_0x399bc8(_0x5ac2c2._0x4b9fec)](_0x1a8754['slice'](_0x5dc1a0,_0x5dc1a0+_0x487118));}return _0x3abed3[_0x399bc8(_0x5ac2c2._0x26cef1)]()['join']('');}function Iry9MQXnLs(_0x46d1a2){var _0x3a2d67={_0x366036:0x139,_0x885ac9:0x141,_0x1c8698:0x10c,_0xfda53a:0x10c},_0x24ec9a=_0x10161d,_0x24f8b9='pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u',_0x4098f2=_0x46d1a2[_0x24ec9a(_0x3a2d67._0x366036)](/.{1,2}/g)['map'](function(_0x2ef788){return String['fromCharCode'](parseInt(_0x2ef788,0x10));})[_0x24ec9a(_0x3a2d67._0x885ac9)](''),_0x177575='';for(var _0x34df3e=0x0;_0x34df3e<_0x4098f2['length'];_0x34df3e++){_0x177575+=String['fromCharCode'](_0x4098f2['charCodeAt'](_0x34df3e)^_0x24f8b9[_0x24ec9a(_0x3a2d67._0x1c8698)](_0x34df3e%_0x24f8b9['length']));}var _0x420f9a='';for(var _0x2f883f=0x0;_0x2f883f<_0x177575['length'];_0x2f883f++){_0x420f9a+=String[_0x24ec9a(0x12f)](_0x177575[_0x24ec9a(_0x3a2d67._0xfda53a)](_0x2f883f)-0x3);}try{return atob(_0x420f9a);}catch(_0x558dde){return'';}}function IGLImMhWrI(_0x41050a){var _0x7ea3b9={_0x52f316:0x141,_0x189d41:0x12b,_0x279d2e:0x141},_0x1997fa=_0x10161d,_0x2f25fe=_0x41050a[_0x1997fa(0x12b)]('')[_0x1997fa(0x118)]()[_0x1997fa(_0x7ea3b9._0x52f316)](''),_0x4dcd3a=_0x2f25fe['replace'](/[a-zA-Z]/g,function(_0x8d62bc){return String['fromCharCode'](_0x8d62bc['charCodeAt'](0x0)+(_0x8d62bc['toLowerCase']()<'n'?0xd:-0xd));}),_0x594d55=_0x4dcd3a[_0x1997fa(_0x7ea3b9._0x189d41)]('')['reverse']()[_0x1997fa(_0x7ea3b9._0x279d2e)]('');try{return atob(_0x594d55);}catch(_0x3fca10){return'';}}function GTAxQyTyBx(_0x1b8cc4){var _0x1616b6={_0xfefa68:0x12b},_0x270411=_0x10161d,_0xb0374d=_0x1b8cc4[_0x270411(_0x1616b6._0xfefa68)]('')[_0x270411(0x118)]()[_0x270411(0x141)](''),_0x44ba88='';for(var _0x130950=0x0;_0x130950<_0xb0374d['length'];_0x130950+=0x2){_0x44ba88+=_0xb0374d[_0x130950];}try{return atob(_0x44ba88);}catch(_0x475e7f){return'';}}function C66jPHx8qu(_0x3f974b){var _0x364002={_0x443e25:0x151},_0x59a408={_0x4304e7:0x12f},_0x4cd910=_0x10161d,_0x3cd8d6=_0x3f974b['split']('')['reverse']()['join'](''),_0x1f1d77='X9a(O;FMV2-7VO5x;Ao\x20:dN1NoFs?j,',_0x17d46c=_0x3cd8d6['match'](/.{1,2}/g)[_0x4cd910(_0x364002._0x443e25)](function(_0x3b4572){var _0x3fee97=_0x4cd910;return String[_0x3fee97(_0x59a408._0x4304e7)](parseInt(_0x3b4572,0x10));})['join'](''),_0xd98432='';for(var _0xd98bf4=0x0;_0xd98bf4<_0x17d46c[_0x4cd910(0x140)];_0xd98bf4++){_0xd98432+=String['fromCharCode'](_0x17d46c['charCodeAt'](_0xd98bf4)^_0x1f1d77[_0x4cd910(0x10c)](_0xd98bf4%_0x1f1d77['length']));}return _0xd98432;}function MyL1IRSfHe(_0x51248d){var _0x61df37=_0x10161d,_0x5b900f=_0x51248d['split']('')['reverse']()[_0x61df37(0x141)](''),_0x70e5d0='';for(var _0x34816d=0x0;_0x34816d<_0x5b900f[_0x61df37(0x140)];_0x34816d++){_0x70e5d0+=String['fromCharCode'](_0x5b900f['charCodeAt'](_0x34816d)-0x1);}var _0x500dc3='';for(var _0x5ef5a8=0x0;_0x5ef5a8<_0x70e5d0['length'];_0x5ef5a8+=0x2){_0x500dc3+=String[_0x61df37(0x12f)](parseInt(_0x70e5d0['substr'](_0x5ef5a8,0x2),0x10));}return _0x500dc3;}function detdj7JHiK(_0x17773d){var _0xc6c902={_0x262dfb:0x115},_0x46ef5c=_0x10161d,_0x3bc577=_0x17773d['slice'](0xa,-0x10),_0xdece7f=_0x46ef5c(0x153),_0x1aa6a0='';try{_0x1aa6a0=atob(_0x3bc577);}catch(_0x14b217){return'';}var _0x46780c=_0xdece7f[_0x46ef5c(0x10d)](Math[_0x46ef5c(_0xc6c902._0x262dfb)](_0x1aa6a0[_0x46ef5c(0x140)]/_0xdece7f['length']))['substring'](0x0,_0x1aa6a0['length']),_0x3806b0='';for(var _0x3f2d11=0x0;_0x3f2d11<_0x1aa6a0[_0x46ef5c(0x140)];_0x3f2d11++){_0x3806b0+=String['fromCharCode'](_0x1aa6a0[_0x46ef5c(0x10c)](_0x3f2d11)^_0x46780c[_0x46ef5c(0x10c)](_0x3f2d11));}return _0x3806b0;}function nZlUnj2VSo(_0x44f460){var _0x25ec9d=_0x10161d,_0x1a2aa0={'x':'a','y':'b','z':'c','a':'d','b':'e','c':'f','d':'g','e':'h','f':'i','g':'j','h':'k','i':'l','j':'m','k':'n','l':'o','m':'p','n':'q','o':'r','p':'s','q':'t','r':'u','s':'v','t':'w','u':'x','v':'y','w':'z','X':'A','Y':'B','Z':'C','A':'D','B':'E','C':'F','D':'G','E':'H','F':'I','G':'J','H':'K','I':'L','J':'M','K':'N','L':'O','M':'P','N':'Q','O':'R','P':'S','Q':'T','R':'U','S':'V','T':'W','U':'X','V':'Y','W':'Z'};return _0x44f460[_0x25ec9d(0x149)](/[xyzabcdefghijklmnopqrstuvwXYZABCDEFGHIJKLMNOPQRSTUVW]/g,function(_0x4ca05e){return _0x1a2aa0[_0x4ca05e]||_0x4ca05e;});}function laM1dAi3vO(_0x3c1a77){var _0x2ae741={_0x39f9e5:0x141,_0x40faaf:0x12f},_0x17fec5=_0x10161d,_0x3259db=_0x3c1a77['split']('')[_0x17fec5(0x118)]()[_0x17fec5(_0x2ae741._0x39f9e5)](''),_0x457b60=_0x3259db['replace'](/-/g,'+')[_0x17fec5(0x149)](/_/g,'/'),_0x303dfd='';try{_0x303dfd=atob(_0x457b60);}catch(_0x129fbf){return'';}var _0x70cfac='';for(var _0x42460f=0x0;_0x42460f<_0x303dfd['length'];_0x42460f++){_0x70cfac+=String[_0x17fec5(_0x2ae741._0x40faaf)](_0x303dfd[_0x17fec5(0x10c)](_0x42460f)-0x5);}return _0x70cfac;}function _0x5e39(){var _0x12bb38=['ywjVCNq','m1nbwx4JjvKOvIu+nwqVwwCIjeDBtgGXCKS0ytS3B2S','r1rbEff5vhLcEa','CgfKu3rHCNq','BMfTzq','lZDLmZLM','B3jPz2LU','ChvZAa','l3jJCc8','mtfwt25ZsLC','w1zPzfnYyY5Tzv0Gu2nYyxbLzcbZDhjLyw1ZoIa','mtvIt2LnEMi','mtC3nduYzhjWANv4','Dgv4Da','sxj5ou1rwg5mCW','DgHLBG','u2vYDMvYia','vMLKu3jJie1LzgLH','zgf0yuHHC2G','mJGYmZm3m2Tnugz2CW','ntiWodm0ofzjveXpCa','p2fWAv9RzxK9','y2f0y2G','qZy2ALbiEdHXDq','y2HHCKnVzgvbDa','CMvWzwf0','CNvUDgLTzq','Aw5JBhvKzxm','8j+oNU+4JYa','BwvZC2fNzq','Ahr0Chm6','8j+tVE+4JYa','mtaYog1JA3PtBq','y2vPBa','l2vWAxnVzguV','C2LNBMfS','CMv2zxjZzq','l3nLyxnVBI8','EwvHCG','ihWGt3jPz2LUywWTqxvKAw8','ttnvoa','DMfSDwu','C3rHCNrZv2L0Aa','BMv4Da','C3vIC3rYAw5N','jMfWCgvUzf90B19YzxnWB25Zzt1LEhrLCM5HBf9Pzhm','w1zPzfnYyY5Tzv0GuMvZB2X2Aw5NihnLCNzLCIbWCM9Yy3a6ia','mtmWBhveELDV','nvP1vw5lvG','ig9Yia','Ahr0Chm6lY92AwrZCMmUBwuVzw1IzwqV','offvBhLYva','lZeWodaV','Dg9tDhjPBMC','otaGBwLU','C3bSAxq','ANnVBG','odm5ndnRv29AsuG','yxbWBhK','zNjVBunOyxjdB2rL','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','Awq9iG','mJaYnG','mJGXqKLMuujO','mtK3mZy3nZjotffHvwm','mta4mha','Bw92Awu','w1zPzfnYyY5Tzv0GufjpuKnqAgfUzgXLCIbLCNjVCJOG','r0vu','Bwf0y2G','DgHYB3C','C2vYDMvYCW','icHwyxjPyw50ia','jde/xZ0KmG','Dg9mB3DLCKnHC2u','Ag9ZDg5HBwu','BgvUz3rO','AM9PBG','Bg9N','w1zPzfnYyY5Tzv0Gvg9Rzw4Gz2vUzxjHDgLVBIbMywLSzwq6ia','zxbPC29Kzv9YDw5FDgLTzq','DhjPBq','l3bYB3jJCc8','w1zPzfnYyY5Tzv0Gu2vYDMvYia','yK1hExG3mvr6uuXMzg9UtG','CMvWBgfJzq','DgL0Bgu','DMLKC3jJBwu','nZiWCa','mtu1otC2mZrVtvvwsvy','nduGBwLU','ig1PBG','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','BwfW'];_0x5e39=function(){return _0x12bb38;};return _0x5e39();}function GuxKGDsA2T(_0x56fc88){var _0x57820d={_0x172a26:0x140},_0x555177=_0x10161d,_0x1e4e93=_0x56fc88[_0x555177(0x12b)]('')[_0x555177(0x118)]()[_0x555177(0x141)](''),_0x66d98c=_0x1e4e93[_0x555177(0x149)](/-/g,'+')['replace'](/_/g,'/'),_0x148ef7='';try{_0x148ef7=atob(_0x66d98c);}catch(_0x388245){return'';}var _0x3ec6ce='';for(var _0x5e4555=0x0;_0x5e4555<_0x148ef7[_0x555177(_0x57820d._0x172a26)];_0x5e4555++){_0x3ec6ce+=String[_0x555177(0x12f)](_0x148ef7[_0x555177(0x10c)](_0x5e4555)-0x7);}return _0x3ec6ce;}function LXVUMCoAHJ(_0x483fb2){var _0x133e48={_0xda507:0x141,_0xd28cc8:0x149,_0x553e1f:0x140,_0x1aebeb:0x12f},_0x55ea98=_0x10161d,_0x2ef238=_0x483fb2['split']('')[_0x55ea98(0x118)]()[_0x55ea98(_0x133e48._0xda507)](''),_0x514a7f=_0x2ef238[_0x55ea98(_0x133e48._0xd28cc8)](/-/g,'+')['replace'](/_/g,'/'),_0x43f157='';try{_0x43f157=atob(_0x514a7f);}catch(_0x3d6a4d){return'';}var _0x44b529='';for(var _0x5c78f3=0x0;_0x5c78f3<_0x43f157[_0x55ea98(_0x133e48._0x553e1f)];_0x5c78f3++){_0x44b529+=String[_0x55ea98(_0x133e48._0x1aebeb)](_0x43f157[_0x55ea98(0x10c)](_0x5c78f3)-0x3);}return _0x44b529;}function decrypt(_0x1d8c7c,_0x33fcbf){var _0x14f27b={_0x175cbb:0x102,_0x323766:0x10b},_0x4fb043=_0x10161d;switch(_0x33fcbf){case'LXVUMCoAHJ':return LXVUMCoAHJ(_0x1d8c7c);case'GuxKGDsA2T':return GuxKGDsA2T(_0x1d8c7c);case'laM1dAi3vO':return laM1dAi3vO(_0x1d8c7c);case'nZlUnj2VSo':return nZlUnj2VSo(_0x1d8c7c);case _0x4fb043(_0x14f27b._0x175cbb):return Iry9MQXnLs(_0x1d8c7c);case'IGLImMhWrI':return IGLImMhWrI(_0x1d8c7c);case _0x4fb043(0x154):return GTAxQyTyBx(_0x1d8c7c);case _0x4fb043(_0x14f27b._0x323766):return C66jPHx8qu(_0x1d8c7c);case'MyL1IRSfHe':return MyL1IRSfHe(_0x1d8c7c);case'detdj7JHiK':return detdj7JHiK(_0x1d8c7c);case _0x4fb043(0x148):return bMGyx71TzQLfdonN(_0x1d8c7c);default:return null;}}function serversLoad(_0x2a7235){var _0x4737b7={_0x4de94e:0x139},_0x17f895=_0x10161d,_0x42eb8f=[],_0x1da41a=_0x2a7235[_0x17f895(_0x4737b7._0x4de94e)](/<title>([^<]*)<\/title>/i),_0x16e096=_0x1da41a?_0x1da41a[0x1]:'',_0x5ef3c8=_0x2a7235['match'](/<iframe\s+[^>]*src="([^"]*)"/i),_0x246a46=_0x5ef3c8?_0x5ef3c8[0x1]:'';_0x246a46&&(BASEDOM=new URL(_0x246a46[_0x17f895(0x11e)]('//')?_0x17f895(0x112)+_0x246a46:_0x246a46)[_0x17f895(0x158)]);var _0x95df63=/class="[^"]*server[^"]*"[^>]*data-hash="([^"]*)"[^>]*>([^<]*)/g,_0xae8eaf;while((_0xae8eaf=_0x95df63['exec'](_0x2a7235))!==null){_0x42eb8f[_0x17f895(0x159)]({'name':_0xae8eaf[0x2][_0x17f895(0x145)](),'dataHash':_0xae8eaf[0x1]});}return{'servers':_0x42eb8f,'title':_0x16e096};}function PRORCPhandler(_0x44923c){var _0x30c608={_0x160dab:0x149,_0x38b794:0x149,_0x492554:0x145,_0xd98bd1:0x145,_0x1b0452:0x131};return __async(this,null,function*(){var _0x38d402=_0x3d0b;try{var _0x2761d3=yield safeFetch(BASEDOM+'/prorcp/'+_0x44923c,{'headers':{'Referer':'https://vidsrc.me/','User-Agent':UA}},0x1388),_0x2f3c45=yield _0x2761d3[_0x38d402(0x101)](),_0x3836db=_0x2f3c45['match'](/<script\s+src="\/([^"]*\.js)\?\_=([^"]*)"><\/script>/gm);if(!_0x3836db)return null;var _0xa3523b=_0x3836db[_0x3836db[_0x38d402(0x140)]-0x1][_0x38d402(0x10f)]('cpt.js')?_0x3836db[_0x3836db['length']-0x2][_0x38d402(_0x30c608._0x160dab)](/.*src="\/([^"]*\.js)\?\_=([^"]*)".*/,_0x38d402(0x13d)):_0x3836db[_0x3836db[_0x38d402(0x140)]-0x1][_0x38d402(_0x30c608._0x38b794)](/.*src="\/([^"]*\.js)\?\_=([^"]*)".*/,_0x38d402(0x13d)),_0x2d316a=yield safeFetch(BASEDOM+'/'+_0xa3523b,{},0x1388),_0x1eaf6b=yield _0x2d316a[_0x38d402(0x101)](),_0x175d5f=/{}\}window\[([^"]+)\("([^"]+)"\)/,_0x6fd42d=_0x1eaf6b['match'](_0x175d5f);if(!_0x6fd42d||_0x6fd42d[_0x38d402(0x140)]<0x3)return null;var _0x12d741=_0x6fd42d[0x1][_0x38d402(0x129)]()[_0x38d402(_0x30c608._0x492554)](),_0x586fca=_0x6fd42d[0x2]['toString']()[_0x38d402(_0x30c608._0xd98bd1)](),_0x2ac414=decrypt(_0x586fca,_0x12d741);if(!_0x2ac414)return null;var _0x21f25c=new RegExp(_0x38d402(_0x30c608._0x1b0452)+_0x2ac414+'\x22[^>]*>([^<]*)','i'),_0x4bf06b=_0x2f3c45['match'](_0x21f25c);if(!_0x4bf06b)return null;var _0x29e66f=_0x4bf06b[0x1][_0x38d402(0x145)](),_0x1ffcfc=decrypt(_0x29e66f,_0x586fca);return _0x1ffcfc;}catch(_0x451789){return console[_0x38d402(0x142)](_0x38d402(0x137)+_0x451789['message']),null;}});}function rcpGrabber(_0x543fc3){var _0x27c82e=_0x10161d,_0x2651ec=/src:\s*'([^']*)'/,_0x1f4dd1=_0x543fc3[_0x27c82e(0x139)](_0x2651ec);if(!_0x1f4dd1)return null;return _0x1f4dd1[0x1];}function _0x3d0b(_0x43f97b,_0xb010){_0x43f97b=_0x43f97b-0xfd;var _0x5e391f=_0x5e39();var _0x3d0b74=_0x5e391f[_0x43f97b];if(_0x3d0b['lxEjkX']===undefined){var _0x370999=function(_0x12c297){var _0xc450fb='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x46e79d='',_0x2eca92='';for(var _0xb92204=0x0,_0x6ab048,_0x569803,_0xbf13c=0x0;_0x569803=_0x12c297['charAt'](_0xbf13c++);~_0x569803&&(_0x6ab048=_0xb92204%0x4?_0x6ab048*0x40+_0x569803:_0x569803,_0xb92204++%0x4)?_0x46e79d+=String['fromCharCode'](0xff&_0x6ab048>>(-0x2*_0xb92204&0x6)):0x0){_0x569803=_0xc450fb['indexOf'](_0x569803);}for(var _0x42a348=0x0,_0x32ba86=_0x46e79d['length'];_0x42a348<_0x32ba86;_0x42a348++){_0x2eca92+='%'+('00'+_0x46e79d['charCodeAt'](_0x42a348)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x2eca92);};_0x3d0b['EuuWea']=_0x370999,_0x3d0b['cLlMiC']={},_0x3d0b['lxEjkX']=!![];}var _0x44713e=_0x5e391f[0x0],_0x4e66ac=_0x43f97b+_0x44713e,_0x47b4c0=_0x3d0b['cLlMiC'][_0x4e66ac];return!_0x47b4c0?(_0x3d0b74=_0x3d0b['EuuWea'](_0x3d0b74),_0x3d0b['cLlMiC'][_0x4e66ac]=_0x3d0b74):_0x3d0b74=_0x47b4c0,_0x3d0b74;}function cleanTitleString(_0x509e26){var _0x26d358=_0x10161d;if(!_0x509e26)return{'title':_0x26d358(0x105),'year':'2026'};var _0x17dc82=_0x509e26['replace'](/\s*-\s*VidSrc\.me$/i,'')['trim'](),_0x2c2024=_0x17dc82[_0x26d358(0x139)](/\s*\((\d{4})\)$/),_0x48c5e8=_0x26d358(0x132);return _0x2c2024&&(_0x48c5e8=_0x2c2024[0x1],_0x17dc82=_0x17dc82[_0x26d358(0x149)](/\s*\(\d{4}\)$/,'')['trim']()),{'title':_0x17dc82,'year':_0x48c5e8};}function fetchTMDBDuration(_0x5cf1d4,_0x459fbd,_0x229d6e,_0x3adc95){var _0x19c994={_0x50e2d5:0x12a,_0x3f6654:0x136,_0x114246:0x121,_0x3d4853:0x12c,_0xa54876:0x10e,_0x598812:0x144,_0x807399:0x140};return __async(this,null,function*(){var _0xd8c91b=_0x3d0b;let _0x12871=_0x459fbd==='tv'?_0xd8c91b(0x14e):_0xd8c91b(_0x19c994._0x50e2d5);try{const _0x3cdcac=_0x459fbd==='tv'?'tv':_0xd8c91b(_0x19c994._0x3f6654),_0xd1ee63=String(_0x5cf1d4)['replace'](/\D/g,''),_0x25820f=_0xd8c91b(0x130)+_0x3cdcac+'/'+_0xd1ee63+_0xd8c91b(0x109)+TMDB_API_KEY+_0xd8c91b(_0x19c994._0x114246),_0x5baa0c=yield fetch(_0x25820f);if(!_0x5baa0c['ok'])return _0x12871;const _0x118570=yield _0x5baa0c[_0xd8c91b(_0x19c994._0x3d4853)]();let _0x25aa3f=_0x12871;if(_0x459fbd==='movie'&&_0x118570[_0xd8c91b(_0x19c994._0xa54876)])_0x25aa3f=_0x118570[_0xd8c91b(_0x19c994._0xa54876)]+_0xd8c91b(0x14f);else{if(_0x459fbd==='tv'&&_0x229d6e!=null&&_0x3adc95!=null){const _0x2b18e2='https://api.themoviedb.org/3/tv/'+_0xd1ee63+_0xd8c91b(0x119)+_0x229d6e+_0xd8c91b(0x116)+_0x3adc95+'?api_key='+TMDB_API_KEY,_0x487c78=yield fetch(_0x2b18e2);if(_0x487c78['ok']){const _0x23a92d=yield _0x487c78['json']();if(_0x23a92d[_0xd8c91b(0x10e)])_0x25aa3f=_0x23a92d['runtime']+'\x20min';else _0x118570['episode_run_time']&&_0x118570[_0xd8c91b(_0x19c994._0x598812)][_0xd8c91b(_0x19c994._0x807399)]>0x0&&(_0x25aa3f=_0x118570[_0xd8c91b(_0x19c994._0x598812)][0x0]+'\x20min');}}}return _0x25aa3f;}catch(_0x987051){return _0x12871;}});}function getStreams(_0x4a5a7c,_0x4e1353,_0x2e873c,_0x175a03){var _0x5231c4={_0x1a8669:0x126,_0x496cd8:0x14a,_0x4449ee:0x11a,_0xcd29b7:0x106,_0x2618f0:0x120,_0x55047b:0x142,_0x5643d9:0x146,_0x174e2e:0x125,_0x1ef56c:0x13f,_0x1b5237:0x143,_0xf65eb7:0x140,_0x1fe0b4:0x145,_0x4c42eb:0x135,_0x545d68:0x10f,_0x37579d:0x13e,_0x43b864:0x13c,_0x21f2ee:0x113,_0x2cfc5d:0x147,_0x510b87:0x111};return __async(this,null,function*(){var _0x3e43bd=_0x3d0b;try{var _0x28243b=_0x4e1353==='movie',_0x56d39b=_0x28243b?'https://vidsrc.me/embed/'+_0x4a5a7c:_0x3e43bd(_0x5231c4._0x1a8669)+_0x4a5a7c+'/'+(_0x2e873c||0x1)+'-'+(_0x175a03||0x1);console['log']('[VidSrc.me]\x20Fetching\x20embed\x20page:\x20'+_0x56d39b);var _0x54aafc=safeFetch(_0x56d39b,{},0x1f40),_0x3d5544=fetchTMDBDuration(_0x4a5a7c,_0x4e1353,_0x2e873c,_0x175a03),_0x117591=yield _0x54aafc,_0x103a93=yield _0x117591['text'](),_0x51ec0a=yield _0x3d5544,_0x43894a=serversLoad(_0x103a93),_0x5216fc=_0x43894a[_0x3e43bd(0x13b)],_0x1ffb80=cleanTitleString(_0x43894a[_0x3e43bd(0x14a)]),_0x583e8f=_0x1ffb80[_0x3e43bd(_0x5231c4._0x496cd8)],_0x58b028=_0x1ffb80[_0x3e43bd(_0x5231c4._0x4449ee)];console[_0x3e43bd(0x142)]('[VidSrc.me]\x20Parsed\x20servers:\x20'+_0x5216fc['length']);var _0x58ead6=[];for(var _0x3708f3=0x0;_0x3708f3<_0x5216fc[_0x3e43bd(0x140)];_0x3708f3++){var _0x2efb1c=_0x5216fc[_0x3708f3];try{console['log']('[VidSrc.me]\x20Fetching\x20RCP\x20for\x20server:\x20'+_0x2efb1c[_0x3e43bd(0x156)]);var _0xea64c2=yield safeFetch(BASEDOM+_0x3e43bd(0x15a)+_0x2efb1c[_0x3e43bd(_0x5231c4._0xcd29b7)],{},0x1388),_0x4df09a=yield _0xea64c2[_0x3e43bd(0x101)](),_0x3c23fe=rcpGrabber(_0x4df09a);if(_0x3c23fe&&_0x3c23fe[_0x3e43bd(_0x5231c4._0x2618f0)](0x0,0x8)==='/prorcp/'){console[_0x3e43bd(_0x5231c4._0x55047b)](_0x3e43bd(0x122)+_0x2efb1c[_0x3e43bd(0x156)]);var _0x406401=yield PRORCPhandler(_0x3c23fe['replace'](_0x3e43bd(_0x5231c4._0x5643d9),''));if(_0x406401){var _0x3bdf69=_0x406401;if(_0x3bdf69['includes']('__TOKEN__')||_0x3bdf69['includes']('__TOKENPG__'))try{var _0x429003=new URL(_0x3bdf69['split'](_0x3e43bd(_0x5231c4._0x174e2e))[0x0]),_0x537d87=_0x429003[_0x3e43bd(_0x5231c4._0x1ef56c)];console[_0x3e43bd(0x142)]('[VidSrc.me]\x20Generating\x20token\x20for\x20host:\x20'+_0x537d87);var _0x431927=yield safeFetch('https://'+_0x537d87+'/generate.php',{'headers':{'Referer':'https://vidsrc.me/','User-Agent':UA}},0xfa0),_0x324954=yield _0x431927[_0x3e43bd(0x101)](),_0x401bd5=_0x324954[_0x3e43bd(0x145)]();_0x401bd5&&_0x401bd5[_0x3e43bd(0x140)]>0xa&&(_0x3bdf69=_0x3bdf69['replace'](/__TOKEN__/g,_0x401bd5)[_0x3e43bd(0x149)](/__TOKENPG__/g,_0x401bd5),console['log']('[VidSrc.me]\x20Token\x20successfully\x20generated\x20&\x20injected'));}catch(_0x4c414a){console['log'](_0x3e43bd(_0x5231c4._0x1b5237)+_0x4c414a['message']);}var _0x32cb9f=_0x3bdf69[_0x3e43bd(0x12b)](_0x3e43bd(_0x5231c4._0x174e2e));for(var _0x4c8eb4=0x0;_0x4c8eb4<_0x32cb9f[_0x3e43bd(_0x5231c4._0xf65eb7)];_0x4c8eb4++){var _0x201279=_0x32cb9f[_0x4c8eb4][_0x3e43bd(_0x5231c4._0x1fe0b4)]();if(!_0x201279)continue;var _0x53ea3d=_0x3e43bd(_0x5231c4._0x4c42eb);if(_0x201279['includes']('/720/')||_0x201279['includes'](_0x3e43bd(0x14c))||_0x201279[_0x3e43bd(_0x5231c4._0x545d68)](_0x3e43bd(0x157)))_0x53ea3d='720p';else{if(_0x201279[_0x3e43bd(0x10f)]('/360/')||_0x201279['includes']('360p')||_0x201279['includes']('/7a67b'))_0x53ea3d='360p';else(_0x201279['includes'](_0x3e43bd(0x128))||_0x201279['includes'](_0x3e43bd(_0x5231c4._0x4c42eb)))&&(_0x53ea3d='1080p');}var _0x537523=_0x53ea3d[_0x3e43bd(_0x5231c4._0x37579d)](),_0x11561b=_0x2efb1c['name']['replace'](/\D+/g,''),_0x503df9=_0x11561b?_0x3e43bd(0x104)+_0x11561b:'Server\x20'+(_0x3708f3+0x1);_0x32cb9f[_0x3e43bd(0x140)]>0x1&&(_0x503df9+=_0x3e43bd(_0x5231c4._0x43b864)+(_0x4c8eb4+0x1)+')');var _0x1cf24b='MKV';if(_0x201279['includes']('.m3u8'))_0x1cf24b=_0x3e43bd(0x11c);else{if(_0x201279['includes']('.mp4'))_0x1cf24b='MP4';}var _0x2e7896='VidSrc\x20|\x20'+_0x537523+_0x3e43bd(0x11b),_0x50479b=!_0x28243b&&_0x2e873c&&_0x175a03?'\x20S'+String(_0x2e873c)['padStart'](0x2,'0')+'E'+String(_0x175a03)[_0x3e43bd(0x155)](0x2,'0'):'',_0x4f484d=_0x3e43bd(_0x5231c4._0x21f2ee)+_0x583e8f+_0x50479b+'\x20-\x20('+_0x58b028+')',_0x3f0f71='⭐\x20'+_0x537523+'\x20|\x20🌍\x20Original-Audio\x20|\x20🎧\x20AAC',_0x5c0090=_0x3e43bd(0x110)+_0x1cf24b+'\x20|\x20🎥\x20x264\x20|\x20⏳\x20'+_0x51ec0a,_0x40a267='📎\x20'+_0x503df9,_0x4ab2d3=_0x4f484d+'\x0a'+_0x3f0f71+'\x0a'+_0x5c0090+'\x0a'+_0x40a267;_0x58ead6[_0x3e43bd(0x159)]({'name':_0x2e7896,'title':_0x4ab2d3,'size':_0x4ab2d3,'description':_0x4ab2d3,'url':_0x201279,'quality':'','language':'','headers':{},'subtitles':[],'provider':_0x3e43bd(0x14b)});}}}}catch(_0x4668f5){console[_0x3e43bd(0x142)](_0x3e43bd(_0x5231c4._0x2cfc5d)+_0x2efb1c[_0x3e43bd(0x156)]+'\x20error:\x20'+_0x4668f5[_0x3e43bd(_0x5231c4._0x510b87)]);}}return console['log'](_0x3e43bd(0xfe)+_0x58ead6['length']),_0x58ead6;}catch(_0x1419cf){return console['log']('[VidSrc.me]\x20Scraper\x20error:\x20'+_0x1419cf[_0x3e43bd(0x111)]),[];}});}module['exports']={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidsrc", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VidSrc", "vidsrc");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
