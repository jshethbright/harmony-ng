# HarmonyNG Matter controller

Control Matter Wi-Fi On/Off endpoints from HarmonyNG activities and remote buttons. This service runs alongside the Hub on an IPv6-capable Linux host; it is not a Homebridge plugin and does not modify Homebridge. The Hub uses its existing MQTT device support.

```text
Elite / activity -> Harmony Hub -> authenticated MQTT -> controller -> Matter Wi-Fi device
                                                      Apple Home remains paired
```

## Installed deployment

The `harmony-matter` Helm release in namespace `agnes-apps` runs on node `agnes` (`10.0.0.82`).

- Pairing/control UI: `https://matter.jitarth.com` (Traefik ingress, cert-manager TLS)
- MQTT broker: `10.0.0.82:1883`, username `harmony`
- Credentials: Kubernetes Secret `harmony-matter-credentials`
- Persistent fabric keys and broker state: PVC `harmony-matter-data`
- LAN interface: `eno2`
- Hub: `http://10.0.0.86:8089`

The ingress is the only network entry point for the controller UI/API. The Matter process has no admin TCP listener: its API uses a Unix socket shared with a separate, ordinary pod-network web frontend. The frontend Service is ClusterIP, with no NodePort or host port; a NetworkPolicy restricts it to Traefik where the CNI supports NetworkPolicy enforcement. No admin listener runs on `10.0.0.82:8289` or `:8080`. The MQTT broker remains a separate password-protected LAN service so the Hub can reach it.

This deployment intentionally disables UI token authentication for the user's trusted LAN ingress. The page opens directly. To enable optional application authentication, set `auth.enabled=true` in the Helm values. The token, when enabled, can be retrieved locally:

```sh
kubectl -n agnes-apps get secret harmony-matter-credentials \
  -o jsonpath='{.data.api-token}' | base64 --decode
```

When optional authentication is enabled, paste the token into the UI's Controller token field. It stays in browser memory and is cleared on page reload.

## Pair a device already in Apple Home

1. Open the accessory's settings in Apple Home and enable its Matter pairing mode. Use the new setup code from that pairing window; do not factory-reset the accessory.
2. In the controller UI, choose a short id such as `living-room-lamp`, enter the new code, and press Pair. This adds a separate Matter fabric without removing Apple Home.
3. Test On and Off for the discovered endpoint.
4. Press **Add to Harmony Hub**. This creates an MQTT device and its PowerOn, PowerOff and PowerToggle commands. Repeating this uses the existing device, identified by its MQTT topic.
5. In HarmonyNG, add that device to the relevant activity's devices or add explicit commands to its sequences. Assign commands to physical or screen buttons as desired, then push the configuration to the remote.

When included as an activity device, its discrete power sequences participate in HarmonyNG's existing activity device logic. An explicit PowerOff step in an activity stop sequence still executes when leaving that activity, so use the activity device list for shared lights that should stay on across activities.

Only Matter devices with an On/Off cluster are supported. HomeKit-only accessories are not Matter devices. Brightness, color, covers, locks, Thread commissioning and factory-new Wi-Fi credential provisioning are outside this integration's scope. Devices must already be on the LAN and have an open commissioning window. Runtime control and pairing are local.

## MQTT contract

For peer id `lamp` and endpoint `1`:

| Topic | Payload | Meaning |
| --- | --- | --- |
| `harmony/matter/lamp/1/PowerOn` | `1` | On |
| `harmony/matter/lamp/1/PowerOff` | `1` | Off |
| `harmony/matter/lamp/1/PowerToggle` | `1` | Toggle |
| `harmony/matter/lamp/1/state` | `ON` / `OFF` | Last observed subscribed attribute, retained |
| `harmony/matter/lamp/1/result` | JSON | Command success/failure |
| `harmony/matter/availability` | `online` / `offline` | Controller MQTT availability, retained |

Harmony device topic template: `harmony/matter/lamp/1/{command}`. The Hub sends a `1` pulse followed by `0`. Only `1` invokes a command. Retained command messages are ignored on subscription/reconnect. Command subscriptions use QoS 0, avoiding replay queues after downtime. Commands are serialized with a bounded backlog; errors do not prevent later commands. The toggle action is not idempotent, so prefer discrete On and Off in activities.

## Build, test and upgrade

Requirements: Node.js 22+, npm, Helm, kubectl, a working Kubernetes context. The chart uses digest-pinned Node and Mosquitto images and lockfile-pinned npm dependencies. `npm ci` runs in an init container so no private image registry is needed. Source and lockfile are packaged into a ConfigMap. The npm package cache persists on the PVC: restarts try an offline install first. Initial installation and new dependency versions need npm registry access; normal operation and restarts with the populated cache do not. Container images must also be present in the node's image cache for an offline restart.

```sh
cd integrations/matter-controller
npm ci --ignore-scripts
npm test
npm run chart
helm lint chart
helm upgrade --install harmony-matter chart -n agnes-apps \
  --set 'nodeSelector.kubernetes\.io/hostname=agnes' --wait --timeout 5m
```

Run `npm run chart` after editing source; generated `chart/app/` is intentionally ignored by Git. The chart requires an existing Secret named in `values.yaml` with `api-token` (24+ random characters), `mqtt-password`, and a Mosquitto password file in `mosquitto-passwordfile` containing user `harmony`. Use `mosquitto_passwd` to generate that file. Never commit credentials or fabric storage.

Host networking is intentional for the Matter process: Matter uses LAN IPv6 and multicast DNS. Set `interface` and the node selector for your host. The controller binds an ephemeral Matter operational port; its admin API uses `/data/api/controller.sock`, not TCP. A separate frontend pod serves the ingress backend. Deployment strategy is Recreate, with one Matter replica, so two controllers never open the same fabric storage at once. The frontend's UID can access the shared socket but cannot read the controller's mode-0700 fabric directory. The PVC has Helm's keep policy and survives uninstall; back it up before deleting or migrating the installation.

To configure a different Hub, use `hubUrl`. Its MQTT settings must use this broker and password. Keep the Hub's `baseTopic` as `harmony/hub`; this service's device command namespace is independently `harmony/matter`.

## API

When optional token authentication is enabled, `/api/` routes require `Authorization: Bearer <api-token>`, except `/api/config`, which reports whether authentication is required.

- `GET /api/devices`: peers and discovered On/Off endpoints.
- `POST /api/commission`: `{ "id": "lamp", "pairingCode": "<new setup code>" }`.
- `POST /api/devices/lamp/1/on`, `/off`, `/toggle`: invoke On/Off cluster commands.
- `GET /api/devices/lamp/1/harmony`: export a HarmonyNG device configuration.
- `POST /api/devices/lamp/1/harmony`: add/update the MQTT device and commands on the configured Hub.
- `DELETE /api/devices/lamp`: remove this controller's fabric from that device. This does not remove Apple Home's fabric. Remove activity references and the corresponding HarmonyNG device separately.
- `GET /healthz`, `GET /readyz`: process health and controller/MQTT readiness.

The service uses matter.js 0.18's controller API. Unit tests cover pulse handling, rejected topics, replay safety, queue behavior, API authentication and secret redaction. `scripts/virtual-light.js` provides a local simulated Matter light for LAN integration tests; its temporary pairing code is written to a mode-0600 file rather than logged. Real-device commissioning and operation must also be checked with the intended accessories.
