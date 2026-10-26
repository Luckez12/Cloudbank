"use strict";
/* VUEO_PROVIDER_REPAIR_V16 */
/* Exact title first; season/year disambiguate multiple candidates only. */
/* VUEO_FAST_DISCOVERY_V1 — one title query before conditional alias fallback. */
var PROVIDER_NAME = "OneTouchTV", VERSION = "1.5.2";
var BASE_URL = "https://api3.devcorp.me";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var AES_KEY_TEXT = "im72charPasswordofdInitVectorStm", AES_IV_TEXT = "im72charPassword";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = { "User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*", "Referer": BASE_URL + "/" };
var CACHE_SLOT = "__CLOUDBANK_ONETOUCH_MATCH_V2__";
var localCache = { matches: {} };
function trace(stage, details) {
  console.log("[OneTouchTV] " + stage + ": " + JSON.stringify(details || {}));
  try { if (typeof globalThis.vueoTrace === "function") globalThis.vueoTrace(stage, details || {}); } catch (_) {}
}
function cacheStore() {
  try { if (!globalThis[CACHE_SLOT]) globalThis[CACHE_SLOT] = localCache; return globalThis[CACHE_SLOT]; }
  catch (_) { return localCache; }
}
function remember(key, item, info) {
  var map = cacheStore().matches;
  map[key] = { id: String(itemId(item)), title: itemTitle(item), year: info.year, used: Date.now(), at: Date.now() };
  var keys = Object.keys(map).sort(function(a,b) { return map[a].used - map[b].used; });
  while (keys.length > 500) delete map[keys.shift()];
}
function wire(run, url, options, timeout, stage) {
  var ms = Math.min(timeout || 4000, run.deadline - Date.now());
  if (ms < 100) return Promise.reject(new Error("Provider deadline at " + stage));
  return new Promise(function(resolve, reject) {
    var done = false, start = Date.now();
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function() { finish(new Error(stage + " timeout")); if (controller) controller.abort(); }, ms);
    function finish(error, value) { if (done) return; done = true; clearTimeout(timer); if(error) reject(error); else resolve(value); }
    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, DEFAULT_HEADERS, opts.headers || {});
    if (controller) opts.signal = controller.signal;
    Promise.resolve().then(function() { return fetch(url, opts); }).then(function(res) {
      if (done) return;
      if (!res || !res.ok) { var e = new Error(stage + " HTTP " + (res && res.status || 0)); e.status = res && res.status; throw e; }
      return res.text();
    }).then(function(text) {
      if (done) return;
      if (String(text).length > 2000000) return finish(new Error(stage + " response too large"));
      trace("HTTP", {stage:stage, ms:Date.now()-start}); finish(null, text);
    }, function(error) { finish(error); });
  });
}
function unwrapPayload(value) {
  var current = value;
  for(var i=0;i<5;i++) {
    if(typeof current === "string") { try { current = parseJsonLenient(current, "nested response"); continue; } catch (_) { break; } }
    if(!current || typeof current !== "object" || Array.isArray(current)) break;
    if(current.sources || current.source || current.streams || current.episodes || current.episodeList || current.title || current.id) break;
    if(current.result !== undefined && current.result !== null) { current=current.result; continue; }
    if(current.data !== undefined && current.data !== null) { current=current.data; continue; }
    break;
  }
  return current;
}
function api(run, path, stage) {
  return wire(run, BASE_URL + path, {}, stage === "episode" ? 5000 : 4000, stage).then(function(raw) {
    var text=String(raw || "").replace(/^\uFEFF/, "").trim();
    if (!text) throw new Error("Empty API response");
    if (/^[\[{]/.test(text)) return unwrapPayload(parseJsonLenient(text, stage));
    try {
      var decodeStart=Date.now(), decoded=decryptString(text), decodeMs=Date.now()-decodeStart;
      var parseStart=Date.now(), result = unwrapPayload(parseJsonLenient(decoded, stage));
      trace("DECRYPT", {method:"local", stage:stage,bytes:text.length,decodeMs:decodeMs,parseMs:Date.now()-parseStart}); return result;
    } catch (error) {
      trace("DECRYPT_FALLBACK", {stage:stage, reason:error.message});
      // Compatibility only; never adds a remote round trip when local AES works.
      return wire(run, "https://enc-dec.app/api/dec-onetouchtv", { method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:text}) }, 3000, "remote-decrypt")
        .then(function(body) {
          var envelope=parseJsonLenient(body,"decrypt response");
          if(!envelope || Number(envelope.status)!==200 || envelope.result==null) throw new Error("Remote decrypt rejected response");
          return unwrapPayload(envelope.result);
        });
    }
  });
}
function metadata(run, id, type) {
  var url="https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(id)+"?api_key="+TMDB_API_KEY+"&append_to_response=alternative_titles,translations,external_ids";
  return vueoSharedTmdb(url,function() { return wire(run,url,{},2200,"metadata").then(function(text) {return parseJsonLenient(text,"metadata");}); }).then(function(data) {
    return {title:data.title||data.name||"", originalTitle:data.original_title||data.original_name||"",
      year:String(data.release_date||data.first_air_date||"").slice(0,4), aliases:collectTmdbAliases(data,type)};
  });
}
function seasonTitle(value) {
  var title=String(value||"").replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, "").trim();
  var m=title.match(/(?:\s*[-–—:]\s*|\s+)(?:season\s*(\d+)|s(\d+)|(\d+)(?:st|nd|rd|th)\s+season)\s*$/i);
  return {title:m?title.slice(0,m.index).trim():title, season:m?Number(m[1]||m[2]||m[3]):null};
}
function compatible(item, info, type, season, fallbackTitle) {
  if(!item || typeof item!=="object") return false;
  var itype=itemType(item);
  if (itype && ((type==="tv" && /^(movie|film)$/.test(itype)) || (type==="movie" && /^(drama|tv|series|tvseries)$/.test(itype)))) return false;
  var titles=[itemTitle(item)||fallbackTitle].concat(Array.isArray(item.otherTitles)?item.otherTitles:[]).filter(Boolean);
  return titles.some(function(title) {
    return info.aliases.some(function(alias) { return normalizeTitle(seasonTitle(alias).title)===normalizeTitle(seasonTitle(title).title); });
  });
}
function itemSeason(item) {
  var explicit=firstValue(item,["season","seasonNumber","season_number"]);
  return explicit!==null && /^\d+$/.test(String(explicit)) ? Number(explicit) : seasonTitle(itemTitle(item)).season;
}

function episodeRows(detail) {
  return Array.isArray(detail.episodes)?detail.episodes:Array.isArray(detail.episodeList)?detail.episodeList:Array.isArray(detail.episode_list)?detail.episode_list:[];
}
function selectEpisode(detail, type, season, episode, item) {
  var rows=episodeRows(detail);
  var rootSeason=firstValue(detail,["season","seasonNumber","season_number"]) || seasonTitle(itemTitle(detail)||itemTitle(item)).season;
  if(rootSeason==null) rootSeason=firstValue(item,["season","seasonNumber","season_number"]) || seasonTitle(itemTitle(item)).season;
  var valid=rows.filter(function(row) {
    var identifier=firstValue(row,["identifier","contentIdentifier","content_identifier","vodIdentifier","vod_identifier","contentId","content_id"]);
    var play=firstValue(row,["playId","play_id","playID","id","episodeId","episode_id"]);
    return identifier!==null && play!==null;
  });
  if(type==="movie") { if(valid.length!==1) throw new Error("Ambiguous movie entries"); return valid[0]; }
  var matching=valid.filter(function(row) {
    var value=firstValue(row,["episode","episodeNumber","episode_number","number","ep"]);
    return value!==null && /^(?:\d+)(?:\.\d+)?$/.test(String(value)) && Number(value)===episode;
  });
  // A unique exact episode wins regardless of its season label.
  if(matching.length>1) matching=matching.filter(function(row) {
    var ownSeason=firstValue(row,["season","seasonNumber","season_number"]);
    var observed=ownSeason!==null?Number(ownSeason):rootSeason!==null && rootSeason!==undefined?Number(rootSeason):1;
    return observed===season;
  });
  if(matching.length!==1) throw new Error("Exact episode missing or ambiguous");
  return matching[0];
}

function detail(run, item, info, type, season, episode) {
  return api(run,"/vod/"+encodeURIComponent(itemId(item))+"/detail","detail").then(function(root) {
    if(!compatible(root,info,type,season,itemTitle(item))) throw new Error("Detail title/type mismatch");
    if(itemId(root)!==null && String(itemId(root)).toLowerCase()!==String(itemId(item)).toLowerCase()) throw new Error("Detail ID mismatch");
    var selected=selectEpisode(root,type,season,episode,item);
    return {item:item,detail:root,selected:selected};
  });
}
function searchList(payload) {
  var root=unwrapPayload(payload);
  if(Array.isArray(root)) return root;
  var keys=["items","list","records","results"];
  for(var i=0;i<keys.length;i++) if(root && Array.isArray(root[keys[i]])) return root[keys[i]];
  throw new Error("Unknown search schema");
}
function discover(run,id,info,type,season,episode) {
  var map=cacheStore().matches, key=type+"/"+id+"/"+season;
  var saved=map[key];
  function rememberMatch(match) { remember(key,match.item,info);return match; }
  function search() {
    var queries=[info.title].concat(type==="tv" && season>1 ? [info.title+" Season "+season] : []).concat([info.originalTitle],info.aliases).filter(function(q,i,all) {return q && all.findIndex(function(x) {return normalizeTitle(x)===normalizeTitle(q);})===i;}).slice(0,3);
    function at(index) {
      if(index>=queries.length) throw new Error("No verified title/season/episode");
      trace("SEARCH",{query:queries[index],attempt:index+1});
      return api(run,"/vod/search?page=1&keyword="+encodeURIComponent(queries[index]),"search").then(searchList).then(function(rows) {
        var seen={}, exact=rows.filter(function(row) {
          if(itemId(row)===null || !compatible(row,info,type,season)) return false;
          // API returns both lowercase/uppercase slug duplicates for the same title.
          var identity=String(itemId(row)).toLowerCase();
          if(seen[identity]) return false;seen[identity]=true;return true;
        });
        trace("CANDIDATES",{results:rows.length,exact:exact.length,policy:exact.length===1?"unique-title-ignore-year-season":"disambiguate"});
        if(exact.length>1 && type==="tv") {
          exact=exact.filter(function(row) {var observed=itemSeason(row);return (observed===null?1:observed)===season;});
          if(season===1 && exact.some(function(row) {return itemSeason(row)!==null;})) exact=exact.filter(function(row) {return itemSeason(row)!==null;});
        }
        if(exact.length>1 && info.year) {
          var preferred=exact.filter(function(row) {return itemYear(row)===info.year;});
          if(preferred.length) exact=preferred;
        }
        if(!exact.length) return null;
        if(exact.length>3) throw new Error("Too many ambiguous exact candidates");
        return Promise.all(exact.map(function(row) {return detail(run,row,info,type,season,episode).catch(function(error) {trace("DETAIL_REJECT",{id:itemId(row),reason:error.message});return null;});})).then(function(matches) {
          var good=matches.filter(Boolean);
          if(exact.length===1 && good.length===1) return good[0];
          var sameYear=good.filter(function(match) {return info.year && itemYear(match.detail)===info.year;});
          if(sameYear.length===1) return sameYear[0];
          if(good.length>1) throw new Error("Ambiguous exact title matches");
          return null;
        });
      }).then(function(match) {return match||at(index+1);});
    }
    return at(0).then(rememberMatch);
  }
  if(saved && Date.now()-saved.at<30*24*60*60*1000 && saved.year===info.year && compatible(saved,info,type,season)) {
    saved.used=Date.now();trace("CACHE",{hit:true,id:saved.id});
    return detail(run,saved,info,type,season,episode).then(rememberMatch,function(error) {delete map[key];trace("CACHE_INVALID",{reason:error.message});return search();});
  }
  delete map[key];trace("CACHE",{hit:false});return search();
}
function safeUrl(value) {
  if(!String(value||"").trim()) return "";
  try{var url=new URL(String(value),BASE_URL+"/");return /^https?:$/.test(url.protocol)?url.href:"";}catch(_){return "";}
}
function buildSubtitles(payload) {
  var root=unwrapPayload(payload), tracks=root && (root.track||root.tracks||root.subtitles);
  if(!Array.isArray(tracks)) return [];
  var seen={};
  return tracks.map(function(track) {
    var kind=String(track.kind||track.type||"").toLowerCase();
    if(kind && /^(thumbnails|chapters|preview)$/.test(kind)) return null;
    var explicit=String(firstValue(track,["language","lang"])||"").trim().toLowerCase();
    if (/^(?:ms[-_]ind|id|ind|indonesian|indonesia)(?:$|[-_ ])/.test(explicit)) return null;
    var lang=subtitleLanguage(explicit);
    if (!explicit || /^(und|unknown|__)$/.test(explicit)) lang=subtitleLanguage(firstValue(track,["name","label"]));
    if (lang.code!=="en" && lang.code!=="ms") return null;
    var url=safeUrl(firstValue(track,["file","url","src"]));if(!url||seen[url])return null;seen[url]=true;
    var m=/\.(vtt|srt|ass|ssa)(?:[?#]|$)/i.exec(url);
    return {url:url,lang:lang.code,language:lang.code,label:lang.label,format:m?m[1].toLowerCase():"",
      headers:normalizeHeaders(track.headers,track.referer||BASE_URL+"/"),default:track.default===true||track.isDefault===true};
  }).filter(Boolean);
}
function parseStreams(payload,info,type,season,episode) {
  var root=unwrapPayload(payload), sources=root && (root.sources||root.source||root.streams), subs=buildSubtitles(root),seen={};
  if(!Array.isArray(sources)) return [];
  return sources.map(function(source,index) {
    var url=safeUrl(firstValue(source,["url","file","src"]));
    var declared=String(source.type||source.format||"").toLowerCase();
    if(!url || /\.(?:html?|php)(?:[?#]|$)/i.test(url) || (!/\.(m3u8|mp4|mpd|mkv)(?:[?#]|$)/i.test(url) && !/^(hls|mp4|dash|application\/x-mpegurl|application\/vnd.apple.mpegurl|video\/mp4)$/.test(declared))) return null;
    var h=normalizeHeaders(source.headers,source.referer||source.referrer||BASE_URL+"/");
    var identity=url+"|"+Object.keys(h).sort().map(function(k){return k+":"+h[k];}).join("|");
    if(seen[identity])return null;seen[identity]=true;
    var captionSeen={}, captions=buildSubtitles(source).concat(subs).filter(function(sub) {
      var key=sub.url+"|"+sub.lang;if(captionSeen[key])return false;captionSeen[key]=true;return true;
    });
    return {name:PROVIDER_NAME+" "+String(source.name||source.label||"Server "+(index+1)),title:info.title+(type==="tv"?" S"+season+"E"+episode:""),
      url:url,headers:h,quality:inferQuality(source),subtitles:captions, type:/\.mpd(?:[?#]|$)/i.test(url)?"dash":"direct"};
  }).filter(Boolean);
}
function getStreams(id, mediaType, season, episode) {
  var type=mediaType==="series"?"tv":mediaType;
  if(!/^\d+$/.test(String(id)) || (type!=="movie"&&type!=="tv")) return Promise.resolve([]);
  season=season==null?1:Number(season);episode=episode==null?1:Number(episode);
  if(type==="tv"&&(!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1))return Promise.resolve([]);
  var run={started:Date.now(),deadline:Date.now()+18500},info;
  trace("START",{version:VERSION,tmdb:String(id),type:type,season:season,episode:episode});
  return metadata(run,String(id),type).then(function(value) {
    info=value;if(!info.title)throw new Error("Missing metadata title");
    return discover(run,String(id),info,type,season,episode);
  }).then(function(match) {
    var row=match.selected, identifier=firstValue(row,["identifier","contentIdentifier","content_identifier","vodIdentifier","vod_identifier","contentId","content_id"]);
    var play=firstValue(row,["playId","play_id","playID","id","episodeId","episode_id"]);
    trace("MATCH",{id:itemId(match.item),title:itemTitle(match.detail),season:season,episode:episode});
    return api(run,"/vod/"+encodeURIComponent(identifier)+"/episode/"+encodeURIComponent(play),"episode");
  }).then(function(payload) {
    var streams=parseStreams(payload,info,type,season,episode);
    trace("RESULT",{streams:streams.length,subtitles:streams.length?streams[0].subtitles.length:0,ms:Date.now()-run.started});return streams;
  }).catch(function(error){trace("NO_RESULT",{reason:String(error.message||error),ms:Date.now()-run.started});return [];});
}
module.exports={getStreams:getStreams};

var AES_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var AES_INV_SBOX = (function() {
  var inverse = new Array(256);
  for (var i = 0; i < AES_SBOX.length; i++) inverse[AES_SBOX[i]] = i;
  return inverse;
})();
var AES_RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d,0x9a];

function asciiBytes(value) {
  var text = String(value || "");
  var out = new Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function decodeBase64(input) {
  var value = String(input || "")
    .replace(/-_\./g, "/")
    .replace(/@/g, "+")
    .replace(/\s+/g, "");
  while (value.length % 4 !== 0) value += "=";

  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  for (var i = 0; i < value.length; i += 4) {
    var c0 = alphabet.indexOf(value.charAt(i));
    var c1 = alphabet.indexOf(value.charAt(i + 1));
    var c2char = value.charAt(i + 2);
    var c3char = value.charAt(i + 3);
    var c2 = c2char === "=" ? 0 : alphabet.indexOf(c2char);
    var c3 = c3char === "=" ? 0 : alphabet.indexOf(c3char);
    if (c0 < 0 || c1 < 0 || (c2char !== "=" && c2 < 0) || (c3char !== "=" && c3 < 0)) {
      throw new Error("Invalid OneTouchTV base64 payload");
    }
    var triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    output.push((triple >>> 16) & 0xff);
    if (c2char !== "=") output.push((triple >>> 8) & 0xff);
    if (c3char !== "=") output.push(triple & 0xff);
  }
  return output;
}

function gfMul(a, b) {
  var x = a & 0xff;
  var y = b & 0xff;
  var result = 0;
  for (var i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    var hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>>= 1;
  }
  return result & 0xff;
}

// Reused inverse MixColumns products; no bitwise multiplication inside rounds.
var AES_INV_PRODUCTS = (function() {
  var tables = {}, factors = [9,11,13,14];
  factors.forEach(function(factor) {
    var table = new Array(256);
    for (var i=0;i<256;i++) table[i]=gfMul(i,factor);
    tables[factor]=table;
  });
  return tables;
})();
var cachedExpandedKey = null;
function rotWord(word) {
  return [word[1], word[2], word[3], word[0]];
}

function subWord(word) {
  return [AES_SBOX[word[0]], AES_SBOX[word[1]], AES_SBOX[word[2]], AES_SBOX[word[3]]];
}

function expandAes256Key(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error("OneTouchTV AES key must be 32 bytes");
  var words = new Array(60);
  var i;
  for (i = 0; i < 8; i++) {
    words[i] = [
      keyBytes[i * 4], keyBytes[i * 4 + 1], keyBytes[i * 4 + 2], keyBytes[i * 4 + 3]
    ];
  }
  for (i = 8; i < 60; i++) {
    var temp = words[i - 1].slice();
    if (i % 8 === 0) {
      temp = subWord(rotWord(temp));
      temp[0] ^= AES_RCON[i / 8];
    } else if (i % 8 === 4) {
      temp = subWord(temp);
    }
    words[i] = [
      words[i - 8][0] ^ temp[0],
      words[i - 8][1] ^ temp[1],
      words[i - 8][2] ^ temp[2],
      words[i - 8][3] ^ temp[3]
    ];
  }

  var expanded = new Array(240);
  for (i = 0; i < 60; i++) {
    expanded[i * 4] = words[i][0] & 0xff;
    expanded[i * 4 + 1] = words[i][1] & 0xff;
    expanded[i * 4 + 2] = words[i][2] & 0xff;
    expanded[i * 4 + 3] = words[i][3] & 0xff;
  }
  return expanded;
}

function addRoundKey(state, expandedKey, round) {
  var offset = round * 16;
  for (var i = 0; i < 16; i++) state[i] = (state[i] ^ expandedKey[offset + i]) & 0xff;
}

function invSubBytes(state) {
  var table = AES_INV_SBOX;
  for (var i = 0; i < 16; i++) state[i] = table[state[i]];
}

function invShiftRows(state) {
  var t=state[13];state[13]=state[9];state[9]=state[5];state[5]=state[1];state[1]=t;
  t=state[2];state[2]=state[10];state[10]=t;
  t=state[6];state[6]=state[14];state[14]=t;
  t=state[3];state[3]=state[7];state[7]=state[11];state[11]=state[15];state[15]=t;
}

function invMixColumns(state) {
  var m9=AES_INV_PRODUCTS[9],m11=AES_INV_PRODUCTS[11],m13=AES_INV_PRODUCTS[13],m14=AES_INV_PRODUCTS[14];
  for (var col = 0; col < 4; col++) {
    var i = col * 4;
    var a0 = state[i];
    var a1 = state[i + 1];
    var a2 = state[i + 2];
    var a3 = state[i + 3];
    state[i] = m14[a0] ^ m11[a1] ^ m13[a2] ^ m9[a3];
    state[i + 1] = m9[a0] ^ m14[a1] ^ m11[a2] ^ m13[a3];
    state[i + 2] = m13[a0] ^ m9[a1] ^ m14[a2] ^ m11[a3];
    state[i + 3] = m11[a0] ^ m13[a1] ^ m9[a2] ^ m14[a3];
  }
}

function decryptAesBlock(block, expandedKey) {
  var state = block.slice();
  addRoundKey(state, expandedKey, 14);
  for (var round = 13; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, expandedKey, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, expandedKey, 0);
  return state;
}

function utf8Decode(bytes) {
  var output = "";
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i++] & 0xff;
    if (b0 < 0x80) {
      output += String.fromCharCode(b0);
      continue;
    }
    if ((b0 & 0xe0) === 0xc0) {
      if (i >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b1 = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
      continue;
    }
    if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b2a = bytes[i++] & 0x3f;
      var b2b = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x0f) << 12) | (b2a << 6) | b2b);
      continue;
    }
    if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b3a = bytes[i++] & 0x3f;
      var b3b = bytes[i++] & 0x3f;
      var b3c = bytes[i++] & 0x3f;
      var codePoint = ((b0 & 0x07) << 18) | (b3a << 12) | (b3b << 6) | b3c;
      codePoint -= 0x10000;
      output += String.fromCharCode(0xd800 + (codePoint >>> 10), 0xdc00 + (codePoint & 0x3ff));
      continue;
    }
    throw new Error("Invalid UTF-8 payload");
  }
  return output;
}

function decryptString(encrypted) {
  var ciphertext = decodeBase64(encrypted);
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error("Encrypted OneTouchTV payload is not AES block aligned");
  }

  var expandedKey = cachedExpandedKey || (cachedExpandedKey = expandAes256Key(asciiBytes(AES_KEY_TEXT)));
  var iv = asciiBytes(AES_IV_TEXT);
  var plain = [];
  var previous = iv;
  for (var offset = 0; offset < ciphertext.length; offset += 16) {
    var cipherBlock = ciphertext.slice(offset, offset + 16);
    var decryptedBlock = decryptAesBlock(cipherBlock, expandedKey);
    for (var i = 0; i < 16; i++) plain.push((decryptedBlock[i] ^ previous[i]) & 0xff);
    previous = cipherBlock;
  }

  var padding = plain[plain.length - 1];
  if (padding < 1 || padding > 16 || padding > plain.length) throw new Error("Invalid OneTouchTV PKCS7 padding");
  for (var p = 0; p < padding; p++) {
    if (plain[plain.length - 1 - p] !== padding) throw new Error("Invalid OneTouchTV PKCS7 padding");
  }
  plain.length -= padding;

  var envelope = parseJsonLenient(utf8Decode(plain), "local decrypted response");
  if (envelope === null || envelope === undefined) {
    throw new Error("OneTouchTV decrypted payload is empty");
  }

  // Older OneTouchTV responses wrap the real JSON as a string in `result`.
  // Newer responses may expose `result` directly as an object/array, or may
  // already be the final JSON payload. Support all three shapes.
  if (typeof envelope === "object" && !Array.isArray(envelope) &&
      Object.prototype.hasOwnProperty.call(envelope, "result")) {
    if (typeof envelope.result === "string") return envelope.result;
    if (envelope.result === null || envelope.result === undefined) return "null";
    return JSON.stringify(envelope.result);
  }

  return JSON.stringify(envelope);
}



function sanitizeJsonControls(input) {
  var text = String(input == null ? "" : input).replace(/^\uFEFF/, "");
  var out = "";
  var inString = false;
  var escaped = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var code = text.charCodeAt(i);

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }

      if (code < 0x20) {
        out += "\\u" + ("000" + code.toString(16)).slice(-4);
        continue;
      }

      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      out += " ";
      continue;
    }

    out += ch;
  }

  return out;
}

function parseJsonLenient(input, label) {
  var text = String(input == null ? "" : input).trim();

  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(sanitizeJsonControls(text));
    } catch (secondError) {
      throw new Error(
        (label || "payload") + " JSON parse failed: " +
        (secondError && secondError.message ? secondError.message : String(secondError))
      );
    }
  }
}


function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(item, keys) {
  if (!item || typeof item !== "object") return null;
  for (var i = 0; i < keys.length; i++) {
    var value = item[keys[i]];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function itemId(item) {
  return firstValue(item, ["id", "vodId", "vod_id", "contentId", "content_id", "movieId", "movie_id"]);
}

function itemTitle(item) {
  return String(firstValue(item, [
    "title", "name", "vodName", "vod_name", "displayName", "display_name",
    "movieName", "movie_name", "dramaName", "drama_name", "originalTitle", "original_title"
  ]) || "");
}

function itemYear(item) {
  var raw = String(firstValue(item, [
    "year", "releaseDate", "release_date", "firstAirDate", "first_air_date",
    "publishDate", "publish_date", "date"
  ]) || "");
  var match = raw.match(/\d{4}/);
  return match ? match[0] : "";
}

function itemType(item) {
  return String(firstValue(item, [
    "type", "contentType", "content_type", "vodType", "vod_type", "category"
  ]) || "").toLowerCase();
}


function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(
    data &&
    (
      data.original_title ||
      data.original_name
    ),
    95
  );

  var altRoot =
    data &&
    data.alternative_titles || {};

  var altItems =
    altRoot &&
    (
      Array.isArray(altRoot.titles)
        ? altRoot.titles
        : Array.isArray(altRoot.results)
          ? altRoot.results
          : []
    );

  altItems.forEach(function(item) {
    if (!item) return;

    var country =
      String(
        item.iso_3166_1 || ""
      ).toUpperCase();

    var boost =
      country === "US" ||
      country === "GB"
        ? 86
        : country === "MY" ||
          country === "ID"
          ? 82
          : 72;

    add(
      item.title ||
      item.name,
      boost
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(
      data.translations.translations
    )
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    var row =
      item &&
      item.data &&
      typeof item.data === "object"
        ? item.data
        : {};

    var lang =
      String(
        item &&
        item.iso_639_1 ||
        ""
      ).toLowerCase();

    var boost =
      lang === "en"
        ? 88
        : lang === "ms" ||
          lang === "id"
          ? 80
          : 68;

    add(
      row.title ||
      row.name,
      boost
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 12);
}


function inferQuality(source) {
  var explicit = String(source && source.quality || source && source.name || "").trim();
  var value = (explicit + " " + String(source && source.url || "")).toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1 || value.indexOf("2k") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return explicit || "Auto";
}


function subtitleLanguage(name) {
  var value = String(name || "").trim();
  var lower = value.toLowerCase();
  var aliases = {
    en: ["english", "eng", "en"], ms: ["malay", "bahasa melayu", "malaysia", "msa", "may", "ms"], id: ["indonesian", "indonesia", "id"],
    ko: ["korean", "kor", "ko"], zh: ["chinese", "chi", "zh", "zho"], ja: ["japanese", "jpn", "ja"],
    th: ["thai", "tha", "th"], vi: ["vietnamese", "vie", "vi"], ar: ["arabic", "ara", "ar"],
    es: ["spanish", "spa", "es"], fr: ["french", "fra", "fr"], pt: ["portuguese", "por", "pt"]
  };
  var labels = { en: "English", ms: "Malay", id: "Indonesian", ko: "Korean", zh: "Chinese", ja: "Japanese", th: "Thai", vi: "Vietnamese", ar: "Arabic", es: "Spanish", fr: "French", pt: "Portuguese" };
  var keys = Object.keys(aliases);
  for (var i = 0; i < keys.length; i++) {
    var code = keys[i];
    if (aliases[code].some(function(alias) { return lower === alias || lower.indexOf(alias + " ") === 0 || lower.indexOf(alias + "-") === 0; })) {
      return { code: code, label: labels[code] };
    }
  }
  return { code: lower || "und", label: value || "Unknown" };
}


function normalizeHeaders(
  headers,
  fallbackReferer
) {
  var input =
    headers &&
    typeof headers === "object"
      ? headers
      : {};

  var output = {};

  Object.keys(input)
    .forEach(function(key) {
      var lower =
        String(key || "")
          .toLowerCase();

      if (
        lower === "host" ||
        lower === "connection" ||
        lower === "content-length" ||
        lower === "accept-encoding" ||
        lower === "range" ||
        lower.indexOf("sec-fetch-") === 0
      ) {
        return;
      }

      if (
        input[key] !== undefined &&
        input[key] !== null &&
        String(input[key]) !== ""
      ) {
        output[key] =
          String(input[key]);
      }
    });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  var referer =
    output["Referer"] ||
    output["referer"] ||
    fallbackReferer ||
    BASE_URL + "/";

  delete output["referer"];
  output["Referer"] = referer;

  return output;
}

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  var route = /\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(String(url));
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
    var contextId = raw.tmdbId || raw.tmdb && raw.tmdb.id;
    var contextType = raw.mediaType || raw.tmdb && raw.tmdb.media_type;
    if (!route || String(contextId) !== route[2] || (contextType && contextType !== route[1] && !(contextType === "series" && route[1] === "tv"))) return null;
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
module.exports = cloudbankDisplayInstall(module.exports, "OneTouchTV", "onetouchtv");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
