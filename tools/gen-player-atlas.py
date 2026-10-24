#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-player-atlas.py — 把「玩家全身图」需要的角色部件 / 发型贴图打包成一张图集。

目标：在浏览器里按游戏 `PlayerDrawLayers` 的层级与合成帧绘制**创建角色界面**那样的
角色预览（只画皮肤 / 衣服 / 头发，不含盔甲与饰品穿戴后的外观）。

事实来源（Terraria 1.4.5.8 反编译源码）：
  - 贴图集合与性别：`Terraria.Initializers/PlayerDataInitializer.cs`（LoadVariant / CopyVariant）。
    变体 1/2/3/8 以 0 为底，5/6/7/9 以 4 为底，11 以 10 为底；缺的部件回退到底包。
  - 站姿合成帧：`Terraria.DataStructures/PlayerDrawSet.cs` 的 `CreateCompositeData`
    （40×56 一格；`frameIndex2` 起始 (2,0)，`frameIndex` (2,2)，`pt=(1,1)`、`pt2=(0,1)`、
    `pt3=(0,0)`；女性 pt/pt2/pt3 的 Y 再 +2）。
  - 层级：`Terraria.Graphics.Renderers/LegacyPlayerRenderer.cs` 的 `DrawPlayer_UseNormalLayers`。
  - 站立帧：`UICharacter.UpdateAnim` 把 body/leg/head 帧 Y 置 0。

产出：
  data/player-atlas.png   图集（不入库，构建时生成）
  data/player-atlas.json  裁切信息，键：
    "b:<variant>:<part>:<role>"  角色部件（变体 0..11，部件号见 PlayerTextureID）
    "h:<hair>"                   发型（hair 为 0 基，对应 Player_Hair_<hair+1>.png 第 0 帧）
  值均为 [x, y, 40, 56]。

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-player-atlas.py
    python3 tools/gen-player-atlas.py --sprite-dir /path/to/Images --limit-width 1024
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

DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "player-atlas.json")
DEFAULT_OUT_PNG = os.path.join(PROJECT, "data", "player-atlas.png")

FRAME_W, FRAME_H = 40, 56
VARIANT_COUNT = 12
HAIR_COUNT = 228  # TextureAssets.PlayerHair.Length，hair 0..227

# 男性变体集合（PlayerVariantID.Sets.Male：0,1,2,3,8,10）
MALE_VARIANTS = {0, 1, 2, 3, 8, 10}

# 各性别下「合成帧角色」对应的 (列, 行)。见 PlayerDrawSet.CreateCompositeData。
GENDER_FRAMES = {
    "male": {
        "torso": (0, 0),          # pt3
        "backShoulder": (1, 1),   # pt
        "frontShoulder": (0, 1),  # pt2
        "backArm": (2, 2),        # frameIndex
        "frontArm": (2, 0),       # frameIndex2
        "leg": (0, 0),
    },
    "female": {
        "torso": (0, 2),
        "backShoulder": (1, 3),
        "frontShoulder": (0, 3),
        "backArm": (2, 2),
        "frontArm": (2, 0),
        "leg": (0, 0),
    },
}

# 部件号 -> [(role)]，role 会按性别映射到具体帧。
# 部件号见 Terraria.ID/PlayerTextureID.cs：0 Head / 1 EyeWhites / 2 Eyes / 3 TorsoSkin /
# 4 Undershirt / 5 Hands / 6 Shirt / 7 ArmSkin / 8 ArmUndershirt / 9 ArmHand /
# 10 LegSkin / 11 Pants / 12 Shoes / 13 ArmShirt / 14 Extra / 15 EyeBlink。
PART_ROLES = {
    0: ["head"],
    1: ["eyeWhites"],
    2: ["eyes"],
    3: ["torso"],
    4: ["torso", "backShoulder"],
    5: ["backArm"],
    6: ["torso", "backShoulder", "frontArm", "frontShoulder"],
    7: ["backArm", "frontArm", "frontShoulder"],
    8: ["backArm", "frontArm", "frontShoulder"],
    10: ["leg"],
    11: ["leg"],
    12: ["leg"],
    13: ["backArm", "frontArm", "frontShoulder"],
    14: ["longCoat"],
}
# 需要固定帧（不随性别变化）的角色。
FIXED_ROLES = {
    "head": (0, 0),
    "eyeWhites": (0, 0),
    "eyes": (0, 0),
    "leg": (0, 0),
    "longCoat": (0, 0),
}


def role_frame(role, male):
    if role in FIXED_ROLES:
        return FIXED_ROLES[role]
    return GENDER_FRAMES["male" if male else "female"][role]


def resolve_part(sprite_dir, variant, part):
    """按 PlayerDataInitializer 的 CopyVariant 链解析实际使用的贴图文件。

    变体缺某部件时：5/6/7/9 -> 4；11 -> 10；其余 -> 0。返回路径或 None。
    """
    cur = variant
    seen = set()
    while cur not in seen:
        seen.add(cur)
        path = os.path.join(sprite_dir, f"Player_{cur}_{part}.png")
        if os.path.exists(path):
            return path
        if cur in (5, 6, 7, 9):
            cur = 4
        elif cur == 11:
            cur = 10
        else:
            cur = 0
    return None


def collect_entries(sprite_dir):
    """返回 [(key, path, col, row)]；同一 (path,col,row) 会去重后打包。"""
    entries = []
    for variant in range(VARIANT_COUNT):
        male = variant in MALE_VARIANTS
        for part, roles in PART_ROLES.items():
            path = resolve_part(sprite_dir, variant, part)
            if not path:
                continue
            for role in roles:
                col, row = role_frame(role, male)
                entries.append((f"b:{variant}:{part}:{role}", path, col, row))
    for hair in range(HAIR_COUNT):
        path = os.path.join(sprite_dir, f"Player_Hair_{hair + 1}.png")
        if os.path.exists(path):
            entries.append((f"h:{hair}", path, 0, 0))
    return entries


def pack(entries, limit_width, padding):
    """按 (path,col,row) 去重后「高降序、宽升序」摆放，风格同 gen-atlas.py。"""
    unique = {}
    for key, path, col, row in entries:
        unique.setdefault((path, col, row), (FRAME_W, FRAME_H))

    order = sorted(unique.items(), key=lambda kv: (-kv[1][1], kv[1][0]))
    placed = {}
    x = y = row_h = 0
    max_x = 0
    for frame, (w, h) in order:
        if x + w > limit_width and x > 0:
            x = 0
            y += row_h + padding
            row_h = 0
        placed[frame] = (x, y, w, h)
        max_x = max(max_x, x + w)
        x += w + padding
        row_h = max(row_h, h)
    return placed, (max(1, min(limit_width, max_x)), y + row_h)


def main():
    ap = argparse.ArgumentParser(description="生成玩家角色图集")
    ap.add_argument("--sprite-dir", default=DEFAULT_SPRITE, help="Player_<v>_<part>.png 所在目录")
    ap.add_argument("--out-json", default=DEFAULT_OUT_JSON)
    ap.add_argument("--out-png", default=DEFAULT_OUT_PNG)
    ap.add_argument("--limit-width", type=int, default=1024, help="图集最大宽度，默认 1024")
    ap.add_argument("--padding", type=int, default=1, help="每格之间的留白像素，默认 1（防缩放插值采到邻居）")
    ap.add_argument("--max-height", type=int, default=8192, help="超过此高度只告警")
    args = ap.parse_args()

    if not os.path.isdir(args.sprite_dir):
        sys.exit(f"贴图目录不存在：{args.sprite_dir}")

    entries = collect_entries(args.sprite_dir)
    placed, (width, height) = pack(entries, args.limit_width, args.padding)
    print(f"角色部件/发型帧 {len(entries)} 个，去重后贴图 {len(placed)} 张")
    print(f"图集尺寸 {width} x {height}（{width * height} 像素）")
    if height > args.max_height:
        print(
            f"警告：图集高度 {height} 超过 max-height {args.max_height}，部分设备可能无法加载",
            file=sys.stderr,
        )

    t0 = time.time()
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for (path, col, row), (px, py, w, h) in placed.items():
        im = Image.open(path).convert("RGBA")
        box = (col * FRAME_W, row * FRAME_H, col * FRAME_W + w, row * FRAME_H + h)
        if box[2] > im.size[0] or box[3] > im.size[1]:
            continue
        atlas.paste(im.crop(box), (px, py))
    print(f"合成用时 {time.time() - t0:.2f}s")

    os.makedirs(os.path.dirname(args.out_png), exist_ok=True)
    atlas.save(args.out_png, optimize=True)
    png_hash = hashlib.md5(open(args.out_png, "rb").read()).hexdigest()[:12]
    print(f"写出 {args.out_png}（{os.path.getsize(args.out_png) / 1e6:.2f} MB）")

    regions = {}
    for key, path, col, row in entries:
        rect = placed.get((path, col, row))
        if rect:
            regions[key] = list(rect)
    out = {
        "meta": {
            "gameVersion": "1.4.5.8",
            "width": width,
            "height": height,
            "limitWidth": args.limit_width,
            "padding": args.padding,
            "frameWidth": FRAME_W,
            "frameHeight": FRAME_H,
            "variants": VARIANT_COUNT,
            "hairs": HAIR_COUNT,
            "regions": len(regions),
            "sheet": os.path.basename(args.out_png),
            "hash": png_hash,
            "generatedBy": "tools/gen-player-atlas.py",
            "note": "键 b:<variant>:<part>:<role> 为角色部件，h:<hair> 为发型；值 [x,y,40,56]。"
                    "都是灰度遮罩，绘制时用玩家颜色相乘着色；不含盔甲 / 饰品。",
        },
        "regions": regions,
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"写出 {args.out_json}")


if __name__ == "__main__":
    main()
