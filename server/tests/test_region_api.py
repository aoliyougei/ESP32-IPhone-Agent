from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from test_ocr import image_bytes, setup_engine


def test_region_ocr_independent_exact_crop(monkeypatch):
    import hidagent.app as module
    reader, engine, _ = setup_engine(monkeypatch)
    monkeypatch.setattr(module, 'region_ocr', reader)
    monkeypatch.setattr(module, 'screen', SimpleNamespace(live=True, frame=image_bytes()))
    monkeypatch.setattr(module.detector, 'detect', lambda _: pytest.fail('YOLO must not run'))
    response = TestClient(module.app).post('/api/ocr/region', json={'region': [.1, .2, .5, .35]})
    assert response.status_code == 200
    data = response.json()
    assert (data['width'], data['height']) == (200, 100)
    assert data['xyxy'] == [20, 20, 100, 35]
    assert data['lines'] == [{'text': '长安城 123,456', 'confidence': .92}]
    assert engine.call_args.args[0].shape == (15, 80, 3)
    assert response.headers['cache-control'] == 'no-store'


@pytest.mark.parametrize('region', [[0, 0, 0, 1], [1, 0, 0, 1], [-.1, 0, 1, 1],
                                    [0, 0, 1.1, 1], [0, 0, 1], [0, 0, 1, 1, 1],
                                    ['NaN', 0, 1, 1], ['Infinity', 0, 1, 1]])
def test_invalid_region(monkeypatch, region):
    import hidagent.app as module
    assert TestClient(module.app).post('/api/ocr/region', json={'region': region}).status_code == 422


def test_engine_failure_and_empty_text(monkeypatch):
    import hidagent.app as module
    reader, engine, _ = setup_engine(monkeypatch)
    monkeypatch.setattr(module, 'region_ocr', reader)
    monkeypatch.setattr(module, 'screen', SimpleNamespace(live=True, frame=image_bytes()))
    client = TestClient(module.app)
    engine.return_value = (None, None)
    assert client.post('/api/ocr/region', json={'region': [0, 0, 1, 1]}).json()['lines'] == []
    engine.side_effect = RuntimeError('private engine path')
    response = client.post('/api/ocr/region', json={'region': [0, 0, 1, 1]})
    assert response.status_code == 503
    assert 'private' not in response.text


def test_busy_region_request(monkeypatch):
    import hidagent.app as module
    monkeypatch.setattr(module, 'ocr_task', SimpleNamespace(done=lambda: False))
    assert TestClient(module.app).post('/api/ocr/region', json={'region': [0, 0, 1, 1]}).status_code == 409


def test_missing_frame_and_disabled_ocr(monkeypatch):
    import hidagent.app as module
    from hidagent.ocr import RegionOCR
    monkeypatch.setattr(module, 'screen', SimpleNamespace(live=False, frame=b''))
    client = TestClient(module.app)
    assert client.post('/api/ocr/region', json={'region': [0, 0, 1, 1]}).status_code == 404
    monkeypatch.setattr(module, 'screen', SimpleNamespace(live=True, frame=image_bytes()))
    monkeypatch.setattr(module, 'region_ocr', RegionOCR(enabled=False))
    assert client.post('/api/ocr/region', json={'region': [0, 0, 1, 1]}).status_code == 503
