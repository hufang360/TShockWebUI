package api_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"tshockwebui/server/internal/api"
	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fake 是可控的假 TShock，并统计各路径被调用次数（用于断言「未发出站请求」）。
type fake struct {
	mu     sync.Mutex
	counts map[string]int
	routes map[string]http.HandlerFunc
}

func newFake(routes map[string]http.HandlerFunc) *fake {
	return &fake{counts: map[string]int{}, routes: routes}
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.counts[r.URL.Path]++
	f.mu.Unlock()
	if h, ok := f.routes[r.URL.Path]; ok {
		h(w, r)
		return
	}
	http.NotFound(w, r)
}

func (f *fake) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.counts[path]
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func newServer(t *testing.T, tshockURL string, mutate func(*config.Config)) (*api.Server, *session.Store) {
	t.Helper()
	cfg := config.Default()
	cfg.TShockURL = tshockURL
	cfg.TShockTimeout = 2 * time.Second
	if mutate != nil {
		mutate(&cfg)
	}
	store := session.New(cfg.SessionTTL, cfg.MaxSessions)
	srv := api.New(api.Deps{
		Config:   cfg,
		Version:  "test-1.0",
		Sessions: store,
		TShock:   tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, testLogger()),
		Commands: tshock.DefaultCommands(),
		Web: fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<!doctype html><html>ok</html>")},
		},
		Logger: testLogger(),
	})
	return srv, store
}

func do(h http.Handler, method, path string, payload any, cookie *http.Cookie, csrf bool) *httptest.ResponseRecorder {
	var body io.Reader
	if payload != nil {
		b, _ := json.Marshal(payload)
		body = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if csrf {
		req.Header.Set("X-Requested-With", "tswui")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func loginCookie(t *testing.T, h http.Handler, user, pass string) *http.Cookie {
	t.Helper()
	rec := do(h, http.MethodPost, "/api/login", map[string]string{"username": user, "password": pass}, nil, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("登录失败：HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == "tswui_session" {
			return c
		}
	}
	t.Fatal("登录响应未下发会话 Cookie")
	return nil
}

func okLoginRoutes() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"/v2/token/create": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"response": "Successful login", "token": "tok-1"})
		},
		"/tokentest": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"associateduser": "Alice"})
		},
	}
}

func TestLoginSuccessSetsHttpOnlyCookie(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()

	rec := do(h, http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": "pw"}, nil, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Username string `json:"username"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Username != "Alice" {
		t.Fatalf("username = %q，期望 tokentest 返回的规范名 Alice", out.Username)
	}
	setCookie := rec.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Strict") {
		t.Fatalf("Cookie 安全属性缺失：%s", setCookie)
	}
	if strings.Contains(setCookie, "tok-1") {
		t.Fatal("响应不得包含 TShock token")
	}
	if store.Len() != 1 {
		t.Fatalf("会话数 = %d，期望 1", store.Len())
	}
}

func TestLoginBadCredentials(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/v2/token/create": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 403, map[string]any{"error": "Username or password may be incorrect or this account may not have sufficient privileges."})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": "bad"}, nil, true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("HTTP %d，期望 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "bad_credentials") {
		t.Fatalf("错误码错误：%s", rec.Body.String())
	}
	// 不泄露账号是否存在：提示统一。
	if !strings.Contains(rec.Body.String(), "账号或密码错误") {
		t.Fatalf("提示应统一为账号或密码错误：%s", rec.Body.String())
	}
}

func TestLoginMissingCSRF(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"username": "a", "password": "b"}, nil, false)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "csrf") {
		t.Fatalf("HTTP %d body=%s，期望 403 csrf", rec.Code, rec.Body.String())
	}
	if f.count("/v2/token/create") != 0 {
		t.Fatal("CSRF 拦截时不应调用 TShock")
	}
}

func TestLoginRateLimited(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/v2/token/create": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 403, map[string]any{"error": "nope"})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, func(c *config.Config) { c.LoginMaxPerMin = 1 })
	h := srv.Handler()

	first := do(h, http.MethodPost, "/api/login", map[string]string{"username": "a", "password": "b"}, nil, true)
	if first.Code != http.StatusUnauthorized {
		t.Fatalf("第一次 HTTP %d，期望 401", first.Code)
	}
	second := do(h, http.MethodPost, "/api/login", map[string]string{"username": "a", "password": "b"}, nil, true)
	if second.Code != http.StatusTooManyRequests || !strings.Contains(second.Body.String(), "rate_limited") {
		t.Fatalf("第二次 HTTP %d body=%s，期望 429 rate_limited", second.Code, second.Body.String())
	}
}

// 装了 WebUI 插件且 TShock 建令牌桶已满时：后端直接判 rate_limited，且不再打 token/create。
// 依据：SecureRest.cs:117-125 —— 限流返回的 403 与「密码错」同文案，只能靠插件读桶区分。
func TestLoginTShockRateLimitDetectedViaPlugin(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/webui/restlimit": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"code": "ok", "limit": 5, "bucket": 5, "intervalMinutes": 1})
		},
		"/v2/token/create": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 403, map[string]any{"error": "Username or password may be incorrect or this account may not have sufficient privileges."})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": "pw"}, nil, true)
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), "rate_limited") {
		t.Fatalf("HTTP %d body=%s，期望 429 rate_limited", rec.Code, rec.Body.String())
	}
	if f.count("/v2/token/create") != 0 {
		t.Fatal("桶已满时不应再调 /v2/token/create")
	}
}

// 插件报告桶未满时：按原逻辑调 token/create（证明预检不误伤正常登录）。
func TestLoginPluginBucketUnderLimitProceeds(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/webui/restlimit": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"code": "ok", "limit": 5, "bucket": 1, "intervalMinutes": 1})
		},
		"/v2/token/create": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 403, map[string]any{"error": "Username or password may be incorrect or this account may not have sufficient privileges."})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": "pw"}, nil, true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("HTTP %d body=%s，期望 401（桶未满，继续走 token/create 失败）", rec.Code, rec.Body.String())
	}
	if f.count("/v2/token/create") != 1 {
		t.Fatalf("token/create 调用 %d 次，期望 1 次", f.count("/v2/token/create"))
	}
}

func TestLoginWithTokenSuccess(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/tokentest": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"associateduser": "GGMM"})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"token": "app-token-1"}, nil, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Username string `json:"username"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Username != "GGMM" {
		t.Fatalf("username = %q，期望 tokentest 返回的关联用户 GGMM", out.Username)
	}
	if store.Len() != 1 {
		t.Fatalf("会话数 = %d", store.Len())
	}
	if f.count("/v2/token/create") != 0 {
		t.Fatal("令牌登录不应调用 /v2/token/create")
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), "HttpOnly") {
		t.Fatal("应下发 HttpOnly Cookie")
	}
}

func TestLoginWithTokenInvalid(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/tokentest": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 403, map[string]any{"error": "未授权：指定的API端点需要授权令牌，但使用的令牌无效。"})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login", map[string]string{"token": "bogus"}, nil, true)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "token_invalid") {
		t.Fatalf("HTTP %d body=%s，期望 401 token_invalid", rec.Code, rec.Body.String())
	}
	if store.Len() != 0 {
		t.Fatal("无效令牌不应创建会话")
	}
}

func TestSessionUnauthenticated(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodGet, "/api/session", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d，期望 200", rec.Code)
	}
	var out struct {
		Authenticated bool    `json:"authenticated"`
		Username      *string `json:"username"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Authenticated || out.Username != nil {
		t.Fatalf("未登录会话响应错误：%s", rec.Body.String())
	}
}

// TestSessionValidatesToken：会话存在时 /api/session 会向上游校验 token。
// TShock 重启后 token 失效 → 必须清会话、回未登录，让前端弹出登录框。
func TestSessionValidatesToken(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	var out struct {
		Authenticated bool `json:"authenticated"`
	}

	// token 仍有效：保持登录。
	rec := do(h, http.MethodGet, "/api/session", nil, cookie, false)
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Authenticated {
		t.Fatalf("token 有效时应保持登录：%s", rec.Body.String())
	}
	if store.Len() != 1 {
		t.Fatalf("token 有效时不应清会话，剩余 %d", store.Len())
	}

	// 模拟 TShock 重启：/tokentest 对旧 token 返回 403。
	f.routes["/tokentest"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "未授权：指定的API端点需要授权令牌，但使用的令牌无效。"})
	}
	rec = do(h, http.MethodGet, "/api/session", nil, cookie, false)
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Authenticated {
		t.Fatalf("token 失效后应回未登录：%s", rec.Body.String())
	}
	if store.Len() != 0 {
		t.Fatalf("token 失效后应清会话，剩余 %d", store.Len())
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), "tswui_session=;") {
		t.Fatalf("token 失效后应清除会话 Cookie：%s", rec.Header().Get("Set-Cookie"))
	}
}

// TestSessionTShockUnreachableKeepsSession：上游不可达时不强制登出（避免误清会话）。
func TestSessionTShockUnreachableKeepsSession(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")
	ts.Close() // 模拟 TShock 不可达

	rec := do(h, http.MethodGet, "/api/session", nil, cookie, false)
	var out struct {
		Authenticated bool `json:"authenticated"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Authenticated {
		t.Fatalf("TShock 不可达时不应强制登出：%s", rec.Body.String())
	}
	if store.Len() != 1 {
		t.Fatalf("TShock 不可达时应保留会话，剩余 %d", store.Len())
	}
}

func TestCommandRequiresAuth(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/command", map[string]string{"cmd": "/time"}, nil, true)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "not_authenticated") {
		t.Fatalf("HTTP %d body=%s，期望 401 not_authenticated", rec.Code, rec.Body.String())
	}
}

func TestCommandRejectedDoesNotCallTShock(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/i 29"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d，期望 200", rec.Code)
	}
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusRejected || !strings.Contains(res.Message, "只能在游戏内执行") {
		t.Fatalf("res = %+v，期望 rejected", res)
	}
	if f.count("/v3/server/rawcmd") != 0 {
		t.Fatalf("allowServer=false 不应调用 TShock，实际调用 %d 次", f.count("/v3/server/rawcmd"))
	}
}

// TestCommandUnknownSentToTShock：插件/未知指令不再前置拒绝，交由 TShock 判定（如 FishShop 的 /fish）。
func TestCommandUnknownSentToTShock(t *testing.T) {
	f := newFake(okLoginRoutes())
	f.routes["/v3/server/rawcmd"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"response": []string{"输入的命令无效。使用/help 获取可用的指令列表。"}})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/nope 1"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusCommandNotFound {
		t.Fatalf("res = %+v，期望 command_not_found（由 TShock 判定）", res)
	}
	if f.count("/v3/server/rawcmd") != 1 {
		t.Fatalf("未知指令应发往 TShock 一次，实际 %d", f.count("/v3/server/rawcmd"))
	}
}

func TestCommandSuccess(t *testing.T) {
	f := newFake(okLoginRoutes())
	f.routes["/v3/server/rawcmd"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"response": []string{"Time set to 12:00."}})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time 12:00"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusOK || len(res.Output) != 1 {
		t.Fatalf("res = %+v", res)
	}
	if f.count("/v3/server/rawcmd") != 1 {
		t.Fatal("应恰好调用一次 rawcmd")
	}
}

// TestCommandRateLimited：设计原则与约束 §5 要求对指令执行限流；按会话计数，超限不发往 TShock。
func TestCommandRateLimited(t *testing.T) {
	f := newFake(okLoginRoutes())
	f.routes["/v3/server/rawcmd"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"response": []string{"ok"}})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, func(c *config.Config) { c.CommandMaxPerMin = 2 })
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	for i := 1; i <= 2; i++ {
		rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time 12:00"}, cookie, true)
		if rec.Code != http.StatusOK {
			t.Fatalf("第 %d 次应放行，HTTP %d body=%s", i, rec.Code, rec.Body.String())
		}
	}

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time 12:00"}, cookie, true)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("超限应 429，实际 HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"rate_limited"`) {
		t.Fatalf("错误码应为 rate_limited：%s", rec.Body.String())
	}
	if got := f.count("/v3/server/rawcmd"); got != 2 {
		t.Fatalf("被限流的请求不得发往 TShock，rawcmd 调用次数 = %d，期望 2", got)
	}
}

// TestAccessLogHidesQueryAndBody：设计原则与约束 §4.3 日志脱敏——访问日志不得含 query / body。
func TestAccessLogHidesQueryAndBody(t *testing.T) {
	var buf bytes.Buffer
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	// newServer 的 logger 写到 Discard，这里换成可断言的 buffer。
	h := api.New(api.Deps{
		Config:   config.Default(),
		Version:  "test-1.0",
		Sessions: session.New(time.Hour, 10),
		TShock:   tshock.NewClient(ts.URL, 2*time.Second, testLogger()),
		Commands: tshock.DefaultCommands(),
		Web:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}},
		Logger:   slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}).Handler()

	// query 里放敏感串（真实场景 token 只走 query，如 /v2/*）、body 里放密码。
	do(h, http.MethodGet, "/api/status?token=SECRETTOKEN&password=hunter2", nil, nil, false)
	do(h, http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": "hunter2"}, nil, true)

	logged := buf.String()
	if logged == "" {
		t.Fatal("未捕获到任何日志")
	}
	for _, secret := range []string{"SECRETTOKEN", "hunter2"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("日志泄露了 %q：\n%s", secret, logged)
		}
	}
	if !strings.Contains(logged, "path=/api/status") {
		t.Fatalf("访问日志应记录不带 query 的 path：\n%s", logged)
	}
}

func TestCommandTokenInvalidClearsSession(t *testing.T) {
	f := newFake(okLoginRoutes())
	// token 失效：rawcmd 与 tokentest 均返回 403（真实行为）。
	fakeForbidden := func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "Not authorized. The provided token was not valid."})
	}
	f.routes["/tokentest"] = fakeForbidden
	f.routes["/v3/server/rawcmd"] = fakeForbidden
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")
	if store.Len() != 1 {
		t.Fatalf("登录后会话数 = %d", store.Len())
	}

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time"}, cookie, true)
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusTokenInvalid {
		t.Fatalf("res = %+v，期望 token_invalid", res)
	}
	if store.Len() != 0 {
		t.Fatalf("token 失效后应清会话，剩余 %d", store.Len())
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), "tswui_session=;") {
		t.Fatalf("应清除会话 Cookie：%s", rec.Header().Get("Set-Cookie"))
	}
}

func TestCommandNoPermissionKeepsSession(t *testing.T) {
	f := newFake(okLoginRoutes()) // /tokentest 200（token 有效）
	f.routes["/v3/server/rawcmd"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": `Not authorized. User "alice" has no access to use the specified API endpoint.`})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "/time"}, cookie, true)
	var res tshock.Result
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Status != tshock.StatusNoPermission {
		t.Fatalf("res = %+v，期望 no_permission", res)
	}
	if store.Len() != 1 {
		t.Fatalf("权限不足不应清会话，剩余 %d", store.Len())
	}
}

// TestStatusForwardsSessionToken：/v2/server/status 虽然允许匿名，但只要有会话就
// 必须带上该会话的 token —— 让 TShock（含插件）能识别这次调用属于哪个玩家。
func TestStatusForwardsSessionToken(t *testing.T) {
	f := newFake(okLoginRoutes())
	var mu sync.Mutex
	var seenToken string
	f.routes["/v2/server/status"] = func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seenToken = r.URL.Query().Get("token")
		mu.Unlock()
		writeJSON(w, 200, map[string]any{
			"name": "w", "serverversion": "1.4.5.8", "tshockversion": "6.2.1.0",
			"port": 7777, "playercount": 0, "maxplayers": 8, "world": "w",
		})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/status", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d，期望 200", rec.Code)
	}
	mu.Lock()
	got := seenToken
	mu.Unlock()
	if got != "tok-1" {
		t.Fatalf("上游收到的 token = %q，期望会话里的 tok-1", got)
	}

	// /api/status 会随登录态变化（有无 token 拿到的字段不同）→ 禁止缓存，
	// 否则浏览器可能把登录前的匿名响应复用给已登录页面。
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("Cache-Control = %q，期望含 no-store", got)
	}

	// 未登录（无 Cookie）：匿名请求照常可用，不带 token。
	rec = do(h, http.MethodGet, "/api/status", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("匿名 HTTP %d，期望 200", rec.Code)
	}
	mu.Lock()
	got = seenToken
	mu.Unlock()
	if got != "" {
		t.Fatalf("未登录时不应带 token，实际 %q", got)
	}
}

// doTarget 发一个带 X-TSWUI-Target 的请求（多服务器切换）。
func doTarget(h http.Handler, method, path, target string, payload any, cookie *http.Cookie, csrf bool) *httptest.ResponseRecorder {
	var body io.Reader
	if payload != nil {
		b, _ := json.Marshal(payload)
		body = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if csrf {
		req.Header.Set("X-Requested-With", "tswui")
	}
	req.Header.Set("X-TSWUI-Target", target)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestSessionIsolatedPerUpstream：会话按上游隔离。
//   - A 服（默认上游）登录后，探测 B 服不会把 A 的 token 发过去；
//   - 探测 B 服也不会把 A 的会话 / Cookie 清掉（此前切换服务器会误登出）；
//   - 在 B 服登录得到另一条会话，两者互不影响。
func TestSessionIsolatedPerUpstream(t *testing.T) {
	var mu sync.Mutex
	var tokenA, tokenB string
	statusRoute := func(dst *string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			*dst = r.URL.Query().Get("token")
			mu.Unlock()
			writeJSON(w, 200, map[string]any{"name": "w", "serverversion": "1.4.5.8"})
		}
	}
	fakeA := newFake(okLoginRoutes())
	fakeA.routes["/v2/server/status"] = statusRoute(&tokenA)
	tsA := httptest.NewServer(fakeA)
	defer tsA.Close()
	fakeB := newFake(okLoginRoutes())
	fakeB.routes["/v2/server/status"] = statusRoute(&tokenB)
	tsB := httptest.NewServer(fakeB)
	defer tsB.Close()

	srv, store := newServer(t, tsA.URL, func(c *config.Config) { c.TShockAllowCustomTargets = true })
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw") // 默认上游 = A

	// 1) 探测 B：不得带 A 的 token，也不得清掉 A 的会话。
	rec := doTarget(h, http.MethodGet, "/api/status", tsB.URL, nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	mu.Lock()
	gotB, gotA := tokenB, tokenA
	mu.Unlock()
	if gotB != "" {
		t.Fatalf("B 服不应收到 A 服的 token，实际 %q", gotB)
	}
	if store.Len() != 1 {
		t.Fatalf("探测 B 服不应清掉 A 的会话，剩余 %d", store.Len())
	}

	// 2) B 服视角：未登录（A 的 Cookie 名与 B 不同，且会话绑定上游）。
	rec = doTarget(h, http.MethodGet, "/api/session", tsB.URL, nil, cookie, false)
	if !strings.Contains(rec.Body.String(), `"authenticated":false`) {
		t.Fatalf("B 服应视为未登录：%s", rec.Body.String())
	}
	// 3) 回到 A：仍然登录着，并且 status 带 A 的 token。
	rec = doTarget(h, http.MethodGet, "/api/session", "", nil, cookie, false)
	if !strings.Contains(rec.Body.String(), `"authenticated":true`) {
		t.Fatalf("A 服的会话应保留：%s", rec.Body.String())
	}
	doTarget(h, http.MethodGet, "/api/status", "", nil, cookie, false)
	mu.Lock()
	gotA = tokenA
	mu.Unlock()
	if gotA != "tok-1" {
		t.Fatalf("A 服应收到 A 的 token，实际 %q", gotA)
	}

	// 4) 在 B 服登录：得到另一条会话与另一个 Cookie。
	var cookieB *http.Cookie
	recLogin := doTarget(h, http.MethodPost, "/api/login", tsB.URL,
		map[string]string{"username": "alice", "password": "pw"}, nil, true)
	if recLogin.Code != http.StatusOK {
		t.Fatalf("B 服登录失败：HTTP %d body=%s", recLogin.Code, recLogin.Body.String())
	}
	for _, c := range recLogin.Result().Cookies() {
		if strings.HasPrefix(c.Name, "tswui_session") {
			cookieB = c
		}
	}
	if cookieB == nil || cookieB.Name == cookie.Name {
		t.Fatalf("B 服应下发另一条会话 Cookie：A=%q B=%+v", cookie.Name, cookieB)
	}
	if store.Len() != 2 {
		t.Fatalf("两服应各有一条会话，实际 %d", store.Len())
	}
	// A 的 Cookie 对 B 无效，B 的 Cookie 对 A 也无效。
	rec = doTarget(h, http.MethodGet, "/api/session", "", nil, cookieB, false)
	if !strings.Contains(rec.Body.String(), `"authenticated":false`) {
		t.Fatalf("B 的 Cookie 不应在 A 服登录：%s", rec.Body.String())
	}

	// 5) 退出 B：只清 B 的会话，A 不受影响。
	doTarget(h, http.MethodPost, "/api/logout", tsB.URL, nil, cookieB, true)
	if store.Len() != 1 {
		t.Fatalf("退出 B 后应只剩 A 的会话，实际 %d", store.Len())
	}
	rec = doTarget(h, http.MethodGet, "/api/session", "", nil, cookie, false)
	if !strings.Contains(rec.Body.String(), `"authenticated":true`) {
		t.Fatalf("退出 B 不应影响 A：%s", rec.Body.String())
	}
}

// TestCapabilitiesAggregated：一次请求返回整台服务器的可选能力（并行探测）。
func TestCapabilitiesAggregated(t *testing.T) {
	f := newFake(okLoginRoutes())
	f.routes["/webui/meta"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.1.0", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"batch", "commands", "me", "data", "serverinfo", "events", "sessions", "chat", "requests", "requests_review"},
		})
	}
	f.routes["/webui/batch"] = func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"results": []any{}}) }
	f.routes["/webui/requests"] = func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"requests": []any{}}) }
	f.routes["/webui/requests/all"] = func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"requests": []any{}}) }
	f.routes["/pm/look"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"status": 400, "error": "缺少 name 参数"})
	}
	f.routes["/fishshop/list"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"name": "鱼店", "total": 0}})
	}
	f.routes["/webui/auth/request"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "player_offline", "message": "该玩家不在线"})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()

	// 需要登录。
	rec := do(h, http.MethodGet, "/api/capabilities", nil, nil, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("未登录 HTTP %d，期望 401", rec.Code)
	}

	cookie := loginCookie(t, h, "alice", "pw")
	rec = do(h, http.MethodGet, "/api/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Reachable bool `json:"reachable"`
		Messenger struct {
			Installed bool   `json:"installed"`
			Version   string `json:"version"`
		} `json:"messenger"`
		Batch    struct{ Plugin, Ingame bool }           `json:"batch"`
		Player   struct{ Plugin, Permission bool }       `json:"player"`
		Fish     struct{ Plugin, Rest, Permission bool } `json:"fish"`
		Requests struct{ Plugin, Submit, Review bool }   `json:"requests"`
		WebAuth  struct{ Plugin bool }                   `json:"webauth"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if !out.Reachable || !out.Messenger.Installed || !out.Batch.Plugin || !out.Player.Plugin || !out.Player.Permission ||
		!out.Fish.Plugin || !out.Fish.Rest || !out.Fish.Permission ||
		!out.Requests.Plugin || !out.Requests.Submit || !out.Requests.Review || !out.WebAuth.Plugin {
		t.Fatalf("聚合结果不完整：%s", rec.Body.String())
	}

	// 3 秒微缓存：第二次不再打上游；?fresh=1 强制重探。
	before := f.count("/webui/meta")
	do(h, http.MethodGet, "/api/capabilities", nil, cookie, false)
	if got := f.count("/webui/meta"); got != before {
		t.Fatalf("命中缓存时不应再探测上游：%d → %d", before, got)
	}
	do(h, http.MethodGet, "/api/capabilities?fresh=1", nil, cookie, false)
	if got := f.count("/webui/meta"); got <= before {
		t.Fatalf("?fresh=1 应重新探测：%d → %d", before, got)
	}
}

func TestStatusTokenInvalidClearsSession(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	// 同时让 token 失效：status 与 tokentest 均 401/403。
	f.routes["/v2/server/status"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 401, map[string]any{"error": "未授权。指定的 API 终结点需要一个令牌。"})
	}
	f.routes["/tokentest"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "未授权：…令牌无效。"})
	}

	rec := do(h, http.MethodGet, "/api/status", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d，期望 200", rec.Code)
	}
	var out struct {
		Reachable bool `json:"reachable"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Reachable {
		t.Fatalf("token 失效时仍应 reachable=true：%s", rec.Body.String())
	}
	if store.Len() != 0 {
		t.Fatalf("token 失效应清会话，剩余 %d", store.Len())
	}
}

func TestCommandEmptyBadRequest(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]string{"cmd": "   "}, cookie, true)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "bad_request") {
		t.Fatalf("HTTP %d body=%s，期望 400 bad_request", rec.Code, rec.Body.String())
	}
	if f.count("/v3/server/rawcmd") != 0 {
		t.Fatal("空指令不应调用 TShock")
	}
}

func TestStatusUnreachable(t *testing.T) {
	ts := httptest.NewServer(http.NotFoundHandler())
	url := ts.URL
	ts.Close() // 关闭以模拟不可达
	srv, _ := newServer(t, url, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/status", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d，期望 200", rec.Code)
	}
	var out struct {
		Reachable bool `json:"reachable"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Reachable {
		t.Fatalf("不可达时应 reachable=false：%s", rec.Body.String())
	}
}

func TestStatusReachableNormalizesVersion(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/v2/server/status": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{
				"name": "w", "serverversion": "v1.4.5.8", "tshockversion": "6.2.1.0",
				"port": 7777, "playercount": 0, "maxplayers": 8, "world": "w",
				"uptime": "0.00:00:18", "serverpassword": true,
			})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/status", nil, nil, false)
	var out struct {
		Reachable      bool   `json:"reachable"`
		ServerVersion  string `json:"serverversion"`
		Uptime         string `json:"uptime"`
		ServerPassword bool   `json:"serverpassword"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Reachable || out.ServerVersion != "1.4.5.8" {
		t.Fatalf("out = %+v", out)
	}
	if out.Uptime != "0.00:00:18" || !out.ServerPassword {
		t.Fatalf("uptime/serverpassword 未透传：%s", rec.Body.String())
	}
}

func TestPlayersRequiresAuthAndParses(t *testing.T) {
	f := newFake(okLoginRoutes())
	f.routes["/v2/players/list"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"players": []map[string]any{{"nickname": "Alice"}, {"nickname": "Bob"}}})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()

	unauth := do(h, http.MethodGet, "/api/players", nil, nil, false)
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("未登录 HTTP %d，期望 401", unauth.Code)
	}

	cookie := loginCookie(t, h, "alice", "pw")
	rec := do(h, http.MethodGet, "/api/players", nil, cookie, false)
	var out struct {
		Players []string `json:"players"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Players) != 2 || out.Players[0] != "Alice" {
		t.Fatalf("players = %v", out.Players)
	}
}

func TestHealthz(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	h := srv.Handler()

	rec := do(h, http.MethodGet, "/healthz", nil, nil, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("healthz: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"version":"test-1.0"`) {
		t.Fatalf("healthz 应带版本号: %s", rec.Body.String())
	}

	deep := do(h, http.MethodGet, "/healthz?deep=1", nil, nil, false)
	if deep.Code != http.StatusOK || !strings.Contains(deep.Body.String(), "tshock_reachable") {
		t.Fatalf("deep healthz: %d %s", deep.Code, deep.Body.String())
	}
	if !strings.Contains(deep.Body.String(), `"version":"test-1.0"`) {
		t.Fatalf("deep healthz 应带版本号: %s", deep.Body.String())
	}
}

func TestSecurityHeadersAndStatic(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	h := srv.Handler()

	rec := do(h, http.MethodGet, "/", nil, nil, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ok") {
		t.Fatalf("静态首页：%d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("缺少 nosniff")
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("缺少 CSP")
	}
}

var _ fs.FS = fstest.MapFS{}

func TestStaticFallbackAndMissingAssets(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	h := srv.Handler()

	// 前端路由（无扩展名）回退到 index.html。
	route := do(h, http.MethodGet, "/favorites", nil, nil, false)
	if route.Code != http.StatusOK || !strings.Contains(route.Body.String(), "ok") {
		t.Fatalf("SPA 路由回退失败：%d %s", route.Code, route.Body.String())
	}

	// 缺失的静态资源一律 404，不得回退成 index.html。
	for _, p := range []string{"/assets/missing.js", "/data/missing.json"} {
		rec := do(h, http.MethodGet, p, nil, nil, false)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s 应返回 404，实际 %d", p, rec.Code)
		}
	}
}

func TestServersEndpoint(t *testing.T) {
	ts := httptest.NewServer(http.NotFoundHandler())
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, func(c *config.Config) {
		c.TShockURL = "https://tc.example.com:9999"
		c.TShockAllowCustomTargets = true
	})
	rec := do(srv.Handler(), http.MethodGet, "/api/servers", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	var out struct {
		AllowCustom bool `json:"allowCustom"`
		Default     *struct {
			Scheme string `json:"scheme"`
			Host   string `json:"host"`
			Port   int    `json:"port"`
		} `json:"default"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.AllowCustom || out.Default == nil {
		t.Fatalf("servers = %s", rec.Body.String())
	}
	if out.Default.Scheme != "https" || out.Default.Host != "tc.example.com" || out.Default.Port != 9999 {
		t.Fatalf("default = %+v", out.Default)
	}
}

func TestPerRequestTargetRoutesToSelectedUpstream(t *testing.T) {
	fakeB := newFake(map[string]http.HandlerFunc{
		"/v2/server/status": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{
				"name": "B", "serverversion": "v1.4.5.8", "tshockversion": "6.2.1.0",
				"port": 7777, "playercount": 0, "maxplayers": 8, "world": "B",
			})
		},
	})
	tsB := httptest.NewServer(fakeB)
	defer tsB.Close()

	fakeA := newFake(map[string]http.HandlerFunc{
		"/v2/server/status": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"name": "A", "world": "A"})
		},
	})
	tsA := httptest.NewServer(fakeA)
	defer tsA.Close()

	srv, _ := newServer(t, tsA.URL, func(c *config.Config) { c.TShockAllowCustomTargets = true })
	h := srv.Handler()

	// 不带 header → 命中默认上游 A。
	do(h, http.MethodGet, "/api/status", nil, nil, false)
	if fakeA.count("/v2/server/status") != 1 || fakeB.count("/v2/server/status") != 0 {
		t.Fatalf("默认应命中 A：A=%d B=%d", fakeA.count("/v2/server/status"), fakeB.count("/v2/server/status"))
	}

	// 带 X-TSWUI-Target → 命中 B。
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("X-TSWUI-Target", tsB.URL)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if fakeB.count("/v2/server/status") != 1 || fakeA.count("/v2/server/status") != 1 {
		t.Fatalf("应命中 B：A=%d B=%d", fakeA.count("/v2/server/status"), fakeB.count("/v2/server/status"))
	}
	var out struct {
		World string `json:"world"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.World != "B" {
		t.Fatalf("world = %q body=%s", out.World, rec.Body.String())
	}
}

func TestCustomTargetDisabledOrInvalid(t *testing.T) {
	ts := httptest.NewServer(http.NotFoundHandler())
	defer ts.Close()

	// 未开启自定义：带 header 直接 400，且不发往 TShock。
	srvOff, _ := newServer(t, ts.URL, nil)
	reqOff := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	reqOff.Header.Set("X-TSWUI-Target", "http://127.0.0.1:7878")
	recOff := httptest.NewRecorder()
	srvOff.Handler().ServeHTTP(recOff, reqOff)
	if recOff.Code != http.StatusBadRequest {
		t.Fatalf("未开启时 HTTP %d，期望 400", recOff.Code)
	}

	// 开启但地址非法（带路径）：400。
	srvOn, _ := newServer(t, ts.URL, func(c *config.Config) { c.TShockAllowCustomTargets = true })
	reqBad := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	reqBad.Header.Set("X-TSWUI-Target", "http://host/evil")
	recBad := httptest.NewRecorder()
	srvOn.Handler().ServeHTTP(recBad, reqBad)
	if recBad.Code != http.StatusBadRequest {
		t.Fatalf("非法目标 HTTP %d，期望 400", recBad.Code)
	}
}

// ---------- 玩家管理（PlayerManager） ----------

func TestPlayerCapabilitiesPluginMissing(t *testing.T) {
	f := newFake(okLoginRoutes()) // 未注册 /pm/look → fake 回 404
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.PlayerCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Plugin || out.Permission {
		t.Fatalf("插件缺失时应 {plugin:false,permission:false}，实际 %+v", out)
	}
}

func TestPlayerCapabilitiesNoPermission(t *testing.T) {
	routes := okLoginRoutes()
	routes["/pm/look"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "未授权。用户没有权限使用指定的 API 终结点。"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.PlayerCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || out.Permission {
		t.Fatalf("应为 {plugin:true,permission:false}，实际 %+v", out)
	}
}

func TestPlayerLookRequiresAuth(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodGet, "/api/player/look?name=hf", nil, nil, false)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "not_authenticated") {
		t.Fatalf("HTTP %d body=%s，期望 401 not_authenticated", rec.Code, rec.Body.String())
	}
}

func TestPlayerLookSuccess(t *testing.T) {
	routes := okLoginRoutes()
	routes["/pm/look"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") != "hf" {
			t.Errorf("name = %q", r.URL.Query().Get("name"))
		}
		writeJSON(w, 200, map[string]any{
			"name": "hf", "online": 0, "health": 120, "maxHealth": 200,
			"mana": 20, "maxMana": 40, "inventory": "4956,1,0,0~0,0,0,0",
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/look?name=hf", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.PlayerLook
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Name != "hf" || out.Online || len(out.Items) != 2 || out.Items[0].ID != 4956 {
		t.Fatalf("look = %+v", out)
	}
}

func TestPlayerLookPluginMissing(t *testing.T) {
	f := newFake(okLoginRoutes()) // /pm/look → 404
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/look?name=hf", nil, cookie, false)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_not_installed") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_not_installed", rec.Code, rec.Body.String())
	}
}

func TestPlayerExportStreamsFile(t *testing.T) {
	want := []byte("PLR-binary-data")
	routes := okLoginRoutes()
	routes["/pm/export"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"base64s": []string{base64.StdEncoding.EncodeToString(want)}})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/export?name=hf", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.Bytes(); string(got) != string(want) {
		t.Fatalf("body = %q，期望 %q", got, want)
	}
	cd := rec.Header().Get("Content-Disposition")
	if !strings.Contains(cd, "attachment") || !strings.Contains(cd, "hf.plr") {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}
}

func TestPlayerExportPluginMissing(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/player/export?name=hf", nil, cookie, false)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_not_installed") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_not_installed", rec.Code, rec.Body.String())
	}
}

// 未知 /api/* 必须返回 JSON 404，不能回退到 SPA（否则前端把 HTML 当 JSON 解析 → 页面空白）。
func TestUnknownAPIPathReturnsJSON404(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodGet, "/api/nope", nil, nil, false)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("HTTP %d，期望 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q，期望 JSON", ct)
	}
	if !strings.Contains(rec.Body.String(), "not_found") {
		t.Fatalf("body = %s，期望 not_found", rec.Body.String())
	}
}

// ---------- 鱼店（第三方插件 FishShop） ----------

func TestFishCapabilitiesPluginMissing(t *testing.T) {
	// 未注册 /fishshop/list → fake 回 404；rawcmd 也 404 → 判「未安装」。
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Plugin || out.REST || out.Permission {
		t.Fatalf("插件缺失时应全部 false，实际 %+v", out)
	}
}

// 老版本插件（v1.6.2 之前）只有游戏内指令：/fishshop/list 404 但 /fish 能跑 → plugin:true, rest:false。
func TestFishCapabilitiesOldPluginHasNoREST(t *testing.T) {
	routes := okLoginRoutes()
	routes["/v3/server/rawcmd"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": 200, "response": []string{"/fish list，查看货架"}})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || out.REST || out.Permission {
		t.Fatalf("老版本插件应为 {plugin:true, rest:false, permission:false}，实际 %+v", out)
	}
}

func TestFishCapabilitiesNoPermission(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/list"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 403, map[string]any{"error": "未授权。用户没有权限使用指定的 API 终结点。"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || !out.REST || out.Permission {
		t.Fatalf("应为 {plugin:true, rest:true, permission:false}，实际 %+v", out)
	}
}

// 业务失败（商店打烊）也是上游 400：端点存在、权限通过 → 探测仍通过，
// 上游文案交给 /api/fish/list 原样展示（不再误报「无法检测鱼店插件」）。
func TestFishCapabilitiesBusinessFailureStillPresent(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/list"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"status": 400, "error": "商店打烊"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/capabilities", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishCapability
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Plugin || !out.REST || !out.Permission {
		t.Fatalf("应为 {plugin:true, rest:true, permission:true}，实际 %+v", out)
	}

	// 同一次探针端点被复用：货架接口应把「商店打烊」原样带给前端。
	list := do(h, http.MethodGet, "/api/fish/list", nil, cookie, false)
	if list.Code != http.StatusBadRequest || !strings.Contains(list.Body.String(), "商店打烊") {
		t.Fatalf("HTTP %d body=%s，期望 400 + 商店打烊", list.Code, list.Body.String())
	}
}

// 上游新字段必须原样透传到 /api/fish/list（前端靠它们显示限购 / 冷却 / 时机 / 检查）。
// 这里按「上游 JSON 字面量」校验，字段名写错会立刻红。
func TestFishListPassesThroughStructuredFields(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/list"] = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":200,"response":{"name":"鱼店","total":1,"goods":[{
			"serial":1,"name":"生命水晶","icon":"[i:29]","buyMax":999,"needArgs":false,"map":["物品"],
			"desc":"[i:29] 生命水晶","cost":"5 金币","unlock":"","comment":"",
			"allowGroup":["GM"],"allowPlayers":[],"denyPlayers":[],
			"id":29,"stack":5,"prefix":0,"iconId":29,"argCount":0,
			"costMoney":500,"costItems":[{"id":29,"stack":3}],"check":"需先击败骷髅王",
			"limit":3,"serverLimit":10,"cd":60,"serverCd":30,
			"needAlive":true,"needDay":false,"needNight":true}]}}`))
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/list", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Name  string `json:"name"`
		Goods []struct {
			IconID    int   `json:"iconId"`
			ArgCount  int   `json:"argCount"`
			CostMoney int64 `json:"costMoney"`
			CostItems []struct {
				ID    int `json:"id"`
				Stack int `json:"stack"`
			} `json:"costItems"`
			Check       string `json:"check"`
			Limit       int    `json:"limit"`
			ServerLimit int    `json:"serverLimit"`
			CD          int    `json:"cd"`
			ServerCD    int    `json:"serverCd"`
			NeedAlive   bool   `json:"needAlive"`
			NeedDay     bool   `json:"needDay"`
			NeedNight   bool   `json:"needNight"`
		} `json:"goods"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	g := out.Goods[0]
	if g.IconID != 29 || g.ArgCount != 0 || g.CostMoney != 500 {
		t.Fatalf("g = %+v", g)
	}
	if len(g.CostItems) != 1 || g.CostItems[0].ID != 29 || g.CostItems[0].Stack != 3 {
		t.Fatalf("costItems = %+v", g.CostItems)
	}
	if g.Check != "需先击败骷髅王" || g.Limit != 3 || g.ServerLimit != 10 || g.CD != 60 || g.ServerCD != 30 {
		t.Fatalf("check/limit = %+v", g)
	}
	if !g.NeedAlive || g.NeedDay || !g.NeedNight {
		t.Fatalf("timing = %+v", g)
	}
}

func TestFishListSuccess(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/list"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status": 200,
			"response": map[string]any{
				"name": "鱼店", "total": 1,
				"goods": []map[string]any{{"serial": 1, "name": "生命水晶", "cost": "5 金币"}},
			},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/list", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishShop
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Name != "鱼店" || len(out.Goods) != 1 || out.Goods[0].Serial != 1 {
		t.Fatalf("shop = %+v", out)
	}
}

// ?self=1 必须透传到上游；不带时不带（否则上游会要求玩家在线，普通查询会莫名 400）。
func TestFishListPassesSelfParam(t *testing.T) {
	var seen []string
	routes := okLoginRoutes()
	routes["/fishshop/list"] = func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.Query().Get("self"))
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"name": "鱼店", "total": 0, "goods": []map[string]any{}},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	for _, path := range []string{"/api/fish/list?self=1", "/api/fish/list", "/api/fish/list?self=0"} {
		if rec := do(h, http.MethodGet, path, nil, cookie, false); rec.Code != http.StatusOK {
			t.Fatalf("%s → HTTP %d body=%s", path, rec.Code, rec.Body.String())
		}
	}
	want := []string{"1", "", ""}
	for i, w := range want {
		if seen[i] != w {
			t.Fatalf("self 序列 = %v，期望 %v", seen, want)
		}
	}
}

// /api/fish/ask：serial 必填；上游 response 的 `shop`（店名）要原样透传。
func TestFishAskRequiresSerial(t *testing.T) {
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	for _, path := range []string{"/api/fish/ask", "/api/fish/ask?serial=0", "/api/fish/ask?serial=x"} {
		rec := do(h, http.MethodGet, path, nil, cookie, false)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "bad_request") {
			t.Fatalf("%s → HTTP %d body=%s，期望 400 bad_request", path, rec.Code, rec.Body.String())
		}
	}
}

func TestFishAskPassesShopName(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/ask"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"serial": 1, "name": "生命水晶", "shop": "hf 的鱼店", "limit": 3, "argCount": 0},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/fish/ask?serial=1", nil, cookie, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out tshock.FishGood
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if out.Shop != "hf 的鱼店" || out.Limit != 3 {
		t.Fatalf("out = %+v", out)
	}
}

// 业务失败（钱不够）必须保留上游文案，返回 400 fishshop_error。
func TestFishBuyBusinessErrorKeepsMessage(t *testing.T) {
	routes := okLoginRoutes()
	routes["/fishshop/buy"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"status": 400, "error": "钱不够"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/fish/buy", map[string]any{"serial": 3, "amount": 5}, cookie, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("HTTP %d body=%s，期望 400", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "fishshop_error") || !strings.Contains(rec.Body.String(), "钱不够") {
		t.Fatalf("body = %s，期望 fishshop_error + 钱不够", rec.Body.String())
	}
}

// 购买是非 GET 请求：缺少 X-Requested-With 必须被 CSRF 中间件拒绝。
func TestFishBuyRequiresCSRFHeader(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/fish/buy", map[string]any{"serial": 1}, nil, false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP %d，期望 403 CSRF", rec.Code)
	}
}

// ---------- 在线授权登录（WebUI 信使插件） ----------

func TestWebAuthCapabilitiesDetectsPlugin(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		// 空 name 时插件返回 missing_name，说明端点存在。
		"/webui/auth/request": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]any{"status": "200", "code": "missing_name", "message": "缺少 name 参数"})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/webauth/capabilities", nil, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"plugin":true`) {
		t.Fatalf("body = %s，期望 plugin=true", rec.Body.String())
	}
}

func TestWebAuthCapabilitiesMissingPlugin(t *testing.T) {
	// newFake 未登记的路径一律 404 → 视为未安装插件。
	f := newFake(nil)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/webauth/capabilities", nil, nil, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plugin":false`) {
		t.Fatalf("HTTP %d body=%s，期望 plugin=false", rec.Code, rec.Body.String())
	}
}

func TestLoginOnlineApprovedCreatesSession(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/auth/request"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") != "Alice" {
			t.Errorf("name = %q", r.URL.Query().Get("name"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "code": "ok", "ticket": "123456", "expires": 60, "username": "Alice",
		})
	}
	routes["/webui/auth/poll"] = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("ticket") != "123456" {
			t.Errorf("ticket = %q", r.URL.Query().Get("ticket"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "code": "ok", "state": "approved", "username": "Alice", "token": "tok-online",
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, store := newServer(t, ts.URL, nil)
	h := srv.Handler()

	rec := do(h, http.MethodPost, "/api/login/online", map[string]string{"username": "Alice"}, nil, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s，期望 200", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Alice") {
		t.Fatalf("body = %s", rec.Body.String())
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "tswui_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("未下发会话 Cookie")
	}
	if store.Len() != 1 {
		t.Fatalf("会话数 = %d，期望 1", store.Len())
	}

	// 会话有效：/api/session 会经 /tokentest 校验 token。
	rec2 := do(h, http.MethodGet, "/api/session", nil, cookie, false)
	if !strings.Contains(rec2.Body.String(), `"authenticated":true`) {
		t.Fatalf("session body = %s", rec2.Body.String())
	}
}

func TestLoginOnlinePlayerOffline(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/auth/request"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "offline", "message": "该玩家不在线"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login/online", map[string]string{"username": "Ghost"}, nil, true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("HTTP %d body=%s，期望 404", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "player_offline") || !strings.Contains(rec.Body.String(), "该玩家不在线") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestLoginOnlinePluginMissing(t *testing.T) {
	f := newFake(nil)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login/online", map[string]string{"username": "Alice"}, nil, true)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_not_installed") {
		t.Fatalf("HTTP %d body=%s，期望 501 plugin_not_installed", rec.Code, rec.Body.String())
	}
}

func TestLoginOnlineDenied(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/auth/request"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "ok", "ticket": "654321", "expires": 60})
	}
	routes["/webui/auth/poll"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "200", "code": "ok", "state": "denied"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodPost, "/api/login/online", map[string]string{"username": "Alice"}, nil, true)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "online_auth_denied") {
		t.Fatalf("HTTP %d body=%s，期望 403 online_auth_denied", rec.Code, rec.Body.String())
	}
}

func TestLoginOnlineRequiresCSRFHeader(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/login/online", map[string]string{"username": "Alice"}, nil, false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP %d，期望 403 CSRF", rec.Code)
	}
}

// ---------- 批量执行（WebUI /webui/batch） ----------

func TestBatchRunsPluginAndMapsResults(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/batch"] = func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("token") != "tok-1" {
			t.Errorf("token = %q", q.Get("token"))
		}
		var cmds []string
		if err := json.Unmarshal([]byte(q.Get("cmds")), &cmds); err != nil {
			t.Fatalf("cmds: %v", err)
		}
		if len(cmds) != 2 || cmds[0] != "/who" || cmds[1] != "/time" {
			t.Fatalf("cmds = %v", cmds)
		}
		writeJSON(w, 200, map[string]any{
			"status": "200",
			"results": []map[string]any{
				{"cmd": "/who", "output": []string{"在线玩家: Alice"}},
				{"cmd": "/time", "output": []string{"世界时间：8:30"}},
			},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/batch", map[string]any{"cmds": []string{"/who", "/time"}}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Results []tshock.Result `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败：%v body=%s", err, rec.Body.String())
	}
	if len(out.Results) != 2 {
		t.Fatalf("results = %+v", out.Results)
	}
	if out.Results[0].Status != tshock.StatusOK || out.Results[1].Status != tshock.StatusOK {
		t.Fatalf("results = %+v", out.Results)
	}
}

// allowServer=false 的指令在本地就被拒绝（Tier A），不发给插件。
func TestBatchRejectsAllowServerFalseLocally(t *testing.T) {
	routes := okLoginRoutes()
	var sentCmds []string
	routes["/webui/batch"] = func(w http.ResponseWriter, r *http.Request) {
		_ = json.Unmarshal([]byte(r.URL.Query().Get("cmds")), &sentCmds)
		writeJSON(w, 200, map[string]any{
			"status": "200",
			"results": []map[string]any{
				{"cmd": "/who", "output": []string{"在线玩家: Alice"}},
			},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/batch", map[string]any{"cmds": []string{"/who", "/i 1"}}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if len(sentCmds) != 1 || sentCmds[0] != "/who" {
		t.Fatalf("发给插件的指令 = %v（/i 不应发出）", sentCmds)
	}
	var out struct {
		Results []tshock.Result `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Results) != 2 {
		t.Fatalf("results = %+v", out.Results)
	}
	if out.Results[0].Status != tshock.StatusOK {
		t.Fatalf("results[0] = %+v", out.Results[0])
	}
	if out.Results[1].Status != tshock.StatusRejected {
		t.Fatalf("results[1] = %+v（期望 rejected）", out.Results[1])
	}
}

func TestBatchPluginMissing(t *testing.T) {
	// 有登录路由，但没有 /webui/batch → 视为未安装插件。
	f := newFake(okLoginRoutes())
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/batch", map[string]any{"cmds": []string{"/who"}}, cookie, true)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "plugin_not_installed") {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatchCapabilitiesDetectsPlugin(t *testing.T) {
	f := newFake(map[string]http.HandlerFunc{
		"/webui/batch": func(w http.ResponseWriter, _ *http.Request) {
			// 无 token → 401，说明端点存在。
			writeJSON(w, 401, map[string]any{"error": "需要令牌"})
		},
	})
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/batch/capabilities", nil, nil, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plugin":true`) {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatchCapabilitiesMissingPlugin(t *testing.T) {
	f := newFake(nil)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)

	rec := do(srv.Handler(), http.MethodGet, "/api/batch/capabilities", nil, nil, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plugin":false`) {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatchRequiresCSRFHeader(t *testing.T) {
	srv, _ := newServer(t, "http://127.0.0.1:1", nil)
	rec := do(srv.Handler(), http.MethodPost, "/api/batch", map[string]any{"cmds": []string{"/who"}}, nil, false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP %d，期望 403 CSRF", rec.Code)
	}
}

// ---------- 信使插件只读信息 ----------

func TestRuntimeCommandsEndpoint(t *testing.T) {
	routes := okLoginRoutes()
	routes["/webui/commands"] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status": "200",
			"commands": []map[string]any{
				{"name": "fish", "aliases": []string{}, "permissions": []string{}, "allowServer": true, "help": "鱼店"},
			},
		})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodGet, "/api/commands", nil, cookie, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "fish") {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
}

// Tier B：开启 TSWUI_ALLOW_INGAME_COMMANDS 后，allowServer=false 的指令走插件 player 模式。
func TestCommandIngameRouting(t *testing.T) {
	routes := okLoginRoutes()
	var mode string
	routes["/webui/batch"] = func(w http.ResponseWriter, r *http.Request) {
		mode = r.URL.Query().Get("mode")
		writeJSON(w, 200, map[string]any{"status": "200", "code": "player_offline", "error": "该玩家不在线"})
	}
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, func(c *config.Config) { c.AllowIngameCommands = true })
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]any{"cmd": "/i 1"}, cookie, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if mode != "player" {
		t.Fatalf("mode = %q，期望 player", mode)
	}
	if !strings.Contains(rec.Body.String(), "该玩家不在线") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// 未开启时仍按 Tier A 拒绝，不发往插件。
func TestCommandIngameDisabled(t *testing.T) {
	routes := okLoginRoutes()
	f := newFake(routes)
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	rec := do(h, http.MethodPost, "/api/command", map[string]any{"cmd": "/i 1"}, cookie, true)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "rejected") {
		t.Fatalf("HTTP %d body=%s", rec.Code, rec.Body.String())
	}
	if f.count("/webui/batch") != 0 {
		t.Fatalf("未开启时不应调用插件 /webui/batch")
	}
}

// newServerWithWeb 构造一个用自定义静态资源表（fstest.MapFS）的 Server。
func newServerWithWeb(t *testing.T, web fs.FS) *api.Server {
	t.Helper()
	cfg := config.Default()
	cfg.TShockURL = "http://127.0.0.1:1"
	cfg.TShockTimeout = 2 * time.Second
	return api.New(api.Deps{
		Config:   cfg,
		Version:  "test-1.0",
		Sessions: session.New(cfg.SessionTTL, cfg.MaxSessions),
		TShock:   tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, testLogger()),
		Commands: tshock.DefaultCommands(),
		Web:      web,
		Logger:   testLogger(),
	})
}

func doWithHeader(h http.Handler, method, path, key, value string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set(key, value)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// /data/*.json 必须带 ETag + no-cache：升级后不会继续用一小时的旧 commands.json，
// 未变化时回 304 省流量（见 docs/TODO.md P2）。
func TestDataJSONETagAnd304(t *testing.T) {
	web := func(body string) fs.FS {
		return fstest.MapFS{
			"index.html":            &fstest.MapFile{Data: []byte("ok")},
			"data/commands.json":    &fstest.MapFile{Data: []byte(body)},
			"data/player-atlas.png": &fstest.MapFile{Data: []byte("PNG")},
			"assets/app-1.js":       &fstest.MapFile{Data: []byte("js")},
		}
	}
	h := newServerWithWeb(t, web(`{"a":1}`)).Handler()

	first := do(h, http.MethodGet, "/data/commands.json", nil, nil, false)
	if first.Code != http.StatusOK {
		t.Fatalf("HTTP %d", first.Code)
	}
	if got := first.Body.String(); got != `{"a":1}` {
		t.Fatalf("body = %q", got)
	}
	etag := first.Header().Get("ETag")
	if !strings.HasPrefix(etag, `W/"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("ETag = %q，期望弱 ETag（W/\"内容哈希\"）", etag)
	}
	if cc := first.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("Cache-Control = %q，期望 no-cache", cc)
	}
	if ct := first.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q", ct)
	}

	// 带同一个 ETag 再请求 → 304，且没有响应体。
	same := doWithHeader(h, http.MethodGet, "/data/commands.json", "If-None-Match", etag)
	if same.Code != http.StatusNotModified {
		t.Fatalf("命中 ETag 应 304，实际 %d", same.Code)
	}
	if same.Body.Len() != 0 {
		t.Fatalf("304 不应带响应体，实际 %q", same.Body.String())
	}

	// 内容变了（换一份静态资源表）→ ETag 必须变，并且回 200 + 新内容。
	h2 := newServerWithWeb(t, web(`{"a":2}`)).Handler()
	changed := doWithHeader(h2, http.MethodGet, "/data/commands.json", "If-None-Match", etag)
	if changed.Code != http.StatusOK {
		t.Fatalf("内容变化后应 200，实际 %d", changed.Code)
	}
	if changed.Header().Get("ETag") == etag {
		t.Fatal("内容变化后 ETag 不应相同")
	}
	if got := changed.Body.String(); got != `{"a":2}` {
		t.Fatalf("body = %q", got)
	}

	// 其他静态资源的缓存语义不变：图集 PNG 长缓存、/assets/* immutable。
	if cc := do(h, http.MethodGet, "/data/player-atlas.png", nil, nil, false).Header().Get("Cache-Control"); cc != "public, max-age=604800" {
		t.Fatalf("图集 PNG Cache-Control = %q", cc)
	}
	if cc := do(h, http.MethodGet, "/assets/app-1.js", nil, nil, false).Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("/assets Cache-Control = %q", cc)
	}

	// HEAD 也要给 ETag（浏览器/代理用它做校验）。
	head := do(h, http.MethodHead, "/data/commands.json", nil, nil, false)
	if head.Code != http.StatusOK || head.Header().Get("ETag") != etag {
		t.Fatalf("HEAD: %d ETag=%q", head.Code, head.Header().Get("ETag"))
	}
}

// TestEventsInstancePassthrough：/api/events 透传插件事件库的实例标识；
// 同一个地址 / 端口换了服（instance 变化）时，后端必须作废旧缓存，
// 后续 /api/serverinfo 不能继续返回旧服的世界状态。
func TestEventsInstancePassthrough(t *testing.T) {
	f := newFake(okLoginRoutes())
	var mu sync.Mutex
	instance := "A"
	worldName := "旧服"
	f.routes["/webui/events"] = func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		inst := instance
		mu.Unlock()
		writeJSON(w, 200, map[string]any{"events": []any{}, "lastSeq": 1, "instance": inst})
	}
	f.routes["/webui/serverinfo"] = func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		name := worldName
		mu.Unlock()
		writeJSON(w, 200, map[string]any{"name": name, "worldId": 1})
	}
	ts := httptest.NewServer(f)
	defer ts.Close()
	srv, _ := newServer(t, ts.URL, nil)
	h := srv.Handler()
	cookie := loginCookie(t, h, "alice", "pw")

	// 先让后端把旧服的世界状态缓存下来。
	rec := do(h, http.MethodGet, "/api/serverinfo", nil, cookie, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "旧服") {
		t.Fatalf("serverinfo 首次：HTTP %d %s", rec.Code, rec.Body.String())
	}

	rec = do(h, http.MethodGet, "/api/events?since=0", nil, cookie, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"instance":"A"`) {
		t.Fatalf("events 应透传 instance：HTTP %d %s", rec.Code, rec.Body.String())
	}

	// 同地址换了一个服：instance 变了，世界状态也应立刻重新拉取。
	mu.Lock()
	instance = "B"
	worldName = "新服"
	mu.Unlock()

	rec = do(h, http.MethodGet, "/api/events?since=1", nil, cookie, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"instance":"B"`) {
		t.Fatalf("events 应透传新 instance：HTTP %d %s", rec.Code, rec.Body.String())
	}
	rec = do(h, http.MethodGet, "/api/serverinfo", nil, cookie, false)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "新服") {
		t.Fatalf("换服后 serverinfo 仍是旧缓存：HTTP %d %s", rec.Code, rec.Body.String())
	}
}
