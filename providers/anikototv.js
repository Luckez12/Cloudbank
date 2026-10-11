// Imported provider: anikototv; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
      var timer = setTimeout(function() { finish([]); }, 45000);
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

/* CLOUDBANK_ANIME_MAPPING_START */
/* Cloudbank anime mapping adapter. No Node globals or runtime imports. */
function cloudbankAnimeMappingFetch(nativeFetch) {
  var cache = Object.create(null), cacheKeys = [], tmdbKey = "", documents = Object.create(null), documentKeys = [], malTitles = Object.create(null), titleKeys = [];
  function response(data, status) {
    var body = JSON.stringify(data);
    return { ok: status === 200, status: status, statusText: status === 200 ? "OK" : "Not Found",
      headers: { get: function(n) { return String(n).toLowerCase() === "content-type" ? "application/json" : null; } },
      json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); },
      clone: function() { return response(data, status); } };
  }
  function loadJson(url) {
    var timer, settled = false;
    return new Promise(function(resolve) {
      function finish(value) { if (settled) return; settled = true; clearTimeout(timer); resolve(value); }
      timer = setTimeout(function() { finish(null); }, 8000);
      Promise.resolve().then(function() { return nativeFetch(url); }).then(function(r) {
        return r.ok ? r.json() : null;
      }).then(finish, function() { finish(null); });
    });
  }
  function json(url) {
    var hit = documents[url];
    if (hit && Date.now() - hit.time < 300000) return hit.promise;
    var entry = { time: Date.now(), promise: null };
    entry.promise = loadJson(url).then(function(data) {
      if (!data) delete documents[url];
      return data;
    });
    documents[url] = entry;
    documentKeys.push(url);
    if (documentKeys.length > 20) delete documents[documentKeys.shift()];
    return entry.promise;
  }
  function positive(value) { var n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
  function day(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ""; }
  function compatible(a, b) {
    if (!a || !b) return false;
    return Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) <= 86400000;
  }
  async function resolve(id, season, episode, movie) {
    var isImdb = /^tt\d+$/.test(id);
    if (!isImdb && !positive(id)) return null;
    var route = isImdb ? "imdb" : "themoviedb";
    var armPromise = json("https://arm.haglund.dev/api/v2/" + route + "?id=" + encodeURIComponent(id));
    // TMDB episode dates take precedence over Cinemeta's alternative season numbering.
    var metaPromise = !movie && isImdb ? json("https://v3-cinemeta.strem.io/meta/series/" + id + ".json") : Promise.resolve(null);
    var rows = await armPromise;
    if (!Array.isArray(rows)) return null;
    rows = rows.filter(function(r) {
      return r && positive(r.myanimelist) && (isImdb ? r.imdb === id : String(r.themoviedb) === id) &&
        (movie ? r.media === "MOVIE" && r["themoviedb-season"] == null :
          r["themoviedb-season"] != null && Number(r["themoviedb-season"]) === season);
    });
    var seen = Object.create(null);
    rows = rows.filter(function(r) { var key = r.myanimelist; if (seen[key]) return false; seen[key] = true; return true; });
    if (!rows.length || rows.length > 6) return null;
    if (movie) {
      if (rows.length !== 1) return null;
      return { mal_id: positive(rows[0].myanimelist), anilist: positive(rows[0].anilist), mal_episode: 1, episode: 1 };
    }
    if (!isImdb && /^tt\d+$/.test(rows[0].imdb || "")) {
      metaPromise = json("https://v3-cinemeta.strem.io/meta/series/" + rows[0].imdb + ".json");
    }
    var tmdbId = positive(rows[0].themoviedb), target = "", dayIndex = 0;
    var episodeUrl = tmdbKey && tmdbId ? "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "?api_key=" + encodeURIComponent(tmdbKey) : "";
    var seasonPromise = episodeUrl ? json(episodeUrl) : Promise.resolve(null);
    var datasetsPromise = Promise.all(rows.map(function(r) { return json("https://api.ani.zip/mappings?mal_id=" + r.myanimelist); }));
    var seasonData = await seasonPromise, metaData = await metaPromise;
    var videos = seasonData && Array.isArray(seasonData.episodes) ? seasonData.episodes :
      metaData && metaData.meta && Array.isArray(metaData.meta.videos) ? metaData.meta.videos : [];
    function number(v) { return Number(v.episode_number != null ? v.episode_number : v.episode != null ? v.episode : v.number); }
    function seasonOf(v) { return Number(v.season_number != null ? v.season_number : v.season); }
    function released(v) { return day(v.air_date || v.released || v.firstAired); }
    var selected = videos.find(function(v) { return seasonOf(v) === season && number(v) === episode; });
    if (!selected || !(target = released(selected))) return null;
    dayIndex = videos.filter(function(v) {
      return released(v) === target && (seasonOf(v) < season || seasonOf(v) === season && number(v) < episode);
    }).length;
    var datasets = await datasetsPromise, matches = [];
    datasets.forEach(function(data, i) {
      if (!data || !data.mappings || Number(data.mappings.mal_id) !== Number(rows[i].myanimelist) || !data.episodes) return;
      var list = Object.keys(data.episodes).map(function(k) { return data.episodes[k]; }).filter(function(e) {
        return e && /^\d+$/.test(String(e.episode)) && positive(e.episode) && compatible(day(e.airdate || e.airDate || e.airDateUtc), target);
      }).sort(function(a,b) { return Number(a.episode) - Number(b.episode); });
      // Exact dates win; +/- one day accounts only for local/UTC broadcast dates.
      var exact = list.filter(function(e) { return day(e.airdate || e.airDate || e.airDateUtc) === target; });
      if (exact.length) list = exact;
      if (!list[dayIndex] || list.length > 1 && dayIndex === 0 &&
          videos.filter(function(v) { return released(v) === target; }).length < list.length) return;
      var titles = data.titles || {}, ep = Number(list[dayIndex].episode);
      matches.push({ mal_id: Number(rows[i].myanimelist), anilist: positive(rows[i].anilist),
        mal_episode: ep, episode: ep, anime_title: titles.en || titles["x-jat"] || titles.ja || "",
        titles: Object.keys(titles).map(function(k) { return titles[k]; }).filter(Boolean), air_date: target });
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return function(url, options) {
    var text = typeof url === "string" ? url : url && url.url, u;
    try { u = new URL(text); } catch (_) { return nativeFetch(url, options); }
    var method = options && options.method ? String(options.method).toUpperCase() : "GET";
    if (u.hostname === "api.themoviedb.org" && u.searchParams.get("api_key")) tmdbKey = u.searchParams.get("api_key");
    var malDetail = /^\/v4\/anime\/(\d+)$/.exec(u.pathname);
    if (method === "GET" && u.hostname === "api.jikan.moe" && malDetail && malTitles[malDetail[1]]) {
      return Promise.resolve(response({ data: { mal_id: Number(malDetail[1]), title: malTitles[malDetail[1]] } }, 200));
    }
    var legacy = u.hostname === "id-mapping-api-malid.hf.space" && u.pathname === "/api/resolve";
    var anikoto = u.hostname === "arm.haglund.dev" && u.pathname === "/api/v2/tmdb";
    if (method !== "GET" || !legacy && !anikoto) return nativeFetch(url, options);
    var id = u.searchParams.get("id") || "", movie = anikoto && !u.searchParams.has("s");
    var season = Number(u.searchParams.get("s")), episode = positive(u.searchParams.get("e"));
    if (!movie && (!Number.isInteger(season) || season < 0 || !episode || !u.searchParams.has("s")))
      return Promise.resolve(response({ error: "Invalid anime episode" }, 404));
    var key = JSON.stringify([id, movie, season, episode]);
    if (!cache[key]) {
      cache[key] = resolve(id, season, episode, movie).then(function(data) {
        if (!data) delete cache[key];
        if (data && data.anime_title) {
          if (!malTitles[data.mal_id]) titleKeys.push(data.mal_id);
          malTitles[data.mal_id] = data.anime_title;
          if (titleKeys.length > 32) delete malTitles[titleKeys.shift()];
        }
        return data;
      }, function() { delete cache[key]; return null; });
      cacheKeys.push(key);
      if (cacheKeys.length > 32) delete cache[cacheKeys.shift()];
    }
    return cache[key].then(function(data) { return response(data || { error: "Verified anime mapping unavailable" }, data ? 200 : 404); });
  };
}
/* CLOUDBANK_ANIME_MAPPING_END */
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
'use strict';const _0x28f3f0=_0x18f4;(function(_0x275145,_0x5c462b){const _0x2c1a50={_0x1ffe75:0x177,_0x53ef1b:0x18b,_0x466d1e:0x16e,_0x362de9:0x17d,_0x4e6278:0x19a,_0x43d6cf:0x161},_0x55c5ee=_0x18f4,_0x4b6cf3=_0x275145();while(!![]){try{const _0xde37b8=-parseInt(_0x55c5ee(0x16b))/0x1+-parseInt(_0x55c5ee(_0x2c1a50._0x1ffe75))/0x2*(parseInt(_0x55c5ee(0x151))/0x3)+parseInt(_0x55c5ee(0x199))/0x4*(parseInt(_0x55c5ee(0x17b))/0x5)+-parseInt(_0x55c5ee(_0x2c1a50._0x53ef1b))/0x6*(parseInt(_0x55c5ee(0x163))/0x7)+-parseInt(_0x55c5ee(_0x2c1a50._0x466d1e))/0x8*(-parseInt(_0x55c5ee(0x14b))/0x9)+parseInt(_0x55c5ee(_0x2c1a50._0x362de9))/0xa*(-parseInt(_0x55c5ee(_0x2c1a50._0x4e6278))/0xb)+parseInt(_0x55c5ee(_0x2c1a50._0x43d6cf))/0xc*(parseInt(_0x55c5ee(0x150))/0xd);if(_0xde37b8===_0x5c462b)break;else _0x4b6cf3['push'](_0x4b6cf3['shift']());}catch(_0xf9a4a1){_0x4b6cf3['push'](_0x4b6cf3['shift']());}}}(_0x4615,0x5d558));var __async=(_0x4ca38f,_0x3f879a,_0x1e39c8)=>{return new Promise((_0x4516b1,_0x3deece)=>{const _0x1eec5b={_0x53f0f7:0x162},_0x528d0b=_0x18f4;var _0x1f5651=_0x58cd18=>{const _0x5c3b6f=_0x18f4;try{_0x22d50d(_0x1e39c8[_0x5c3b6f(0x198)](_0x58cd18));}catch(_0x1cb52d){_0x3deece(_0x1cb52d);}},_0x7ccbee=_0x4e6ff1=>{const _0x1bb5d3=_0x18f4;try{_0x22d50d(_0x1e39c8[_0x1bb5d3(_0x1eec5b._0x53f0f7)](_0x4e6ff1));}catch(_0x31bf78){_0x3deece(_0x31bf78);}},_0x22d50d=_0x5acf0e=>_0x5acf0e['done']?_0x4516b1(_0x5acf0e[_0x528d0b(0x14a)]):Promise[_0x528d0b(0x192)](_0x5acf0e[_0x528d0b(0x14a)])[_0x528d0b(0x13b)](_0x1f5651,_0x7ccbee);_0x22d50d((_0x1e39c8=_0x1e39c8['apply'](_0x4ca38f,_0x3f879a))['next']());});},PROVIDER_NAME='AnikotoTV',TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',TVDB_API_KEY='777140fb-de92-440a-aec2-95eb51e2d7ab',MOBILE_UAS=['Mozilla/5.0\x20(Linux;\x20Android\x2014;\x20Pixel\x208\x20Pro)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/124.0.0.0\x20Mobile\x20Safari/537.36',_0x28f3f0(0x18c),'Mozilla/5.0\x20(Linux;\x20Android\x2012;\x20Pixel\x206)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/115.0.0.0\x20Mobile\x20Safari/537.36',_0x28f3f0(0x17c)];function _0x4615(){const _0x2b2df8=['Ahr0Ca','p2fWAv9RzxK9','yw5Px2LK','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY9MAw5KlW','Bw92AwvFCMvZDwX0CW','nJeZmZCXvKjys1fU','DxjS','BwfSswq','mJyZmKz6r3nLuq','ihWG4PQHia','qMvHCMvYia','u1vc','ihWG','EwvHCG','C2vHC29Ux251BwjLCG','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','yxnZAwDU','nde0mLvZBMfbAq','jMfWCgvUzf90B19YzxnWB25Zzt1LEhrLCM5HBf9Pzhm','BwfS','zhvYyxrPB24','nxzfuNz0zq','tw96AwXSys81lJaGkgLqAg9UztSGq1bvigLqAg9UzsbpuYaXn18WigXPA2uGtwfJie9tifGPiefWCgXLv2vIs2L0lZyWns4XlJe1icHlsfrntcWGBgLRzsbhzwnRBYKGvMvYC2LVBI8XnY4Wie1VyMLSzs8XnuuXndGGu2fMyxjPlZyWnc4X','mJKWtMTTshH6','zxbPC29Kzv9JB3vUDa','ywjZB2X1DgvoDw1Izxi','zMLUza','C2vHC29UCW','ChvZAa','zg9TywLU','Ahr0Chm6lY9HCgK0lNrOzxr2zgiUy29Tl3y0l3nLyxjJAd9XDwvYEt0','Dg9mB3DLCKnHC2u','zMLSzq','C2vYAwvZ','we1mshr0CfjLCxvLC3q','mJaYnG','zxbPC29Kzxm','nMnKuhbWza','tw96AwXSys81lJaGkeXPBNv4oYbbBMrYB2LKideZoYbtts1tote4qIKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeXnI4WlJaUmcbnB2jPBguGu2fMyxjPlZuZnY4ZnG','yw5PBgLZDa','BMfTzq','mJqGBwLU','zMXVB3i','C291CMnLCW','CMvZB2X2zq','qw5PBwuGvgL0Bgu','jNm9','CNvUDgLTzq','l3n0CMvHBs9NzxrtB3vYy2vZp2LKpq','C2vHC29UtNvTyMvY','BMv4Da','mJq0nteXnMrkzxbmyW','mJG5nZyYDKLSvhj5','Bw92Awu','ifnLyxnVBIa','C3vI','C3rYAw5NAwz5','rxbPC29Kzsa','DgHLBG','Ahr0Chm6lY9HCgK0lNrOzxr2zgiUy29Tl3y0l3nLCMLLCY8','y2fWDgLVBNm','DhjHy2TZ','A2LUza','Ahr0Chm6lY9HCM0UAgfNBhvUzc5KzxyVyxbPl3yYl3rTzgi/Awq9','l3n0CMvHBs8','ywjZrxa','ue9tva','zgf0yq','mta4mha','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','ihf1zxj5icGKC2vHCMnOoIbtDhjPBMCPihSGtwvKAweGkhnLyxjJAdOGjhnLyxjJAcWGDhLWztOGqu5jtuuPihSGAwqGAwrnywWGFsb9ia','C3bSAxq','8j+uLYa','DMfSDwu','mti4odHfuNH3qKm','lM0ZDtG','l2vWAxnVzguV','8j+hUVcFH7iGrw5NBgLZAa','CxvHBgL0Eq','mta4nZuXnufQzezsqG','nti4svrIBhbn','zhvI','yxbWBgLJyxrPB24VANnVBG','zMLYC3rFywLYx2rHDgu','zw4TvvmSzw47Ct0WlJK','ANnVBG','iokaOIdWN5EJ77Ipia','Ahr0Chm6lY9HCgK0lNrOzxr2zgiUy29Tl3y0l2XVz2LU','Dgv4Da','Ahr0Chm6lY9HAw9TzxrHzgf0ys5LBgzOB3n0zwqUy29Tl3n0CMvTAw8VodbKmdGYyZqTnMu5os00yZK3lwe2n2qTm2q5zti0mJy4nwnLl21LDgeVC2vYAwvZlW','ig1PBG','BNvTyMvY','Ahr0Chm6lY8','vw5RBM93BG','yw5P','ic0Gka','mtu2zwXkAwPk','DgHYB3C','mZiWodG3Be5isM11','l3nLyxnVBI8','8j+oRcbnB3zPzsbqCMvZzw50yxrPB24'];_0x4615=function(){return _0x2b2df8;};return _0x4615();}function getHeaders(_0x1c5a86){const _0x5f4051=_0x28f3f0;var _0x3a2778=MOBILE_UAS[Math[_0x5f4051(0x190)](Math['random']()*MOBILE_UAS['length'])],_0x3d8a55={'User-Agent':_0x3a2778,'Accept-Language':_0x5f4051(0x155)};if(_0x1c5a86)for(var _0x14e9b5 in _0x1c5a86){_0x3d8a55[_0x14e9b5]=_0x1c5a86[_0x14e9b5];}return _0x3d8a55;}var _tvdbToken=null;function getTvdbToken(){const _0x4a89ef={_0x44bdfd:0x153,_0x160ec5:0x156,_0x38b8fc:0x144};return __async(this,null,function*(){const _0x2ff76b=_0x18f4;if(_tvdbToken)return _tvdbToken;try{var _0x76c45d=yield fetch(_0x2ff76b(0x158),{'method':_0x2ff76b(0x143),'headers':{'Content-Type':_0x2ff76b(_0x4a89ef._0x44bdfd)},'body':JSON[_0x2ff76b(0x139)]({'apikey':TVDB_API_KEY})});if(_0x76c45d['ok']){var _0x3637f7=yield _0x76c45d[_0x2ff76b(_0x4a89ef._0x160ec5)]();if(_0x3637f7&&_0x3637f7[_0x2ff76b(0x144)]&&_0x3637f7[_0x2ff76b(0x144)]['token'])_tvdbToken=_0x3637f7[_0x2ff76b(_0x4a89ef._0x38b8fc)]['token'];}}catch(_0x301b32){}return _tvdbToken;});}function getTMDBDetails(_0x569e9e,_0x361eb1,_0x2b4901,_0x28699d){const _0x202119={_0x41e1c1:0x187,_0x10ffb0:0x167,_0x478bfe:0x178,_0x1ae61b:0x13a,_0x243e77:0x18f,_0x53f4e2:0x18e,_0x2717eb:0x154,_0x36db47:0x148,_0x4eb5b5:0x18f,_0x485fb1:0x146,_0x4dd54e:0x19b,_0x1fe43e:0x195};return __async(this,null,function*(){const _0x5f37cb=_0x18f4;var _0x1d2771,_0x3a0d51;const _0x1011e8=_0x361eb1==='tv'||_0x361eb1===_0x5f37cb(_0x202119._0x41e1c1)?'tv':'movie';let _0x25aec7=_0x5f37cb(0x175)+_0x1011e8+'/'+_0x569e9e+_0x5f37cb(_0x202119._0x10ffb0)+TMDB_API_KEY+_0x5f37cb(_0x202119._0x478bfe);String(_0x569e9e)['startsWith']('tt')&&(_0x25aec7=_0x5f37cb(0x169)+_0x569e9e+'?external_source=imdb_id&api_key='+TMDB_API_KEY);try{const _0x237def=yield fetch(_0x25aec7,{'headers':getHeaders()});if(!_0x237def['ok'])return{'title':'Anime\x20Title','year':_0x5f37cb(0x189),'epTitle':_0x5f37cb(_0x202119._0x1ae61b)+_0x28699d,'duration':'24\x20min'};const _0x35bf75=yield _0x237def['json']();let _0x5cecab=_0x35bf75;String(_0x569e9e)['startsWith']('tt')&&(_0x5cecab=_0x1011e8==='tv'?(_0x1d2771=_0x35bf75['tv_results'])==null?void 0x0:_0x1d2771[0x0]:(_0x3a0d51=_0x35bf75[_0x5f37cb(0x16a)])==null?void 0x0:_0x3a0d51[0x0]);if(!_0x5cecab)return{'title':_0x5f37cb(0x193),'year':'2026','epTitle':_0x5f37cb(_0x202119._0x1ae61b)+_0x28699d,'duration':_0x5f37cb(_0x202119._0x243e77)};const _0x124495=_0x1011e8==='tv'?_0x5cecab[_0x5f37cb(_0x202119._0x53f4e2)]:_0x5cecab['title'],_0x5de1f4=_0x5cecab['release_date']||_0x5cecab[_0x5f37cb(_0x202119._0x2717eb)]||'',_0x263464=_0x5de1f4?_0x5de1f4[_0x5f37cb(_0x202119._0x36db47)]('-')[0x0]:_0x5f37cb(0x189);let _0x2bb2d1='Episode\x20'+_0x28699d,_0xc53680=_0x5f37cb(_0x202119._0x4eb5b5);if(_0x1011e8==='tv'&&_0x5cecab['id']&&_0x2b4901&&_0x28699d)try{const _0x16d255=_0x5f37cb(_0x202119._0x485fb1)+_0x5cecab['id']+'/season/'+_0x2b4901+_0x5f37cb(0x14d)+_0x28699d+'?api_key='+TMDB_API_KEY,_0x10c964=yield fetch(_0x16d255,{'headers':getHeaders()});if(_0x10c964['ok']){const _0x5a43a8=yield _0x10c964['json']();if(_0x5a43a8[_0x5f37cb(_0x202119._0x53f4e2)])_0x2bb2d1=_0x5a43a8[_0x5f37cb(0x18e)];if(_0x5a43a8[_0x5f37cb(0x195)])_0xc53680=_0x5a43a8[_0x5f37cb(0x195)]+'\x20min';}}catch(_0xa947a9){}else _0x1011e8===_0x5f37cb(_0x202119._0x4dd54e)&&_0x5cecab['runtime']&&(_0xc53680=_0x5cecab[_0x5f37cb(_0x202119._0x1fe43e)]+_0x5f37cb(0x15b));return{'title':_0x124495,'year':_0x263464,'epTitle':_0x2bb2d1,'duration':_0xc53680};}catch(_0xbb92c2){return{'title':'Anime\x20Title','year':_0x5f37cb(0x189),'epTitle':_0x5f37cb(0x13a)+_0x28699d,'duration':_0x5f37cb(0x18f)};}});}function getTMDBTitle(_0x1b01e5,_0x4a77b9){return __async(this,null,function*(){const _0x2c407b=yield getTMDBDetails(_0x1b01e5,_0x4a77b9);return{'title':_0x2c407b['title'],'numericId':_0x1b01e5};});}function getTMDBSeasonName(_0x4ff155,_0xb0d29e){const _0x9da589={_0x416d44:0x146,_0x3205e1:0x167};return __async(this,null,function*(){const _0x3937b4=_0x18f4,_0xb05af2=_0x3937b4(_0x9da589._0x416d44)+_0x4ff155+_0x3937b4(0x164)+_0xb0d29e+_0x3937b4(_0x9da589._0x3205e1)+TMDB_API_KEY;try{const _0x41ba87=yield fetch(_0xb05af2);if(_0x41ba87['ok']){const _0x26de84=yield _0x41ba87[_0x3937b4(0x156)]();return _0x26de84['name'];}}catch(_0x3a5427){}return null;});}function aniListBridge(_0x16494b){const _0x333519={_0x2d600c:0x147};return __async(this,null,function*(){const _0x4d865b=_0x18f4,_0x50970f=_0x4d865b(_0x333519._0x2d600c);try{const _0x4b446e=yield fetch('https://graphql.anilist.co',{'method':'POST','headers':Object[_0x4d865b(0x176)](getHeaders(),{'Content-Type':'application/json','Accept':'application/json'}),'body':JSON['stringify']({'query':_0x50970f,'variables':{'search':_0x16494b}})}),_0x124419=yield _0x4b446e['json']();if(_0x124419&&_0x124419['data']&&_0x124419['data']['Media'])return{'malId':_0x124419['data']['Media']['idMal'],'aniId':_0x124419['data']['Media']['id'],'absEp':null};}catch(_0x32a3a6){}return null;});}function getMalId(_0x339937,_0x4e42cb,_0x37659c,_0x1f5b25){const _0x2cc129={_0xe6592e:0x18d,_0x426a4a:0x168,_0xf6282f:0x19c};return __async(this,null,function*(){const _0x58d710=_0x18f4;try{let _0x30fa98=_0x58d710(0x140)+_0x339937;if(_0x4e42cb==='tv'||_0x4e42cb==='series')_0x30fa98+=_0x58d710(0x194)+_0x37659c+'&e='+_0x1f5b25;const _0x69bc24=yield fetch(_0x30fa98);if(_0x69bc24['ok']){const _0x4c3820=yield _0x69bc24['json']();if(_0x4c3820['mal']||_0x4c3820['mal_id']||_0x4c3820[_0x58d710(_0x2cc129._0xe6592e)]||_0x4c3820[_0x58d710(_0x2cc129._0x426a4a)])return{'malId':_0x4c3820['mal']||_0x4c3820['mal_id'],'aniId':_0x4c3820['anilist']||_0x4c3820['ani_id'],'absEp':_0x4c3820['episode']||_0x1f5b25};}}catch(_0x55e695){}const _0x152dd6=yield getTMDBTitle(_0x339937,_0x4e42cb);let _0x43f7cb=_0x152dd6['title'];const _0x3453d4=_0x152dd6['numericId'];if(_0x43f7cb){let _0x4afcb2=_0x43f7cb;if((_0x4e42cb==='tv'||_0x4e42cb===_0x58d710(0x187))&&_0x37659c>0x1&&_0x3453d4){const _0x388c70=yield getTMDBSeasonName(_0x3453d4,_0x37659c);_0x388c70?_0x388c70['toLowerCase']()['includes'](_0x43f7cb[_0x58d710(0x185)]())?_0x43f7cb=_0x388c70:_0x43f7cb=_0x43f7cb+'\x20'+_0x388c70:_0x43f7cb=_0x43f7cb+_0x58d710(_0x2cc129._0xf6282f)+_0x37659c;}let _0x230ebc=yield aniListBridge(_0x43f7cb),_0x348ca7=![];(!_0x230ebc||_0x230ebc&&!_0x230ebc['malId'])&&_0x43f7cb!==_0x4afcb2&&(_0x230ebc=yield aniListBridge(_0x4afcb2),_0x348ca7=!![]);if(_0x230ebc)return _0x230ebc[_0x58d710(0x142)]=_0x1f5b25,_0x230ebc['usedFallback']=_0x348ca7,_0x230ebc['name']=_0x152dd6['title'],_0x230ebc;}return null;});}function extractHLS(_0x2e734b,_0x471807){const _0x5bc420={_0x1ae053:0x176,_0x5ec42d:0x15d,_0x283957:0x159,_0x2ce91b:0x191,_0x296576:0x186};return __async(this,null,function*(){const _0x574265=_0x18f4;try{const _0x1aeca0=Object[_0x574265(_0x5bc420._0x1ae053)](getHeaders(),{'Referer':_0x574265(_0x5bc420._0x5ec42d)+_0x471807+'/'}),_0x3d9692=yield fetch(_0x2e734b,{'headers':_0x1aeca0});if(!_0x3d9692['ok'])return null;const _0x17b3ad=yield _0x3d9692['text']();let _0x31636d=_0x17b3ad['match'](/data-id="(\d+)"/);if(!_0x31636d){const _0x64f085=_0x17b3ad['match'](/<iframe[^>]*src="([^"]+)"/);if(_0x64f085){const _0x4f40d8=_0x64f085[0x1]['startsWith'](_0x574265(0x166))?_0x64f085[0x1]:'https://'+_0x471807+_0x64f085[0x1],_0x429fa1=yield fetch(_0x4f40d8,{'headers':_0x1aeca0});if(_0x429fa1['ok']){const _0x5068a4=yield _0x429fa1[_0x574265(_0x5bc420._0x283957)]();_0x31636d=_0x5068a4['match'](/data-id="(\d+)"/);}}}if(!_0x31636d)return null;const _0x2888d3=_0x31636d[0x1],_0x286339='https://'+_0x471807+_0x574265(0x196)+_0x2888d3,_0x5908b5=yield fetch(_0x286339,{'headers':Object['assign'](getHeaders(),{'X-Requested-With':_0x574265(0x188),'Referer':_0x2e734b})});if(!_0x5908b5['ok'])return null;const _0x57845c=yield _0x5908b5['json']();if(_0x57845c['sources']&&_0x57845c[_0x574265(_0x5bc420._0x2ce91b)]['file']){const _0x59beb9=[];if(_0x57845c['tracks'])for(const _0x4a7097 of _0x57845c[_0x574265(0x13e)]){(_0x4a7097['kind']===_0x574265(0x13d)||_0x4a7097[_0x574265(0x13f)]==='subtitles')&&_0x59beb9['push']({'id':_0x4a7097['label']||_0x4a7097[_0x574265(0x186)]||_0x574265(0x15e),'url':_0x4a7097[_0x574265(_0x5bc420._0x296576)],'language':'eng'});}var _0x3ace61='1080p';try{const _0x5d39ff=yield fetch(_0x57845c['sources']['file'],{'headers':{'Referer':'https://'+_0x471807+'/'}});if(_0x5d39ff['ok']){const _0x2edc9a=yield _0x5d39ff['text']();var _0x48fab0=_0x2edc9a['match'](/RESOLUTION=\d+x(\d+)/);if(_0x48fab0)_0x3ace61=_0x48fab0[0x1]+'p';}}catch(_0x21ca45){}return{'url':_0x57845c['sources']['file'],'quality':_0x3ace61,'subtitles':_0x59beb9,'headers':{'Referer':_0x574265(_0x5bc420._0x5ec42d)+_0x471807+'/','Origin':'https://'+_0x471807}};}}catch(_0xbbd631){}return null;});}function fetchJson(_0x76d1db){return __async(this,arguments,function*(_0x2fb9c6,_0xa93135={}){const _0x54f14f=yield fetch(_0x2fb9c6,_0xa93135);if(!_0x54f14f['ok'])return null;return yield _0x54f14f['json']();});}function getAbsoluteEpisode(_0x58f293,_0x2f7ba5,_0xc25cba,_0x5443bd,_0x318a39){const _0x20e5f4={_0x269c65:0x19b,_0x48e47a:0x144,_0x11148a:0x144,_0x30ee96:0x18a,_0xecd43f:0x180,_0x309ef0:0x17e};return __async(this,null,function*(){const _0x2d956b=_0x18f4;if(_0x2f7ba5===_0x2d956b(_0x20e5f4._0x269c65))return 0x1;let _0x51d86f=_0x5443bd,_0x1a114d=null,_0x2a63a6=null;try{const _0xb6803a=yield fetchJson('https://api.themoviedb.org/3/tv/'+_0x58f293+'/external_ids?api_key='+TMDB_API_KEY);_0xb6803a&&(_0x1a114d=_0xb6803a['imdb_id'],_0x2a63a6=_0xb6803a['tvdb_id']);}catch(_0x383895){}if(!_0x2a63a6&&_0x318a39)try{const _0x31c6e7=yield getTvdbToken();if(_0x31c6e7){const _0x5a2b81=yield fetchJson(_0x2d956b(0x184)+encodeURIComponent(_0x318a39),{'headers':{'Authorization':_0x2d956b(0x170)+_0x31c6e7}});if(_0x5a2b81&&_0x5a2b81[_0x2d956b(_0x20e5f4._0x48e47a)]){const _0x37ec1b=_0x5a2b81['data']['find'](_0x194a9c=>_0x194a9c['type']===_0x2d956b(0x187));if(_0x37ec1b){const _0x55f55a=_0x37ec1b['id']||_0x37ec1b['tvdb_id'];if(_0x55f55a)_0x2a63a6=parseInt(String(_0x55f55a)['replace'](/^series-/,''),0xa);}}}}catch(_0x45cdd0){}if(_0x2a63a6)try{const _0x56e90a=yield getTvdbToken();if(_0x56e90a){const _0x1721a2=yield fetchJson(_0x2d956b(0x13c)+_0x2a63a6+'/episodes/default?season='+_0xc25cba,{'headers':{'Authorization':'Bearer\x20'+_0x56e90a}});if(_0x1721a2&&_0x1721a2[_0x2d956b(0x144)]&&_0x1721a2[_0x2d956b(_0x20e5f4._0x11148a)][_0x2d956b(_0x20e5f4._0x30ee96)]){const _0x3707dc=_0x1721a2['data']['episodes'][_0x2d956b(_0x20e5f4._0xecd43f)](_0x4af43d=>_0x4af43d[_0x2d956b(0x197)]==_0xc25cba&&_0x4af43d[_0x2d956b(0x15c)]==_0x5443bd);if(_0x3707dc&&_0x3707dc['absoluteNumber'])return _0x3707dc[_0x2d956b(0x17f)];}}}catch(_0x39df92){}if(_0x1a114d)try{const _0x280fa3=_0x2d956b(0x15a)+_0x1a114d+'.json',_0x11b45d=yield fetch(_0x280fa3);if(_0x11b45d['ok']){const _0x1ac81c=yield _0x11b45d[_0x2d956b(0x159)]();let _0x1e6b1e=0x0,_0x20695a=![];const _0x4e9432=/"season"\s*:\s*(\d+)/g;let _0x1f7b47;while((_0x1f7b47=_0x4e9432['exec'](_0x1ac81c))!==null){_0x20695a=!![];const _0x2587d2=parseInt(_0x1f7b47[0x1]);if(_0x2587d2>0x0&&_0x2587d2<_0xc25cba)_0x1e6b1e++;}if(_0x20695a)return _0x1e6b1e+_0x5443bd;}}catch(_0x7dc9a7){}try{const _0x1dd45c='https://api.themoviedb.org/3/tv/'+_0x58f293+_0x2d956b(0x167)+TMDB_API_KEY,_0x14a578=yield fetchJson(_0x1dd45c,{});if(_0x14a578&&_0x14a578['seasons']){let _0x481bcb=0x0;const _0x2ab00d=_0x14a578[_0x2d956b(0x181)]['filter'](_0x2027ab=>_0x2027ab['season_number']>0x0&&_0x2027ab[_0x2d956b(0x174)]<_0xc25cba);for(let _0x37395c of _0x2ab00d){_0x481bcb+=_0x37395c[_0x2d956b(_0x20e5f4._0x309ef0)];}return _0x481bcb+=_0x5443bd,_0x481bcb;}}catch(_0x589820){}return _0x51d86f;});}function getStreams(_0x4e3efa,_0x2d8f06,_0xdae045,_0x2db00a){const _0x145d04={_0xe692fe:0x152,_0x41c9d8:0x183,_0x40e8be:0x14f,_0x4b739c:0x145,_0x50e5d0:0x14e,_0x1e34d7:0x19d,_0xd2d640:0x171,_0x388fff:0x16c,_0x3839c8:0x14c,_0x12babb:0x165,_0x3f4f9a:0x17a,_0x486a67:0x16f,_0x3b8243:0x16c};return __async(this,null,function*(){const _0x5094bf=_0x18f4;try{const _0x40b06f=yield getMalId(_0x4e3efa,_0x2d8f06,_0xdae045,_0x2db00a);if(!_0x40b06f||!_0x40b06f['malId']&&!_0x40b06f['aniId'])return[];const _0x204d8f=!!_0x40b06f[_0x5094bf(0x16d)],_0x25b16d=_0x204d8f?_0x40b06f['malId']:_0x40b06f['aniId'],_0x586a77=_0x204d8f?_0x5094bf(0x179):_0x5094bf(0x15f);let _0x40660e=_0x2d8f06==='movie'?0x1:_0x40b06f['absEp'];_0x2d8f06!==_0x5094bf(0x19b)&&_0x40b06f['usedFallback']&&_0xdae045>0x1&&(_0x40660e=yield getAbsoluteEpisode(_0x4e3efa,_0x2d8f06,_0xdae045,_0x2db00a,_0x40b06f['name']));const _0x17d9dc=yield getTMDBDetails(_0x4e3efa,_0x2d8f06,_0xdae045,_0x2db00a),_0x58a1d1=[],_0x5a010b=[{'id':'Vidstream','domain':'megaplay.buzz'}];for(const _0x388dd3 of _0x5a010b){const _0x16157c=['sub',_0x5094bf(_0x145d04._0xe692fe)];for(const _0x4da171 of _0x16157c){const _0x466019='https://'+_0x388dd3['domain']+_0x5094bf(0x141)+_0x586a77+'/'+_0x25b16d+'/'+_0x40660e+'/'+_0x4da171,_0x3bb62=yield extractHLS(_0x466019,_0x388dd3[_0x5094bf(_0x145d04._0x41c9d8)]);if(_0x3bb62){const _0x4cdf52=(_0x3bb62[_0x5094bf(_0x145d04._0x40e8be)]||_0x5094bf(_0x145d04._0x4b739c))['toLowerCase'](),_0x20c292=_0x4da171===_0x5094bf(0x19d)?'🇯🇵\x20Japanese':_0x5094bf(_0x145d04._0x50e5d0),_0x14cd1f=_0x4da171===_0x5094bf(_0x145d04._0x1e34d7)?_0x5094bf(_0x145d04._0xd2d640):'DUB',_0x376163=_0x4da171==='sub'?'Japanese\x20(SUB)':'English\x20(DUB)',_0x2b3f0b=_0x3bb62[_0x5094bf(_0x145d04._0x388fff)]['includes'](_0x5094bf(_0x145d04._0x3839c8))?'HLS':'M3U8',_0x15d865=PROVIDER_NAME+_0x5094bf(0x172)+_0x4cdf52+_0x5094bf(0x172)+_0x376163,_0x33089d='🎦\x20'+_0x17d9dc['title']+_0x5094bf(0x160)+_0x17d9dc[_0x5094bf(0x173)]+')',_0x59a1c3=_0x2d8f06==='movie'?_0x5094bf(_0x145d04._0x12babb):'🎬\x20S'+(_0xdae045||0x1)+'E'+(_0x2db00a||0x1)+'\x20-\x20'+_0x17d9dc['epTitle'],_0x83a2fa='✨\x20'+_0x4cdf52+'\x20|\x20'+_0x20c292+_0x5094bf(0x157)+_0x14cd1f,_0x45de7b=_0x5094bf(0x149)+_0x388dd3['id']+'\x20|\x20⏳\x20'+_0x17d9dc[_0x5094bf(_0x145d04._0x3f4f9a)]+_0x5094bf(_0x145d04._0x486a67)+_0x2b3f0b,_0x508e7f=_0x33089d+'\x0a'+_0x59a1c3+'\x0a'+_0x83a2fa+'\x0a'+_0x45de7b;_0x58a1d1[_0x5094bf(0x182)]({'name':_0x15d865,'title':_0x508e7f,'size':_0x508e7f,'description':_0x508e7f,'url':_0x3bb62[_0x5094bf(_0x145d04._0x3b8243)],'subtitles':_0x3bb62['subtitles'],'headers':_0x3bb62['headers']});}}}return _0x58a1d1;}catch(_0x50a85a){return[];}});}function search(_0x2afb92){return __async(this,null,function*(){return[];});}function _0x18f4(_0x9934f6,_0x51d7e5){_0x9934f6=_0x9934f6-0x139;const _0x4615f2=_0x4615();let _0x18f43b=_0x4615f2[_0x9934f6];if(_0x18f4['TKOTGr']===undefined){var _0x16ae7b=function(_0x2e0a8d){const _0x4b95c1='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x4ca38f='',_0x3f879a='';for(let _0x1e39c8=0x0,_0x4516b1,_0x3deece,_0x1f5651=0x0;_0x3deece=_0x2e0a8d['charAt'](_0x1f5651++);~_0x3deece&&(_0x4516b1=_0x1e39c8%0x4?_0x4516b1*0x40+_0x3deece:_0x3deece,_0x1e39c8++%0x4)?_0x4ca38f+=String['fromCharCode'](0xff&_0x4516b1>>(-0x2*_0x1e39c8&0x6)):0x0){_0x3deece=_0x4b95c1['indexOf'](_0x3deece);}for(let _0x7ccbee=0x0,_0x22d50d=_0x4ca38f['length'];_0x7ccbee<_0x22d50d;_0x7ccbee++){_0x3f879a+='%'+('00'+_0x4ca38f['charCodeAt'](_0x7ccbee)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x3f879a);};_0x18f4['TjvVhE']=_0x16ae7b,_0x18f4['nqVvIM']={},_0x18f4['TKOTGr']=!![];}const _0x1213c0=_0x4615f2[0x0],_0x453af3=_0x9934f6+_0x1213c0,_0x4d7ba6=_0x18f4['nqVvIM'][_0x453af3];return!_0x4d7ba6?(_0x18f43b=_0x18f4['TjvVhE'](_0x18f43b),_0x18f4['nqVvIM'][_0x453af3]=_0x18f43b):_0x18f43b=_0x4d7ba6,_0x18f43b;}function getCatalog(_0x3d0599){return __async(this,null,function*(){return[];});}function getItemDetails(_0x4fe737){return __async(this,null,function*(){return[];});}typeof module!=='undefined'&&module['exports']?module['exports']={'getStreams':getStreams,'search':search,'getCatalog':getCatalog,'getItemDetails':getItemDetails}:global['getStreams']=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankAnimeMappingFetch(cloudbankMetadataFetch(fetch)), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "anikototv", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AnikotoTV", "anikototv");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
