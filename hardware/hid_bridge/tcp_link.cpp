// v0.1.0 wire protocol: outbound connection, hello greeting, newline HID commands.
#if TCP_CONTROL
#include <WiFi.h>
#include "secrets.h"

static_assert(sizeof(SERVER_HOST) > 1, "SERVER_HOST must not be empty");
static_assert(SERVER_PORT > 0 && SERVER_PORT <= 65535, "SERVER_PORT must be 1-65535");
String run(const String &line);
const char *resetReason();
void releaseInputs();

static WiFiClient server;
static String line;
static bool linked = false, overflow = false;
static uint32_t retryAt = 0, lineAt = 0;
static constexpr size_t MAX_LINE = 4096;

static void disconnectTcp() {
  server.stop();
  if (linked) releaseInputs();
  linked = false;
  line = "";
  overflow = false;
  retryAt = millis() + 1000;
}

void tcp_poll() {
  if (WiFi.status() != WL_CONNECTED || (linked && !server.connected())) {
    disconnectTcp();
    return;
  }
  if (!linked) {
    if ((int32_t)(millis() - retryAt) < 0) return;
    if (!server.connect(SERVER_HOST, SERVER_PORT, 1000)) {
      retryAt = millis() + 1000;
      return;
    }
    linked = true;
    server.setNoDelay(true);
    server.printf("hello %s %lu\n", resetReason(), (unsigned long)millis());
#if DEBUG_SERIAL
    Serial.printf("tcp: connected to %s:%d\n", SERVER_HOST, SERVER_PORT);
#endif
  }
  // Drop an unfinished line, never execute a timed-out prefix as the old readStringUntil did.
  if ((!line.isEmpty() || overflow) && (uint32_t)(millis() - lineAt) > 5000) {
    disconnectTcp();
    return;
  }
  // Bound work per loop so a flooding peer cannot starve the watchdog or BLE.
  for (int budget = 256; budget && server.available(); --budget) {
    int c = server.read();
    if (c < 0) break;
    if (c == 0) {  // embedded NULs must not truncate a command at the HID parser
      disconnectTcp();
      return;
    }
    if (line.isEmpty() && !overflow) lineAt = millis();
    if (c == '\n') {
      if (overflow) {
        server.print("err command too long\n");
      } else {
        line.trim();
        if (!line.isEmpty()) server.print(run(line) + "\n");
      }
      line = "";
      overflow = false;
      return;
    }
    if (line.length() < MAX_LINE && !overflow) line += (char)c;
    else overflow = true;
  }
}
#endif
