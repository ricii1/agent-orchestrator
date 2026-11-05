import type {Event} from './model.js';

export const TRANSCRIPT_EVENT_LIMIT=300;
export const TRANSCRIPT_TEXT_LIMIT=24_000;
const TRANSCRIPT_TYPES=new Set(['created','user_message','turn_started','message','text','result','command_started','command_result','tool','tool_output','tool_result','log','provider_error','permission_denied']);

/** Return immutable, ID-ordered transcript events within explicit memory bounds. */
export function mergeTranscriptEvent(current:Event[],incoming:Event,expanded=false):Event[]{
  if(!TRANSCRIPT_TYPES.has(incoming.type))return current;
  if(current.some(event=>event.id===incoming.id))return current;
  const sorted=[...current,incoming].sort((a,b)=>a.id-b.id);
  const completedText=new Set<number>();
  for(let i=0;i<sorted.length;i++)if(sorted[i].type==='message'){
    let boundary=i-1;
    while(boundary>=0&&!['turn_started','created','user_message'].includes(sorted[boundary].type))boundary--;
    for(let j=boundary+1;j<i;j++)if(sorted[j].type==='text')completedText.add(sorted[j].id);
  }
  let result=sorted.filter(event=>!completedText.has(event.id));
  if(!expanded&&result.length>TRANSCRIPT_EVENT_LIMIT)result=result.slice(-TRANSCRIPT_EVENT_LIMIT);
  let textSize=result.reduce((sum,event)=>sum+(event.type==='text'&&typeof (event.data as any)?.text==='string'?(event.data as any).text.length:0),0);
  if(textSize>TRANSCRIPT_TEXT_LIMIT){
    const remove=new Set<number>();
    for(const event of result){
      if(textSize<=TRANSCRIPT_TEXT_LIMIT)break;
      if(event.type!=='text')continue;
      remove.add(event.id);textSize-=typeof (event.data as any)?.text==='string'?(event.data as any).text.length:0;
    }
    result=result.filter(event=>!remove.has(event.id));
  }
  return result;
}

