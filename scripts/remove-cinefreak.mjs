import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(manifest.scrapers))throw Error('manifest.scrapers missing');
// Both removals were explicitly requested by the user in this conversation.
const removedIds=new Set(['cinefreak','allmovieland']);
const matches=id=>[...removedIds].some(base=>id===base||id.startsWith(base+'-'));
const before=manifest.scrapers.length;
manifest.scrapers=manifest.scrapers.filter(p=>!matches(String(p.id)));
if(before!==manifest.scrapers.length){
 const parts=manifest.version.split('.').map(Number);parts[2]++;manifest.version=parts.join('.');
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
const providers=path.join(root,'providers');
for(const name of fs.readdirSync(providers)){
 if(/^(?:cinefreak|allmovieland)(?:-.*)?\.js$/.test(name))fs.rmSync(path.join(providers,name));
}
console.log('Removed CineFreak and previously requested AllMovieLand. Other providers preserved.');
