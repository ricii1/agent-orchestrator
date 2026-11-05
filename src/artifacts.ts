import { realpath, stat, readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { Task } from './types.js';
import { contains } from './workspace.js';

const MAX_BYTES=12*1024*1024, MAX_DIMENSION=12000, MAX_PIXELS=50_000_000;
const DOCUMENT_EXTENSIONS=new Set(['.md','.markdown','.txt','.text','.csv','.json','.yaml','.yml','.toml']);
const privateSegment=/^(?:\.data|\.git|\.env(?:\..*)?|.*(?:secret|credential|private.?key|\.key|\.pem|\.log).*)$/i;
function safePath(path:string){
  if(!path||path.length>4096||path.includes('\0')||path.includes('\\'))throw new Error('Invalid preview path');
  const segments=path.split(/[\/]+/);
  if(segments.some(s=>s==='..'||privateSegment.test(s)))throw new Error('Preview path is private or forbidden');
}
function imageType(b:Buffer):{mime:string;width:number;height:number}|null{
  if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    let i=12;while(i+8<=b.length){const type=b.toString('ascii',i,i+4),n=b.readUInt32LE(i+4);if(type==='VP8X'&&i+18<=b.length)return {mime:'image/webp',width:1+b.readUIntLE(i+12,3),height:1+b.readUIntLE(i+15,3)};if(type==='VP8L'&&i+13<=b.length){const x=b[i+9],y=b[i+10],z=b[i+11],w=b[i+12];return {mime:'image/webp',width:1+(((y&0x3f)<<8)|x),height:1+(((w&0xf)<<10)|(z<<2)|((y&0xc0)>>6))};}if(type==='VP8 '&&i+30<=b.length)return {mime:'image/webp',width:b.readUInt16LE(i+26)&0x3fff,height:b.readUInt16LE(i+28)&0x3fff};i+=8+n+(n&1);}
  }
  if(b.length>=10&&b.toString('ascii',0,3)==='GIF')return {mime:'image/gif',width:b.readUInt16LE(6),height:b.readUInt16LE(8)};
  if(b.length>=4&&b[0]===0xff&&b[1]===0xd8){let i=2;while(i+4<=b.length){if(b[i++]!==0xff)continue;const marker=b[i++];if(marker===0xd9||marker===0xda)break;const n=b.readUInt16BE(i);if(n<2||i+n>b.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&n>=7)return {mime:'image/jpeg',width:b.readUInt16BE(i+5),height:b.readUInt16BE(i+3)};i+=n;}}
  return null;
}
export async function readPreview(path:string,workspace:string,roots:string[],tasks:Task[]){
  const file=await resolveArtifact(path,workspace,roots,tasks,'preview'),type=imageType(file.bytes);
  if(!type)throw new Error('Preview supports PNG, JPEG, WebP, and GIF images only');
  if(!type.width||!type.height||type.width>MAX_DIMENSION||type.height>MAX_DIMENSION||type.width*type.height>MAX_PIXELS)throw new Error('Preview image dimensions are too large');
  return {bytes:file.bytes,mime:type.mime};
}

async function resolveArtifact(path:string,workspace:string,roots:string[],tasks:Task[],kind:'preview'|'file'='file'){
  safePath(path);
  const canonicalRoots=(await Promise.all(roots.map(async p=>{try{return await realpath(p);}catch{return null;}}))).filter((p):p is string=>!!p);
  const base=await realpath(workspace).catch(()=>{throw new Error('Workspace not found');});
  if(!canonicalRoots.includes(base))throw new Error('Workspace is not registered');
  const taskPaths=await Promise.all(tasks.map(async task=>{try{const taskWorkspace=await realpath(task.workspace);if(!canonicalRoots.some(root=>contains(root,taskWorkspace))||!contains(base,taskWorkspace)||!task.executionPath)return null;const executionPath=await realpath(task.executionPath);return contains(base,executionPath)?executionPath:null;}catch{return null;}}));
  const permitted=[base,...taskPaths.filter((p):p is string=>!!p)],candidate=isAbsolute(path)?path:join(base,path);
  const actual=await realpath(candidate).catch(()=>{throw new Error(kind==='preview'?'Preview file not found':'File not found');});
  const boundary=(isAbsolute(path)?permitted:[base]).find(root=>contains(root,actual));
  if(!boundary)throw new Error(kind==='preview'?'Preview file is outside this workspace':'File is outside this workspace');
  safePath(relative(boundary,actual));
  const info=await stat(actual);if(!info.isFile()||info.size>MAX_BYTES)throw new Error(kind==='preview'?'Preview image is too large or unavailable':'File is too large or unavailable');
  return {actual,bytes:await readFile(actual)};
}

export async function readDocument(path:string,workspace:string,roots:string[],tasks:Task[]){
  const file=await resolveArtifact(path,workspace,roots,tasks);
  if(!DOCUMENT_EXTENSIONS.has(extname(file.actual).toLowerCase()))throw new Error('Only Markdown and plain text documents can be opened');
  if(file.bytes.includes(0))throw new Error('Binary files cannot be opened as documents');
  return {path:file.actual,text:file.bytes.toString('utf8')};
}
export function isTextDocument(path:string){return DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase());}

export async function openLocalDocument(path:string,workspace:string,roots:string[],tasks:Task[],launch:(argv:string[])=>Promise<void>=launchDocument){
  const file=await resolveArtifact(path,workspace,roots,tasks);
  if(!DOCUMENT_EXTENSIONS.has(extname(file.actual).toLowerCase())||file.bytes.includes(0))throw new Error('Only Markdown and plain text documents can be opened');
  await launch(process.platform==='linux'?['xdg-open',file.actual]:process.platform==='darwin'?['open',file.actual]:['gio','open',file.actual]);
  return {opened:true,path:file.actual};
}

export async function launchDocument(argv:string[],timeoutMs=5000){
  const {spawn}=await import('node:child_process');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{shell:false,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Local document opener timed out'));},timeoutMs);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`Local document opener failed${signal?` (${signal})`:` with exit code ${code}`}`));});
  });
}
