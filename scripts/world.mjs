import { existsSync } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { WorldLabs, inspectInput, makeRequest, creditEstimate, saveJson, runJob } from './worldlabs.mjs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  input: { type:'string',multiple:true }, job:{type:'string'}, model:{type:'string'},
  name:{type:'string'}, prompt:{type:'string'}, operation:{type:'string'},
  'dry-run':{type:'boolean'}, wait:{type:'string',default:'1200'}, poll:{type:'string',default:'10'},
} });
const command = positionals[0];
async function main() {
  if (values['dry-run'] && command !== 'generate') throw new Error('--dry-run is supported only with generate.');
  if (!['credits','generate','resume'].includes(command)) {
    console.log(`Usage:
  npm run world -- credits
  npm run world -- generate --input capture.mp4 --job room-01 [--dry-run]
  npm run world -- generate --input front.jpg --input right.jpg --job room-02
  npm run world -- resume --job room-01 [--operation ID]
Options: --model marble-1.1-plus --name "Room name" --prompt "..." --wait 1200 --poll 10
Generation consumes API credits. Reuse resume for an existing job. Outputs: data/worlds/JOB/`);
    return;
  }
  if (command === 'credits') { console.log(await new WorldLabs(process.env.WORLDLABS_API_KEY || process.env.WLT_API_KEY).credits()); return; }
  if (!values.job || !/^[a-zA-Z0-9_-]+$/.test(values.job)) throw new Error('Supply a simple --job name using letters, numbers, underscores, or hyphens.');
  const poll=Number(values.poll),wait=Number(values.wait);
  if (!Number.isFinite(poll) || poll < 1 || poll > 60 || !Number.isFinite(wait) || wait < 0) throw new Error('Invalid poll/wait duration');
  const dir=resolve('data/worlds',values.job), statePath=join(dir,'job.json');
  let state;
  if (command==='generate') {
    if (existsSync(statePath)) throw new Error('Job already exists. Use resume to avoid duplicate generation.');
    const paths=(values.input || []).map(p=>resolve(p));
    const inputs=await Promise.all(paths.map(inspectInput));
    const options={ model:values.model, name:values.name, prompt:values.prompt };
    const request=makeRequest(inputs,inputs.map((_,i)=>`pending-upload-${i+1}`),options);
    // Validate actual decoded dimensions/duration, rather than trusting file extensions.
    const validation=spawnSync('python3',['scripts/prepare_capture.py','--inspect',...paths],{encoding:'utf8'});
    if (validation.status!==0) throw new Error(validation.stderr || 'Media validation failed');
    const media=JSON.parse(validation.stdout);
    if (inputs.length>1 && new Set(media.map(m=>`${m.width}x${m.height}`)).size!==1)
      throw new Error('Reconstruction images must all have identical width and height.');
    const estimate=creditEstimate(request);
    console.log(JSON.stringify({request,inputs:media,estimatedCredits:estimate,estimatedUSD:{min:estimate.min/1250,max:estimate.max/1250}},null,2));
    if(values['dry-run']) return;
    state={schemaVersion:1,createdAt:new Date().toISOString(),status:'prepared',inputs,options,request,assetIds:[]};
  } else {
    state=JSON.parse(await readFile(statePath,'utf8'));
    if (state.status==='complete') { console.log(`Already complete: ${join(dir,'manifest.json')}`); return; }
  }
  const client=new WorldLabs(process.env.WORLDLABS_API_KEY || process.env.WLT_API_KEY);
  await mkdir(dir,{recursive:true});
  const lockPath=join(dir,'.lock');
  const lock=await open(lockPath,'wx').catch(()=>{throw new Error('Job is locked by another process. If it crashed, verify its PID before removing .lock.');});
  try {
    await lock.writeFile(String(process.pid));
    if (command==='generate' && existsSync(statePath)) throw new Error('Job appeared concurrently; use resume.');
    if (command==='resume' && values.operation) {state.operationId=values.operation;state.operation=null;state.status='generating';}
    await saveJson(statePath,state);
    await runJob(client,state,dir,{poll,wait});
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
