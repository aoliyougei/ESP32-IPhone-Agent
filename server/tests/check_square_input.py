"""Opt-in real-model check: python tests/check_square_input.py /trusted/best.pt (inside Docker)."""

import io
import sys
from pathlib import Path

from PIL import Image
from ultralytics import YOLO

from hidagent.detection import Detector

path = Path(sys.argv[1])
model = YOLO(str(path))
shapes = []
hook = model.model.register_forward_pre_hook(lambda module, args: shapes.append(list(args[0].shape)))
try:
    detector = Detector(path, imgsz=960)
    detector.model = model
    for size in [(1920, 888), (888, 1920), (1921, 888)]:
        frame = io.BytesIO()
        Image.new("RGB", size).save(frame, "JPEG")
        shapes.clear()
        result = detector.detect(frame.getvalue())
        assert shapes and all(shape == [1, 3, 960, 960] for shape in shapes), shapes
        assert (result["width"], result["height"]) == size
        print(f"Original {size}: actual forward inputs {shapes}")
    assert model.names[77] == "map_entry"
    print("Actual square input and map_entry=77 verified")
finally:
    hook.remove()
