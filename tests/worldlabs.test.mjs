import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldLabs, inspectInput, makeRequest, worldManifest, runJob, creditEstimate } from '../scripts/worldlabs.mjs';

test('reconstruction request enables auto layout without invented azimuths',()=>{
  const r=makeRequest([{kind:'image'},{kind:'image'}],['a','b']);
  assert.equal(r.world_prompt.reconstruct_images,true);
  assert.deepEqual(r.world_prompt.multi_image_prompt[1],{content:{source:'media_asset',media_asset_id:'b'}});
  assert.deepEqual(creditEstimate(r),{min:1600,max:3100});
  assert.equal(r.permission.public,false);
  assert.throws(()=>makeRequest([{kind:'image'},{kind:'video'}],['a','b']));
});
test('metric scale, ground offset, then axis conversion; collider stays unverified',()=>{
  const m=worldManifest({assets:{splats:{semantics_metadata:{metric_scale_factor:2,ground_plane_offset:3}}}},{});
  assert.deepEqual(m.coordinates.splatToApp,[2,0,0,0,0,-2,0,0,0,0,-2,0,0,3,0,1]);
  assert.equal(m.coordinates.colliderToApp,null);
  assert.equal(worldManifest({},{}).coordinates.splatToApp,null);
});
test('upload, generation, polling, download, persistence and resume use one paid submission',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'world-test-'));
  try {
    const path=join(dir,'capture.mp4'); await writeFile(path,'test-video');
    const input=await inspectInput(path);
    let submits=0,polls=0,downloads=0;
    const world={world_id:'world-1',display_name:'Test',model:'marble-1.1-plus',world_marble_url:'https://marble.worldlabs.ai/world/world-1',assets:{splats:{spz_urls:{'500k':'https://cdn.example/a.spz','100k':'https://cdn.example/b.spz',full_res:'https://cdn.example/c.spz'},semantics_metadata:{metric_scale_factor:2,ground_plane_offset:3}},mesh:{collider_mesh_url:'https://cdn.example/c.glb'},imagery:{pano_url:'https://cdn.example/p.jpg'}}};
    const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
    const fake=async(url,options={})=>{
      if(url.startsWith('https://upload.example')){
        assert.equal(options.headers['WLT-Api-Key'],undefined);
        assert.equal(options.headers['required-test'],'yes');
        for await (const chunk of options.body) assert.ok(chunk.length);
        return new Response('');
      }
      if(url.startsWith('https://cdn.example')){downloads++;assert.equal(options.headers,undefined);return new Response('asset-content');}
      assert.equal(options.headers['WLT-Api-Key'],'test-secret');
      if(url.endsWith('/credits'))return json({remaining_credits:7000});
      if(url.endsWith(':prepare_upload'))return json({media_asset:{media_asset_id:'media-1'},upload_info:{upload_url:'https://upload.example/signed',upload_method:'PUT',required_headers:{'required-test':'yes'}}});
      if(url.endsWith('worlds:generate')){submits++;return json({operation_id:'op-1',done:false});}
      if(url.endsWith('/operations/op-1')){polls++;return json({operation_id:'op-1',done:true,response:{world_id:'world-1'}});}
      if(url.endsWith('/worlds/world-1'))return json(world);
      throw new Error('Unexpected URL');
    };
    const client=new WorldLabs('test-secret',fake);
    const state={inputs:[input],assetIds:[],options:{},request:makeRequest([input],['pending'])};
    await runJob(client,state,dir,{log:()=>{}});
    assert.equal(state.status,'complete');assert.equal(submits,1);assert.equal(downloads,5);
    const manifest=JSON.parse(await readFile(join(dir,'manifest.json')));
    assert.equal(manifest.preferredSplat,'splat-500k');
    assert.equal(manifest.assets.collider.bytes,13);
    // Re-running after a interrupted download must reuse the operation and cached files.
    await runJob(client,state,dir,{log:()=>{}});
    assert.equal(submits,1);assert.equal(polls,1);assert.equal(downloads,5);
    await writeFile(join(dir,'assets/collider.glb'),'corrupted-cache');
    await runJob(client,state,dir,{log:()=>{}});
    assert.equal(submits,1);assert.equal(downloads,6);
    assert.equal(await readFile(join(dir,'assets/collider.glb'),'utf8'),'asset-content');
    assert.ok(!(await readFile(join(dir,'job.json'),'utf8')).includes('test-secret'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('provider failure persists without fetching or downloading a world',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'world-failed-'));
  try {
    const state={operationId:'failed-op'};
    const client={operation:async()=>({done:true,error:{message:'Generation failed'}})};
    await assert.rejects(runJob(client,state,dir),/Generation failed/);
    assert.equal(JSON.parse(await readFile(join(dir,'job.json'))).status,'failed');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('low credits and ambiguous submission never trigger another paid request',async()=>{
  const request=makeRequest([{kind:'video'}],['x']);
  const low={credits:async()=>({remaining_credits:1600})};
  await assert.rejects(runJob(low,{request},'/unused'),/3100/);
  await assert.rejects(runJob({}, {status:'submitting'},'/unused'),/unknown/);
});
test('network timeout on paid submission records ambiguity, then resume refuses retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'world-ambiguous-'));
  try {
    let calls=0;
    const state={inputs:[{kind:'video'}],assetIds:['uploaded'],options:{},request:makeRequest([{kind:'video'}],['uploaded'])};
    const client={credits:async()=>({remaining_credits:7000}),api:async()=>{calls++;throw new Error('timeout');}};
    await assert.rejects(runJob(client,state,dir),/timeout/);
    const saved=JSON.parse(await readFile(join(dir,'job.json')));
    assert.equal(saved.status,'submitting');
    await assert.rejects(runJob(client,saved,dir),/unknown/);
    assert.equal(calls,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
