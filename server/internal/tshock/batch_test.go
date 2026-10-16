package tshock

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRunBatchParsesResults(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/batch" {
			t.Errorf("path = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("token") != "tok" {
			t.Errorf("token = %q", q.Get("token"))
		}
		var cmds []string
		if err := json.Unmarshal([]byte(q.Get("cmds")), &cmds); err != nil {
			t.Fatalf("cmds 不是合法 JSON 数组：%v (%q)", err, q.Get("cmds"))
		}
		if len(cmds) != 3 || cmds[0] != "/who" || cmds[2] != "/bossinfo" {
			t.Fatalf("cmds = %v", cmds)
		}
		writeJSON(w, 200, map[string]any{
			"status": "200",
			"results": []map[string]any{
				{"cmd": "/who", "output": []string{"在线玩家: Alice"}},
				{"cmd": "/time", "output": "世界时间：8:30"},
				{"cmd": "/bossinfo", "output": []string{"你没有权限使用该指令"}},
			},
		})
	}), time.Second)

	out, err := c.RunBatch(context.Background(), "tok", []string{"/who", "/time", "/bossinfo"})
	if err != nil {
		t.Fatalf("RunBatch: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("len = %d", len(out))
	}
	if out[0].Status != StatusOK || out[0].Output[0] != "在线玩家: Alice" {
		t.Fatalf("out[0] = %+v", out[0])
	}
	// 字符串 output 也要能解析。
	if out[1].Status != StatusOK || out[1].Output[0] != "世界时间：8:30" {
		t.Fatalf("out[1] = %+v", out[1])
	}
	if out[2].Status != StatusNoPermission {
		t.Fatalf("out[2] = %+v", out[2])
	}
}

func TestRunBatchMissingPlugin(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	_, err := c.RunBatch(context.Background(), "tok", []string{"/who"})
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestRunBatchTokenInvalid(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// apiError 会调 /tokentest 判定 403 的语义。
		if r.URL.Path == "/tokentest" {
			writeJSON(w, 403, map[string]any{"error": "未授权：令牌无效"})
			return
		}
		writeJSON(w, 403, map[string]any{"error": "未授权：令牌无效"})
	}), time.Second)

	_, err := c.RunBatch(context.Background(), "tok", []string{"/who"})
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTokenInvalid {
		t.Fatalf("err = %v", err)
	}
}

func TestBatchProbePresent(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// 无 token：安全端点返回 401，说明路由存在。
		writeJSON(w, 401, map[string]any{"error": "需要令牌"})
	}), time.Second)

	if err := c.BatchProbe(context.Background()); err != nil {
		t.Fatalf("BatchProbe 应视为已安装：%v", err)
	}
}

func TestBatchProbeMissing(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	var e *APIError
	if err := c.BatchProbe(context.Background()); !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestSplitBatchChunks(t *testing.T) {
	// 40 条 300 字符的指令：按 URI 预算必然拆成多块。
	cmds := make([]string, 40)
	for i := range cmds {
		cmds[i] = "/say " + strings.Repeat("x", 300)
	}
	chunks := splitBatchChunks("tok", cmds)
	if len(chunks) < 2 {
		t.Fatalf("应拆成多块，实际 %d", len(chunks))
	}

	var flat []string
	for i, chunk := range chunks {
		if len(chunk) == 0 {
			t.Fatalf("块 %d 为空", i)
		}
		if len(chunk) > MaxBatchCommands {
			t.Fatalf("块 %d 指令数超限：%d", i, len(chunk))
		}
		if len(chunk) > 1 && batchQuerySize("tok", chunk) > maxBatchQueryBytes {
			t.Fatalf("块 %d URI 超预算：%d", i, batchQuerySize("tok", chunk))
		}
		flat = append(flat, chunk...)
	}
	if !reflect.DeepEqual(flat, cmds) {
		t.Fatalf("拆分后顺序/内容改变")
	}
}

func TestSplitBatchChunksSingleOversized(t *testing.T) {
	huge := "/say " + strings.Repeat("x", maxBatchQueryBytes*2)
	chunks := splitBatchChunks("tok", []string{huge, "/who"})
	if len(chunks) != 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	if len(chunks[0]) != 1 || chunks[0][0] != huge {
		t.Fatalf("超长单条应单独成块：%+v", chunks[0])
	}
	if len(chunks[1]) != 1 || chunks[1][0] != "/who" {
		t.Fatalf("chunks[1] = %+v", chunks[1])
	}
}

func TestRunBatchSplitsIntoMultipleRequests(t *testing.T) {
	var mu sync.Mutex
	var requests [][]string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var cmds []string
		if err := json.Unmarshal([]byte(r.URL.Query().Get("cmds")), &cmds); err != nil {
			t.Fatalf("cmds: %v", err)
		}
		mu.Lock()
		requests = append(requests, cmds)
		mu.Unlock()
		out := make([]map[string]any, len(cmds))
		for i, cmd := range cmds {
			out[i] = map[string]any{"cmd": cmd, "output": []string{"ok"}}
		}
		writeJSON(w, 200, map[string]any{"status": "200", "results": out})
	}), time.Second)

	cmds := make([]string, 30)
	for i := range cmds {
		cmds[i] = "/say " + strings.Repeat("y", 300)
	}
	out, err := c.RunBatch(context.Background(), "tok", cmds)
	if err != nil {
		t.Fatalf("RunBatch: %v", err)
	}
	if len(out) != len(cmds) {
		t.Fatalf("结果数 = %d，期望 %d", len(out), len(cmds))
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requests) < 2 {
		t.Fatalf("应拆成多次请求，实际 %d", len(requests))
	}
	var flat []string
	for _, req := range requests {
		flat = append(flat, req...)
	}
	if !reflect.DeepEqual(flat, cmds) {
		t.Fatalf("多次请求拼接后顺序/内容改变")
	}
}
