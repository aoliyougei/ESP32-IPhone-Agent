# Changelog

## Unreleased (main)

- No computer: the ESP32 is the AirPlay receiver (ported from UxPlay) with its own hotspot, and talks to a new
  iPhone app over BLE. The app is the agent: planner/actor loop, pointer calibration, run replay, Live Activity,
  widgets, Siri and Shortcuts, self-healing when the board, hotspot or mirroring drops.
- Prompts moved to `prompts/`.
- Product name: ESP32 Agent.
- `server/` is legacy and no longer needed.

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
