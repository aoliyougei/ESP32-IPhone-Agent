# Wi-Fi TCP compatibility implementation plan

**Goal:** Restore v0.1.0 outbound Wi-Fi TCP HID control as an opt-in main firmware build, preserving default BLE/AirPlay behavior.

**Approved scope:** ESP32 joins configured Wi-Fi and connects to SERVER_HOST:SERVER_PORT; newline commands and hello greeting match server/hidagent/device.py. No listener on the board, no server/API rewrite.

**Files:** hardware/hid_bridge/tcp_link.{h,cpp}, hid_bridge.ino, secrets.example.h, hardware/flash.sh, hardware/tests TCP host tests, CI, README documentation and legacy compatibility notes.

- [x] Write host-side tests compiling the real TCP module with minimal Arduino/Wi-Fi fakes; verify greeting, fragmented/CRLF commands, bounded lines, stalled lines, disconnect release, reconnect and Wi-Fi loss.
- [x] Run tests in Docker and inspect expected missing-module failure before implementing.
- [x] Add --tcp flag requiring secrets.h and enabling STA_FROM_SECRETS; validate server host/port at compile time.
- [x] Add nonblocking bounded TCP line handling, reconnect delay, hello greeting and disconnect safety; reuse run() on the main loop, not BLE-only async board commands.
- [x] Run host tests, existing hardware tests, server tests, shell checks, and both default and TCP Arduino builds in Docker.
- [x] Document Mac flashing, server port versus web port, trusted-LAN-only security, and hardware verification limits.

**Review focus:** Wi-Fi loss must close stale TCP; partial/oversized lines must not execute; held inputs must release on disconnect; no credentials committed; default BLE build must not require secrets.h.

Execution: inline in the current workspace; preserve pre-existing .pi/ files. No registry push, host mount, or hardware flash.

## Verification record

- Docker: python:3.12-slim-trixie; Arduino CLI 1.5.1, ESP32 core 3.3.1, NimBLE-Arduino 2.5.1.
- Host C/C++ tests pass with AddressSanitizer/UndefinedBehaviorSanitizer; LeakSanitizer disabled because it fails under this Docker environment's tracing constraints.
- Flash option self-check passes for default, --sta, --tcp/--debug and missing config.
- Server pytest: 28 passed; ruff check: passed.
- Default Arduino firmware: 1,463,571 bytes program, 79,304 bytes globals; exit 0.
- TCP/debug Arduino firmware: 1,479,119 bytes program, 80,648 bytes globals; exit 0.
- Review performed inline (no delegation requested): default no-secret build, API compatibility, line bounds/timeouts, connection direction, disconnect input cleanup, documentation and CI coverage checked.
- No physical ESP32/iPhone, actual Wi-Fi TCP, BLE coexistence or AirPlay test performed. No iOS build (unmodified).
