import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PixelOffice,type OfficeAgent} from '../web/office.ts';
test('pixel office handles all configured seats, reduced motion, departure, and keyboard-equivalent selection labels',()=>{
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const oldMedia=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');
 const labels=new Map();
 const canvas={width:0,height:0,className:'',onclick:null,setAttribute:(key:string,value:string)=>labels.set(key,value),getContext:()=>({fillRect(){},fillText(){}})};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas,addEventListener(){},hidden:true}});
 Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:true,addEventListener(){}})});
 try{
  const office=new PixelOffice(()=>{}),pm:OfficeAgent={id:'pm',name:'PM',provider:'codex',status:'idle',pm:true};
  const workers=Array.from({length:10},(_,i)=>({id:String(i),name:'Freelancer '+i,provider:'claude',status:'running'}));
  office.update([pm,...workers]);assert.equal(office.actors.size,11);assert.ok(canvas.height>=628);assert.match(labels.get('aria-label'),/Freelancer 9/);
  office.update([pm]);assert.equal(office.actors.size,1);assert.equal(canvas.height,420);assert.ok(!labels.get('aria-label').includes('Freelancer 9'));
 }finally{
  if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete (globalThis as any).document;
  if(oldMedia)Object.defineProperty(globalThis,'matchMedia',oldMedia);else delete (globalThis as any).matchMedia;
 }
});
