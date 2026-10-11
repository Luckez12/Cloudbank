// Imported provider: hdghartv; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
'use strict';const _0x254784=_0x3e8b;function _0x4c12(){const _0x2926e5=['p2fWAv9RzxK9','DgvZDa','Bw92Awu','tva0','Aw5JBhvKzxm','mte4odCWnvHvAK1MuW','mtu1mZa0nKv1CvzzvW','ic0Gka','rMfPBgvKihrVignVBNn0CNvJDcbSyxLVDxqGzNjVBsbireDiqvjuvIbLBMrWB2LUDdO','qumZ','jMfWCgvUzf90B19YzxnWB25Zzt1LEhrLCM5HBf9Pzhm','ihWG4O+Zia','zxHWB3j0CW','ihWG8j+oPsa','DgHLBG','yxbWBhK','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZe0os4WlJaUmcbtywzHCMKVntm3lJm2','CxvHBgL0Eq','lM0ZDtG','y2fSBa','tI9b','C29YDa','DgHYB3C','z2v0u3rYzwfTCW','C3bSAxq','CNvUDgLTzq','Bw92AwvZ','l3b1yMXPyY8','ChvZAa','BMv4Da','rs1bqZm','rgLYzwn0','zMLUza','Dw5KzwzPBMvK','zxjYB3i','zxbPC29Kzu51BwjLCG','zxbPC29Kzv9YDw5FDgLTzq','DMfSDwu','cVcFM7dVUi8Gu291CMnLoIbireDOyxjuvG','vw5RBM93BIbuAxrSzq','l2fWAs8','8j+oPIa','mJa2odC3m2HKt1fYsa','mta4mha','x2LK','tuTw','Ahr0Chm6lY9OzgDOyxj0DI5JyW','ANnVBG','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','ChjVDg90ExbL','zg9Uzq','ndeZmJCXmhvwvwforG','nZaZnZq5rff0Agn6','ihWG8j+oPYa','iokaOIa','CMfUAW','BgvUz3rO','zMLYC3rFywLYx2rHDgu','zxbPC29Kzxm','mtHPrM5WBMG','DxjS','Aw5KzxHpzG','odmXnNvTse1muq','ig1PBG','nZK1vuTkA0nH','mJaYnG','ndaWv1DuwwTM','mJKZnNPbthHmBa'];_0x4c12=function(){return _0x2926e5;};return _0x4c12();}function _0x3e8b(_0x8ced55,_0xf3b547){_0x8ced55=_0x8ced55-0x1d7;const _0x4c1232=_0x4c12();let _0x3e8be6=_0x4c1232[_0x8ced55];if(_0x3e8b['qUXwLj']===undefined){var _0x21039f=function(_0x931fa6){const _0x171b60='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x32dd60='',_0x30537d='';for(let _0x451285=0x0,_0x357a59,_0x1e68f1,_0x2b2a58=0x0;_0x1e68f1=_0x931fa6['charAt'](_0x2b2a58++);~_0x1e68f1&&(_0x357a59=_0x451285%0x4?_0x357a59*0x40+_0x1e68f1:_0x1e68f1,_0x451285++%0x4)?_0x32dd60+=String['fromCharCode'](0xff&_0x357a59>>(-0x2*_0x451285&0x6)):0x0){_0x1e68f1=_0x171b60['indexOf'](_0x1e68f1);}for(let _0x248c56=0x0,_0x8454e6=_0x32dd60['length'];_0x248c56<_0x8454e6;_0x248c56++){_0x30537d+='%'+('00'+_0x32dd60['charCodeAt'](_0x248c56)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x30537d);};_0x3e8b['PxaEow']=_0x21039f,_0x3e8b['ptKigS']={},_0x3e8b['qUXwLj']=!![];}const _0xe5295e=_0x4c1232[0x0],_0x5c0f2f=_0x8ced55+_0xe5295e,_0x23e505=_0x3e8b['ptKigS'][_0x5c0f2f];return!_0x23e505?(_0x3e8be6=_0x3e8b['PxaEow'](_0x3e8be6),_0x3e8b['ptKigS'][_0x5c0f2f]=_0x3e8be6):_0x3e8be6=_0x23e505,_0x3e8be6;}(function(_0x4dddb8,_0x461a66){const _0x375c2f={_0x4f0009:0x1d7,_0x529d38:0x1ed,_0xf3ab55:0x1e5,_0x617760:0x1ec,_0x5e535:0x211,_0x1cccfd:0x1e6,_0x1e6a0f:0x1e1,_0x45b73f:0x21a},_0x3f2ae1=_0x3e8b,_0x56f7e9=_0x4dddb8();while(!![]){try{const _0x49a292=parseInt(_0x3f2ae1(_0x375c2f._0x4f0009))/0x1+-parseInt(_0x3f2ae1(_0x375c2f._0x529d38))/0x2+-parseInt(_0x3f2ae1(0x1e3))/0x3*(parseInt(_0x3f2ae1(_0x375c2f._0xf3ab55))/0x4)+-parseInt(_0x3f2ae1(_0x375c2f._0x617760))/0x5*(-parseInt(_0x3f2ae1(0x1de))/0x6)+-parseInt(_0x3f2ae1(_0x375c2f._0x5e535))/0x7+-parseInt(_0x3f2ae1(_0x375c2f._0x1cccfd))/0x8*(parseInt(_0x3f2ae1(_0x375c2f._0x1e6a0f))/0x9)+parseInt(_0x3f2ae1(_0x375c2f._0x45b73f))/0xa;if(_0x49a292===_0x461a66)break;else _0x56f7e9['push'](_0x56f7e9['shift']());}catch(_0x47bd6c){_0x56f7e9['push'](_0x56f7e9['shift']());}}}(_0x4c12,0x5fd7d));var __getOwnPropSymbols=Object['getOwnPropertySymbols'],__hasOwnProp=Object['prototype']['hasOwnProperty'],__propIsEnum=Object[_0x254784(0x218)]['propertyIsEnumerable'],__objRest=(_0x32dd60,_0x30537d)=>{const _0x5bc783={_0x183bce:0x1fa},_0x48a134=_0x254784;var _0x451285={};for(var _0x357a59 in _0x32dd60)if(__hasOwnProp[_0x48a134(_0x5bc783._0x183bce)](_0x32dd60,_0x357a59)&&_0x30537d['indexOf'](_0x357a59)<0x0)_0x451285[_0x357a59]=_0x32dd60[_0x357a59];if(_0x32dd60!=null&&__getOwnPropSymbols)for(var _0x357a59 of __getOwnPropSymbols(_0x32dd60)){if(_0x30537d[_0x48a134(0x1e0)](_0x357a59)<0x0&&__propIsEnum['call'](_0x32dd60,_0x357a59))_0x451285[_0x357a59]=_0x32dd60[_0x357a59];}return _0x451285;},__async=(_0x1e68f1,_0x2b2a58,_0x248c56)=>{const _0x67a41d={_0x57dce2:0x204};return new Promise((_0x8454e6,_0x41a041)=>{const _0x598a44={_0x24ebb1:0x204},_0xd4597f=_0x3e8b;var _0x290409=_0x215559=>{const _0x51c502=_0x3e8b;try{_0x3455b5(_0x248c56[_0x51c502(_0x598a44._0x24ebb1)](_0x215559));}catch(_0x5632eb){_0x41a041(_0x5632eb);}},_0x2e8360=_0x2a308f=>{const _0x5efc02=_0x3e8b;try{_0x3455b5(_0x248c56[_0x5efc02(0x1fd)](_0x2a308f));}catch(_0x18ee83){_0x41a041(_0x18ee83);}},_0x3455b5=_0xb20b32=>_0xb20b32[_0xd4597f(0x219)]?_0x8454e6(_0xb20b32['value']):Promise['resolve'](_0xb20b32[_0xd4597f(0x20c)])[_0xd4597f(0x1f5)](_0x290409,_0x2e8360);_0x3455b5((_0x248c56=_0x248c56[_0xd4597f(0x1f6)](_0x1e68f1,_0x2b2a58))[_0xd4597f(_0x67a41d._0x57dce2)]());});},HDGHARTV_API=_0x254784(0x215),TMDB_BASE='https://api.themoviedb.org/3',TMDB_KEY=_0x254784(0x217),UA=_0x254784(0x1f7),BASE_HEADERS={'User-Agent':UA,'Referer':HDGHARTV_API+'/'};function getStreams(_0x627089,_0x57894b,_0x46fa3e,_0x4eb05f){const _0x39ee39={_0x31a542:0x201,_0x1c4b12:0x1e9,_0x478de0:0x1e7,_0x130b30:0x1f1,_0x5c26fb:0x1f5,_0x1d701b:0x20e,_0x15d06c:0x1fb,_0x29ca2f:0x200,_0x314a44:0x20b,_0x32f1dc:0x1db,_0x2f8c4f:0x1e2,_0x3d3dff:0x216,_0x458bab:0x20f,_0x4a4417:0x202,_0x883135:0x216,_0x14f9e3:0x1df,_0xc6930:0x1e8,_0x47256d:0x1e8,_0x15454f:0x1e8,_0x1e2195:0x1f9,_0x391882:0x1e8,_0x4db12f:0x210,_0x2c556b:0x1ee,_0x416b99:0x1f2,_0x2b663b:0x1d8};return __async(this,null,function*(){const _0x1db28c={_0x1b0a90:0x1da},_0xd3cc3d=_0x3e8b,_0x247eae=_0x57894b==='tv'||_0x57894b==='series',_0x345593=_0x247eae?'series':_0xd3cc3d(_0x39ee39._0x31a542);try{const _0x2b39f5=_0x247eae?'tv':_0xd3cc3d(_0x39ee39._0x1c4b12),_0x4edd3d=TMDB_BASE+'/'+_0x2b39f5+'/'+_0x627089+_0xd3cc3d(_0x39ee39._0x478de0)+TMDB_KEY+_0xd3cc3d(_0x39ee39._0x130b30),_0x4741f3=yield fetch(_0x4edd3d)[_0xd3cc3d(_0x39ee39._0x5c26fb)](_0x138d07=>_0x138d07[_0xd3cc3d(0x216)]())['catch'](()=>null);if(!_0x4741f3)return[];const _0x4eff81=_0x4741f3['title']||_0x4741f3['name']||_0xd3cc3d(_0x39ee39._0x1d701b),_0x2a1758=_0x4741f3['release_date']?_0x4741f3['release_date'][_0xd3cc3d(0x1ff)]('-')[0x0]:_0x4741f3[_0xd3cc3d(0x1dc)]?_0x4741f3['first_air_date']['split']('-')[0x0]:_0xd3cc3d(0x1e4);let _0x62a999=_0xd3cc3d(_0x39ee39._0x15d06c);if(!_0x247eae&&_0x4741f3[_0xd3cc3d(0x200)])_0x62a999=_0x4741f3[_0xd3cc3d(_0x39ee39._0x29ca2f)]+'\x20min';else _0x247eae&&_0x4741f3[_0xd3cc3d(_0x39ee39._0x314a44)]&&_0x4741f3['episode_run_time'][_0xd3cc3d(_0x39ee39._0x32f1dc)]>0x0&&(_0x62a999=_0x4741f3['episode_run_time'][0x0]+_0xd3cc3d(_0x39ee39._0x2f8c4f));const _0x4d6396=yield fetch(HDGHARTV_API+'/api/search?q='+encodeURIComponent(_0x4eff81)+'&type=all&page=1',{'headers':BASE_HEADERS})['catch'](()=>null);if(!_0x4d6396||!_0x4d6396['ok'])return[];const _0x5e8e1a=yield _0x4d6396[_0xd3cc3d(_0x39ee39._0x3d3dff)]()['catch'](()=>null);if(!_0x5e8e1a)return[];const _0x4024c7=[..._0x5e8e1a['movies']||[],..._0x5e8e1a['series']||[]],_0x4bae4b=_0x4024c7['find'](_0x3a000a=>_0x3a000a['tmdbId']===Number(_0x627089));if(!_0x4bae4b||!_0x4bae4b['_id'])return[];const _0x3ac0cd=yield fetch(HDGHARTV_API+_0xd3cc3d(_0x39ee39._0x458bab)+_0x345593+_0xd3cc3d(_0x39ee39._0x4a4417)+_0x4bae4b[_0xd3cc3d(0x213)],{'headers':BASE_HEADERS})['catch'](()=>null);if(!_0x3ac0cd||!_0x3ac0cd['ok'])return[];const _0x41f221=yield _0x3ac0cd[_0xd3cc3d(_0x39ee39._0x883135)]()['catch'](()=>null);if(!_0x41f221)return[];let _0x38ed90=[];if(!_0x247eae)_0x38ed90=_0x41f221['streamingLinks']||[];else{const _0x31f8eb=(_0x41f221['seasons']||[])['find'](_0x4d8e2b=>_0x4d8e2b['seasonNumber']===Number(_0x46fa3e));if(!_0x31f8eb)return[];const _0x58869a=(_0x31f8eb[_0xd3cc3d(0x1dd)]||[])[_0xd3cc3d(0x207)](_0x20ddff=>_0x20ddff[_0xd3cc3d(0x20a)]===Number(_0x4eb05f));if(!_0x58869a)return[];_0x38ed90=_0x58869a['streamingLinks']||[];}const _0x17d9d6=[];for(const _0x4da9f7 of _0x38ed90){if(!_0x4da9f7||!_0x4da9f7[_0xd3cc3d(_0x39ee39._0x14f9e3)])continue;const _0x86bcc3=((_0x4da9f7[_0xd3cc3d(0x1f8)]||'')+'\x20'+(_0x4da9f7['name']||'')+'\x20'+_0x4da9f7[_0xd3cc3d(_0x39ee39._0x14f9e3)])['toLowerCase'](),_0xfad067=/\b(2160p|4k)\b/i[_0xd3cc3d(_0x39ee39._0xc6930)](_0x86bcc3),_0x615521=/\b(1080p)\b/i['test'](_0x86bcc3),_0x47be0a=/\b(720p)\b/i[_0xd3cc3d(_0x39ee39._0x47256d)](_0x86bcc3);if(!_0xfad067&&!_0x615521&&!_0x47be0a)continue;let _0x1b6869=_0xd3cc3d(0x212),_0x3d91ab='🔥',_0x41a24c=0x2;if(_0xfad067)_0x1b6869='2160p',_0x3d91ab='💎',_0x41a24c=0x3;else _0x47be0a&&(_0x1b6869='720p',_0x3d91ab='🎬',_0x41a24c=0x1);let _0x38cbde='Dual-Audio\x20🌐';/hindi|hin|🇮🇳/[_0xd3cc3d(_0x39ee39._0x15454f)](_0x86bcc3)&&!/multi|dual/[_0xd3cc3d(0x1e8)](_0x86bcc3)&&(_0x38cbde='Hindi\x20🇮🇳');const _0x18b157=_0x4da9f7['url'][_0xd3cc3d(0x1eb)](_0xd3cc3d(_0x39ee39._0x1e2195)),_0x4243ea=_0x18b157?'HLS':/\b(mp4|avi|m4v)\b/[_0xd3cc3d(0x1e8)](_0x86bcc3)?_0xd3cc3d(0x1ea):_0xd3cc3d(0x214),_0xba6757=/\b(hevc|x265|h265)\b/[_0xd3cc3d(0x1e8)](_0x86bcc3)?'x.265':'x.264',_0x2e9d52=_0x18b157?'HLS':_0xd3cc3d(0x206),_0xafec24=/\b(ddp|dd\+|eac3|dolby)\b/[_0xd3cc3d(_0x39ee39._0x391882)](_0x86bcc3)?_0xd3cc3d(0x205):/\b(ac3|dolby)\b/['test'](_0x86bcc3)?_0xd3cc3d(0x1f0):'AAC',_0x437631=_0x247eae?_0xd3cc3d(_0x39ee39._0x4db12f)+_0x4eff81+_0xd3cc3d(0x1ee)+_0x2a1758+')\x20|\x20S'+(_0x46fa3e||0x1)+'E'+(_0x4eb05f||0x1):'🎦\x20'+_0x4eff81+_0xd3cc3d(_0x39ee39._0x2c556b)+_0x2a1758+')',_0x2330f6=_0x437631+'\x0a'+_0x3d91ab+'\x20'+_0x1b6869+'\x20|\x20🔊\x20'+_0x38cbde+_0xd3cc3d(_0x39ee39._0x416b99)+_0x62a999+'\x0a⚡\x20'+_0x4243ea+_0xd3cc3d(0x1f4)+_0xba6757+_0xd3cc3d(0x1d9)+_0x2e9d52+_0xd3cc3d(_0x39ee39._0x2b663b)+_0xafec24+_0xd3cc3d(0x20d);_0x17d9d6[_0xd3cc3d(0x203)]({'rank':_0x41a24c,'name':'HDGharTV\x20|\x20'+_0x1b6869+'\x20|\x20Dual-Audio','title':_0x2330f6,'description':_0x2330f6,'size':_0x2330f6,'url':_0x4da9f7['url'],'headers':BASE_HEADERS,'behaviorHints':{'notSupported':![],'proxyHeaders':{'request':BASE_HEADERS}}});}return _0x17d9d6[_0xd3cc3d(0x1fc)]((_0x424def,_0x210e92)=>_0x210e92['rank']-_0x424def['rank']),_0x17d9d6['map'](_0x3db0d7=>{const _0x573737=_0xd3cc3d;var _0x1e23c5=_0x3db0d7,{rank:_0x47a32f}=_0x1e23c5,_0x19220f=__objRest(_0x1e23c5,[_0x573737(_0x1db28c._0x1b0a90)]);return _0x19220f;});}catch(_0xf7c188){return console[_0xd3cc3d(0x209)](_0xd3cc3d(0x1ef),_0xf7c188),[];}});}typeof module!==_0x254784(0x208)&&module[_0x254784(0x1f3)]?module['exports']={'getStreams':getStreams}:global[_0x254784(0x1fe)]=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "hdghartv", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "HDGharTV", "hdghartv");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
