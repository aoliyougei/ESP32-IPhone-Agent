"""CPU-only OCR of selected YOLO regions, called inside the serialized detection worker."""

import io
import logging
import math
import time

from PIL import Image

log = logging.getLogger(__name__)
TARGETS = {"map_entry", "quest_panel", "dialog_option", "battle_round_counter"}


class RegionOCR:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.engine = None
        self.init_error = None

    def read(self, frame: bytes, boxes: list[dict]) -> dict:
        started = time.perf_counter()
        output = {"enabled": self.enabled, "regions": [], "error": None, "skipped": 0, "elapsed_ms": 0.0}
        targets = [box for box in boxes if box.get("class_name") in TARGETS]
        if not self.enabled or not targets:
            return output
        try:
            if self.engine is None and self.init_error is None:
                try:
                    from rapidocr_onnxruntime import RapidOCR

                    self.engine = RapidOCR(det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False,
                                           det_use_dml=False, cls_use_dml=False, rec_use_dml=False,
                                           intra_op_num_threads=2, inter_op_num_threads=1)
                except Exception:
                    log.exception("OCR initialization failed")
                    self.init_error = "OCR unavailable; check dependencies and server logs"
            if self.init_error:
                output["error"] = self.init_error
                return output
            import numpy as np

            with Image.open(io.BytesIO(frame)) as source:
                image = source.convert("RGB")
            for box in targets:
                coords = box.get("xyxy", [])
                if (len(coords) != 4 or not all(math.isfinite(v) for v in coords)
                        or coords[2] <= coords[0] or coords[3] <= coords[1]):
                    output["skipped"] += 1
                    continue
                x1, y1, x2, y2 = coords
                # A small margin avoids cutting edge strokes, bounded to the original frame.
                crop_box = [max(0, min(image.width, math.floor(x1) - 4)),
                            max(0, min(image.height, math.floor(y1) - 4)),
                            max(0, min(image.width, math.ceil(x2) + 4)),
                            max(0, min(image.height, math.ceil(y2) + 4))]
                if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
                    output["skipped"] += 1
                    continue
                region = {"class_name": box["class_name"], "source_xyxy": list(coords),
                          "xyxy": crop_box, "lines": [], "error": None}
                try:
                    crop = np.asarray(image.crop(crop_box))[:, :, ::-1].copy()  # NumPy input is BGR.
                    result, _ = self.engine(crop, use_det=True, use_cls=True, use_rec=True)
                    region["lines"] = [{"text": str(row[1]), "confidence": float(row[2])}
                                       for row in (result or [])]
                except Exception:
                    log.exception("OCR region inference failed")
                    region["error"] = "OCR inference failed; check server logs"
                output["regions"].append(region)
        except Exception:
            log.exception("OCR frame processing failed")
            output["error"] = "OCR frame processing failed; check server logs"
        finally:
            output["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return output
