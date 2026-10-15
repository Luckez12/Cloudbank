import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,createCipheriv} from 'node:crypto';
const require=createRequire(import.meta.url), logs=[], requested=[];
const sandbox={module:{exports:{}},URL,Promise,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},require:name=>{requested.push(name);if(name!=='cheerio-without-node-native')throw Error('Host crypto forbidden');return require(name);}};
vm.runInNewContext(fs.readFileSync('providers/kshow123.js','utf8'),sandbox);
function encryptNative(plaintext){const salt=Buffer.from('0011223344556677','hex'),pass=Buffer.from('kshow123.tv45904818778080');let blocks=[],prev=Buffer.alloc(0);while(Buffer.concat(blocks).length<48){prev=createHash('md5').update(Buffer.concat([prev,pass,salt])).digest();blocks.push(prev);}const all=Buffer.concat(blocks),c=createCipheriv('aes-256-cbc',all.subarray(0,32),all.subarray(32,48));return Buffer.concat([Buffer.from('Salted__'),salt,c.update(plaintext,'utf8'),c.final()]).toString('base64');}
const url='https://media.example/master.m3u8?token=PRIVATE';const enc=encryptNative(url);
assert.equal(sandbox.decode(enc,'test'),url);
assert.ok(!requested.includes('crypto-js'));
let p=sandbox.parsePlayerResponse('{"type":"hls","file":decodeLink("'+enc+'",8080)}','test');assert.equal(p.files.length,1);
p=sandbox.parsePlayerResponse('setup({file:decodeLink("'+enc+'",8080),tracks:[{kind:"captions",label:"English",file:"https://subs.example/real.vtt"}],type:"hls"})','test');assert.equal(p.files.length,1);assert.equal(p.tracks.length,1);
assert.equal(sandbox.decode('U2FsdGVkX1invalid','bad'),'');assert.ok(logs.some(s=>s.includes('DECRYPT_ERROR')));
p=sandbox.parsePlayerResponse('<iframe src="https://embed.example/v/1"></iframe>','iframe');assert.equal(p.files.length,0);assert.ok(logs.some(s=>s.includes('iframe=yes')));
assert.ok(!logs.some(s=>s.includes('PRIVATE')||s.includes(enc)));
console.log('PASS: host crypto forbidden; independent Node/OpenSSL MD5+AES-256-CBC vector; reordered/quoted fields; track separation; malformed ciphertext; iframe classification; token-free logs.');
