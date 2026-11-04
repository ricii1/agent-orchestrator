import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$','$$')+'"';
const servicePath=[...new Set([dirname(process.execPath),...(process.env.PATH||'/usr/local/bin:/usr/bin:/bin').split(':').filter(p=>p&&!p.includes('/.codex/tmp/'))])].join(':');
const unit=`[Unit]
Description=Local Agent Office orchestrator
After=network.target

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%','%%')}
ExecStart=${quote(process.execPath)} ${quote(join(root,'scripts/service-entry.mjs'))}
Environment=${quote('PATH='+servicePath)}
Environment=${quote('ORCHESTRATOR_DATA_DIR='+join(root,'.data'))}
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=15
UMask=0077

[Install]
WantedBy=default.target
`;
const target=join(homedir(),'.config/systemd/user/agent-office.service');
const control=(...args)=>{const r=spawnSync('systemctl',['--user',...args],{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw new Error('systemctl failed');};
const action=process.argv[2]||'print';
if(action==='print')process.stdout.write(unit);
else if(action==='install'){await mkdir(dirname(target),{recursive:true});await writeFile(target,unit,{mode:0o600});control('daemon-reload');control('enable','--now','agent-office.service');console.log('Installed '+target);}
else if(action==='uninstall'){control('disable','--now','agent-office.service');await unlink(target);control('daemon-reload');}
else if(action==='status')control('status','agent-office.service');
else throw new Error('Usage: npm run service -- print|install|uninstall|status');
