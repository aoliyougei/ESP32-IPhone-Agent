import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from hidagent.device import DeviceError
from hidagent.phone import TAP_GAP, Phone


@pytest.mark.parametrize(("axis_move", "expected"), [
    (False, ["move 250 200", "move 250 -100"]),
    (True, ["move 250 0", "move 0 200", "move 250 0", "move 0 -100"]),
])
def test_positioning_mode_preserves_relative_targets(tmp_path, axis_move, expected):
    device = AsyncMock(links=1)
    phone = Phone(device, tmp_path / "calibration.json", axis_move=axis_move)
    phone.span = {"w": 1000, "h": 500}

    async def run():
        await phone.point(0.25, 0.4)
        await phone.point(0.5, 0.2)

    asyncio.run(run())
    assert [c.args[0] for c in device.send.await_args_list] == ["release", "home", *expected]
    assert phone._pos == (500, 100)
    assert phone._moves == 2
    assert not phone._file.exists()


def test_axis_positioning_does_not_split_drag_stroke(tmp_path):
    device = AsyncMock(links=1)
    phone = Phone(device, tmp_path / "calibration.json", axis_move=True)
    phone.span = {"w": 1000, "h": 500}
    asyncio.run(phone.drag([(0.25, 0.4), (0.5, 0.2)], hold=False))
    assert [c.args[0] for c in device.send.await_args_list] == [
        "release", "home", "move 250 0", "move 0 200", "press", "move 250 -100", "release"]


@pytest.mark.parametrize("fail_at", ["move 250 0", "move 0 200"])
def test_axis_positioning_failure_does_not_click_and_next_target_rehomes(tmp_path, fail_at):
    device = AsyncMock(links=1)
    phone = Phone(device, tmp_path / "calibration.json", axis_move=True)
    phone.span = {"w": 1000, "h": 500}

    async def send(command):
        if command == fail_at:
            raise DeviceError("failed move")

    device.send.side_effect = send
    with pytest.raises(DeviceError):
        asyncio.run(phone.tap(0.25, 0.4))
    assert phone._pos is None
    assert "click" not in [c.args[0] for c in device.send.await_args_list]
    device.send.reset_mock(side_effect=True)
    asyncio.run(phone.point(0.25, 0.4))
    assert [c.args[0] for c in device.send.await_args_list] == ["home", "move 250 0", "move 0 200"]


@pytest.mark.parametrize(("target", "expected"), [
    ((0.25, 0), ["move 250 0"]),
    ((0, 0.4), ["move 0 200"]),
    ((0, 0), []),
])
def test_axis_positioning_skips_zero_length_axes(tmp_path, target, expected):
    device = AsyncMock(links=1)
    phone = Phone(device, tmp_path / "calibration.json", axis_move=True)
    phone.span = {"w": 1000, "h": 500}
    asyncio.run(phone.point(*target))
    assert [c.args[0] for c in device.send.await_args_list] == ["release", "home", *expected]
    assert phone._moves == 1


def auto_phone(tmp_path):
    device = AsyncMock(links=1)
    screen = Mock(live=True, frame=b"frame", updated=0)
    screen.settled = AsyncMock()
    screen.fresh = AsyncMock(return_value=b"frame")
    phone = Phone(device, tmp_path / "calibration.json", screen)
    phone.span = {"w": 986, "h": 456}
    phone._save()
    return phone, device, screen


def test_auto_axis_calibration_uses_same_moves_and_fit_as_manual(tmp_path, monkeypatch):
    phone, device, _ = auto_phone(tmp_path)
    monkeypatch.setattr("hidagent.phone.vision.calibration_pointer", Mock(side_effect=[
        (0.17, 0.03), (0.37, 0.03), (0.013, 0.32), (0.013, 0.72)]))
    assert asyncio.run(phone.start_calibration()) is True
    assert [c.args[0] for c in device.send.await_args_list] == [
        "home", "move 150 0", "move 200 0", "home", "move 0 150", "move 0 200"]
    assert phone.span == {"w": 1000, "h": 500}
    assert phone._fix(0.5, "x") == pytest.approx(0.48)
    assert phone._axis_samples is None and phone._pos is None


@pytest.mark.parametrize("failed_sample", range(4))
def test_auto_axis_detection_failure_keeps_previous_file(tmp_path, monkeypatch, failed_sample):
    phone, device, _ = auto_phone(tmp_path)
    original = phone._file.read_text()
    readings = [(0.17, 0.03), (0.37, 0.03), (0.013, 0.32), (0.013, 0.72)]
    readings[failed_sample] = None
    monkeypatch.setattr("hidagent.phone.vision.calibration_pointer", Mock(side_effect=readings))
    with pytest.raises(RuntimeError, match="Manual calibration"):
        asyncio.run(phone.start_calibration())
    assert phone._file.read_text() == original
    assert phone.span == {"w": 986, "h": 456}
    assert phone._axis_samples is None and phone._pos is None
    assert "move 200 200" not in [c.args[0] for c in device.send.await_args_list]


@pytest.mark.parametrize("failure", ["missing_frame", "disconnected", "cancelled", "device_error", "animation"])
def test_auto_axis_interruption_never_saves(tmp_path, monkeypatch, failure):
    phone, device, screen = auto_phone(tmp_path)
    original = phone._file.read_text()
    monkeypatch.setattr("hidagent.phone.vision.calibration_pointer", Mock(return_value=(0.17, 0.03)))
    if failure == "missing_frame":
        screen.fresh.return_value = None
    elif failure == "device_error":
        device.send.side_effect = DeviceError("lost link")
    elif failure == "animation":
        import time
        screen.updated = time.time()
    else:
        async def interrupt(*args, **kwargs):
            if failure == "disconnected":
                device.links = 2
            else:
                phone._axis_samples = None
            return b"frame"
        screen.fresh.side_effect = interrupt
    with pytest.raises(RuntimeError):
        asyncio.run(phone.start_calibration())
    assert phone._file.read_text() == original
    assert phone._axis_samples is None and phone._pos is None


def test_axis_calibration_samples_and_saves_only_after_four_points(tmp_path):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json")
    phone.span = {"w": 986, "h": 456}

    async def run():
        assert await phone.start_axis_calibration() == "x150"
        assert await phone.finish_axis_calibration(0.17, 0.01) == "x350"
        assert await phone.finish_axis_calibration(0.37, 0.01) == "y150"
        assert phone.span == {"w": 986, "h": 456}
        assert not phone._file.exists()
        with pytest.raises(ValueError):
            await phone.finish_axis_calibration(0.01, 0)
        assert await phone.finish_axis_calibration(0.01, 0.32) == "y350"
        assert await phone.finish_axis_calibration(0.01, 0.72) is None

    asyncio.run(run())
    assert phone.span == {"w": 1000, "h": 500}
    assert phone._file.exists()
    assert [c.args[0] for c in device.send.await_args_list] == [
        "home", "move 150 0", "move 200 0", "home", "move 0 150", "move 0 200"]
    assert phone._pos is None
    assert abs(phone._fix(0.5, "x") - 0.48) < 1e-6


@pytest.mark.parametrize("value", [0, 0.01, 0.98, 1, float("nan"), float("inf")])
def test_axis_calibration_rejects_invalid_samples_without_moving(tmp_path, value):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json")

    async def run():
        await phone.start_axis_calibration()
        device.send.reset_mock()
        with pytest.raises(ValueError):
            await phone.finish_axis_calibration(value, 0.1)
        device.send.assert_not_awaited()
        assert await phone.finish_axis_calibration(0.2, 0.1) == "x350"
        device.send.reset_mock()
        with pytest.raises(ValueError):
            await phone.finish_axis_calibration(0.21, 0.1)
        device.send.assert_not_awaited()
        assert await phone.finish_axis_calibration(0.4, 0.1) == "y150"

    asyncio.run(run())
    assert not phone._file.exists()


def test_axis_calibration_cancel_preserves_previous_parameters(tmp_path):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json")
    phone.span = {"w": 986, "h": 456}

    async def run():
        await phone.start_axis_calibration()
        with pytest.raises(RuntimeError, match="calibration"):
            await phone.point(0.5, 0.5)
        await phone.reset()
        with pytest.raises(RuntimeError):
            await phone.finish_axis_calibration(0.2, 0.3)

    asyncio.run(run())
    assert phone.span == {"w": 986, "h": 456}
    assert not phone._file.exists()


@pytest.mark.parametrize("failed_command", ["move 150 0", "move 200 0", "move 0 150", "move 0 200"])
def test_axis_calibration_device_failure_preserves_saved_parameters(tmp_path, failed_command):
    device = AsyncMock()
    file = tmp_path / "calibration.json"
    file.write_text('{"w":986,"h":456}')
    phone = Phone(device, file)

    async def send(command):
        if command == failed_command:
            raise DeviceError("lost link")

    device.send.side_effect = send

    async def run():
        await phone.start_axis_calibration()
        for x, y in [(0.17, 0.01), (0.37, 0.01), (0.01, 0.32)]:
            await phone.finish_axis_calibration(x, y)

    with pytest.raises(DeviceError):
        asyncio.run(run())
    assert phone.span == {"w": 986, "h": 456}
    assert file.read_text() == '{"w":986,"h":456}'
    assert phone._axis_samples is None and phone._pos is None


def test_axis_calibration_save_failure_preserves_disk_and_can_retry(tmp_path, monkeypatch):
    from pathlib import Path

    file = tmp_path / "calibration.json"
    original = '{"w":986,"h":456,"seen":{"x":[[0.1,0.12]],"y":[]}}'
    file.write_text(original)
    phone = Phone(AsyncMock(), file)
    original_seen = phone._seen
    replace = Path.replace

    def fail_replace(self, target):
        raise OSError("disk error")

    async def run():
        await phone.start_axis_calibration()
        for x, y in [(0.17, 0.01), (0.37, 0.01), (0.01, 0.32)]:
            await phone.finish_axis_calibration(x, y)
        monkeypatch.setattr(Path, "replace", fail_replace)
        with pytest.raises(OSError, match="disk error"):
            await phone.finish_axis_calibration(0.01, 0.72)
        assert file.read_text() == original
        assert phone.span == {"w": 986, "h": 456} and phone._seen is original_seen
        monkeypatch.setattr(Path, "replace", replace)
        assert await phone.finish_axis_calibration(0.01, 0.72) is None

    asyncio.run(run())
    assert Phone(AsyncMock(), file).span == {"w": 1000, "h": 500}


def test_stop_without_connected_device_cancels_axis_sampling(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDAGENT_DATA", str(tmp_path))
    from fastapi.testclient import TestClient

    from hidagent import app as web

    device = AsyncMock(connected=False)
    phone = Phone(device, tmp_path / "axis.json")
    asyncio.run(phone.start_axis_calibration())
    device.send.reset_mock()
    monkeypatch.setattr(web, "phone", phone)
    monkeypatch.setattr(web, "device", device)
    assert TestClient(web.app).post("/api/agent/stop").status_code == 200
    assert phone._axis_samples is None and phone._pos is None
    device.send.assert_not_awaited()


def test_axis_calibration_api(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDAGENT_DATA", str(tmp_path))
    from fastapi.testclient import TestClient

    from hidagent import app as web

    phone = Phone(AsyncMock(), tmp_path / "axis.json")
    monkeypatch.setattr(web, "phone", phone)
    client = TestClient(web.app)
    assert client.post("/api/calibrate/start", json={"mode": "axis"}).json()["step"] == "x150"
    assert client.post("/api/calibrate/finish", json={"x": 0, "y": 0}).status_code == 422
    for x, y, step in [(0.17, 0.01, "x350"), (0.37, 0.01, "y150"),
                       (0.01, 0.32, "y350"), (0.01, 0.72, None)]:
        response = client.post("/api/calibrate/finish", json={"x": x, "y": y})
        assert response.status_code == 200
        assert response.json()["step"] == step
    assert phone.span == {"w": 1000, "h": 500}


def test_auto_axis_api_failure_does_not_enter_single_point_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDAGENT_DATA", str(tmp_path))
    from fastapi.testclient import TestClient

    from hidagent import app as web

    phone, _, screen = auto_phone(tmp_path)
    screen.live = False
    monkeypatch.setattr(web, "phone", phone)
    response = TestClient(web.app).post("/api/calibrate/start")
    assert response.status_code == 409
    assert "Manual calibration" in response.json()["detail"]
    assert phone._axis_samples is None


def test_auto_axis_corrupt_image_preserves_parameters(tmp_path):
    phone, _, _ = auto_phone(tmp_path)
    original = phone._file.read_text()
    with pytest.raises(RuntimeError, match="Invalid mirroring image"):
        asyncio.run(phone.start_calibration())
    assert phone._file.read_text() == original
    assert phone._axis_samples is None


def test_auto_axis_fit_save_failure_restores_previous_parameters(tmp_path, monkeypatch):
    phone, _, _ = auto_phone(tmp_path)
    original = phone._file.read_text()
    monkeypatch.setattr("hidagent.phone.vision.calibration_pointer", Mock(side_effect=[
        (0.17, 0.03), (0.37, 0.03), (0.013, 0.32), (0.013, 0.72)]))
    monkeypatch.setattr(phone, "_save", Mock(side_effect=OSError("disk error")))
    with pytest.raises(OSError):
        asyncio.run(phone.start_calibration())
    assert phone.span == {"w": 986, "h": 456}
    assert phone._file.read_text() == original
    assert phone._axis_samples is None and phone._pos is None


def test_force_manual_skips_visual_detection(tmp_path):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json", Mock(live=True))
    phone._find_pointer = AsyncMock()
    assert asyncio.run(phone.start_calibration(manual=True)) is False
    assert [call.args[0] for call in device.send.await_args_list] == ["home", "move 200 200"]
    phone._find_pointer.assert_not_awaited()


def test_calibration_api_keeps_auto_default_and_accepts_manual(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDAGENT_DATA", str(tmp_path))
    from fastapi.testclient import TestClient

    from hidagent import app as web

    start = AsyncMock(return_value=False)
    monkeypatch.setattr(web.phone, "start_calibration", start)
    client = TestClient(web.app)
    assert client.post("/api/calibrate/start").status_code == 200
    start.assert_awaited_with(manual=False)
    assert client.post("/api/calibrate/start", json={"manual": True}).json()["auto"] is False
    start.assert_awaited_with(manual=True)


def test_double_tap_moves_once_then_clicks_twice(tmp_path, monkeypatch):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json")
    phone.point = AsyncMock()
    sleep = AsyncMock()
    monkeypatch.setattr("hidagent.phone.asyncio.sleep", sleep)
    asyncio.run(phone.double_tap(0.25, 0.75))
    phone.point.assert_awaited_once_with(0.25, 0.75)
    assert [call.args for call in device.send.await_args_list] == [("click",), ("click",)]
    assert [call.args for call in sleep.await_args_list] == [(TAP_GAP,), (TAP_GAP,)]


def test_double_tap_does_not_click_without_calibration(tmp_path):
    device = AsyncMock()
    phone = Phone(device, tmp_path / "calibration.json")
    with pytest.raises(RuntimeError, match="not calibrated"):
        asyncio.run(phone.double_tap(0.5, 0.5))
    device.send.assert_not_awaited()


def test_double_tap_does_not_retry_failed_click(tmp_path):
    device = AsyncMock()
    device.send.side_effect = DeviceError("disconnected")
    phone = Phone(device, tmp_path / "calibration.json")
    phone.point = AsyncMock()
    with pytest.raises(DeviceError):
        asyncio.run(phone.double_tap(0.5, 0.5))
    device.send.assert_awaited_once_with("click")


def test_double_tap_api_delegation_and_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDAGENT_DATA", str(tmp_path))
    from fastapi.testclient import TestClient

    from hidagent import app as web

    action = AsyncMock()
    monkeypatch.setattr(web.phone, "double_tap", action)
    client = TestClient(web.app)  # No lifespan: do not start UxPlay or a board listener.
    response = client.post("/api/double_tap", json={"x": 0.25, "y": 0.75})
    assert response.status_code == 200 and response.json() == {"ok": True}
    action.assert_awaited_once_with(0.25, 0.75)
    action.side_effect = DeviceError("disconnected")
    assert client.post("/api/double_tap", json={"x": 0.5, "y": 0.5}).status_code == 409
    assert client.post("/api/double_tap", json={"x": 0.5}).status_code == 422
