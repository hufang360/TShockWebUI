package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 网页发言：登录后 POST /api/chat，后端转 /webui/chat，原样带回角色名与广播行。
func TestChatSuccess(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/chat"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "tok-1" {
			t.Errorf("token = %q", r.URL.Query().Get("token"))
		}
		if r.URL.Query().Get("text") != "你好" {
			t.Errorf("text = %q", r.URL.Query().Get("text"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "name": "Alice", "text": "你好", "line": "[WebUI] Alice: 你好",
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/chat", map[string]string{"text": "你好"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "[WebUI] Alice: 你好") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// 空内容在前端就被拦；后端也要复检，且不发出站请求。
func TestChatEmptyBadRequest(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/chat", map[string]string{"text": "   "}, cookie, true)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "bad_request") {
		t.Fatalf("HTTP %d body=%s，期望 400 bad_request", rec.Code, rec.Body.String())
	}
	if f.count("/webui/chat") != 0 {
		t.Fatalf("空内容不应调用 TShock，实际 %d 次", f.count("/webui/chat"))
	}
}

// 插件 429：应映射为 429 rate_limited 并保留插件原文。
func TestChatRateLimited(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/chat"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "发言过于频繁，请稍后再试"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/chat", map[string]string{"text": "hi"}, cookie, true)
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), "rate_limited") {
		t.Fatalf("HTTP %d body=%s，期望 429 rate_limited", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "发言过于频繁") {
		t.Fatalf("应保留插件原文：%s", rec.Body.String())
	}
}

// 未登录：401，且不发出站请求。
func TestChatRequiresAuth(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/chat", map[string]string{"text": "hi"}, nil, true)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "not_authenticated") {
		t.Fatalf("HTTP %d body=%s，期望 401 not_authenticated", rec.Code, rec.Body.String())
	}
}

// 插件在装但缺少 chat 能力：404 应被判为 plugin_outdated（而不是 plugin_not_installed）。
func TestChatOutdatedPlugin(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/meta"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.1.0", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"me", "events"},
		})
	}
	// /webui/chat 未注册 → 默认 404。
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/chat", map[string]string{"text": "hi"}, cookie, true)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_outdated") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_outdated", rec.Code, rec.Body.String())
	}
}

// 设置页「信使插件诊断」：无需登录即可拿到握手结果。
func TestPluginStatusEndpoint(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/meta"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.2.0", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"commands", "me", "data", "serverinfo", "events", "sessions", "batch", "chat"},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/plugin/status", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"installed":true`) || !strings.Contains(body, `"reason":"ok"`) {
		t.Fatalf("body = %s", body)
	}
}
