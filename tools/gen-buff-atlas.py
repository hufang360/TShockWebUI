#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-buff-atlas.py —— 把所有 Buff 图标拼成一张 sprite 图集 + 裁切信息。

Buff 图标是游戏 `Content/Images/Buff_<id>.png` 里的静态贴图（1.4.5.8 全部 400 张，32×32），
没有动画帧；这里按 `data/buffs.json` 的 id 全量收录。

流程：
  1. 读 `data/buffs.json` 得到 buff id；
  2. 逐张打开 `Buff_<id>.png`（保留原始尺寸），按「高降序、宽升序」逐行摆放，
     超过 limit-width 换行，每格之间留 1px 透明缝（防缩放插值采到邻居）；
  3. 输出：
       data/buff-atlas.png    图集（随仓库提交；版权 Re-Logic）
       data/buff-atlas.json   裁切信息 { regions: { buffId: [x, y, w, h] } } + 内容哈希

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-buff-atlas.py
    python3 tools/gen-buff-atlas.py --sprite-dir /path/to/Content/Images --limit-width 1024
"""

import argparse
import hashlib
import json
import os
import sys
import time

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请执行：python3 -m pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

DEFAULT_BUFFS = os.path.join(PROJECT, "data", "buffs.json")
DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "buff-atlas.json")
DEFAULT_OUT_PNG = os.path.join(PROJECT, "data", "buff-atlas.png")


def pack(regions, limit_width, padding):
    """regions: {buffId: (w, h)} -> {buffId: (x, y, w, h)}, (总宽, 总高)"""
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
    ap = argparse.ArgumentParser(description="生成 Buff 图标图集")
    ap.add_argument("--buffs", default=DEFAULT_BUFFS, help="data/buffs.json 路径")
    ap.add_argument("--sprite-dir", default=os.environ.get("SPRITE_DIR", DEFAULT_SPRITE))
    ap.add_argument("--out-json", default=DEFAULT_OUT_JSON)
    ap.add_argument("--out-png", default=DEFAULT_OUT_PNG)
    ap.add_argument("--limit-width", type=int, default=1024, help="图集最大宽度，默认 1024")
    ap.add_argument("--padding", type=int, default=1, help="每格之间的留白像素，默认 1（防缩放插值采到邻居）")
    ap.add_argument("--max-height", type=int, default=8192, help="超过此高度只告警，不自动切图")
    args = ap.parse_args()

    buffs_data = json.load(open(args.buffs, encoding="utf-8"))
    buffs = buffs_data["buffs"]

    sprites = {}
    sizes = {}
    missing = []
    for b in buffs:
        bid = b["id"]
        path = os.path.join(args.sprite_dir, f"Buff_{bid}.png")
        if not os.path.exists(path):
            missing.append(bid)
            continue
        im = Image.open(path).convert("RGBA")
        sprites[bid] = im
        sizes[bid] = im.size

    placed, (total_w, total_h) = pack(sizes, args.limit_width, args.padding)
    oversized = sorted(((bid, w) for bid, (_, _, w, _) in placed.items() if w > args.limit_width))
    if oversized:
        print(
            f"⚠ {len(oversized)} 张图标宽于 --limit-width({args.limit_width})，图集已放宽到 {total_w}px：{oversized[:10]}",
            file=sys.stderr,
        )
    if total_h > args.max_height:
        print(f"⚠ 图集高度 {total_h} 超过上限 {args.max_height}（仍会输出）", file=sys.stderr)

    atlas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    for bid, im in sprites.items():
        x, y, _, _ = placed[bid]
        atlas.alpha_composite(im, (x, y))
    atlas.save(args.out_png)
    png_hash = hashlib.md5(open(args.out_png, "rb").read()).hexdigest()[:12]

    payload = {
        "meta": {
            "gameVersion": buffs_data.get("meta", {}).get("gameVersion", ""),
            "width": total_w,
            "height": total_h,
            "limitWidth": args.limit_width,
            "padding": args.padding,
            "count": len(placed),
            "missing": len(missing),
            "sheet": os.path.basename(args.out_png),
            "hash": png_hash,
            "generatedBy": "tools/gen-buff-atlas.py",
            "source": "Terraria Content/Images/Buff_<id>.png（静态图标，无动画帧）",
            "note": "regions[buffId] = [x, y, w, h]；键与 data/buffs.json 的 id 一致。",
        },
        "regions": {str(k): list(v) for k, v in placed.items()},
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print(f"Buff 图集：{len(placed)} 个 / 缺图标 {len(missing)} 个 -> {args.out_png} ({total_w}×{total_h})")
    if missing:
        print("缺图标 id:", missing[:50], file=sys.stderr)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"耗时 {time.time() - t0:.1f}s")
