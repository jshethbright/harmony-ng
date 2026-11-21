import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validId, harmonyDevice } from './commands.js';

async function jsonBody(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 4096) throw new Error('Request too large');
    }
    return JSON.parse(text || '{}');
}

export function apiServer({ matter, token, execute, status, hubUrl }) {
    if (token && token.length < 24) throw new Error('API_TOKEN must contain at least 24 characters when authentication is enabled');
    const authorized = req => {
        if (!token) return true;
        const got = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${token}`);
        return got.length === expected.length && timingSafeEqual(got, expected);
    };
    return createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        try {
            const path = new URL(req.url, 'http://localhost').pathname;
            if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });
            if (req.method === 'GET' && path === '/readyz') return send(status().mqtt ? 200 : 503, status());
            if (req.method === 'GET' && path === '/api/config') return send(200, { authenticationRequired: Boolean(token) });
            if (req.method === 'GET' && (path === '/' || path === '/app.js')) {
                res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
                res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript' });
                return res.end(await readFile(new URL(path === '/' ? './index.html' : './app.js', import.meta.url)));
            }
            if (!authorized(req)) return send(401, { error: 'Bearer token required' });
            if (req.method === 'GET' && path === '/api/devices') return send(200, { devices: matter.list() });
            const remove = path.match(/^\/api\/devices\/([a-zA-Z0-9_-]+)$/);
            if (req.method === 'DELETE' && remove && validId(remove[1])) {
                await execute(() => matter.remove(remove[1]));
                return send(200, { ok: true });
            }
            if (req.method === 'POST' && path === '/api/commission') {
                const { id, pairingCode } = await jsonBody(req);
                if (!validId(id) || typeof pairingCode !== 'string' || pairingCode.length > 128 || !/^(?:MT:[A-Z0-9.\-]+|[0-9 -]{11,30})$/i.test(pairingCode)) return send(400, { error: 'Use a short device id and a Matter setup code from the new pairing window' });
                await execute(() => matter.commission(id, pairingCode));
                return send(201, { ok: true, id });
            }
            const match = path.match(/^\/api\/devices\/([a-zA-Z0-9_-]+)\/(\d+)\/(on|off|toggle|harmony)$/);
            if (match) {
                const [, id, ep, action] = match;
                const endpoint = Number(ep);
                if (!validId(id) || endpoint < 1 || endpoint > 65534) return send(400, { error: 'Invalid endpoint' });
                if (!matter.list().some(d => d.id === id && d.endpoints.some(e => e.endpoint === endpoint))) return send(404, { error: 'Unknown on/off endpoint' });
                if (action === 'harmony') {
                    const device = harmonyDevice(id, id, endpoint);
                    if (req.method === 'GET') return send(200, device);
                    if (req.method === 'POST' && hubUrl) {
                        const inventory = await fetch(`${hubUrl}/api/inventory`, { signal: AbortSignal.timeout(10000) });
                        if (!inventory.ok) throw new Error('Cannot read Hub inventory');
                        const existing = (await inventory.json()).devices.find(d => d.mqttTopic === device.mqttTopic);
                        if (existing) device.id = existing.id;
                        const response = await fetch(`${hubUrl}/api/device-save`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(device), signal: AbortSignal.timeout(10000),
                        });
                        if (!response.ok) throw new Error('Hub rejected device');
                        const saved = await response.json();
                        if (!saved.ok || !saved.deviceId) throw new Error('Hub did not save device');
                        device.id = saved.deviceId;
                        for (const command of device.commands) {
                            const result = await fetch(`${hubUrl}/api/command-save`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ deviceId: saved.deviceId, name: command.name, raw: 'G:MQTT' }),
                                signal: AbortSignal.timeout(10000),
                            });
                            if (!result.ok || !(await result.json()).ok) throw new Error('Cannot save Hub command');
                        }
                        return send(200, { ok: true, device });
                    }
                } else if (req.method === 'POST') {
                    return send(200, await execute(() => matter.command(id, endpoint, action)));
                }
            }
            send(404, { error: 'Not found' });
        } catch {
            // Neither pairing codes nor raw Matter exceptions are logged or reflected.
            send(400, { error: 'Operation failed. Check connectivity, endpoint, and whether the pairing window is open.' });
        }
    });
}
