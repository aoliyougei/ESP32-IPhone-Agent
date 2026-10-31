FROM python:3.12-slim-trixie

RUN apt-get update && apt-get install -y --no-install-recommends \
    uxplay avahi-daemon dbus bash tini \
    gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad gstreamer1.0-libav \
    && rm -rf /var/lib/apt/lists/*
# none keeps the original lightweight image; cpu / nvidia install YOLO dependencies.
ARG YOLO_RUNTIME=none
WORKDIR /app
COPY pyproject.toml ./
COPY hidagent ./hidagent
RUN case "$YOLO_RUNTIME" in \
      none) pip install --no-cache-dir . ;; \
      cpu|nvidia) \
        if [ "$YOLO_RUNTIME" = cpu ]; then TORCH_INDEX=cpu; else TORCH_INDEX=cu124; fi; \
        pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1 \
          --index-url "https://download.pytorch.org/whl/$TORCH_INDEX" \
        && pip install --no-cache-dir '.[yolo]' ;; \
      *) echo 'YOLO_RUNTIME must be none, cpu or nvidia' >&2; exit 1 ;; \
    esac
ENV HIDAGENT_YOLO_DEVICE=cpu
COPY docker/entrypoint.sh /usr/local/bin/hidagent-entrypoint
COPY docker/avahi-daemon.conf /etc/avahi/avahi-daemon.conf
RUN chmod +x /usr/local/bin/hidagent-entrypoint
ENV PYTHONUNBUFFERED=1 HIDAGENT_DATA=/data AIRPLAY_PORT=35000
EXPOSE 8890/tcp 7300/tcp 5353/udp 35000-35002/tcp 35000-35002/udp
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/hidagent-entrypoint"]
