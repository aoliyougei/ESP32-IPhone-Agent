FROM python:3.12-slim-trixie

RUN apt-get update && apt-get install -y --no-install-recommends \
    uxplay avahi-daemon dbus bash tini \
    gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad gstreamer1.0-libav \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY hidagent ./hidagent
RUN pip install --no-cache-dir .
COPY docker/entrypoint.sh /usr/local/bin/hidagent-entrypoint
COPY docker/avahi-daemon.conf /etc/avahi/avahi-daemon.conf
RUN chmod +x /usr/local/bin/hidagent-entrypoint
ENV PYTHONUNBUFFERED=1 HIDAGENT_DATA=/data AIRPLAY_PORT=35000
EXPOSE 8890/tcp 7300/tcp 5353/udp 35000-35002/tcp 35000-35002/udp
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/hidagent-entrypoint"]
