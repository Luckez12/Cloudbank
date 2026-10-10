// Imported provider: moonflix; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
'use strict';function _0x3948(){var _0x56d9a1=['8j+BSo+4JYbitfmGFcdIMQeGsc4YnJqGFcdWN46NiefbqW','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY9TB3zPzs8','z2v0u3rYzwfTCW','BgvUz3rO','DgvZDa','DhyV','y29Uy2f0','zxbPC29Kzxm','i0vyve0Zvq','Bwf4','DxjS','mtG2nZqXnLjkvLD1qq','zxHWB3j0CW','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','ANnVBG','Aw5KzxHpzG','C3rYzwfTCW','yM9KEq','zxbPC29Kzv9UDw1Izxi','yxnZAwDU','zMLSDgvY','l3nLyxnVBI8','nJiYmte1ve1Kz3P4','AxnuDG','vw5RBM93BG','CMvZB2X2zq','mta5mZqWngXHB2L4sG','qxv0BW','8j+oRca','DgHLBG','AxnbCNjHEq','8j+mMsbnB29UzMXPEcdIGkiG','nta4ntiWogXtAKPXsq','zxbPC29KzvrPDgXL','r0vu','Ahr0Ca','y2f0y2G','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','zxbPC29Kzq','CxvHBgL0Eq','ihWG8j+tPsbxruiTreW','nZiW','Aw5JBhvKzxm','y29Kzq','mZeZmJG0BKfzr3rV','Dw5KzwzPBMvK','mZG0nZCZmLzNuNbHBa','p2fWAv9RzxK9','mta4ma','mtzQrxn3CNq','B25tzxr0Aw5NCW','Bwv0Ag9K','zM9YrwfJAa','odK1mtqYuxPQv3fH','AM9PBG','ChjVEhLFDxjS'];_0x3948=function(){return _0x56d9a1;};return _0x3948();}var _0x32077b=_0x20d2;(function(_0x1c7b45,_0x23e88a){var _0x2e114c={_0x44d7c8:0x153,_0x48a174:0x15c,_0x1e1a83:0x179,_0x269fa5:0x158,_0x583c45:0x175,_0x5055e3:0x155,_0x414f65:0x147},_0x1b5293=_0x20d2,_0x388099=_0x1c7b45();while(!![]){try{var _0x4154ec=-parseInt(_0x1b5293(_0x2e114c._0x44d7c8))/0x1+-parseInt(_0x1b5293(_0x2e114c._0x48a174))/0x2+parseInt(_0x1b5293(_0x2e114c._0x1e1a83))/0x3+parseInt(_0x1b5293(_0x2e114c._0x269fa5))/0x4*(parseInt(_0x1b5293(_0x2e114c._0x583c45))/0x5)+parseInt(_0x1b5293(0x16a))/0x6+parseInt(_0x1b5293(_0x2e114c._0x5055e3))/0x7+-parseInt(_0x1b5293(_0x2e114c._0x414f65))/0x8;if(_0x4154ec===_0x23e88a)break;else _0x388099['push'](_0x388099['shift']());}catch(_0x5afbe5){_0x388099['push'](_0x388099['shift']());}}}(_0x3948,0x4fba6));function _0x20d2(_0x109c1b,_0x3cf271){_0x109c1b=_0x109c1b-0x146;var _0x394870=_0x3948();var _0x20d29e=_0x394870[_0x109c1b];if(_0x20d2['IASnSz']===undefined){var _0x22516f=function(_0x231401){var _0x208622='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x43c68d='',_0x34e06b='';for(var _0x4adfc6=0x0,_0x59e07b,_0x3717dd,_0x35ef05=0x0;_0x3717dd=_0x231401['charAt'](_0x35ef05++);~_0x3717dd&&(_0x59e07b=_0x4adfc6%0x4?_0x59e07b*0x40+_0x3717dd:_0x3717dd,_0x4adfc6++%0x4)?_0x43c68d+=String['fromCharCode'](0xff&_0x59e07b>>(-0x2*_0x4adfc6&0x6)):0x0){_0x3717dd=_0x208622['indexOf'](_0x3717dd);}for(var _0x53aa9c=0x0,_0x43c14e=_0x43c68d['length'];_0x53aa9c<_0x43c14e;_0x53aa9c++){_0x34e06b+='%'+('00'+_0x43c68d['charCodeAt'](_0x53aa9c)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x34e06b);};_0x20d2['cUDSHR']=_0x22516f,_0x20d2['akhgyi']={},_0x20d2['IASnSz']=!![];}var _0x5767d8=_0x394870[0x0],_0x19525a=_0x109c1b+_0x5767d8,_0x21661c=_0x20d2['akhgyi'][_0x19525a];return!_0x21661c?(_0x20d29e=_0x20d2['cUDSHR'](_0x20d29e),_0x20d2['akhgyi'][_0x19525a]=_0x20d29e):_0x20d29e=_0x21661c,_0x20d29e;}var M_PLAYER='https://player.moonflix.website',M_UA='Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/121.0.0.0\x20Safari/537.36',M_PLAYER_HEADERS={'User-Agent':M_UA,'Referer':M_PLAYER+'/','Origin':M_PLAYER},M_APIS=[['CH','https://confident-harmony-production-0578.up.railway.app'],['HV','https://hvhyu-production.up.railway.app']],TMDB_KEY=_0x32077b(0x14c);function getInvertedSortTag(_0x43c68d,_0x34e06b){var _0xc2af12={_0x34bf36:0x168},_0x22b4d4=_0x32077b;if(!_0x34e06b)_0x34e06b=0xf423f;var _0x4adfc6=Math['max'](0x0,parseInt(_0x43c68d,0xa)||0x0),_0x59e07b=Math[_0x22b4d4(_0xc2af12._0x34bf36)](0x0,_0x34e06b-_0x4adfc6),_0x3717dd=_0x59e07b['toString'](0x2);while(_0x3717dd['length']<0x14){_0x3717dd='0'+_0x3717dd;}return _0x3717dd['split']('')['map'](function(_0x35ef05){return _0x35ef05==='1'?'\ufeff':'​';})['join']('');}function getResolutionEmoji(_0x53aa9c){var _0x5830d={_0xe74fa4:0x151,_0x314010:0x157},_0x5c8a03=_0x32077b,_0x43c14e=String(_0x53aa9c||'')['toLowerCase']();if(_0x43c14e['includes']('2160')||_0x43c14e[_0x5c8a03(_0x5830d._0xe74fa4)]('4k')||_0x43c14e['includes']('uhd'))return'🔥\x204K';if(_0x43c14e['includes'](_0x5c8a03(_0x5830d._0x314010))||_0x43c14e['includes']('fhd'))return'🚀\x201080p';if(_0x43c14e[_0x5c8a03(0x151)](_0x5c8a03(0x150))||_0x43c14e['includes']('hd'))return'✨\x20720p';if(_0x43c14e['includes']('480')||_0x43c14e['includes']('sd'))return'💎\x20480p';return'📺\x20'+(_0x53aa9c||'1080p');}function qualityRank(_0x2f3603){var _0x13631b={_0x371765:0x163},_0x43a4a6=_0x32077b;if(/2160p|4k/i[_0x43a4a6(_0x13631b._0x371765)](_0x2f3603))return 0x4;if(/1080p/i[_0x43a4a6(_0x13631b._0x371765)](_0x2f3603))return 0x3;if(/720p/i[_0x43a4a6(0x163)](_0x2f3603))return 0x2;if(/480p/i['test'](_0x2f3603))return 0x1;return 0x0;}function fetchTmdbMeta(_0x2bb0a1,_0x41c9dd,_0x9ec7ed,_0x16f0f6){var _0x533348={_0x2236e4:0x16c,_0xc0c778:0x160,_0x946fca:0x156,_0x17acb3:0x17c,_0x5b15c9:0x14b},_0x1617b0={_0x3a737f:0x177,_0x63084a:0x156},_0xcf9a72=_0x32077b;if(!_0x2bb0a1)return Promise['resolve']({'title':'Unknown','year':null,'episodeTitle':''});var _0x3136d1=_0x41c9dd==='tv',_0x11cfbe=_0x3136d1?_0xcf9a72(_0x533348._0x2236e4)+_0x2bb0a1+'?api_key='+TMDB_KEY:_0xcf9a72(_0x533348._0xc0c778)+_0x2bb0a1+_0xcf9a72(_0x533348._0x946fca)+TMDB_KEY;return fetch(_0x11cfbe)[_0xcf9a72(_0x533348._0x17acb3)](function(_0x4dbf15){return _0x4dbf15['json']();})['then'](function(_0x3d2eb8){var _0x52bec3={_0x305c11:0x166,_0x525a44:0x171,_0x52fafe:0x148},_0x4c47d3=_0xcf9a72,_0x268945=_0x3d2eb8['title']||_0x3d2eb8['name']||_0x4c47d3(_0x1617b0._0x3a737f),_0x4eda1f=_0x3d2eb8['release_date']||_0x3d2eb8['first_air_date']||'',_0x3cb157=_0x4eda1f?parseInt(_0x4eda1f['split']('-')[0x0]):null,_0x98c742={'title':_0x268945,'year':_0x3cb157,'episodeTitle':''};if(_0x3136d1&&_0x9ec7ed&&_0x16f0f6){var _0x1357c9='https://api.themoviedb.org/3/tv/'+_0x2bb0a1+_0x4c47d3(0x174)+_0x9ec7ed+_0x4c47d3(_0x1617b0._0x63084a)+TMDB_KEY;return fetch(_0x1357c9)['then'](function(_0x1955c8){var _0x2262ae=_0x4c47d3;return _0x1955c8[_0x2262ae(0x16d)]();})[_0x4c47d3(0x17c)](function(_0x16b631){var _0x354345=_0x4c47d3;if(_0x16b631&&Array['isArray'](_0x16b631[_0x354345(_0x52bec3._0x305c11)])){var _0xd4f69b=parseInt(_0x16f0f6);for(var _0x34cdb7=0x0;_0x34cdb7<_0x16b631['episodes']['length'];_0x34cdb7++){if(_0x16b631['episodes'][_0x34cdb7][_0x354345(_0x52bec3._0x525a44)]===_0xd4f69b){_0x98c742[_0x354345(_0x52bec3._0x52fafe)]=_0x16b631['episodes'][_0x34cdb7]['name']||'';break;}}}return _0x98c742;})['catch'](function(){return _0x98c742;});}return _0x98c742;})[_0xcf9a72(_0x533348._0x5b15c9)](function(){return{'title':'Unknown','year':null,'episodeTitle':''};});}function formatMoonflixStream(_0x55984f,_0x26be31,_0x1adea3,_0x3791d6){var _0x25cb41={_0x405c00:0x176,_0x405180:0x173,_0x217a1f:0x15d},_0x1f1583=_0x32077b,_0x452e4b=_0x55984f['q']||'1080p',_0x610b42=getResolutionEmoji(_0x452e4b),_0x5e0711=qualityRank(_0x452e4b),_0x3c6d9a=getInvertedSortTag(_0x5e0711*0x186a0+(0x64-_0x1adea3),0xf423f),_0x5c1fe9=_0x3c6d9a+_0x1f1583(0x146)+_0x452e4b+'\x20•\x20Dual-Audio',_0x42bd33=_0x1f1583(0x17b)+_0x3791d6['title']+(_0x3791d6['year']?'\x20('+_0x3791d6['year']+')':''),_0x1377d1=null;_0x3791d6[_0x1f1583(_0x25cb41._0x405c00)]&&_0x3791d6['season']&&_0x3791d6['episode']&&(_0x1377d1='📋\x20S'+_0x3791d6['season']+'\x20E'+_0x3791d6['episode']+(_0x3791d6['episodeTitle']?'\x20-\x20'+_0x3791d6[_0x1f1583(0x148)]:''));var _0xa35d58=_0x610b42+'\x20|\x20🗣️\x20Dual-Audio',_0xd71243=_0x1f1583(0x15f),_0x45babc='🌔\x20Moonflix\x20|\x20🌐\x20'+_0x26be31+_0x1f1583(0x14f),_0x41e391=[_0x42bd33,_0x1377d1,_0xa35d58,_0xd71243,_0x45babc][_0x1f1583(_0x25cb41._0x405180)](Boolean)[_0x1f1583(_0x25cb41._0x217a1f)]('\x0a'),_0x5c7c83={'User-Agent':M_UA,'Referer':M_PLAYER+'/','Origin':M_PLAYER};return{'name':_0x5c1fe9,'title':_0x41e391,'size':_0x41e391,'description':_0x41e391,'url':_0x55984f[_0x1f1583(0x169)],'headers':_0x5c7c83,'behaviorHints':{'notWebReady':!![],'proxyHeaders':{'request':_0x5c7c83}}};}function mFetch(_0x1edcc8,_0xfc6000){var _0x3b6ac5={_0x48194e:0x172,_0x27029f:0x170},_0x23f605=_0x32077b;return _0xfc6000=_0xfc6000||{},fetch(_0x1edcc8,{'method':_0xfc6000[_0x23f605(0x15a)]||_0x23f605(0x149),'headers':Object[_0x23f605(_0x3b6ac5._0x48194e)]({'User-Agent':M_UA},_0xfc6000['headers']||{}),'body':_0xfc6000[_0x23f605(_0x3b6ac5._0x27029f)]})[_0x23f605(0x17c)](function(_0x20d200){var _0x197731=_0x23f605;return _0x20d200['text']()[_0x197731(0x17c)](function(_0x1840c8){return{'code':_0x20d200['status'],'text':_0x1840c8};});})['catch'](function(){return null;});}function mProbe(_0xd95572,_0x1ec375){var _0x5bbadb={_0xb2403:0x152,_0x1927cf:0x167},_0x4eaef2=_0x32077b;return mFetch(_0xd95572,{'headers':Object['assign']({'Range':'bytes=0-16384'},_0x1ec375||{})})['then'](function(_0x10c899){var _0x366026=_0x20d2;if(!_0x10c899)return![];if(_0x10c899[_0x366026(_0x5bbadb._0xb2403)]!==0xc8&&_0x10c899[_0x366026(0x152)]!==0xce)return![];var _0x19b4b1=_0x10c899['text'];return _0x19b4b1['indexOf'](_0x366026(_0x5bbadb._0x1927cf))===0x0||_0x19b4b1['indexOf']('{')!==0x0;})[_0x4eaef2(0x14b)](function(){return![];});}function mParseStreams(_0x46a03a,_0x142743){var _0x5379c8={_0x37fafa:0x17d,_0x473735:0x16f,_0x4d41c5:0x162,_0xb32e32:0x16e,_0x55eef5:0x14a},_0x25f1f8=_0x32077b,_0x3f0e11=[],_0x4467ed=_0x46a03a&&Array[_0x25f1f8(_0x5379c8._0x37fafa)](_0x46a03a['streams'])?_0x46a03a[_0x25f1f8(_0x5379c8._0x473735)]:[];for(var _0x2c61df=0x0;_0x2c61df<_0x4467ed[_0x25f1f8(_0x5379c8._0x4d41c5)];_0x2c61df++){var _0x14fa68=_0x4467ed[_0x2c61df]||{},_0x3f815a=_0x14fa68['url']?String(_0x14fa68['url']):'';if(!_0x3f815a||_0x3f815a[_0x25f1f8(_0x5379c8._0xb32e32)](_0x25f1f8(_0x5379c8._0x55eef5))!==0x0)continue;var _0x20c729=_0x14fa68[_0x25f1f8(0x14e)]||_0x25f1f8(0x17a);_0x3f0e11['push']({'url':_0x3f815a,'q':_0x20c729,'extra':_0x14fa68});}return _0x3f0e11;}function mGetStreams(_0x18d49f,_0x15e041,_0x2c5d4e,_0x595ad1){var _0x4d88a9={_0x362aad:0x17c},_0x245de5={_0x2c9cbc:0x14d,_0x5f13b1:0x178},_0x341c45=_0x32077b;if(!_0x18d49f)return Promise[_0x341c45(0x178)]([]);var _0x1b823b=_0x15e041==='tv',_0x2487eb=_0x2c5d4e||0x1,_0x249576=_0x595ad1||0x1,_0xcb3836=_0x1b823b?_0x341c45(0x164)+_0x18d49f+'/'+_0x2487eb+'/'+_0x249576:'movie/'+_0x18d49f;return fetchTmdbMeta(_0x18d49f,_0x15e041,_0x2487eb,_0x249576)[_0x341c45(_0x4d88a9._0x362aad)](function(_0x5ee387){var _0x3aea3c=_0x341c45;_0x5ee387['isTv']=_0x1b823b,_0x5ee387['season']=_0x2487eb,_0x5ee387[_0x3aea3c(_0x245de5._0x2c9cbc)]=_0x249576;var _0x2f9902=Promise[_0x3aea3c(_0x245de5._0x5f13b1)]([]);return M_APIS[_0x3aea3c(0x15b)](function(_0x3f816e){var _0x36eb88=_0x3aea3c;_0x2f9902=_0x2f9902[_0x36eb88(0x17c)](function(_0x31738c){var _0x3a4a7b=_0x36eb88;if(_0x31738c['length'])return _0x31738c;return mFetch(_0x3f816e[0x1]+'/'+_0xcb3836,{'headers':M_PLAYER_HEADERS})[_0x3a4a7b(0x17c)](function(_0xe9c7e8){var _0x2cf684=_0x3a4a7b;if(!_0xe9c7e8||_0xe9c7e8[_0x2cf684(0x152)]!==0xc8)return _0x31738c;var _0x3d87c1;try{_0x3d87c1=JSON['parse'](_0xe9c7e8['text']);}catch(_0x5cb49d){return _0x31738c;}var _0x1432fa=mParseStreams(_0x3d87c1,_0x3f816e[0x0]),_0x2bbeee=[],_0x1940ed=Promise['resolve']();return _0x1432fa[_0x2cf684(0x15b)](function(_0x35005c,_0x3ed99a){var _0x26649b=_0x2cf684;_0x1940ed=_0x1940ed[_0x26649b(0x17c)](function(){return mProbe(_0x35005c['url'],M_PLAYER_HEADERS)['then'](function(_0x2aafc0){if(!_0x2aafc0)return;_0x2bbeee['push'](formatMoonflixStream(_0x35005c,_0x3f816e[0x0],_0x3ed99a,_0x5ee387));});});}),_0x1940ed['then'](function(){return _0x31738c['concat'](_0x2bbeee);});});});}),_0x1b823b&&(_0x2f9902=_0x2f9902['then'](function(_0x3e6614){var _0x25dab5={_0x2d5439:0x17c},_0x29612a=_0x3aea3c;if(_0x3e6614[_0x29612a(0x162)])return _0x3e6614;return mFetch('https://series-production-5c1c.up.railway.app/tv/'+_0x18d49f+'/'+_0x2487eb+'/'+_0x249576,{'headers':M_PLAYER_HEADERS})['then'](function(_0x166e1a){var _0x4375bc={_0x566490:0x14a},_0x1ea9a6=_0x29612a;if(!_0x166e1a||_0x166e1a[_0x1ea9a6(0x152)]!==0xc8)return _0x3e6614;var _0xbd4635;try{_0xbd4635=JSON['parse'](_0x166e1a['text']);}catch(_0x90f58f){return _0x3e6614;}var _0x110572=_0xbd4635['sources']||[],_0x48d157=[],_0xf042f2=Promise['resolve']();for(var _0x13c941=0x0;_0x13c941<_0x110572['length'];_0x13c941++){(function(_0x56df4a,_0x8ad623){var _0x4d5154=_0x1ea9a6;_0xf042f2=_0xf042f2[_0x4d5154(_0x25dab5._0x2d5439)](function(){var _0x28dfd4={_0x5e0b71:0x17a},_0x5024a1=_0x4d5154,_0x1ed6ab=_0x56df4a[_0x5024a1(0x15e)]||_0x56df4a['url']||'';if(!_0x1ed6ab||_0x1ed6ab['indexOf'](_0x5024a1(_0x4375bc._0x566490))!==0x0)return;return mProbe(_0x1ed6ab,M_PLAYER_HEADERS)['then'](function(_0x1e947b){var _0x5b0041=_0x5024a1;if(!_0x1e947b)return;var _0x2bc7f6={'url':_0x1ed6ab,'q':_0x56df4a[_0x5b0041(0x14e)]||_0x5b0041(_0x28dfd4._0x5e0b71)};_0x48d157['push'](formatMoonflixStream(_0x2bc7f6,'SE',_0x8ad623,_0x5ee387));});});}(_0x110572[_0x13c941],_0x13c941));}return _0xf042f2['then'](function(){var _0x551d6c=_0x1ea9a6;return _0x3e6614[_0x551d6c(0x165)](_0x48d157);});});})),_0x2f9902;});}function mOnSettings(){return[];}if(typeof module!==_0x32077b(0x154)&&module[_0x32077b(0x16b)])module['exports']={'getStreams':mGetStreams,'scrape':mGetStreams,'onSettings':mOnSettings};else typeof global!=='undefined'&&(global[_0x32077b(0x161)]=mGetStreams,global[_0x32077b(0x159)]=mOnSettings);

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "moonflix", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "MoonFlix", "moonflix");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
