# server/ (legacy)

This is the computer-side server of the original version (tag `v0.1.0`, branch `legacy`): UxPlay on a Mac or Linux
machine receives the screen, this Python server runs the agent and a web UI, and the ESP32 is only a USB mouse that
connects to it over Wi-Fi.

**The current version does not use it.** The board receives AirPlay itself and the agent runs in the iPhone app
(`ios/`), with its prompts in `prompts/`. This folder is kept so the legacy setup keeps working and its tests still
run in CI; it gets fixes, not new features. Its prompts are the older ones in `hidagent/agent.py` and are not synced
with `prompts/`.

## Web layout

Use the upper-right **Layout: portrait / landscape** button to switch layouts.
Portrait retains the three columns. Landscape places a wide phone preview above
its live log on the left, keeping task controls on the right (small screens stack
vertically). The browser remembers the choice. This changes presentation only:
it does not rotate the iPhone or replace pointer calibration after a device rotation.

Layout checks (run in a development container, not the production image):

```sh
node --test tests/layout.test.cjs
# Optional real-browser check: requires playwright-core and Chromium.
node --test tests/layout.browser.cjs
```

## Docker / Kubernetes

For a Linux amd64 host-network image of this legacy server, including UxPlay and
GStreamer, see [docker/README.md](docker/README.md). A single-instance Kubernetes
`hostNetwork` example is included. Real iPhone mirroring still requires a LAN-connected host.

The default main firmware speaks BLE. To use this server's TCP HID control with main, build the firmware with
`bash hardware/flash.sh --tcp`; configure its Wi-Fi and `SERVER_HOST`/`SERVER_PORT` as described in
[hardware/README.md](../hardware/README.md). The board connects to the server's device listener (default 7300),
not its HTTP port (8890). No iPhone app is needed; screen input still comes from UxPlay.
