export interface OfficeAgent {id:string;name:string;provider:string;status:string;pm?:boolean;}
interface Actor {agent:OfficeAgent;seat:number;x:number;y:number;tx:number;ty:number;leaving:boolean;}
const W=720,H=420;
const colors=['#557dcb','#bd7650','#7c7ea3','#6b947e','#bc7d9c','#9a8849'];
const seatPosition=(seat:number)=>({x:170+(seat%3)*178,y:180+Math.floor(seat/3)*104});
export class PixelOffice {
  canvas=document.createElement('canvas');
  actors=new Map<string,Actor>();
  frame=0;last=0;disposed=false;reduced=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(public select:(id:string)=>void) {
    this.canvas.width=W;this.canvas.height=H;this.canvas.className='office-canvas';
    this.canvas.setAttribute('role','img');
    this.canvas.onclick=event=>{
      const rect=this.canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*W/rect.width,y=(event.clientY-rect.top)*this.canvas.height/rect.height;
      for(const a of this.actors.values())if(!a.leaving&&Math.abs(x-a.x)<62&&Math.abs(y-a.y)<45){this.select(a.agent.id);return;}
    };
    document.addEventListener('visibilitychange',this.visibility);
    this.reduced.addEventListener('change',this.visibility);
    this.draw(0);
  }
  visibility=()=>{if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0;}else this.wake();};
  update(agents:OfficeAgent[]) {
    const ids=new Set(agents.map(a=>a.id));
    for(const actor of this.actors.values())if(!ids.has(actor.agent.id)){actor.leaving=true;actor.tx=675;actor.ty=this.canvas.height-66;}
    for(const agent of agents){
      const old=this.actors.get(agent.id);
      if(old){old.agent=agent;old.leaving=false;const p=agent.pm?{x:360,y:88}:seatPosition(old.seat);old.tx=p.x;old.ty=p.y;continue;}
      const used=new Set([...this.actors.values()].filter(a=>!a.agent.pm&&!a.leaving).map(a=>a.seat));
      let seat=0;while(used.has(seat))seat++;
      const position=agent.pm?{x:360,y:88}:seatPosition(seat);
      this.actors.set(agent.id,{agent,seat,x:agent.pm?position.x:675,y:agent.pm?position.y:this.canvas.height-66,tx:position.x,ty:position.y,leaving:false});
    }
    this.canvas.setAttribute('aria-label','Kantor pixel: '+agents.map(a=>`${a.name}, ${a.provider}, ${a.status}`).join('; ')+'. Pilih orang melalui daftar di bawah kantor.');
    this.draw(performance.now());this.wake();
  }
  wake(){if(!this.frame&&!document.hidden&&!this.disposed)this.frame=requestAnimationFrame(this.tick);}
  tick=(now:number)=>{
    this.frame=0;
    if(now-this.last>=100){this.draw(now);this.last=now;}
    const moving=[...this.actors.values()].some(a=>a.x!==a.tx||a.y!==a.ty||a.agent.status==='running');
    if(moving&&!this.reduced.matches)this.wake();
  };
  draw(now:number){
    const seats=Math.max(3,...[...this.actors.values()].filter(a=>!a.agent.pm).map(a=>a.seat+1));
    const height=H+Math.max(0,Math.ceil(seats/3)-2)*104;
    if(this.canvas.height!==height)this.canvas.height=height;
    const ctx=this.canvas.getContext('2d');if(!ctx)return;
    ctx.imageSmoothingEnabled=false;
    const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
    const text=(value:string,x:number,y:number,color='#5e584e',size=10)=>{ctx.fillStyle=color;ctx.font=`${size}px monospace`;ctx.textAlign='center';ctx.fillText(value,x,y);};
    rect(0,0,W,height,'#e7e2d7');rect(28,20,664,height-62,'#d3c4a7');
    for(let y=20;y<height-42;y+=24){rect(28,y,664,1,'#bfaf92');for(let x=28+(y%48?40:0);x<692;x+=80)rect(x,y,1,24,'#bfaf92');}
    rect(28,20,664,57,'#ebe4d6');rect(28,73,664,5,'#8d806d');rect(28,78,664,3,'#a4947d');
    rect(25,18,3,height-60,'#887b68');rect(692,18,3,height-60,'#887b68');rect(25,height-42,670,6,'#887b68');
    // Window, shelves, noticeboard and doorway are original code-drawn pixel furniture.
    rect(80,29,116,39,'#8b806d');rect(84,32,108,31,'#9db8b0');rect(90,36,96,23,'#c4d7cd');rect(136,32,4,31,'#8b806d');rect(84,46,108,3,'#8b806d');
    rect(528,32,112,33,'#c0ad86');rect(531,35,106,27,'#d4be90');rect(540,40,22,15,'#f7efd6');rect(570,39,24,18,'#e5e9e1');rect(605,42,21,12,'#efcfad');
    rect(660,height-102,32,60,'#6c675b');rect(663,height-99,26,57,'#a89b80');rect(666,height-95,20,40,'#817966');rect(668,height-69,3,3,'#e1c58d');
    const plant=(x:number,y:number)=>{rect(x+6,y+18,14,15,'#9d775a');rect(x+3,y+15,20,5,'#b28b66');rect(x+9,y,8,22,'#64846a');rect(x,y+6,12,10,'#77977a');rect(x+16,y+4,11,12,'#54745b');};
    plant(44,91);plant(641,89);plant(48,height-91);
    rect(74,height-120,65,22,'#7c715e');rect(77,height-118,59,17,'#c1c3ac');rect(77,height-98,5,8,'#7c715e');rect(129,height-98,5,8,'#7c715e');
    rect(279,height-78,166,29,'#b7b29d');for(let x=283;x<442;x+=8)rect(x,height-75,4,23,'#c6c0aa');
    text('KANTOR FREELANCER',360,44,'#766d5f',10);
    const desk=(x:number,y:number,occupied:boolean,pm=false)=>{
      rect(x-49,y+10,100,35,'#b28b60');rect(x-49,y+10,100,4,'#d1ae7c');rect(x-49,y+43,100,5,'#896c4b');rect(x-43,y+48,6,13,'#896c4b');rect(x+38,y+48,6,13,'#896c4b');
      rect(x+10,y+1,29,22,'#535d5c');rect(x+13,y+4,23,15,occupied?'#c0d0c2':'#768380');rect(x+22,y+23,5,7,'#535d5c');rect(x+15,y+29,20,3,'#7a8078');
      rect(x-34,y+22,18,12,'#eee5cf');rect(x-32,y+25,13,1,'#c7b99e');rect(x-32,y+28,9,1,'#c7b99e');rect(x-4,y+28,7,8,'#ede0c2');rect(x+3,y+30,3,4,'#ede0c2');
      if(!occupied)text(pm?'PM':'tersedia',x,y+73,'#8b806e',9);
    };
    desk(360,88,true,true);
    const workerCount=[...this.actors.values()].filter(a=>!a.agent.pm&&!a.leaving).length;
    const visibleSeats=seats;
    for(let i=0;i<visibleSeats;i++){const p=seatPosition(i);desk(p.x,p.y,[...this.actors.values()].some(a=>!a.leaving&&a.seat===i&&!a.agent.pm));}
    let departed=false;
    for(const [id,a] of this.actors){
      if(this.reduced.matches){a.x=a.tx;a.y=a.ty;}else{
        const dx=a.tx-a.x,dy=a.ty-a.y,distance=Math.hypot(dx,dy),speed=15;
        if(distance<=speed){a.x=a.tx;a.y=a.ty;}else{a.x+=dx/distance*speed;a.y+=dy/distance*speed;}
      }
      if(a.leaving&&a.x===a.tx&&a.y===a.ty){this.actors.delete(id);departed=true;continue;}
      const walking=a.x!==a.tx||a.y!==a.ty,step=!this.reduced.matches&&(walking||a.agent.status==='running')?Math.floor(now/240)%2:0;
      const x=Math.round(a.x-18),y=Math.round(a.y-18),color=a.agent.pm?'#5d786e':colors[a.seat%colors.length];
      rect(x-3,y+38,37,4,'#b5a58d');rect(x+1,y+3,27,12,'#514c43');rect(x+4,y+12,21,15,'#dbb38c');rect(x+3,y+9,6,12,'#514c43');rect(x+19,y+9,9,6,'#514c43');
      rect(x+10,y+17,3,3,'#514c43');rect(x+21,y+17,3,3,'#514c43');rect(x+1,y+27,30,15,color);rect(x-2,y+29+step*2,5,12,'#dbb38c');rect(x+29,y+29-step*2,5,12,'#dbb38c');
      rect(x+4,y+42,9,6-step*2,'#545b61');rect(x+19,y+42,9,4+step*2,'#545b61');
      if(a.agent.status==='waiting'){rect(x+26,y-10,15,16,'#faf2df');text('!',x+34,y+2,'#a86b37',12);}
      if(!walking&&!a.leaving){text(a.agent.name.slice(0,20),a.x,a.y+69,'#4c514c',10);text(a.agent.provider,a.x,a.y+82,'#8b806e',8);}
    }
    if(!workerCount)text('Freelancer datang saat ada pekerjaan.',360,289,'#817966',10);
    if(departed)this.draw(now);
  }
}
