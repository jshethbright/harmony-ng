import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { apiServer } from '../src/server.js';
const token = 'test-token-with-at-least-24-characters';
test('API requires auth, validates endpoint, and never leaks pairing secrets', async t => {
    const calls = [];
    const matter = {
        list: () => [{ id: 'lamp', endpoints: [{ endpoint: 1, on: false }] }],
        commission: async (...args) => { calls.push(args); throw new Error('SECRET FROM STACK'); },
        command: async (...args) => { calls.push(args); return { ok: true }; },
    };
    const server = apiServer({ matter, token, execute: fn => fn(), status: () => ({ mqtt: true }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => server.close());
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body) => fetch(url+path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await fetch(url+'/api/devices')).status, 401);
    assert.equal((await fetch(url+'/healthz')).status, 200);
    assert.equal((await post('/api/devices/lamp/1/on', {})).status, 200);
    assert.deepEqual(calls.pop(), ['lamp', 1, 'on']);
    assert.equal((await post('/api/devices/lamp/2/off', {})).status, 404);
    assert.equal((await post('/api/commission', { id: '../bad', pairingCode: '12345678901' })).status, 400);
    const response = await post('/api/commission', { id: 'lamp2', pairingCode: '12345678901' });
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.ok(!body.includes('SECRET') && !body.includes('12345678901'));
});
test('LAN ingress mode needs no token and tells the UI to omit login', async t => {
    const matter = { list: () => [] };
    const server = apiServer({ matter, execute: fn => fn(), status: () => ({ mqtt: true }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => server.close());
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(url+'/api/config')).json(), { authenticationRequired: false });
    assert.deepEqual(await (await fetch(url+'/api/devices')).json(), { devices: [] });
});
