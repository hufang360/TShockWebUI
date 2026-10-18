package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/tshock"
)

// TestEventHubFanout 验证「共享轮询」的核心：一次 poll 会把事件广播给所有订阅者，
// 并写入可复用的 ring（backlog）。
func TestEventHubFanout(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/webui/events" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"events":  []map[string]any{{"seq": 1, "type": "join", "text": "Alice 加入了服务器", "time": "t"}},
				"lastSeq": 1,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	cfg := config.Default()
	cfg.TShockURL = upstream.URL
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{
		Config: cfg,
		TShock: tshock.NewClient(cfg.TShockURL, time.Second, log),
		Logger: log,
	})
	hub := newEventHub(srv, srv.tshock)

	sub1 := &feedSub{ch: make(chan feedEvent, 8), token: "tok"}
	sub2 := &feedSub{ch: make(chan feedEvent, 8), token: "tok"}
	hub.subs[sub1] = struct{}{}
	hub.subs[sub2] = struct{}{}

	// 直接调一次 poll（确定性，不依赖 2.5s 定时）。
	hub.pollOnce("tok")

	for i, sub := range []*feedSub{sub1, sub2} {
		select {
		case ev := <-sub.ch:
			if ev.kind != feedMessage || ev.event.Seq != 1 {
				t.Fatalf("sub%d 收到 %+v", i+1, ev)
			}
		case <-time.After(time.Second):
			t.Fatalf("sub%d 未收到广播（fan-out 失败）", i+1)
		}
	}

	got := hub.backlog(0)
	if len(got) != 1 || got[0].Seq != 1 {
		t.Fatalf("backlog = %+v，期望 1 条 seq=1", got)
	}
	if n := len(hub.backlog(1)); n != 0 {
		t.Fatalf("backlog(1) 应为空，实际 %d 条", n)
	}
}

// TestEventHubPickToken 验证 token 借用：当前 token 失效后换另一个订阅者的。
func TestEventHubPickToken(t *testing.T) {
	hub := &eventHub{
		subs:      map[*feedSub]struct{}{},
		badTokens: map[string]bool{},
		wake:      make(chan struct{}, 1),
	}
	subA := &feedSub{ch: make(chan feedEvent, 1), token: "A"}
	subB := &feedSub{ch: make(chan feedEvent, 1), token: "B"}
	hub.subs[subA] = struct{}{}
	hub.subs[subB] = struct{}{}
	hub.token = "A"

	if got := hub.pickTokenLocked(); got != "A" {
		t.Fatalf("pickToken = %q，期望 A", got)
	}
	hub.badTokens["A"] = true
	hub.token = ""
	if got := hub.pickTokenLocked(); got != "B" {
		t.Fatalf("A 失效后 pickToken = %q，期望 B", got)
	}
	hub.badTokens["B"] = true
	hub.token = ""
	if got := hub.pickTokenLocked(); got != "" {
		t.Fatalf("全部失效后 pickToken = %q，期望空", got)
	}
}
