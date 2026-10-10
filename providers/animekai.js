// Imported provider: animekai; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x4435af=_0x4817;(function(_0x670333,_0x44edcb){const _0x33a468={_0x4cfd88:0x191,_0x509e88:0x1cb,_0xa81b9e:0x1c6,_0x29a97d:0x193,_0x13278b:0x17b,_0xe4c99e:0x18a,_0x1a8610:0x1a4,_0x585bd4:0x1ce},_0x301a2b=_0x4817,_0x5ae992=_0x670333();while(!![]){try{const _0x4878be=parseInt(_0x301a2b(_0x33a468._0x4cfd88))/0x1*(-parseInt(_0x301a2b(_0x33a468._0x509e88))/0x2)+parseInt(_0x301a2b(_0x33a468._0xa81b9e))/0x3+-parseInt(_0x301a2b(_0x33a468._0x29a97d))/0x4*(parseInt(_0x301a2b(0x1a5))/0x5)+-parseInt(_0x301a2b(0x1d2))/0x6*(parseInt(_0x301a2b(_0x33a468._0x13278b))/0x7)+-parseInt(_0x301a2b(_0x33a468._0xe4c99e))/0x8*(parseInt(_0x301a2b(0x1c8))/0x9)+-parseInt(_0x301a2b(0x170))/0xa*(parseInt(_0x301a2b(_0x33a468._0x1a8610))/0xb)+-parseInt(_0x301a2b(_0x33a468._0x585bd4))/0xc*(-parseInt(_0x301a2b(0x1d3))/0xd);if(_0x4878be===_0x44edcb)break;else _0x5ae992['push'](_0x5ae992['shift']());}catch(_0x3c555d){_0x5ae992['push'](_0x5ae992['shift']());}}}(_0xc6b9,0xa3293));var __async=(_0x17d3f1,_0x59b624,_0x4b70a2)=>{return new Promise((_0x469b67,_0x2dc1ea)=>{const _0x3297e2={_0x167b29:0x19d},_0x3c92e2=_0x4817;var _0x3279b6=_0x2815f1=>{try{_0x305f52(_0x4b70a2['next'](_0x2815f1));}catch(_0x5c447f){_0x2dc1ea(_0x5c447f);}},_0x5898be=_0x497482=>{const _0x411fa6=_0x4817;try{_0x305f52(_0x4b70a2[_0x411fa6(_0x3297e2._0x167b29)](_0x497482));}catch(_0x1c9670){_0x2dc1ea(_0x1c9670);}},_0x305f52=_0x5369ae=>_0x5369ae['done']?_0x469b67(_0x5369ae[_0x3c92e2(0x18c)]):Promise[_0x3c92e2(0x1d6)](_0x5369ae['value'])[_0x3c92e2(0x19b)](_0x3279b6,_0x5898be);_0x305f52((_0x4b70a2=_0x4b70a2['apply'](_0x17d3f1,_0x59b624))[_0x3c92e2(0x1ac)]());});},TMDB_API_KEY='1865f43a0549ca50d341dd9ab8b29f49',TMDB_BASE=_0x4435af(0x1d8),ANIKAI_BASE='https://www3.anikai.cc',UA=_0x4435af(0x172);function getResolutionEmoji(_0x5d6296){const _0x2f670c={_0x54e134:0x1a7,_0x52ca15:0x1b8,_0x1119a6:0x181,_0x2a3533:0x17a,_0x18f854:0x18d,_0x190e45:0x1a2,_0x3ae7f0:0x1bf},_0x22f3c1=_0x4435af,_0x311c5d=String(_0x5d6296||'')[_0x22f3c1(_0x2f670c._0x54e134)]();if(_0x311c5d['includes']('2160')||_0x311c5d[_0x22f3c1(0x1b8)]('4k')||_0x311c5d[_0x22f3c1(_0x2f670c._0x52ca15)]('uhd'))return _0x22f3c1(_0x2f670c._0x1119a6);if(_0x311c5d[_0x22f3c1(0x1b8)]('1080')||_0x311c5d[_0x22f3c1(0x1b8)](_0x22f3c1(_0x2f670c._0x2a3533)))return'🔥\x201080p';if(_0x311c5d['includes'](_0x22f3c1(_0x2f670c._0x18f854))||_0x311c5d[_0x22f3c1(0x1b8)]('hd'))return'💎\x20720p';if(_0x311c5d[_0x22f3c1(_0x2f670c._0x52ca15)]('480')||_0x311c5d['includes']('sd'))return _0x22f3c1(_0x2f670c._0x190e45);return _0x22f3c1(_0x2f670c._0x3ae7f0)+(_0x5d6296||_0x22f3c1(0x1ca));}function qualityRank(_0x3e570f){const _0x187920={_0x3c977b:0x17d},_0x566bef=_0x4435af;if(/2160p|4k/i['test'](_0x3e570f))return 0x4;if(/1080p/i['test'](_0x3e570f))return 0x3;if(/720p/i[_0x566bef(_0x187920._0x3c977b)](_0x3e570f))return 0x2;if(/480p/i['test'](_0x3e570f))return 0x1;return 0x0;}function getInvertedSortTag(_0x557502,_0x194f6a=0xf423f){const _0x153b4b=_0x4435af,_0x380bcb=Math['max'](0x0,parseInt(_0x557502,0xa)||0x0),_0x4535cb=Math['max'](0x0,_0x194f6a-_0x380bcb),_0x56fe14=_0x4535cb[_0x153b4b(0x1af)](0x2)['padStart'](0x14,'0');return _0x56fe14['split']('')[_0x153b4b(0x196)](_0x319a11=>_0x319a11==='1'?'\ufeff':'​')[_0x153b4b(0x198)]('');}function getSimilarity(_0x323999,_0x2c369e){const _0x52f49c={_0x4f985d:0x1c1},_0xb65d8f={_0x457880:0x19c},_0x5cb6cb=_0x4435af;if(!_0x323999||!_0x2c369e)return 0x0;const _0x1fb0f5=_0x323999[_0x5cb6cb(0x1a7)]()['replace'](/[^a-z0-9]/g,''),_0x12336f=_0x2c369e[_0x5cb6cb(0x1a7)]()[_0x5cb6cb(0x1a9)](/[^a-z0-9]/g,'');if(_0x1fb0f5===_0x12336f)return 0x1;if(_0x1fb0f5[_0x5cb6cb(_0x52f49c._0x4f985d)]<0x2||_0x12336f[_0x5cb6cb(0x1c1)]<0x2)return 0x0;const _0x584da9=_0x145c2f=>{const _0x261514=_0x5cb6cb,_0x2a47d8=new Set();for(let _0x17c08e=0x0;_0x17c08e<_0x145c2f['length']-0x1;_0x17c08e++)_0x2a47d8['add'](_0x145c2f[_0x261514(_0xb65d8f._0x457880)](_0x17c08e,_0x17c08e+0x2));return _0x2a47d8;},_0x4b45c2=_0x584da9(_0x1fb0f5),_0x569683=_0x584da9(_0x12336f);let _0x54d9a1=0x0;for(const _0x4484c2 of _0x4b45c2)if(_0x569683[_0x5cb6cb(0x1c0)](_0x4484c2))_0x54d9a1++;return 0x2*_0x54d9a1/(_0x4b45c2[_0x5cb6cb(0x1d5)]+_0x569683[_0x5cb6cb(0x1d5)]);}function toRoman(_0x54d985){const _0x2f82d1=[[0xa,'X'],[0x9,'IX'],[0x5,'V'],[0x4,'IV'],[0x1,'I']];let _0x44fb98='';for(const [_0x4b4f67,_0x11f830]of _0x2f82d1){while(_0x54d985>=_0x4b4f67){_0x44fb98+=_0x11f830,_0x54d985-=_0x4b4f67;}}return _0x44fb98;}function isMovieOrSpecial(_0x215627,_0x26fd94){const _0x36ab93={_0x3f117e:0x1b8,_0x194aeb:0x1b7,_0x1581c9:0x173,_0x398370:0x1b6,_0x5b2716:0x18f},_0x18d813=_0x4435af,_0x26cd64=_0x215627[_0x18d813(0x1a7)]();if(_0x26cd64[_0x18d813(0x1b8)](_0x18d813(0x178))||_0x26cd64['includes'](_0x18d813(0x17f))||_0x26cd64['includes']('compilation')||_0x26cd64[_0x18d813(0x1b8)](_0x18d813(0x199))||_0x26cd64[_0x18d813(0x1b8)]('ova')||_0x26cd64[_0x18d813(_0x36ab93._0x3f117e)](_0x18d813(_0x36ab93._0x194aeb))||_0x26cd64['includes'](_0x18d813(0x1c5))||_0x26cd64[_0x18d813(_0x36ab93._0x3f117e)](_0x18d813(_0x36ab93._0x1581c9))||_0x26cd64['includes']('mini')||_0x26cd64['includes']('reigen')||_0x26cd64['includes'](_0x18d813(_0x36ab93._0x398370))||_0x26cd64['includes'](_0x18d813(0x1b0))||_0x26cd64['includes'](_0x18d813(_0x36ab93._0x5b2716))||_0x26cd64['endsWith']('-sp')||_0x26cd64[_0x18d813(0x1d1)](_0x18d813(0x1cf))||_0x26cd64[_0x18d813(0x1d1)]('-ona')||_0x26cd64[_0x18d813(0x1d1)]('-special')||_0x26cd64['endsWith']('-movie')||_0x26cd64[_0x18d813(0x1d1)]('-film'))return!![];if(_0x26fd94&&(_0x26fd94===_0x18d813(0x178)||_0x26fd94==='ova'||_0x26fd94==='music'||_0x26fd94==='tvshort'))return!![];return![];}function imdbToTmdb(_0x5e213c){const _0x57acec={_0x1c0674:0x1d4,_0x4e74ef:0x1ab};return __async(this,null,function*(){const _0x5375b0=_0x4817;try{const _0x189546=TMDB_BASE+'/find/'+_0x5e213c+_0x5375b0(0x1c7)+TMDB_API_KEY+_0x5375b0(0x1a0),_0x75b5dc=yield fetch(_0x189546,{'headers':{'User-Agent':UA}});if(!_0x75b5dc['ok'])return null;const _0x98d4dd=yield _0x75b5dc['json']();if(_0x98d4dd[_0x5375b0(_0x57acec._0x1c0674)]&&_0x98d4dd[_0x5375b0(_0x57acec._0x1c0674)]['length']>0x0)return _0x98d4dd[_0x5375b0(_0x57acec._0x1c0674)][0x0];if(_0x98d4dd[_0x5375b0(0x1ab)]&&_0x98d4dd[_0x5375b0(0x1ab)][_0x5375b0(0x1c1)]>0x0)return _0x98d4dd[_0x5375b0(_0x57acec._0x4e74ef)][0x0];return null;}catch(_0xf13e3d){return null;}});}function getTmdbMeta(_0x3abbc3,_0x12f02e){const _0x25b206={_0x4bbb42:0x1c7};return __async(this,null,function*(){const _0x1e9950=_0x4817;try{const _0x31b36e=_0x12f02e==='movie'?TMDB_BASE+'/movie/'+_0x3abbc3+_0x1e9950(0x1c7)+TMDB_API_KEY:TMDB_BASE+'/tv/'+_0x3abbc3+_0x1e9950(_0x25b206._0x4bbb42)+TMDB_API_KEY,_0x602607=yield fetch(_0x31b36e,{'headers':{'User-Agent':UA}});if(!_0x602607['ok'])return null;return yield _0x602607[_0x1e9950(0x1b3)]();}catch(_0x818975){return null;}});}function getSeasonDetails(_0x4aeaba,_0x266409){const _0x53483d={_0x13e743:0x177};return __async(this,null,function*(){const _0x5a6391=_0x4817;try{const _0x532777=TMDB_BASE+_0x5a6391(0x1b9)+_0x4aeaba+_0x5a6391(_0x53483d._0x13e743)+_0x266409+'?api_key='+TMDB_API_KEY,_0x598770=yield fetch(_0x532777,{'headers':{'User-Agent':UA}});if(!_0x598770['ok'])return null;return yield _0x598770[_0x5a6391(0x1b3)]();}catch(_0x22f5c9){return null;}});}function _0xc6b9(){const _0x4bff4b=['C2LKzs1ZDg9YEq','C2vHC29Ulq','w0fUAuTHAv0Gz2v0u3rYzwfTCYbLCNjVCJO','ANnVBG','Ahn1yG','C3rYAw5N','C3bPBM9MzG','B25H','Aw5JBhvKzxm','l3r2lW','DhjPBq','AgvHzgvYCW','zxzHBcHMDw5JDgLVBIHWlgeSyYXRlguSzcK','zxbPC29Kzv9JB3vUDa','mta4ma','8j+tUIa','AgfZ','BgvUz3rO','l2vWlsHCzcSP','DgL0Bgu','Dgv4Da','CMvJyxa','mJm0mJa2n1bHyMLqtG','p2fWAv9RzxK9','ota3mdqZnePMEuXZuG','l2vWlte','mta4mha','ntGYnKftzxHesq','ywrK','Aw5KzxHpzG','mJuXmtzUAuf4wuO','lw92yq','Bwf0y2G','zw5KC1DPDgG','nde1oePVzMnAAa','mJCZmtn5DejZyLO','DhzFCMvZDwX0CW','C2L6zq','CMvZB2X2zq','qw5PBwvlywKG4OcIia','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmW','C3rHCNrZv2L0Aa','ChvZAa','mtaWmZGYmZbbtNzwAKe','l3DHDgnOlW','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeZnY4WlJaUmcbtywzHCMKVntm3lJm2','C3vTBwfYEq','y2XHC3m9iMfPDgvTiG','zxbPC29Kzxm','C2vYDMvYu3vItgLUzq','l3nLyxnVBI8','Bw92Awu','zMLSDgvY','zMHK','ntC2mwXQz2H3zG','ndGW','DgvZDa','ic0Gka','zMLSBq','vw5RBM93BG','8j+mNYa0sW','zxHLyW','DxjS','C3bSAxq','mJe2mha','mdeYmZq1nJC4owfIy2rLzMDOAwPRBg1UB3bXCNn0Dxz3EhL6','zMLUza','mZyW','B3jPz2LUywXFBMfTzq','og9pz3ftwq','zxHWB3j0CW','DMfSDwu','nZiW','zMLYC3rFywLYx2rHDgu','lxnWlq','8j+xGU+4JYbtzxj2zxiG','mJmZELPlruft','mZyWCa','mtm2suj5u0nS','C3vI','zxbPC29Kzv9UDw1Izxi','BwfW','mJrT','AM9PBG','C3bLy2LHBa','DhLWzq','DgHLBG','C3vIC3rYAw5N','DgHYB3C','sMfWyw5LC2uGw1nvqL0','CNvUDgLTzq','jMv4DgvYBMfSx3nVDxjJzt1PBwrIx2LK','C2vHC29Ux251BwjLCG','8j+tSsa0odbW','yxvKAw9tDwjmAw5L','mtfwuxfmqNi','mtGZnJG1q0PgrfDz','8j+uLYbbBMLlywKGFcdIJjSG','Dg9mB3DLCKnHC2u','C2vHC29U','CMvWBgfJzq','tI9b','Bw92AwvFCMvZDwX0CW','BMv4Da','EwvHCG','zhvI','Dg9tDhjPBMC'];_0xc6b9=function(){return _0x4bff4b;};return _0xc6b9();}function searchAnikai(_0x47a733){const _0x4856f7={_0x33da20:0x1c4,_0x28979d:0x184,_0x141361:0x1c1};return __async(this,null,function*(){const _0x33b8b3=_0x4817;try{const _0x59e7cd=ANIKAI_BASE+'/browser?keyword='+encodeURIComponent(_0x47a733),_0x4daeec=yield fetch(_0x59e7cd,{'headers':{'User-Agent':UA}});if(!_0x4daeec['ok'])return[];const _0x257f99=yield _0x4daeec[_0x33b8b3(_0x4856f7._0x33da20)](),_0x23fe87=[],_0x2ecf8e=_0x257f99[_0x33b8b3(_0x4856f7._0x28979d)](_0x33b8b3(0x174));for(let _0xf1b059=0x1;_0xf1b059<_0x2ecf8e[_0x33b8b3(_0x4856f7._0x141361)];_0xf1b059++){const _0x2a4323=_0x2ecf8e[_0xf1b059][_0x33b8b3(0x19c)](0x0,0x9c4),_0x23e959=_0x2a4323[_0x33b8b3(0x1d0)](/href="([^"]*\/watch\/[^"]*)"/);if(!_0x23e959)continue;let _0x10092e=_0x23e959[0x1];if(!_0x10092e[_0x33b8b3(0x16e)]('http'))_0x10092e=ANIKAI_BASE+_0x10092e;const _0x2f1e97=_0x2a4323['match'](/class="title[^"]*"[^>]*>([^<]*)/),_0x18aa73=_0x2f1e97?_0x2f1e97[0x1]['trim']():'',_0x20b813=[..._0x2a4323['matchAll'](/<span>\s*<b>\s*([^<]+?)\s*<\/b>\s*<\/span>/g)],_0x225267=_0x20b813['length']>0x0?_0x20b813[_0x20b813['length']-0x1][0x1]['trim']()['toLowerCase']():'';_0x23fe87['push']({'url':_0x10092e,'title':_0x18aa73,'type':_0x225267});}return _0x23fe87;}catch(_0xd53727){return[];}});}function getEpisodeCount(_0x29e560){const _0x2c9b60={_0x3703b3:0x184,_0xe5cc25:0x171,_0x1dc96c:0x182};return __async(this,null,function*(){const _0x5c48d5=_0x4817;try{const _0x2167e2=yield fetch(_0x29e560+_0x5c48d5(0x1c9),{'headers':{'User-Agent':UA}});if(!_0x2167e2['ok'])return 0x0;const _0x3a1eed=yield _0x2167e2['text'](),_0x29f229=_0x29e560[_0x5c48d5(_0x2c9b60._0x3703b3)]('/watch/')[0x1],_0x409d9b=new RegExp(_0x5c48d5(_0x2c9b60._0xe5cc25)+_0x29f229+_0x5c48d5(0x1c2),'g');let _0x498718,_0x239942=0x0;while((_0x498718=_0x409d9b[_0x5c48d5(_0x2c9b60._0x1dc96c)](_0x3a1eed))!==null){const _0xc9ef7d=parseInt(_0x498718[0x1]);if(_0xc9ef7d>_0x239942)_0x239942=_0xc9ef7d;}return _0x239942;}catch(_0x1c5346){return 0x0;}});}function unpackPacked(_0x414e5b){const _0x5be67b={_0x4c24db:0x1bc,_0x180eec:0x1cd,_0x2b70bf:0x1c1,_0x4be7e5:0x1c1,_0x5e37dd:0x19c},_0x4defb6=_0x4435af;try{const _0x44de68=_0x414e5b['indexOf'](_0x4defb6(_0x5be67b._0x4c24db));if(_0x44de68===-0x1)return null;const _0x311e75=_0x414e5b[_0x4defb6(_0x5be67b._0x180eec)]('{',_0x44de68);let _0x44f5bf=0x1,_0x506b1d=_0x311e75+0x1;while(_0x506b1d<_0x414e5b[_0x4defb6(_0x5be67b._0x2b70bf)]&&_0x44f5bf>0x0){if(_0x414e5b[_0x506b1d]==='{')_0x44f5bf++;else{if(_0x414e5b[_0x506b1d]==='}')_0x44f5bf--;}_0x506b1d++;}const _0x1976af=_0x414e5b['indexOf']('(',_0x506b1d-0x1);if(_0x1976af===-0x1)return null;let _0x13f8c9=0x1,_0x4045e5=_0x1976af+0x1;while(_0x4045e5<_0x414e5b[_0x4defb6(_0x5be67b._0x4be7e5)]&&_0x13f8c9>0x0){if(_0x414e5b[_0x4045e5]==='(')_0x13f8c9++;else{if(_0x414e5b[_0x4045e5]===')')_0x13f8c9--;}_0x4045e5++;}const _0x147de7=_0x414e5b[_0x4defb6(_0x5be67b._0x5e37dd)](_0x1976af+0x1,_0x4045e5-0x1)['trim'](),_0x481642=_0x147de7[0x0];let _0x477794='',_0x13fc28=0x1;while(_0x13fc28<_0x147de7['length']){if(_0x147de7[_0x13fc28]===_0x481642){let _0x5d0493=0x0,_0x3e85f6=_0x13fc28-0x1;while(_0x3e85f6>=0x0&&_0x147de7[_0x3e85f6]==='\x5c'){_0x5d0493++,_0x3e85f6--;}if(_0x5d0493%0x2===0x0)break;}_0x477794+=_0x147de7[_0x13fc28],_0x13fc28++;}_0x477794=_0x477794['replace'](new RegExp('\x5c\x5c'+_0x481642,'g'),_0x481642)['replace'](/\\\\/g,'\x5c');const _0xb950c1=_0x147de7[_0x4defb6(_0x5be67b._0x5e37dd)](_0x13fc28+0x1)[_0x4defb6(0x1ba)](),_0x2b7462=_0xb950c1['match'](/^,?\s*(\d+)\s*,\s*(\d+)/);if(!_0x2b7462)return null;const _0x3ca974=parseInt(_0x2b7462[0x1]),_0xcc4922=parseInt(_0x2b7462[0x2]),_0x33e3be=_0xb950c1['match'](/['"]([^'"]*\|[^'"]*)['"]/);if(!_0x33e3be)return null;const _0x21e15f=_0x33e3be[0x1]['split']('|'),_0x1fbfc2=_0x4defb6(0x186);let _0xf84d2e=_0x477794;for(let _0x12e21a=_0xcc4922-0x1;_0x12e21a>=0x0;_0x12e21a--){if(_0x12e21a<_0x21e15f['length']&&_0x21e15f[_0x12e21a]){let _0x21537e='';if(_0x12e21a===0x0)_0x21537e='0';else{let _0x17c05b=_0x12e21a;while(_0x17c05b>0x0){_0x21537e=_0x1fbfc2[_0x17c05b%_0x3ca974]+_0x21537e,_0x17c05b=Math['floor'](_0x17c05b/_0x3ca974);}}_0xf84d2e=_0xf84d2e['replace'](new RegExp('\x5cb'+_0x21537e+'\x5cb','g'),_0x21e15f[_0x12e21a]);}}return _0xf84d2e;}catch(_0x564cde){return null;}}function _0x4817(_0x576460,_0x4706b1){_0x576460=_0x576460-0x16e;const _0xc6b9f8=_0xc6b9();let _0x481736=_0xc6b9f8[_0x576460];if(_0x4817['xKqSyj']===undefined){var _0x51f2d0=function(_0x48aa69){const _0x137f90='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x17d3f1='',_0x59b624='';for(let _0x4b70a2=0x0,_0x469b67,_0x2dc1ea,_0x3279b6=0x0;_0x2dc1ea=_0x48aa69['charAt'](_0x3279b6++);~_0x2dc1ea&&(_0x469b67=_0x4b70a2%0x4?_0x469b67*0x40+_0x2dc1ea:_0x2dc1ea,_0x4b70a2++%0x4)?_0x17d3f1+=String['fromCharCode'](0xff&_0x469b67>>(-0x2*_0x4b70a2&0x6)):0x0){_0x2dc1ea=_0x137f90['indexOf'](_0x2dc1ea);}for(let _0x5898be=0x0,_0x305f52=_0x17d3f1['length'];_0x5898be<_0x305f52;_0x5898be++){_0x59b624+='%'+('00'+_0x17d3f1['charCodeAt'](_0x5898be)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x59b624);};_0x4817['APTipF']=_0x51f2d0,_0x4817['WeRldh']={},_0x4817['xKqSyj']=!![];}const _0x4c09f6=_0xc6b9f8[0x0],_0x263f6f=_0x576460+_0x4c09f6,_0x2ec8b5=_0x4817['WeRldh'][_0x263f6f];return!_0x2ec8b5?(_0x481736=_0x4817['APTipF'](_0x481736),_0x4817['WeRldh'][_0x263f6f]=_0x481736):_0x481736=_0x2ec8b5,_0x481736;}function extractFromEmbed(_0x2cddec){const _0x1a781b={_0x11630a:0x185,_0x4b4b2c:0x1b8,_0x2c2344:0x18d,_0x2a2af4:0x188,_0x53410f:0x192,_0x379bdf:0x182};return __async(this,null,function*(){const _0x2ecbab=_0x4817;try{const _0x16e6da=yield fetch(_0x2cddec,{'headers':{'User-Agent':UA,'Referer':ANIKAI_BASE+'/'}});if(!_0x16e6da['ok'])return[];const _0x20dfdf=yield _0x16e6da['text'](),_0x115883=[],_0x165995=/(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/g;let _0x3689ad;while((_0x3689ad=_0x165995[_0x2ecbab(0x182)](_0x20dfdf))!==null){let _0x1c0ef0=_0x2ecbab(0x1ca);if(_0x3689ad[0x1]['includes']('2160')||_0x3689ad[0x1][_0x2ecbab(0x1b8)]('4k'))_0x1c0ef0=_0x2ecbab(_0x1a781b._0x11630a);else{if(_0x3689ad[0x1][_0x2ecbab(0x1b8)](_0x2ecbab(0x1be)))_0x1c0ef0='1080p';else{if(_0x3689ad[0x1][_0x2ecbab(_0x1a781b._0x4b4b2c)](_0x2ecbab(_0x1a781b._0x2c2344)))_0x1c0ef0='720p';else{if(_0x3689ad[0x1]['includes'](_0x2ecbab(0x17c)))_0x1c0ef0='480p';else{if(_0x3689ad[0x1][_0x2ecbab(0x1b8)](_0x2ecbab(_0x1a781b._0x2a2af4)))_0x1c0ef0=_0x2ecbab(_0x1a781b._0x53410f);}}}}_0x115883[_0x2ecbab(0x16f)]({'url':_0x3689ad[0x1],'quality':_0x1c0ef0,'headers':{'Referer':_0x2cddec,'User-Agent':UA}});}if(_0x115883['length']===0x0&&_0x20dfdf['includes']('eval(function(p,a,c,k,e,d)')){const _0x551913=unpackPacked(_0x20dfdf);if(_0x551913)while((_0x3689ad=_0x165995[_0x2ecbab(_0x1a781b._0x379bdf)](_0x551913))!==null){_0x115883['push']({'url':_0x3689ad[0x1],'quality':_0x2ecbab(0x1ca),'headers':{'Referer':_0x2cddec,'User-Agent':UA}});}}return _0x115883;}catch(_0x2bd032){return[];}});}function getStreamsFromWatchPage(_0x5261cf){const _0x3b5a02={_0xe70122:0x194,_0x3845d0:0x1ae,_0x346151:0x182,_0x27bdbd:0x190,_0x7dadaf:0x1cc,_0x4caeaa:0x183,_0x7b6862:0x16f,_0x46c8ee:0x196};return __async(this,arguments,function*(_0xd25d3b,_0x3842ad={}){const _0x192e4e={_0x3cae6e:0x1bf,_0x555758:0x1ad,_0x37a09a:0x19a,_0x5a3da6:0x1a8,_0x546cb8:0x1a3,_0x316898:0x1a6,_0x748666:0x1bb},_0x2617d5=_0x4817;try{const _0x46083d=yield fetch(_0xd25d3b,{'headers':{'User-Agent':UA}});if(!_0x46083d['ok'])return[];const _0x594364=yield _0x46083d['text'](),_0x55ba2b=[],_0x25ad33=new Set(),_0x1f3c2a=/class="server-items[^"]*"[^>]*data-id="([^"]*)"[\s\S]*?<\/div>/g;let _0x241759;while((_0x241759=_0x1f3c2a['exec'](_0x594364))!==null){const _0x38fd2a=_0x241759[0x1];if(![_0x2617d5(0x1b4),_0x2617d5(_0x3b5a02._0xe70122),_0x2617d5(_0x3b5a02._0x3845d0)][_0x2617d5(0x1b8)](_0x38fd2a))continue;const _0x96c280=_0x38fd2a===_0x2617d5(_0x3b5a02._0x3845d0),_0x43636f=_0x96c280?'English\x20[DUB]':_0x2617d5(0x19e),_0x1bdd4b=_0x96c280?'English\x20🇺🇸\x20-\x20[DUB]':'Japanese\x20🇯🇵\x20-\x20[SUB]',_0x198644=/data-video="([^"]*)"/g;let _0x262e47,_0x14408d=0x0;while((_0x262e47=_0x198644[_0x2617d5(_0x3b5a02._0x346151)](_0x241759[0x0]))!==null){const _0x3bce5b=_0x262e47[0x1];_0x14408d++;const _0x203849=_0x96c280?'🗂️\x20Server\x20'+_0x14408d+'\x20•\x20🔉\x20English\x20Dubbed':_0x2617d5(_0x3b5a02._0x27bdbd)+_0x14408d+'\x20•\x20📑\x20English\x20Subtitles',_0x1eea75=yield extractFromEmbed(_0x3bce5b);for(const _0x2e0b30 of _0x1eea75){if(_0x25ad33['has'](_0x2e0b30['url']))continue;_0x25ad33[_0x2617d5(_0x3b5a02._0x7dadaf)](_0x2e0b30[_0x2617d5(_0x3b5a02._0x4caeaa)]),_0x55ba2b[_0x2617d5(_0x3b5a02._0x7b6862)]({'url':_0x2e0b30['url'],'quality':_0x2e0b30['quality'],'audioHeaderTag':_0x43636f,'audioSubLine':_0x1bdd4b,'serverSubLine':_0x203849,'headers':_0x2e0b30['headers']});}}}return _0x55ba2b[_0x2617d5(_0x3b5a02._0x46c8ee)]((_0x382dec,_0x5d3290)=>{const _0x468740=_0x2617d5,_0x2eaf14=_0x382dec['quality']||'1080p',_0x4e46ef=getResolutionEmoji(_0x2eaf14),_0x19b376=qualityRank(_0x2eaf14),_0xe5270d=getInvertedSortTag(_0x19b376*0x186a0+(0x64-_0x5d3290),0xf423f),_0x5bc0a7=_0xe5270d+_0x468740(0x1d7)+_0x2eaf14+'\x20•\x20'+_0x382dec['audioHeaderTag'],_0x58dfd6=_0x468740(_0x192e4e._0x3cae6e)+_0x3842ad[_0x468740(0x1c3)]+(_0x3842ad[_0x468740(_0x192e4e._0x555758)]?_0x468740(0x17e)+_0x3842ad['year']+')':'');let _0x3e6036=null;_0x3842ad[_0x468740(_0x192e4e._0x37a09a)]==='tv'&&(_0x3e6036='📋\x20S'+_0x3842ad[_0x468740(_0x192e4e._0x5a3da6)]+'\x20E'+_0x3842ad['episode']+(_0x3842ad['episodeTitle']?'\x20-\x20'+_0x3842ad['episodeTitle']:''));const _0x3ec8e5=_0x4e46ef+'\x20|\x20🗣️\x20'+_0x382dec[_0x468740(_0x192e4e._0x546cb8)],_0x5069cd=_0x468740(_0x192e4e._0x316898)+(_0x3842ad['duration']||'24m')+'\x20|\x20⚡\x20H.264',_0x549588=_0x382dec[_0x468740(0x176)],_0x1af9be=[_0x58dfd6,_0x3e6036,_0x3ec8e5,_0x5069cd,_0x549588][_0x468740(0x179)](Boolean)['join']('\x0a');return{'name':_0x5bc0a7,'title':_0x1af9be,'size':_0x1af9be,'description':_0x1af9be,'url':_0x382dec['url'],'behaviorHints':{'notWebReady':!![],'proxyHeaders':{'request':_0x382dec[_0x468740(_0x192e4e._0x748666)]}}};});}catch(_0x5208cf){return[];}});}function findBestAnikaiEntry(_0x37e494,_0x33b646,_0x1c950f){const _0x891710={_0xd0a54c:0x1c1,_0x399675:0x1a7,_0x37f659:0x187,_0x3c66d6:0x1c3},_0x39a722={_0x45a376:0x183,_0x1d0952:0x184,_0x2d758a:0x1a7,_0x38cf81:0x1b1};return __async(this,null,function*(){const _0xc5455f=_0x4817;if(!_0x37e494||_0x37e494['length']===0x0)return null;if(_0x1c950f===0x0){const _0x1561ea=_0x37e494['filter'](_0x37444b=>isMovieOrSpecial(_0x37444b[_0xc5455f(0x183)],_0x37444b[_0xc5455f(0x19a)]));if(_0x1561ea[_0xc5455f(0x1c1)]>0x0){let _0xd902dc=null,_0x2d53d8=-0x1;for(const _0x10ede0 of _0x1561ea){const _0x45fd11=getSimilarity(_0x10ede0[_0xc5455f(0x1c3)],_0x33b646);_0x45fd11>_0x2d53d8&&(_0x2d53d8=_0x45fd11,_0xd902dc=_0x10ede0);}return _0xd902dc||_0x1561ea[0x0];}return _0x37e494[0x0];}const _0x1e90d5=_0x37e494['filter'](_0x3a0508=>!isMovieOrSpecial(_0x3a0508[_0xc5455f(0x183)],_0x3a0508['type']));if(_0x1e90d5[_0xc5455f(_0x891710._0xd0a54c)]===0x0)return _0x37e494[0x0];const _0x2f642b=(_0x33b646||'')[_0xc5455f(_0x891710._0x399675)]()['trim']();if(!_0x1c950f||_0x1c950f===0x1){const _0x3cbeed=_0x1e90d5[_0xc5455f(_0x891710._0x37f659)](_0x5b2d42=>(_0x5b2d42[_0xc5455f(0x1c3)]||'')[_0xc5455f(0x1a7)]()[_0xc5455f(0x1ba)]()===_0x2f642b);if(_0x3cbeed)return _0x3cbeed;const _0x5f14d3=_0x1e90d5[_0xc5455f(0x187)](_0xd7d8d4=>{const _0x4eedaa=_0xc5455f,_0x3b7c69=_0xd7d8d4['url']['split']('/watch/')[0x1]||'';return!_0x3b7c69[_0x4eedaa(0x1d0)](/-(ii|iii|iv|v|vi|vii|viii|ix|x)$/i);});if(_0x5f14d3)return _0x5f14d3;}if(_0x1c950f&&_0x1c950f>0x1){const _0xf07577=toRoman(_0x1c950f)[_0xc5455f(_0x891710._0x399675)](),_0x5bcdd7=_0x1e90d5['find'](_0x49c36c=>{const _0x38d568=_0xc5455f,_0x426261=_0x49c36c[_0x38d568(_0x39a722._0x45a376)][_0x38d568(_0x39a722._0x1d0952)]('/watch/')[0x1]||'';return _0x426261[_0x38d568(0x1a7)]()['endsWith']('-'+_0xf07577)||_0x426261['toLowerCase']()[_0x38d568(0x1b8)]('-'+_0xf07577+'-')||_0x426261[_0x38d568(_0x39a722._0x2d758a)]()['includes'](_0x38d568(_0x39a722._0x38cf81)+_0x1c950f)||_0x426261['toLowerCase']()['includes']('s'+_0x1c950f);});if(_0x5bcdd7)return _0x5bcdd7;}let _0x3dc1e7=null,_0x2ac51d=0x0;for(const _0x5a1802 of _0x1e90d5){const _0x32ef12=getSimilarity(_0x5a1802[_0xc5455f(_0x891710._0x3c66d6)],_0x33b646);_0x32ef12>_0x2ac51d&&(_0x2ac51d=_0x32ef12,_0x3dc1e7=_0x5a1802);}return _0x3dc1e7||_0x1e90d5[0x0];});}function getStreams(_0x3c0d1a,_0x3f4300='tv',_0x3dbe85=null,_0x1e05d8=null){const _0x36cb8e={_0x409d7b:0x1c3,_0x28af2d:0x180,_0x1d5082:0x18e,_0x4d837e:0x197,_0x2c036f:0x1aa,_0x166e98:0x175,_0x20e6b6:0x187,_0x299e05:0x1bd,_0xa7440a:0x189,_0x40fe92:0x16f,_0x3d23a7:0x183,_0x2eef73:0x1b2};return __async(this,null,function*(){const _0x279c32=_0x4817;try{let _0x115977=_0x3c0d1a;if(typeof _0x3c0d1a===_0x279c32(0x1b5)&&_0x3c0d1a['startsWith']('tt')){const _0x45d332=yield imdbToTmdb(_0x3c0d1a);if(_0x45d332)_0x115977=_0x45d332['id'];else return[];}const _0x1b2a2b=yield getTmdbMeta(_0x115977,_0x3f4300);if(!_0x1b2a2b)return[];const _0x4f667d=_0x1b2a2b['name']||_0x1b2a2b[_0x279c32(_0x36cb8e._0x409d7b)]||_0x279c32(_0x36cb8e._0x28af2d),_0x1b20e4=(_0x1b2a2b[_0x279c32(_0x36cb8e._0x1d5082)]||_0x1b2a2b['release_date']||'')['slice'](0x0,0x4);let _0x37af7a='',_0x3e5904=_0x279c32(_0x36cb8e._0x4d837e);if(_0x3f4300==='movie'){_0x3e5904=_0x1b2a2b[_0x279c32(0x19f)]?_0x1b2a2b[_0x279c32(0x19f)]+'m':_0x279c32(_0x36cb8e._0x2c036f);const _0x1308c8={'title':_0x4f667d,'year':_0x1b20e4,'type':_0x3f4300,'duration':_0x3e5904},_0x37f6e2=yield searchAnikai(_0x4f667d);if(_0x37f6e2['length']===0x0)return[];const _0x376341=_0x37f6e2['find'](_0x3265cd=>isMovieOrSpecial(_0x3265cd[_0x279c32(0x183)],_0x3265cd[_0x279c32(0x19a)])),_0x1550b1=_0x376341||_0x37f6e2[0x0];return yield getStreamsFromWatchPage(_0x1550b1['url']+'/ep-1',_0x1308c8);}const _0x3eda96=_0x3dbe85===null||_0x3dbe85===void 0x0?0x1:_0x3dbe85,_0x544262=_0x1e05d8||0x1,_0x2afa2f=yield getSeasonDetails(_0x115977,_0x3eda96);if(_0x2afa2f&&_0x2afa2f['episodes']){const _0x25afb8=_0x2afa2f[_0x279c32(_0x36cb8e._0x166e98)]['find'](_0x18cd49=>_0x18cd49[_0x279c32(0x195)]===_0x544262);if(_0x25afb8){_0x37af7a=_0x25afb8['name']||'';if(_0x25afb8['runtime'])_0x3e5904=_0x25afb8['runtime']+'m';}}_0x3e5904==='24m'&&_0x1b2a2b['episode_run_time']&&_0x1b2a2b['episode_run_time']['length']>0x0&&(_0x3e5904=_0x1b2a2b['episode_run_time'][0x0]+'m');const _0x5ae046={'title':_0x4f667d,'year':_0x1b20e4,'type':_0x3f4300,'season':_0x3eda96,'episode':_0x544262,'episodeTitle':_0x37af7a,'duration':_0x3e5904},_0x52b746=_0x1b2a2b['seasons']||[],_0x24f796=_0x52b746[_0x279c32(_0x36cb8e._0x20e6b6)](_0x32fbfa=>_0x32fbfa[_0x279c32(0x1a1)]===_0x3eda96),_0x284ac3=_0x24f796?_0x24f796[_0x279c32(_0x36cb8e._0x299e05)]:0x0,_0x42768f=yield searchAnikai(_0x4f667d);if(_0x42768f['length']===0x0){const _0x84ebb3=yield searchAnikai(_0x1b2a2b[_0x279c32(_0x36cb8e._0xa7440a)]||_0x4f667d);if(_0x84ebb3[_0x279c32(0x1c1)]===0x0)return[];_0x42768f[_0x279c32(_0x36cb8e._0x40fe92)](..._0x84ebb3);}const _0x23831d=yield findBestAnikaiEntry(_0x42768f,_0x4f667d,_0x3eda96);if(!_0x23831d)return[];const _0x3934bc=yield getEpisodeCount(_0x23831d['url']);let _0xd8f7c9;if(_0x3934bc>_0x284ac3&&_0x3eda96>0x1){let _0x27816c=_0x544262;for(const _0x202ace of _0x52b746){_0x202ace['season_number']<_0x3eda96&&_0x202ace['season_number']>0x0&&(_0x27816c+=_0x202ace[_0x279c32(_0x36cb8e._0x299e05)]);}_0xd8f7c9=_0x27816c;}else _0xd8f7c9=_0x544262;return yield getStreamsFromWatchPage(_0x23831d[_0x279c32(_0x36cb8e._0x3d23a7)]+'/ep-'+_0xd8f7c9,_0x5ae046);}catch(_0x5260ee){return console['error'](_0x279c32(_0x36cb8e._0x2eef73),_0x5260ee['message']),[];}});}module[_0x4435af(0x18b)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animekai", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AnimeKai", "animekai");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
