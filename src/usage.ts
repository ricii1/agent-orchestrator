import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {child,lines,Rpc,stop} from './adapters/process.js';

export interface QuotaWindow { label: string; usedPercent: number; resetsAt: string | null; }
export interface ProviderQuota {
  status: 'ok' | 'unavailable' | 'login_required' | 'unsupported' | 'stale';
  windows: QuotaWindow[]; updatedAt: string | null; note: string;
}
export type Usage = {claude: ProviderQuota; codex: ProviderQuota};
const empty=(status: ProviderQuota['status'],note: string): ProviderQuota=>({status,windows:[],updatedAt:null,note});
function window(label: string,used: unknown,reset: unknown): QuotaWindow | null {
  if(typeof used!=='number'||!Number.isFinite(used))return null;
  const date=typeof reset==='number'?new Date(reset*1000):typeof reset==='string'?new Date(reset):null;
  return {label,usedPercent:Math.max(0,Math.min(100,used)),resetsAt:date&&Number.isFinite(date.getTime())?date.toISOString():null};
}
export function parseClaudeQuota(data: any): QuotaWindow[] {
  return [['five_hour','5 jam'],['seven_day','7 hari'],['seven_day_sonnet','Sonnet · 7 hari'],['seven_day_opus','Opus · 7 hari']].flatMap(([key,label])=>{
    const entry=data?.[key],parsed=window(label,entry?.utilization,entry?.resets_at);return parsed?[parsed]:[];
  });
}
function duration(minutes: unknown,fallback: string) {
  if(typeof minutes!=='number'||minutes<=0)return fallback;
  return minutes%1440===0?`${minutes/1440} hari`:minutes%60===0?`${minutes/60} jam`:`${minutes} menit`;
}
export function parseCodexQuota(data: any): QuotaWindow[] {
  const buckets=data?.rateLimitsByLimitId;
  const entries=buckets&&typeof buckets==='object'&&Object.keys(buckets).length?Object.entries(buckets):[['codex',data?.rateLimits]];
  return entries.flatMap(([key,value]: any)=>['primary','secondary'].flatMap((slot,i)=>{
    const part=value?.[slot];
    const label=duration(part?.windowDurationMins,i?'Mingguan':'Sesi');
    const parsed=window(key==='codex'?label:`${value?.limitName||key} · ${label}`,part?.usedPercent,part?.resetsAt);
    return parsed?[parsed]:[];
  }));
}
export async function claudeQuota(fetcher: typeof fetch=fetch,readCredential=()=>readFile(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude'),'.credentials.json'),'utf8')): Promise<ProviderQuota> {
  let token: string;
  try {
    const auth=JSON.parse(await readCredential()).claudeAiOauth;
    if(typeof auth?.accessToken!=='string'||!auth.accessToken)return empty('login_required','Login Claude Code diperlukan.');
    if(typeof auth.expiresAt==='number'&&auth.expiresAt<=Date.now())return empty('login_required','Sesi Claude kedaluwarsa. Buka Claude Code untuk memperbaruinya.');
    token=auth.accessToken;
  }catch{return empty('login_required','Kuota membutuhkan login subscription Claude Code.');}
  try {
    // Same read-only quota endpoint used by Claw-Empire. No token refresh or credential copies.
    const response=await fetcher('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20'},signal:AbortSignal.timeout(8000),redirect:'error'});
    if([401,403].includes(response.status))return empty('login_required','Claude menolak akses kuota. Periksa login CLI.');
    if(!response.ok)return empty('unavailable','Kuota Claude belum dapat dibaca. Coba lagi nanti.');
    const windows=parseClaudeQuota(await response.json());
    return windows.length?{status:'ok',windows,updatedAt:new Date().toISOString(),note:''}:empty('unsupported','Akun Claude ini tidak menyediakan data kuota.');
  }catch{return empty('unavailable','Tidak dapat menghubungi layanan kuota Claude.');}
}
export async function codexQuota(): Promise<ProviderQuota> {
  const p=child(process.env.CODEX_BIN || 'codex',['app-server','--listen','stdio://'],process.cwd());
  const rpc=new Rpc(p);
  const closed=new Promise<void>(resolve=>p.once('close',()=>resolve()));
  lines(p,msg=>{
    if(rpc.response(msg))return;
    // This client only reads account state: no threads, model calls, or interactive actions.
    if(msg.id!==undefined&&msg.method)rpc.write({id:msg.id,error:{code:-32601,message:'Usage reader does not support interactive requests'}});
  },()=>{});
  const timeout=setTimeout(()=>stop(p),12000);timeout.unref();
  try {
    await rpc.request('initialize',{clientInfo:{name:'local_agent_office_usage',title:'Agent Office usage',version:'0.1.0'},capabilities:{}});
    rpc.write({method:'initialized'});
    const account=await rpc.request('account/read',{refreshToken:false});
    if(!account.account)return empty('login_required','Login Codex diperlukan.');
    if(account.account.type==='apiKey')return empty('unsupported','Login API key tidak menyediakan kuota subscription.');
    const result=await rpc.request('account/rateLimits/read',{});
    const windows=parseCodexQuota(result);
    return windows.length?{status:'ok',windows,updatedAt:new Date().toISOString(),note:''}:empty('unsupported','Akun Codex ini tidak menyediakan data kuota.');
  }catch{return empty('unavailable','Kuota Codex belum dapat dibaca. Periksa CLI dan koneksi.');}
  finally{clearTimeout(timeout);stop(p);await closed;}
}
export class UsageService {
  cache: Usage | null=null; checkedAt=0; inFlight: Promise<Usage> | null=null;
  constructor(public readers={claude:claudeQuota,codex:codexQuota},public clock=Date.now) {}
  async get(refresh=false): Promise<Usage> {
    if(this.inFlight)return this.inFlight;
    if(this.cache&&this.clock()-this.checkedAt<(refresh?15000:60000))return this.cache;
    this.inFlight=(async()=>{
      const [claude,codex]=await Promise.all([this.readers.claude(),this.readers.codex()].map(p=>p.catch(()=>empty('unavailable','Data kuota tidak tersedia.'))));
      const preserve=(next:ProviderQuota,old?:ProviderQuota):ProviderQuota=>next.status==='unavailable'&&old?.updatedAt?{...old,status:'stale',note:next.note}:next;
      this.cache={claude:preserve(claude,this.cache?.claude),codex:preserve(codex,this.cache?.codex)};this.checkedAt=this.clock();return this.cache;
    })();
    try{return await this.inFlight;}finally{this.inFlight=null;}
  }
}
