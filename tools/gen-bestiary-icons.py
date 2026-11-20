#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-bestiary-icons.py —— 生成「怪物图鉴」筛选器图标（data/bestiary-tags.webp / bestiary-rank.webp + bestiary-icons.json）。

图标来源（游戏原图）：
  - `Images/UI/Bestiary/Icon_Tags_Shadow.png`：16 列 × 5 行、每格 30×30，绝大多数筛选器用它。
  - `Images/UI/Bestiary/Icon_Rank_Light.png`：「稀有」筛选器用它（Boss / 未解锁也用这张的事另说）。

帧号从源码静态读：筛选器元素在 `BestiaryDatabaseNPCsPopulator.cs` 里以
`new SpawnConditionBestiaryInfoElement("Bestiary_Biomes.Surface", 0, …)` 的形式构造
（`SpawnConditionBestiaryOverlayInfoElement` / `FilterProviderInfoElement` 同理），
第二个参数就是 `Icon_Tags_Shadow` 里的帧号。为什么不反射：那份程序集里私有字段名与源码对不上。

输出：
  data/bestiary-tags.webp    `Icon_Tags_Shadow` 转无损 WebP
  data/bestiary-rank.webp    `Icon_Rank_Light` 转无损 WebP
  data/bestiary-icons.json   { meta: {tags:{file,hash,cols,rows,cell}, rank:{…}}, filters:{key:{texture,frame}} }

用法：
    python3 tools/gen-bestiary-icons.py
    python3 tools/gen-bestiary-icons.py --tr-src ../tr-code-1458 --sprite-dir ../tr-sprite-1458/Content/Images
"""

import argparse
import hashlib
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请执行：python3 -m pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

DEFAULT_TR_SRC = os.path.join(PROJECT, "..", "tr-code-1458")
DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_BESTIARY = os.path.join(PROJECT, "data", "npc-bestiary.json")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "bestiary-icons.json")

TAGS_SRC = "UI/Bestiary/Icon_Tags_Shadow.png"
RANK_SRC = "UI/Bestiary/Icon_Rank_Light.png"
COLS, ROWS, CELL = 16, 5, 30

# 三个筛选器元素类的构造：("名字 key", 帧号[, 背景图…])
ELEMENT_RE = re.compile(
    r"new\s+(?:SpawnConditionBestiaryInfoElement|SpawnConditionBestiaryOverlayInfoElement|FilterProviderInfoElement)"
    r"\(\s*\"([^\"]+)\"\s*,\s*(\d+)"
)


def sha(text):
    return hashlib.sha1(text).hexdigest()[:12]


def to_webp(src_path, out_path):
    image = Image.open(src_path)
    image.save(out_path, "WEBP", lossless=True, quality=100, method=6)
    return sha(open(out_path, "rb").read()), image.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tr-src", default=DEFAULT_TR_SRC)
    ap.add_argument("--sprite-dir", default=DEFAULT_SPRITE)
    ap.add_argument("--bestiary", default=DEFAULT_BESTIARY, help="data/npc-bestiary.json（筛选器顺序）")
    ap.add_argument("--out", default=DEFAULT_OUT_JSON)
    args = ap.parse_args()

    populator = os.path.join(args.tr_src, "Terraria.GameContent.Bestiary", "BestiaryDatabaseNPCsPopulator.cs")
    frames = {key: int(frame) for key, frame in ELEMENT_RE.findall(open(populator, encoding="utf-8-sig").read())}

    bestiary = json.load(open(args.bestiary, encoding="utf-8"))
    filters = []
    missing = []
    for entry in bestiary["filters"]:
        key = entry["key"]
        texture = entry.get("icon", {}).get("texture", "tags")
        if texture == "rank":
            filters.append({"key": key, "texture": "rank", "frame": 0})
            continue
        if key == "BestiaryInfo.IsBoss":
            # Filters.ByBoss 的图标写死在代码里：Icon_Tags_Shadow 的第 15 列 / 第 3 行。
            filters.append({"key": key, "texture": "tags", "frame": 3 * COLS + 15})
            continue
        if key not in frames:
            missing.append(key)
            continue
        filters.append({"key": key, "texture": "tags", "frame": frames[key]})
    if missing:
        sys.exit(f"这些筛选器在源码里找不到图标帧号：{missing}")

    tags_out = os.path.join(PROJECT, "data", "bestiary-tags.webp")
    rank_out = os.path.join(PROJECT, "data", "bestiary-rank.webp")
    tags_hash, _ = to_webp(os.path.join(args.sprite_dir, TAGS_SRC), tags_out)
    rank_hash, _ = to_webp(os.path.join(args.sprite_dir, RANK_SRC), rank_out)

    payload = {
        "meta": {
            "gameVersion": bestiary["meta"]["gameVersion"],
            "source": "Content/Images/UI/Bestiary/Icon_Tags_Shadow.png + Icon_Rank_Light.png（帧号取 BestiaryDatabaseNPCsPopulator.cs 的构造参数）",
            "generatedBy": "tools/gen-bestiary-icons.py",
            "note": "filters 顺序与 data/npc-bestiary.json 一致；帧号是贴图 16×5 网格里的下标",
            "tags": {"file": "bestiary-tags.webp", "hash": tags_hash, "cols": COLS, "rows": ROWS, "cell": CELL},
            "rank": {"file": "bestiary-rank.webp", "hash": rank_hash, "cols": 1, "rows": 1, "cell": CELL},
        },
        "filters": filters,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"[bestiary-icons] {len(filters)} filters -> {args.out}")


if __name__ == "__main__":
    main()
