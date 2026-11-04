#!/usr/bin/env bash
#
# 发版前检查两份**单版本**文档是否齐备：
#   docs/changelog/<版本>.md   存在、标题含版本号
#   docs/release/<版本>.md     存在、标题含版本号、含 ## 新增 / ## 改进 / ## 修复 三段
#
# 用法：
#   scripts/check-release-docs.sh              # 版本取 web/package.json 的 version
#   scripts/check-release-docs.sh 0.1.0-rc.9
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION="${1:-${VERSION:-}}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./web/package.json').version")
fi
VERSION="${VERSION#v}"

CH="docs/changelog/v$VERSION.md"
REL="docs/release/v$VERSION.md"
ok=1

fail() { echo "✗ $*" >&2; ok=0; }

for f in "$CH" "$REL"; do
  if [ ! -f "$f" ]; then
    fail "缺少 ${f}（先跑 make release-docs）"
    continue
  fi
  if [ ! -s "$f" ]; then
    fail "$f 是空文件"
  elif ! grep -q "v$VERSION" "$f"; then
    fail "$f 标题里没有 v$VERSION"
  fi
done

if [ -f "$REL" ]; then
  for h in 新增 改进 修复; do
    grep -q "^## $h" "$REL" || fail "$REL 缺少段落：## $h"
  done
fi

# 根 changelog 顶部应已定稿（不再是「未发布」）——只提示，不阻断（发版前最后一刻才改）。
if head -12 changelog.md | grep -q "未发布（v${VERSION}）"; then
  echo "提示：根 changelog.md 仍是「未发布（v${VERSION}）」，发版提交时记得补日期。"
fi

# README 里的 release 下载地址 / 资产名 / Docker 镜像 tag 必须与当前版本一致。
for readme in README.md README.en.md; do
  [ -f "$readme" ] || continue
  refs=$(grep -nE 'releases/download|tshockwebui:|WebUI-[0-9]' "$readme" \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?' | sort -u)
  for ref in $refs; do
    [ "$ref" = "$VERSION" ] || fail "${readme} 引用了旧版本 ${ref}（当前 ${VERSION}）"
  done
done

if [ "$ok" = "1" ]; then
  echo "✓ 单版本文档齐备：$CH / ${REL}（版本 ${VERSION}）"
else
  exit 1
fi
