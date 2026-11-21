import { connect } from 'mqtt';
import { mkdir, rm, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createMatter } from './matter.js';
import { apiServer } from './server.js';
import { decodeCommand, serialExecutor } from './commands.js';

const storage = process.env.MATTER_STORAGE_PATH || '/data/matter';
const prefix = 'harmony/matter';
const token = process.env.API_TOKEN;
if ((token && token.length < 24) || !process.env.MQTT_PASSWORD) throw new Error('MQTT_PASSWORD is required; API_TOKEN must be at least 24 characters if set');
await mkdir(storage, { recursive: true, mode: 0o700 });
const matter = await createMatter({ storage, networkInterface: process.env.MATTER_INTERFACE });
const execute = serialExecutor();
const mqtt = connect(process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', {
    clientId: 'harmony-matter-controller', username: process.env.MQTT_USER || 'harmony',
    password: process.env.MQTT_PASSWORD, clean: true,
    will: { topic: `${prefix}/availability`, payload: 'offline', retain: true },
});
mqtt.on('connect', () => {
    mqtt.subscribe(`${prefix}/+/+/+`, { qos: 0 });
    mqtt.publish(`${prefix}/availability`, 'online', { retain: true });
    console.log('MQTT connected');
});
mqtt.on('error', () => console.error('MQTT connection error'));
mqtt.on('message', (topic, payload, packet) => {
    const command = decodeCommand(prefix, topic, payload, packet.retain);
    if (!command) return;
    execute(() => matter.command(command.id, command.endpoint, command.command)).then(result => {
        mqtt.publish(`${prefix}/${command.id}/${command.endpoint}/result`, JSON.stringify({ ok: true, ...result }));
    }).catch(() => {
        mqtt.publish(`${prefix}/${command.id}/${command.endpoint}/result`, JSON.stringify({ ok: false, command: command.command }));
        console.error('Matter command failed for', command.id, command.endpoint);
    });
});
const server = apiServer({ matter, token, execute, status: () => ({ matter: true, mqtt: mqtt.connected }), hubUrl: process.env.HUB_URL });
if (process.env.API_SOCKET) {
    await mkdir(dirname(process.env.API_SOCKET), { recursive: true });
    await rm(process.env.API_SOCKET, { force: true });
    server.listen(process.env.API_SOCKET, async () => {
        await chmod(process.env.API_SOCKET, 0o660);
        console.log('HarmonyNG Matter controller ready (Unix socket)');
    });
} else {
    server.listen(Number(process.env.PORT || 8289), '127.0.0.1', () => console.log('HarmonyNG Matter controller ready (loopback)'));
}
const timer = setInterval(() => {
    if (!mqtt.connected) return;
    for (const device of matter.list().filter(d => d.connected)) for (const ep of device.endpoints) {
        if (typeof ep.on === 'boolean') mqtt.publish(`${prefix}/${device.id}/${ep.endpoint}/state`, ep.on ? 'ON' : 'OFF', { retain: true });
    }
}, 10000);
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    server.close();
    await mqtt.endAsync();
    await matter.close();
    process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
