#!/usr/bin/env python3
"""Pre-scale assets/tomo-hashi-hanko.png to 144x144 with edge-connected
transparent background.

Why this script exists:
  The settings header inlines the hanko via esbuild's `dataurl` loader. The
  master PNG is 1024x1024 (~1.4 MB inlined); the 144x144 derivative is ~36 KB
  and HiDPI-crisp at the rendered 72x72. The original is preserved as the
  master so future revisions / banners can re-derive at any size.

  The transparent-background step uses a 4-connected flood fill seeded from
  the four image edges with a near-white threshold (default 230). Only
  edge-reachable near-white pixels become alpha=0, so the white characters
  inside the red stamp stay white because the red border isolates them.

Usage:
  python3 scripts/build-hanko-144.py            # default in/out paths
  python3 scripts/build-hanko-144.py --threshold 240
"""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO_ROOT / "assets" / "tomo-hashi-hanko.png"
DEFAULT_DST = REPO_ROOT / "assets" / "tomo-hashi-hanko-144.png"


def near_white(rgba: tuple[int, int, int, int], threshold: int) -> bool:
    r, g, b, a = rgba
    return a > 0 and r >= threshold and g >= threshold and b >= threshold


def make_outer_white_transparent(img: Image.Image, threshold: int) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    visited = [[False] * h for _ in range(w)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if near_white(px[x, y], threshold) and not visited[x][y]:
                visited[x][y] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if near_white(px[x, y], threshold) and not visited[x][y]:
                visited[x][y] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny]:
                if near_white(px[nx, ny], threshold):
                    visited[nx][ny] = True
                    q.append((nx, ny))

    return img


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    parser.add_argument("--dst", type=Path, default=DEFAULT_DST)
    parser.add_argument("--size", type=int, default=144,
                        help="Output square size in pixels (default 144 = 2x HiDPI of 72px header).")
    parser.add_argument("--threshold", type=int, default=230,
                        help="Near-white threshold 0-255 (default 230). Raise to 240-250 if heavy antialiasing leaves a white halo; lower if interior colour bleeds.")
    args = parser.parse_args()

    src = args.src.resolve()
    dst = args.dst.resolve()
    if not src.is_file():
        raise SystemExit(f"source not found: {src}")

    print(f"loading {src} ({src.stat().st_size:,} bytes)")
    img = Image.open(src)

    # Resize first so the flood fill operates on the final pixel grid — this
    # keeps the antialiased edge consistent with what the user actually sees.
    img = img.resize((args.size, args.size), Image.Resampling.LANCZOS)

    img = make_outer_white_transparent(img, threshold=args.threshold)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "PNG", optimize=True)
    print(f"wrote   {dst} ({dst.stat().st_size:,} bytes, {args.size}x{args.size}, threshold={args.threshold})")


if __name__ == "__main__":
    main()
