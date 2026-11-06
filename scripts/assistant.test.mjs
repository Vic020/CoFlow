import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAIConfig, safeAssistantLink } from '../apps/web/lib/assistant.ts';
import { publicDemoRequest } from '../apps/web/lib/public-demo.ts';
const config=(id,scope,is_default,verified_at='2026-11-06')=>({id,scope,is_default,verified_at});
test('assistant configuration preference never chooses an unverified key',()=>{
 assert.equal(defaultAIConfig([config('personal','personal',true),config('shared','team',true)]).id,'shared');
 assert.equal(defaultAIConfig([config('shared','team',true,null),config('personal','personal',true)]).id,'personal');
 assert.equal(defaultAIConfig([config('shared','team',true,null)]),undefined);
});
test('assistant only navigates generated object links',()=>{
 for(const url of ['/?report=abc','/todo?todo=abc','/calendar?mode=schedule&date=2026-11-06'])assert.equal(safeAssistantLink(url),true);
 for(const url of ['https://external.example/','//external.example','javascript:alert(1)','/settings','/todo?todo=x&token=secret','/?report=<script>'])assert.equal(safeAssistantLink(url),false);
});
test('offline assistant prepares, edits and confirms synthetic work without calling providers',async()=>{
 const configs=await publicDemoRequest('/assistant/configs');assert.equal(configs.items[0].model,'Synthetic');
 const before=(await publicDemoRequest('/todos')).items.length;
 const send=message=>publicDemoRequest('/assistant/chat',{method:'POST',body:JSON.stringify({message,config_id:'demo-ai',request_id:crypto.randomUUID(),locale:'en',context:{project:'demo-launch'}})});
 const r=await send('Create task: Synthetic assistant acceptance');const action=r.turn.actions[0];assert.equal(action.state,'pending');assert.equal((await publicDemoRequest('/todos')).items.length,before);
 const init={method:'POST',body:JSON.stringify({decision:'confirm'})};const done=await publicDemoRequest('/assistant/actions/'+action.id,init);assert.equal(done.state,'done');const again=await publicDemoRequest('/assistant/actions/'+action.id,init);assert.equal(again.result.id,done.result.id);assert.equal((await publicDemoRequest('/todos')).items.length,before+1);
 const brief=await send('Draft a delivery summary');const card=brief.turn.actions[0];await publicDemoRequest('/assistant/actions/'+card.id,{method:'PATCH',body:JSON.stringify({title:'Reviewed demo brief',body:'Reviewed synthetic evidence.'})});const report=await publicDemoRequest('/assistant/actions/'+card.id,init);assert.equal(report.state,'done');assert.equal(report.result.title,'Reviewed demo brief');
 const scheduled=await send('Schedule tasks 2026-11-09 to 2026-11-13');assert.ok(scheduled.turn.actions.length>0);const cancellation=await publicDemoRequest('/assistant/actions/'+scheduled.turn.actions[0].id,{method:'POST',body:JSON.stringify({decision:'cancel'})});assert.equal(cancellation.state,'cancelled');
 const history=await publicDemoRequest('/assistant/conversations/'+r.conversation_id);assert.equal(history.turns[0].actions[0].state,'done');
 await assert.rejects(()=>publicDemoRequest('/assistant/configs',{method:'POST',body:JSON.stringify({api_key:'synthetic-do-not-store'})}));
});
test('offline history supports search, revision checks, archive and trash recovery',async()=>{
 const r=await publicDemoRequest('/assistant/chat',{method:'POST',body:JSON.stringify({message:'Unique history acceptance',config_id:'demo-ai',request_id:crypto.randomUUID(),locale:'en'})});
 const get=()=>publicDemoRequest('/assistant/conversations/'+r.conversation_id);
 const patch=(action,expected_revision)=>publicDemoRequest('/assistant/conversations/'+r.conversation_id,{method:'PATCH',body:JSON.stringify({action,expected_revision})});
 let c=await get();await patch('archive',c.revision);
 const active=await publicDemoRequest('/assistant/conversations?q=Unique&state=active');assert.equal(active.items.length,0);
 const archived=await publicDemoRequest('/assistant/conversations?q=Unique&state=archived');assert.equal(archived.items.length,1);
 await assert.rejects(()=>patch('delete',c.revision));c=await get();await patch('delete',c.revision);
 const trash=await publicDemoRequest('/assistant/conversations?state=deleted');assert.ok(trash.items.some(c=>c.id===r.conversation_id));await patch('restore',trash.items.find(c=>c.id===r.conversation_id).revision);
});
test('offline template updates preserve version semantics and never accept MCP credentials',async()=>{
 const t=await publicDemoRequest('/assistant/templates',{method:'POST',body:JSON.stringify({scope:'personal',title:'Synthetic review',instructions:'Read {{project}}',parameters:[],tools:['find_todos']})});assert.equal(t.version,1);
 const second=await publicDemoRequest('/assistant/templates',{method:'POST',body:JSON.stringify({...t,instructions:'Second review'})});assert.equal(second.version,2);
 await assert.rejects(()=>publicDemoRequest('/assistant/mcp',{method:'POST',body:JSON.stringify({token:'synthetic-not-to-store'})}));
});
test('assistant stream handles UTF-8 byte boundaries, errors and interrupted completion',async()=>{
 const {consumeAssistantStream}=await import('../apps/web/lib/assistant-stream.ts');
 const bytes=new TextEncoder().encode('event: delta\r\ndata: {"text":"进度"}\r\n\r\nevent: done\r\ndata: {"conversation_id":"synthetic","turn":{}}\r\n\r\n');let shown='';const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close()}});const v=await consumeAssistantStream(stream,s=>shown+=s);assert.equal(shown,'进度');assert.equal(v.conversation_id,'synthetic');
 for(const raw of ['event: error\ndata: {"error":"synthetic failure"}\n\n','event: delta\ndata: {"text":"partial"}\n\n'])await assert.rejects(()=>consumeAssistantStream(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(raw));c.close()}}),()=>{}));
});
