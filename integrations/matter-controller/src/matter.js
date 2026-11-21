import { ServerNode, ControllerBehavior, Environment, Logger } from '@matter/main';
import { FabricAuthority } from '@matter/main/protocol';
import { OnOffClient } from '@matter/main/behaviors/on-off';

export async function createMatter({ storage, networkInterface }) {
    Logger.level = 'error'; // pairing material must not appear in routine discovery logs
    Environment.default.vars.set('storage.path', storage);
    if (networkInterface) Environment.default.vars.set('mdns.networkInterface', networkInterface);
    const node = await ServerNode.create(ServerNode.RootEndpointWithoutGroupcast.with(ControllerBehavior), {
        id: 'harmony-controller', commissioning: { enabled: false },
        controller: { adminFabricLabel: 'HarmonyNG' },
        subscriptions: { persistenceEnabled: false },
    });
    try {
        const authority = await node.env.load(FabricAuthority);
        await authority.defaultFabric({ adminFabricLabel: 'HarmonyNG' });
        await node.start();
    } catch (e) { await node.close(); throw e; }

    return {
        async commission(id, pairingCode) {
            if (node.peers.get(id)) throw new Error('That device id is already in use');
            await node.peers.commission({ id, pairingCode });
        },
        list() {
            return node.peers.commissioned.map(peer => ({
                id: peer.id,
                connected: peer.lifecycle.isConnected,
                endpoints: [...peer.endpoints].filter(ep => ep.maybeStateOf(OnOffClient) !== undefined)
                    .map(ep => ({ endpoint: ep.number, on: ep.stateOf(OnOffClient).onOff })),
            }));
        },
        async command(id, endpoint, command) {
            const peer = node.peers.get(id);
            if (!peer?.lifecycle.isCommissioned) throw new Error('Unknown commissioned device');
            await peer.start();
            const ep = peer.endpoints.for(endpoint);
            if (!ep || ep.maybeStateOf(OnOffClient) === undefined) throw new Error('Endpoint has no On/Off cluster');
            await ep.commandsOf(OnOffClient)[command]();
            return { id, endpoint, command };
        },
        async remove(id) {
            const peer = node.peers.get(id);
            if (!peer?.lifecycle.isCommissioned) throw new Error('Unknown commissioned device');
            await peer.start();
            await peer.decommission();
        },
        close: () => node.close(),
    };
}
