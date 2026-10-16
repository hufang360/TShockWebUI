package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tshockwebui/server/internal/config"
)

func TestRateLimiter(t *testing.T) {
	l := newRateLimiter(2)
	now := time.Unix(1_700_000_000, 0)
	l.now = func() time.Time { return now }

	if !l.Allow("1.2.3.4") || !l.Allow("1.2.3.4") {
		t.Fatal("前两次应放行")
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("第三次应被限流")
	}
	if !l.Allow("5.6.7.8") {
		t.Fatal("不同 key 应独立计数")
	}

	// 窗口过后重置。
	now = now.Add(61 * time.Second)
	if !l.Allow("1.2.3.4") {
		t.Fatal("窗口过后应放行")
	}
}

func TestClientIP(t *testing.T) {
	s := &Server{cfg: config.Config{TrustProxy: false}}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:5555"
	r.Header.Set("X-Forwarded-For", "8.8.8.8, 9.9.9.9")
	if got := s.clientIP(r); got != "10.0.0.1" {
		t.Fatalf("不信任代理时应使用 RemoteAddr，得到 %q", got)
	}

	s.cfg.TrustProxy = true
	if got := s.clientIP(r); got != "8.8.8.8" {
		t.Fatalf("信任代理时应取 XFF 第一段，得到 %q", got)
	}

	r.RemoteAddr = "not-a-hostport"
	r.Header.Del("X-Forwarded-For")
	if got := s.clientIP(r); got != "not-a-hostport" {
		t.Fatalf("无法解析时应回退原值，得到 %q", got)
	}
}

func TestIsCompressible(t *testing.T) {
	yes := []string{"text/html", "application/json; charset=utf-8", "application/javascript", "image/svg+xml"}
	no := []string{"", "image/png", "application/octet-stream", "font/woff2"}
	for _, ct := range yes {
		if !isCompressible(ct) {
			t.Errorf("%q 应可压缩", ct)
		}
	}
	for _, ct := range no {
		if isCompressible(ct) {
			t.Errorf("%q 不应压缩", ct)
		}
	}
}

func TestGzipMiddleware(t *testing.T) {
	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(w, `{"hello":"world","pad":"`+strings.Repeat("x", 500)+`"}`)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("应 gzip，headers=%v", rec.Header())
	}
	if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatal("应设置 Vary: Accept-Encoding")
	}
	gr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip 解码失败：%v", err)
	}
	body, _ := io.ReadAll(gr)
	if !strings.Contains(string(body), `"hello":"world"`) {
		t.Fatalf("解码后内容错误：%s", body)
	}
}

func TestGzipSkipsBinary(t *testing.T) {
	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNGDATA"))
	}))
	req := httptest.NewRequest(http.MethodGet, "/data/items-atlas.png", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("二进制不应 gzip")
	}
	if rec.Body.String() != "PNGDATA" {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

func TestCSRFMiddleware(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := (&Server{}).csrf(next)

	// GET 不需要 CSRF。
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/session", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET 应放行，得到 %d", rec.Code)
	}

	// POST 缺头 → 403。
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/command", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST 缺 CSRF 应 403，得到 %d", rec.Code)
	}

	// POST 带头 → 放行。
	req := httptest.NewRequest(http.MethodPost, "/api/command", nil)
	req.Header.Set("X-Requested-With", "tswui")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("带 CSRF 应放行，得到 %d", rec.Code)
	}
}
