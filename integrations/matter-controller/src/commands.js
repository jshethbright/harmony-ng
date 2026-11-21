const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
export function validId(id) { return typeof id === 'string' && ID.test(id); }

// HarmonyNG publishes a momentary 1, then 0, for each MQTT device command.
// Only the rising pulse is an action. Retained commands must never run on reconnect.
export function decodeCommand(prefix, topic, payload, retained = false) {
    if (retained || !topic.startsWith(`${prefix}/`)) return null;
    const parts = topic.slice(prefix.length + 1).split('/');
    if (parts.length !== 3) return null;
    const [id, endpointText, name] = parts;
    if (!validId(id) || !/^\d{1,5}$/.test(endpointText)) return null;
    const endpoint = Number(endpointText);
    if (endpoint < 1 || endpoint > 65534) return null;
    const command = ({ PowerOn: 'on', PowerOff: 'off', PowerToggle: 'toggle', on: 'on', off: 'off', toggle: 'toggle' })[name];
    if (!command || payload.toString().trim() !== '1') return null;
    return { id, endpoint, command };
}

export function harmonyDevice(id, name, endpoint) {
    if (!validId(id) || !Number.isInteger(endpoint) || endpoint < 1 || endpoint > 65534) throw new Error('Invalid device or endpoint');
    return {
        name, manufacturer: 'Matter', model: id,
        type: 'MQTT', mqttEnabled: true,
        mqttTopic: `harmony/matter/${id}/${endpoint}/{command}`, mqttPulseMs: 100,
        commands: ['PowerOn', 'PowerOff', 'PowerToggle'].map(name => ({ name, keyCode: 'G:MQTT', raw: '' })),
        powerOnSequence: [{ type: 'Command', command: 'PowerOn', delay: 0 }],
        powerOffSequence: [{ type: 'Command', command: 'PowerOff', delay: 0 }],
        powerOnDelay: 0, interDeviceDelay: 0, interKeyDelay: 0,
    };
}

export function serialExecutor(limit = 32) {
    let chain = Promise.resolve();
    let pending = 0;
    return task => {
        if (pending >= limit) return Promise.reject(new Error('Command queue full'));
        pending++;
        const result = chain.then(task);
        chain = result.catch(() => {}).finally(() => pending--);
        return result;
    };
}
