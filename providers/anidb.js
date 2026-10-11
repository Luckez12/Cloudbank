// Imported provider: anidb; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x4bb611=_0x15ba;(function(_0x53272e,_0x4f836d){const _0x51aaa9={_0x40bce7:0xb9,_0x1b8ec9:0xd4,_0x47b0b0:0xd0},_0x12f9ae=_0x15ba,_0x4d0bca=_0x53272e();while(!![]){try{const _0x56ef99=parseInt(_0x12f9ae(_0x51aaa9._0x40bce7))/0x1+-parseInt(_0x12f9ae(_0x51aaa9._0x1b8ec9))/0x2+parseInt(_0x12f9ae(0xd1))/0x3+parseInt(_0x12f9ae(0xf9))/0x4*(-parseInt(_0x12f9ae(0xed))/0x5)+-parseInt(_0x12f9ae(_0x51aaa9._0x47b0b0))/0x6*(parseInt(_0x12f9ae(0xd6))/0x7)+parseInt(_0x12f9ae(0xe8))/0x8+-parseInt(_0x12f9ae(0xf4))/0x9*(-parseInt(_0x12f9ae(0xe2))/0xa);if(_0x56ef99===_0x4f836d)break;else _0x4d0bca['push'](_0x4d0bca['shift']());}catch(_0x391ee3){_0x4d0bca['push'](_0x4d0bca['shift']());}}}(_0x3bbb,0x1f960));var __async=(_0x3201be,_0x47356b,_0x5aa756)=>{return new Promise((_0x14ddc2,_0x4f6472)=>{const _0x3fb712=_0x15ba;var _0x198337=_0x477364=>{try{_0x51e3f4(_0x5aa756['next'](_0x477364));}catch(_0x1535ed){_0x4f6472(_0x1535ed);}},_0x3758e1=_0x1bb98b=>{try{_0x51e3f4(_0x5aa756['throw'](_0x1bb98b));}catch(_0x114279){_0x4f6472(_0x114279);}},_0x51e3f4=_0x5a9902=>_0x5a9902[_0x3fb712(0xd9)]?_0x14ddc2(_0x5a9902[_0x3fb712(0xb1)]):Promise[_0x3fb712(0xaf)](_0x5a9902['value'])['then'](_0x198337,_0x3758e1);_0x51e3f4((_0x5aa756=_0x5aa756['apply'](_0x3201be,_0x47356b))['next']());});},cheerio=require('cheerio-without-node-native'),TMDB_API_KEY='1865f43a0549ca50d341dd9ab8b29f49',BASE_URL=_0x4bb611(0xe0),USER_AGENT=_0x4bb611(0xd3);function getTmdbInfo(_0x2c6410,_0x2668b5,_0x507ecc,_0x2885de){const _0x385ad5={_0x2f2dff:0xcb,_0x2e1e2c:0xcb,_0x2ac5b3:0xf0,_0x8e28d8:0xbe,_0x34ca4f:0xea,_0xa7efb0:0xb3,_0x50cf4a:0xca};return __async(this,null,function*(){const _0x4e03c4=_0x15ba,_0x4b1147=_0x2668b5==='tv'?'tv':'movie',_0x5374d6=Number[_0x4e03c4(_0x385ad5._0x2f2dff)](_0x507ecc)?_0x507ecc:0x1,_0x2c99e3=Number[_0x4e03c4(_0x385ad5._0x2e1e2c)](_0x2885de)?_0x2885de:0x1;try{if(_0x2668b5==='tv'){const _0x164a10='https://api.themoviedb.org/3/tv/'+_0x2c6410+'?api_key='+TMDB_API_KEY,_0x5d0f33=yield fetch(_0x164a10,{'headers':{'User-Agent':USER_AGENT,'Accept':'application/json'}});if(!_0x5d0f33['ok'])return{'title':'','year':null,'runtime':0x0};const _0xcaedb8=yield _0x5d0f33['json'](),_0x1f57be=_0xcaedb8['name']||'',_0x22eb13=_0xcaedb8[_0x4e03c4(0xa9)]?parseInt(_0xcaedb8['first_air_date']['slice'](0x0,0x4),0xa):null,_0x5ae794=_0x4e03c4(0xef)+_0x2c6410+'/season/'+_0x5374d6+'/episode/'+_0x2c99e3+'?api_key='+TMDB_API_KEY,_0x528a1c=yield fetch(_0x5ae794,{'headers':{'User-Agent':USER_AGENT,'Accept':_0x4e03c4(_0x385ad5._0x2ac5b3)}});let _0x447c00=_0xcaedb8[_0x4e03c4(0xb8)]?_0xcaedb8['episode_run_time'][0x0]:0x0;if(_0x528a1c['ok']){const _0x35eabd=yield _0x528a1c['json']();if(_0x35eabd['runtime'])_0x447c00=_0x35eabd[_0x4e03c4(0xc1)];}return{'title':_0x1f57be,'year':_0x22eb13,'runtime':_0x447c00};}else{const _0x18407a=_0x4e03c4(_0x385ad5._0x8e28d8)+_0x2c6410+_0x4e03c4(_0x385ad5._0x34ca4f)+TMDB_API_KEY,_0x375c05=yield fetch(_0x18407a,{'headers':{'User-Agent':USER_AGENT,'Accept':_0x4e03c4(_0x385ad5._0x2ac5b3)}});if(!_0x375c05['ok'])return{'title':'','year':null,'runtime':0x0};const _0x4cfc62=yield _0x375c05[_0x4e03c4(_0x385ad5._0xa7efb0)](),_0x3c4ede=_0x4cfc62[_0x4e03c4(0xb7)]?parseInt(_0x4cfc62[_0x4e03c4(0xb7)]['slice'](0x0,0x4),0xa):null;return{'title':_0x4cfc62[_0x4e03c4(_0x385ad5._0x50cf4a)]||'','year':_0x3c4ede,'runtime':_0x4cfc62['runtime']||0x0};}}catch(_0x213d24){return{'title':'','year':null,'runtime':0x0};}});}function normalize(_0x3736ac){const _0x5d5041={_0x3b7518:0xbd,_0x26707a:0xc2},_0x32ba83=_0x4bb611;return String(_0x3736ac||'')['toLowerCase']()[_0x32ba83(_0x5d5041._0x3b7518)](/[^a-z0-9]+/g,'\x20')[_0x32ba83(_0x5d5041._0x26707a)]();}function rankResults(_0x25b0ce,_0xe810ca){const _0x4c88b1={_0x206d9e:0xb0,_0x5c87fb:0xb0,_0x4cd509:0xda},_0x3874a0=_0x4bb611,_0x9ee06d=normalize(_0xe810ca),_0xbc5174=[],_0x32b90e=[];for(let _0x59c216=0x0;_0x59c216<_0x25b0ce[_0x3874a0(0xfa)];_0x59c216++){const _0x51a8fd=normalize(_0x25b0ce[_0x59c216]['title']);if(_0x51a8fd===_0x9ee06d)_0xbc5174[_0x3874a0(_0x4c88b1._0x206d9e)](_0x25b0ce[_0x59c216]);else{if(_0x51a8fd['indexOf'](_0x9ee06d)!==-0x1||_0x9ee06d['indexOf'](_0x51a8fd)!==-0x1)_0x32b90e[_0x3874a0(_0x4c88b1._0x5c87fb)](_0x25b0ce[_0x59c216]);}}return _0xbc5174[_0x3874a0(_0x4c88b1._0x4cd509)](_0x32b90e);}function absolutize(_0x26b9cc){const _0x21a207={_0x4e9df6:0xae,_0x10a1df:0xf3},_0x56fe15=_0x4bb611;if(!_0x26b9cc)return'';if(_0x26b9cc['indexOf'](_0x56fe15(_0x21a207._0x4e9df6))===0x0)return _0x26b9cc;if(_0x26b9cc[_0x56fe15(0xc6)]('//')===0x0)return _0x56fe15(_0x21a207._0x10a1df)+_0x26b9cc;if(_0x26b9cc['charAt'](0x0)==='/')return BASE_URL+_0x26b9cc;return BASE_URL+'/'+_0x26b9cc;}function searchSite(_0x54b77e){const _0x3c6cec={_0x360679:0xf1},_0x131591={_0xb64e89:0xdb,_0x40552d:0xaa,_0x151e34:0xf2,_0x3bda77:0xc2};return __async(this,null,function*(){const _0x104412=_0x15ba,_0x9fb706=[],_0x354c9d={};let _0x2109b2;try{const _0x2ff12a=yield fetch(BASE_URL+_0x104412(_0x3c6cec._0x360679)+encodeURIComponent(_0x54b77e),{'headers':{'User-Agent':USER_AGENT,'Accept':_0x104412(0xc4),'Accept-Language':_0x104412(0xb5)}});_0x2109b2=yield _0x2ff12a['text']();}catch(_0x2dcf28){return _0x9fb706;}const _0x446cd0=cheerio[_0x104412(0xcf)](_0x2109b2);return _0x446cd0(_0x104412(0xd2))['each'](function(_0x3a5c27,_0x377962){const _0x433d16=_0x104412,_0x2a78ff=absolutize(_0x446cd0(_0x377962)[_0x433d16(_0x131591._0xb64e89)]('href')||''),_0xa5e15a=(_0x446cd0(_0x377962)['attr']('title')||_0x446cd0(_0x377962)[_0x433d16(_0x131591._0x40552d)](_0x433d16(_0x131591._0x151e34))[_0x433d16(_0x131591._0xb64e89)](_0x433d16(0xf6))||'')[_0x433d16(_0x131591._0x3bda77)]();_0x2a78ff&&_0xa5e15a&&!_0x354c9d[_0x2a78ff]&&(_0x354c9d[_0x2a78ff]=!![],_0x9fb706['push']({'url':_0x2a78ff,'title':_0xa5e15a}));}),_0x9fb706;});}function getEpisodes(_0x1d5ecf){const _0x17cee0={_0x3974c9:0xcc,_0x183a8d:0xc9};return __async(this,null,function*(){const _0x30a83a=_0x15ba,_0x57c586=yield fetch(BASE_URL+_0x30a83a(0xb4)+_0x1d5ecf+'/episodes',{'headers':{'User-Agent':USER_AGENT,'X-Requested-With':_0x30a83a(_0x17cee0._0x3974c9)}}),_0x1de86c=yield _0x57c586[_0x30a83a(0xb3)]();return _0x1de86c&&_0x1de86c[_0x30a83a(_0x17cee0._0x183a8d)]?_0x1de86c[_0x30a83a(_0x17cee0._0x183a8d)]:[];});}function _0x3bbb(){const _0x1908b8=['l2fWAs9MCM9UDgvUzc9HBMLTzs8','zw4TvvmSzw47Ct0WlJK','Bwf0y2G','CMvSzwfZzv9KyxrL','zxbPC29Kzv9YDw5FDgLTzq','nZe0mgDUEgDuBG','l2fUAw1LlW','8j+oIYa','Dgv4Da','CMvWBgfJzq','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY9TB3zPzs8','w0fUAurcxsa','DxjS','CNvUDgLTzq','DhjPBq','iIbt','Dgv4Dc9ODg1SlgfWCgXPy2f0Aw9Ul3HODg1Sk3HTBcXHChbSAwnHDgLVBI94BwW7Ct0WlJKSkI8Qo3e9mc44','Cg9W','Aw5KzxHpzG','zxjYB3i','A29YzwfU','zxbPC29Kzxm','DgL0Bgu','AxnjBNrLz2vY','we1mshr0CfjLCxvLC3q','4PQHieHmuYb8iokpSE+4JYa','uKfxic8Gu1vc','Bg9Hza','nNLbzw5yCG','ndGZmZa5B2Lzv0Dd','ys5HBMLTzs1JyxjK','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2','mJaYnZuWA3PbB0Pe','BwvZC2fNzq','nJq4otqYEMnrtwnH','ihWG8j+tJcbbBMLeqIbtDhjLyw0','BgfUz3vHz2vZ','zg9Uzq','y29Uy2f0','yxr0CG','8j+hSpcFH7C','BMfTzq','AMfWyw5LC2u','8j+hUVcFH7G','Ahr0Chm6lY9HBMLKyI5HCha','l2fWAs9MCM9UDgvUzc9LCgLZB2rLlW','nJbhtMjVte0','EwvHCG','A29Y','ig1PBG','ywXS','zxHWB3j0CW','nZqZmtm2vuv0z25V','ihWG8j+uIIboyxrPDMu','p2fWAv9RzxK9','Aw5JBhvKzxm','zw1IzwrFDxjS','mJu4mJvxqxvIqLO','qw5PreiGFcbbDxrVihWG','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','yxbWBgLJyxrPB24VANnVBG','l2jYB3DZzt9Xpq','Aw1N','Ahr0Chm6','mtG2nduZD0P2uKjY','rw5NBgLZAcbbDwrPBW','ywX0','y29Kzq','zw5NBgLZAa','ndH5weXKy1C','BgvUz3rO','zMLYC3rFywLYx2rHDgu','zMLUza','zw5N','8j+xO++4JW','ihn0CMvHBxm','Ahr0Ca','CMvZB2X2zq','ChvZAa','DMfSDwu','w0fUAurcxsbMB3vUzca','ANnVBG'];_0x3bbb=function(){return _0x1908b8;};return _0x3bbb();}function getLanguages(_0x465bf5,_0x353f32){const _0x1a5071={_0x441614:0xba,_0x5bdf7d:0xd8};return __async(this,null,function*(){const _0x24b7aa=_0x15ba,_0x3fd6ec=yield fetch(BASE_URL+_0x24b7aa(0xe1)+_0x465bf5+'/languages',{'headers':{'User-Agent':USER_AGENT,'X-Requested-With':'XMLHttpRequest','Referer':BASE_URL+_0x24b7aa(_0x1a5071._0x441614)+_0x353f32}}),_0x7fe0f0=yield _0x3fd6ec['json']();return _0x7fe0f0&&_0x7fe0f0[_0x24b7aa(_0x1a5071._0x5bdf7d)]?_0x7fe0f0[_0x24b7aa(0xd8)]:[];});}var HLS_REGEXES=[/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,/["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i];function extractEmbed(_0x24053c){const _0x5438e7={_0x10cf23:0xb6};return __async(this,null,function*(){const _0x5a4ab9=_0x15ba;try{const _0x378bcd=yield fetch(_0x24053c,{'headers':{'User-Agent':USER_AGENT,'Referer':BASE_URL+'/'}}),_0x4eba61=yield _0x378bcd[_0x5a4ab9(0xbc)]();for(let _0xa21305=0x0;_0xa21305<HLS_REGEXES['length'];_0xa21305++){const _0x2e03fd=_0x4eba61[_0x5a4ab9(_0x5438e7._0x10cf23)](HLS_REGEXES[_0xa21305]);if(_0x2e03fd&&_0x2e03fd[0x1])return _0x2e03fd[0x1];}}catch(_0x3f4868){}return null;});}function getStreams(_0xa7d540,_0x41060f,_0x37ec66,_0x45fdec){const _0x353538={_0x581c7c:0xbf,_0x5c10bd:0xc5,_0x210dd0:0xfa,_0x1bd778:0xec,_0xceeaae:0xe6,_0x3212c2:0xce,_0x4fdf11:0xeb,_0x501d83:0xab,_0x4ad37a:0xdf,_0xf6df98:0xdc,_0x2ee0f0:0xe3,_0xb6bc62:0xc1,_0x54cd17:0xc1,_0x44b1cd:0xe5,_0x54e52e:0xbb,_0x1eb1f3:0xe9,_0x506212:0xcd,_0x35e168:0xd7,_0x2432e2:0xb0,_0x1ae731:0xee,_0x5396f7:0xb2,_0x4c7641:0xc7,_0x19588f:0xd5};return __async(this,null,function*(){const _0x435279=_0x15ba;try{const _0x2988e6=yield getTmdbInfo(_0xa7d540,_0x41060f,_0x37ec66,_0x45fdec);if(!_0x2988e6[_0x435279(0xca)])return[];console['log'](_0x435279(_0x353538._0x581c7c)+_0x41060f+'\x20\x22'+_0x2988e6['title']+_0x435279(0xc3)+_0x37ec66+'E'+_0x45fdec);const _0xfb33e=rankResults(yield searchSite(_0x2988e6['title']),_0x2988e6['title']),_0x581036=_0x41060f==='tv'?_0x45fdec||0x1:0x1;for(let _0x1d692b=0x0;_0x1d692b<Math['min'](0x3,_0xfb33e['length']);_0x1d692b++){const _0x5c7b8d=_0xfb33e[_0x1d692b],_0xda1ce2=_0x5c7b8d[_0x435279(0xc0)]['split']('/')['filter'](Boolean)[_0x435279(0xc5)]()||'',_0x14918e=_0xda1ce2['split']('-')[_0x435279(_0x353538._0x5c10bd)](),_0xe5ca01=parseInt(_0x14918e,0xa);if(!_0xe5ca01)continue;let _0x119c32=[];try{_0x119c32=yield getEpisodes(_0xe5ca01);}catch(_0x32f686){continue;}if(!_0x119c32[_0x435279(_0x353538._0x210dd0)])continue;let _0xd170c2=null;for(let _0xd6c271=0x0;_0xd6c271<_0x119c32['length'];_0xd6c271++){if(_0x119c32[_0xd6c271]['number']===_0x581036){_0xd170c2=_0x119c32[_0xd6c271];break;}}if(!_0xd170c2)_0xd170c2=_0x119c32[_0x581036-0x1]||_0x119c32[0x0];if(!_0xd170c2||_0xd170c2['id']==null)continue;let _0x21a936=[];try{_0x21a936=yield getLanguages(_0xd170c2['id'],_0xda1ce2);}catch(_0x391440){continue;}const _0x34c2b3=[];for(let _0xfb51fa=0x0;_0xfb51fa<_0x21a936['length'];_0xfb51fa++){const _0x4cdccc=_0x21a936[_0xfb51fa][_0x435279(_0x353538._0x1bd778)];if(_0x4cdccc)_0x34c2b3['push']({'url':_0x4cdccc,'name':_0x21a936[_0xfb51fa][_0x435279(0xdd)]||_0x21a936[_0xfb51fa][_0x435279(0xf7)]||''});}if(!_0x34c2b3['length'])continue;const _0x8a1131=yield Promise[_0x435279(_0x353538._0xceeaae)](_0x34c2b3['map'](function(_0x3278ac){const _0x129cf5=_0x435279;return extractEmbed(_0x3278ac[_0x129cf5(0xc0)]);})),_0x39588e=[],_0x1eed04={};for(let _0x5da8e5=0x0;_0x5da8e5<_0x8a1131['length'];_0x5da8e5++){const _0x43d7a9=_0x8a1131[_0x5da8e5];if(!_0x43d7a9||_0x1eed04[_0x43d7a9])continue;_0x1eed04[_0x43d7a9]=!![];const _0x402a3e=String(_0x34c2b3[_0x5da8e5][_0x435279(0xdd)]||'')['toLowerCase']();let _0x3a031a=_0x34c2b3[_0x5da8e5][_0x435279(0xdd)]?_0x34c2b3[_0x5da8e5][_0x435279(0xdd)]:_0x435279(_0x353538._0x3212c2),_0x34c899=_0x435279(0xac),_0x481493='Subbed\x20/\x20Dubbed';if(_0x402a3e[_0x435279(_0x353538._0x4fdf11)](_0x435279(0xde))||_0x402a3e[_0x435279(0xeb)]('jp')||_0x402a3e[_0x435279(0xeb)]('jap'))_0x34c899='🇯🇵',_0x481493='Japanese\x20Audio';else{if(_0x402a3e['includes'](_0x435279(0xf8))||_0x402a3e['includes'](_0x435279(_0x353538._0x501d83))||_0x402a3e[_0x435279(0xeb)]('en'))_0x34c899=_0x435279(_0x353538._0x4ad37a),_0x481493=_0x435279(0xf5);else(_0x402a3e['includes'](_0x435279(0xc8))||_0x402a3e[_0x435279(0xeb)](_0x435279(0xe4))||_0x402a3e['includes']('kr'))&&(_0x34c899=_0x435279(_0x353538._0xf6df98),_0x481493='Korean\x20Audio');}const _0x33e2de=_0x2988e6[_0x435279(_0x353538._0x2ee0f0)]?'\x20('+_0x2988e6[_0x435279(_0x353538._0x2ee0f0)]+')':'';let _0x4e63e3='N/A';_0x2988e6[_0x435279(_0x353538._0xb6bc62)]&&Number['isInteger'](_0x2988e6['runtime'])&&_0x2988e6[_0x435279(0xc1)]>0x0&&(_0x4e63e3=_0x2988e6[_0x435279(_0x353538._0x54cd17)]+_0x435279(_0x353538._0x44b1cd));var _0x2a4dc5=_0x435279(_0x353538._0x54e52e)+_0x2988e6[_0x435279(0xca)]+_0x33e2de,_0x5191ff='🏷️\x20Auto\x20|\x20'+_0x34c899+'\x20'+_0x3a031a+_0x435279(_0x353538._0x1eb1f3),_0x1f71d8=_0x435279(_0x353538._0x506212)+_0x4e63e3+_0x435279(_0x353538._0x35e168),_0x159785=_0x2a4dc5+'\x0a'+_0x5191ff+'\x0a'+_0x1f71d8;_0x39588e[_0x435279(_0x353538._0x2432e2)]({'name':_0x435279(_0x353538._0x1ae731)+_0x481493,'title':_0x159785,'url':_0x43d7a9,'quality':'Auto','description':_0x159785,'headers':{'Referer':BASE_URL+'/'}});}if(_0x39588e[_0x435279(0xfa)])return console['log'](_0x435279(_0x353538._0x5396f7)+_0x39588e['length']+_0x435279(0xad)),_0x39588e;}return console['log']('[AniDB]\x20no\x20streams\x20found'),[];}catch(_0x3c169f){return console[_0x435279(_0x353538._0x4c7641)]('[AniDB]\x20Fatal:\x20'+(_0x3c169f&&_0x3c169f[_0x435279(_0x353538._0x19588f)])),[];}});}function _0x15ba(_0x51578c,_0x1550cf){_0x51578c=_0x51578c-0xa9;const _0x3bbb14=_0x3bbb();let _0x15bafa=_0x3bbb14[_0x51578c];if(_0x15ba['SGTBeU']===undefined){var _0x1ec826=function(_0x2eef8d){const _0x460336='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x3201be='',_0x47356b='';for(let _0x5aa756=0x0,_0x14ddc2,_0x4f6472,_0x198337=0x0;_0x4f6472=_0x2eef8d['charAt'](_0x198337++);~_0x4f6472&&(_0x14ddc2=_0x5aa756%0x4?_0x14ddc2*0x40+_0x4f6472:_0x4f6472,_0x5aa756++%0x4)?_0x3201be+=String['fromCharCode'](0xff&_0x14ddc2>>(-0x2*_0x5aa756&0x6)):0x0){_0x4f6472=_0x460336['indexOf'](_0x4f6472);}for(let _0x3758e1=0x0,_0x51e3f4=_0x3201be['length'];_0x3758e1<_0x51e3f4;_0x3758e1++){_0x47356b+='%'+('00'+_0x3201be['charCodeAt'](_0x3758e1)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x47356b);};_0x15ba['LYydZP']=_0x1ec826,_0x15ba['hvANvm']={},_0x15ba['SGTBeU']=!![];}const _0x55e8e9=_0x3bbb14[0x0],_0x41789c=_0x51578c+_0x55e8e9,_0x1b4f0c=_0x15ba['hvANvm'][_0x41789c];return!_0x1b4f0c?(_0x15bafa=_0x15ba['LYydZP'](_0x15bafa),_0x15ba['hvANvm'][_0x41789c]=_0x15bafa):_0x15bafa=_0x1b4f0c,_0x15bafa;}module[_0x4bb611(0xe7)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "anidb", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AniDB", "anidb");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
