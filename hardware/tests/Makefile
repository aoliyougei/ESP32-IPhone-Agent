# Host firmware tests. Usage: make -C hardware/tests
SRC = ../hid_bridge/src
CFLAGS = -std=c11 -Wall -Wextra -g -fsanitize=address,undefined
CXXFLAGS = -std=c++17 -Wall -Wextra -Werror -g -fsanitize=address,undefined

check: test test_tcp
	./test
	./test_tcp

test: test_main.c $(SRC)/bplist/bplist.c $(SRC)/video/gop.c
	$(CC) $(CFLAGS) -o $@ $^

test_tcp: test_tcp.cpp tcp_stubs/WiFi.h tcp_stubs/secrets.h $(SRC)/../tcp_link.cpp
	$(CXX) $(CXXFLAGS) -Itcp_stubs -o $@ test_tcp.cpp

clean:
	rm -f test test_tcp

.PHONY: check clean
