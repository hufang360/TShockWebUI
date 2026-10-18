#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-atlas.py — 把所有物品图标（含动画取第一帧）拼成一张 sprite 图集 + 裁切信息。

参考 FishShopConfig 的 items.png / itemsPngInfo 方案，
但改为全自动，且覆盖全部 6195 个物品 ID。

流程：
  1. 读 data/items.json，得到每个物品的贴图 id (icon)、帧数 (frames)、贴图尺寸 (sprite)
  2. 每个贴图只处理一次，裁剪第一帧：宽 × (高 / frames)
  3. 按「高降序、宽升序」排序，逐行摆放，超过 limitWidth 换行（与参考项目一致）
  4. 输出：
       data/items-atlas.png    图集（随仓库提交）
       data/items-atlas.json   裁切信息 { regions: { 贴图id: [x, y, w, h] } }
  5. 前端：item.icon -> regions[icon] -> canvas.drawImage(atlas, x, y, w, h, ...)
     像素风请设 imageSmoothingEnabled = false

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-atlas.py
    python3 tools/gen-atlas.py --limit-width 1024 --padding 0
    python3 tools/gen-atlas.py --items data/items.json --sprite-dir /path/to/Images
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

DEFAULT_ITEMS = os.path.join(PROJECT, "data", "items.json")
DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "items-atlas.json")
DEFAULT_OUT_PNG = os.path.join(PROJECT, "data", "items-atlas.png")


def pack(regions, limit_width, padding):
    """regions: {iconId: (w, h)} -> {iconId: (x, y, w, h)}, (总宽, 总高)"""
    order = sorted(regions.items(), key=lambda kv: (-kv[1][1], kv[1][0]))
    placed = {}
    x = y = row_h = 0
    max_x = 0
    for icon, (w, h) in order:
        if x + w > limit_width and x > 0:
            x = 0
            y += row_h + padding
            row_h = 0
        placed[icon] = (x, y, w, h)
        max_x = max(max_x, x + w)
        x += w + padding
        row_h = max(row_h, h)
    return placed, (max(1, min(limit_width, max_x)), y + row_h)


def main():
    ap = argparse.ArgumentParser(description="生成物品图标图集")
    ap.add_argument("--items", default=DEFAULT_ITEMS, help="data/items.json 路径")
    ap.add_argument("--sprite-dir", default=DEFAULT_SPRITE, help="Item_<id>.png 所在目录")
    ap.add_argument("--out-json", default=DEFAULT_OUT_JSON)
    ap.add_argument("--out-png", default=DEFAULT_OUT_PNG)
    ap.add_argument("--limit-width", type=int, default=1024, help="图集最大宽度，默认 1024")
    ap.add_argument("--padding", type=int, default=0, help="每格四周留白像素，默认 0")
    ap.add_argument("--max-height", type=int, default=8192, help="超过此高度只告警，不自动切图")
    args = ap.parse_args()

    with open(args.items, encoding="utf-8") as f:
        items_data = json.load(f)
    items = items_data["items"]
    meta = items_data.get("meta", {})

    # 每个贴图只放一次；这里按「贴图 id」记录尺寸（第一帧）
    textures = {}
    for it in items:
        icon = it.get("icon")
        if icon is None or icon in textures:
            continue
        w, h = it["sprite"]
        frames = max(1, int(it.get("frames", 1)))
        textures[icon] = (w, h // frames)

    print(f"物品 {len(items)} 个，唯一贴图 {len(textures)} 张")

    placed, (width, height) = pack(textures, args.limit_width, args.padding)
    print(f"图集尺寸 {width} x {height}（{width * height} 像素）")
    if height > args.max_height:
        print(f"警告：图集高度 {height} 超过 max-height {args.max_height}，部分设备可能无法加载，"
              f"请调小 --limit-width 或改成分页", file=sys.stderr)

    t0 = time.time()
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    done = 0
    for icon, (px, py, w, h) in placed.items():
        path = os.path.join(args.sprite_dir, f"Item_{icon}.png")
        im = Image.open(path).convert("RGBA")
        if im.size != (w, h):
            im = im.crop((0, 0, w, h))
        atlas.paste(im, (px, py))
        done += 1
    print(f"合成 {done} 张，用时 {time.time() - t0:.2f}s")

    os.makedirs(os.path.dirname(args.out_png), exist_ok=True)
    atlas.save(args.out_png, optimize=True)
    png_hash = hashlib.md5(open(args.out_png, "rb").read()).hexdigest()[:12]
    size_mb = os.path.getsize(args.out_png) / 1e6
    print(f"写出 {args.out_png}（{size_mb:.2f} MB）")

    regions = {str(icon): list(rect) for icon, rect in placed.items()}
    out = {
        "meta": {
            "gameVersion": meta.get("gameVersion"),
            "width": width,
            "height": height,
            "limitWidth": args.limit_width,
            "padding": args.padding,
            "textures": len(textures),
            "items": len(items),
            "sheet": os.path.basename(args.out_png),
            "hash": png_hash,
            "generatedBy": "tools/gen-atlas.py",
            "note": "regions 以「贴图 id」为键；前端用 item.icon 取值后再裁剪第一帧",
        },
        "regions": regions,
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"写出 {args.out_json}")


if __name__ == "__main__":
    main()
