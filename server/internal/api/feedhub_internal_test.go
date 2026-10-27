package api

import (
	"bufio"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/session"
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

// TestEventHubInstanceReset 验证「同一个服务器地址 / 端口后面换了另一个服」时：
// hub 必须丢掉旧 ring / lastSeq / 世界状态，并通知订阅者重同步（feedReset）。
func TestEventHubInstanceReset(t *testing.T) {
	var mu sync.Mutex
	instance := "B"
	lastSeq := int64(3)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/events" {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		inst, seq := instance, lastSeq
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"events":   []map[string]any{},
			"lastSeq":  seq,
			"instance": inst,
		})
	}))
	defer upstream.Close()

	cfg := config.Default()
	cfg.TShockURL = upstream.URL
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{Config: cfg, TShock: tshock.NewClient(cfg.TShockURL, time.Second, log), Logger: log})
	hub := newEventHub(srv, srv.tshock)

	sub := &feedSub{ch: make(chan feedEvent, 8), token: "tok"}
	hub.subs[sub] = struct{}{}

	// 先垫上旧实例的状态（ring / lastSeq / 世界状态）。
	hub.mu.Lock()
	hub.ring = append(hub.ring, tshock.ServerEvent{Seq: 500, Type: "join", Text: "old"})
	hub.lastSeq = 500
	hub.lastWorld = &tshock.ServerInfoData{Name: "旧服", WorldID: 1}
	hub.lastWorldAt = time.Now()
	hub.instance = "A"
	hub.seeded = true
	hub.mu.Unlock()

	hub.pollOnce("tok")

	select {
	case ev := <-sub.ch:
		if ev.kind != feedReset {
			t.Fatalf("收到 %+v，期望 feedReset", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("换实例后没有通知订阅者重同步")
	}

	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.lastSeq != 0 || len(hub.ring) != 0 || hub.lastWorld != nil || hub.seeded {
		t.Fatalf("换实例后缓存没有作废：lastSeq=%d ring=%d world=%v seeded=%v",
			hub.lastSeq, len(hub.ring), hub.lastWorld, hub.seeded)
	}
	if hub.instance != "B" {
		t.Fatalf("instance = %q，期望记录新实例 B", hub.instance)
	}
}

// TestEventHubSeqRegressionReset 验证旧插件（响应无 instance）的兜底：
// seq 变小（含新服从 0 开始）同样必须作废缓存。
func TestEventHubSeqRegressionReset(t *testing.T) {
	Cases := []struct {
		name    string
		lastSeq int64
	}{
		{name: "seq 回退到更小值", lastSeq: 3},
		{name: "新服还没有事件", lastSeq: 0},
	}
	for _, tc := range Cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"events": []map[string]any{}, "lastSeq": tc.lastSeq})
			}))
			defer upstream.Close()

			cfg := config.Default()
			cfg.TShockURL = upstream.URL
			log := slog.New(slog.NewTextHandler(io.Discard, nil))
			srv := New(Deps{Config: cfg, TShock: tshock.NewClient(cfg.TShockURL, time.Second, log), Logger: log})
			hub := newEventHub(srv, srv.tshock)
			sub := &feedSub{ch: make(chan feedEvent, 8), token: "tok"}
			hub.subs[sub] = struct{}{}

			hub.mu.Lock()
			hub.ring = append(hub.ring, tshock.ServerEvent{Seq: 900, Type: "join", Text: "old"})
			hub.lastSeq = 900
			hub.seeded = true
			hub.mu.Unlock()

			hub.pollOnce("tok")

			select {
			case ev := <-sub.ch:
				if ev.kind != feedReset {
					t.Fatalf("收到 %+v，期望 feedReset", ev)
				}
			case <-time.After(time.Second):
				t.Fatal("seq 回退后没有通知订阅者重同步")
			}
			if got := hub.backlog(0); len(got) != 0 {
				t.Fatalf("seq 回退后 backlog 应为空，实际 %d 条", len(got))
			}
		})
	}
}

// TestEventHubObserveInstance 验证非流式端点发现换服时的行为：
// 作废缓存 + 广播 reset + 叫醒共享轮询器（不能按静默退避拖到 10s 后）。
func TestEventHubObserveInstance(t *testing.T) {
	cfg := config.Default()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{Config: cfg, TShock: tshock.NewClient("http://127.0.0.1:1", time.Second, log), Logger: log})
	hub := newEventHub(srv, srv.tshock)
	sub := &feedSub{ch: make(chan feedEvent, 8), token: "tok"}
	hub.subs[sub] = struct{}{}

	hub.mu.Lock()
	hub.instance = "A"
	hub.ring = append(hub.ring, tshock.ServerEvent{Seq: 500, Type: "join", Text: "old"})
	hub.lastSeq = 500
	hub.lastWorld = &tshock.ServerInfoData{Name: "旧服"}
	hub.lastWorldAt = time.Now().Add(-time.Minute)
	hub.lastEventAt = time.Now().Add(-time.Minute)
	hub.seeded = true
	hub.mu.Unlock()

	if !hub.observeInstance("B") {
		t.Fatal("实例变化应返回 true")
	}
	if hub.observeInstance("B") {
		t.Fatal("同一实例重复上报不应再次重置")
	}

	select {
	case ev := <-sub.ch:
		if ev.kind != feedReset || ev.instance != "B" {
			t.Fatalf("收到 %+v，期望 feedReset{B}", ev)
		}
	default:
		t.Fatal("没有广播 feedReset")
	}

	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.instance != "B" || hub.lastSeq != 0 || len(hub.ring) != 0 || hub.lastWorld != nil || hub.seeded {
		t.Fatalf("缓存未作废：instance=%q lastSeq=%d ring=%d world=%v seeded=%v",
			hub.instance, hub.lastSeq, len(hub.ring), hub.lastWorld, hub.seeded)
	}
	if time.Since(hub.lastEventAt) > 5*time.Second {
		t.Fatalf("换服后应按「刚活动」快节奏轮询，lastEventAt=%v", hub.lastEventAt)
	}
	if len(hub.wake) == 0 {
		t.Fatal("换服后应叫醒共享轮询器")
	}
}

// TestEventsStreamSendsReset 端到端验证 SSE：换实例后订阅者会收到 `event: reset`。
func TestEventsStreamSendsReset(t *testing.T) {
	var mu sync.Mutex
	instance := "A"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/token/create":
			_ = json.NewEncoder(w).Encode(map[string]any{"response": "Successful login", "token": "tok-1"})
		case "/tokentest":
			_ = json.NewEncoder(w).Encode(map[string]any{"associateduser": "Alice"})
		case "/webui/events":
			mu.Lock()
			inst := instance
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"events":   []map[string]any{},
				"lastSeq":  1,
				"instance": inst,
			})
		case "/webui/serverinfo":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "world", "worldId": 1})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	cfg := config.Default()
	cfg.TShockURL = upstream.URL
	cfg.TShockTimeout = 2 * time.Second
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{
		Config:   cfg,
		Version:  "test",
		Sessions: session.New(cfg.SessionTTL, cfg.MaxSessions),
		TShock:   tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, log),
		Web:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}},
		Logger:   log,
	})
	front := httptest.NewServer(srv.Handler())
	defer front.Close()

	// 登录拿会话 Cookie（SSE 也需要登录）；非 GET 必须带 CSRF 头。
	loginReq, _ := http.NewRequest(http.MethodPost, front.URL+"/api/login",
		strings.NewReader(`{"username":"alice","password":"pw"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.Header.Set("X-Requested-With", "tswui")
	resp, err := http.DefaultClient.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if strings.HasPrefix(c.Name, "tswui_session") {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatalf("登录没有下发会话 Cookie：HTTP %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, front.URL+"/api/events/stream?since=0", nil)
	req.AddCookie(cookie)
	stream, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("打开 SSE：%v", err)
	}
	defer stream.Body.Close()

	lines := make(chan string, 64)
	go func() {
		scanner := bufio.NewScanner(stream.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()
	waitFor := func(want string) {
		t.Helper()
		deadline := time.After(8 * time.Second)
		for {
			select {
			case line, ok := <-lines:
				if !ok {
					t.Fatalf("事件流已结束，没等到 %q", want)
				}
				if strings.Contains(line, want) {
					return
				}
			case <-deadline:
				t.Fatalf("超时没等到 %q", want)
			}
		}
	}

	waitFor("retry: 3000") // 建连完成（订阅已注册）
	if !srv.hubFor(srv.tshock).observeInstance("B") {
		t.Fatal("换实例应被识别")
	}
	waitFor("event: reset")
}

// TestEventsStreamResetOrdering 验证换实例时的帧序：旧实例的事件一定排在 `event: reset` 之前，
// 前端收到 reset 就清空列表 —— 于是旧服事件不会混进新列表，也不会丢新服的帧。
func TestEventsStreamResetOrdering(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/token/create":
			_ = json.NewEncoder(w).Encode(map[string]any{"response": "Successful login", "token": "tok-1"})
		case "/tokentest":
			_ = json.NewEncoder(w).Encode(map[string]any{"associateduser": "Alice"})
		case "/webui/events":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"events": []map[string]any{}, "lastSeq": 0, "instance": "B",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	cfg := config.Default()
	cfg.TShockURL = upstream.URL
	cfg.TShockTimeout = 2 * time.Second
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{
		Config:   cfg,
		Version:  "test",
		Sessions: session.New(cfg.SessionTTL, cfg.MaxSessions),
		TShock:   tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, log),
		Web:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}},
		Logger:   log,
	})
	front := httptest.NewServer(srv.Handler())
	defer front.Close()

	loginReq, _ := http.NewRequest(http.MethodPost, front.URL+"/api/login",
		strings.NewReader(`{"username":"alice","password":"pw"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.Header.Set("X-Requested-With", "tswui")
	resp, err := http.DefaultClient.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if strings.HasPrefix(c.Name, "tswui_session") {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatalf("登录没有下发会话 Cookie：HTTP %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, front.URL+"/api/events/stream?since=0", nil)
	req.AddCookie(cookie)
	stream, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("打开 SSE：%v", err)
	}
	defer stream.Body.Close()

	body := make(chan string, 64)
	go func() {
		scanner := bufio.NewScanner(stream.Body)
		for scanner.Scan() {
			body <- scanner.Text()
		}
		close(body)
	}()
	var seen []string
	readUntil := func(want string) {
		t.Helper()
		deadline := time.After(8 * time.Second)
		for {
			select {
			case line, ok := <-body:
				if !ok {
					t.Fatalf("事件流已结束，没等到 %q（已收到 %v）", want, seen)
				}
				seen = append(seen, line)
				if strings.Contains(line, want) {
					return
				}
			case <-deadline:
				t.Fatalf("超时没等到 %q（已收到 %v）", want, seen)
			}
		}
	}
	readUntil("retry: 3000")

	// 模拟换服瞬间：先广播旧实例事件，再广播 reset，最后是新实例事件。
	hub := srv.hubFor(srv.tshock)
	hub.mu.Lock()
	subs := make([]*feedSub, 0, len(hub.subs))
	for sub := range hub.subs {
		subs = append(subs, sub)
	}
	hub.mu.Unlock()
	if len(subs) != 1 {
		t.Fatalf("订阅者数量 = %d，期望 1", len(subs))
	}
	subs[0].ch <- feedEvent{kind: feedMessage, event: tshock.ServerEvent{Seq: 900, Type: "join", Text: "旧服的事件"}}
	subs[0].ch <- feedEvent{kind: feedReset, instance: "B"}
	subs[0].ch <- feedEvent{kind: feedMessage, event: tshock.ServerEvent{Seq: 1, Type: "join", Text: "新服的事件"}}

	readUntil("新服的事件")
	pos := func(needle string) int {
		for i, line := range seen {
			if strings.Contains(line, needle) {
				return i
			}
		}
		return -1
	}
	oldAt, resetAt, newAt := pos("旧服的事件"), pos("event: reset"), pos("新服的事件")
	if oldAt < 0 || resetAt < 0 || newAt < 0 {
		t.Fatalf("缺少帧：旧=%d reset=%d 新=%d（%v）", oldAt, resetAt, newAt, seen)
	}
	if !(oldAt < resetAt && resetAt < newAt) {
		t.Fatalf("帧序应为「旧事件 → reset → 新事件」，实际 旧=%d reset=%d 新=%d", oldAt, resetAt, newAt)
	}
	// 新服的 seq 从 1 重新开始：reset 之后的帧必须照常写出（不能被过滤掉）。
	if !strings.Contains(seen[newAt], "新服的事件") {
		t.Fatalf("新服的帧丢失：%v", seen[newAt])
	}
}
