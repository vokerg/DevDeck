import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the real browser action handler without making requests to live projects.
async function ui(confirmed) {
  const elements=new Map(), calls=[], confirmations=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',innerHTML:'',className:'',classList:{add(){},remove(){}},addEventListener(){}});
    return elements.get(id);
  };
  const context=vm.createContext({
    document:{getElementById:element,querySelectorAll:()=>[]},
    window:{confirm:text=>{confirmations.push(text);return confirmed;}},
    setTimeout:()=>0,clearTimeout(){},setInterval(){},
    URL,Date,
    fetch:async(url, options)=>{
      calls.push({url,options});
      const payload=url==='/api/projects'?{projects:[],platform:'darwin'}:url.endsWith('stop-preview')?
        {token:'reviewed-token',processes:[{pid:123,command:'node scripts/dev.mjs',cwd:'/test/repo'}]}:
        {message:'SIGTERM requested'};
      return {ok:true,json:async()=>payload};
    }
  });
  vm.runInContext(`${await readFile(new URL('../public/app.js',import.meta.url),'utf8')}\nglobalThis.run=runAction;`,context);
  await new Promise(resolve=>setImmediate(resolve));
  calls.length=0;
  await context.run({dataset:{project:'demo',action:'stop-preview'}});
  return {calls,confirmations};
}
test('cancelled Stop shows process details and never confirms the stop endpoint',async()=>{
  const {calls,confirmations}=await ui(false);
  assert.equal(calls.length,1);assert.match(calls[0].url,/stop-preview$/);
  assert.match(confirmations[0],/PID 123: node scripts\/dev.mjs/);
  assert.match(confirmations[0],/\/test\/repo/);
});
test('confirmed Stop passes the reviewed server token then refreshes health',async()=>{
  const {calls}=await ui(true);
  assert.deepEqual(calls.map(c=>c.url),['/api/projects/demo/stop-preview','/api/projects/demo/stop','/api/projects']);
  assert.equal(calls[1].options.headers['X-DevDeck-Stop-Token'],'reviewed-token');
});
