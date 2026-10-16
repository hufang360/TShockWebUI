package tshock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newTestClient(t *testing.T, handler http.Handler, timeout time.Duration) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return NewClient(srv.URL, timeout, testLogger())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func TestCreateTokenSuccess(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/token/create" {
			t.Errorf("路径 = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("username") != "alice" || q.Get("password") != "s3cret" {
			t.Errorf("凭证未通过 query 传递：%v", q)
		}
		writeJSON(w, 200, map[string]any{"response": "Successful login", "token": "abc123"})
	}), time.Second)

	token, err := c.CreateToken(context.Background(), "alice", "s3cret")
	if err != nil {
		t.Fatalf("CreateToken: %v", err)
	}
	if token != "abc123" {
		t.Fatalf("token = %q", token)
	}
}

func TestCreateTokenForbiddenIsBadCredentials(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{
			"error": "Username or password may be incorrect or this account may not have sufficient privileges.",
		})
	}), time.Second)

	_, err := c.CreateToken(context.Background(), "alice", "wrong")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindBadCredentials {
		t.Fatalf("err = %v，期望 KindBadCredentials", err)
	}
}

func TestServerStatusNormalizesVersion(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name":           "中秋快乐",
			"serverversion":  "v1.4.5.8",
			"tshockversion":  "v6.2.1.0",
			"port":           7777,
			"playercount":    0,
			"maxplayers":     8,
			"world":          "中秋快乐",
			"uptime":         "0.00:00:18",
			"serverpassword": true,
		})
	}), time.Second)

	st, err := c.ServerStatus(context.Background(), "tok")
	if err != nil {
		t.Fatalf("ServerStatus: %v", err)
	}
	if st.ServerVersion != "1.4.5.8" || st.TShockVersion != "6.2.1.0" {
		t.Fatalf("版本未规范化：%+v", st)
	}
	if st.Port != 7777 || st.MaxPlayers != 8 || st.World != "中秋快乐" {
		t.Fatalf("字段解析错误：%+v", st)
	}
	if st.Uptime != "0.00:00:18" || !st.ServerPassword {
		t.Fatalf("uptime/serverpassword 解析错误：%+v", st)
	}
}

func TestServerStatusUnauthorizedIsTokenInvalid(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 401, map[string]any{"error": "Not authorized. The specified API endpoint requires a token."})
	}), time.Second)

	_, err := c.ServerStatus(context.Background(), "")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTokenInvalid {
		t.Fatalf("err = %v，期望 KindTokenInvalid", err)
	}
}

func TestPlayersListParsesObjects(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"players": []map[string]any{
				{"nickname": "Alice", "group": "guest"},
				{"nickname": "Bob", "group": "default"},
			},
		})
	}), time.Second)

	names, err := c.PlayersList(context.Background(), "tok")
	if err != nil {
		t.Fatalf("PlayersList: %v", err)
	}
	if len(names) != 2 || names[0] != "Alice" || names[1] != "Bob" {
		t.Fatalf("names = %v", names)
	}
}

func TestRawCmdSuccessList(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/server/rawcmd" || r.URL.Query().Get("cmd") != "/time 12:00" {
			t.Errorf("请求错误：%s %v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{"response": []string{"line1", "line2"}})
	}), time.Second)

	res, err := c.RawCmd(context.Background(), "tok", "/time 12:00")
	if err != nil {
		t.Fatalf("RawCmd: %v", err)
	}
	if res.Status != StatusOK || len(res.Output) != 2 {
		t.Fatalf("res = %+v", res)
	}
}

func TestRawCmdSuccessString(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"response": "one\ntwo"})
	}), time.Second)

	res, err := c.RawCmd(context.Background(), "tok", "/time")
	if err != nil {
		t.Fatalf("RawCmd: %v", err)
	}
	if res.Status != StatusOK || len(res.Output) != 2 {
		t.Fatalf("res = %+v", res)
	}
}

func TestRawCmdOutputClassification(t *testing.T) {
	cases := []struct {
		name   string
		lines  []string
		status string
	}{
		{"权限不足", []string{"You do not have access to this command."}, StatusNoPermission},
		{"权限不足-中文", []string{"你没有权限使用该指令。"}, StatusNoPermission},
		{"无效指令", []string{"Invalid command entered. Type /help for a list of valid commands."}, StatusCommandError},
		{"无效指令-中文", []string{"输入的命令无效。使用/help 获取可用的指令列表。"}, StatusCommandError},
		{"仅限游戏内", []string{"You must use this command in-game."}, StatusCommandError},
		{"仅限游戏内-中文", []string{"你必须在游戏内使用该指令。"}, StatusCommandError},
		{"正常输出", []string{"Time set to 12:00."}, StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeJSON(w, 200, map[string]any{"response": tc.lines})
			}), time.Second)
			res, err := c.RawCmd(context.Background(), "tok", "/x")
			if err != nil {
				t.Fatalf("RawCmd: %v", err)
			}
			if res.Status != tc.status {
				t.Fatalf("status = %q，期望 %q", res.Status, tc.status)
			}
		})
	}
}

func TestRawCmdForbiddenTokenInvalid(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{
			"error": "Not authorized. The specified API endpoint requires a token, but the provided token was not valid.",
		})
	}), time.Second)

	res, err := c.RawCmd(context.Background(), "bad", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTokenInvalid {
		t.Fatalf("err = %v，期望 KindTokenInvalid", err)
	}
	if res.Status != StatusTokenInvalid {
		t.Fatalf("res.Status = %q", res.Status)
	}
}

func TestRawCmdForbiddenNoPermission(t *testing.T) {
	// token 有效（/tokentest 200），但缺 rawcmd 权限。
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/tokentest" {
			writeJSON(w, 200, map[string]any{"associateduser": "alice"})
			return
		}
		writeJSON(w, 403, map[string]any{
			"error": `Not authorized. User "alice" has no access to use the specified API endpoint.`,
		})
	}), time.Second)

	_, err := c.RawCmd(context.Background(), "tok", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNoPermission {
		t.Fatalf("err = %v，期望 KindNoPermission", err)
	}
}

// TestRawCmdForbiddenChineseInvalidToken 覆盖目标服的本地化陷阱：
// 中文的无效 token 响应写作“令牌”，不含英文 token。
func TestRawCmdForbiddenChineseInvalidToken(t *testing.T) {
	const msg = "未授权：指定的API端点需要授权令牌，但使用的令牌无效。"
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": msg})
	}), time.Second)

	res, err := c.RawCmd(context.Background(), "bogus", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTokenInvalid {
		t.Fatalf("err = %v，期望 KindTokenInvalid", err)
	}
	if res.Status != StatusTokenInvalid {
		t.Fatalf("res.Status = %q", res.Status)
	}
}

func TestRawCmdServerErrorUnavailable(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 500, map[string]any{"error": "boom"})
	}), time.Second)

	_, err := c.RawCmd(context.Background(), "tok", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindUnavailable {
		t.Fatalf("err = %v，期望 KindUnavailable", err)
	}
}

func TestRawCmdInvalidJSON(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not json"))
	}), time.Second)

	res, err := c.RawCmd(context.Background(), "tok", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindBadResponse {
		t.Fatalf("err = %v，期望 KindBadResponse", err)
	}
	if res.Status != StatusBadResponse {
		t.Fatalf("res.Status = %q", res.Status)
	}
}

func TestRawCmdTimeout(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		writeJSON(w, 200, map[string]any{"response": "late"})
	}), 50*time.Millisecond)

	res, err := c.RawCmd(context.Background(), "tok", "/time")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTimeout {
		t.Fatalf("err = %v，期望 KindTimeout", err)
	}
	if res.Status != StatusTimeout {
		t.Fatalf("res.Status = %q", res.Status)
	}
}

func TestDestroyAndTokenTest(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tokentest":
			writeJSON(w, 200, map[string]any{"associateduser": "Alice"})
		case "/token/destroy/tok":
			writeJSON(w, 200, map[string]any{"response": "Requested token was successfully destroyed."})
		default:
			t.Errorf("未知路径 %s", r.URL.Path)
		}
	}), time.Second)

	name, err := c.TokenTest(context.Background(), "tok")
	if err != nil || name != "Alice" {
		t.Fatalf("TokenTest = %q, %v", name, err)
	}
	if err := c.DestroyToken(context.Background(), "tok"); err != nil {
		t.Fatalf("DestroyToken: %v", err)
	}
}

func TestNormalizeVersion(t *testing.T) {
	if NormalizeVersion(" v1.4.5.8 ") != "1.4.5.8" {
		t.Fatal("应去掉前导 v 与空白")
	}
	if NormalizeVersion("1.4.5.8") != "1.4.5.8" {
		t.Fatal("无前导 v 应保持不变")
	}
}

// TestClientLogHidesCredentials：设计原则与约束 §4.3 日志脱敏——
// 出站日志只记录 endpoint，绝不记录 query（token / 密码都在 query 里）。
func TestClientLogHidesCredentials(t *testing.T) {
	var buf bytes.Buffer
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/token/create":
			writeJSON(w, 200, map[string]any{"token": "SECRETTOKEN"})
		case "/v3/server/rawcmd":
			writeJSON(w, 200, map[string]any{"response": []string{"ok"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, 2*time.Second,
		slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	ctx := context.Background()
	if _, err := c.CreateToken(ctx, "alice", "hunter2"); err != nil {
		t.Fatalf("CreateToken: %v", err)
	}
	if _, err := c.RawCmd(ctx, "SECRETTOKEN", "/time 12:00"); err != nil {
		t.Fatalf("RawCmd: %v", err)
	}

	logged := buf.String()
	if logged == "" {
		t.Fatal("未捕获到出站日志")
	}
	for _, secret := range []string{"hunter2", "SECRETTOKEN"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("出站日志泄露了 %q：\n%s", secret, logged)
		}
	}
	if !strings.Contains(logged, "endpoint=/v2/token/create") {
		t.Fatalf("日志应记录 endpoint：\n%s", logged)
	}
}

// TShock 按 URI 路由、不校验 HTTP 方法（docs/REST_API限制.md 第 1 节）：
// 出站默认 POST（规避部分机房对明文 GET 的 302 劫持），参数仍只在 query。
func TestDefaultMethodIsPostWithQueryOnly(t *testing.T) {
	var methods []string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		if r.ContentLength > 0 {
			t.Errorf("%s 不应带请求体，ContentLength = %d", r.URL.Path, r.ContentLength)
		}
		switch r.URL.Path {
		case "/v2/token/create":
			if r.URL.Query().Get("username") != "alice" {
				t.Errorf("凭证应走 query：%q", r.URL.RawQuery)
			}
			writeJSON(w, 200, map[string]any{"token": "T"})
		case "/v3/server/rawcmd":
			if r.URL.Query().Get("cmd") != "/help" {
				t.Errorf("cmd 应走 query：%q", r.URL.RawQuery)
			}
			writeJSON(w, 200, map[string]any{"response": []string{"ok"}})
		default:
			http.NotFound(w, r)
		}
	}), time.Second)

	ctx := context.Background()
	if _, err := c.CreateToken(ctx, "alice", "pw"); err != nil {
		t.Fatalf("CreateToken: %v", err)
	}
	if _, err := c.RawCmd(ctx, "T", "/help"); err != nil {
		t.Fatalf("RawCmd: %v", err)
	}
	if len(methods) != 2 {
		t.Fatalf("期望 2 次调用，实际 %v", methods)
	}
	for _, m := range methods {
		if m != http.MethodPost {
			t.Fatalf("默认出站方法应为 POST，实际 %v", methods)
		}
	}
}

func TestNormalizeMethod(t *testing.T) {
	cases := map[string]string{
		"get":    http.MethodGet,
		"GET":    http.MethodGet,
		" Get ":  http.MethodGet,
		"post":   http.MethodPost,
		"POST":   http.MethodPost,
		"":       http.MethodPost, // 缺省
		"DELETE": http.MethodPost, // 非法值回退默认
	}
	for in, want := range cases {
		if got := NormalizeMethod(in); got != want {
			t.Errorf("NormalizeMethod(%q) = %q，期望 %q", in, got, want)
		}
	}
}

// TSHOCK_METHOD=GET 时按 GET 出站；ForBaseURL 生成的副本保留方法（多服务器切换）。
func TestWithMethodGetAndForBaseURLKeepsMethod(t *testing.T) {
	var methods []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		writeJSON(w, 200, map[string]any{"token": "T"})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, time.Second, testLogger(), WithMethod("get"))
	ctx := context.Background()
	if _, err := c.CreateToken(ctx, "alice", "pw"); err != nil {
		t.Fatalf("CreateToken: %v", err)
	}
	if _, err := c.ForBaseURL(srv.URL).CreateToken(ctx, "alice", "pw"); err != nil {
		t.Fatalf("ForBaseURL().CreateToken: %v", err)
	}
	for _, m := range methods {
		if m != http.MethodGet {
			t.Fatalf("WithMethod(GET) 后应全部用 GET，实际 %v", methods)
		}
	}
}
