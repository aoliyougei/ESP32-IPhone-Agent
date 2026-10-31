import asyncio
import base64
import io
import json
import sys
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image


def jpeg():
    out = io.BytesIO()
    Image.new('RGB', (200, 100)).save(out, format='JPEG')
    return out.getvalue()


def detector(monkeypatch, tmp_path, device='cpu', names=None, cuda=True):
    from hidagent.detection import Detector
    model = Mock()
    model.names = names if names is not None else {0: 'front', 1: 'back'}
    model.task = 'detect'
    model.predict.return_value = [SimpleNamespace(boxes=SimpleNamespace(
        xyxy=Mock(tolist=lambda: [[10, 20, 40, 80]]),
        cls=Mock(tolist=lambda: [0]), conf=Mock(tolist=lambda: [0.9])))]
    factory = Mock(return_value=model)
    monkeypatch.setitem(sys.modules, 'ultralytics', SimpleNamespace(YOLO=factory))
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda)))
    path = tmp_path / 'best.pt'
    path.write_bytes(b'test')
    return Detector(path, device), model, factory


@pytest.mark.parametrize(('device', 'expected'), [('cpu', 'cpu'), ('nvidia', 'cuda:0')])
def test_detection_reuses_model_and_maps_device(monkeypatch, tmp_path, device, expected):
    d, model, factory = detector(monkeypatch, tmp_path, device)
    result = d.detect(jpeg())
    assert (result['width'], result['height']) == (200, 100)
    assert result['boxes'] == [{'class_id': 0, 'confidence': 0.9, 'xyxy': [10, 20, 40, 80]}]
    d.detect(jpeg())
    assert factory.call_count == 1
    assert model.predict.call_args.kwargs == dict(imgsz=640, conf=0.25, iou=0.7,
                                                  agnostic_nms=False, device=expected, verbose=False)


@pytest.mark.parametrize('case', ['invalid', 'cuda', 'names', 'missing'])
def test_configuration_errors(monkeypatch, tmp_path, case):
    from hidagent.detection import DetectionError
    d, model, _ = detector(monkeypatch, tmp_path, device='bad' if case == 'invalid' else 'nvidia',
                           cuda=case != 'cuda', names={0: 'other'} if case == 'names' else None)
    if case == 'missing':
        d.path.unlink()
    with pytest.raises(DetectionError):
        d.detect(jpeg())
    model.predict.assert_not_called()


def test_busy_and_retry_after_failure(monkeypatch, tmp_path):
    from hidagent.detection import DetectionBusy, DetectionError
    d, model, _ = detector(monkeypatch, tmp_path)
    d.lock.acquire()
    with pytest.raises(DetectionBusy):
        d.detect(jpeg())
    d.lock.release()
    model.predict.side_effect = RuntimeError('private path')
    with pytest.raises(DetectionError):
        d.detect(jpeg())
    model.predict.side_effect = None
    model.predict.return_value[0].boxes = SimpleNamespace(
        xyxy=Mock(tolist=lambda: []), cls=Mock(tolist=lambda: []), conf=Mock(tolist=lambda: []))
    assert d.detect(jpeg())['boxes'] == []


def test_api_rejects_busy_before_scheduling_worker(monkeypatch):
    from fastapi import HTTPException

    from hidagent import app as api
    started, finish = threading.Event(), threading.Event()
    monkeypatch.setattr(api, 'screen', SimpleNamespace(live=True, frame=jpeg()))

    def slow(_):
        started.set()
        assert finish.wait(5)
        return {}

    monkeypatch.setattr(api.detector, 'detect', slow)

    async def run():
        first = asyncio.create_task(api.detection())
        await asyncio.to_thread(started.wait, 5)
        try:
            with pytest.raises(HTTPException) as exc:
                await asyncio.wait_for(api.detection(), 0.2)
            assert exc.value.status_code == 409
        finally:
            finish.set()
            await first

    asyncio.run(run())


def test_api_same_frame_and_errors(monkeypatch):
    from fastapi import HTTPException

    from hidagent import app as api
    from hidagent.detection import DetectionBusy, DetectionError
    frame = jpeg()
    screen = SimpleNamespace(live=True, frame=frame)
    monkeypatch.setattr(api, 'screen', screen)
    mock = Mock(return_value={'width': 200, 'height': 100, 'boxes': [], 'elapsed_ms': 1})
    monkeypatch.setattr(api.detector, 'detect', mock)
    response = asyncio.run(api.detection())
    payload = json.loads(response.body)
    assert base64.b64decode(payload['image']) == frame
    mock.assert_called_once_with(frame)
    assert response.headers['cache-control'] == 'no-store'
    for error, status in [(DetectionBusy(), 409), (DetectionError('test'), 503)]:
        mock.side_effect = error
        with pytest.raises(HTTPException) as exc:
            asyncio.run(api.detection())
        assert exc.value.status_code == status
    mock.side_effect = lambda _: setattr(screen, 'live', False) or {}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.detection())
    assert exc.value.status_code == 404
    mock.reset_mock()
    with pytest.raises(HTTPException):
        asyncio.run(api.detection())
    mock.assert_not_called()
