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

## Comparing automatic and manual calibration

The **Calibrate / 校准** button now attempts automatic four-stop axis calibration.
**Manual calibration / 手动校准** uses the same four-stop procedure below, replacing
visual detection with user-selected pointer centers. Both share sample validation,
span/offset fitting and saving; there is no separate Axis calibration button.
Back up `/data/calibration.json` first. Keep orientation and iOS pointer settings
unchanged and pause other controllers. This UI change does not enable X-then-Y
positioning: retain `HIDAGENT_AXIS_MOVE=1` to use the combination validated on the
tested device. Calibration is not a guarantee of full-screen accuracy.

For existing API clients, `POST /api/calibrate/start` with `{"manual":true}` still
uses the legacy single-point diagonal procedure (200/200, one finish request),
which clears old `seen` samples. The new manual UI instead sends `{"mode":"axis"}`.
An empty body or `{"manual":false}` starts automatic axis calibration. Success returns
`auto:true`; uncertain detection, missing mirroring, cancellation or device errors
return HTTP 409 with a reason. There is **no diagonal single-point fallback**: click
Manual calibration to start a new four-step procedure. Previous parameters remain
unchanged unless all four automatic samples validate and save successfully.
Manager's existing proxy supports these routes unchanged.

Automatic detection compares the before/after images of each real axis move, without
extra nudges or a guessed displacement. It includes the top and left edges, rejecting
ambiguous changes, incompatible dimensions and incorrect movement direction. Use a
still screen with a visible pointer, pause all other controllers and keep orientation
unchanged. Frame waits are bounded; reception timestamps cannot prove source-frame
freshness. Static-background synthetic tests do not establish reliability on every
real UI, pointer appearance or AirPlay delay. Detection may reject valid samples;
use manual calibration rather than weakening validation or adding compensation.

### Four-step manual calibration

Back up the calibration file first. Choose **Manual calibration / 手动校准** and wait
for the real pointer to settle after each move (including AirPlay latency). Click
its center four times as prompted: X=150 units, X=350 units total, then re-home,
Y=150 units, Y=350 units total. These are mouse units, **not target grid coordinates**.
The procedure never clicks the phone. Do not use other controllers while sampling.
Only after all four valid samples are collected are the new per-axis spans and
two-point offset samples saved. **Cancel calibration** uses the stop API to release
and attempt re-homing, preserving the previous saved calibration. Returning/closing
the page does not cancel the server-side procedure; stop it before normal operation.
Samples near the edge or with less than 0.03 separation are rejected: cancel if a
350-unit move reaches the screen boundary. This diagnostic does not guarantee an
accurate full-screen mapping and does not alter firmware pacing.

The existing endpoints accept `POST /api/calibrate/start` with `{"mode":"axis"}`,
then four `POST /api/calibrate/finish` calls with observed `{"x":...,"y":...}`.
Responses contain `step` (`x150`, `x350`, `y150`, `y350`, then null on completion).
During sampling, normal pointer targets are blocked; the stop API cancels it.

INFO logs now include pointer targets, calibration spans, tracked position, home
reasons, move deltas, and HID home/move/release/click acknowledgements and latency.
No screenshot or typed text is added to these logs. Save logs alongside each test
sequence; keep them private as target coordinates are still interaction metadata.
For comparison, repeat the same five API targets after backing up the previous data,
first with a stop before each target, then as one uninterrupted sequence.

### Diagnostic X-then-Y positioning

Set `HIDAGENT_AXIS_MOVE=1` in the server process environment and restart to compare
single-axis positioning with the default combined movement (`0` or unset). In Docker
Compose, add `HIDAGENT_AXIS_MOVE: "1"` under the server service's `environment`,
then run `docker compose up -d` to recreate it. A project `.env` alone does not pass
this variable into a container unless the Compose file references it or uses `env_file`.
`GET /api/status` reports `pointer_mode: "axis"` when enabled (`"combined"` otherwise);
`pointer target` logs also include the mode.

This diagnostic sends the entire X delta, waits for its acknowledgement, then sends
the Y delta before clicking/pressing. Zero-length axes are skipped; both moves count
as one positioning operation. A failed move leaves position unknown, prevents the
click, and forces the next positioning operation to re-home. Drag/swipe starting
positions use the mode, but movement while pressed keeps its existing path. Visual
`aim=True` correction, calibration, homing and keep-awake nudges are unchanged.

Back up and keep the current axis calibration, orientation and iOS pointer settings;
do not recalibrate between comparisons or use visual aiming. Pause other controllers.
Repeat `(0.25,0.20)`, `(0.25,0.50)`, `(0.25,0.80)` with stop before each target,
checking that the app's controls do not cover those positions. Save screenshots and
logs for each mode. This tests a movement-path hypothesis, not a proven accuracy fix.
It adds a command round trip and may make positioning slower. Set the variable to
`"0"` and recreate the container to revert; the calibration file is not changed by
switching this mode.

The 2026-10-26 device comparison showed improved landings and visually consistent
repeated targets with axis calibration plus this mode. This is evidence for the
tested device/settings, not a full-screen or drag accuracy guarantee. See
[validation notes](../docs/pointer-calibration-validation-2026-10-26.md) for the
sequences, log checks and limitations. The default remains combined positioning.

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
