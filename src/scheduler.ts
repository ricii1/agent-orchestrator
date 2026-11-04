import { randomUUID } from 'node:crypto';
import type { Schedule } from './types.js';
import { active } from './types.js';
import { Engine } from './engine.js';
// Deliberately supports standard numeric five-field cron, without macros or seconds.
function field(source: string, min: number, max: number): Set<number> {
  const result=new Set<number>();
  for(const item of source.split(',')) {
    const match=/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
    if(!match) throw new Error('Use numeric five-field cron: *, lists, ranges, and steps');
    const step=match[2] ? Number(match[2]):1;
    const [start,end] = match[1]==='*' ? [min,max] : match[1].includes('-') ? match[1].split('-').map(Number) : [Number(match[1]),match[2] ? max:Number(match[1])];
    if(step<1 || step>max+1 || start<min || end>max || start>end) throw new Error('Cron value is out of range');
    for(let n=start;n<=end;n+=step) result.add(n);
  }
  return result;
}
export function compileCron(cron: string, timezone: string) {
  const parts=cron.trim().split(/\s+/);
  if(parts.length!==5) throw new Error('Cron must have five fields: minute hour day month weekday');
  const fields=parts.map((p,i)=>field(p,[0,0,1,1,0][i],[59,23,31,12,7][i]));
  if(fields[4].has(7)) fields[4].add(0);
  const formatter=new Intl.DateTimeFormat('en-US',{ timeZone:timezone, year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',weekday:'short',hourCycle:'h23' });
  return (date: Date) => {
    const values=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));
    const weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(values.weekday);
    const dom=fields[2].has(Number(values.day)), dow=fields[4].has(weekday);
    const day=parts[2].startsWith('*') || parts[4].startsWith('*') ? dom && dow : dom || dow;
    return fields[0].has(Number(values.minute)) && fields[1].has(Number(values.hour)) && day && fields[3].has(Number(values.month));
  };
}
export class Scheduler {
  minute=Math.floor(Date.now()/60000); timer?: NodeJS.Timeout;
  constructor(public engine: Engine) {}
  start() { this.timer=setInterval(()=>void this.tick().catch(e=>this.engine.event(null,'scheduler_error',{error:String(e)})),1000); this.timer.unref(); }
  stop() { clearInterval(this.timer); }
  async tick(now=new Date()) {
    const minute=Math.floor(now.getTime()/60000);
    if(minute===this.minute) return;
    this.minute=minute;
    for(const schedule of this.engine.store.all<Schedule>('schedules')) {
      if(!schedule.enabled || !compileCron(schedule.cron,schedule.timezone)(now)) continue;
      if(schedule.lastRun && Math.floor(new Date(schedule.lastRun).getTime()/60000)===minute) continue;
      const previous=this.engine.store.tasks().filter(t=>t.scheduleId===schedule.id);
      // Interrupted runs may have changed files: require review before the next run.
      if(previous.some(t=>active(t.status) || t.status==='interrupted')) continue;
      schedule.lastRun=now.toISOString(); this.engine.store.saveSchedule(schedule);
      try { await this.engine.create({ prompt:schedule.prompt,title:schedule.title,workspace:schedule.workspace,provider:schedule.provider,model:schedule.model,scheduleId:schedule.id }); }
      catch(e) { this.engine.event(null,'schedule_failed',{scheduleId:schedule.id,error:String(e)}); }
    }
  }
  save(input: Omit<Schedule,'id'|'lastRun'> & {id?: string}) {
    compileCron(input.cron,input.timezone);
    const previous=this.engine.store.all<Schedule>('schedules').find(s=>s.id===input.id);
    const schedule: Schedule={...input,id:previous?.id || randomUUID(),lastRun:previous?.lastRun || null};
    this.engine.store.saveSchedule(schedule); this.engine.event(null,'schedule_updated',schedule); return schedule;
  }
}
