#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-brand-assets.py — 从物品图集裁出「猛爪手套」图标，生成站点品牌图（favicon + 登录框插画）。

背景：favicon 与登录框右侧插画都用游戏里的猛爪手套（FeralClaws，物品 id 211）贴图，
不额外引入版权不明的美术资源。两个产物都提交进仓库（与 data/ 图集同策略），
没有游戏源码的机器也能直接构建。

输入：
  data/items.json        找到 key = FeralClaws 的 icon（贴图 id）
  data/items-atlas.json  该贴图的裁切区域 [x, y, w, h]
  data/items-atlas.png   图集本体

输出：
  web/public/favicon.png      48×48，整数倍最近邻放大后居中（透明底，留 2px 左右边距）
  web/public/login-art.png    猛爪手套 10× 整数放大（220×240，透明底），登录框大屏插画

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-brand-assets.py
    python3 tools/gen-brand-assets.py --item FeralClaws --scale 10
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请执行：python3 -m pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

DEFAULT_ITEMS = os.path.join(PROJECT, "data", "items.json")
DEFAULT_ATLAS_JSON = os.path.join(PROJECT, "data", "items-atlas.json")
DEFAULT_ATLAS_PNG = os.path.join(PROJECT, "data", "items-atlas.png")
DEFAULT_FAVICON = os.path.join(PROJECT, "web", "public", "favicon.png")
DEFAULT_LOGIN_ART = os.path.join(PROJECT, "web", "public", "login-art.png")


def upscale(im, scale):
    """整数倍最近邻放大，保住像素画边缘。"""
    return im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)


def fit_square(im, box):
    """按能放下的最大整数倍放大，居中放进 box×box 的透明方框（左右/上下留匀称边距）。"""
    scale = max(1, min(box // im.width, box // im.height))
    big = upscale(im, scale)
    canvas = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    canvas.paste(big, ((box - big.width) // 2, (box - big.height) // 2))
    return canvas, scale


def main():
    ap = argparse.ArgumentParser(description="生成 favicon 与登录框插画（猛爪手套）")
    ap.add_argument("--item", default="FeralClaws", help="物品内部 key，默认 FeralClaws（猛爪手套）")
    ap.add_argument("--items", default=DEFAULT_ITEMS)
    ap.add_argument("--atlas-json", default=DEFAULT_ATLAS_JSON)
    ap.add_argument("--atlas-png", default=DEFAULT_ATLAS_PNG)
    ap.add_argument("--favicon", default=DEFAULT_FAVICON)
    ap.add_argument("--login-art", default=DEFAULT_LOGIN_ART)
    ap.add_argument("--favicon-size", type=int, default=48, help="favicon 方框边长，默认 48")
    ap.add_argument("--art-scale", type=int, default=10, help="登录插画放大倍数，默认 10")
    ap.add_argument("--skip-art", action="store_true", help="只生成 favicon")
    args = ap.parse_args()

    with open(args.items, encoding="utf-8") as f:
        items = json.load(f)["items"]
    item = next((it for it in items if it.get("key") == args.item), None)
    if item is None:
        sys.exit(f"items.json 里找不到 key = {args.item}")

    icon = str(item["icon"])
    with open(args.atlas_json, encoding="utf-8") as f:
        regions = json.load(f)["regions"]
    region = regions.get(icon)
    if region is None:
        sys.exit(f"图集里找不到贴图 id = {icon}（{args.item}）的裁切区域")

    x, y, w, h = region
    with Image.open(args.atlas_png) as sheet:
        sprite = sheet.crop((x, y, x + w, y + h)).convert("RGBA")

    favicon, fscale = fit_square(sprite, args.favicon_size)
    os.makedirs(os.path.dirname(args.favicon), exist_ok=True)
    favicon.save(args.favicon, optimize=True)
    print(f"{args.item} 贴图 id={icon} region={region}（{w}×{h}）")
    print(f"写出 {args.favicon}（{args.favicon_size}×{args.favicon_size}，{fscale}×）")

    if not args.skip_art:
        art = upscale(sprite, max(1, args.art_scale))
        os.makedirs(os.path.dirname(args.login_art), exist_ok=True)
        art.save(args.login_art, optimize=True)
        print(f"写出 {args.login_art}（{art.width}×{art.height}，{args.art_scale}×）")


if __name__ == "__main__":
    main()
