package api

import (
	"compress/gzip"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ---------- 安全响应头 ----------

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		// frame-ancestors 只认响应头（浏览器忽略 meta 里的同名指令），而 default-src
		// 不覆盖它 —— 少这一条浏览器默认允许被任意站点 iframe 嵌入，配上「一键执行指令」
		// 的界面就是点击劫持。X-Frame-Options 只是给不认 CSP 的老浏览器兜底。
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "+
				"script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; "+
				"object-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

// ---------- CSRF ----------

// csrf 要求所有非 GET/HEAD 的 /api/* 请求带 X-Requested-With: tswui，
// 与 SameSite=Strict Cookie 共同防跨站提交（API_SPEC §9）。
func (s *Server) csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isUnsafeMethod(r.Method) && strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Header.Get("X-Requested-With") != "tswui" {
				writeError(w, http.StatusForbidden, codeCSRF, "缺少 X-Requested-With 请求头")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isUnsafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}

// ---------- 访问日志（绝不记录 query / body） ----------

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

// Unwrap 让 http.NewResponseController 能穿透该包装器拿到
// 底层的 Flush / SetWriteDeadline 能力（SSE 需要）。
func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		// r.URL.Path 不含 query；token / 密码绝不会进日志。
		s.log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// ---------- gzip ----------

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// SSE 长连接绝不能 gzip 包装（会缓冲、破坏实时性）。
		if r.URL.Path == "/api/events/stream" {
			next.ServeHTTP(w, r)
			return
		}
		if !acceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipResponseWriter{ResponseWriter: w}
		defer func() {
			if gw.gz != nil {
				_ = gw.gz.Close()
			}
		}()
		next.ServeHTTP(gw, r)
	})
}

func acceptsGzip(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept-Encoding"), "gzip")
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if g.wroteHeader {
		return
	}
	g.wroteHeader = true
	h := g.Header()
	if code == http.StatusOK && isCompressible(h.Get("Content-Type")) {
		h.Del("Content-Length")
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		g.gz = gzip.NewWriter(g.ResponseWriter)
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if g.gz != nil {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func isCompressible(contentType string) bool {
	if contentType == "" {
		return false
	}
	ct := strings.ToLower(contentType)
	for _, prefix := range []string{
		"text/", "application/json", "application/javascript",
		"application/xml", "image/svg+xml", "application/manifest+json",
	} {
		if strings.HasPrefix(ct, prefix) {
			return true
		}
	}
	return false
}

// ---------- 限流（固定窗口，key 由调用方决定） ----------
//
// 两个实例：登录按来源 IP，指令执行按会话 ID（每个已登录玩家一个桶，
// 避免经反代后所有玩家共用同一个 IP 而互相限流）。

type rateLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	now     func() time.Time
	buckets map[string]*limiterBucket
}

type limiterBucket struct {
	start time.Time
	count int
}

func newRateLimiter(max int) *rateLimiter {
	return &rateLimiter{
		max:     max,
		window:  time.Minute,
		now:     time.Now,
		buckets: make(map[string]*limiterBucket),
	}
}

// Allow 返回该 key 本轮窗口是否仍有额度。
func (l *rateLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	// 机会式清理过期桶，避免 map 无限增长。
	for k, b := range l.buckets {
		if now.Sub(b.start) >= l.window {
			delete(l.buckets, k)
		}
	}

	b, ok := l.buckets[key]
	if !ok || now.Sub(b.start) >= l.window {
		l.buckets[key] = &limiterBucket{start: now, count: 1}
		return true
	}
	if b.count >= l.max {
		return false
	}
	b.count++
	return true
}

// clientIP 依据 TRUST_PROXY 决定是否信任 X-Forwarded-For（取哪一段见 xffClientIP）。
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if ip := xffClientIP(r.Header.Get("X-Forwarded-For"), s.cfg.TrustProxyHops); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// xffClientIP 从 X-Forwarded-For 里取真实客户端 IP，取不到就返回空串（交 RemoteAddr 兜底）。
//
// XFF 是逐跳**追加**的链：nginx 的 $proxy_add_x_forwarded_for 等于
// 「客户端带来的整段 + 自己的 $remote_addr」。所以**最左段是客户端自带的**，可以随便伪造——
// 按最左段限流，攻击者每次换个值就能绕过 LOGIN_MAX_PER_MIN 的按 IP 计数（也是唯一的口令爆破防线），
// 伪造值还会经 /api/login/online 透传给信使插件做限流。
//
// 正确做法是从右往左跳过自己可控的代理层：hops 是自己可控的层数（默认 1，CDN+反代时设 2），
// 越过的第一个地址才是真实来源。链比 hops 短说明请求没经过预期的代理（或配置不符），
// 此时返回空串、退回 RemoteAddr，绝不猜。
func xffClientIP(header string, hops int) string {
	if header == "" {
		return ""
	}
	if hops < 1 {
		hops = 1
	}
	parts := strings.Split(header, ",")
	if len(parts) < hops {
		return ""
	}
	ip := strings.TrimSpace(parts[len(parts)-hops])
	if net.ParseIP(ip) == nil {
		return ""
	}
	return ip
}
