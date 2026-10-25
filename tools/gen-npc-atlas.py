#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-npc-atlas.py —— 把 NPC 贴图的「第一帧」拼成一张 sprite 图集 + 裁切信息。

目标：NPC 图鉴里展示每个 NPC 的样子（名字 / ID 之外）。只取第一帧，静态、不播放动画。

事实来源（Terraria 1.4.5.8 反编译源码）：
  - 帧高 = 贴图高 / `Main.npcFrameCount[npcId]`（见 `Terraria/NPC.cs:FindFrame()`）。
  - 帧宽默认 = 贴图宽；少数特殊 NPC 会在 `FindFrame()` 里显式设 `frame.Width`（如 Deerclops=180），
    这里解析 `NPC.cs` 的 FindFrame 得到覆盖表，否则第一帧会横跨多列。
  - 若按帧裁出来几乎是空的（部分多列 / 特殊布局贴图），回退到「整张贴图的紧包围盒」。

产出：
  data/npc-atlas.png    图集（随仓库提交；版权 Re-Logic）
  data/npc-atlas.json   裁切信息 { regions: { npcId: [x, y, w, h] } }

依赖：Pillow
    python3 -m pip install Pillow

用法：
    python3 tools/gen-npc-atlas.py
    python3 tools/gen-npc-atlas.py --sprite-dir /path/to/Images --limit-width 1024
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

DEFAULT_NPCS = os.path.join(PROJECT, "data", "npcs.json")
DEFAULT_TR_SRC = os.path.join(PROJECT, "..", "tr-code-1458")
DEFAULT_SPRITE = os.path.join(PROJECT, "..", "tr-sprite-1458", "Content", "Images")
DEFAULT_OUT_JSON = os.path.join(PROJECT, "data", "npc-atlas.json")
DEFAULT_OUT_PNG = os.path.join(PROJECT, "data", "npc-atlas.png")
# 用户自备的 NPC 贴图覆盖（图片与登记表都入库，保证图集可复现；文件名不要有空格）。
DEFAULT_OVERRIDES = os.path.join(HERE, "npc-overrides.json")
DEFAULT_OVERRIDE_DIR = os.path.join(HERE, "npc-overrides")

# 第一帧几乎为空时的判据（非透明像素占裁剪区域比例低于该值 → 换策略）。
EMPTY_RATIO = 0.002
# 判据生效的最小面积（太小的贴图不触发回退，避免误判）。
EMPTY_MIN_AREA = 64 * 64

# 少数 NPC 的贴图是「多列网格」：横着铺的列不是动画，而是游戏在绘制时用 `Frame(列, 行, ...)`
# 选中的一帧（`frame.Width` 在这里也不等于可见帧宽）。按「帧高 = 高 / npcFrameCount」裁，
# 要么得到并排的好几帧，要么被 `frame.Width` 裁窄——都是错的。
# 这里直接照抄游戏的分格，取左上角那一格（frameIndex 0 → 列 0、行 0）。
# 出处：`Terraria/Main.cs` 的 `Main.DrawNPCDirect` 里 `type == N` 分支的 `Frame(列数, 行数, ...)`。
FRAME_GRIDS = {
    396: (3, 3),   # MoonLordHead                 Frame(3, 3)
    564: (5, 9),   # DD2DarkMageT1                Frame(5, 9)
    565: (5, 9),   # DD2DarkMageT3                Frame(5, 9)
    576: (5, 10),  # DD2OgreT2                    Frame(5, 10)
    577: (5, 10),  # DD2OgreT3                    Frame(5, 10)
    696: (6, 27),  # PalworldFoxsparksDistressed  Frame(6, 27)
}


def parse_frame_counts(tr_src):
    """从 Main.cs 解析 `npcFrameCount` 数组：index=npcId -> 帧数。"""
    path = os.path.join(tr_src, "Terraria", "Main.cs")
    text = open(path, encoding="utf-8").read()
    m = re.search(r"npcFrameCount = new int\[\d+\]\s*\{([\s\S]*?)\};", text)
    if not m:
        return []
    return [int(x) for x in re.findall(r"\d+", m.group(1))]


def parse_frame_widths(tr_src):
    """从 FindFrame() 解析显式 `frame.Width = N`（按最近的 case <n>: 归属）。"""
    path = os.path.join(tr_src, "Terraria", "NPC.cs")
    text = open(path, encoding="utf-8").read()
    start = text.find("public void FindFrame()")
    if start < 0:
        return {}
    end = text.find("\n\tpublic ", start + 10)
    body = text[start : end if end > 0 else len(text)]
    result = {}
    case_re = re.compile(r"case\s+(\d+)\s*:")
    width_re = re.compile(r"frame\.Width = (\d+);")
    cases = list(case_re.finditer(body))
    for i, cm in enumerate(cases):
        stop = cases[i + 1].start() if i + 1 < len(cases) else len(body)
        seg = body[cm.end() : stop]
        wm = width_re.search(seg)
        if wm:
            result[int(cm.group(1))] = int(wm.group(1))
    return result


def bbox(im):
    """非透明像素的紧包围盒；全透明返回 None。"""
    return im.getbbox()


def frame_ratio(im):
    """非透明像素比例（用 alpha 通道）。"""
    alpha = im.getchannel("A")
    hist = alpha.histogram()
    nonzero = sum(hist[1:])
    total = im.width * im.height
    return nonzero / total if total else 0.0


def pick_region(im, frame_count, frame_width, grid=None):
    """返回裁切框 box，遵循游戏帧规则并按需回退。

    `grid` = (列数, 行数)：贴图是多列网格时（见 `FRAME_GRIDS`），取左上角那一格；
    其余情况按帧高 = 高 / frameCount，帧宽默认 = 贴图宽。
    """
    W, H = im.size
    if grid:
        cols, rows = grid
        return (0, 0, max(1, W // cols), max(1, H // rows))
    fc = frame_count if frame_count and frame_count > 0 else 1
    fh = max(1, H // fc)
    fw = frame_width if frame_width and 0 < frame_width <= W else W
    crop = im.crop((0, 0, fw, fh))
    if fw * fh >= EMPTY_MIN_AREA and frame_ratio(crop) < EMPTY_RATIO:
        # 第一帧几乎为空（多列 / 特殊布局）：改用整张贴图的紧包围盒。
        box = bbox(im)
        if box:
            return box
    return (0, 0, fw, fh)


def pack(regions, limit_width, padding):
    """regions: {id: (w, h)} -> {id: (x, y, w, h)}, (总宽, 总高)"""
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
    # 总宽取实际用到的宽度：单张贴图可能比 limit_width 还宽（如 NPC_576 第一帧 1162px），
    # 按 limit_width 截断会把它的右侧裁掉。
    return placed, (max(1, max_x), y + row_h)


def load_overrides(path):
    """读 tools/npc-overrides.json：`{ "<npcId>": {file, crop?, frameWidth?, frameIndex?} }`。
    忽略以 `_` 开头的说明键；文件不存在时返回空表。"""
    if not path or not os.path.exists(path):
        return {}
    raw = json.load(open(path, encoding="utf-8"))
    out = {}
    for key, spec in raw.items():
        if str(key).startswith("_"):
            continue
        if not str(key).isdigit() or not isinstance(spec, dict) or not spec.get("file"):
            print(f"⚠ 忽略无效覆盖项：{key}", file=sys.stderr)
            continue
        out[int(key)] = spec
    return out


def apply_override(spec, override_dir):
    """按覆盖配置裁出最终要放进图集的那块图。"""
    file = spec["file"]
    if " " in os.path.basename(file):
        print(f"⚠ 文件名含空格，请改用下划线（{file} → {file.replace(' ', '_')}）", file=sys.stderr)
    path = file if os.path.isabs(file) else os.path.join(override_dir, file)
    if not os.path.exists(path):
        print(f"⚠ 覆盖图片不存在：{path}", file=sys.stderr)
        return None
    im = Image.open(path).convert("RGBA")
    crop = spec.get("crop")
    if crop:
        x, y, w, h = crop
        return im.crop((int(x), int(y), int(x) + int(w), int(y) + int(h)))
    frame_width = spec.get("frameWidth")
    if frame_width:
        index = int(spec.get("frameIndex", 0))
        fw = int(frame_width)
        return im.crop((index * fw, 0, index * fw + fw, im.height))
    return im


def main():
    ap = argparse.ArgumentParser(description="生成 NPC 图集")
    ap.add_argument("--npcs", default=DEFAULT_NPCS, help="data/npcs.json 路径")
    ap.add_argument("--tr-src", default=os.environ.get("TR_SRC", DEFAULT_TR_SRC))
    ap.add_argument("--sprite-dir", default=os.environ.get("SPRITE_DIR", DEFAULT_SPRITE))
    ap.add_argument("--out-json", default=DEFAULT_OUT_JSON)
    ap.add_argument("--out-png", default=DEFAULT_OUT_PNG)
    ap.add_argument("--overrides", default=DEFAULT_OVERRIDES, help="NPC 贴图覆盖表 json")
    ap.add_argument("--override-dir", default=DEFAULT_OVERRIDE_DIR, help="覆盖图片目录")
    ap.add_argument("--limit-width", type=int, default=1024, help="图集最大宽度，默认 1024")
    ap.add_argument("--padding", type=int, default=1, help="每格之间的留白像素，默认 1（防缩放插值采到邻居）")
    ap.add_argument("--max-height", type=int, default=8192, help="超过此高度只告警，不自动切图")
    args = ap.parse_args()

    npcs_data = json.load(open(args.npcs, encoding="utf-8"))
    npcs = npcs_data["npcs"]
    frame_counts = parse_frame_counts(args.tr_src)
    frame_widths = parse_frame_widths(args.tr_src)
    overrides = load_overrides(args.overrides)

    sprites = {}
    regions_src = {}
    missing = []
    used_overrides = []
    used_grids = []
    for n in npcs:
        nid = n["id"]
        # 1) 优先用用户自备的覆盖图片。
        if nid in overrides:
            crop = apply_override(overrides[nid], args.override_dir)
            if crop is not None:
                sprites[nid] = crop
                regions_src[nid] = crop.size
                used_overrides.append(nid)
                continue
        # 2) 否则用游戏原图的第一帧。
        path = os.path.join(args.sprite_dir, f"NPC_{nid}.png")
        if not os.path.exists(path):
            # 少数 NPC 只有 Alt 变体，退而求其次用第一个可用贴图。
            import glob

            alts = sorted(glob.glob(os.path.join(args.sprite_dir, f"NPC_{nid}_*.png")))
            if not alts:
                missing.append(nid)
                continue
            path = alts[0]
        im = Image.open(path).convert("RGBA")
        fc = frame_counts[nid] if nid < len(frame_counts) else 1
        fw = frame_widths.get(nid)
        grid = FRAME_GRIDS.get(nid)
        if grid:
            used_grids.append(nid)
        box = pick_region(im, fc, fw, grid)
        crop = im.crop(box)
        sprites[nid] = crop
        regions_src[nid] = crop.size

    placed, (total_w, total_h) = pack(regions_src, args.limit_width, args.padding)
    # 单张贴图可能比 --limit-width 还宽（如 NPC_576 第一帧 1162px）：图集宽度按实际用到的宽度放宽，
    # 不能再被 limit_width 截断，否则那张贴图右侧会被裁掉，图鉴里显示残缺。
    oversized = sorted(((nid, w) for nid, (_, _, w, _) in placed.items() if w > args.limit_width))
    if oversized:
        print(
            f"⚠ {len(oversized)} 张贴图宽于 --limit-width({args.limit_width})，图集已放宽到 {total_w}px：{oversized[:10]}",
            file=sys.stderr,
        )
    if total_h > args.max_height:
        print(f"⚠ 图集高度 {total_h} 超过上限 {args.max_height}（仍会输出）", file=sys.stderr)

    atlas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    for nid, crop in sprites.items():
        x, y, _, _ = placed[nid]
        atlas.alpha_composite(crop, (x, y))
    atlas.save(args.out_png)
    png_hash = hashlib.md5(open(args.out_png, "rb").read()).hexdigest()[:12]

    payload = {
        "meta": {
            "gameVersion": npcs_data.get("meta", {}).get("gameVersion", ""),
            "width": total_w,
            "height": total_h,
            "limitWidth": args.limit_width,
            "padding": args.padding,
            "count": len(placed),
            "missing": len(missing),
            "sheet": os.path.basename(args.out_png),
            "hash": png_hash,
            "generatedBy": "tools/gen-npc-atlas.py",
            "source": "Terraria NPC_<id>.png 第一帧（帧高 = 高 / Main.npcFrameCount；多列网格见 FRAME_GRIDS）",
            "note": "regions[npcId] = [x, y, w, h]；第一帧为空时回退为整张贴图的紧包围盒；多列网格贴图按 Main.DrawNPCDirect 的 Frame(列, 行) 取左上角一帧。",
        },
        "regions": {str(k): list(v) for k, v in placed.items()},
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print(f"NPC 图集：{len(placed)} 个 / 缺贴图 {len(missing)} 个 -> {args.out_png} ({total_w}×{total_h})")
    if used_overrides:
        print(f"使用自备覆盖图片 {len(used_overrides)} 个：{used_overrides}")
    if used_grids:
        print(f"按游戏 Frame(列, 行) 取左上角一帧 {len(used_grids)} 个：{used_grids}")
    if missing:
        print("缺贴图 id:", missing[:50], file=sys.stderr)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"耗时 {time.time() - t0:.1f}s")
