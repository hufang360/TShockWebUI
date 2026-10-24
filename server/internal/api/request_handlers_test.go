package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tshockwebui/server/internal/tshock"
)

// 物资申请：能力探测 / 提交 / 列表 / 审核 / 错误映射。

func requestMetaRoutes(caps ...string) map[string]http.HandlerFunc {
	routes := okLoginRoutes()
	routes["/webui/meta"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.2.0", "protocol": 1, "minProtocol": 1,
			"capabilities": caps,
		})
	}
	return routes
}

func requestRecord(id int, status string) map[string]any {
	return map[string]any{
		"id": id, "account": "alice", "player": "Alice",
		"items":  []map[string]any{{"id": 9, "stack": 300}},
		"reason": "建城堡外墙", "note": "出生点东侧",
		"status": status, "createdAt": "2025-10-20T10:00:00Z", "updatedAt": "2025-10-20T10:00:00Z",
		"reviewedBy": "", "reviewedAt": "", "denyReason": "", "deliveredAt": "", "deliveryError": "",
		"world": "test",
	}
}

func TestRequestCapabilitiesAll(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"requests": []any{}})
	}
	routes["/webui/requests/all"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"requests": []any{}})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.RequestCapabilities
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || !out.Submit || !out.Review {
		t.Fatalf("应为 {plugin,submit,review}=true，实际 %+v", out)
	}
}

func TestRequestCapabilitiesNoPermission(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "没有 webui.request.use 权限"})
	}
	routes["/webui/requests/all"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "没有 webui.request.review 权限"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.RequestCapabilities
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || out.Submit || out.Review {
		t.Fatalf("应为 {plugin:true,submit:false,review:false}，实际 %+v", out)
	}
}

func TestRequestCapabilitiesPluginMissing(t *testing.T) {
	f := newFake(okLoginRoutes()) // 无 meta、无 /webui/requests → 404
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.RequestCapabilities
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Plugin || out.Submit || out.Review {
		t.Fatalf("插件缺失时应全 false，实际 %+v", out)
	}
}

func TestRequestCapabilitiesOutdated(t *testing.T) {
	routes := requestMetaRoutes("me", "events") // 没有 requests
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests/capabilities", nil, cookie, false)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_outdated") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_outdated", rec.Code, rec.Body.String())
	}
}

func TestRequestCreateSuccess(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests/create"] = func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("token") != "tok-1" {
			t.Errorf("token = %q", q.Get("token"))
		}
		if !strings.Contains(q.Get("items"), `"id":9`) || !strings.Contains(q.Get("items"), `"stack":300`) {
			t.Errorf("items = %q", q.Get("items"))
		}
		if q.Get("reason") != "建城堡外墙" || q.Get("note") != "出生点东侧" {
			t.Errorf("reason/note = %q/%q", q.Get("reason"), q.Get("note"))
		}
		writeJSON(w, 200, map[string]any{"status": "200", "request": requestRecord(12, "pending")})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	payload := map[string]any{
		"items":  []map[string]any{{"id": 9, "stack": 300}},
		"reason": "建城堡外墙",
		"note":   "出生点东侧",
	}
	rec := do(h, http.MethodPost, "/api/requests", payload, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Request tshock.Requisition `json:"request"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Request.ID != 12 || out.Request.Status != "pending" || len(out.Request.Items) != 1 {
		t.Fatalf("request = %+v", out.Request)
	}
}

func TestRequestCreateValidation(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	cases := []map[string]any{
		{"items": []map[string]any{}, "reason": "x"},
		{"items": []map[string]any{{"id": 9, "stack": 300}}, "reason": "  "},
		{"items": []map[string]any{{"id": 0, "stack": 1}}, "reason": "x"},
		{"items": []map[string]any{{"id": 9, "stack": 0}}, "reason": "x"},
	}
	for _, payload := range cases {
		rec := do(h, http.MethodPost, "/api/requests", payload, cookie, true)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("payload=%v HTTP %d body=%s，期望 400", payload, rec.Code, rec.Body.String())
		}
	}
	if f.count("/webui/requests/create") != 0 {
		t.Fatalf("非法参数不应调用插件，实际 %d 次", f.count("/webui/requests/create"))
	}
}

func TestRequestCreateCSRF(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	payload := map[string]any{"items": []map[string]any{{"id": 9, "stack": 1}}, "reason": "x"}
	rec := do(h, http.MethodPost, "/api/requests", payload, cookie, false)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "csrf") {
		t.Fatalf("HTTP %d body=%s，期望 403 csrf", rec.Code, rec.Body.String())
	}
}

func TestRequestListSuccess(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("status") != "all" {
			t.Errorf("status = %q", r.URL.Query().Get("status"))
		}
		writeJSON(w, 200, map[string]any{"requests": []any{
			requestRecord(1, "pending"), requestRecord(2, "delivered"),
		}})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests?status=all", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Requests []tshock.Requisition `json:"requests"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Requests) != 2 || out.Requests[1].Status != "delivered" {
		t.Fatalf("requests = %+v", out.Requests)
	}
}

func TestRequestReviewBusinessError(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests/review"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "400", "error": "该申请已处理（已发放）"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/requests/review", map[string]any{
		"id": 1, "decision": "approve",
	}, cookie, true)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "request_error") {
		t.Fatalf("HTTP %d body=%s，期望 400 request_error", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "该申请已处理") {
		t.Fatalf("应保留插件原文：%s", rec.Body.String())
	}
}

func TestRequestReviewPermission(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests/review"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "没有 webui.request.review 权限"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/requests/review", map[string]any{
		"id": 1, "decision": "approve",
	}, cookie, true)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "no_permission") {
		t.Fatalf("HTTP %d body=%s，期望 403 no_permission", rec.Code, rec.Body.String())
	}
}

func TestRequestDeliverSuccess(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review")
	routes["/webui/requests/deliver"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") != "5" {
			t.Errorf("id = %q", r.URL.Query().Get("id"))
		}
		writeJSON(w, 200, map[string]any{"status": "200", "request": requestRecord(5, "delivered")})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/requests/deliver", map[string]any{"id": 5}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRequestPluginOutdatedOn404(t *testing.T) {
	routes := requestMetaRoutes("requests", "requests_review") // meta 声明有，但端点未注册 → 404
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/requests", nil, cookie, false)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_outdated") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_outdated", rec.Code, rec.Body.String())
	}
}

func TestRequestRequiresAuth(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodGet, "/api/requests", nil, nil, false)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "not_authenticated") {
		t.Fatalf("HTTP %d body=%s，期望 401 not_authenticated", rec.Code, rec.Body.String())
	}
}
