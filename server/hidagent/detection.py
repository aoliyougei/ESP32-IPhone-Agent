"""Optional, serialized YOLO inference. Raw screen frames are never modified."""

import io
import logging
import threading
import time
from pathlib import Path

from PIL import Image

log = logging.getLogger(__name__)


class DetectionError(RuntimeError):
    pass


class DetectionBusy(DetectionError):
    pass


class Detector:
    def __init__(self, path: Path, device: str = "cpu"):
        self.path, self.device = path, device
        self.lock = threading.Lock()
        self.model = None

    def detect(self, frame: bytes) -> dict:
        if not self.lock.acquire(blocking=False):
            raise DetectionBusy("Detection is busy; retry shortly")
        try:
            if self.device not in {"cpu", "nvidia"}:
                raise DetectionError("HIDAGENT_YOLO_DEVICE must be cpu or nvidia")
            if self.model is None:
                if not self.path.is_file():
                    raise DetectionError("Model file missing; configure HIDAGENT_YOLO_MODEL")
                try:
                    import torch
                    from ultralytics import YOLO
                except ImportError as e:
                    raise DetectionError("YOLO dependencies missing; install the yolo extra") from e
                if self.device == "nvidia" and not torch.cuda.is_available():
                    raise DetectionError("NVIDIA unavailable; check CUDA PyTorch and container GPU access")
                model = YOLO(str(self.path))
                if model.task != "detect" or dict(model.names) != {0: "front", 1: "back"}:
                    raise DetectionError("Incompatible model; expected detection classes 0:front, 1:back")
                self.model = model
            started = time.perf_counter()
            with Image.open(io.BytesIO(frame)) as source:
                image = source.convert("RGB")
            result = self.model.predict(image, imgsz=640, conf=0.25, iou=0.7, agnostic_nms=False,
                                        device="cuda:0" if self.device == "nvidia" else "cpu", verbose=False)[0]
            boxes = [{"class_id": int(cls), "confidence": float(conf), "xyxy": xyxy}
                     for cls, conf, xyxy in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist(),
                                               result.boxes.xyxy.tolist(), strict=True)]
            return {"width": image.width, "height": image.height, "boxes": boxes,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1)}
        except DetectionError:
            raise
        except Exception as e:
            log.exception("YOLO detection failed")
            raise DetectionError("Model loading or inference failed; check server logs") from e
        finally:
            self.lock.release()
