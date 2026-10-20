# Firmware: BLE or Wi-Fi TCP

The default main build is unchanged: BLE commands + board AirPlay receiver, with a hotspot for the iPhone app.
The optional `--tcp` build restores v0.1.0's Wi-Fi TCP HID protocol **without checking out an old branch**.
It retains BLE and the board AirPlay receiver; use one controller at a time to avoid interleaved gestures.
TCP carries HID commands only, not screenshots or video; a legacy server still uses UxPlay for its screen input.

## Mac: Wi-Fi TCP build (no iPhone app needed)

Requirements: arduino-cli, ESP32 core 3.3.1 (3.3.x), NimBLE-Arduino 2.5.1.
Run from the repository root; use a path without spaces. Default hardware is XIAO ESP32S3 (8 MB Flash, OPI PSRAM).

1. Create the local config once (do not overwrite it on subsequent flashes):

   ```sh
   cp hardware/hid_bridge/secrets.example.h hardware/hid_bridge/secrets.h
   open -e hardware/hid_bridge/secrets.h
   ```

2. Set `WIFI_SSID` and `WIFI_PASS` to your **2.4 GHz Wi-Fi**. Set `SERVER_HOST` to the server's reachable LAN IP
   and `SERVER_PORT` to its **device TCP port** (default 7300), not the web port (default 8890).
   Do not use `localhost`, the ESP32's IP, or an `http://` URL. Keep credentials local; `secrets.h` is git-ignored,
   but the compiled firmware also contains them, so do not publish that binary.

3. Compile first, then flash with the board attached to the Mac:

   ```sh
   bash hardware/flash.sh --tcp --debug --build-only
   arduino-cli board list
   bash hardware/flash.sh /dev/cu.usbmodem1101 --tcp --debug
   ```

   Replace the example port with the one listed on your Mac. Flashing replaces the previous firmware.
   The port may change after reset; list devices again before opening a serial monitor:

   ```sh
   arduino-cli monitor -p /dev/cu.usbmodemYOUR_PORT -c baudrate=115200
   ```

   Successful debug logs include `wifi: got ip ...` and `tcp: connected to HOST:PORT`.
   Close the monitor before another flash. Never paste credentials into logs or issue reports.

4. Start the existing server with its device listener reachable from the board. Its log should show
   `board connected from ... hello ...`. Allow inbound TCP 7300 (or your configured port) from the board;
   Docker must publish that port or use the project's host-network deployment.
   If no connection appears, check Wi-Fi, server IP, listener bind address, firewall and AP/client isolation.

5. Move the board's USB cable from the Mac to the **unlocked iPhone**, keeping the same Wi-Fi network in range.
   The board reconnects after receiving power. For mouse actions enable Settings → Accessibility → Touch →
   AssistiveTouch. No ESP32 Agent app is required. Verify via server status/commands after connecting to the phone;
   USB serial logging is no longer available on the Mac while the USB port is attached to the iPhone.

## TCP protocol and safety

The **board initiates** a persistent TCP connection to `SERVER_HOST:SERVER_PORT`; it does not listen on its own port.
On every connection it sends `hello <reset reason> <uptime ms>\n`.
The server then sends one command per line, waits for `ok\n` or `err <reason>\n`, and only then sends the next command:

```text
ping
move 10 0
click
key enter
```

Commands are shared with the BLE HID handler: `ping`, `home`, `move`, `press`, `release`, `click`, `scroll`, `type`,
`key`, `homescreen`. Unlike BLE, **no request ID** is prepended. `ping` checks the link, not USB readiness.
`type` uses the existing ASCII keyboard implementation, not Chinese/Unicode input.

Lines are limited to 4096 bytes before the newline; oversized lines are discarded with an error. Send a complete
line within 5 seconds or the connection is closed without executing it. Wi-Fi/TCP disconnects release held HID
inputs and clear partial commands. TCP reconnects are retried with a 1-second delay; Wi-Fi uses the existing backoff.
A server should send periodic `ping` commands (as the existing server does) to detect silent network failures.

**No authentication or encryption, matching the old protocol. Use only a trusted LAN or a restricted VPN/firewall;
never expose the device-control listener directly to the internet.**

## Return to the default build

```sh
bash hardware/flash.sh
```

This disables TCP and the build-time Wi-Fi override. Previously stored app network settings still apply.
`--sta` alone remains available for Wi-Fi/AirPlay testing without TCP control.

## Host tests

Inside a development container with C/C++ compilers:

```sh
make -C hardware/tests
python3 hardware/tests/test_flash.py
```

These cover the actual TCP transport with fake Wi-Fi and HID callbacks, plus the existing bplist/GOP tests.
They do not replace real ESP32/iPhone Wi-Fi, USB, radio coexistence or power testing.
