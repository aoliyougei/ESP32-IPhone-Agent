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

The **Coordinate grid / 坐标网格** button beneath the preview enables a 10% grid,
axis labels and a hover crosshair. The readout uses normalized image coordinates
(0–1, origin at the top-left), rounded to three decimals; tap requests use the same
mapping at full precision. The overlay follows the actual image rectangle, not
letterbox margins, and is never included in API screenshots. Blank margins do not
send taps, swipes or scrolls. Grid display does not move the phone pointer or apply
calibration a second time. Compare a readout with `POST /api/tap` using
`{"x":0.250,"y":0.750}` and observe the real phone pointer after calibration;
actual landing accuracy still depends on calibration and hardware.

Layout checks (run in a development container, not the production image):

```sh
node --test tests/layout.test.cjs
# Optional real-browser check: requires playwright-core and Chromium.
node --test --test-concurrency=1 tests/layout.browser.cjs tests/grid.browser.cjs
```

## Double tap API

`POST /api/double_tap` accepts the same normalized coordinates as `/api/tap`:

```sh
curl -X POST http://SERVER_IP:8890/api/double_tap \
  -H 'Content-Type: application/json' \
  -d '{"x":0.25,"y":0.75}'
```

The server moves to the calibrated target once, sends two clicks with a 150 ms
pause between acknowledged clicks, then waits 150 ms. The actual click interval
also includes board command latency. Returns `{"ok":true}` on success, or HTTP 409
for missing calibration/device errors. No automatic retries; a failure may occur
after the first click has already executed. Recognition as a double click depends
on the phone's accessibility settings and the target app. No firmware changes required.
Manager's control proxy also permits this route after updating Manager.

## Docker / Kubernetes

For a Linux amd64 host-network image of this legacy server, including UxPlay and
GStreamer, see [docker/README.md](docker/README.md). A single-instance Kubernetes
`hostNetwork` example is included. Real iPhone mirroring still requires a LAN-connected host.

The default main firmware speaks BLE. To use this server's TCP HID control with main, build the firmware with
`bash hardware/flash.sh --tcp`; configure its Wi-Fi and `SERVER_HOST`/`SERVER_PORT` as described in
[hardware/README.md](../hardware/README.md). The board connects to the server's device listener (default 7300),
not its HTTP port (8890). No iPhone app is needed; screen input still comes from UxPlay.
