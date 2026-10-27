"""Touch-like gestures on the phone, built from relative mouse moves.

The pointer is relative, so the server tracks where it is (in mouse units) and moves
from there; every few gestures it slams it into the top-left corner (`home`) again to
cancel drift. Coordinates are fractions of the screen (0..1, origin top-left), so they
work for any frame size.
"""

import asyncio
import json
import logging
import time
from collections import deque
from pathlib import Path

from . import vision
from .device import Device

log = logging.getLogger(__name__)

CALIBRATION_MOVE = 200  # mouse units moved diagonally for a manual (one point) calibration; stays on screen
CALIBRATION_STOPS = (150, 350)  # automatic calibration finds the pointer at these distances from the corner
REHOME_EVERY = 10       # gestures between re-homing
HOLD = 0.25             # seconds to rest before lifting, so iOS adds no momentum (the swipe stops where it ends)
TAP_GAP = 0.15          # seconds to stay still after a click, so iOS sees a finished tap, not the start of a drag
NUDGE = 12              # mouse units the pointer is wiggled by to find it on screen
AIM_TOLERANCE = 0.008   # screen fraction; a bigger miss is corrected before pressing
MAX_MISS = 0.06         # bigger misses are still corrected, but not learned from (they may be misreadings)


class Phone:
    def __init__(self, device: Device, calibration_file: Path, screen=None, *, axis_move: bool = False):
        self.device, self._file, self.screen = device, calibration_file, screen
        self.axis_move = axis_move
        # mouse units needed to cross the full screen width / height
        saved = json.loads(calibration_file.read_text()) if calibration_file.exists() else None
        self.span = {"w": saved["w"], "h": saved["h"]} if saved else None
        self._axis_samples = None
        self._pos = None  # pointer position in mouse units; None = unknown
        self._moves = 0
        self._link = 0  # device.links when the pointer was last homed
        # where the pointer really landed (seen on screen) for the screen fraction we aimed at, per axis;
        # a straight-line fit through them corrects every later move, so taps get better as the agent works
        self._seen = {axis: deque(map(tuple, (saved or {}).get("seen", {}).get(axis, [])), maxlen=12)
                      for axis in ("x", "y")}

    @property
    def calibrated(self) -> bool:
        return self.span is not None

    async def start_calibration(self, manual: bool = False) -> bool:
        """Automatic four-stop axis fit; manual=True keeps the legacy one-point API."""
        self._axis_samples = None
        self._pos = None
        if manual:
            await self.device.send("home")
            await self.device.send(f"move {CALIBRATION_MOVE} {CALIBRATION_MOVE}")
            return False
        if self.screen is None or not self.screen.live:
            raise RuntimeError("Automatic calibration needs live mirroring; use Manual calibration")
        samples = self._axis_samples = []
        link = self.device.links

        def active():
            if self._axis_samples is not samples or self.device.links != link:
                raise RuntimeError("Automatic calibration cancelled or device changed; use Manual calibration")

        try:
            for index, (axis, units) in enumerate((("x", 150), ("x", 200), ("y", 150), ("y", 200))):
                active()
                if index in (0, 2):
                    sent = time.time()
                    await self.device.send("home")
                    await self._calibration_frame(sent)
                active()
                before = await self._calibration_frame()
                active()
                sent = time.time()
                await self.device.send(f"move {units if axis == 'x' else 0} {units if axis == 'y' else 0}")
                after = await self._calibration_frame(sent)
                active()
                try:
                    found = vision.calibration_pointer(before, after, axis)
                except (OSError, ValueError) as e:
                    raise RuntimeError("Invalid mirroring image; use Manual calibration") from e
                if found is None:
                    raise RuntimeError("Automatic pointer detection uncertain; use Manual calibration")
                value = found[0 if axis == "x" else 1]
                self._validate_axis_sample(samples, value)
                log.info("automatic axis sample %s: x=%.6f y=%.6f", index, *found)
                if index == 3:
                    self._complete_axis_calibration(samples + [value])
                else:
                    samples.append(value)
            return True
        except ValueError as e:
            raise RuntimeError("Invalid automatic samples; use Manual calibration") from e
        finally:
            if self._axis_samples is samples:
                self._axis_samples = None
            self._pos = None

    async def _calibration_frame(self, since: float | None = None) -> bytes:
        if since is not None and not await self.screen.fresh(since, 2.0):
            raise RuntimeError("No new mirroring frame; use Manual calibration")
        await self.screen.settled(quiet=0.3, least=0.4, most=2.0)
        if not self.screen.live or not self.screen.frame:
            raise RuntimeError("Mirroring lost; use Manual calibration")
        if time.time() - self.screen.updated < 0.3:
            raise RuntimeError("Mirroring did not settle; use Manual calibration")
        return self.screen.frame

    async def start_axis_calibration(self) -> str:
        self._pos = None
        self._axis_samples = []
        try:
            await self.device.send("home")
            await self.device.send("move 150 0")
        except Exception:
            self._axis_samples = None
            raise
        log.info("axis calibration: x150; select the real pointer center")
        return "x150"

    async def finish_axis_calibration(self, x: float, y: float) -> str | None:
        samples = self._axis_samples
        if samples is None:
            raise RuntimeError("no axis calibration in progress")
        index = len(samples)
        value = x if index < 2 else y
        self._validate_axis_sample(samples, value)
        log.info("axis calibration sample %s: x=%.6f y=%.6f", index, x, y)
        if index == 3:
            self._complete_axis_calibration(samples + [value])
            self._axis_samples = None
            self._pos = None
            log.info("axis calibration complete: span=%s seen=%s", self.span, dict(self._seen))
            return None
        try:
            if index == 0:
                await self.device.send("move 200 0")
            elif index == 1:
                await self.device.send("home")
                await self.device.send("move 0 150")
            else:
                await self.device.send("move 0 200")
        except Exception:
            self._axis_samples = None
            self._pos = None
            raise
        samples.append(value)
        return ("x350", "y150", "y350")[index]

    @staticmethod
    def _validate_axis_sample(samples: list[float], value: float) -> None:
        if not 0.01 < value < 0.98 or (len(samples) % 2 and value - samples[-1] < 0.03):
            raise ValueError("Select the pointer away from the boundary and beyond the first point")

    def _complete_axis_calibration(self, values: list[float]) -> None:
        span = {"w": round(200 / (values[1] - values[0])),
                "h": round(200 / (values[3] - values[2]))}
        previous = self.span, self._seen
        self.span = span
        self._seen = {axis: deque([(units / span[key], measured) for units, measured in
                                  zip(CALIBRATION_STOPS, values[offset:offset + 2], strict=True)], maxlen=12)
                      for axis, key, offset in (("x", "w", 0), ("y", "h", 2))}
        try:
            self._save()
        except Exception:
            self.span, self._seen = previous
            raise

    def finish_calibration(self, x: float, y: float) -> None:
        """x, y: where the pointer ended up after start_calibration() (one point, picked by the user)."""
        self.span = {"w": round(CALIBRATION_MOVE / x), "h": round(CALIBRATION_MOVE / y)}
        for samples in self._seen.values():
            samples.clear()
        self._save()

    def _save(self) -> None:
        """Calibration plus the observed landings, so the correction survives a restart."""
        temporary = self._file.with_suffix(".tmp")
        try:
            temporary.write_text(json.dumps({**self.span, "seen": {k: list(v) for k, v in self._seen.items()}}))
            temporary.replace(self._file)  # Keep the previous file intact if writing fails.
        finally:
            temporary.unlink(missing_ok=True)

    async def point(self, x: float, y: float, aim: bool = False) -> None:
        if self._axis_samples is not None:
            raise RuntimeError("axis calibration in progress; finish or stop first")
        if not self.calibrated:
            raise RuntimeError("pointer not calibrated")
        log.info("pointer target: x=%.6f y=%.6f span=%s tracked=%s moves=%s mode=%s",
                 x, y, self.span, self._pos, self._moves, "axis" if self.axis_move else "combined")
        await self._move_to(self._dx(x), self._dy(y))
        if aim and self.screen is not None:
            await self._aim(x, y)

    async def _aim(self, x: float, y: float) -> None:
        """Closed loop: find the real pointer on screen, fix a miss, and learn the error for later moves."""
        nudge = NUDGE if x < 0.9 else -NUDGE  # stay clear of the screen edge
        await self.screen.settled(quiet=0.15, least=0.1, most=0.6)  # pointer at rest
        before, sent = self.screen.frame, time.time()
        await self.device.send(f"move {nudge} 0")
        after = await self.screen.fresh(sent, 0.6)
        if after:
            await self.screen.settled(quiet=0.1, least=0.05, most=0.4)
            after = self.screen.frame
        await self.device.send(f"move {-nudge} 0")
        shift = nudge / self.span["w"]
        found = before and after and (vision.pointer(before, after, (x, y), shift)  # near the target first,
                                      or vision.pointer(before, after, (0.5, 0.5), shift, reach=(0.5, 0.5)))  # anywhere
        if not found:
            log.debug("aim (%.3f, %.3f): pointer not found (%s)", x, y,
                      "no new frame after the nudge" if not after else "no pointer-sized change near the target")
            return
        fx, fy = found
        log.debug("aim (%.3f, %.3f): pointer at (%.3f, %.3f)", x, y, fx, fy)
        if max(abs(fx - x), abs(fy - y)) <= MAX_MISS:  # learn from normal drift only, never from a stray reading
            self._seen["x"].append((self._fix(x, "x"), fx))
            self._seen["y"].append((self._fix(y, "y"), fy))
            self._save()
        if abs(fx - x) <= AIM_TOLERANCE and abs(fy - y) <= AIM_TOLERANCE:
            return
        dx, dy = round((x - fx) * self.span["w"]), round((y - fy) * self.span["h"])  # fix this miss right away
        await self.device.send(f"move {dx} {dy}")
        self._pos = (self._pos[0] + dx, self._pos[1] + dy)

    def _fix(self, t: float, axis: str) -> float:
        """The fraction to aim at so the pointer lands on t, from the line through the observed landings."""
        pts = self._seen[axis]
        if len(pts) < 2:
            return t
        n = len(pts)
        mc, mf = sum(c for c, _ in pts) / n, sum(f for _, f in pts) / n
        var = sum((c - mc) ** 2 for c, _ in pts)
        a = sum((c - mc) * (f - mf) for c, f in pts) / var if var > 1e-4 else 1.0  # landed = a * aimed + b
        a = a if 0.85 < a < 1.15 else 1.0
        b = mf - a * mc
        return (t - b) / a if abs(b) < 0.1 else t

    async def _move_to(self, tx: int, ty: int, rehome: bool = True) -> None:
        if self._link != self.device.links:  # new link: a dropped gesture may have left the button down
            await self.device.send("release")
            self._pos, self._link = None, self.device.links
        if self._pos is None or (rehome and self._moves >= REHOME_EVERY):
            log.info("pointer home: reason=%s", "unknown position" if self._pos is None else "periodic")
            await self.device.send("home")
            self._pos, self._moves = (0, 0), 0
        x, y = self._pos
        self._pos = None  # unknown until the move succeeds
        log.info("pointer move: target_units=(%s,%s) delta=(%s,%s)", tx, ty, tx - x, ty - y)
        if self.axis_move and rehome:  # Match axis calibration without changing a pressed drag's path.
            if tx != x:
                await self.device.send(f"move {tx - x} 0")
            if ty != y:
                await self.device.send(f"move 0 {ty - y}")
        else:
            await self.device.send(f"move {tx - x} {ty - y}")
        self._pos, self._moves = (tx, ty), self._moves + 1

    async def reset(self) -> None:
        """Let go of the button and re-home the pointer, whatever state a gesture left."""
        self._axis_samples = None
        self._pos = None
        if not self.device.connected:
            return
        await self.device.send("release")
        await self.device.send("home")
        self._pos, self._moves = (0, 0), 0

    async def tap(self, x: float, y: float, aim: bool = False) -> None:
        """aim=True finds the pointer on screen first (slower); worth it when a tap just missed."""
        await self.point(x, y, aim)
        await self.device.send("click")
        await asyncio.sleep(TAP_GAP)

    async def double_tap(self, x: float, y: float) -> None:
        """Move once so re-homing cannot interrupt the two clicks."""
        await self.point(x, y)
        await self.device.send("click")
        await asyncio.sleep(TAP_GAP)
        await self.device.send("click")
        await asyncio.sleep(TAP_GAP)

    async def swipe(self, x1: float, y1: float, x2: float, y2: float, hold: bool = True) -> None:
        await self.drag([(x1, y1), (x2, y2)], hold)

    async def drag(self, points: list[tuple[float, float]], hold: bool = True) -> None:
        """Press at the first point, move through the rest, release: one continuous stroke.

        hold=True rests at the end first, so lists and pickers stop exactly there instead of flinging on.
        System gestures (home, back) need the flick, so they pass hold=False.
        """
        await self.point(*points[0])
        await self.device.send("press")
        try:
            for x, y in points[1:]:
                await self._move_to(self._dx(x), self._dy(y), rehome=False)  # never home mid-drag
            if hold:
                await asyncio.sleep(HOLD)
        finally:
            await self.device.send("release")

    async def scroll(self, x: float, y: float, lines: int) -> None:
        await self.point(x, y)
        await self.device.send(f"scroll {lines} 0")

    async def type(self, text: str) -> None:
        await self.device.send(f"type {text}")

    async def key(self, combo: str) -> None:
        await self.device.send(f"key {combo}")

    async def go_home(self) -> None:
        await self.swipe(0.5, 0.995, 0.5, 0.6, hold=False)  # resting here would open the app switcher

    async def go_back(self) -> None:
        await self.swipe(0.005, 0.45, 0.6, 0.45, hold=False)

    def _dx(self, x: float) -> int:
        return round(min(max(self._fix(x, "x"), 0), 1) * self.span["w"])

    def _dy(self, y: float) -> int:
        return round(min(max(self._fix(y, "y"), 0), 1) * self.span["h"])
