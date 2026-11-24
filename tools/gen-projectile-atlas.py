#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-projectile-atlas.py —— 把射弹贴图的「第一帧」拼成一张 sprite 图集 + 裁切信息。

事实来源（Terraria 1.4.5.8 反编译源码 / 已解包贴图）：
  - 贴图 `Terraria Content/Images/Projectile_<id>.png` 是**竖向排的动画条**（1 张 1136 个，id 齐全）。
  - 帧数 = `Main.projFrames[id]`（`Terraria/Main.cs` 里先全置 1、再逐个覆盖；281 条 > 1 帧，最多 54 帧）。
    按帧数切出第一帧，否则动画条会被当成一张超长贴图塞进格子。
  - 原尺寸首帧合计约 11.1M 像素（≈44MB 原始），整张入库不现实，所以**等比缩进 --box 的方框**
    （只缩不放：小于方框的保持原生像素，缩完约 0.96M 像素）。

产出：
  data/projectile-atlas.webp   图集（随仓库提交；无损 WebP；版权 Re-Logic）
  data/projectile-atlas.json   裁切信息 { regions: { projectileId: [x, y, w, h] } } + 内容哈希

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-projectile-atlas.py
    python3 tools/gen-projectile-atlas.py --sprite-dir /path/to/Content/Images --box 48 --limit-width 1024
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请执行：python3 -m pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

DEFAULT_DATA = os.path.join(PROJECT, "data", "projectiles.json")
DEFAULT_TR_SRC = os.path.join(PROJECT, "..", "tr-code-1458")
DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "projectile-atlas.json")
DEFAULT_OUT_IMAGE = os.path.join(PROJECT, "data", "projectile-atlas.webp")

# 1×1 占位贴图（19 个：无贴图的内部射弹）不画，保持透明；游戏里这些射弹本身也不可见。
EMPTY_MAX = 1


def parse_frame_counts(tr_src):
    """从 Main.cs 解析 `projFrames`：先全置 1，再逐个 `projFrames[id] = n;` 覆盖。"""
    text = open(os.path.join(tr_src, "Terraria", "Main.cs"), encoding="utf-8").read()
    counts = {}
    for m in re.finditer(r"projFrames\[(\d+)\]\s*=\s*(\d+);", text):
        counts[int(m.group(1))] = int(m.group(2))
    return counts


def first_frame(im, frames):
    """竖向动画条的第一帧（帧高 = 高 / 帧数）。"""
    w, h = im.size
    if frames <= 1 or h % frames != 0:
        return im
    return im.crop((0, 0, w, h // frames))


def fit(im, box):
    """等比缩进 box×box（只缩不放）。"""
    w, h = im.size
    longest = max(w, h)
    if longest <= box:
        return im
    scale = box / longest
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def pack(regions, limit_width, padding):
    """regions: {id: (w, h)} -> {id: (x, y, w, h)}, (总宽, 总高)；高降序、宽升序，逐行摆放。"""
    order = sorted(regions.items(), key=lambda kv: (-kv[1][1], kv[1][0]))
    placed = {}
    x = y = row_h = 0
    max_x = 0
    for key, (w, h) in order:
        if x + w > limit_width and x > 0:
            x = 0
            y += row_h + padding
            row_h = 0
        placed[key] = (x, y, w, h)
        max_x = max(max_x, x + w)
        x += w + padding
        row_h = max(row_h, h)
    return placed, (max(1, max_x), y + row_h)


def main():
    ap = argparse.ArgumentParser(description="生成射弹图标图集（首帧）")
    ap.add_argument("--data", default=DEFAULT_DATA, help="data/projectiles.json 路径")
    ap.add_argument("--tr-src", default=os.environ.get("TR_SRC", DEFAULT_TR_SRC))
    ap.add_argument("--sprite-dir", default=os.environ.get("SPRITE_DIR", DEFAULT_SPRITE))
    ap.add_argument("--out-json", default=DEFAULT_OUT_JSON)
    ap.add_argument("--out-image", default=DEFAULT_OUT_IMAGE)
    ap.add_argument("--box", type=int, default=48, help="单张贴图最大边长，默认 48（等比缩放，只缩不放）")
    ap.add_argument("--limit-width", type=int, default=1024, help="图集最大宽度，默认 1024")
    ap.add_argument("--padding", type=int, default=1, help="每格之间的留白像素，默认 1（防缩放插值采到邻居）")
    args = ap.parse_args()

    data = json.load(open(args.data, encoding="utf-8"))
    projectiles = data["projectiles"]
    frames = parse_frame_counts(args.tr_src)

    sprites = {}
    sizes = {}
    missing = []
    empty = []
    for p in projectiles:
        pid = p["id"]
        path = os.path.join(args.sprite_dir, f"Projectile_{pid}.png")
        if not os.path.exists(path):
            missing.append(pid)
            continue
        im = Image.open(path).convert("RGBA")
        frame = fit(first_frame(im, frames.get(pid, 1)), args.box)
        if max(frame.size) <= EMPTY_MAX:
            empty.append(pid)
            continue
        sprites[pid] = frame
        sizes[pid] = frame.size

    placed, (total_w, total_h) = pack(sizes, args.limit_width, args.padding)
    atlas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    for pid, im in sprites.items():
        x, y, _, _ = placed[pid]
        atlas.alpha_composite(im, (x, y))
    atlas.save(args.out_image, "WEBP", lossless=True, quality=100, method=6)
    atlas_hash = hashlib.md5(open(args.out_image, "rb").read()).hexdigest()[:12]

    payload = {
        "meta": {
            "gameVersion": data.get("meta", {}).get("gameVersion", ""),
            "width": total_w,
            "height": total_h,
            "limitWidth": args.limit_width,
            "padding": args.padding,
            "box": args.box,
            "count": len(placed),
            "missing": len(missing),
            "empty": len(empty),
            "sheet": os.path.basename(args.out_image),
            "hash": atlas_hash,
            "generatedBy": "tools/gen-projectile-atlas.py",
            "source": "Terraria Content/Images/Projectile_<id>.png 第一帧（帧数取 Main.projFrames），等比缩进 box 方框",
            "note": "regions[projectileId] = [x, y, w, h]；键与 data/projectiles.json 的 id 一致；1×1 占位贴图不收录（meta.empty）。",
        },
        "regions": {str(k): list(v) for k, v in placed.items()},
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")

    kb = os.path.getsize(args.out_image) / 1024
    print(
        f"射弹图集：{len(placed)} 个 / 缺贴图 {len(missing)} 个 / 空贴图 {len(empty)} 个 "
        f"-> {args.out_image} ({total_w}×{total_h}, {kb:.0f} KB)"
    )
    if missing:
        print("缺贴图 id:", missing[:50], file=sys.stderr)
    if total_h > 8192:
        print(f"⚠ 图集高度 {total_h} 超过 8192（仍会输出）", file=sys.stderr)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"耗时 {time.time() - t0:.1f}s")
