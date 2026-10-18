package tshock

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestSendChat(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/chat" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("token") != "tok" {
			t.Errorf("token = %q", r.URL.Query().Get("token"))
		}
		if r.URL.Query().Get("text") != "你好 [i:29]" {
			t.Errorf("text = %q", r.URL.Query().Get("text"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "name": "hf", "text": "你好 [i:29]", "line": "[WebUI] hf: 你好 [i:29]",
			"id": "abc123", "time": "2026-01-01T00:00:00Z", "source": "webui",
		})
	}), time.Second)

	res, err := c.SendChat(context.Background(), "tok", "你好 [i:29]")
	if err != nil {
		t.Fatalf("SendChat: %v", err)
	}
	if res.Name != "hf" || res.Line != "[WebUI] hf: 你好 [i:29]" {
		t.Fatalf("res = %+v", res)
	}
	if res.ID != "abc123" || res.Time == "" || res.Source != "webui" {
		t.Fatalf("消息模型字段缺失：%+v", res)
	}
}

// 插件限流返回 429：应归一化为 KindRateLimited（而不是泛化的 bad_request），
// 好让 /api/chat 映射成 429 rate_limited 并保留插件原文。
func TestSendChatRateLimited(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "发言过于频繁，请稍后再试"})
	}), time.Second)

	_, err := c.SendChat(context.Background(), "tok", "hi")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindRateLimited {
		t.Fatalf("err = %v，期望 KindRateLimited", err)
	}
	if e.Message != "发言过于频繁，请稍后再试" {
		t.Fatalf("message = %q", e.Message)
	}
}
