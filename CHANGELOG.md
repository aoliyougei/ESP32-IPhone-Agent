# Changelog

## Unreleased (main)

- No computer: the ESP32 is the AirPlay receiver (ported from UxPlay) with its own hotspot, and talks to a new
  iPhone app over BLE. The app is the agent: planner/actor loop, pointer calibration, run replay, Live Activity,
  widgets, Siri and Shortcuts, self-healing when the board, hotspot or mirroring drops.
- Prompts moved to `prompts/`.
- Product name: ESP32 Agent.
- `server/` is legacy and no longer needed.

## v0.1.27

- Legacy Server: add CPU-only RapidOCR reading of map_entry, quest_panel and every valid dialog_option region from the same original YOLO frame.
- Show map information, task text and NPC dialogue options with raw lines and recognition scores. Dialogue options are displayed top-to-bottom; original and padded crop coordinates are exposed via the API.
- Bundle Chinese/English ONNX models in YOLO-enabled Docker builds; HIDAGENT_OCR=0 disables OCR. No runtime model download is required.
- Keep OCR errors separate from YOLO failures, reuse the engine, and remove the eight-region OCR cap so dialogue options are not truncated.
- Validate 113 Python tests and five frontend tests; real game accuracy is not guaranteed. No automatic clicks or coordinate parsing. Manager is unchanged.
- Publish CPU Server images under v0.1.27 and test. YOLO weights are not bundled; package metadata remains 0.1.20.

## v0.1.24

- Legacy Server: accept dynamic detection class mappings, including the 148-class xyq model (`front=38`, `back=3`), instead of requiring the original two fixed IDs.
- Return original class names in detection responses; display Chinese translations by name with raw-name fallback and stable class colors.
- Add `HIDAGENT_YOLO_IMGSZ` (default 640; set 960 for the new xyq weights), validated as a multiple of 32 from 32 to 4096.
- On detection failure, disable inference and resume raw preview while retaining the error; retry only after the user explicitly enables detection again.
- Verify 106 Python tests, five frontend tests and real 148-class weight loading/blank-image CPU inference. No OCR, automatic actions, NVIDIA validation or game-image accuracy guarantee.
- Build the CPU Server image as `v0.1.24`; Manager is unchanged. Weights are not bundled; Python package metadata remains at 0.1.20.

## v0.1.23

- Legacy Server: optional YOLO front/back detection on the live phone preview, with green/orange boxes and confidence scores. Detection is off by default and does not automate clicks.
- Add serialized background inference and same-frame image/box responses; preserve raw screenshots, calibration and pointer controls.
- Select CPU or the first visible NVIDIA GPU via `HIDAGENT_YOLO_DEVICE=cpu|nvidia`; invalid or unavailable devices fail explicitly without silent fallback.
- Add optional CPU/CUDA Docker dependency profiles and trusted model-path configuration. Model weights are not included in images or this release.
- Manager: allow the detection API through the saved-server console proxy.
- Validate 95 Server Python tests, 14 Manager Python tests and five frontend tests; the operator confirmed deployment testing. NVIDIA inference and independent model accuracy were not verified.
- Publish the tested CPU Server and Manager images under `v0.1.23` and `latest`; image package metadata remains at 0.1.20, matching the tested artifacts.

## v0.1.20

- Legacy Server: align automatic calibration with the four-stop axis procedure and share manual sample validation, fitting and saving.
- Add calibration-only image-difference detection without guessed probe displacement; leave Agent aim detection unchanged.
- On uncertain detection, missing/unstable frames, cancellation or device changes, preserve previous calibration and report an error directing users to Manual calibration; remove automatic diagonal fallback.
- Automatic visual detection has synthetic/container coverage but has not yet been validated on a real iPhone. Back up calibration and retain the manual option.
- Synchronize package versions; Manager has no functional changes. X-then-Y positioning remains opt-in.

## v0.1.19

- Legacy Server: use the existing four-step axis procedure for the Manual calibration button; remove the separate Axis calibration button.
- Keep automatic calibration and the legacy single-point manual API unchanged; X-then-Y positioning remains opt-in.
- Update calibration documentation and browser coverage; synchronize package versions. Manager has no functional changes.

## v0.1.18

- Legacy Server: fix automatic-to-manual calibration fallback; add forced manual and four-step axis calibration.
- Add opt-in X-then-Y positioning (`HIDAGENT_AXIS_MOVE=1`); combined movement remains the default.
- Protect calibration saves with temporary-file replacement; clear sampling state on stop, including disconnects.
- Add pointer diagnostics, regression coverage and documented device-test results and limitations.
- Synchronize Server, Manager and Pi package metadata; Manager has no functional changes in this release.

## v0.1.0

- Computer-side version: UxPlay + Python server + web UI; the ESP32 is a USB HID bridge over Wi-Fi.
