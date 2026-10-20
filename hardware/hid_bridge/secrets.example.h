// Copy to secrets.h (git-ignored); never commit real credentials.
// --sta: join this Wi-Fi instead of opening a hotspot.
// --tcp: also connect to the legacy server's device TCP listener.
#define WIFI_SSID "your-2.4GHz-wifi"
#define WIFI_PASS "your-password"
#define SERVER_HOST "192.168.1.100"  // server LAN IP, not the ESP32 IP; no http:// prefix
#define SERVER_PORT 7300            // device TCP port, NOT the web/API port (8890)
