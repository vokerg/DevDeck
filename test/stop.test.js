import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createStopActions, planStop, macProcessSnapshot } from '../server/stop.js';

const row = (pid, parentPid, command, cwd = '/repo') => ({pid, parentPid, command, cwd, uid:process.getuid?.(), started:'Sun Nov  1 12:00:00 2026'});
const rows = [row(101,1,'node scripts/dev.mjs'),row(102,101,'node api.js'),row(103,1,'codex'),row(104,1,'node scripts/dev.mjs','/other')];
test('Stop selects configured launcher and descendants, never unrelated processes or other repositories', () => {
  assert.deepEqual(planStop(rows, '/repo', ['node scripts/dev.mjs']).map(p=>p.pid), [101,102]);
  assert.deepEqual(planStop(rows, '/repo', ['node scripts/dev.mjs'], {self:102}).map(p=>p.pid), []);
  assert.throws(()=>planStop([...rows,row(105,101,'external','/elsewhere')], '/repo', ['node scripts/dev.mjs']), /unverifiable/);
  assert.throws(()=>planStop([...rows,row(105,101,'unknown',null)], '/repo', ['node scripts/dev.mjs']), /unverifiable/);
  assert.deepEqual(planStop([row(101,1,'node scripts/dev.mjs','/repo-other')], '/repo', ['node scripts/dev.mjs']), []);
});
async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(),'devdeck-stop-'));
  try {
    const root = await realpath(dir);
    const config = {baseDirs:{darwin:root},projects:[{id:'demo',path:root,stop:{matches:['node scripts/dev.mjs']}}]};
    let current = rows.slice(0,2).map(p=>({...p,cwd:root}));
    const signals = [];
    let time = 0;
    const stop = createStopActions({platform:'darwin', snapshot:async()=>current, signal:async pid=>{signals.push(pid);current=current.filter(p=>p.pid!==pid);},pause:async()=>{},now:()=>time});
    await fn({config, stop, signals, setRows:r=>{current=r;}, getRows:()=>current, setTime:t=>{time=t;}});
  } finally {await rm(dir,{recursive:true,force:true});}
}
test('preview does not signal; confirmation is project-bound and single-use; parent precedes child', async()=>fixture(async({config,stop,signals})=>{
  const preview = await stop(config,'demo','stop-preview');
  assert.equal(preview.processes.length,2); assert.deepEqual(signals,[]);
  assert.equal((await stop(config,'demo','stop','invented')).code,409);
  const result=await stop(config,'demo','stop',preview.token);
  assert.deepEqual(signals,[101,102]);assert.equal(result.remaining,0);
  assert.equal((await stop(config,'demo','stop',preview.token)).code,409);
}));
test('changed PID identity, new descendants, config edits and expiration require new review',async()=>{
  for(const change of ['identity','descendant','config','expiry']) await fixture(async({config,stop,signals,getRows,setRows,setTime})=>{
    const preview=await stop(config,'demo','stop-preview');
    if(change==='identity') setRows(getRows().map(p=>({...p,started:'changed'})));
    if(change==='descendant') setRows([...getRows(),{...getRows()[1],pid:105}]);
    if(change==='config') config.projects[0].stop.matches.push('other-command');
    if(change==='expiry') setTime(61000);
    assert.equal((await stop(config,'demo','stop',preview.token)).code,409); assert.deepEqual(signals,[]);
  });
});
test('no configured Stop and unsupported platforms never signal',async()=>fixture(async({config,stop,signals})=>{
  delete config.projects[0].stop;
  assert.equal((await stop(config,'demo','stop-preview')).code,409);
  assert.equal((await createStopActions({platform:'win32'})(config,'demo','stop-preview')).code,422);
  assert.deepEqual(signals,[]);
}));
test('macOS integration: preview and SIGTERM only a disposable detached repository process', {skip:process.platform!=='darwin'},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'devdeck-stop-real-'));
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)','devdeck-disposable-stop-test'],{cwd:dir,detached:true,stdio:'ignore'});
  try {
    await once(child,'spawn');
    const config={baseDirs:{darwin:dir},projects:[{id:'test',path:dir,stop:{matches:['devdeck-disposable-stop-test']}}]};
    const stop=createStopActions();
    const preview=await stop(config,'test','stop-preview');
    assert.deepEqual(preview.processes.map(p=>p.pid),[child.pid]);
    const exited=once(child,'exit');
    const result=await stop(config,'test','stop',preview.token);
    await exited;
    assert.equal(result.requested,1);assert.equal(result.remaining,0);
    assert.equal((await macProcessSnapshot()).some(p=>p.pid===child.pid),false);
  } finally {child.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
});


test('graceful Stop reports surviving children even after their launcher exits', async()=>fixture(async({config,getRows})=>{
  let live=getRows();
  const stop=createStopActions({platform:'darwin',snapshot:async()=>live,signal:async pid=>{if(pid===101) live=live.filter(p=>p.pid!==101);},pause:async()=>{}});
  const preview=await stop(config,'demo','stop-preview');
  const result=await stop(config,'demo','stop',preview.token);
  assert.equal(result.remaining,1);
  assert.match(result.message,/no force-kill/);
}));

test('a PID reused after launcher shutdown is skipped; permission errors are reported',async()=>fixture(async({config,getRows})=>{
  let live=getRows();const signals=[];
  const stop=createStopActions({platform:'darwin',snapshot:async()=>live,signal:async pid=>{
    signals.push(pid); live=live.map(p=>p.pid===102?{...p,started:'replacement'}:p);
    throw Object.assign(new Error('denied'),{code:'EPERM'});
  },pause:async()=>{}});
  const preview=await stop(config,'demo','stop-preview');
  const result=await stop(config,'demo','stop',preview.token);
  assert.deepEqual(signals,[101]);assert.equal(result.errors.length,2);
}));


test('a launcher still shutting down or ignoring SIGTERM retains control of its children',async()=>fixture(async({config,getRows})=>{
  const live=getRows(), signals=[];
  const stop=createStopActions({platform:'darwin',snapshot:async()=>live,signal:async pid=>signals.push(pid),pause:async()=>{}});
  const preview=await stop(config,'demo','stop-preview');
  const result=await stop(config,'demo','stop',preview.token);
  assert.deepEqual(signals,[101]);assert.equal(result.remaining,2);
  assert.match(result.errors[0],/launcher still running/);
}));
