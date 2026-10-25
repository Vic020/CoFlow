import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTag, validateBuildPaths, resolveRelease, requireSuccessfulCI } from './prepare-image-release.mjs';
const sha='a'.repeat(40);
const git=args=>{
 if(args[0]==='rev-parse')return sha+'\n';
 if(args[0]==='merge-base')return '';
 if(args[0]==='show')return '0.1.4\n';
 if(args[0]==='ls-tree')return 'VERSION\0apps/web/Dockerfile\0.env.example\0';
 throw new Error('unexpected Git operation');
};
test('only stable version tags accepted, before Git is invoked',()=>{
 for(const value of ['main','v1.2','v01.2.3','v1.2.3-beta','v1.2.3\nmain','v1.2.3; echo bad','--all']) {
  assert.throws(()=>resolveRelease(value,'Vic020/CoFlow','123','1',()=>{throw new Error('Git must not be called');}),/stable tag/);
 }
 assert.equal(validateTag('v0.1.4'),'0.1.4');
});
test('private paths rejected, reviewed templates and previews allowed',()=>{
 validateBuildPaths(['.env.example','deploy/production.env.example','docs/design/public-preview.png','apps/api/internal/identity/service.go']);
 for(const value of ['.env.production','apps/web/.env.local','deploy/config.env','deploy/config.env.production','.local/qa.json','backup.dump','agent.token','private.key','docs/design/unreviewed.png','apps/api/.data/demo.json'])assert.throws(()=>validateBuildPaths([value]),/private\/local/);
});
test('tag must match VERSION and belong to main',()=>{
 assert.throws(()=>resolveRelease('v0.1.5','Vic020/CoFlow','123','1',git),/VERSION/);
 assert.throws(()=>resolveRelease('v0.1.4','Vic020/CoFlow','123','1',args=>{if(args[0]==='merge-base')throw new Error('not on main');return git(args);}),/not on main/);
 const a=resolveRelease('v0.1.4','Vic020/CoFlow','123','1',git);
 const b=resolveRelease('v0.1.4','Vic020/CoFlow','123','2',git);
 assert.equal(a.registry,'ghcr.io/vic020/coflow');assert.equal(a.sha,sha);assert.notEqual(a.image_tag,b.image_tag);
});
test('CI approval must match exact main push commit and conclusion',()=>{
 const valid={head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success'};
 requireSuccessfulCI([valid],sha);
 for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}]) assert.throws(()=>requireSuccessfulCI([{...valid,...change}],sha),/successful main-branch/);
 assert.throws(()=>requireSuccessfulCI([],sha));
});
