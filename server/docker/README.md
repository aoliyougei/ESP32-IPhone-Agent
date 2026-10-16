# Legacy Server container (Linux amd64)

This image packages the existing `server/`, UxPlay (Debian Trixie package), GStreamer,
and container-private D-Bus/Avahi. No iPhone app, GPU, USB passthrough, privileged
container, or host filesystem/socket mount is required. Use **legacy Wi-Fi TCP
firmware**, not the current BLE firmware.

## Build and run

From the repository root:

```sh
docker build --platform linux/amd64 -t hidagent:local server
cp server/.env.example server/.env
# Edit server/.env: LLM_BASE_URL, LLM_MODEL, LLM_API_KEY.
docker run -d --name hidagent-a --network host \
  --env-file server/.env \
  -e AIRPLAY_NAME='iPhone Agent A' \
  -e AIRPLAY_PORT=35000 -e AIRPLAY_MAC=02:00:00:00:00:01 \
  --mount type=volume,source=hidagent-a-data,target=/data \
  --restart unless-stopped hidagent:local
docker logs -f hidagent-a
```

Use Docker env-file syntax: plain `KEY=value`, **without surrounding quotes or
inline comments**. The repository's `.env.example` is also used for shell-based
launches; remove its inline comments and quotes when preparing the Docker env file.
Never commit the filled-in file. `.dockerignore` excludes it from the build.

Open `http://NODE_LAN_IP:8890`. Configure ESP32 to connect to `NODE_LAN_IP:7300`.
On the iPhone, use Control Center > Screen Mirroring > **iPhone Agent A**.
Enable AssistiveTouch, calibrate using the web UI, and test a harmless task.

The Linux host must be reachable from the iPhone and ESP32. Allow LAN multicast
mDNS UDP 5353, TCP 8890/7300, and TCP+UDP 35000–35002 in its firewall. Host networking
needs no `-p` mappings. A cloud node or an isolated VLAN will not become discoverable
merely by using host networking. Avahi enumerates host interfaces: on multihomed
nodes, configure `allow-interfaces=` in `docker/avahi-daemon.conf` for the LAN NIC
before building, so unreachable bridge/CNI addresses are not advertised.

## Settings and multiple instances

| Environment | Default | Meaning |
|---|---|---|
| `PORT` | 8890 | Web/API listener |
| `DEVICE_PORT` | 7300 | ESP32 TCP listener |
| `AIRPLAY_NAME` | iPhone Agent | Receiver display name |
| `AIRPLAY_PORT` | 35000 | First of three TCP and UDP ports (1024–65533) |
| `AIRPLAY_MAC` | random | UxPlay device ID; use a unique stable MAC-formatted value |
| `HIDAGENT_DATA` | /data | Calibration and traces; mount persistent storage here |

A second instance needs, for example, PORT=8891, DEVICE_PORT=7301,
AIRPLAY_PORT=35010, AIRPLAY_MAC=02:00:00:00:00:02, a distinct AIRPLAY_NAME,
and a **different** data volume. Update its ESP32 firmware's SERVER_PORT too.
Do not overlap either instance's port group with any other host listener.

Each container starts its own Avahi with a private system bus. Avahi can coexist
on UDP 5353 using multicast socket sharing, but logs may warn about other mDNS
stacks. Same-node multi-instance discovery and any coexistence with host Avahi
must be validated on your LAN before relying on it. Do not disable unrelated
host services just to suppress warnings.

## Kubernetes

`kubernetes.yaml` is a single-instance starting point, not an applied deployment:

1. Make the image available on your node or in your own registry (publishing is a
   separate action). Replace `image` with the desired tag/digest.
2. Label the intended LAN-connected amd64 node `hidagent-lan=true`.
3. Create a Secret named `hidagent-model` with key `LLM_API_KEY`, using your secret
   management workflow. Adjust model URL and ID in the manifest.
4. Ensure a default StorageClass exists, or adapt the PVC to your storage system.
5. Apply the manifest in the same namespace as the Secret.

It uses `hostNetwork: true`, `ClusterFirstWithHostNet`, one replica, and Recreate
updates to avoid overlapping host ports. It does not use hostPath, privileged
mode, or a host D-Bus mount. The entrypoint starts as root for the private system
bus and Avahi privilege dropping; it is not compatible with a runAsNonRoot-only
policy as supplied. Host networking also requires an appropriate admission policy.
For multiple phones, create separately named Deployments/PVCs with distinct ports,
identities and selectors; **do not simply increase replicas on one node**.
HTTP probes indicate API availability, not whether a phone is mirroring.

## Verification

```sh
docker cp server/docker/smoke.py hidagent-a:/tmp/smoke.py
docker exec hidagent-a python /tmp/smoke.py
```

This checks HTTP status, the ESP32 TCP listener, required GStreamer plugins and a
UxPlay listener in the configured port range. Run before connecting a real board:
the TCP test briefly opens a fake board connection. It does not prove mDNS discovery,
AirPlay handshake, decoding real iPhone frames, model access, or HID control.
Stop/restart the container and repeat to check lifecycle behavior.

## Security and limitations

The legacy web/API and board TCP service have no authentication. Bind/firewall
them to a trusted LAN; do not publish them to the Internet. Host networking may
bypass expected container isolation/NetworkPolicy behavior. Screenshots and typed
content are sensitive, and the chosen model receives task screenshots.

Python dependencies currently resolve from `pyproject.toml` at image-build time,
not from `uv.lock`; rebuilds are not bit-for-bit reproducible. Pin a tested image
digest for deployment. UxPlay and its dependencies retain their own licenses
(including UxPlay GPLv3); distributing the image entails their notice/source obligations.
