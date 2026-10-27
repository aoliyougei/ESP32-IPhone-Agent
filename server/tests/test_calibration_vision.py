import asyncio
import io
from unittest.mock import AsyncMock, Mock

import pytest
from PIL import Image, ImageDraw

from hidagent.phone import Phone
from hidagent.vision import calibration_pointer


def frame(size, center, extra=False):
    image = Image.new("RGB", size, (230, 235, 240))
    draw = ImageDraw.Draw(image)
    radius = max(5, round(min(size) * 0.02))
    x, y = center[0] * size[0], center[1] * size[1]
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(100, 100, 100))
    if extra:
        draw.rectangle((size[0] * 0.4, size[1] * 0.4, size[0] * 0.7, size[1] * 0.6), fill="red")
    output = io.BytesIO()
    image.save(output, "JPEG", quality=75)
    return output.getvalue()


@pytest.mark.parametrize("size", [(1920, 888), (498, 1080)])
@pytest.mark.parametrize(("before", "after", "axis", "direction"), [
    ((0.013, 0.03), (0.15, 0.03), "x", 1),
    ((0.15, 0.03), (0.33, 0.03), "x", 1),
    ((0.013, 0.03), (0.013, 0.31), "y", 1),
    ((0.013, 0.31), (0.013, 0.69), "y", 1),
    ((0.7, 0.4), (0.3, 0.4), "x", -1),
])
def test_calibration_finds_destination_without_assumed_displacement(size, before, after, axis, direction):
    result = calibration_pointer(frame(size, before), frame(size, after), axis, direction)
    assert result is not None
    assert result == pytest.approx(after, abs=0.006)


def test_automatic_pipeline_fits_actual_synthetic_frames(tmp_path):
    size = (1920, 888)
    screen = Mock(live=True, updated=0)
    screen.settled = AsyncMock()
    screen.fresh = AsyncMock(side_effect=lambda *args: screen.frame)
    position = [0, 0]

    async def send(command):
        if command == "home":
            position[:] = [0, 0]
        else:
            _, x, y = command.split()
            position[0] += int(x)
            position[1] += int(y)
        screen.frame = frame(size, (0.013 + position[0] / 1000, 0.03 + position[1] / 500))

    phone = Phone(Mock(links=1, send=send), tmp_path / "calibration.json", screen)
    assert asyncio.run(phone.start_calibration()) is True
    assert phone.span["w"] == pytest.approx(1000, rel=0.015)
    assert phone.span["h"] == pytest.approx(500, rel=0.015)
    assert phone._fix(0.5, "x") == pytest.approx(0.487, abs=0.006)
    assert phone._fix(0.5, "y") == pytest.approx(0.47, abs=0.006)


@pytest.mark.parametrize("case", ["unchanged", "animation", "resized", "wrong_direction", "diagonal"])
def test_calibration_rejects_ambiguous_or_incompatible_frames(case):
    size = (960, 444)
    before = frame(size, (0.2, 0.3))
    after = frame(size, (0.4, 0.3))
    if case == "unchanged":
        after = before
    elif case == "animation":
        after = frame(size, (0.4, 0.3), extra=True)
    elif case == "resized":
        after = frame((444, 960), (0.4, 0.3))
    elif case == "wrong_direction":
        after = frame(size, (0.1, 0.3))
    elif case == "diagonal":
        after = frame(size, (0.4, 0.5))
    assert calibration_pointer(before, after, "x", 1) is None
