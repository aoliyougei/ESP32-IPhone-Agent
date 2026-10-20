#pragma once
#include <string>
#include <deque>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
using std::size_t;
class String : public std::string {
public:
  using std::string::string;
  String(const std::string &s) : std::string(s) {}
  size_t length() const { return size(); }
  bool isEmpty() const { return empty(); }
  void trim() {
    auto first = find_first_not_of(" \r\n\t");
    *this = first == npos ? "" : substr(first, find_last_not_of(" \r\n\t") - first + 1);
  }
};
inline uint32_t clockMs = 0;
inline uint32_t millis() { return clockMs; }
constexpr int WL_CONNECTED = 3;
inline struct { int state = WL_CONNECTED; int status() { return state; } } WiFi;
[[maybe_unused]] inline struct { void printf(const char *, ...) {} } Serial;
class WiFiClient {
public:
  static inline bool online = false, connectOk = true;
  static inline int attempts = 0;
  static inline std::deque<char> input;
  static inline std::string output;
  bool connected() { return online; }
  void stop() { online = false; input.clear(); }
  bool connect(const char *, uint16_t, int timeout) { ++attempts; return online = connectOk && timeout <= 1000; }
  void setNoDelay(bool) {}
  int available() { return input.size(); }
  int read() { int c = input.front(); input.pop_front(); return c; }
  size_t print(const String &s) { output += s; return s.size(); }
  void printf(const char *fmt, const char *reason, unsigned long up) {
    char b[128]; snprintf(b, sizeof b, fmt, reason, up); output += b;
  }
};
