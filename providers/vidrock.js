// Imported provider: vidrock; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x1fe5d1=_0x4bc9;(function(_0x4d1f37,_0x16f41e){const _0x3685b1={_0x59e8b2:0x209,_0x57eaee:0x20a,_0x3a5874:0x1d8,_0x1483f1:0x1ba,_0x3e927b:0x1f9,_0x5b1802:0x1f1},_0x2b3656=_0x4bc9,_0x59699b=_0x4d1f37();while(!![]){try{const _0x3f710f=-parseInt(_0x2b3656(_0x3685b1._0x59e8b2))/0x1*(-parseInt(_0x2b3656(_0x3685b1._0x57eaee))/0x2)+parseInt(_0x2b3656(0x1d5))/0x3+parseInt(_0x2b3656(0x208))/0x4+-parseInt(_0x2b3656(_0x3685b1._0x3a5874))/0x5+parseInt(_0x2b3656(0x1fd))/0x6+-parseInt(_0x2b3656(_0x3685b1._0x1483f1))/0x7+parseInt(_0x2b3656(_0x3685b1._0x3e927b))/0x8*(parseInt(_0x2b3656(_0x3685b1._0x5b1802))/0x9);if(_0x3f710f===_0x16f41e)break;else _0x59699b['push'](_0x59699b['shift']());}catch(_0x4e1889){_0x59699b['push'](_0x59699b['shift']());}}}(_0x572c,0xb5aa4));var __async=(_0x71bf3e,_0x848029,_0x295487)=>{const _0x5dd5e2={_0xfaf840:0x1f0};return new Promise((_0x509e39,_0x24f765)=>{const _0x437b18=_0x4bc9;var _0x4d0e59=_0x1442ff=>{try{_0x259a66(_0x295487['next'](_0x1442ff));}catch(_0x3ccd12){_0x24f765(_0x3ccd12);}},_0x2f55ce=_0x215a54=>{try{_0x259a66(_0x295487['throw'](_0x215a54));}catch(_0x3d309b){_0x24f765(_0x3d309b);}},_0x259a66=_0x30c04b=>_0x30c04b['done']?_0x509e39(_0x30c04b[_0x437b18(0x1c3)]):Promise['resolve'](_0x30c04b['value'])['then'](_0x4d0e59,_0x2f55ce);_0x259a66((_0x295487=_0x295487[_0x437b18(_0x5dd5e2._0xfaf840)](_0x71bf3e,_0x848029))[_0x437b18(0x1e2)]());});},TMDB_API_KEY='1865f43a0549ca50d341dd9ab8b29f49',DOMAINS_URL='https://raw.githubusercontent.com/sapariyaneel/nuvio-plugin/refs/heads/main/domains.json',FALLBACK_BASE_URL=_0x1fe5d1(0x1ce),HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/137.0.0.0\x20Safari/537.36','Referer':'https://vidrock.net/','Origin':'https://vidrock.net'},STREAM_KEY_HEX=_0x1fe5d1(0x1ed),GCM_IV_LENGTH=0xc,GCM_TAG_LENGTH=0x10,cachedDomains=null;function getDomains(){return __async(this,null,function*(){if(cachedDomains)return cachedDomains;try{const _0x31cfa9=yield fetch(DOMAINS_URL,{'skipSizeCheck':!![]});cachedDomains=yield _0x31cfa9['json']();}catch(_0x5dd86f){cachedDomains={};}return cachedDomains;});}function getBaseUrl(){const _0x56c01a={_0xd90b24:0x1c5};return __async(this,null,function*(){const _0x3a37b5=_0x4bc9,_0x4a7d5a=yield getDomains();return(_0x4a7d5a[_0x3a37b5(_0x56c01a._0xd90b24)]||FALLBACK_BASE_URL)['replace'](/\/+$/,'');});}var AES_SBOX=new Uint8Array(0x100),AES_RCON=[0x1,0x2,0x4,0x8,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d];(function buildSbox(){const _0x3b8e24=new Uint8Array(0x100),_0x5ea36a=new Uint8Array(0x100);let _0x3daa25=0x1;for(let _0x5674eb=0x0;_0x5674eb<0x100;_0x5674eb++){_0x3b8e24[_0x5674eb]=_0x3daa25,_0x5ea36a[_0x3daa25]=_0x5674eb,_0x3daa25=(_0x3daa25^_0x3daa25<<0x1&0xff^(_0x3daa25&0x80?0x1b:0x0))&0xff;}AES_SBOX[0x0]=0x63;for(let _0x271f6e=0x1;_0x271f6e<0x100;_0x271f6e++){const _0x513533=_0x3b8e24[(0xff-_0x5ea36a[_0x271f6e])%0xff];let _0x4f1e9c=_0x513533,_0xb3dec8=_0x513533;for(let _0x21f7a0=0x0;_0x21f7a0<0x4;_0x21f7a0++){_0xb3dec8=(_0xb3dec8<<0x1|_0xb3dec8>>>0x7)&0xff,_0x4f1e9c^=_0xb3dec8;}AES_SBOX[_0x271f6e]=(_0x4f1e9c^0x63)&0xff;}}());function gfMultiply(_0x4b6f7d,_0x51574){let _0x50ed16=0x0;while(_0x51574){if(_0x51574&0x1)_0x50ed16^=_0x4b6f7d;_0x4b6f7d=(_0x4b6f7d<<0x1^(_0x4b6f7d&0x80?0x1b:0x0))&0xff,_0x51574>>=0x1;}return _0x50ed16&0xff;}function expandAesKey(_0x984572){const _0x4e598b={_0x4fd0d7:0x1bc},_0x567301=_0x1fe5d1,_0x8af7c=_0x984572['length']/0x4,_0x3d4701=_0x8af7c+0x6,_0x16d034=new Uint8Array(0x10*(_0x3d4701+0x1));_0x16d034[_0x567301(_0x4e598b._0x4fd0d7)](_0x984572);for(let _0x574071=_0x8af7c;_0x574071<0x4*(_0x3d4701+0x1);_0x574071++){let _0x1d08a2=_0x16d034[(_0x574071-0x1)*0x4],_0x3f33f7=_0x16d034[(_0x574071-0x1)*0x4+0x1],_0xc7a1d1=_0x16d034[(_0x574071-0x1)*0x4+0x2],_0x377233=_0x16d034[(_0x574071-0x1)*0x4+0x3];if(_0x574071%_0x8af7c===0x0){const _0x1db76f=_0x1d08a2;_0x1d08a2=AES_SBOX[_0x3f33f7]^AES_RCON[_0x574071/_0x8af7c-0x1],_0x3f33f7=AES_SBOX[_0xc7a1d1],_0xc7a1d1=AES_SBOX[_0x377233],_0x377233=AES_SBOX[_0x1db76f];}else _0x8af7c>0x6&&_0x574071%_0x8af7c===0x4&&(_0x1d08a2=AES_SBOX[_0x1d08a2],_0x3f33f7=AES_SBOX[_0x3f33f7],_0xc7a1d1=AES_SBOX[_0xc7a1d1],_0x377233=AES_SBOX[_0x377233]);_0x16d034[_0x574071*0x4]=_0x16d034[(_0x574071-_0x8af7c)*0x4]^_0x1d08a2,_0x16d034[_0x574071*0x4+0x1]=_0x16d034[(_0x574071-_0x8af7c)*0x4+0x1]^_0x3f33f7,_0x16d034[_0x574071*0x4+0x2]=_0x16d034[(_0x574071-_0x8af7c)*0x4+0x2]^_0xc7a1d1,_0x16d034[_0x574071*0x4+0x3]=_0x16d034[(_0x574071-_0x8af7c)*0x4+0x3]^_0x377233;}return{'schedule':_0x16d034,'rounds':_0x3d4701};}function aesEncryptBlock(_0x2124c4,_0x214902){const _0x35a129=_0x1fe5d1,_0x585c9b=_0x214902[_0x35a129(0x1c0)],_0x5682cd=_0x214902['rounds'];for(let _0x3c3d16=0x0;_0x3c3d16<0x10;_0x3c3d16++)_0x2124c4[_0x3c3d16]^=_0x585c9b[_0x3c3d16];for(let _0x2adac6=0x1;_0x2adac6<=_0x5682cd;_0x2adac6++){for(let _0x12af79=0x0;_0x12af79<0x10;_0x12af79++)_0x2124c4[_0x12af79]=AES_SBOX[_0x2124c4[_0x12af79]];let _0x76a664=_0x2124c4[0x1];_0x2124c4[0x1]=_0x2124c4[0x5],_0x2124c4[0x5]=_0x2124c4[0x9],_0x2124c4[0x9]=_0x2124c4[0xd],_0x2124c4[0xd]=_0x76a664,_0x76a664=_0x2124c4[0x2],_0x2124c4[0x2]=_0x2124c4[0xa],_0x2124c4[0xa]=_0x76a664,_0x76a664=_0x2124c4[0x6],_0x2124c4[0x6]=_0x2124c4[0xe],_0x2124c4[0xe]=_0x76a664,_0x76a664=_0x2124c4[0xf],_0x2124c4[0xf]=_0x2124c4[0xb],_0x2124c4[0xb]=_0x2124c4[0x7],_0x2124c4[0x7]=_0x2124c4[0x3],_0x2124c4[0x3]=_0x76a664;if(_0x2adac6!==_0x5682cd)for(let _0x191786=0x0;_0x191786<0x4;_0x191786++){const _0x2eb2cf=_0x191786*0x4,_0x421510=_0x2124c4[_0x2eb2cf],_0x28eef1=_0x2124c4[_0x2eb2cf+0x1],_0xa79a51=_0x2124c4[_0x2eb2cf+0x2],_0x28328e=_0x2124c4[_0x2eb2cf+0x3];_0x2124c4[_0x2eb2cf]=gfMultiply(_0x421510,0x2)^gfMultiply(_0x28eef1,0x3)^_0xa79a51^_0x28328e,_0x2124c4[_0x2eb2cf+0x1]=_0x421510^gfMultiply(_0x28eef1,0x2)^gfMultiply(_0xa79a51,0x3)^_0x28328e,_0x2124c4[_0x2eb2cf+0x2]=_0x421510^_0x28eef1^gfMultiply(_0xa79a51,0x2)^gfMultiply(_0x28328e,0x3),_0x2124c4[_0x2eb2cf+0x3]=gfMultiply(_0x421510,0x3)^_0x28eef1^_0xa79a51^gfMultiply(_0x28328e,0x2);}for(let _0x4b80ae=0x0;_0x4b80ae<0x10;_0x4b80ae++)_0x2124c4[_0x4b80ae]^=_0x585c9b[_0x2adac6*0x10+_0x4b80ae];}return _0x2124c4;}function hexToBytes(_0x1899d1){const _0x7e6335={_0x378705:0x1d0,_0xcf0461:0x1d1},_0x134aac=_0x1fe5d1,_0x4d954a=new Uint8Array(_0x1899d1[_0x134aac(_0x7e6335._0x378705)]/0x2);for(let _0x35c52a=0x0;_0x35c52a<_0x4d954a[_0x134aac(0x1d0)];_0x35c52a++)_0x4d954a[_0x35c52a]=parseInt(_0x1899d1[_0x134aac(_0x7e6335._0xcf0461)](_0x35c52a*0x2,0x2),0x10);return _0x4d954a;}var BASE64_CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';function base64UrlToBytes(_0x16b088){const _0x4d672b={_0x4eac83:0x1ee,_0x568143:0x1eb},_0x30dce2=_0x1fe5d1,_0x36b81a=_0x16b088[_0x30dce2(_0x4d672b._0x4eac83)](/-/g,'+')['replace'](/_/g,'/')['replace'](/=+$/,''),_0x24ad0e=new Uint8Array(Math[_0x30dce2(0x1c8)](_0x36b81a['length']*0x3/0x4));let _0x4d1415=0x0,_0x180ac2=0x0,_0x328558=0x0;for(let _0x31a74a=0x0;_0x31a74a<_0x36b81a[_0x30dce2(0x1d0)];_0x31a74a++){const _0x37c629=BASE64_CHARS[_0x30dce2(0x1e3)](_0x36b81a[_0x30dce2(_0x4d672b._0x568143)](_0x31a74a));if(_0x37c629<0x0)continue;_0x4d1415=_0x4d1415<<0x6|_0x37c629,_0x180ac2+=0x6,_0x180ac2>=0x8&&(_0x180ac2-=0x8,_0x24ad0e[_0x328558++]=_0x4d1415>>_0x180ac2&0xff);}return _0x24ad0e[_0x30dce2(0x1de)](0x0,_0x328558);}function utf8BytesToString(_0x4d1596){const _0x818024={_0x5dadb2:0x1bd,_0x5cc641:0x1bd},_0x397132=_0x1fe5d1;let _0x347bd5='',_0x2e323e=0x0;while(_0x2e323e<_0x4d1596['length']){const _0xaaffb1=_0x4d1596[_0x2e323e++];if(_0xaaffb1<0x80)_0x347bd5+=String[_0x397132(0x1bd)](_0xaaffb1);else{if((_0xaaffb1&0xe0)===0xc0){const _0x387e2d=_0x4d1596[_0x2e323e++];_0x347bd5+=String[_0x397132(_0x818024._0x5dadb2)]((_0xaaffb1&0x1f)<<0x6|_0x387e2d&0x3f);}else{if((_0xaaffb1&0xf0)===0xe0){const _0x23e84d=_0x4d1596[_0x2e323e++],_0x4a3746=_0x4d1596[_0x2e323e++];_0x347bd5+=String[_0x397132(_0x818024._0x5cc641)]((_0xaaffb1&0xf)<<0xc|(_0x23e84d&0x3f)<<0x6|_0x4a3746&0x3f);}else{if((_0xaaffb1&0xf8)===0xf0){const _0xf5024=_0x4d1596[_0x2e323e++],_0x2eef9d=_0x4d1596[_0x2e323e++],_0x5e490e=_0x4d1596[_0x2e323e++];let _0x3c1773=(_0xaaffb1&0x7)<<0x12|(_0xf5024&0x3f)<<0xc|(_0x2eef9d&0x3f)<<0x6|_0x5e490e&0x3f;_0x3c1773-=0x10000,_0x347bd5+=String[_0x397132(0x1bd)](0xd800+(_0x3c1773>>0xa),0xdc00+(_0x3c1773&0x3ff));}else _0x347bd5+=String[_0x397132(_0x818024._0x5dadb2)](_0xaaffb1);}}}}return _0x347bd5;}var cachedKeySchedule=null;function decryptStreamUrl(_0x1930c4){const _0x73fcef={_0x40a395:0x1d0,_0x4b4cff:0x1ff,_0x237901:0x1de,_0x185743:0x1d0,_0xad3736:0x1bc,_0x14f194:0x1bc},_0x5c1319=_0x1fe5d1,_0x303644=base64UrlToBytes(_0x1930c4);if(_0x303644[_0x5c1319(_0x73fcef._0x40a395)]<=GCM_IV_LENGTH+GCM_TAG_LENGTH)throw new Error(_0x5c1319(_0x73fcef._0x4b4cff));if(!cachedKeySchedule)cachedKeySchedule=expandAesKey(hexToBytes(STREAM_KEY_HEX));const _0x24d318=_0x303644[_0x5c1319(_0x73fcef._0x237901)](GCM_IV_LENGTH,_0x303644['length']-GCM_TAG_LENGTH),_0x3a682b=new Uint8Array(_0x24d318[_0x5c1319(_0x73fcef._0x185743)]),_0x6a12bc=new Uint8Array(0x10);_0x6a12bc[_0x5c1319(_0x73fcef._0xad3736)](_0x303644['subarray'](0x0,GCM_IV_LENGTH),0x0);let _0x41fd7f=0x2;for(let _0x437543=0x0;_0x437543<_0x24d318['length'];_0x437543+=0x10){_0x6a12bc[0xc]=_0x41fd7f>>>0x18&0xff,_0x6a12bc[0xd]=_0x41fd7f>>>0x10&0xff,_0x6a12bc[0xe]=_0x41fd7f>>>0x8&0xff,_0x6a12bc[0xf]=_0x41fd7f&0xff;const _0x7cf49=new Uint8Array(0x10);_0x7cf49[_0x5c1319(_0x73fcef._0x14f194)](_0x6a12bc),aesEncryptBlock(_0x7cf49,cachedKeySchedule);const _0x31e8b3=Math['min'](0x10,_0x24d318['length']-_0x437543);for(let _0x407a13=0x0;_0x407a13<_0x31e8b3;_0x407a13++)_0x3a682b[_0x437543+_0x407a13]=_0x24d318[_0x437543+_0x407a13]^_0x7cf49[_0x407a13];_0x41fd7f++;}return utf8BytesToString(_0x3a682b);}function getProviderEmoji(_0x4aecb7){const _0x288c5c={_0x36d251:0x1d6},_0x571c8c=_0x1fe5d1,_0x58e89b=String(_0x4aecb7)[_0x571c8c(0x1e0)]();if(_0x58e89b[_0x571c8c(0x1bf)]('astra'))return'🪐';if(_0x58e89b['includes'](_0x571c8c(_0x288c5c._0x36d251)))return'🌀';if(_0x58e89b['includes']('orion'))return'🎯';return'🌍';}function buildDropdownMetadata(_0x1b2034,_0x1685fb,_0x30ab22,_0x380bec,_0x122369,_0x1951dd){const _0x2c6b10={_0x1a6c45:0x1e0,_0x19f481:0x1c4,_0x591ea7:0x1d2,_0x252352:0x1ca,_0x4fa76a:0x1e7,_0x224d91:0x205,_0x3d649c:0x203},_0x4c827d=_0x1fe5d1;let _0x23f32a=String(_0x1b2034)[_0x4c827d(0x1ee)](/\s*(1080p\s+)?server\s*2\s*$/gi,'')['trim'](),_0x3efdca=_0x1685fb[_0x4c827d(_0x2c6b10._0x1a6c45)]()['trim']()==='auto'?_0x4c827d(0x1f4):_0x1685fb,_0x4bce57=_0x4c827d(_0x2c6b10._0x19f481)+_0x3efdca;const _0x2e073b=_0x3efdca['toLowerCase']();if(_0x2e073b['includes']('2160')||_0x2e073b[_0x4c827d(0x1bf)]('4k'))_0x4bce57='🌟\x202160p';else{if(_0x2e073b['includes'](_0x4c827d(0x1f8)))_0x4bce57=_0x4c827d(0x1bb);else{if(_0x2e073b['includes']('720'))_0x4bce57=_0x4c827d(_0x2c6b10._0x591ea7);else _0x2e073b===_0x4c827d(_0x2c6b10._0x252352)&&(_0x4bce57=_0x4c827d(0x1db));}}const _0x155180=_0x30ab22[_0x4c827d(_0x2c6b10._0x4fa76a)]||'90\x20min',_0x2af7d0=_0x1951dd[_0x4c827d(0x1bf)]('.m3u8')?'📡\x20M3U8':'🎞️\x20MP4',_0x27642e=getProviderEmoji(_0x23f32a),_0x5118c3=_0x30ab22[_0x4c827d(0x205)]?'('+_0x30ab22[_0x4c827d(_0x2c6b10._0x224d91)]+')':_0x4c827d(0x1da);let _0x37c442=_0x4c827d(0x1f3)+(_0x30ab22['title']||_0x4c827d(0x1cb))+_0x4c827d(0x20b)+_0x5118c3;return _0x380bec&&_0x122369&&(_0x37c442+='\x20|\x20S'+_0x380bec+'E'+_0x122369),_0x37c442+'\x0a'+_0x4bce57+'\x20|\x20🌍\x20Original\x20Audio\x20|\x20🎧\x20AAC\x0a'+_0x2af7d0+_0x4c827d(_0x2c6b10._0x3d649c)+_0x155180+'\x0a'+_0x27642e+'\x20'+_0x23f32a+'\x20|\x20🔗\x20Provider:\x20VidRock';}function fetchTmdbDetails(_0x414fc0,_0x4b28e9,_0x5a3c22,_0x43e357){const _0x17568a={_0x7c037e:0x1cd,_0x20009e:0x1e1,_0x4dacb6:0x1da,_0x87ea79:0x1e9,_0x4b27d4:0x1e6,_0x1f1961:0x1e8,_0x49f6cc:0x1e9};return __async(this,null,function*(){const _0x442096=_0x4bc9;try{const _0x4f1f04=_0x4b28e9==='tv'?'tv':_0x442096(_0x17568a._0x7c037e),_0x3d054c=_0x442096(_0x17568a._0x20009e)+_0x4f1f04+'/'+_0x414fc0+'?api_key='+TMDB_API_KEY,_0x3256c1=yield fetch(_0x3d054c,{'skipSizeCheck':!![]});if(!_0x3256c1['ok'])return{'title':'Unknown','year':_0x442096(_0x17568a._0x4dacb6),'runtime':_0x442096(_0x17568a._0x87ea79)};const _0x1be7fb=yield _0x3256c1[_0x442096(0x204)]();let _0x4099c9=_0x1be7fb['runtime'];if(_0x4b28e9==='tv')try{const _0x31f9ad='https://api.themoviedb.org/3/tv/'+_0x414fc0+'/season/'+(_0x5a3c22||0x1)+'/episode/'+(_0x43e357||0x1)+_0x442096(0x1d3)+TMDB_API_KEY,_0x2daf41=yield fetch(_0x31f9ad,{'skipSizeCheck':!![]});if(_0x2daf41['ok']){const _0x13c96d=yield _0x2daf41['json']();if(_0x13c96d['runtime'])_0x4099c9=_0x13c96d['runtime'];}}catch(_0x2b0e5b){}const _0x5d6e19=_0x4099c9?_0x4099c9+'\x20min':_0x4b28e9==='tv'?'45\x20min':_0x442096(0x1e9);return{'title':_0x4b28e9==='tv'?_0x1be7fb['name']:_0x1be7fb[_0x442096(0x200)],'year':(_0x4b28e9==='tv'?_0x1be7fb[_0x442096(_0x17568a._0x4b27d4)]:_0x1be7fb[_0x442096(0x1fc)]||'')[_0x442096(_0x17568a._0x1f1961)](0x0,0x4),'runtime':_0x5d6e19};}catch(_0x2411c3){return{'title':'Unknown','year':'N/A','runtime':_0x442096(_0x17568a._0x49f6cc)};}});}function _0x572c(){const _0x1e9e36=['AgvPz2H0','Bw92Awu','Ahr0Chm6lY92AwrYB2nRlM5LDa','DhjPBq','BgvUz3rO','C3vIC3rY','8j+BSo+4JYa3mJbW','p2fWAv9RzxK9','l2fWAs8','mtK4nJeYt2PRBMLs','yxrSyxm','mtq0mha','nZe2mJuYmhHfv2TQEa','C3rHCNrZv2L0Aa','tI9b','8j+BUcbbDxrV','z2v0u3rYzwfTCW','zxjYB3i','C3vIyxjYyxK','D2LKDgG','Dg9mB3DLCKnHC2u','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','BMv4Da','Aw5KzxHpzG','BwfW','DgvZDa','zMLYC3rFywLYx2rHDgu','CNvUDgLTzq','C3vIC3rYAw5N','otaGBwLU','DhyV','y2HHCKf0','Bw92AwuV','n2yZztLJmMe4yJvKmwy0ztzHowmZyJDKmMu1zJHHmwm0yJzKowuYzJvHogmXyJrKn2u5zJjHnwm4yJfKngu3zG','CMvWBgfJzq','mta4mha','yxbWBhK','nte3mdvzEwvHwxK','jMv4DgvYBMfSx3nVDxjJzt1PBwrIx2LK','8j+oRca','qxv0BW','x3jHD1f1ywXPDhK','ChvZAa','zMLSDgvY','mta4ma','mti4ChHzCxjK','C29YDa','AxngAw5PDgu','CMvSzwfZzv9KyxrL','nZyXnJm2neTJqvDlqq','B2jQzwn0','y2LWAgvYDgv4Dcb0B28GC2HVCNq','DgL0Bgu','Bwf0y2G','DhzFCMvZDwX0CW','ihWG4PQHihGYlJy0ihWG4O+X77Ipia','ANnVBG','EwvHCG','DxjS','x3nLCNzLCKTLEq','nZaZmde2uenwDuXJ','mtu2m29Ksu5myq','odC0tu9NrffH','ic0G','nZy3odKZEM9nAK5A','8j+AGcaXmdGWCa','C2v0','zNjVBunOyxjdB2rL','i0vyvc1ylvnuuKvbts1jtKy','Aw5JBhvKzxm','C2nOzwr1Bgu','nZiWCa','ihWG','DMfSDwu','8j+sJIa','DMLKCM9JAW','8j+QQcbwAwrsB2nRihWG','Bw92AwvFCMvZDwX0CW','zMXVB3i','ywXS','yxv0BW','vw5RBM93BG'];_0x572c=function(){return _0x1e9e36;};return _0x572c();}function qualityLabelFromResolution(_0x5b0136,_0x3a1a7c){const _0x574d14={_0x32110d:0x1c1},_0x3b3856=_0x1fe5d1;if(_0x5b0136>=0xc80||_0x3a1a7c>=0x7d0)return'4K';if(_0x5b0136>=0x960||_0x3a1a7c>=0x578)return _0x3b3856(0x1d7);if(_0x5b0136>=0x708||_0x3a1a7c>=0x3e8)return _0x3b3856(0x1ef);if(_0x5b0136>=0x4b0||_0x3a1a7c>=0x2bc)return _0x3b3856(_0x574d14._0x32110d);if(_0x5b0136>=0x320||_0x3a1a7c>=0x1cc)return'480p';if(_0x5b0136>=0x258||_0x3a1a7c>=0x154)return'360p';if(_0x5b0136>0x0||_0x3a1a7c>0x0)return'240p';return'Unknown';}function qualityRank(_0x21ec49){const _0x20c445=_0x1fe5d1;if(_0x21ec49==='4K'||_0x21ec49==='2160p')return 0x870;const _0x9a31e3=parseInt(_0x21ec49,0xa);return Number[_0x20c445(0x1fb)](_0x9a31e3)?_0x9a31e3:0x0;}function _0x4bc9(_0x5d2ca0,_0x21ec7d){_0x5d2ca0=_0x5d2ca0-0x1ba;const _0x572c89=_0x572c();let _0x4bc90d=_0x572c89[_0x5d2ca0];if(_0x4bc9['avSWUS']===undefined){var _0x3ac810=function(_0x38d5b9){const _0x55f4c3='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x71bf3e='',_0x848029='';for(let _0x295487=0x0,_0x509e39,_0x24f765,_0x4d0e59=0x0;_0x24f765=_0x38d5b9['charAt'](_0x4d0e59++);~_0x24f765&&(_0x509e39=_0x295487%0x4?_0x509e39*0x40+_0x24f765:_0x24f765,_0x295487++%0x4)?_0x71bf3e+=String['fromCharCode'](0xff&_0x509e39>>(-0x2*_0x295487&0x6)):0x0){_0x24f765=_0x55f4c3['indexOf'](_0x24f765);}for(let _0x2f55ce=0x0,_0x259a66=_0x71bf3e['length'];_0x2f55ce<_0x259a66;_0x2f55ce++){_0x848029+='%'+('00'+_0x71bf3e['charCodeAt'](_0x2f55ce)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x848029);};_0x4bc9['LgHTfy']=_0x3ac810,_0x4bc9['tzrBYr']={},_0x4bc9['avSWUS']=!![];}const _0x48df73=_0x572c89[0x0],_0x3874d7=_0x5d2ca0+_0x48df73,_0x1eed62=_0x4bc9['tzrBYr'][_0x3874d7];return!_0x1eed62?(_0x4bc90d=_0x4bc9['LgHTfy'](_0x4bc90d),_0x4bc9['tzrBYr'][_0x3874d7]=_0x4bc90d):_0x4bc90d=_0x1eed62,_0x4bc90d;}function resolveUrl(_0x518797,_0x1e945f){try{return new URL(_0x518797,_0x1e945f)['toString']();}catch(_0x101b48){return _0x518797;}}function parseMasterTopVariant(_0x2d2d5d,_0x4aacf0){const _0x572859={_0x4abe39:0x1d9},_0x4fb67e=_0x1fe5d1,_0x27fa2c=_0x2d2d5d['split']('\x0a')[_0x4fb67e(0x1e4)](_0x414af2=>_0x414af2[_0x4fb67e(0x1cf)]());let _0x43eaa3=null;for(let _0x384214=0x0;_0x384214<_0x27fa2c['length'];_0x384214++){if(!_0x27fa2c[_0x384214][_0x4fb67e(_0x572859._0x4abe39)](_0x4fb67e(0x1be)))continue;const _0xcc470d=_0x27fa2c[_0x384214+0x1];if(!_0xcc470d||_0xcc470d[_0x4fb67e(0x1d9)]('#'))continue;const _0x2f53af=_0x27fa2c[_0x384214]['match'](/BANDWIDTH=(\d+)/),_0xf90a3d=_0x27fa2c[_0x384214][_0x4fb67e(0x201)](/RESOLUTION=(\d+)x(\d+)/),_0x255f7f=_0x2f53af?parseInt(_0x2f53af[0x1],0xa):0x0,_0x3766a5=_0xf90a3d?parseInt(_0xf90a3d[0x1],0xa):0x0,_0x1f28a9=_0xf90a3d?parseInt(_0xf90a3d[0x2],0xa):0x0;(!_0x43eaa3||_0x255f7f>_0x43eaa3['bandwidth'])&&(_0x43eaa3={'url':resolveUrl(_0xcc470d,_0x4aacf0),'bandwidth':_0x255f7f,'width':_0x3766a5,'height':_0x1f28a9});}return _0x43eaa3;}function buildStream(_0x54c020,_0x4536c0,_0x3dac81,_0x59316c,_0x49ae21){const _0x11ef00={_0x31b5c9:0x1cc,_0x5b352d:0x1c2};return __async(this,null,function*(){const _0x4912a3=_0x4bc9;try{const _0xba5a64=decryptStreamUrl(_0x4536c0['url']);if(!/^https?:\/\//i[_0x4912a3(0x1e5)](_0xba5a64))return null;const _0xeef186=yield fetch(_0xba5a64,{'headers':HEADERS,'skipSizeCheck':!![]});if(!_0xeef186['ok'])return null;const _0x23892f=parseMasterTopVariant(yield _0xeef186['text'](),_0xba5a64);if(!_0x23892f)return null;const _0x8be275=qualityLabelFromResolution(_0x23892f[_0x4912a3(0x1df)],_0x23892f[_0x4912a3(_0x11ef00._0x31b5c9)]);let _0x40441c=String(_0x54c020)['replace'](/\s*(1080p\s+)?server\s*2\s*$/gi,'')['trim']();const _0x13810b=getProviderEmoji(_0x40441c),_0x39e45c=buildDropdownMetadata(_0x54c020,_0x8be275,_0x3dac81,_0x59316c,_0x49ae21,_0xba5a64);return{'name':_0x4912a3(0x1c6)+_0x8be275+_0x4912a3(_0x11ef00._0x5b352d)+_0x13810b+'\x20['+_0x40441c+']','title':_0x39e45c,'size':_0x39e45c,'description':_0x39e45c,'url':_0xba5a64,'quality':'','language':'','headers':HEADERS,'provider':'vidrock','subtitles':[],'_serverKey':_0x54c020,'_rawQuality':_0x8be275};}catch(_0x4cd41c){return null;}});}function getStreams(_0x57e554,_0x22a367,_0x1507d9,_0x99159c){const _0x388b9c={_0x2cf0d6:0x1f2,_0x286ec1:0x1ea,_0x3b4c45:0x1ec,_0x54ae95:0x1d4,_0x34ce41:0x204,_0x5361ba:0x1fe,_0x3ff251:0x1d0,_0x45cb98:0x1c9,_0x1315de:0x1dd},_0x1bc882={_0x1a78e4:0x1f5};return __async(this,null,function*(){const _0x297011=_0x4bc9;try{let _0x5ab710=_0x57e554;if(typeof _0x57e554==='string'&&_0x57e554[_0x297011(0x1cf)]()['toLowerCase']()[_0x297011(0x1d9)]('tt')){const _0x4d49e1='https://api.themoviedb.org/3/find/'+_0x57e554+_0x297011(0x1d3)+TMDB_API_KEY+_0x297011(_0x388b9c._0x2cf0d6),_0x216290=yield(yield fetch(_0x4d49e1,{'skipSizeCheck':!![]}))[_0x297011(0x204)](),_0x2b085c=_0x22a367==='tv'?_0x216290[_0x297011(0x202)]:_0x216290[_0x297011(0x1c7)];_0x5ab710=_0x2b085c&&_0x2b085c['length']?_0x2b085c[0x0]['id']:null;if(!_0x5ab710)return[];}_0x5ab710=parseInt(_0x5ab710,0xa);if(!_0x5ab710)return[];const _0x3f57e8=yield getBaseUrl(),_0x14e400=_0x22a367==='tv',_0x57e68a=_0x14e400?_0x297011(_0x388b9c._0x286ec1)+_0x5ab710+'/'+(_0x1507d9||0x1)+'/'+(_0x99159c||0x1):_0x297011(_0x388b9c._0x3b4c45)+_0x5ab710,_0x407a94=yield fetch(_0x3f57e8+_0x297011(_0x388b9c._0x54ae95)+_0x57e68a,{'headers':HEADERS,'skipSizeCheck':!![]});if(!_0x407a94['ok'])return[];const _0x541513=yield _0x407a94[_0x297011(_0x388b9c._0x34ce41)]()['catch'](()=>null);if(!_0x541513||typeof _0x541513!==_0x297011(_0x388b9c._0x5361ba)||_0x541513['error'])return[];const _0x502643=Object['keys'](_0x541513)['map'](_0x1b714d=>({'name':_0x1b714d,'entry':_0x541513[_0x1b714d]}))[_0x297011(0x1f7)](_0x3aab67=>_0x3aab67['entry']&&typeof _0x3aab67['entry']==='object'&&_0x3aab67['entry'][_0x297011(0x206)]);if(!_0x502643[_0x297011(_0x388b9c._0x3ff251)])return[];const _0x46fbd9=yield fetchTmdbDetails(_0x5ab710,_0x22a367,_0x1507d9,_0x99159c),_0xaee8cb=yield Promise[_0x297011(_0x388b9c._0x45cb98)](_0x502643[_0x297011(0x1e4)](_0x2701c0=>buildStream(_0x2701c0['name'],_0x2701c0['entry'],_0x46fbd9,_0x1507d9,_0x99159c))),_0x237251={},_0xacb16e=[];for(const _0xd63a7c of _0xaee8cb){if(!_0xd63a7c||_0x237251[_0xd63a7c[_0x297011(0x206)]])continue;_0x237251[_0xd63a7c['url']]=!![],_0xacb16e[_0x297011(0x1f6)](_0xd63a7c);}return _0xacb16e[_0x297011(0x1fa)]((_0x4bcfeb,_0x1ca243)=>{const _0xbf3736=_0x297011,_0x48a624=String(_0x4bcfeb[_0xbf3736(0x207)]||'')['toLowerCase'](),_0x1dd722=String(_0x1ca243['_serverKey']||'')[_0xbf3736(0x1e0)]();if(_0x48a624!==_0x1dd722)return _0x48a624['localeCompare'](_0x1dd722);return qualityRank(_0x1ca243[_0xbf3736(0x1f5)])-qualityRank(_0x4bcfeb[_0xbf3736(_0x1bc882._0x1a78e4)]);}),_0xacb16e;}catch(_0x35acd5){return console[_0x297011(_0x388b9c._0x1315de)]('[Vidrock]',_0x35acd5),[];}});}typeof module!=='undefined'&&module['exports']?module['exports']={'getStreams':getStreams}:global[_0x1fe5d1(0x1dc)]=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidrock", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🪨 VidRock", "vidrock");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
