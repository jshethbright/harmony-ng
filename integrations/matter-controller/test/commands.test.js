import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommand, harmonyDevice, serialExecutor } from '../src/commands.js';
const prefix = 'harmony/matter';
test('Harmony pulses execute once; falling and retained pulses never execute', () => {
    assert.deepEqual(decodeCommand(prefix, `${prefix}/lamp/1/PowerOn`, Buffer.from('1')), { id: 'lamp', endpoint: 1, command: 'on' });
    assert.equal(decodeCommand(prefix, `${prefix}/lamp/1/PowerOn`, Buffer.from('0')), null);
    assert.equal(decodeCommand(prefix, `${prefix}/lamp/1/PowerOn`, Buffer.from('1'), true), null);
    for (const [name, command] of [['PowerOff','off'], ['PowerToggle','toggle']])
        assert.equal(decodeCommand(prefix, `${prefix}/lamp/2/${name}`, Buffer.from('1')).command, command);
});
test('malformed topics and arbitrary commands are rejected', () => {
    for (const topic of ['other/lamp/1/PowerOn', `${prefix}/lamp/0/on`, `${prefix}/lamp/65535/on`, `${prefix}/lamp/1/reboot`, `${prefix}/../1/on`, `${prefix}/lamp/1/on/extra`])
        assert.equal(decodeCommand(prefix, topic, Buffer.from('1')), null);
});
test('device export lets Hub allocate short RF-compatible id and has discrete power sequences', () => {
    const d = harmonyDevice('lamp', 'Lamp', 2);
    assert.equal(d.id, undefined);
    assert.equal(d.mqttTopic, `${prefix}/lamp/2/{command}`);
    assert.equal(d.powerOnSequence[0].command, 'PowerOn');
    assert.equal(d.powerOffSequence[0].command, 'PowerOff');
    assert.throws(() => harmonyDevice('../bad', 'Bad', 1));
});
test('commands preserve order, recover from errors, and bound backlog', async () => {
    const execute = serialExecutor(2);
    let release; const gate = new Promise(resolve => release = resolve);
    const seen = [];
    const a = execute(async () => { await gate; seen.push('on'); throw new Error('offline'); });
    const aHandled = a.catch(() => {});
    const b = execute(() => seen.push('off'));
    await assert.rejects(execute(() => {}), /queue full/);
    release(); await aHandled; await b;
    assert.deepEqual(seen, ['on', 'off']);
});
