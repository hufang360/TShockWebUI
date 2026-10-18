# tools/npc-overrides/ — NPC 贴图覆盖图片

把你想替换的 NPC 图片放到这个目录，再到上一层的 `tools/npc-overrides.json` 里登记：

```json
{
  "636": { "file": "636.png" },
  "668": { "file": "668.png", "crop": [0, 0, 200, 220] }
}
```

- 键 = **NPC id**（在「数据图鉴 → NPC」里能看到）。
- `file`：图片文件名（相对本目录）。
- `crop`：可选，`[x, y, w, h]`，只取图片的某一块；不写则用整张图。
- `frameWidth` / `frameIndex`：图片是横向多帧时，按每帧宽度取第 N 帧（默认 0）。

登记完运行：

```bash
python3 tools/gen-npc-atlas.py
```

生成脚本会优先用这里的图片替换游戏原图，打包进 `data/npc-atlas.{json,png}`。
没有登记的 NPC 仍用游戏原图。

> 图片版权请自行确认；本目录除 `README.md` 外**不入库**（见 `.gitignore`）。
