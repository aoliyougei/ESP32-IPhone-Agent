#pragma once

#if TCP_CONTROL
void tcp_poll();
#else
inline void tcp_poll() {}
#endif
