"use strict";

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


var cheerio = require('cheerio-without-node-native');
var CryptoJS = require('crypto-js');
var BASE = 'https://kshow123.tv';
var TMDB = 'https://api.themoviedb.org/3';
var KEY = '439c478a771f35c05022f9feabcca01c';
function log(stage, detail) {
  console.log('[KShow123] ' + stage + ': ' + detail);
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9\uac00-\ud7af]+/g, ' ').trim();
}
function slug(s) { return norm(s).replace(/ /g, '-'); }
function absolute(s, base) { try { return new URL(s, base || BASE).href; } catch (_) { return ''; } }
function variable(html, name) {
  var m = html.match(new RegExp('var\\s+' + name + '\\s*=\\s*([\'"])(.*?)\\1', 's'));
  return m ? m[2] : '';
}
function decode(s) {
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  try { return CryptoJS.AES.decrypt(s, 'kshow123.tv45904818778080').toString(CryptoJS.enc.Utf8); } catch (_) { return ''; }
}
async function request(url, options, state) {
  var left = state.deadline - Date.now();
  if (left < 250) throw new Error('Runtime budget exhausted');
  var timer;
  try {
    return await Promise.race([
      fetch(url, options || {}).then(async function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' at ' + new URL(url).hostname);
        return await r.text();
      }),
      new Promise(function(_, reject) { timer = setTimeout(function() { reject(new Error('Request timeout')); }, Math.min(left, 6000)); })
    ]);
  } finally { clearTimeout(timer); }
}
async function json(url, state) { return JSON.parse(await request(url, {}, state)); }
function pageTitle(html) {
  var $ = cheerio.load(html);
  return $('.media-heading a').first().text().trim() || $('h1').first().text().trim();
}
function airDate(html) {
  var $ = cheerio.load(html), found = '';
  $('.media-info').each(function(_, el) {
    var t = $(el).text();
    if (/Air on\s*:/i.test(t)) {
      var d = Date.parse(t.replace(/^.*?Air on\s*:/i, '').trim() + ' UTC');
      if (!isNaN(d)) found = new Date(d).toISOString().slice(0, 10);
    }
  });
  return found;
}
function datesMatch(a, b) {
  return a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 86400000;
}
async function extract(html, page, title, season, episode, state) {
  var list;
  try { list = JSON.parse(variable(html, 'videoList')); } catch (_) { log('EXTRACT', 'Missing or invalid videoList'); return []; }
  var labels = [], $ = cheerio.load(html);
  $('#server_list .server_item').each(function(_, el) {
    var label = $(el).find('strong').text().replace(/:\s*$/, '').trim();
    $(el).find('a[video-id]').each(function(_, a) { labels[Number($(a).attr('video-id'))] = label; });
  });
  var streams = [], seen = {};
  for (var i = 0; i < Math.min(list.length, 4); i++) {
    if (Date.now() > state.deadline - 500) break;
    try {
      var v = list[i];
      if (!Array.isArray(v) || !v[0]) continue;
      var fields = {streamUrlHash:v[0], imageCover:variable(html,'imageCover'), eToken:variable(html,'eToken')};
      if (v[1]) fields.subtitlesUrlHash = v[1];
      var body = Object.keys(fields).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]); }).join('&');
      var response = await request('https://api.kshow123.tv/ajax/', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8', Referer:page, Origin:BASE}, body:body}, state);
      // Only inspect media fields; never execute scripts received from the site.
      var tracks = [], tm;
      var trackRe = /\{\s*file\s*:\s*decodeLink\(\s*["']([^"']+)["']\s*,\s*8080\s*\)\s*,\s*label\s*:\s*["']([^"']+)["']\s*,\s*kind\s*:\s*["'](?:captions|subtitles)["']/g;
      while ((tm = trackRe.exec(response))) {
        var sub = decode(tm[1]);
        // The player inserts intro.vtt even when an episode is hardsubbed.
        if (/^https?:\/\//.test(sub) && !/\/intro\.(vtt|srt)(?:[?#]|$)/i.test(sub)) tracks.push({id:'kshow123-'+tracks.length, url:sub, lang:/english/i.test(tm[2])?'en':tm[2], label:tm[2]});
      }
      var re = /file\s*:\s*decodeLink\(\s*["']([^"']+)["']\s*,\s*8080\s*\)\s*,\s*type\s*:\s*["'](hls|mp4)["']/g, m;
      while ((m = re.exec(response))) {
        var url = decode(m[1]);
        if (!/^https?:\/\//.test(url) || seen[url]) continue;
        seen[url] = true;
        streams.push({name:'KShow123 • '+(labels[i] || 'Server '+(i+1)), title:title+' • S'+season+' E'+episode, url:url, type:m[2]==='hls'?'m3u8':'mp4', quality:'auto', headers:{Referer:page, Origin:BASE}, subtitles:tracks});
      }
      log('SERVER', (labels[i] || String(i+1)) + ': '+streams.length+' source(s); '+tracks.length+' external subtitle(s)');
    } catch (e) { log('SERVER_ERROR', e.message); }
  }
  return streams;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  var state = {deadline:Date.now()+18500};
  if (mediaType !== 'tv' || !Number.isInteger(Number(season)) || !Number.isInteger(Number(episode)) || Number(season)<1 || Number(episode)<1) return [];
  season=Number(season); episode=Number(episode);
  try {
    var metadataUrl = TMDB+'/tv/'+encodeURIComponent(tmdbId)+'?api_key='+KEY+'&append_to_response=alternative_titles';
    var pair = await Promise.all([
      vueoSharedTmdb(metadataUrl, function() { return json(metadataUrl,state); }),
      json(TMDB+'/tv/'+encodeURIComponent(tmdbId)+'/season/'+season+'/episode/'+episode+'?api_key='+KEY,state)
    ]);
    var meta = pair[0], ep = pair[1], profile = buildTitleProfile(meta);
    if (!ep || !ep.air_date) { log('MAPPING','No verified TMDB episode air date'); return []; }
    var aliases = profile.aliases, candidates = [];
    var english = aliases.filter(function(a) { return /[a-z]/i.test(a); }).slice(0,2);
    if (!english.length) english=aliases.slice(0,1);
    // Search is site-native; matching stays exact against TMDB aliases.
    for (var q=0; q<english.length; q++) {
      var query=english[q];
      var search=await request(BASE+'/search/'+slug(query)+'/',{},state);
      var $=cheerio.load(search);
      $('.thumbnail[href*="/show/"]').each(function(_,el) {
        var href=absolute($(el).attr('href'));
        var name=$(el).closest('.col-md-3, .col-sm-3, .col-xs-6').find('h2 a').text().trim();
        if (!name) name=$(el).find('img').attr('alt') || '';
        var rootName=name.replace(/\s*[:\-]?\s*season\s+\d+\s*$/i,'').trim();
        var explicit=name.match(/season\s+(\d+)\s*$/i);
        var matched=aliases.some(function(a) { return norm(a)===norm(name) || (explicit && norm(a)===norm(rootName)); });
        if (matched && (!explicit || Number(explicit[1])===season) && !candidates.some(function(c){return c.url===href;})) candidates.push({url:href,title:name,explicit:!!explicit});
      });
      if (candidates.length) break;
    }
    if (!candidates.length) { log('MATCH','No exact title/season candidate'); return []; }
    for (var c=0;c<Math.min(candidates.length,2);c++) {
      var candidate=candidates[c];
      var numbers=[episode];
      if (season>1 && !candidate.explicit) {
        // Continuous variety-show numbering: sum known preceding regular seasons.
        var full=Array.isArray(meta.seasons)?meta:await json(metadataUrl,state);
        var previous=(full.seasons||[]).filter(function(s){return s.season_number>0 && s.season_number<season;});
        if (previous.length===season-1 && previous.every(function(s){return s.episode_count>0;})) {
          var absoluteEpisode=previous.reduce(function(n,s){return n+s.episode_count;},episode);
          if (absoluteEpisode!==episode) numbers.unshift(absoluteEpisode);
        }
      }
      for (var n=0;n<numbers.length;n++) {
        var page=candidate.url.replace(/\/$/,'')+'/episode-'+numbers[n]+'.html';
        var html;
        try { html=await request(page,{},state); } catch(e) { log('EPISODE_FETCH',e.message); continue; }
        var canonical=cheerio.load(html)('link[rel="canonical"]').attr('href');
        if (canonical && absolute(canonical)!==page) { log('MAPPING','Unexpected episode redirect'); continue; }
        var actualDate=airDate(html);
        if (!datesMatch(actualDate,ep.air_date)) { log('MAPPING','Rejected site episode '+numbers[n]+': air date '+(actualDate||'missing')+' differs from TMDB '+ep.air_date); continue; }
        var epTitle=cheerio.load(html)('title').text();
        var match=epTitle.match(/^(.*?)\s+Episode\s+(\d+)/i);
        if (!match || norm(match[1])!==norm(candidate.title) || Number(match[2])!==numbers[n]) { log('MAPPING','Episode title/number mismatch'); continue; }
        log('MATCH',candidate.title+'; TMDB S'+season+' E'+episode+' → site episode '+numbers[n]+'; air-date verified '+actualDate);
        var result=await extract(html,page,profile.title,season,episode,state);
        log('RESULT',result.length+' source(s); playback requires player verification');
        return result;
      }
    }
  } catch(e) { log('ERROR',e.message); }
  return [];
}
module.exports = {getStreams:getStreams};
