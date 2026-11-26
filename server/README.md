# server/ (legacy)

This is the computer-side server of the original version (tag `v0.1.0`, branch `legacy`): UxPlay on a Mac or Linux
machine receives the screen, this Python server runs the agent and a web UI, and the ESP32 is only a USB mouse that
connects to it over Wi-Fi.

**The current version does not use it.** The board receives AirPlay itself and the agent runs in the iPhone app
(`ios/`), with its prompts in `prompts/`. This folder is kept so the legacy setup keeps working and its tests still
run in CI; it gets fixes, not new features. Its prompts are the older ones in `hidagent/agent.py` and are not synced
with `prompts/`.

## Optional YOLO front/back detection

The **YOLO detection / YOLO 检测** switch below the phone preview is off by default.
When enabled, inference runs on the server: green boxes label **Front / 正面**,
orange boxes label **Back / 背面**, with confidence scores. Other model classes are
shown with stable name-based colors. Chinese display names are mapped by raw class
name, not ID; unknown names fall back to the original name. All detected classes
are shown; colors are not guaranteed unique. Boxes do not intercept
clicks or change Agent screenshots, pointer calibration or device actions.
Each displayed image is the exact frame used for its boxes. Inference is serialized,
busy requests are rejected rather than queued, and CPU speed determines preview
refresh rate. Detection errors clear the boxes, automatically switch detection off and resume
the ordinary live view; the error stays beside the switch. Toggle detection back
on explicitly after fixing the cause; there is no automatic inference retry loop. First use loads the model and may take longer.
No automatic clicks or front/back conflict correction are performed.

Build from `server/` with one optional dependency profile:

```sh
# CPU-only PyTorch
 docker build --build-arg YOLO_RUNTIME=cpu -t hidagent:yolo-cpu .
# CUDA 12.4 PyTorch (can also run on CPU)
 docker build --build-arg YOLO_RUNTIME=nvidia -t hidagent:yolo-nvidia .
```

The default `YOLO_RUNTIME=none` retains the original lightweight dependencies.
For an existing Python environment, install PyTorch 2.5.1 / torchvision 0.20.1
from the appropriate CPU or CUDA index, then install `.[yolo,ocr]`. The extra pins
Ultralytics 8.3.40 and NumPy <2 to match the delivered model's training environment.
The optional dependencies are installed via pip; the existing base-only `uv.lock`
is not a lockfile for this extra.

Place the trusted project's `yolov8n/best.pt` in the deployment's existing data
volume, for example `/data/best.pt`. The server Docker build context does not include
the repository-root weights and does not download any model. Configure the process
(or the service's Compose `environment`) and restart:

```env
HIDAGENT_YOLO_MODEL=/data/best.pt
HIDAGENT_YOLO_DEVICE=cpu
HIDAGENT_YOLO_IMGSZ=960
# For the xyq 148-class model, set HIDAGENT_YOLO_IMGSZ=960.
# Or: HIDAGENT_YOLO_DEVICE=nvidia
```

`cpu` is the default. `nvidia` maps to `cuda:0`, the first **container-visible** GPU.
Other values are rejected. NVIDIA requires a compatible host driver, NVIDIA Container
Toolkit, a GPU-enabled container configuration (e.g. `--gpus all`), and CUDA-enabled
PyTorch. A CPU-only image cannot enable CUDA just by changing this variable.
GPU errors never silently fall back to CPU. A project `.env` alone does not inject
variables into an existing container. Missing dependencies/weights only disable
inference, not the normal phone controls. The model must have task `detect` and a valid nonempty class-name mapping.
Class IDs and counts may change: for example, `front=38` and `back=3` are supported.
Restart the server after changing model files or environment variables; weights are
loaded once and are not hot-reloaded. Only load trusted `.pt` files: PyTorch checkpoints
can execute code. Review Ultralytics/model licensing before redistribution.

Inference parameters: `imgsz=HIDAGENT_YOLO_IMGSZ` (default 960), `conf=0.25`,
`iou=0.7`, class-aware NMS. Input size must be a multiple of 32 from 32 to 4096.
Use 960 for the xyq 148-class model; benchmark CPU latency rather than assuming
the same speed as 640. Existing deployments explicitly setting 640 must change
the environment to 960 and recreate/restart the server.

Preprocessing preserves original pixels and aspect ratio: first center the RGB
image on a square canvas of side `max(width,height)`, filled with `(114,114,114)`.
Odd padding puts the extra pixel on the right/bottom. Pass that square PIL image to
Ultralytics, which performs its own proportional resize to 960. There is no manual
stretch or resize. Verified with Ultralytics 8.3.40 and a model forward pre-hook:
1920x888, 888x1920 and 1921x888 inputs each reached the model as `[1,3,960,960]`.
Ultralytics `boxes.xyxy` are already restored to the padded canvas size: subtract
only left/top padding, clamp to original width/height, and discard zero-area boxes.
Do not rescale those coordinates again. Web and OCR still use original-image
pixels; raw screenshots and class mappings (including map_entry=77) are unchanged.
`GET /api/detection` returns `{image, width, height, boxes, elapsed_ms}`: image is
base64 JPEG, boxes contain `{class_id, class_name, confidence, xyxy}` in original pixels.
The image is sensitive screen data, just like `/api/frame.jpg`; keep both server
and Manager on a trusted network. Responses are not cached or saved to disk.
No independent game-screenshot accuracy or real-device latency is guaranteed;
training-set scores in `yolov8n/xyq-model-integration.md` are not deployment metrics.

## On-demand region OCR without YOLO

`POST /api/ocr/region` reads the latest mirrored screenshot directly, without
loading YOLO or enabling detection. Keep `HIDAGENT_OCR=1` and install the OCR extra
(or use a CPU/NVIDIA inference image). No saved region or Web selection UI is required.

```bash
curl -X POST http://SERVER:8890/api/ocr/region \
  -H 'Content-Type: application/json' \
  -d '{"region":[0.10,0.20,0.50,0.35]}'
```

`region` is `[left, top, right, bottom]` in normalized original screenshot
coordinates (not browser coordinates): finite values within 0..1, positive area.
Left/top round down and right/bottom round up to pixels. There is no extra margin.
Response: `width`, `height`, pixel `xyxy`, `lines` containing `text` and `confidence`,
`elapsed_ms`, and `error: null`. Empty text is a successful empty `lines` array.
Errors: 422 invalid region, 404 no live screenshot, 409 another region request is
running, 503 OCR disabled/unavailable or processing failed. Responses are not cached.
Client cancellation does not release the busy gate until the worker completes.
YOLO OCR and this endpoint serialize use of the shared CPU engine. Recognition
scores are not correctness guarantees; this endpoint does not click or parse text.

Through an updated Manager use
`POST /servers/{server_id}/api/ocr/region` with the same body. Older Manager images
must be updated to proxy this route. Layout/rotation changes may require new coordinates.

## CPU OCR: selected map, task, dialogue, battle and shop regions

When YOLO detection is enabled, RapidOCR reads `map_entry` (map name and
coordinates at the top left), `quest_panel` (the right-side task tracker), and
**every detected `dialog_option`** (NPC dialogue option), `battle_round_counter`
(battle round text), `shop_description_panel` (shop description),
`battle_auto_remaining_rounds` (remaining automatic rounds), and **every detected
`shop_item_option`** (shop item option), and `shop_item_attribute_popup`
(item attribute popup). Matching uses class names, not fixed IDs.
Output remains raw text and scores, without parsing coordinates or round integers.
More detected item options mean
more CPU OCR work per frame; every valid target is processed without a region cap.
The seven added NPC classes are display-only and do not trigger OCR. `dialog_close_button`,
NPC body classes, `current_task_panel` and all other classes are excluded.
Dialogue body text outside an option box is not recognized. OCR runs on the exact
original JPEG used for detection, not the 960/640 resized tensor or the annotated
preview. Crops have a four-pixel margin clamped to frame bounds. Text detection,
direction classification and recognition run on each crop to support multiple lines.

The eight panels below the preview show raw recognized lines and recognition scores.
Dialogue and shop item options appear top-to-bottom, with left-to-right ordering for equal top
coordinates, independently of YOLO confidence ordering. Each option remains a
separate region, including empty/error results.
Coordinates are not parsed into X/Y values. Recognition scores are not calibrated
correctness probabilities; high-score characters can still be wrong. OCR does not
click, submit tasks or change Agent prompts. Missing regions, no recognized text,
and OCR errors have distinct display states. Results clear on missing targets,
detection disable/failure and frame changes; no old-frame OCR cache is used.

`YOLO_RUNTIME=cpu` and `YOLO_RUNTIME=nvidia` Docker builds now include the `ocr`
extra: `rapidocr-onnxruntime==1.4.4` and `onnxruntime==1.20.1`. This deliberately
uses the bundled-model RapidOCR 1.x API, not the newer `rapidocr` API. The package
includes Chinese/English ONNX models; startup does not download model files.
For non-Docker installations install `.[yolo,ocr]` after the appropriate PyTorch
build. The base `uv.lock` does not cover these optional pip-installed extras.
Models/source licensing must be reviewed before redistribution.

OCR always uses **CPUExecutionProvider**, even if YOLO uses NVIDIA. Two intra-op
threads and one inter-op thread are configured per engine. The engine loads lazily
when a target is first detected and is reused inside the serialized detection
worker. `HIDAGENT_OCR=1` (default) enables it; `HIDAGENT_OCR=0` disables it while
retaining YOLO. Restart after changing this variable or repairing a failed OCR
initialization: initialization failure is cached to avoid repeated expensive loads.
The default lightweight `YOLO_RUNTIME=none` image still has no inference extras.

All valid target OCR regions returned by YOLO are processed in its output order;
the previous eight-region OCR cap has been removed so dialogue options are not
truncated. Invalid/out-of-frame regions are skipped and the skipped count is
displayed. YOLO's own detection limits still apply. Many options increase CPU
latency; no extra frame queue is introduced.
No screenshots or recognized text are intentionally saved or uploaded. Errors log
stack traces server-side, not the recognized content. OCR errors do not fail YOLO
or the raw preview; the API returns them inside `ocr`.

`GET /api/detection` adds an `ocr` object with `enabled`, `regions`, `error`,
`skipped`, and `elapsed_ms`. Each region has `class_name`, the original YOLO box `source_xyxy`, the clamped crop `xyxy`,
`lines: [{text, confidence}]` and `error`. Line order is the OCR engine's reading
order; no document-layout semantics are inferred. Detection `elapsed_ms` remains
YOLO inference timing; OCR has its own elapsed time, including first initialization.
The existing Manager detection proxy requires no new route.

OCR increases detection-mode preview latency. CPU synthetic Chinese samples verify
execution, not real-game accuracy: one test misread 钟馗 as 钟道 despite a high
score. Validate actual map/task screenshots, small fonts, compression and scrolling
before relying on the text. No game-image accuracy or refresh-rate guarantee.

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
