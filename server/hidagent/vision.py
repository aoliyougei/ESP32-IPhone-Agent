"""Small image checks on screen frames: did the screen change, and where is the pointer."""

import io

from PIL import Image, ImageChops, ImageFilter


def _gray(jpeg: bytes) -> Image.Image:
    return Image.open(io.BytesIO(jpeg)).convert("L")


def changed(before: bytes | None, after: bytes | None, ignore: tuple = (), threshold: float = 1.0) -> bool:
    """True when the screen content changed, including small things such as a checkmark.

    `ignore` lists screen points (fractions) where the pointer was or went: those spots are masked, so pointer
    moves never count. The status bar (clock) is ignored too.
    """
    if not before or not after:
        return True
    a, b = _gray(before), _gray(after)
    if a.size != b.size:
        return True
    small = ImageChops.difference(a.resize((32, 64), Image.BILINEAR), b.resize((32, 64), Image.BILINEAR)).tobytes()
    if sum(small) / len(small) > threshold:  # a big change: new screen, scrolled list, keyboard
        return True
    w, h = a.size[0] // 2, a.size[1] // 2  # fine pass for small changes, at half resolution
    diff = ImageChops.difference(a.resize((w, h), Image.BILINEAR), b.resize((w, h), Image.BILINEAR)).tobytes()
    masks = [(px * w, py * h) for px, py in ignore]
    hits = 0
    for i, v in enumerate(diff):
        if v > 25:
            x, y = i % w, i // w
            if y > 0.06 * h and all((x - mx) ** 2 + (y - my) ** 2 > (0.05 * w) ** 2 for mx, my in masks):
                hits += 1
    return hits >= 6


def calibration_pointer(before: bytes, after: bytes, axis: str, direction: int = 1) -> tuple[float, float] | None:
    """Locate the destination of a single-axis move; reject anything but two compact changed spots.

    Unlike aim detection this includes the screen edges and measures displacement, not an assumed nudge.
    Calibration requires a still background and a visible pointer at both stops.
    """
    a, b = _gray(before), _gray(after)
    if a.size != b.size:
        return None
    a.thumbnail((640, 640))
    b = b.resize(a.size)
    w, h = a.size
    mask = ImageChops.difference(a, b).point(lambda v: 255 if v > 30 else 0)
    # Join JPEG-fragmented pointer pixels without merging the distant sampling stops.
    joined = mask.filter(ImageFilter.MaxFilter(3))
    pixels, original = joined.tobytes(), mask.tobytes()
    remaining = {i for i, value in enumerate(pixels) if value}
    if len(remaining) > w * h * 0.08:
        return None
    spots = []
    while remaining:
        seed = remaining.pop()
        pending, points = [seed], []
        while pending:
            i = pending.pop()
            if original[i]:
                points.append((i % w, i // w))
            for x, y in ((i % w - 1, i // w), (i % w + 1, i // w),
                         (i % w, i // w - 1), (i % w, i // w + 1)):
                neighbor = y * w + x
                if 0 <= x < w and 0 <= y < h and neighbor in remaining:
                    remaining.remove(neighbor)
                    pending.append(neighbor)
        if len(points) < 4:
            continue
        xs, ys = zip(*points, strict=True)
        if max(xs) - min(xs) > 0.12 * min(w, h) or max(ys) - min(ys) > 0.12 * min(w, h):
            return None
        spots.append((sum(xs) / len(xs) / w, sum(ys) / len(ys) / h, len(points)))
        if len(spots) > 2:
            return None
    if len(spots) != 2 or max(s[2] for s in spots) > 3 * min(s[2] for s in spots):
        return None
    index = 0 if axis == "x" else 1
    start, end = sorted(spots, key=lambda s: direction * s[index])
    if direction * (end[index] - start[index]) < 0.03 or abs(end[1 - index] - start[1 - index]) > 0.015:
        return None
    # Difference alone is unsigned: check which spot became pointer-like in the after frame.
    # A normal pointer keeps its appearance between the two locations.
    sx, sy = round(start[0] * w), round(start[1] * h)
    ex, ey = round(end[0] * w), round(end[1] * h)
    def contrast(image, x, y):
        radius = max(3, round(0.045 * min(w, h)))
        ring = [image.getpixel((min(w - 1, max(0, x + dx)), min(h - 1, max(0, y + dy))))
                for dx, dy in ((radius, 0), (-radius, 0), (0, radius), (0, -radius))]
        return abs(image.getpixel((x, y)) - sum(ring) / len(ring))

    if (abs(a.getpixel((sx, sy)) - b.getpixel((ex, ey))) > 35
            or contrast(a, sx, sy) < contrast(b, sx, sy) + 20
            or contrast(b, ex, ey) < contrast(a, ex, ey) + 20):
        return None
    return end[0], end[1]


def pointer(before: bytes, after: bytes, near: tuple[float, float], shift: float,
            reach: tuple[float, float] = (0.12, 0.08)) -> tuple[float, float] | None:
    """Where the pointer is in `before`, given it moved right by `shift` (fraction of width) in `after`.

    Only the pointer moved between the two frames, so the changed pixels within `reach` of `near` are the
    pointer at both spots; their centroid sits shift/2 to the right of the first one. None if unclear:
    nothing moved, or the change is too big or too spread out to be one small pointer.
    """
    a, b = _gray(before), _gray(after)
    if a.size != b.size:
        return None
    w, h = a.size
    rx, ry = reach
    left, top = max(0, int((near[0] - rx) * w)), max(int(0.05 * h), int((near[1] - ry) * h))  # skip the status bar
    box = (left, top, min(w, int((near[0] + rx) * w)), min(h, int((near[1] + ry) * h)))
    diff = ImageChops.difference(a.crop(box), b.crop(box)).tobytes()
    bw = box[2] - box[0]
    hits = [(i % bw, i // bw) for i, v in enumerate(diff) if v > 30]
    if not 15 <= len(hits) <= len(diff) // 4:  # nothing moved, or much more than a pointer
        return None
    xs, ys = [x for x, _ in hits], [y for _, y in hits]
    if max(xs) - min(xs) > 0.15 * w or max(ys) - min(ys) > 0.07 * h:  # not one compact spot
        return None
    cx = sum(x for x, _ in hits) / len(hits) + left
    cy = sum(y for _, y in hits) / len(hits) + top
    return cx / w - shift / 2, cy / h
