// Imported provider: animeworld; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
var _0x388760=_0x3571;(function(_0x5bf76f,_0x3a97b1){var _0x1a9865={_0x5721b6:0x1e4,_0x533016:0x1e1,_0x41c127:0x1c4,_0x17bb1e:0x1da,_0x40787b:0x1c5,_0xc5f98:0x1f4},_0x226b65=_0x3571,_0x194c2c=_0x5bf76f();while(!![]){try{var _0xc353c8=-parseInt(_0x226b65(_0x1a9865._0x5721b6))/0x1+-parseInt(_0x226b65(_0x1a9865._0x533016))/0x2*(parseInt(_0x226b65(_0x1a9865._0x41c127))/0x3)+parseInt(_0x226b65(0x1d3))/0x4+-parseInt(_0x226b65(0x1c8))/0x5*(parseInt(_0x226b65(0x1d2))/0x6)+-parseInt(_0x226b65(_0x1a9865._0x17bb1e))/0x7+parseInt(_0x226b65(0x1db))/0x8*(parseInt(_0x226b65(_0x1a9865._0x40787b))/0x9)+parseInt(_0x226b65(0x1d0))/0xa*(parseInt(_0x226b65(_0x1a9865._0xc5f98))/0xb);if(_0xc353c8===_0x3a97b1)break;else _0x194c2c['push'](_0x194c2c['shift']());}catch(_0x3b64af){_0x194c2c['push'](_0x194c2c['shift']());}}}(_0xf2c8,0x4bc85));var TMDB_KEY='d80ba92bc7cefe3359668d30d06f3305',BASE='https://watchanimeworld.top',PLAYER='https://play.zephyrix.top',UA=_0x388760(0x1e2);function getInvertedSortTag(_0x4c3f75,_0xfb7bb3){var _0x290f4f={_0x394ae0:0x1e3,_0x178b3e:0x1d1},_0x332005=_0x388760;if(!_0xfb7bb3)_0xfb7bb3=0xf423f;var _0x23a5d2=Math[_0x332005(0x1ce)](0x0,parseInt(_0x4c3f75,0xa)||0x0),_0x5c9928=Math['max'](0x0,_0xfb7bb3-_0x23a5d2),_0x40953a=_0x5c9928['toString'](0x2);while(_0x40953a['length']<0x14){_0x40953a='0'+_0x40953a;}return _0x40953a[_0x332005(0x1de)]('')[_0x332005(_0x290f4f._0x394ae0)](function(_0xefa4ba){return _0xefa4ba==='1'?'\ufeff':'​';})[_0x332005(_0x290f4f._0x178b3e)]('');}function _0x3571(_0x51eec8,_0x90a31b){_0x51eec8=_0x51eec8-0x1be;var _0xf2c8da=_0xf2c8();var _0x3571df=_0xf2c8da[_0x51eec8];if(_0x3571['vcGYyl']===undefined){var _0x22837f=function(_0x7e26eb){var _0x155595='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x4c3f75='',_0xfb7bb3='';for(var _0x23a5d2=0x0,_0x5c9928,_0x40953a,_0xefa4ba=0x0;_0x40953a=_0x7e26eb['charAt'](_0xefa4ba++);~_0x40953a&&(_0x5c9928=_0x23a5d2%0x4?_0x5c9928*0x40+_0x40953a:_0x40953a,_0x23a5d2++%0x4)?_0x4c3f75+=String['fromCharCode'](0xff&_0x5c9928>>(-0x2*_0x23a5d2&0x6)):0x0){_0x40953a=_0x155595['indexOf'](_0x40953a);}for(var _0x56397c=0x0,_0x631031=_0x4c3f75['length'];_0x56397c<_0x631031;_0x56397c++){_0xfb7bb3+='%'+('00'+_0x4c3f75['charCodeAt'](_0x56397c)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0xfb7bb3);};_0x3571['bUQCiL']=_0x22837f,_0x3571['ZYjsat']={},_0x3571['vcGYyl']=!![];}var _0x1b164b=_0xf2c8da[0x0],_0x50eb6a=_0x51eec8+_0x1b164b,_0x3fd203=_0x3571['ZYjsat'][_0x50eb6a];return!_0x3fd203?(_0x3571df=_0x3571['bUQCiL'](_0x3571df),_0x3571['ZYjsat'][_0x50eb6a]=_0x3571df):_0x3571df=_0x3fd203,_0x3571df;}function qualityRank(_0x56397c){var _0x122cb9={_0x5ab1bc:0x1e8},_0xa97dd7=_0x388760;if(/2160p|4k/i[_0xa97dd7(0x1e8)](_0x56397c))return 0x4;if(/1080p/i[_0xa97dd7(0x1e8)](_0x56397c))return 0x3;if(/720p/i[_0xa97dd7(_0x122cb9._0x5ab1bc)](_0x56397c))return 0x2;if(/480p/i['test'](_0x56397c))return 0x1;return 0x0;}function httpGet(_0x631031,_0x2c3d03){var _0x10d49e={_0x234804:0x1c0},_0x1fdc12=_0x388760;return fetch(_0x631031,{'headers':Object[_0x1fdc12(_0x10d49e._0x234804)]({'User-Agent':UA},_0x2c3d03||{})})['then'](function(_0x35fa86){var _0x4306a6=_0x1fdc12;if(!_0x35fa86['ok'])throw new Error(_0x4306a6(0x1c6)+_0x35fa86[_0x4306a6(0x1ed)]);return _0x35fa86['text']();});}function httpPost(_0x561273,_0x25b05b,_0x23cf0a){var _0x2248c9={_0x23b087:0x1e0},_0x1f5ed3={_0x1cbff5:0x1f1},_0x11f50c=_0x388760;return fetch(_0x561273,{'method':_0x11f50c(_0x2248c9._0x23b087),'headers':Object[_0x11f50c(0x1c0)]({'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},_0x23cf0a||{}),'body':_0x25b05b})['then'](function(_0x19d609){var _0xe21291=_0x11f50c;if(!_0x19d609['ok'])throw new Error('HTTP\x20'+_0x19d609[_0xe21291(0x1ed)]);return _0x19d609[_0xe21291(_0x1f5ed3._0x1cbff5)]();});}function searchSite(_0x351314,_0x4be9e8){var _0x31dfb5={_0x239f28:0x1bf},_0x473b77={_0x3101ee:0x1e6,_0x124cd2:0x1c2},_0x2b3cd0=BASE+'/?s='+encodeURIComponent(_0x351314);return httpGet(_0x2b3cd0,{'Referer':BASE+'/'})['then'](function(_0x9e0c7d){var _0x82d447=_0x3571,_0x2adf89=[],_0x14b4c4=/href="(https:\/\/watchanimeworld\.top\/(series|movies)\/([^\/\"]+)\/)"/g,_0x1e5b68;while((_0x1e5b68=_0x14b4c4['exec'](_0x9e0c7d))!==null){var _0x53679f=_0x1e5b68[0x1],_0x160d23=_0x1e5b68[0x2],_0x1c1991=_0x1e5b68[0x3];_0x1c1991&&_0x1c1991!=='page'&&_0x2adf89[_0x82d447(0x1d7)]({'url':_0x53679f,'type':_0x160d23,'slug':_0x1c1991});}return _0x2adf89[_0x82d447(_0x31dfb5._0x239f28)](function(_0xfcc283){var _0xee17a5=_0x82d447;return _0x4be9e8===_0xee17a5(_0x473b77._0x3101ee)?_0xfcc283['type']===_0xee17a5(0x1d5):_0xfcc283[_0xee17a5(_0x473b77._0x124cd2)]===_0xee17a5(0x1c9);});});}function _0xf2c8(){var _0x2abaea=['BwfW','mZCYmdC5z29KqLbw','8j+tIYbt','Bw92Awu','zxbPC29Kzv9UDw1Izxi','DgvZDa','iokaOIbnDwX0As1bDwrPBW','we1mshr0CfjLCxvLC3q','BgvUz3rO','EwvHCG','C3rHDhvZ','Bwf0y2G','jNi9','DxjS','ANnVBG','BMfTzq','zxHLyW','mJC1u05ouunX','8j+xOE+4JYa','zMLSDgvY','yxnZAwDU','ic0G','DhLWzq','zxbPC29Kzxm','mJCXnZrXt2DzrfK','mtyYC25wv0PX','sfruuca','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','mJK1u2f2zfbq','C2vYAwvZ','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','jMrVpwDLDfzPzgvV','DgHLBG','y2f0y2G','Bwf4','zxbPC29KzvrPDgXL','mJuYnJqWteDoC0vY','AM9PBG','odqXofvqshLuvG','mtuYnZi4mhL3BhLbyq','rw5NBgLZAa','Bw92AwvZ','l3DWlwfKBwLUl2fKBwLUlwfQyxGUCgHWp2fJDgLVBJ1Hy3rPB25FC2vSzwn0x3nLyxnVBIzZzwfZB249','ChvZAa','C2vJDxjLzeXPBMS','Aw5KzxHpzG','mJGZmdC2nwDMEhvRqW','nZm0nJrNzvbtEfe','A2vLCc1HBgL2zq','zMLYC3rFywLYx2rHDgu','C3bSAxq','l2nKBI9KB3DUlW','ue9tva','mNLQrvfbsa','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2'];_0xf2c8=function(){return _0x2abaea;};return _0xf2c8();}function getEpisodeUrl(_0x590dbe,_0x28538a,_0x29cb65){var _0x156730={_0x63ff1e:0x1ee,_0x437d06:0x1ee},_0x2818c4={_0x5d7f1e:0x1d9};return httpGet(_0x590dbe,{'Referer':BASE+'/'})['then'](function(_0x51a2a4){var _0x2e9d21=_0x3571,_0x2673f1=_0x51a2a4[_0x2e9d21(_0x156730._0x63ff1e)](/postid-(\d+)/)||_0x51a2a4[_0x2e9d21(_0x156730._0x437d06)](/data-post="(\d+)"/);if(!_0x2673f1)return null;var _0x886d37=BASE+_0x2e9d21(0x1d6)+_0x28538a+'&post='+_0x2673f1[0x1];return httpGet(_0x886d37,{'Referer':_0x590dbe})['then'](function(_0x3b2056){var _0x40e1af=_0x2e9d21,_0x57f381=_0x28538a+'x'+_0x29cb65+'/',_0xf2abe5=/href="(https:\/\/watchanimeworld\.top\/episode\/([^"]+))"/g,_0x52d1b3;while((_0x52d1b3=_0xf2abe5[_0x40e1af(0x1f3)](_0x3b2056))!==null){if(_0x52d1b3[0x1][_0x40e1af(_0x2818c4._0x5d7f1e)](_0x57f381)!==-0x1)return _0x52d1b3[0x1];}return null;});});}function getStreamFromPage(_0x10e27e){var _0x1ad9bd={_0x4f20de:0x1ef,_0x85a47a:0x1ea},_0x328b10={_0xe563da:0x1d8,_0x1c02a0:0x1df},_0x214d20=_0x388760;return httpGet(_0x10e27e,{'Referer':BASE+'/'})[_0x214d20(0x1cc)](function(_0x166a21){var _0x5e15fe=_0x214d20,_0x100606=_0x166a21['match'](/(?:src|data-src)="(https:\/\/play\.zephyrix\.top\/video\/([a-f0-9]+))"/);if(!_0x100606)return null;var _0xb075b=_0x100606[0x2];return httpPost(PLAYER+'/player/index.php?data='+_0xb075b+_0x5e15fe(0x1cb),'hash='+_0xb075b+_0x5e15fe(_0x1ad9bd._0x4f20de)+encodeURIComponent(BASE+'/'),{'Referer':BASE+'/','Origin':PLAYER,'X-Requested-With':_0x5e15fe(_0x1ad9bd._0x85a47a)})['then'](function(_0x1fe1bd){var _0x37ac33=_0x5e15fe,_0x541b95=_0x1fe1bd['videoSource']||_0x1fe1bd[_0x37ac33(_0x328b10._0xe563da)];if(!_0x541b95)return null;var _0x2971a0=_0x541b95['match'](/\/cdn\/hls\/([a-f0-9]+)\//),_0x490804=_0x2971a0?_0x2971a0[0x1]:_0xb075b,_0x1427cb=PLAYER+_0x37ac33(_0x328b10._0x1c02a0)+_0x490804+'/Subtitle/subtitle_eng.srt';return{'url':_0x541b95,'subtitle':_0x1427cb};});});}function getStreams(_0xb4ba8e,_0x431eca,_0x32ec6c,_0x3510d2){var _0x25bd51={_0x519fb2:0x1c7,_0x573d75:0x1e6,_0x4c0259:0x1cc},_0x44a76d={_0x267443:0x1ec,_0x10e2e7:0x1e5,_0x196cb8:0x1cf,_0x3854a8:0x1d1,_0x3b1df3:0x1d4},_0x3611cd={_0x239625:0x1f0},_0x276747={_0x2da500:0x1f2,_0x55f572:0x1de,_0xe2953a:0x1cd};return new Promise(function(_0x2674af){var _0x36ece6={_0x1f50a9:0x1f1},_0x4a233c=_0x3571,_0xf2f0eb=_0x4a233c(_0x25bd51._0x519fb2)+(_0x431eca===_0x4a233c(_0x25bd51._0x573d75)?_0x4a233c(0x1e6):'tv')+'/'+_0xb4ba8e+'?api_key='+TMDB_KEY,_0x2de7a6={'title':'Unknown','year':null,'episodeTitle':''};fetch(_0xf2f0eb)[_0x4a233c(_0x25bd51._0x4c0259)](function(_0x5ec918){return _0x5ec918['json']();})[_0x4a233c(_0x25bd51._0x4c0259)](function(_0x5b0372){var _0x5cd158={_0x46d3ce:0x1eb,_0x186606:0x1cf},_0xab877=_0x4a233c,_0xe69161=_0x5b0372['title']||_0x5b0372[_0xab877(_0x276747._0x2da500)];if(!_0xe69161)throw new Error('No\x20title');var _0x110a61=_0x5b0372['release_date']||_0x5b0372[_0xab877(0x1dd)]||'',_0x9ccb29=_0x110a61?parseInt(_0x110a61[_0xab877(_0x276747._0x55f572)]('-')[0x0]):null;_0x2de7a6['title']=_0xe69161,_0x2de7a6['year']=_0x9ccb29;if(_0x431eca==='tv'&&_0x32ec6c){var _0x1e01ed=_0xab877(0x1ca)+_0xb4ba8e+'/season/'+_0x32ec6c+'?api_key='+TMDB_KEY;return fetch(_0x1e01ed)['then'](function(_0x19bd77){var _0x259f49=_0xab877;return _0x19bd77[_0x259f49(_0x36ece6._0x1f50a9)]();})['then'](function(_0x4da677){var _0x8fd48e=_0xab877;if(_0x4da677&&_0x4da677[_0x8fd48e(0x1c3)]){var _0x5b5531=parseInt(_0x3510d2)||0x1;for(var _0x1b32c6=0x0;_0x1b32c6<_0x4da677['episodes'][_0x8fd48e(_0x5cd158._0x46d3ce)];_0x1b32c6++){if(_0x4da677[_0x8fd48e(0x1c3)][_0x1b32c6][_0x8fd48e(0x1e7)]===_0x5b5531){_0x2de7a6[_0x8fd48e(_0x5cd158._0x186606)]=_0x4da677[_0x8fd48e(0x1c3)][_0x1b32c6]['name']||'';break;}}}return searchSite(_0xe69161,_0x431eca);})[_0xab877(_0x276747._0xe2953a)](function(){return searchSite(_0xe69161,_0x431eca);});}return searchSite(_0xe69161,_0x431eca);})['then'](function(_0x26bc10){var _0x9ef501=_0x4a233c;if(!_0x26bc10||_0x26bc10['length']===0x0)return _0x2674af([]),null;var _0x5d6ef1=_0x26bc10[0x0][_0x9ef501(_0x3611cd._0x239625)];if(_0x431eca==='movie')return getStreamFromPage(_0x5d6ef1);return getEpisodeUrl(_0x5d6ef1,_0x32ec6c,_0x3510d2)['then'](function(_0x31cd07){return _0x31cd07?getStreamFromPage(_0x31cd07):null;});})['then'](function(_0xc0dfdd){var _0x2fe9ce=_0x4a233c;if(!_0xc0dfdd){_0x2674af([]);return;}var _0x1e9c74='1080p',_0xd3fac2=qualityRank(_0x1e9c74),_0xfc82e9=getInvertedSortTag(_0xd3fac2*0x186a0,0xf423f),_0x22a89e=_0xfc82e9+'AnimeWorld\x20•\x20'+_0x1e9c74+_0x2fe9ce(0x1e9),_0x1cdbcb=_0x2fe9ce(0x1be)+_0x2de7a6['title']+(_0x2de7a6[_0x2fe9ce(_0x44a76d._0x267443)]?'\x20('+_0x2de7a6['year']+')':''),_0x3bc986=null;_0x431eca==='tv'&&_0x32ec6c&&_0x3510d2&&(_0x3bc986=_0x2fe9ce(_0x44a76d._0x10e2e7)+_0x32ec6c+'\x20E'+_0x3510d2+(_0x2de7a6[_0x2fe9ce(0x1cf)]?_0x2fe9ce(0x1c1)+_0x2de7a6[_0x2fe9ce(_0x44a76d._0x196cb8)]:''));var _0x430bb='🔥\x201080p\x20|\x20🗣️\x20Multi-Audio\x20|\x20🎧\x20AAC',_0x5f72fa='🎞️\x20M3U8\x20|\x20⚡\x20H.264\x20|\x20🎥\x20HLS',_0x17c69b='🔗\x20AnimeWorld\x20|\x20🌐\x20Zephyrix\x20CDN',_0x213220=[_0x1cdbcb,_0x3bc986,_0x430bb,_0x5f72fa,_0x17c69b]['filter'](Boolean)[_0x2fe9ce(_0x44a76d._0x3854a8)]('\x0a');_0x2674af([{'name':_0x22a89e,'title':_0x213220,'size':_0x213220,'description':_0x213220,'url':_0xc0dfdd['url'],'headers':{'Referer':PLAYER+'/','Origin':PLAYER,'User-Agent':UA,'Connection':_0x2fe9ce(0x1dc)},'subtitles':_0xc0dfdd['subtitle']?[{'url':_0xc0dfdd['subtitle'],'lang':'en','name':_0x2fe9ce(_0x44a76d._0x3b1df3)}]:[]}]);})['catch'](function(){_0x2674af([]);});});}module['exports']={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animeworld", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🗡️ AnimeWorld", "animeworld");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
