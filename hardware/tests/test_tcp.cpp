// Compile the actual transport against a fake radio; no USB/HID actions are performed.
#include "tcp_stubs/WiFi.h"
#include <cassert>
#include <vector>
#define TCP_CONTROL 1
#include "../hid_bridge/tcp_link.cpp"

static int releases = 0;
static std::vector<std::string> commands;
const char *resetReason() { return "power-on"; }
void releaseInputs() { ++releases; }
String run(const String &s) { commands.push_back(s); return s == "bad" ? "err unknown command" : "ok"; }
static void feed(const std::string &s) { for (char c : s) WiFiClient::input.push_back(c); }
int main() {
  tcp_poll();
  assert(WiFiClient::attempts == 1);
  assert(WiFiClient::output == "hello power-on 0\n");
  feed("mo"); tcp_poll(); assert(commands.empty());
  feed("ve 10 0\r\n\nping\nbad\n");
  for (int i = 0; i < 4; ++i) tcp_poll();
  assert((commands == std::vector<std::string>{"move 10 0", "ping", "bad"}));
  assert(WiFiClient::output == "hello power-on 0\nok\nok\nerr unknown command\n");

  // Never execute a truncated command, even if the suffix is itself a command.
  feed(std::string(4097, 'x') + "click\n");
  for (int i = 0; i < 100; ++i) tcp_poll();
  assert(commands.size() == 3);
  assert(WiFiClient::output.find("err command too long\n") != std::string::npos);
  feed("ping\n"); tcp_poll(); assert(commands.back() == "ping");

  feed("click"); tcp_poll();
  int before = releases;
  clockMs += 5001; tcp_poll();
  assert(!WiFiClient::online && releases == before + 1);
  assert(commands.size() == 4); // no newline, no execution
  clockMs += 2000; tcp_poll();
  assert(WiFiClient::online);
  feed("ping\n"); tcp_poll(); assert(commands.size() == 5);

  before = releases;
  WiFi.state = 0; tcp_poll();
  assert(!WiFiClient::online && releases == before + 1);
  WiFi.state = WL_CONNECTED;
  WiFiClient::connectOk = false;
  clockMs += 2000; tcp_poll();
  int attempts = WiFiClient::attempts;
  tcp_poll(); assert(WiFiClient::attempts == attempts);
  WiFiClient::connectOk = true;
  clockMs += 2000; tcp_poll(); assert(WiFiClient::online);
  before = releases;
  WiFiClient::online = false; tcp_poll();
  assert(releases == before + 1);
  clockMs += 2000; tcp_poll();
  size_t count = commands.size();
  feed(std::string("click\0ignored\n", 14)); tcp_poll();
  assert(!WiFiClient::online && commands.size() == count);
  clockMs += 2000; tcp_poll();
  // Exactly the limit is accepted; empty and whitespace-only lines are ignored.
  feed(std::string(4096, 'a') + "\n");
  for (int i = 0; i < 20; ++i) tcp_poll();
  assert(commands.back().size() == 4096);
  count = commands.size();
  feed(" \r\n"); tcp_poll(); assert(commands.size() == count);
  puts("TCP transport tests passed");
}
