package tshock

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestWebAuthRequestSendsSecretAndParses(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/auth/request" {
			t.Errorf("path = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("name") != "Alice" || q.Get("secret") != "s3cret" {
			t.Errorf("q = %v", q)
		}
		if q.Get("ip") != "1.2.3.4" {
			t.Errorf("ip = %q（应透传来源 IP 供插件限流）", q.Get("ip"))
		}
		writeJSON(w, 200, map[string]any{
			"status":   "200",
			"code":     "ok",
			"ticket":   "123456",
			"expires":  60,
			"player":   "Alice",
			"username": "Alice",
		})
	}), time.Second)

	res, err := c.WebAuthRequest(context.Background(), "Alice", "s3cret", "1.2.3.4")
	if err != nil {
		t.Fatalf("WebAuthRequest: %v", err)
	}
	if res.Ticket != "123456" || res.Expires != 60 || res.Username != "Alice" {
		t.Fatalf("res = %+v", res)
	}
}

func TestWebAuthRequestOfflineIsBusinessError(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "offline", "message": "该玩家不在线"})
	}), time.Second)

	_, err := c.WebAuthRequest(context.Background(), "Ghost", "", "")
	var e *APIError
	if !errors.As(err, &e) {
		t.Fatalf("err = %v", err)
	}
	if e.Kind != KindPluginBusiness || e.Code != WebAuthCodeOffline {
		t.Fatalf("kind = %s code = %s", e.Kind, e.Code)
	}
	if e.Message != "该玩家不在线" {
		t.Fatalf("message = %q", e.Message)
	}
}

func TestWebAuthRequestPluginMissing(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	_, err := c.WebAuthRequest(context.Background(), "Alice", "", "")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestWebAuthRequestSecretMismatch(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"status": "403", "code": "forbidden", "error": "secret 不匹配"})
	}), time.Second)

	_, err := c.WebAuthRequest(context.Background(), "Alice", "wrong", "")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindPluginForbidden {
		t.Fatalf("err = %v", err)
	}
}

func TestWebAuthPollApproved(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/auth/poll" || r.URL.Query().Get("ticket") != "123456" {
			t.Errorf("path/q = %s %v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "code": "ok", "state": "approved",
			"username": "Alice", "token": "DEADBEEF",
		})
	}), time.Second)

	res, err := c.WebAuthPoll(context.Background(), "123456", "")
	if err != nil {
		t.Fatalf("WebAuthPoll: %v", err)
	}
	if res.State != WebAuthStateApproved || res.Token != "DEADBEEF" || res.Username != "Alice" {
		t.Fatalf("res = %+v", res)
	}
}

func TestWebAuthPollInvalidTicketIsExpired(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "invalid_ticket"})
	}), time.Second)

	res, err := c.WebAuthPoll(context.Background(), "000000", "")
	if err != nil {
		t.Fatalf("WebAuthPoll: %v", err)
	}
	if res.State != WebAuthStateExpired {
		t.Fatalf("state = %q", res.State)
	}
}

func TestWebAuthProbeDetectsPlugin(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// 空 name 时插件返回 missing_name，表示已安装。
		writeJSON(w, 200, map[string]any{"status": "200", "code": "missing_name", "message": "缺少 name 参数"})
	}), time.Second)

	err := c.WebAuthProbe(context.Background(), "")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindPluginBusiness || e.Code != WebAuthCodeMissingName {
		t.Fatalf("err = %v（插件应被识别为已安装）", err)
	}
}

func TestSetSecretOmitsEmpty(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := r.URL.Query()["secret"]; ok {
			t.Errorf("secret 为空时不应带该参数：%v", r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{"status": "200", "code": "ok", "ticket": "1"})
	}), time.Second)

	if _, err := c.WebAuthRequest(context.Background(), "Alice", "", ""); err != nil {
		t.Fatalf("WebAuthRequest: %v", err)
	}
}
