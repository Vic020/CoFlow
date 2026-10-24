import assert from 'node:assert/strict';
import test from 'node:test';
import { demoMeta, publicDemoRequest } from '../apps/web/lib/public-demo.ts';

test('public demo uses synthetic identities and returns isolated read copies', async () => {
  assert.equal(demoMeta.team.id, 'demo-team');
  assert.ok(demoMeta.members.every(m => m.id.startsWith('demo-')));
  const first = await publicDemoRequest('/reports');
  assert.equal(first.items.length, 6);
  for (const report of first.items) {
    assert.ok(report.source_id.startsWith('demo-'));
    assert.ok(report.links.every(l => new URL(l.url).hostname === 'github.com'));
  }
  first.items[0].title = 'mutated returned copy';
  assert.notEqual((await publicDemoRequest('/reports')).items[0].title, first.items[0].title);
});

test('demo writes stay in module memory and never use the network', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected network'); };
  try {
    const created = await publicDemoRequest('/reports', { method: 'POST', body: JSON.stringify({ source_id: 'demo-try', title: 'synthetic draft', links: [] }) });
    await publicDemoRequest(`/reports/${created.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'synthetic feedback' }) });
    assert.equal((await publicDemoRequest('/reports')).items[0].comments.length, 1);
    await publicDemoRequest(`/reports/${created.id}`, { method: 'PUT', body: JSON.stringify({ title: 'synthetic revision' }) });
    assert.equal((await publicDemoRequest('/reports')).items[0].title, 'synthetic revision');
    const fresh = await import('../apps/web/lib/public-demo.ts?new-page');
    assert.equal((await fresh.publicDemoRequest('/reports')).items.length, 6);
  } finally { globalThis.fetch = originalFetch; }
});

test('public demo refuses real identity, credential and backend operations', async () => {
  for (const path of ['/auth/login', '/auth/bootstrap', '/tokens', '/teams', '/invitations']) {
    await assert.rejects(publicDemoRequest(path, { method: 'POST', body: '{}' }), /公开演示不连接真实服务/);
  }
  await assert.rejects(publicDemoRequest('/reports', { method: 'POST', body: JSON.stringify({ title: 'bad link', links: [{ title: 'bad', url: 'javascript:alert(1)' }] }) }), /HTTP/);
  await assert.rejects(publicDemoRequest('/reports/demo-report-2', { method: 'PUT', body: '{}' }), /只能编辑/);
});
