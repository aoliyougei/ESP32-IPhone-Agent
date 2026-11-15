import io
import sys
from types import SimpleNamespace
from unittest.mock import Mock

from PIL import Image


def image_bytes():
    out = io.BytesIO()
    Image.new('RGB', (200, 100), 'red').save(out, 'PNG')
    return out.getvalue()


def box(name, xyxy=(10, 20, 80, 70)):
    return {'class_name': name, 'class_id': 77, 'xyxy': list(xyxy), 'confidence': .9}


def setup_engine(monkeypatch):
    from hidagent.ocr import RegionOCR
    engine = Mock(return_value=([[[[1, 2], [10, 2], [10, 8], [1, 8]], '长安城 123,456', .92]], [0.1]))
    factory = Mock(return_value=engine)
    monkeypatch.setitem(sys.modules, 'rapidocr_onnxruntime', SimpleNamespace(RapidOCR=factory))
    return RegionOCR(), engine, factory


def test_target_regions_cpu_same_crop_and_reuse(monkeypatch):
    reader, engine, factory = setup_engine(monkeypatch)
    result = reader.read(image_bytes(), [box('front'), box('map_entry'), box('quest_panel'), box('current_task_panel')])
    assert result['error'] is None
    assert [r['class_name'] for r in result['regions']] == ['map_entry', 'quest_panel']
    assert result['regions'][0]['xyxy'] == [6, 16, 84, 74]
    line = result['regions'][0]['lines'][0]
    assert line == {'text': '长安城 123,456', 'confidence': .92}
    crop = engine.call_args.args[0]
    assert crop.shape == (58, 78, 3)
    # OpenCV/NumPy input convention is BGR, even though Pillow decodes RGB.
    assert tuple(crop[0, 0]) == (0, 0, 255)
    reader.read(image_bytes(), [box('map_entry')])
    assert factory.call_count == 1
    assert factory.call_args.kwargs['det_use_cuda'] is False
    assert factory.call_args.kwargs['rec_use_cuda'] is False
    assert factory.call_args.kwargs['intra_op_num_threads'] == 2
    assert engine.call_args.kwargs == {'use_det': True, 'use_cls': True, 'use_rec': True}


def test_no_targets_does_not_load_or_decode(monkeypatch):
    reader, _, factory = setup_engine(monkeypatch)
    assert reader.read(b'not an image', [box('front')])['regions'] == []
    factory.assert_not_called()


def test_clip_empty_invalid_and_all_regions(monkeypatch):
    reader, engine, _ = setup_engine(monkeypatch)
    result = reader.read(image_bytes(), [box('map_entry', (-5, -5, 20, 20)),
        box('quest_panel', (400, 20, 410, 30)), box('quest_panel', (20, 20, 10, 30)),
        box('map_entry', (float('nan'), 0, 10, 10))] + [box('quest_panel')] * 10)
    assert result['regions'][0]['xyxy'] == [0, 0, 24, 24]
    assert len(result['regions']) == 11
    assert result['skipped'] == 3
    assert engine.call_count == 11


def test_empty_result_and_failure_isolation(monkeypatch):
    reader, engine, _ = setup_engine(monkeypatch)
    engine.side_effect = [(None, None), RuntimeError('secret path')]
    result = reader.read(image_bytes(), [box('map_entry'), box('quest_panel')])
    assert result['regions'][0]['lines'] == []
    assert result['regions'][1]['error'] == 'OCR inference failed; check server logs'
    assert 'secret' not in str(result)


def test_init_failure_is_cached(monkeypatch):
    reader, _, factory = setup_engine(monkeypatch)
    factory.side_effect = RuntimeError('broken')
    for _ in range(2):
        result = reader.read(image_bytes(), [box('map_entry')])
        assert result['error'] == 'OCR unavailable; check dependencies and server logs'
        assert result['regions'] == []
    assert factory.call_count == 1


def test_all_dialog_options_are_read_and_keep_source_boxes(monkeypatch):
    reader, engine, _ = setup_engine(monkeypatch)
    options = [box('dialog_option', (10, y, 80, y + 5)) for y in reversed(range(10, 70, 5))]
    result = reader.read(image_bytes(), options + [box('dialog_close_button'), box('zhongkui_npc')])
    assert len(result['regions']) == 12
    assert result['skipped'] == 0
    assert engine.call_count == 12
    assert [r['source_xyxy'] for r in result['regions']] == [b['xyxy'] for b in options]
    assert all(r['class_name'] == 'dialog_option' for r in result['regions'])


def test_disabled(monkeypatch):
    from hidagent.ocr import RegionOCR
    assert RegionOCR(enabled=False).read(image_bytes(), [box('map_entry')])['enabled'] is False
