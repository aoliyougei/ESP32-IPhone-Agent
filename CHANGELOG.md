# Changelog

## Unreleased (main)

- No computer: the ESP32 is the AirPlay receiver (ported from UxPlay) with its own hotspot, and talks to a new
  iPhone app over BLE. The app is the agent: planner/actor loop, pointer calibration, run replay, Live Activity,
  widgets, Siri and Shortcuts, self-healing when the board, hotspot or mirroring drops.
- Prompts moved to `prompts/`.
- Product name: ESP32 Agent.
- `server/` is legacy and no longer needed.

## v0.1.31

- Legacy Server: add Chinese display names for tianyan_tongfu (天眼通符), nver_hong (女儿红), and hugu_jiu (虎骨酒), covering all 219 registered classes (IDs 0–218).
- Extend mapping regression coverage; detection, OCR targets and phone controls are unchanged.
- CPU Server images: v0.1.31, test and latest. Manager is unchanged; YOLO weights are not bundled and Python package metadata remains 0.1.20.

## v0.1.30

- Legacy Server: add Chinese display names for the 60 appended classes (IDs 156–215), covering all 216 names in XYQ-CLASSES.md while preserving existing translations and model-owned class identities.
- Add a mapping regression test. OCR targets, inference preprocessing and phone controls are unchanged; newly translated classes do not automatically trigger OCR.
- CPU Server images: v0.1.30 and test. Manager is unchanged; weights are not bundled and Python package metadata remains 0.1.20.

## v0.1.29

- Legacy Server: add CPU OCR of battle_round_counter regions by class name, exposing raw text, recognition scores and original/crop coordinates without integer parsing or automatic actions.
- Add a battle-round Web result panel and Chinese display names for the eight new 156-class model labels, including old_shrimp_npc as 老虾. New NPC body classes do not trigger OCR.
- Preserve existing map, task and dialogue OCR and square-padded 960 inference. Validate 117 Python tests and five frontend tests; real 156-class weights and battle-round screenshot accuracy have not been verified.
- Build CPU Server image v0.1.29. Manager is unchanged; YOLO weights are not bundled and Python package metadata remains 0.1.20.

## v0.1.28

- Legacy Server: preserve original image proportions and center on an RGB (114,114,114) square canvas before YOLO inference; default input size is now 960.
- Restore detections by subtracting canvas padding only, clamp to original image bounds and discard padding-only boxes. Do not scale returned Ultralytics coordinates twice.
- Preserve original screenshots, OCR coordinates and model class mappings, including map_entry=77. Existing deployments explicitly configured at 640 must set HIDAGENT_YOLO_IMGSZ=960.
- Verify real model forward tensors are [1,3,960,960] on Ultralytics 8.3.40 for landscape, portrait and odd-size frames; add a reproducible opt-in real-weight check.
- Validate 116 Python tests and five frontend tests. Publish CPU Server images under v0.1.28 and test; weights are not bundled, package metadata remains 0.1.20. No game-image accuracy guarantee or Manager changes.

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
