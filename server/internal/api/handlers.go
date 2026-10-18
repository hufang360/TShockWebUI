// Package api 实现 /api/* 契约（docs/API_SPEC.md）、静态资源服务与中间件。
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

// 错误码（API_SPEC §0）。
const (
	codeCSRF             = "csrf"
	codeNotAuthenticated = "not_authenticated"
	codeTokenInvalid     = "token_invalid"
	codeBadCredentials   = "bad_credentials"
	codeNoAPIPermission  = "no_api_permission"
	codeNoPermission     = "no_permission"
	codeRateLimited      = "rate_limited"
	codeTShockUnavail    = "tshock_unavailable"
	codeTShockTimeout    = "tshock_timeout"
	codeBadResponse      = "bad_response"
	codeBadRequest       = "bad_request"
	codeNotFound         = "not_found"
	codeMethodNotAllowed = "method_not_allowed"
	codeServerError      = "server_error"
	// codePluginMissing：上游插件未安装（TShock 对未知端点返回 404）；对前端返回 501 未实现。
	// （目前只有 PlayerManager 的 /pm/*）。
	codePluginMissing = "plugin_not_installed"
	// codePluginOutdated：信使插件在装，但缺少该端点 / 能力（版本过旧）；需升级插件。
	codePluginOutdated = "plugin_outdated"
	// codePluginProtocol：信使插件与后端协议不兼容；需升级插件或后端。
	codePluginProtocol = "plugin_protocol_mismatch"
	// codeFishError：FishShop 的业务失败（缺参数 / 商品不存在 / 钱不够 /
	// 商店打烊），文案来自上游，直接展示给玩家。
	codeFishError = "fishshop_error"
	// 「在线授权」登录相关错误码。
	codePlayerOffline     = "player_offline"
	codeOnlineAuthDenied  = "online_auth_denied"
	codeOnlineAuthTimeout = "online_auth_timeout"
	codeOnlineAuthError   = "online_auth_error"
)

const sessionCookieName = "tswui_session"

// Deps 是 Server 的依赖集合。
type Deps struct {
	Config   config.Config
	Version  string // 构建版本号（ldflags 注入），空值时回退为 "dev"
	Sessions *session.Store
	TShock   *tshock.Client
	Commands *tshock.CommandIndex
	Web      fs.FS
	Logger   *slog.Logger
}

// Server 持有全部依赖并提供 http.Handler。
type Server struct {
	cfg            config.Config
	version        string
	sessions       *session.Store
	tshock         *tshock.Client
	commands       *tshock.CommandIndex
	web            fs.FS
	log            *slog.Logger
	loginLimiter   *rateLimiter
	commandLimiter *rateLimiter

	// 服务器动态：每个上游一个共享轮询 hub（见 feedhub.go）。
	hubMu sync.Mutex
	hubs  map[string]*eventHub

	// 插件 meta 短缓存：避免每次 tail / 状态探测都打插件。
	metaMu    sync.Mutex
	metaCache map[string]metaCacheEntry
}

type metaCacheEntry struct {
	meta *tshock.PluginMeta
	at   time.Time
}

// New 构造 Server。
func New(d Deps) *Server {
	log := d.Logger
	if log == nil {
		log = slog.Default()
	}
	version := d.Version
	if version == "" {
		version = "dev"
	}
	return &Server{
		cfg:            d.Config,
		version:        version,
		sessions:       d.Sessions,
		tshock:         d.TShock,
		commands:       d.Commands,
		web:            d.Web,
		log:            log,
		loginLimiter:   newRateLimiter(d.Config.LoginMaxPerMin),
		commandLimiter: newRateLimiter(d.Config.CommandMaxPerMin),
		hubs:           map[string]*eventHub{},
		metaCache:      map[string]metaCacheEntry{},
	}
}

// Handler 返回装配好中间件的处理器。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/login/online", s.handleLoginOnline)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/session", s.handleSession)
	mux.HandleFunc("GET /api/webauth/capabilities", s.handleWebAuthCapabilities)
	mux.HandleFunc("GET /api/plugin/status", s.handlePluginStatus)
	mux.HandleFunc("GET /api/servers", s.handleServers)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/players", s.handlePlayers)
	mux.HandleFunc("GET /api/player/capabilities", s.handlePlayerCapabilities)
	mux.HandleFunc("GET /api/player/look", s.handlePlayerLook)
	mux.HandleFunc("GET /api/player/export", s.handlePlayerExport)
	mux.HandleFunc("POST /api/player/import", s.handlePlayerImport)
	mux.HandleFunc("GET /api/fish/capabilities", s.handleFishCapabilities)
	mux.HandleFunc("GET /api/fish/list", s.handleFishList)
	mux.HandleFunc("GET /api/fish/ask", s.handleFishAsk)
	mux.HandleFunc("POST /api/fish/buy", s.handleFishBuy)
	mux.HandleFunc("POST /api/command", s.handleCommand)
	mux.HandleFunc("POST /api/batch", s.handleBatch)
	mux.HandleFunc("GET /api/batch/capabilities", s.handleBatchCapabilities)
	// 信使插件只读信息 / 会话管理。
	mux.HandleFunc("GET /api/commands", s.handleRuntimeCommands)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/data", s.handleData)
	mux.HandleFunc("GET /api/serverinfo", s.handleServerInfo)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /api/events/stream", s.handleEventsStream)
	mux.HandleFunc("POST /api/chat", s.handleChat)
	mux.HandleFunc("GET /api/sessions", s.handleSessions)
	mux.HandleFunc("POST /api/sessions/revoke", s.handleRevokeSessions)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	// 未知的 /api/* 一律返回 JSON 404，绝不回退到 SPA（index.html），
	// 否则前端会把 HTML 当 JSON 解析，表现为“页面空白”。
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, codeNotFound, "接口不存在")
	})
	mux.Handle("/", s.staticHandler())

	var h http.Handler = mux
	h = s.csrf(h)
	h = gzipMiddleware(h)
	h = s.accessLog(h)
	h = s.securityHeaders(h)
	return h
}

// ---------- Handlers ----------

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// Token 可选：直接使用 TShock 的 ApplicationRestToken 登录（API_SPEC §1 扩展）。
	// 与账号密码互斥，非空时优先使用；令牌只在 body，账号密码同样只在 body。
	Token string `json:"token"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Token = strings.TrimSpace(req.Token)
	useToken := req.Token != ""

	if useToken {
		if len(req.Token) > 512 {
			writeError(w, http.StatusBadRequest, codeBadRequest, "访问令牌长度不合法")
			return
		}
	} else if len(req.Username) < 1 || len(req.Username) > 32 || len(req.Password) < 1 || len(req.Password) > 128 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "账号或密码长度不合法")
		return
	}

	if !s.loginLimiter.Allow(s.clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "登录尝试过于频繁，请稍后重试")
		return
	}

	client, ok := s.clientFor(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	var token, username string
	if useToken {
		// 用 /tokentest 验证令牌并取回关联用户；该端点无额外权限要求。
		name, err := client.TokenTest(ctx, req.Token)
		if err != nil {
			status, code, msg := mapTokenLoginError(err)
			writeError(w, status, code, msg)
			return
		}
		token = req.Token
		username = name
		if username == "" {
			username = "token-user"
		}
	} else {
		// 装了 WebUI 插件时：先问一下 TShock 的建令牌桶是否已满。
		// 桶满就直接判「限流」，不再打 token/create —— 那里返回的 403 与「密码错 / 缺 useapi」
		// 同文案（SecureRest.cs:117-125），后端无法区分，是「错误提示不精确」的根因。
		// 插件不存在 / 旧版插件（无该端点）或调用失败时静默跳过，按原逻辑继续。
		if snap, lerr := client.RestLimit(ctx, s.cfg.WebAuthSecret); lerr == nil && snap != nil &&
			snap.Limit > 0 && snap.Bucket >= snap.Limit {
			writeError(w, http.StatusTooManyRequests, codeRateLimited,
				fmt.Sprintf("已触发 TShock 建令牌限流（上限 %d，每 %d 分钟恢复 1 个）。请稍后重试；服主可用 /weblimit 放宽上限。",
					snap.Limit, max(1, snap.IntervalMinutes)))
			return
		}
		tok, err := client.CreateToken(ctx, req.Username, req.Password)
		if err != nil {
			status, code, msg := mapLoginError(err)
			writeError(w, status, code, msg)
			return
		}
		token = tok
		// 用 tokentest 取回规范用户名（大小写）；失败则回退到输入值。
		username = req.Username
		if associated, terr := client.TokenTest(ctx, token); terr == nil && associated != "" {
			username = associated
		}
	}

	sess, err := s.sessions.Create(username, token)
	if err != nil {
		s.log.Error("创建会话失败", "error", err)
		writeError(w, http.StatusInternalServerError, codeServerError, "服务器内部错误")
		return
	}
	s.setSessionCookie(w, sess.ID)
	writeJSON(w, http.StatusOK, map[string]string{"username": sess.Username})
}

// ---------- 在线授权登录（WebUI 信使插件） ----------

// webAuthPollInterval 是后端轮询插件票据的间隔。
const webAuthPollInterval = 1500 * time.Millisecond

type loginOnlineRequest struct {
	Username string `json:"username"`
}

// handleLoginOnline 处理「在线授权」登录：
//
//	POST /api/login/online {username}
//
// 后端请插件向该在线玩家发一条游戏内确认消息，随后轮询最多 WebAuthTimeout；
// 玩家在游戏内同意后，插件铸造 TShock token，后端建立常规会话（与密码登录一致）。
func (s *Server) handleLoginOnline(w http.ResponseWriter, r *http.Request) {
	var req loginOnlineRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 1 || len(req.Username) > 32 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "账号长度不合法")
		return
	}
	if !s.loginLimiter.Allow(s.clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "登录尝试过于频繁，请稍后重试")
		return
	}
	client, ok := s.clientFor(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.WebAuthTimeout)
	defer cancel()

	ticket, err := client.WebAuthRequest(ctx, req.Username, s.cfg.WebAuthSecret, s.clientIP(r))
	if err != nil {
		s.writeWebAuthError(w, err)
		return
	}

	ticker := time.NewTicker(webAuthPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.cancelWebAuthTicket(client, ticket.Ticket)
			if r.Context().Err() != nil {
				return // 浏览器已断开，无需写响应
			}
			writeError(w, http.StatusGatewayTimeout, codeOnlineAuthTimeout, "等待授权超时，请重新发起")
			return
		case <-ticker.C:
			poll, perr := client.WebAuthPoll(ctx, ticket.Ticket, s.cfg.WebAuthSecret)
			if perr != nil {
				if ctx.Err() != nil {
					s.cancelWebAuthTicket(client, ticket.Ticket)
					if r.Context().Err() != nil {
						return
					}
					writeError(w, http.StatusGatewayTimeout, codeOnlineAuthTimeout, "等待授权超时，请重新发起")
					return
				}
				s.writeWebAuthError(w, perr)
				return
			}
			switch poll.State {
			case tshock.WebAuthStateApproved:
				username := poll.Username
				if username == "" {
					username = req.Username
				}
				sess, cerr := s.sessions.Create(username, poll.Token)
				if cerr != nil {
					s.log.Error("创建会话失败", "error", cerr)
					writeError(w, http.StatusInternalServerError, codeServerError, "服务器内部错误")
					return
				}
				s.setSessionCookie(w, sess.ID)
				writeJSON(w, http.StatusOK, map[string]string{"username": sess.Username})
				return
			case tshock.WebAuthStateDenied:
				writeError(w, http.StatusForbidden, codeOnlineAuthDenied, "玩家已拒绝授权")
				return
			case tshock.WebAuthStateExpired:
				writeError(w, http.StatusGatewayTimeout, codeOnlineAuthTimeout, "授权已过期，请重新发起")
				return
			}
			// pending：继续轮询。
		}
	}
}

// cancelWebAuthTicket 在放弃等待时通知插件回收票据（尽力而为）。
func (s *Server) cancelWebAuthTicket(client *tshock.Client, ticket string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client.WebAuthCancel(ctx, ticket, s.cfg.WebAuthSecret)
}

// handleWebAuthCapabilities 探测服务器是否安装了在线授权信使插件：
//
//	GET /api/webauth/capabilities → {"plugin": true|false}
//
// 探测是只读的（用空 name 调一次 request），不会创建任何票据。
func (s *Server) handleWebAuthCapabilities(w http.ResponseWriter, r *http.Request) {
	client, ok := s.clientFor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	plugin := true
	if err := client.WebAuthProbe(ctx, s.cfg.WebAuthSecret); err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindNotFound {
			plugin = false
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"plugin": plugin})
}

// writeWebAuthError 把在线授权调用错误映射为 API 错误信封。
func (s *Server) writeWebAuthError(w http.ResponseWriter, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "在线授权插件返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 WebUI 信使插件，无法使用在线授权")
	case tshock.KindPluginForbidden:
		writeError(w, http.StatusBadGateway, codeOnlineAuthError, "在线授权插件拒绝了请求（密钥不匹配），请检查后端 TSWUI_AUTH_SECRET 与插件 Secret 是否一致")
	case tshock.KindPluginBusiness:
		s.writeWebAuthBusiness(w, e)
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "在线授权插件返回异常")
	}
}

func (s *Server) writeWebAuthBusiness(w http.ResponseWriter, e *tshock.APIError) {
	msg := e.Message
	switch e.Code {
	case tshock.WebAuthCodeOffline:
		if msg == "" {
			msg = "该玩家不在线"
		}
		writeError(w, http.StatusNotFound, codePlayerOffline, msg)
	case tshock.WebAuthCodeNoAPIPermission:
		if msg == "" {
			msg = "账号所属用户组缺少 tshock.rest.useapi 权限"
		}
		writeError(w, http.StatusForbidden, codeNoAPIPermission, msg)
	case tshock.WebAuthCodeRateLimited:
		if msg == "" {
			msg = "请求过于频繁，请稍后再试"
		}
		writeError(w, http.StatusTooManyRequests, codeRateLimited, msg)
	default:
		if msg == "" {
			msg = "在线授权失败"
		}
		writeError(w, http.StatusBadRequest, codeOnlineAuthError, msg)
	}
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if sess, ok := s.currentSession(r); ok {
		ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
		// 目标地址非法时仍允许本地退出（不因上游参数阻断登出）。
		client, err := s.resolveClient(r)
		if err != nil {
			client = s.tshock
		}
		if err := client.DestroyToken(ctx, sess.TShockToken); err != nil {
			s.log.Warn("销毁 TShock token 失败", "error", err)
		}
		cancel()
		s.sessions.Delete(sess.ID)
	}
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type sessionResponse struct {
	Authenticated bool    `json:"authenticated"`
	Username      *string `json:"username"`
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if ok {
		ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
		defer cancel()
		client, cerr := s.resolveClient(r)
		if cerr != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, cerr.Error())
			return
		}
		// 用 /tokentest 验证后端持有的 TShock token 是否仍有效。
		// TShock 重启后所有 token 失效，而本进程内存里可能还留着会话，
		// 若不校验，刷新页面仍会显示已登录，直到执行指令才报 token_invalid。
		_, err := client.TokenTest(ctx, sess.TShockToken)
		var e *tshock.APIError
		if err != nil && errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
			// 上游明确表示 token 无效（含切换到另一台 TShock）：清会话与 Cookie，回未登录。
			s.sessions.Delete(sess.ID)
			s.clearSessionCookie(w)
		} else {
			// 有效，或 TShock 不可达/超时（后者不强制登出，避免误清）。
			name := sess.Username
			writeJSON(w, http.StatusOK, sessionResponse{Authenticated: true, Username: &name})
			return
		}
	}
	writeJSON(w, http.StatusOK, sessionResponse{Authenticated: false, Username: nil})
}

// ---------- 上游选择（多服务器快速切换） ----------

// targetHeader 是浏览器提交上游地址的请求头，例如 "http://1.2.3.4:7878"。
// 缺省表示使用后端 TSHOCK_URL。
const targetHeader = "X-TSWUI-Target"

type serverTargetInfo struct {
	Scheme string `json:"scheme"`
	Host   string `json:"host"`
	Port   int    `json:"port"`
}

type serversResponse struct {
	AllowCustom bool              `json:"allowCustom"`
	Default     *serverTargetInfo `json:"default,omitempty"`
}

// handleServers 告知前端：是否允许自定义上游，以及后端默认上游（host/port 分开）。
func (s *Server) handleServers(w http.ResponseWriter, r *http.Request) {
	resp := serversResponse{AllowCustom: s.cfg.TShockAllowCustomTargets}
	if u, err := url.Parse(s.cfg.TShockURL); err == nil && u.Hostname() != "" {
		port := tshock.DefaultPort
		if p := u.Port(); p != "" {
			if n, perr := strconv.Atoi(p); perr == nil {
				port = n
			}
		}
		resp.Default = &serverTargetInfo{Scheme: u.Scheme, Host: u.Hostname(), Port: port}
	}
	writeJSON(w, http.StatusOK, resp)
}

// resolveTarget 解析本次请求要使用的上游 base URL；"" 表示后端默认。
func (s *Server) resolveTarget(r *http.Request) (string, error) {
	raw := strings.TrimSpace(r.Header.Get(targetHeader))
	if raw == "" {
		return "", nil
	}
	if !s.cfg.TShockAllowCustomTargets {
		return "", errors.New("服务器未开启自定义上游地址")
	}
	return tshock.NormalizeTarget(raw)
}

// resolveClient 返回本次请求应使用的 TShock 客户端（可能指向不同上游）。
func (s *Server) resolveClient(r *http.Request) (*tshock.Client, error) {
	target, err := s.resolveTarget(r)
	if err != nil {
		return nil, err
	}
	if target == "" {
		return s.tshock, nil
	}
	return s.tshock.ForBaseURL(target), nil
}

// clientFor 在地址非法时写出 400 并返回 false。
func (s *Server) clientFor(w http.ResponseWriter, r *http.Request) (*tshock.Client, bool) {
	client, err := s.resolveClient(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, err.Error())
		return nil, false
	}
	return client, true
}

type statusResponse struct {
	Reachable      bool    `json:"reachable"`
	Name           *string `json:"name,omitempty"`
	ServerVersion  *string `json:"serverversion,omitempty"`
	TShockVersion  *string `json:"tshockversion,omitempty"`
	Port           *int    `json:"port,omitempty"`
	PlayerCount    *int    `json:"playercount,omitempty"`
	MaxPlayers     *int    `json:"maxplayers,omitempty"`
	World          *string `json:"world,omitempty"`
	Uptime         *string `json:"uptime,omitempty"`
	ServerPassword *bool   `json:"serverpassword,omitempty"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	sess, hasSession := s.currentSession(r)
	token := ""
	if hasSession {
		token = sess.TShockToken
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	client, cerr := s.resolveClient(r)
	if cerr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, cerr.Error())
		return
	}

	st, err := client.ServerStatus(ctx, token)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) {
			if e.Kind == tshock.KindTokenInvalid {
				// 需要 token 但缺失/失效：清会话，但仍视为可达，只是拿不到版本（API_SPEC §4）。
				if hasSession {
					s.sessions.Delete(sess.ID)
					s.clearSessionCookie(w)
				}
			}
			if e.Status > 0 {
				// 收到任何 HTTP 响应（含 401/403/5xx）都说明 TShock 进程可达。
				writeJSON(w, http.StatusOK, statusResponse{Reachable: true})
				return
			}
		}
		writeJSON(w, http.StatusOK, statusResponse{Reachable: false})
		return
	}

	writeJSON(w, http.StatusOK, statusResponse{
		Reachable:      true,
		Name:           strPtr(st.Name),
		ServerVersion:  strPtr(st.ServerVersion),
		TShockVersion:  strPtr(st.TShockVersion),
		Port:           intPtr(st.Port),
		PlayerCount:    intPtr(st.PlayerCount),
		MaxPlayers:     intPtr(st.MaxPlayers),
		World:          strPtr(st.World),
		Uptime:         strPtr(st.Uptime),
		ServerPassword: boolPtr(st.ServerPassword),
	})
}

func (s *Server) handlePlayers(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	client, cerr := s.resolveClient(r)
	if cerr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, cerr.Error())
		return
	}

	names, err := client.PlayersList(ctx, sess.TShockToken)
	if err != nil {
		s.writeTShockError(w, &sess, err)
		return
	}
	if names == nil {
		names = []string{}
	}
	writeJSON(w, http.StatusOK, map[string][]string{"players": names})
}

type commandRequest struct {
	Cmd string `json:"cmd"`
	// Ingame 为 true 表示前端（据运行时指令目录）判定这条指令 allowServer=false，
	// 需要以真实在线玩家身份执行（要求后端 TSWUI_ALLOW_INGAME_COMMANDS=true）。
	Ingame bool `json:"ingame"`
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	// 指令执行限流：按会话（每个玩家一个桶），设计原则与约束 §5。
	// 放在会话校验之后，避免未登录请求拿到 429 而不是 401。
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "指令执行过于频繁，请稍后再试")
		return
	}
	var req commandRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	if strings.TrimSpace(req.Cmd) == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "cmd 不能为空")
		return
	}

	// Tier A：已知 allowServer=false / 空指令的判定（ADR-9）。
	outcome := s.commands.Check(req.Cmd)

	// 需要「以真实在线玩家身份」执行的情况：
	//   - 前端显式标记 ingame（插件指令的 allowServer=false 只能靠运行时目录判断）；
	//   - 或后端内置白名单判定 allowServer=false。
	needIngame := req.Ingame || (outcome.Rejected && outcome.Marker == "in_game_only")
	if needIngame {
		if !s.cfg.AllowIngameCommands {
			msg := outcome.Message
			if msg == "" {
				msg = "该指令只能在游戏内执行"
			}
			writeJSON(w, http.StatusOK, tshock.Result{Status: tshock.StatusRejected, Output: []string{}, Message: msg})
			return
		}
		s.runIngameCommand(w, r, &sess, req.Cmd)
		return
	}
	if outcome.Rejected {
		writeJSON(w, http.StatusOK, tshock.Result{
			Status:  tshock.StatusRejected,
			Output:  []string{},
			Message: outcome.Message,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	client, cerr := s.resolveClient(r)
	if cerr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, cerr.Error())
		return
	}

	res, err := client.RawCmd(ctx, sess.TShockToken, req.Cmd)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
			s.sessions.Delete(sess.ID)
			s.clearSessionCookie(w)
		}
	}
	if res.Output == nil {
		res.Output = []string{}
	}
	// 指令结果一律 HTTP 200 + status（API_SPEC §6）。
	writeJSON(w, http.StatusOK, res)
}

// runIngameCommand 把一条 allowServer=false 的指令交给信使插件，
// 以真实在线玩家身份执行（权限仍是 token 用户组，不提权）。
func (s *Server) runIngameCommand(w http.ResponseWriter, r *http.Request, sess *session.Session, cmd string) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	client, cerr := s.resolveClient(r)
	if cerr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, cerr.Error())
		return
	}

	res, err := client.RunBatchPlayer(ctx, sess.TShockToken, []string{cmd})
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) {
			if e.Kind == tshock.KindTokenInvalid {
				s.sessions.Delete(sess.ID)
				s.clearSessionCookie(w)
			}
			if e.Kind == tshock.KindPluginBusiness {
				// player_offline / disabled：以业务结果返回，界面上可读。
				msg := e.Message
				if msg == "" {
					msg = "无法执行仅限游戏内的指令"
				}
				writeJSON(w, http.StatusOK, tshock.Result{Status: tshock.StatusRejected, Output: []string{}, Message: msg})
				return
			}
		}
		s.writeBatchError(w, s.refinePluginError(ctx, client, tshock.CapBatch, err))
		return
	}

	one := tshock.Result{Status: tshock.StatusBadResponse, Output: []string{}, Message: "插件未返回结果"}
	if len(res) > 0 {
		one = res[0]
	}
	if one.Output == nil {
		one.Output = []string{}
	}
	writeJSON(w, http.StatusOK, one)
}

// ---------- 批量执行（WebUI 信使插件 /webui/batch） ----------

type batchRequest struct {
	Cmds []string `json:"cmds"`
}

// handleBatch 一次请求执行多条指令（首页卡片「统一执行」）。
//
//	POST /api/batch { "cmds": ["/who", "/time"] }
//
// 需登录；每条指令仍由 TShock 按当前用户权限判定（与 /api/command 一致，不提权）。
// 结果与输入等长、同序：{ "results": [{status, output, message}, ...] }。
func (s *Server) handleBatch(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "指令执行过于频繁，请稍后再试")
		return
	}
	var req batchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	if len(req.Cmds) == 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "cmds 不能为空")
		return
	}
	if len(req.Cmds) > tshock.MaxBatchCommands {
		writeError(w, http.StatusBadRequest, codeBadRequest, fmt.Sprintf("一次最多执行 %d 条指令", tshock.MaxBatchCommands))
		return
	}

	// Tier A：已知 allowServer=false 的指令直接拒绝（纵深防御），其余发往插件。
	results := make([]tshock.Result, len(req.Cmds))
	send := make([]string, 0, len(req.Cmds))
	sendIdx := make([]int, 0, len(req.Cmds))
	for i, raw := range req.Cmds {
		cmd := strings.TrimSpace(raw)
		// 单条 1KB（UTF-8 字节）：保证即便全是中文（percent 编码后约 3 倍）也不超 URI 预算。
		if cmd == "" || len(cmd) > 1024 || strings.ContainsAny(cmd, "\x00\r\n") {
			results[i] = tshock.Result{Status: tshock.StatusCommandError, Output: []string{}, Message: "指令不合法"}
			continue
		}
		if outcome := s.commands.Check(cmd); outcome.Rejected {
			results[i] = tshock.Result{Status: tshock.StatusRejected, Output: []string{}, Message: outcome.Message}
			continue
		}
		send = append(send, cmd)
		sendIdx = append(sendIdx, i)
	}

	if len(send) > 0 {
		client, cerr := s.clientFor(w, r)
		if !cerr {
			return
		}
		timeout := batchTimeout(s.cfg.TShockTimeout, len(send))
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		out, err := client.WithTimeout(timeout).RunBatch(ctx, sess.TShockToken, send)
		if err != nil {
			var e *tshock.APIError
			if errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
				s.sessions.Delete(sess.ID)
				s.clearSessionCookie(w)
			}
			s.writeBatchError(w, s.refinePluginError(ctx, client, tshock.CapBatch, err))
			return
		}
		for j, res := range out {
			if j >= len(sendIdx) {
				break
			}
			if res.Output == nil {
				res.Output = []string{}
			}
			results[sendIdx[j]] = res
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// handleBatchCapabilities 探测服务器是否安装了支持批量执行的信使插件：
//
//	GET /api/batch/capabilities → {"plugin": true|false}
func (s *Server) handleBatchCapabilities(w http.ResponseWriter, r *http.Request) {
	client, ok := s.clientFor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	plugin := true
	if err := client.BatchProbe(ctx); err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindNotFound {
			plugin = false
		}
	}
	writeJSON(w, http.StatusOK, tshock.BatchCapability{Plugin: plugin, Ingame: plugin && s.cfg.AllowIngameCommands})
}

// batchTimeout 给批量执行留出与指令数相称的整体超时（上限 60s）。
func batchTimeout(base time.Duration, n int) time.Duration {
	d := base * time.Duration(n+1)
	if d < base {
		d = base
	}
	const max = 60 * time.Second
	if d > max {
		d = max
	}
	return d
}

func (s *Server) writeBatchError(w http.ResponseWriter, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "批量执行返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		writeError(w, http.StatusForbidden, codeNoPermission, "权限不足")
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 WebUI 信使插件，无法批量执行")
	case tshock.KindPluginOutdated:
		writeError(w, http.StatusNotImplemented, codePluginOutdated, e.Message)
	case tshock.KindPluginProtocolError:
		writeError(w, http.StatusNotImplemented, codePluginProtocol, e.Message)
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "批量执行返回异常")
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("deep") != "1" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.version})
		return
	}
	token := ""
	if sess, ok := s.currentSession(r); ok {
		token = sess.TShockToken
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	reachable := false
	deepClient, cerr := s.resolveClient(r)
	if cerr != nil {
		deepClient = s.tshock
	}
	if _, err := deepClient.ServerStatus(ctx, token); err == nil {
		reachable = true
	} else {
		var e *tshock.APIError
		// 有 HTTP 响应（含 401/403）即说明 TShock 进程可达。
		if errors.As(err, &e) && e.Status > 0 {
			reachable = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": s.version, "tshock_reachable": reachable})
}

// ---------- 静态资源 ----------

func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "方法不支持")
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}

		if _, err := fs.Stat(s.web, name); err != nil {
			// SPA 兜底：仅对无扩展名的路径（前端路由）回退 index.html；
			// /assets/*、/data/* 或带扩展名的缺失文件一律 404，避免把 index.html
			// 当成 JS/JSON 返回导致的解析错误。
			if strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "data/") || path.Ext(name) != "" {
				writeError(w, http.StatusNotFound, codeNotFound, "资源不存在")
				return
			}
			name = "index.html"
			if _, ierr := fs.Stat(s.web, name); ierr != nil {
				writeError(w, http.StatusNotFound, codeNotFound, "资源不存在")
				return
			}
		}

		setCacheHeaders(w, name)
		http.ServeFileFS(w, r, s.web, name)
	})
}

func setCacheHeaders(w http.ResponseWriter, name string) {
	switch {
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case name == "data/items-atlas.png", name == "data/player-atlas.png", name == "data/npc-atlas.png":
		// 图集 PNG 长缓存；前端用「内容哈希 ?v=...」做缓存失效（见 web/src/lib/atlas.ts），
		// 图集一变哈希就变，不会出现「新 regions + 旧 PNG」的图标错位。
		w.Header().Set("Cache-Control", "public, max-age=604800")
	case strings.HasPrefix(name, "data/") && strings.HasSuffix(name, "-atlas.json"):
		// 图集裁切信息很小，且带着 PNG 的内容哈希：每次校验，保证哈希及时更新。
		w.Header().Set("Cache-Control", "no-cache")
	case strings.HasPrefix(name, "data/") && strings.HasSuffix(name, ".json"):
		w.Header().Set("Cache-Control", "public, max-age=3600")
	case name == "index.html":
		w.Header().Set("Cache-Control", "no-cache")
	}
}

// ---------- 会话 / Cookie ----------

func (s *Server) currentSession(r *http.Request) (session.Session, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return session.Session{}, false
	}
	return s.sessions.Get(c.Value)
}

func (s *Server) setSessionCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(s.cfg.SessionTTL.Seconds()),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

// writeTShockError 把 TShock APIError 映射为 API 错误信封；
// token_valid 失效时清除会话与 Cookie。
func (s *Server) writeTShockError(w http.ResponseWriter, sess *session.Session, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "TShock 返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		writeError(w, http.StatusForbidden, codeNoPermission, "权限不足")
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 PlayerManager 插件")
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	case tshock.KindBadRequest:
		// 上游 4xx 的业务错误（如 PlayerManager「未找到玩家」）：原文透出，前端显示具体原因。
		msg := strings.TrimSpace(e.Message)
		if msg == "" {
			msg = "请求参数不合法"
		}
		writeError(w, http.StatusBadRequest, codeBadRequest, msg)
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "TShock 返回异常")
	}
}

func mapLoginError(err error) (int, string, string) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		return http.StatusInternalServerError, codeServerError, "服务器内部错误"
	}
	switch e.Kind {
	case tshock.KindBadCredentials, tshock.KindTokenInvalid:
		// 统一提示，不泄露账号是否存在（API_SPEC §1）。
		// TShock 对「密码错」「组缺 tshock.rest.useapi」「建 token 被限流」返回同一 403 文案，
		// 无法区分，故把三种可能都告知玩家（避免「密码明明对却登不上」的困惑）。
		return http.StatusUnauthorized, codeBadCredentials, "账号或密码错误；也可能是账号所属用户组缺少 tshock.rest.useapi 权限，或触发了 TShock REST 登录限流，请稍后重试"
	case tshock.KindNoAPIPermission, tshock.KindNoPermission:
		return http.StatusForbidden, codeNoAPIPermission, "账号所属用户组缺少 tshock.rest.useapi 权限，请联系管理员"
	case tshock.KindTimeout:
		return http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试"
	case tshock.KindUnavailable:
		return http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用"
	default:
		return http.StatusBadGateway, codeBadResponse, "TShock 返回异常"
	}
}

// mapTokenLoginError 处理「用 ApplicationRestToken 登录」的失败。
func mapTokenLoginError(err error) (int, string, string) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		return http.StatusInternalServerError, codeServerError, "服务器内部错误"
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		return http.StatusUnauthorized, codeTokenInvalid, "访问令牌无效或已失效"
	case tshock.KindTimeout:
		return http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试"
	case tshock.KindUnavailable:
		return http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用"
	default:
		return http.StatusBadGateway, codeBadResponse, "TShock 返回异常"
	}
}

// ---------- 玩家管理（第三方插件 PlayerManager） ----------

// handlePlayerCapabilities 实时探测 PlayerManager 的可用性：
// 插件是否安装、当前用户是否有权限。前端据此显示/隐藏模块并给出提醒。
func (s *Server) handlePlayerCapabilities(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	err := client.PlayerProbe(ctx, sess.TShockToken)
	if err == nil {
		writeJSON(w, http.StatusOK, tshock.PlayerCapability{Plugin: true, Permission: true})
		return
	}
	var e *tshock.APIError
	if errors.As(err, &e) {
		switch e.Kind {
		case tshock.KindNotFound:
			// 插件未安装：不算错误，正常告知前端。
			writeJSON(w, http.StatusOK, tshock.PlayerCapability{Plugin: false, Permission: false})
			return
		case tshock.KindNoPermission:
			writeJSON(w, http.StatusOK, tshock.PlayerCapability{Plugin: true, Permission: false})
			return
		}
	}
	s.writeTShockError(w, &sess, err)
}

// playerNameParam 校验并取出 name 查询参数（Terraria 玩家名，允许中文）。
func playerNameParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "缺少 name 参数")
		return "", false
	}
	if len([]rune(name)) > 32 || strings.ContainsAny(name, "\x00\r\n") {
		writeError(w, http.StatusBadRequest, codeBadRequest, "name 不合法")
		return "", false
	}
	return name, true
}

func (s *Server) handlePlayerLook(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	name, ok := playerNameParam(w, r)
	if !ok {
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	look, err := client.PlayerLook(ctx, sess.TShockToken, name)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
			s.sessions.Delete(sess.ID)
			s.clearSessionCookie(w)
		}
		s.writeTShockError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, look)
}

// handlePlayerExport 导出玩家存档（.plr），直接以附件流回浏览器。
func (s *Server) handlePlayerExport(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	name, ok := playerNameParam(w, r)
	if !ok {
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	data, err := client.PlayerExport(ctx, sess.TShockToken, name)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
			s.sessions.Delete(sess.ID)
			s.clearSessionCookie(w)
		}
		s.writeTShockError(w, &sess, err)
		return
	}
	filename := name + ".plr"
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", attachmentHeader(filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// ---------- 鱼店（第三方插件 FishShop） ----------

// handleFishCapabilities 实时探测 FishShop 的可用性：插件是否安装、当前用户是否有权限。
func (s *Server) handleFishCapabilities(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	err := client.FishProbe(ctx, sess.TShockToken)
	if err == nil {
		writeJSON(w, http.StatusOK, tshock.FishCapability{Plugin: true, Permission: true})
		return
	}
	var e *tshock.APIError
	if errors.As(err, &e) {
		switch e.Kind {
		case tshock.KindNotFound:
			writeJSON(w, http.StatusOK, tshock.FishCapability{Plugin: false, Permission: false})
			return
		case tshock.KindNoPermission:
			writeJSON(w, http.StatusOK, tshock.FishCapability{Plugin: true, Permission: false})
			return
		}
	}
	s.writeTShockError(w, &sess, err)
}

func (s *Server) handleFishList(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	shop, err := client.FishList(ctx, sess.TShockToken)
	if err != nil {
		s.writeFishError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, shop)
}

// fishSerialParam 解析并校验 serial 查询参数（正整数）。
func fishSerialParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("serial"))
	serial, err := strconv.Atoi(raw)
	if raw == "" || err != nil || serial < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "serial 不合法")
		return 0, false
	}
	return serial, true
}

func (s *Server) handleFishAsk(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	serial, ok := fishSerialParam(w, r)
	if !ok {
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	good, err := client.FishAsk(ctx, sess.TShockToken, serial)
	if err != nil {
		s.writeFishError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, good)
}

type fishBuyRequest struct {
	Serial int    `json:"serial"`
	Amount int    `json:"amount"`
	Args   string `json:"args"`
}

func (s *Server) handleFishBuy(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	// 购买会扣费，纳入指令限流（同一会话桶），避免脚本刷单。
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	var req fishBuyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	if req.Serial < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "serial 不合法")
		return
	}
	if req.Amount < 1 {
		req.Amount = 1
	}
	if len([]rune(req.Args)) > 256 || strings.ContainsAny(req.Args, "\x00\r\n") {
		writeError(w, http.StatusBadRequest, codeBadRequest, "args 不合法")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	out, err := client.FishBuy(ctx, sess.TShockToken, req.Serial, req.Amount, strings.TrimSpace(req.Args))
	if err != nil {
		s.writeFishError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// writeFishError 把 FishShop 调用错误映射为 API 错误信封。
// 与 writeTShockError 的区别：业务错误（HTTP 400）保留上游文案，方便玩家理解
// （如「钱不够」「商店打烊」「没有这个商品」）。
func (s *Server) writeFishError(w http.ResponseWriter, sess *session.Session, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "FishShop 返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		writeError(w, http.StatusForbidden, codeNoPermission, "权限不足")
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 FishShop 插件")
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		msg := strings.TrimSpace(e.Message)
		if msg == "" {
			msg = "鱼店返回异常"
		}
		writeError(w, http.StatusBadRequest, codeFishError, msg)
	}
}

// attachmentHeader 生成 Content-Disposition：ASCII 回退 + RFC 5987 UTF-8 文件名（支持中文玩家名）。
func attachmentHeader(filename string) string {
	ascii := strings.Map(func(r rune) rune {
		if r > 0x20 && r < 0x7f && r != '"' && r != '\\' {
			return r
		}
		return '_'
	}, filename)
	if ascii == "" || ascii == ".plr" {
		ascii = "player.plr"
	}
	return fmt.Sprintf("attachment; filename=%q; filename*=UTF-8''%s", ascii, url.PathEscape(filename))
}

// ---------- 工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// 响应已开始写出；仅记录不改变状态码。
		slog.Default().Debug("写响应失败", "error", err)
	}
}

type errorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]errorEnvelope{"error": {Code: code, Message: message}})
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(dst)
}

func strPtr(s string) *string { return &s }
func intPtr(n int) *int       { return &n }
func boolPtr(b bool) *bool    { return &b }
