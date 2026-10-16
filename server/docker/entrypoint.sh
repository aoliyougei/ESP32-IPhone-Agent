#!/bin/bash
set -euo pipefail

# UxPlay reads this file itself; no shell expansion of user-provided arguments.
if [[ ! ${AIRPLAY_PORT:-} =~ ^[0-9]{4,5}$ ]] || (( 10#$AIRPLAY_PORT < 1024 || 10#$AIRPLAY_PORT > 65533 )); then
    echo 'AIRPLAY_PORT must be between 1024 and 65533' >&2
    exit 1
fi
if [[ -n ${AIRPLAY_MAC:-} && ! $AIRPLAY_MAC =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
    echo 'AIRPLAY_MAC must have the format 02:00:00:00:00:01' >&2
    exit 1
fi
mkdir -p /run/dbus "$HIDAGENT_DATA"
# These are container-private files; a Docker restart can leave stale PID files.
rm -f /run/dbus/pid /run/avahi-daemon/pid
export UXPLAYRC=/run/hidagent-uxplayrc
printf 'p %d\n' "$((10#$AIRPLAY_PORT))" > "$UXPLAYRC"
if [[ -n ${AIRPLAY_MAC:-} ]]; then
    printf 'm %s\n' "$AIRPLAY_MAC" >> "$UXPLAYRC"
else
    printf 'm\n' >> "$UXPLAYRC"
fi
# Debian UxPlay uses Avahi through the container's private system bus.
dbus-daemon --system --nofork &
bus=$!
avahi= app=
cleanup() {
    trap - EXIT TERM INT
    kill ${app:-} ${avahi:-} "$bus" 2>/dev/null || true
    wait || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT
for attempt in {1..50}; do
    if dbus-send --system --type=method_call --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done
avahi-daemon --no-chroot &
avahi=$!
for attempt in {1..50}; do
    if dbus-send --system --type=method_call --print-reply --dest=org.freedesktop.Avahi \
        / org.freedesktop.Avahi.Server.GetVersionString >/dev/null 2>&1; then
        python -m hidagent &
        app=$!
        break
    fi
    sleep 0.1
done
if [[ -z $app ]]; then
    echo 'Avahi did not become ready' >&2
    exit 1
fi
# Exit if any required service dies; let Docker/Kubernetes restart the container.
set +e
wait -n "$bus" "$avahi" "$app"
status=$?
set -e
if (( status == 0 )); then status=1; fi
exit "$status"
