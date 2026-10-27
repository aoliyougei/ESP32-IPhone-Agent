# Automatic Axis Calibration Implementation Plan

**Goal:** Automatic calibration samples the same four single-axis stops as manual calibration, retaining old parameters on failure.

**Architecture:** Detect the pointer from before/after frames of each actual calibration move, without probe nudges or assumed screen displacement. Use a calibration-only two-component difference detector to locate the destination from direction and leave legacy aim detection unchanged. Feed detected positions through the existing four-step validator/fitter. Capture settled frames with bounded waits; reject ambiguous images, resolution changes, disconnects and missing frames. On failure end sampling and instruct manual restart, never silently use diagonal fallback.

**Constraints:** No new dependency; no real phone operations; Docker-only execution; legacy manual=true single-point API remains compatible; positioning default unchanged; no publish.

## Tasks

- [x] Add synthetic JPEG tests for calibration-specific destination detection: both orientations, top/left-edge centers, horizontal/vertical and negative moves, unchanged/animated frames, size mismatch and incorrect direction. Run red in Docker, implement minimal detector using Pillow and standard library, run green.
- [x] Add phone orchestration tests: exact home/X150/X200/home/Y150/Y200 sequence, shared fit, four-point-only commit; invalid detections, stale/missing frames and device failures preserve disk/memory; mode axis manual flow and manual=true compatibility. Run red, implement bounded frame capture and automatic orchestration without extra probe moves, run green.
- [x] Update API/UI failure reporting and browser tests: no manual-single-point fallback after automatic failure; actionable manual restart message, no phantom sampling. Keep successful auto response shape. Add README limits.
- [x] Run full Server Python, Ruff, layout/grid/browser tests in Docker; inspect diff and document limitations. Do not commit or publish without request.

## Verification outcome

Docker: 86 Python tests passed, Ruff passed, 4 Node/Chromium checks passed. One existing Starlette/httpx deprecation warning. No phone operations, build/push or commits. Real pointer/background variation and AirPlay buffering remain unverified; conservative detector may require manual fallback. HTTP 409 carries the manual-restart instruction through the existing UI error message. Existing aim detector and legacy manual=true behavior remain unchanged.

## Review focus

Animated UI can resemble a pointer; fail closed on extra components or implausible shape. Receive timestamps are not source timestamps; require observed directional motion, not merely a fresh frame. Source dimensions must stay fixed. Cancellation must not restore sampling or save after stop. Do not mutate calibration before the fourth verified sample. Existing single-controller restriction remains; automatic routine must reject link changes.
