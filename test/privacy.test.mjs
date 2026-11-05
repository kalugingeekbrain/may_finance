import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('Pair membership, private wallets, amounts and idempotency through HTTP', async () => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function request(path, body, token) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...await response.json() };
  }
  try {
    const a = await request('register', { name: 'Аня', login: 'anna', password: 'test-password-1' });
    const b = await request('register', { name: 'Борис', login: 'boris', password: 'test-password-2' });
    const c = await request('register', { name: 'Третий', login: 'third', password: 'test-password-3' });
    assert.equal(a.status, 200);
    assert.equal((await request('login', { login: 'anna', password: 'wrong-password' })).status, 401);
    const invite = await request('invite', {}, a.token);
    assert.equal((await request('join', { code: invite.code }, b.token)).status, 200);
    assert.equal((await request('join', { code: invite.code }, c.token)).status, 400);
    assert.equal((await request('invite', {}, a.token)).status, 409);
    const entry = { wallet: 'shared', kind: 'income', amount: 4000000, category: 'Зарплата', date: '2026-11-04', note: '', requestId: 'shared-income' };
    assert.equal((await request('entries', entry, a.token)).status, 200);
    assert.equal((await request('entries', entry, a.token)).status, 200);
    await request('entries', { ...entry, wallet: 'personal', amount: 1500000, requestId: 'private-income' }, a.token);
    await request('entries', { ...entry, wallet: 'personal', kind: 'expense', amount: 12345, category: 'Секрет', requestId: 'private-expense' }, a.token);
    await request('entries', { ...entry, wallet: 'personal', amount: 9876, requestId: 'b-income' }, b.token);
    const aState = await request('state', undefined, a.token);
    const bState = await request('state', undefined, b.token);
    assert.equal(aState.entries.length, 3);
    assert.equal(bState.entries.length, 2);
    assert.equal(bState.entries.some(item => item.category === 'Секрет'), false);
    assert.equal(JSON.stringify(bState).includes('1500000'), false);
    assert.equal(aState.entries.some(item => item.amount === 9876), false);
    assert.equal((await request('state', undefined, c.token)).entries.length, 0);
    assert.equal((await request('entries', { ...entry, amount: 0, requestId: 'bad-amount' }, a.token)).status, 400);
    assert.equal((await request('entries', { ...entry, date: '2026-02-30', requestId: 'bad-date' }, a.token)).status, 400);
    assert.equal((await request('entries', entry, c.token)).status, 400);
    assert.equal((await request('state')).status, 401);
    await request('logout', {}, a.token);
    assert.equal((await request('state', undefined, a.token)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
