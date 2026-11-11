package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 游戏内 /group 后手动刷新：后端转 /webui/me/refresh，并把新的组 / 权限带给前端。
func TestMeRefreshSuccess(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/me/refresh"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "tok-1" {
			t.Errorf("token = %q", r.URL.Query().Get("token"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "username": "Alice", "group": "vip",
			"permissions": []string{"tshock.rest.useapi", "tshock.rest.command", "playermanager"},
			"canUseApi":   true, "canRunCommands": true, "previousGroup": "default",
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/me/refresh", nil, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Group         string   `json:"group"`
		PreviousGroup string   `json:"previousGroup"`
		Permissions   []string `json:"permissions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON：%v", err)
	}
	if out.Group != "vip" || out.PreviousGroup != "default" {
		t.Fatalf("group=%q previousGroup=%q，期望 vip/default", out.Group, out.PreviousGroup)
	}
	if len(out.Permissions) != 3 {
		t.Fatalf("permissions = %v，期望原样带回", out.Permissions)
	}
	if f.count("/webui/me") != 0 {
		t.Fatal("刷新应走 /webui/me/refresh，不应再打 /webui/me")
	}
}

// 旧插件没有 me_refresh：404 要判成 plugin_outdated（提示升级插件 / 重新登录），而不是「未安装」。
func TestMeRefreshOutdatedPlugin(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/meta"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.1.0-rc.8", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"commands", "me", "data", "serverinfo", "events", "sessions", "batch", "chat"},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/me/refresh", nil, cookie, true)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_outdated") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_outdated", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "me_refresh") {
		t.Fatalf("body=%s，期望点明缺少 me_refresh 能力", rec.Body.String())
	}
}

// 刷新同样受 CSRF 约束：不带 X-Requested-With 直接 403。
func TestMeRefreshRequiresCSRFHeader(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/me/refresh", nil, nil, false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP %d body=%s，期望 403", rec.Code, rec.Body.String())
	}
}

// token 失效：刷新要清会话并回 401，和其它插件端点同语义。
func TestMeRefreshTokenInvalid(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/me/refresh"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "令牌无效"})
	}
	routes["/tokentest"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "令牌无效"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/me/refresh", nil, cookie, true)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "token_invalid") {
		t.Fatalf("HTTP %d body=%s，期望 401 token_invalid", rec.Code, rec.Body.String())
	}
	if store.Len() != 0 {
		t.Fatalf("会话数 = %d，期望 0（已清）", store.Len())
	}
}

// 预置令牌（ApplicationRestTokens）：组由服务器配置决定，插件改不了，要如实带 fixedToken。
func TestMeRefreshFixedToken(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/me/refresh"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status": "200", "username": "Alice", "group": "default",
			"permissions": []string{"tshock.rest.useapi"}, "canUseApi": true,
			"canRunCommands": false, "previousGroup": "default", "fixedToken": true,
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/me/refresh", nil, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		FixedToken bool `json:"fixedToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON：%v", err)
	}
	if !out.FixedToken {
		t.Fatalf("body=%s，期望带 fixedToken=true", rec.Body.String())
	}
}
