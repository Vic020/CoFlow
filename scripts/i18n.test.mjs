import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { translate, formatDate, isLocale, defaultLocale, calendarDateKey, isTimeZone } from '../apps/web/lib/i18n/core.ts';
import { reportPrompt } from '../apps/web/lib/report-prompt.ts';
const messages = JSON.parse(readFileSync(new URL('../apps/web/lib/i18n/messages/en.json', import.meta.url)));

test('English default, strict locale allowlist, and Chinese fallback', () => {
 assert.equal(defaultLocale, 'en');
 assert.equal(isLocale('en'), true); assert.equal(isLocale('zh-CN'), true);
 assert.equal(isLocale('en-US'), false); assert.equal(isLocale('<script>'), false);
 assert.equal(translate('en','个人设置'),'Personal settings');
 assert.equal(translate('zh-CN','个人设置'),'个人设置');
 assert.equal(translate('en','团队成员的原创内容'),'团队成员的原创内容');
 for (const key of ['constructor','toString','__proto__']) for (const locale of ['en','zh-CN']) assert.equal(translate(locale,key),key);
});
test('interpolation and plurals retain names and format numbers', () => {
 assert.equal(translate('en','账号菜单：{0}',{0:'Vic {0}'}),'Account menu: Vic {0}');
 assert.equal(translate('en','{count} 条上报',{count:1}),'1 report');
 assert.equal(translate('en','{count} 条上报',{count:1200}),'1,200 reports');
 assert.equal(translate('zh-CN','{count} 条上报',{count:2}),'2 条上报');
 assert.equal(translate('en','新评论：原文保留'),'New comment: 原文保留');
 assert.equal(translate('en','整理分类：原项目 → 目标项目'),'Category updated: 原项目 → 目标项目');
 assert.equal(translate('en','人工纠正分类'),'Categories corrected');
});
test('translations preserve every interpolation field', () => {
 const fields = (value) => [...new Set(value.match(/\{\w+\}/g) || [])].sort();
 for (const [source, translation] of Object.entries(messages)) {
  for (const value of typeof translation === 'string' ? [translation] : Object.values(translation)) {
   assert.deepEqual(fields(value), fields(source), `Interpolation mismatch: ${source}`);
  }
 }
});
test('date localization keeps the team day and handles invalid dates', () => {
 assert.match(formatDate('en','2026-10-24T17:00:00Z',{month:'long',day:'numeric'}), /October 25/);
 assert.match(formatDate('zh-CN','2026-10-24T17:00:00Z',{month:'long',day:'numeric'}), /10月25日/);
 assert.equal(formatDate('en','invalid'),'—');
});
test('all static UI message IDs have an English translation', () => {
 for(const dir of ['components','components/ui']) for(const file of readdirSync(new URL(`../apps/web/${dir}/`,import.meta.url)).filter(x=>x.endsWith('.tsx'))) {
  const source=readFileSync(new URL(`../apps/web/${dir}/${file}`,import.meta.url),'utf8');
  for(const match of source.matchAll(/\b(?:tr|t)\("([^"\n]+)"/g)) {
   const key=match[1];
   assert.ok(key in messages, `${file}: missing ${key}`);
  }
 }
});
test('English setup and reporting prompts preserve credential boundaries', () => {
 const target={team:'synthetic-team',member:'synthetic-member'};
 const setup=reportPrompt('https://coflow.example.com','synthetic-credential',false,target,'en');
 assert.match(setup,/Verify.*identity/); assert.match(setup,/permissions 700.*permissions 600/);
 assert.match(setup,/ask before replacing/); assert.match(setup,/source_id/);
 const daily=reportPrompt('https://coflow.example.com','',false,target,'en');
 assert.match(daily,/COFLOW_TOKEN/); assert.match(daily,/\.token/); assert.doesNotMatch(daily,/synthetic-credential/);
});

test('display time zones change date boundaries and handle daylight saving', () => {
 const instant='2026-10-25T00:30:00Z';
 assert.equal(calendarDateKey(instant,'Asia/Shanghai'),'2026-10-25');
 assert.equal(calendarDateKey(instant,'America/Los_Angeles'),'2026-10-24');
 assert.equal(isTimeZone('UTC'),true);
 assert.equal(isTimeZone('America/New_York'),true);
 assert.equal(isTimeZone('Local'),false);
 assert.equal(isTimeZone('invalid-zone'),false);
 assert.match(formatDate('en','2026-03-08T06:30:00Z',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}),/1:30/);
 assert.match(formatDate('en','2026-03-08T07:30:00Z',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}),/3:30/);
});

test('time zone search prioritizes prefixes and supports fuzzy input', async () => {
 const {searchTimeZones} = await import('../apps/web/lib/time-zone-search.ts');
 const zones=['America/New_York','Africa/Accra','Asia/Shanghai','Asia/Tokyo','UTC'];
 assert.deepEqual(searchTimeZones(zones,'asia'),['Asia/Shanghai','Asia/Tokyo']);
 assert.deepEqual(searchTimeZones(zones,'SHANG'),['Asia/Shanghai']);
 assert.deepEqual(searchTimeZones(zones,'new york'),['America/New_York']);
 assert.deepEqual(searchTimeZones(zones,'as shgh'),['Asia/Shanghai']);
 assert.deepEqual(searchTimeZones(['Africa/Accra','Pacific/Rarotonga','America/Caracas'],'accra'),['Africa/Accra']);
 assert.equal(searchTimeZones(['Asia/Utc_Test','UTC'],'utc')[0],'UTC');
 assert.deepEqual(searchTimeZones(zones,'does-not-exist'),[]);
 assert.deepEqual(searchTimeZones(zones,''),zones);
});
