const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),C=require('crypto-js');
const current=fs.readFileSync(require('path').join(__dirname,'../providers/onetouchtv.js'),'utf8');
function box(src){const b={module:{exports:{}},URL,URLSearchParams,Promise,setTimeout,clearTimeout,AbortController,console:{log(){},error(){}},fetch(){throw Error('No network allowed');}};vm.createContext(b);vm.runInContext(src,b);return b;}
function encrypted(data){return C.AES.encrypt(JSON.stringify({result:JSON.stringify(data)}),C.enc.Utf8.parse('im72charPasswordofdInitVectorStm'),{iv:C.enc.Utf8.parse('im72charPassword'),mode:C.mode.CBC,padding:C.pad.Pkcs7}).ciphertext.toString(C.enc.Base64).replace(/\//g,'-_.').replace(/\+/g,'@');}
const b=box(current);let checks=0;
for(const size of [1,16,31,256,8192]){const data={title:'한국어 Melayu 😀',text:'abc'.repeat(size)};b.input=encrypted(data);assert.deepEqual(JSON.parse(vm.runInContext('decryptString(input)',b)),data);checks++;}
const data={id:'example',title:'Long series',episodes:Array.from({length:825},(_,i)=>({episode:i+1,identifier:'example',playId:'episode'+i,title:'Episode '+i,description:'Some multilingual detail — 안녕하세요 😀 '.repeat(3)}))};
b.input=encrypted(data);let start=performance.now();let result=JSON.parse(vm.runInContext('decryptString(input)',b));let elapsed=performance.now()-start;assert.deepEqual(result,data);checks++;
console.log('AES equivalence checks passed:',checks,'; synthetic 825-episode payload chars=',b.input.length,'decodeMs=',elapsed.toFixed(1));
if(process.argv[2]){const old=box(fs.readFileSync(process.argv[2],'utf8'));old.input=b.input;start=performance.now();const before=JSON.parse(vm.runInContext('decryptString(input)',old));const oldElapsed=performance.now()-start;assert.deepEqual(before,result);console.log('Baseline decodeMs=',oldElapsed.toFixed(1),'ratio=',(oldElapsed/elapsed).toFixed(2));}
