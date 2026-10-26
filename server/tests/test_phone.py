import asyncio
from unittest.mock import AsyncMock

import pytest

from hidagent.device import DeviceError
from hidagent.phone import TAP_GAP, Phone


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
