// Explicit user-requested retirement only; never consume arbitrary deletion paths.
const fs=require('node:fs'),path=require('node:path');
const IDS=['streamflix','fibwatch','onlykdrama','yflix'];
function retire(root){
 const manifestPath=path.join(root,'manifest.json'),dir=path.join(root,'providers');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(manifest.name!=='Cloudbank'||!Array.isArray(manifest.scrapers))throw Error('Run from the Cloudbank repository root');
 if(fs.existsSync(dir)&&fs.realpathSync(dir)!==path.resolve(dir))throw Error('Refusing a linked providers directory');
 const files=IDS.map(id=>path.join(dir,id+'.js'));
 files.forEach(file=>{if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw Error('Expected provider file: '+path.basename(file));});
 const kept=manifest.scrapers.filter(x=>!IDS.includes(x.id));
 if(kept.length!==manifest.scrapers.length){manifest.scrapers=kept;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
 let removed=0;files.forEach(file=>{if(fs.existsSync(file)){fs.unlinkSync(file);removed++;}});
 return removed;
}
if(require.main===module){try{console.log('Retired provider files: '+retire(process.cwd()));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={retire};
