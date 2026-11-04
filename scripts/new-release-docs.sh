#!/usr/bin/env bash
#
# 为某个版本从模板生成两份**单版本**文档（不覆盖已有文件）：
#   docs/changelog/<版本>.md   单版本、按功能模块的详细更新
#   docs/release/<版本>.md     单版本、面向玩家的三段式发布说明（GitHub Release 用）
#
# 用法：
#   scripts/new-release-docs.sh              # 版本取 web/package.json 的 version
#   scripts/new-release-docs.sh 0.1.0-rc.9   # 指定版本（带不带 v 都行）
#   DRY_RUN=1 scripts/new-release-docs.sh    # 只打印将要做的事
#
# 说明：模板里的 {{VERSION}} / {{DATE}} 会被替换；已存在的文件一律跳过（不会覆盖定稿内容）。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION="${1:-${VERSION:-}}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./web/package.json').version")
fi
VERSION="${VERSION#v}"
DATE="${DATE:-$(date +%Y-%m-%d)}"
DRY_RUN="${DRY_RUN:-0}"

render() {
  local tpl="$1" out="$2"
  if [ -f "$out" ]; then
    echo "已存在，跳过：$out"
    return 0
  fi
  if [ ! -f "$tpl" ]; then
    echo "缺少模板：$tpl" >&2
    return 1
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] ${tpl} -> ${out}（版本 ${VERSION}，日期 ${DATE}）"
    return 0
  fi
  sed -e "s/{{VERSION}}/$VERSION/g" -e "s/{{DATE}}/$DATE/g" "$tpl" > "$out"
  echo "已生成：$out"
}

mkdir -p docs/changelog docs/release
render docs/changelog/_TEMPLATE.md "docs/changelog/v$VERSION.md"
render docs/release/_TEMPLATE.md "docs/release/v$VERSION.md"

cat <<EOF

下一步：
1. 填两份文档（规则见 docs/发布流程.md）；
2. 根 changelog.md 定稿：## 未发布（v${VERSION}）→ ## $(date +%Y%m%d)（v${VERSION}）；
3. make release-check && make docs-check；
4. 全量验证后提交、打 tag（未 push 前可随时改）。
EOF
