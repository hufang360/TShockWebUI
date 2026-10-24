//go:build integration

package api_test

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"tshockwebui/server/internal/api"
	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

// 真实端到端（默认不跑）：用 TShock 的 ApplicationRestToken 预置会话，
// 直接走 /api/command handler → 真实 rawcmd，验证完整链路。
//
//	TSHOCK_URL=http://127.0.0.1:7878 TSHOCK_TOKEN=$TSHOCK_TOKEN \
//	  go test -tags integration -run Integration -v ./internal/api
func TestIntegrationCommandThroughHandler(t *testing.T) {
	url := os.Getenv("TSHOCK_URL")
	token := os.Getenv("TSHOCK_TOKEN")
	if url == "" || token == "" {
		t.Skip("未设置 TSHOCK_URL / TSHOCK_TOKEN，跳过真实联调")
	}

	cfg := config.Default()
	cfg.TShockURL = url
	cfg.TShockTimeout = 5 * time.Second

	store := session.New(cfg.SessionTTL, cfg.MaxSessions)
	sess, err := store.Create("integration", token)
	if err != nil {
		t.Fatalf("预置会话失败：%v", err)
	}
	cookie := &http.Cookie{Name: "tswui_session", Value: sess.ID}

	srv := api.New(api.Deps{
		Config:   cfg,
		Sessions: store,
		TShock:   tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, testLogger()),
		Commands: tshock.DefaultCommands(),
		Web: fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html>ok</html>")},
		},
		Logger: testLogger(),
	})
	h := srv.Handler()

	// 1) 允许的指令 → 真实输出。
	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	t.Logf("/time -> status=%s output=%v", res.Status, res.Output)
	if res.Status != tshock.StatusOK || len(res.Output) == 0 {
		t.Fatalf("期望 ok 且有输出：%+v", res)
	}

	// 2) allowServer=false → Tier A 直接拒绝（不应发往 TShock）。
	rec = do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/i 29"}, cookie, true)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusRejected || !strings.Contains(res.Message, "只能在游戏内执行") {
		t.Fatalf("期望 rejected：%+v", res)
	}

	// 3) 未知指令 → 交由 TShock 判定（不前置拒绝）。
	rec = do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/definitely-not-real"}, cookie, true)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusCommandNotFound {
		t.Fatalf("期望 command_not_found（由 TShock 判定）：%+v", res)
	}

	// 4) 插件指令 /fish（不在内置白名单）→ 发往 TShock，返回真实输出。
	rec = do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/fish"}, cookie, true)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	t.Logf("/fish -> status=%s output=%v", res.Status, res.Output)
	if res.Status != tshock.StatusOK || len(res.Output) == 0 {
		t.Fatalf("期望 /fish 有真实输出：%+v", res)
	}
}
