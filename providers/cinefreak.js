/* CineFreak 2.0.0: cinefreak.net, per-file original-language policy. */
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
        original_language: raw.originalLanguage || raw.original_language || "",
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


(function () {
  'use strict';
  var BASE = 'https://cinefreak.net';
  var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
  var cheerio = require('cheerio-without-node-native');
  var LANG = {en:['english'],hi:['hindi'],bn:['bengali','bangla'],ta:['tamil'],te:['telugu'],ml:['malayalam'],kn:['kannada'],ko:['korean'],ja:['japanese'],zh:['chinese','mandarin','cantonese'],id:['indonesian'],ms:['malay'],fr:['french'],es:['spanish'],de:['german'],it:['italian'],pt:['portuguese'],th:['thai'],tl:['filipino','tagalog'],tr:['turkish'],ar:['arabic'],ru:['russian'],vi:['vietnamese'],pa:['punjabi'],mr:['marathi']};
  function log(s) { console.log('[CineFreak] ' + s); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^\w\u0080-\uffff]+/g,' ').trim(); }
  function languages(s) {
    var n = ' ' + norm(s) + ' ', out = [];
    Object.keys(LANG).forEach(function(code) {
      if (LANG[code].some(function(word) { return n.indexOf(' '+word+' ') >= 0; })) out.push(code);
    });
    return out;
  }
  function originalOnly(label, original) {
    if (!LANG[original] || /\b(?:dual|multi(?:ple)?)[ -]?audio\b|\bdubbed\b|\bhindi line\b|\bbangla dub\b/i.test(label)) return false;
    var found = languages(label);
    return found.length === 1 && found[0] === original;
  }
  function quality(s) { var m = /\b(720|1080|1440|2160)p?\b/i.exec(s); return m ? Number(m[1]) : /\b4k\b/i.test(s) ? 2160 : 0; }
  function url(s, base) { try { var u = new URL(s,base || BASE); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function filePage(s) { try { var u = new URL(s); return /^https:$/.test(u.protocol) && /^(?:[a-z0-9-]+\.)*cinecloud\.site$/i.test(u.hostname) && /^\/f\/[A-Za-z0-9_-]+$/.test(u.pathname); } catch (_) { return false; } }
  function visible($, el) { return !$(el).closest('[aria-hidden="true"], [hidden], [tabindex="-1"]').length; }
  function matchedTitle(text, meta) {
    var year = /\((\d{4})\)/.exec(text), expected = String(meta.release_date || meta.first_air_date || '').slice(0,4);
    if (!year || !expected || year[1] !== expected) return false;
    var title = norm(text.slice(0,year.index));
    return buildTitleProfile(meta).aliases.some(function(alias) { return norm(alias) === title; });
  }
  function typeMatches(text, type) {
    var series = /\b(?:web[ -]?series|full series|season\s*\d+)\b/i.test(text);
    return type === 'tv' ? series : !series;
  }
  function selectPost(rows, meta, type) {
    return rows.filter(function(row) { return row && matchedTitle(row.t,meta) && typeMatches(row.t,type) && /^[a-z0-9%][a-z0-9%._~-]*$/i.test(row.l || ''); }).slice(0,3);
  }
  function episodeKey(key, season, episode) {
    var m = /^es(\d+)e(\d+)$/i.exec(key || '');
    return !!m && Number(m[1]) === season && Number(m[2]) === episode;
  }
  function extractFiles(html, original, type, season, episode) {
    var $ = cheerio.load(html), out = [], seen = Object.create(null);
    function add(href, label, audio) {
      var resolved = url(href), q = quality(label);
      if (!filePage(resolved) || !q || /\b(?:dual|multi)[ -]?audio\b|\bdubbed\b/i.test(label) || !originalOnly(audio,original) || seen[resolved]) return;
      seen[resolved] = true; out.push({url:resolved,quality:q,label:label,language:original});
    }
    if (type === 'movie') {
      $('.download-links-div .movie-title').each(function(_, h) {
        if (!visible($,h)) return;
        var heading = $(h), label = heading.text().replace(/\s+/g,' ').trim();
        var audio = heading.find('span').first().text() || ((/\[([^\]]+)\]/.exec(label) || [])[1]) || '';
        // Each quality heading owns only its following buttons, never a neighbouring quality.
        var buttons = heading.next();
        while (buttons.length && !buttons.hasClass('movie-title')) {
          if (buttons.hasClass('dlbtn-container')) {
            buttons.find('a.dlbtn-download[href]').each(function(_, a) { if (visible($,a)) add($(a).attr('href'),label,audio); });
            break;
          }
          buttons = buttons.next();
        }
      });
    } else {
      $('.cft-it[data-k]').each(function(_, card) {
        if (!visible($,card) || !episodeKey($(card).attr('data-k'),season,episode)) return;
        var el = $(card), audio = el.find('.cft-meta').first().text();
        if (/episodes?\s*\d+\s*[-–]\s*\d+|episodes in one file|season pack/i.test(el.text())) return;
        el.find('.cft-qs a.cfs-dl[href]').each(function(_, a) {
          if (visible($,a)) add($(a).attr('href'),$(a).text(),audio);
        });
      });
    }
    return out.sort(function(a,b) { return b.quality-a.quality; }).slice(0,2);
  }
  function extractDirect(html, base) {
    var $ = cheerio.load(html), out = [];
    $('a#fsl[href], a[href]').each(function(_, a) {
      if (!visible($,a)) return;
      var href = url($(a).attr('href'),base);
      // Only explicit files or the original provider's named direct-file link.
      if (href && ($(a).attr('id') === 'fsl' || /\.(?:mkv|mp4)(?:[?#]|$)/i.test(href)) && !/\.(?:zip|rar)(?:[?#]|$)/i.test(href) && out.indexOf(href)<0) out.push(href);
    });
    return out.slice(0,2);
  }
  function isMagic(bytes) {
    return bytes.length>=8 && ((bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3) || (bytes[4]===0x66&&bytes[5]===0x74&&bytes[6]===0x79&&bytes[7]===0x70));
  }
  async function getStreams(id, mediaType, season, episode) {
    var type = mediaType === 'series' ? 'tv' : mediaType;
    if (!/^[1-9]\d*$/.test(String(id)) || ['movie','tv'].indexOf(type)<0) return [];
    if (type==='tv' && (!Number.isInteger(Number(season)) || Number(season)<1 || !Number.isInteger(Number(episode)) || Number(episode)<1)) return [];
    var deadline=Date.now()+18500, count=0;
    async function request(target, options) {
      var remaining=deadline-Date.now(), timeout=Math.min(4200,remaining);
      if(timeout<250) throw new Error('request budget exhausted');
      var timer, controller=typeof AbortController==='function'?new AbortController():null;
      var opts=Object.assign({headers:{'User-Agent':UA,Referer:BASE+'/'}},options||{});
      if(controller)opts.signal=controller.signal;
      count++;
      try {
        return await Promise.race([
          (async function(){
            var r=await fetch(target,opts), ct=String(r.headers.get('content-type')||'').toLowerCase();
            if(!r.ok)throw new Error('HTTP '+r.status+' at '+new URL(target).hostname);
            if(opts.binary && (r.status!==206 || !/^bytes 0-\d+\/\d+$/i.test(String(r.headers.get('content-range')||'')) || Number(r.headers.get('content-length')||0)>65536)) {
              if(controller)controller.abort();
              throw new Error('media server did not honour bounded Range');
            }
            var body=opts.binary?new Uint8Array(await r.arrayBuffer()):await r.text();
            return {body:body,url:r.url||target,ct:ct,status:r.status};
          })(),
          new Promise(function(_,reject){timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('request timeout'));},timeout);})
        ]);
      } finally { clearTimeout(timer); }
    }
    async function metadata() {
      var target='https://api.themoviedb.org/3/'+type+'/'+id+'?api_key=439c478a771f35c05022f9feabcca01c&append_to_response=alternative_titles,external_ids';
      function load() { return request(target).then(function(r){return JSON.parse(r.body);}); }
      var m=await vueoSharedTmdb(target,load);
      if(!m.original_language) m=await load();
      return m;
    }
    try {
      var meta=await metadata(), original=String(meta.original_language||'').toLowerCase();
      if (!LANG[original]) {log('NO_RESULT: original language unavailable or unsupported');return [];}
      log('ROUTE: cinefreak.net public search; original='+original+'; minimum=720p; dual audio rejected');
      var aliases=buildTitleProfile(meta).aliases.slice(0,2), posts=[];
      for(var ai=0;ai<aliases.length&&!posts.length;ai++) {
        var r=await request(BASE+'/search-api.php?q='+encodeURIComponent(aliases[ai])+'&pg=1');
        var data=JSON.parse(r.body);
        // Current public search works without a key. Honour a renewal response once.
        if(data.renew) {
          var tok=JSON.parse((await request(BASE+'/search-api.php',{method:'POST',headers:{'User-Agent':UA,Referer:BASE+'/fast-search/','Content-Type':'application/x-www-form-urlencoded'},body:'st=1'})).body);
          if(!tok.k)throw new Error('search authentication unavailable');
          data=JSON.parse((await request(BASE+'/search-api.php?q='+encodeURIComponent(aliases[ai])+'&pg=1',{headers:{'User-Agent':UA,Referer:BASE+'/fast-search/','X-CF-ST':tok.k}})).body);
        }
        posts=selectPost(Array.isArray(data.results)?data.results:[],meta,type);
      }
      if(!posts.length){log('NO_RESULT: no exact title/year/type match');return [];}
      var streams=[];
      for(var pi=0;pi<posts.length&&Date.now()<deadline-1000;pi++) {
        var pageUrl=BASE+'/'+posts[pi].l+'/', page=await request(pageUrl),$=cheerio.load(page.body), heading=$('h1').first().text();
        if(!matchedTitle(heading,meta)||!typeMatches(heading,type))continue;
        var datasetMatch=/const\s+dataset\s*=\s*({[^\n]+});/.exec(page.body);
        if(datasetMatch) {
          var dataset=JSON.parse(datasetMatch[1]);
          if((type==='movie'&&dataset.type!=='movie')||(type==='tv'&&dataset.type!=='series'))continue;
        }
        var files=extractFiles(page.body,original,type,Number(season),Number(episode));
        log('MATCH: title/year/type verified; original-only quality files='+files.length+(type==='tv'?' S'+season+'E'+episode+'; packs rejected':''));
        for(var fi=0;fi<files.length&&Date.now()<deadline-1000;fi++) {
          var f=files[fi];
          try {
            var host=await request(f.url,{headers:{'User-Agent':UA,Referer:pageUrl}}),direct=extractDirect(host.body,host.url);
            for(var di=0;di<direct.length&&Date.now()<deadline-1000;di++) {
              var headers={'User-Agent':UA,Referer:new URL(host.url).origin+'/'};
              // Range is required: never download an entire film to validate it.
              var probe=await request(direct[di],{headers:Object.assign({},headers,{Range:'bytes=0-1023'}),binary:true});
              if(probe.status!==206 || /html|json/.test(probe.ct) || !isMagic(probe.body)) {log('REJECT: direct link failed bounded file-signature check');continue;}
              streams.push({name:'CineFreak',title:(meta.title||meta.name)+' • Original '+original.toUpperCase(),url:probe.url,quality:f.quality+'p',headers:headers,provider:'cinefreak',language:original,subtitles:[],behaviorHints:{notWebReady:true},audioEvidence:'single-language file label matched TMDB original_language'});
              break;
            }
          } catch(err) { log('HOST: '+String(err.message||err)); }
        }
        if(streams.length)break;
      }
      log('RESULT: '+streams.length+' original-labelled sources; '+count+' HTTP calls; playback needs device confirmation');
      return streams;
    } catch(err) { log('NO_RESULT: '+String(err.message||err));return []; }
  }
  module.exports={getStreams:getStreams};
  globalThis.getStreams=getStreams;
  // Test-only access; never exposed in the app unless explicitly requested by a fixture runner.
  if(globalThis.CINEFREAK_TEST_MODE)module.exports._test={originalOnly:originalOnly,matchedTitle:matchedTitle,selectPost:selectPost,episodeKey:episodeKey,extractFiles:extractFiles,extractDirect:extractDirect,isMagic:isMagic};
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
module.exports = cloudbankDisplayInstall(module.exports, "CineFreak", "cinefreak");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
