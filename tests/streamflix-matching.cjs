const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync('providers/streamflix.js','utf8').split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
const ctx = {require:()=>({}), console, module:{exports:{}}, fetch:()=>{throw Error('Unexpected HTTP');}, setTimeout, clearTimeout};
vm.createContext(ctx); vm.runInContext(src,ctx);
async function search(rows,title='Masterplan',year='2026',type='movie',id='1561726',meta={}) {
 ctx.rows=rows;vm.runInContext('cache.data = {data:rows}; cache.dataTimestamp=Date.now()',ctx);
 return ctx.searchContent(title,year,type,id,meta);
}
(async()=>{
 assert.equal((await search([{tmdb:'1561726',isTV:false,moviename:'Alternate local title'}])).length,1);
 assert.equal((await search([{tmdb:'1561726',isTV:true,moviename:'Masterplan'}])).length,0);
 assert.equal((await search([{tmdb:'123',isTV:false,moviename:'Masterplan',movieyear:'2026'}])).length,0);
 assert.equal((await search([{isTV:false,moviename:'Masterplan',movieyear:'2025'}])).length,0);
 assert.equal((await search([{isTV:false,moviename:'The Master Plan',movieyear:'2026'}])).length,0);
 assert.equal((await search([{isTV:false,moviename:'MASTER-PLAN',movieyear:'2026'}],'Master Plan')).length,1);
 const row={isTV:false,moviename:'Masterplan',movieyear:'2026'};
 assert.equal((await search([row,row])).length,0);
 assert.equal((await search([{isTV:false,moviename:'Pelan',movieyear:'2026'}],undefined,undefined,undefined,undefined,{original_title:'Pelan'})).length,1);
 console.log('PASS: 8 identity regression cases');
})().catch(e=>{console.error(e);process.exitCode=1});
