#!/usr/bin/env bash
# 对已运行的后端做端到端冒烟（默认容器 http://127.0.0.1:18080）。
#
# 用法：
#   server/scripts/smoke.sh                                   # 仅公共端点
#   TSWUI_TOKEN=$TSHOCK_TOKEN server/scripts/smoke.sh             # 用应用令牌登录
#   TSWUI_USER=hf TSWUI_PASS=****** server/scripts/smoke.sh   # 用账号密码登录
#
# 注意：账号密码登录会调用 TShock /v2/token/create，受 RESTMaximumRequestsPerInterval 限流。
set -euo pipefail

BASE="${TSWUI_BASE:-http://127.0.0.1:18080}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass=0; fail=0
check() { # name expected_substr actual
  local name="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then echo "  ✅ $name"; pass=$((pass+1));
  else echo "  ❌ $name  want~[$want] got=[$got]"; fail=$((fail+1)); fi
}

echo "== 公共端点 ($BASE) =="
check "healthz" '"status":"ok"' "$(curl -s "$BASE/healthz")"
check "healthz version" '"version"' "$(curl -s "$BASE/healthz")"
check "index"  "TShock"        "$(curl -s "$BASE/")"
check "meta"   '"gameVersion"'   "$(curl -s "$BASE/data/meta.json")"
check "session(anon)" '"authenticated":false' "$(curl -s "$BASE/api/session")"

echo "== 登录 =="
if [[ -n "${TSWUI_TOKEN:-}" ]]; then
  body=$(curl -s -c "$JAR" -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' \
    -d "{\"token\":\"$TSWUI_TOKEN\"}" "$BASE/api/login")
elif [[ -n "${TSWUI_USER:-}" && -n "${TSWUI_PASS:-}" ]]; then
  body=$(curl -s -c "$JAR" -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' \
    -d "{\"username\":\"$TSWUI_USER\",\"password\":\"$TSWUI_PASS\"}" "$BASE/api/login")
else
  echo "  (未提供 TSWUI_TOKEN 或 TSWUI_USER/TSWUI_PASS，跳过需要登录的检查)"
  echo; echo "结果：$pass 通过 / $fail 失败"; exit $((fail>0))
fi
check "login" '"username"' "$body"
check "session" '"authenticated":true' "$(curl -s -b "$JAR" "$BASE/api/session")"
check "status" '"reachable":true' "$(curl -s -b "$JAR" "$BASE/api/status")"
check "players" '"players"' "$(curl -s -b "$JAR" "$BASE/api/players")"

echo "== 指令 =="
check "Tier A /i" '"status":"rejected"' "$(curl -s -b "$JAR" -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' -d '{"cmd":"/i 29"}' "$BASE/api/command")"
# 未知/插件指令不前置拒绝，交由 TShock 判定（不存在 → command_error）
check "unknown→TShock" '"status":"command_error"' "$(curl -s -b "$JAR" -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' -d '{"cmd":"/definitely-not-real"}' "$BASE/api/command")"
check "run /time" '"status":"ok"'       "$(curl -s -b "$JAR" -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' -d '{"cmd":"/time"}' "$BASE/api/command")"

echo "== 安全 =="
check "csrf missing" '"code":"csrf"' "$(curl -s -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/login")"
check "logout" '"ok":true' "$(curl -s -b "$JAR" -X POST -H 'X-Requested-With: tswui' "$BASE/api/logout")"

echo; echo "结果：$pass 通过 / $fail 失败"
exit $((fail>0))
