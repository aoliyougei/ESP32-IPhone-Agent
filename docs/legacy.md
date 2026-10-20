# The legacy version (v0.1.0)

v0.1.0 needed a computer next to the phone:

| | v0.1.0 (`legacy` branch) | current (`main`) |
|---|---|---|
| Eyes | UxPlay on a Mac/Linux computer | AirPlay receiver on the ESP32 itself |
| Brain | Python server + web UI on the computer | ESP32 Agent app on the same iPhone |
| Board ↔ brain | Wi-Fi TCP, line commands | BLE GATT ([ble-protocol.md](ble-protocol.md)) |
| Network | phone and computer on one Wi-Fi | board's own hotspot; model over cellular |
| On the phone | nothing installed | the app (built with Xcode) |

Why the change: the computer was the hard part to carry around and set up. Now the phone and a $7 board are the
whole system.

For Wi-Fi TCP HID control with the server on **main**, use the optional `hardware/flash.sh --tcp` build;
see [firmware setup](../hardware/README.md). It restores the outbound connection and line protocol without
reverting BLE/AirPlay changes. TCP does not carry screen/video data; the legacy server still uses UxPlay.

To reproduce the entire original version instead:

```bash
git clone -b legacy https://github.com/onehumanbeing/esp32-iphone-agent   # or: git checkout v0.1.0
```

and follow that README. The default main firmware uses BLE and is not compatible with the TCP server;
main built with `--tcp` is compatible with its HID control protocol.
