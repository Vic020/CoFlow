import test from 'node:test';
import assert from 'node:assert/strict';
import {demoMeta,publicDemoRequest as request} from '../apps/web/lib/public-demo.ts';
const json=(body,method='PATCH')=>({method,body:JSON.stringify(body)});
async function create(review){return request('/todos',json({title:'Synthetic acceptance QA',column_id:'backlog',source_id:crypto.randomUUID(),operation_id:crypto.randomUUID(),review},'POST'))}
async function change(id,action,body=''){
 const t=await request('/todos/'+id),b=await request('/todo-board');
 return request('/todos/'+id,json({action,body,expected_revision:t.revision,board_revision:b.revision,operation_id:crypto.randomUUID()}))
}
test('optional acceptance blocks bypass, preserves decisions and resets on reopen',async()=>{
 const other=demoMeta.members.find(m=>m.id!==demoMeta.current_user).id;
 let t=await create({criteria:'Reviewed delivery and tests',reviewer_id:other,state:'approved',decision_by:other});
 const id=t.id;assert.equal(t.review.state,'draft');
 await assert.rejects(()=>change(id,'complete'));
 await assert.rejects(()=>change(id,'submit-review'));
 t=await change(id,'submit-review','Synthetic evidence');assert.equal(t.review.state,'pending');assert.equal(t.completed_at,null);
 await assert.rejects(()=>change(id,'approve-review'));
 await assert.rejects(()=>request('/todos/'+id,json({action:'edit',review:null,expected_revision:t.revision,operation_id:crypto.randomUUID()})));
 const b=await request('/todo-board');
 await assert.rejects(()=>request('/todo-columns/backlog',json({action:'edit',name:'Backlog',done:true,board_revision:b.revision,expected_revision:b.columns.find(c=>c.id==='backlog').revision,operation_id:crypto.randomUUID()})));
 await change(id,'withdraw-review');t=await request('/todos/'+id);
 t=await request('/todos/'+id,json({action:'edit',review:{criteria:t.review.criteria,reviewer_id:demoMeta.current_user},expected_revision:t.revision,operation_id:crypto.randomUUID()}));
 t=await change(id,'submit-review','Final evidence');
 await assert.rejects(()=>change(id,'request-changes'));
 t=await change(id,'request-changes','Add a regression test');assert.equal(t.review.state,'changes_requested');
 t=await change(id,'submit-review','Regression added');
 t=await change(id,'approve-review','Criteria met');assert.equal(t.review.state,'approved');assert.ok(t.completed_at);
 assert.equal(t.history.at(-1).before.review.state,'pending');
 await assert.rejects(()=>request('/todos/'+id,json({action:'edit',body:'Silent material change',expected_revision:t.revision,operation_id:crypto.randomUUID()})));
 t=await change(id,'reopen');assert.equal(t.review.state,'draft');assert.equal(t.completed_at,null);assert.ok(t.history.some(h=>h.after.review?.state==='approved'));
});
test('legacy tasks retain direct completion without acceptance configuration',async()=>{
 const t=await create(null);const done=await change(t.id,'complete');assert.ok(done.completed_at);assert.equal(done.review,null);
});
