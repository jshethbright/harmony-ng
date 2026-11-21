const $ = id => document.getElementById(id);
let token = '';
async function api(path, body) {
    const res = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function refresh() {
    try {
        const { devices } = await api('devices');
        $('devices').replaceChildren();
        for (const device of devices) {
            const section = document.createElement('section');
            const title = document.createElement('h2'); title.textContent = device.id; section.append(title);
            for (const endpoint of device.endpoints) {
                const row = document.createElement('p'); row.textContent = `Endpoint ${endpoint.endpoint}: `;
                for (const [action, label] of [['on', 'On'], ['off', 'Off'], ['harmony', 'Add to Harmony Hub']]) {
                    const button = document.createElement('button'); button.textContent = label;
                    button.onclick = async () => { try {
                        await api(`devices/${device.id}/${endpoint.endpoint}/${action}`, {});
                        $('status').textContent = action === 'harmony' ? 'Device added. Include it in your activity in the HarmonyNG web interface.' : `${label} command sent`;
                    } catch (e) { $('status').textContent = e.message; } };
                    row.append(button);
                }
                section.append(row);
            }
            $('devices').append(section);
        }
        $('status').textContent = devices.length ? `${devices.length} paired device(s)` : 'No devices paired yet';
    } catch (e) { $('status').textContent = e.message; }
}
$('login').onsubmit = e => { e.preventDefault(); token = $('token').value; $('token').value = ''; refresh(); };
$('pair').onsubmit = async e => {
    e.preventDefault(); $('pairButton').disabled = true; $('status').textContent = 'Pairing; this may take a minute…';
    const pairingCode = $('code').value; $('code').value = '';
    try { await api('commission', { id: $('device').value, pairingCode }); await refresh(); }
    catch (error) { $('status').textContent = error.message; }
    finally { $('pairButton').disabled = false; }
};
$('refresh').onclick = refresh;
fetch('/api/config').then(r => r.json()).then(config => {
    $('login').hidden = !config.authenticationRequired;
    if (!config.authenticationRequired) refresh();
}).catch(() => { $('status').textContent = 'Controller temporarily unavailable. Refresh in a moment.'; });
