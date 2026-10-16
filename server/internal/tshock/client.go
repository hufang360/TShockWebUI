// Package tshock 是 TShock REST API 的极薄客户端与错误分类层。
//
// 事实来源：docs/TECHNICAL_RESEARCH.md 第 2 节（已对 v6.2.1 源码核实）。
// 关键约束：
//   - 建 token 的凭证只能走 query string（POST 表单体不解析，会 500）。
//   - rawcmd 严格继承 token 用户组权限，不提权。
//   - TShock token 只出现在「后端 → TShock」的出站请求里。
//   - TShock REST 不校验 HTTP 方法（只按 URI 路由，见 docs/REST_API限制.md），
//     出站方法由 `TSHOCK_METHOD` 控制，默认 POST：部分机房会把明文 GET 劫持成 302
//     （实测腾讯云对未备案域名的 GET 返回 webblock 页），POST 可规避。
package tshock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxBody = 4 << 20 // 4 MiB 上限，防止异常响应撑爆内存

// maxExportBody 是玩家存档导出（/pm/export base64）的专用上限。
// base64 会把体积放大 4/3，这里留到 12 MiB（解码后约 9 MiB），
// 因为 .plr 存档可能远大于普通 REST 响应。
const maxExportBody = 12 << 20

// 出站 HTTP 方法（TSHOCK_METHOD）。TShock 按 URI 路由、不校验方法，
// 因此二者对所有端点等价（参数始终只在 query string）。
const (
	MethodGet  = http.MethodGet
	MethodPost = http.MethodPost
)

// NormalizeMethod 归一化出站方法：仅 GET/POST 合法，其它值一律回退 POST（默认值）。
func NormalizeMethod(method string) string {
	if strings.EqualFold(strings.TrimSpace(method), MethodGet) {
		return MethodGet
	}
	return MethodPost
}

// Option 是 NewClient 的可选配置。
type Option func(*Client)

// WithMethod 指定调用 TShock 时使用的 HTTP 方法（GET/POST，其它值回退 POST）。
func WithMethod(method string) Option {
	return func(c *Client) { c.method = NormalizeMethod(method) }
}

// ErrorKind 是归一化后的 TShock 调用错误类别。
type ErrorKind string

const (
	KindBadCredentials  ErrorKind = "bad_credentials"
	KindNoAPIPermission ErrorKind = "no_api_permission"
	KindTokenInvalid    ErrorKind = "token_invalid"
	KindNoPermission    ErrorKind = "no_permission"
	KindNotFound        ErrorKind = "not_found"
	KindUnavailable     ErrorKind = "unavailable"
	KindTimeout         ErrorKind = "timeout"
	KindBadResponse     ErrorKind = "bad_response"
	// KindBadRequest：上游/插件以 4xx（非 401/403/404、非 5xx）返回业务错误，
	// Message 为上游原文（如 PlayerManager 的「未找到玩家」），应原样透出给用户。
	KindBadRequest ErrorKind = "bad_request"
	// KindPluginBusiness：插件以 HTTP 200 返回了业务失败（如在线授权里的
	// 玩家不在线 / 无账号 / 无权限），具体原因见 APIError.Code。
	KindPluginBusiness ErrorKind = "plugin_business"
	// KindPluginForbidden：插件拒绝了调用（共享密钥不匹配等）。
	KindPluginForbidden ErrorKind = "plugin_forbidden"
)

// APIError 是带类别的 TShock 调用错误。
type APIError struct {
	Kind   ErrorKind
	Status int
	// Code 是插件的业务错误码（KindPluginBusiness 时有效，如 offline）。
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("tshock: %s (HTTP %d): %s", e.Kind, e.Status, e.Message)
	}
	return fmt.Sprintf("tshock: %s: %s", e.Kind, e.Message)
}

// 指令执行结果状态（与 API_SPEC §6 一致）。
const (
	StatusOK           = "ok"
	StatusCommandError = "command_error"
	StatusNoPermission = "no_permission"
	StatusTokenInvalid = "token_invalid"
	StatusUnavailable  = "unavailable"
	StatusTimeout      = "timeout"
	StatusBadResponse  = "bad_response"
	StatusRejected     = "rejected"
)

// Result 是指令执行结果（API_SPEC §6）。
type Result struct {
	Status  string   `json:"status"`
	Output  []string `json:"output"`
	Message string   `json:"message,omitempty"`
}

// Status 是 /v2/server/status 的规范化结果。
type Status struct {
	Name           string
	ServerVersion  string // 已去前导 v
	TShockVersion  string // 已去前导 v
	Port           int
	PlayerCount    int
	MaxPlayers     int
	World          string
	Uptime         string // 形如 "0.00:00:18"
	ServerPassword bool
}

// Client 是 TShock REST 客户端。
type Client struct {
	baseURL string
	// method 是出站 HTTP 方法，始终为 GET 或 POST（见 NormalizeMethod）。
	method string
	http   *http.Client
	log    *slog.Logger
}

// NewClient 创建客户端；baseURL 形如 http://127.0.0.1:7878。
// 不传 WithMethod 时默认 POST（原因见包注释）。
func NewClient(baseURL string, timeout time.Duration, log *slog.Logger, opts ...Option) *Client {
	if log == nil {
		log = slog.Default()
	}
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		method:  MethodPost,
		http:    &http.Client{Timeout: timeout},
		log:     log,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(c)
		}
	}
	return c
}

// ForBaseURL 返回共享同一 http.Client 的副本，但指向另一个 TShock 上游。
// 用于按请求选择服务器（X-TSWUI-Target），不复制连接池之外的任何状态（出站方法随副本保留）。
func (c *Client) ForBaseURL(baseURL string) *Client {
	cp := *c
	cp.baseURL = strings.TrimRight(baseURL, "/")
	return &cp
}

// WithTimeout 返回共享同一 Transport 的副本，但整体超时为 d。
// 用于需要更长整体超时的调用（如批量执行多条指令）。
func (c *Client) WithTimeout(d time.Duration) *Client {
	if d <= 0 {
		return c
	}
	cp := *c
	cp.http = &http.Client{Transport: c.http.Transport, Timeout: d}
	return &cp
}

// ---------- 公开方法 ----------

// CreateToken 调用 /v2/token/create。凭证走 query（TShock 硬约束）。
// 403 统一归类为 bad_credentials：TShock 对「密码错 / 无 useapi 权限 / 限流」返回同一文案，
// 无法区分，按 API_SPEC §1 不泄露账号是否存在。
func (c *Client) CreateToken(ctx context.Context, username, password string) (string, error) {
	q := url.Values{}
	q.Set("username", username)
	q.Set("password", password)

	status, body, err := c.do(ctx, "/v2/token/create", q)
	if err != nil {
		return "", err
	}
	if status == http.StatusForbidden {
		return "", &APIError{Kind: KindBadCredentials, Status: status, Message: messageFromBody(body)}
	}
	if e := classify(status, body); e != nil {
		return "", e
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 返回非法 JSON"}
	}
	if out.Token == "" {
		return "", &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 未返回 token"}
	}
	return out.Token, nil
}

// DestroyToken 调用 /token/destroy/{token}?token=。
func (c *Client) DestroyToken(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	q := url.Values{}
	q.Set("token", token)
	status, body, err := c.do(ctx, "/token/destroy/"+url.PathEscape(token), q)
	if err != nil {
		return err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return e
	}
	return nil
}

// TokenTest 调用 /tokentest，返回 associateduser。
func (c *Client) TokenTest(ctx context.Context, token string) (string, error) {
	q := url.Values{}
	q.Set("token", token)
	status, body, err := c.do(ctx, "/tokentest", q)
	if err != nil {
		return "", err
	}
	// 该端点无额外权限要求：401/403 即代表 token 无效（与本地化文案无关）。
	if status == http.StatusForbidden || status == http.StatusUnauthorized {
		return "", &APIError{Kind: KindTokenInvalid, Status: status, Message: messageFromBody(body)}
	}
	if e := classify(status, body); e != nil {
		return "", e
	}
	var out struct {
		AssociatedUser string `json:"associateduser"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 返回非法 JSON"}
	}
	return out.AssociatedUser, nil
}

// ServerStatus 调用 /v2/server/status；token 可为空。
// EnableTokenEndpointAuthentication=true 且无 token 时 TShock 返回 401（KindTokenInvalid）。
func (c *Client) ServerStatus(ctx context.Context, token string) (*Status, error) {
	q := url.Values{}
	if token != "" {
		q.Set("token", token)
	}
	status, body, err := c.do(ctx, "/v2/server/status", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	var out struct {
		Name           string `json:"name"`
		ServerVersion  string `json:"serverversion"`
		TShockVersion  string `json:"tshockversion"`
		Port           int    `json:"port"`
		PlayerCount    int    `json:"playercount"`
		MaxPlayers     int    `json:"maxplayers"`
		World          string `json:"world"`
		Uptime         string `json:"uptime"`
		ServerPassword bool   `json:"serverpassword"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 返回非法 JSON"}
	}
	return &Status{
		Name:           out.Name,
		ServerVersion:  NormalizeVersion(out.ServerVersion),
		TShockVersion:  NormalizeVersion(out.TShockVersion),
		Port:           out.Port,
		PlayerCount:    out.PlayerCount,
		MaxPlayers:     out.MaxPlayers,
		World:          out.World,
		Uptime:         out.Uptime,
		ServerPassword: out.ServerPassword,
	}, nil
}

// PlayersList 调用 /v2/players/list，返回在线玩家昵称。
// 注意：TShock 返回的是对象数组，昵称字段为 nickname（已在源码核实）。
func (c *Client) PlayersList(ctx context.Context, token string) ([]string, error) {
	q := url.Values{}
	q.Set("token", token)
	status, body, err := c.do(ctx, "/v2/players/list", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	var out struct {
		Players []json.RawMessage `json:"players"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 返回非法 JSON"}
	}
	names := make([]string, 0, len(out.Players))
	for _, raw := range out.Players {
		if name := playerName(raw); name != "" {
			names = append(names, name)
		}
	}
	return names, nil
}

// RawCmd 调用 /v3/server/rawcmd 执行指令。返回的 Result.Status 始终有效；
// 当请求本身失败时同时返回 *APIError（调用方据此清会话等）。
func (c *Client) RawCmd(ctx context.Context, token, cmd string) (Result, error) {
	q := url.Values{}
	q.Set("cmd", cmd)
	q.Set("token", token)

	status, body, err := c.do(ctx, "/v3/server/rawcmd", q)
	if err != nil {
		e := asAPIError(err)
		return Result{Status: resultStatusFor(e.Kind), Output: []string{}, Message: e.Message}, e
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return Result{Status: resultStatusFor(e.Kind), Output: []string{}, Message: e.Message}, e
	}

	var out struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		e := &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 返回非法 JSON"}
		return Result{Status: StatusBadResponse, Output: []string{}, Message: e.Message}, e
	}
	lines, err := decodeStringOrList(out.Response)
	if err != nil {
		e := &APIError{Kind: KindBadResponse, Status: status, Message: "TShock 响应缺少 response 字段"}
		return Result{Status: StatusBadResponse, Output: []string{}, Message: e.Message}, e
	}
	return classifyOutput(lines), nil
}

// ---------- 内部实现 ----------

// do 发起一次 TShock REST 调用：方法取 c.method，参数一律走 query string
// （TShock 不解析请求体），请求体恒为空。
func (c *Client) do(ctx context.Context, path string, q url.Values) (int, []byte, error) {
	return c.doLimit(ctx, path, q, maxBody)
}

// doLimit 与 do 相同，但允许指定响应体上限（导出存档等大体量响应使用）。
func (c *Client) doLimit(ctx context.Context, path string, q url.Values, limit int64) (int, []byte, error) {
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, c.method, u, nil)
	if err != nil {
		return 0, nil, &APIError{Kind: KindBadResponse, Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")

	// 只记录 endpoint，绝不记录 query（token / 密码都在 query 里）。
	c.log.Debug("tshock request", "endpoint", path)

	resp, err := c.http.Do(req)
	if err != nil {
		if isTimeout(err) {
			return 0, nil, &APIError{Kind: KindTimeout, Message: "TShock 请求超时"}
		}
		return 0, nil, &APIError{Kind: KindUnavailable, Message: "无法连接 TShock 服务"}
	}
	defer resp.Body.Close()

	body, rerr := io.ReadAll(io.LimitReader(resp.Body, limit))
	if rerr != nil {
		if isTimeout(rerr) {
			return 0, nil, &APIError{Kind: KindTimeout, Message: "读取 TShock 响应超时"}
		}
		return 0, nil, &APIError{Kind: KindBadResponse, Message: "读取 TShock 响应失败"}
	}
	return resp.StatusCode, body, nil
}

func classify(status int, body []byte) *APIError {
	msg := messageFromBody(body)
	switch {
	case status == http.StatusUnauthorized:
		return &APIError{Kind: KindTokenInvalid, Status: status, Message: msg}
	case status == http.StatusForbidden:
		// 无效 token 的文案含 "token"（英文）或“令牌”（中文）。
		// 注意：所有 403 都会先经 apiError → classifyForbidden 用 /tokentest 判定，
		// 这里的文案匹配只作为无法再请求时的兼顾性兜底。
		if containsAny(string(body), "token", "令牌") {
			return &APIError{Kind: KindTokenInvalid, Status: status, Message: msg}
		}
		return &APIError{Kind: KindNoPermission, Status: status, Message: msg}
	case status >= 500:
		return &APIError{Kind: KindUnavailable, Status: status, Message: msg}
	case status == http.StatusNotFound:
		// TShock 对未知端点返回 404；调用方据此判断插件/端点是否存在。
		return &APIError{Kind: KindNotFound, Status: status, Message: msg}
	case status >= 400:
		return &APIError{Kind: KindBadRequest, Status: status, Message: msg}
	}
	return nil
}

// apiError 归一化非 2xx 响应。
// 403 的语义（无效 token vs 权限不足）通过 /tokentest 判定：
// TShock 的中文响应把 token 写作“令牌”，仅靠文案匹配在中文服务器上会误判。
func (c *Client) apiError(ctx context.Context, token string, status int, body []byte) *APIError {
	if status == http.StatusForbidden {
		return c.classifyForbidden(ctx, token, body)
	}
	return classify(status, body)
}

func (c *Client) classifyForbidden(ctx context.Context, token string, body []byte) *APIError {
	if _, err := c.TokenTest(ctx, token); err == nil {
		// token 有效 → 只是缺 tshock.rest.command 之类的权限。
		return &APIError{Kind: KindNoPermission, Status: http.StatusForbidden, Message: messageFromBody(body)}
	}
	return &APIError{Kind: KindTokenInvalid, Status: http.StatusForbidden, Message: messageFromBody(body)}
}

// classifyOutput 依据 TShock 的命令输出文本判定执行结果。
//
// TShock 的 rawcmd 对「权限不足 / 无效指令 / 仅限游戏内」都返回 HTTP 200，
// 把提示写进 output（Commands.HandleCommand 源码已核实），故必须解析文本。
// 标记同时覆盖英文原文与中文（本机目标服 lang=7），见 TShock i18n/zh_CN。
func classifyOutput(lines []string) Result {
	joined := strings.Join(lines, "\n")
	switch {
	case containsAny(joined, "you do not have access to this command", "你没有权限使用该指令"):
		return Result{Status: StatusNoPermission, Output: lines, Message: "权限不足，无法执行该指令"}
	case containsAny(joined, "you must use this command in-game", "你必须在游戏内使用该指令"):
		return Result{Status: StatusCommandError, Output: lines, Message: "该指令只能在游戏内执行"}
	case containsAny(joined, "invalid command", "输入的命令无效"):
		return Result{Status: StatusCommandError, Output: lines, Message: "无效指令或参数错误"}
	}
	return Result{Status: StatusOK, Output: lines}
}

// containsAny 对每个候选串做不区分大小写的包含判断（中文不受影响）。
func containsAny(s string, needles ...string) bool {
	lower := strings.ToLower(s)
	for _, n := range needles {
		if strings.Contains(lower, strings.ToLower(n)) {
			return true
		}
	}
	return false
}

func resultStatusFor(kind ErrorKind) string {
	switch kind {
	case KindTokenInvalid:
		return StatusTokenInvalid
	case KindNoPermission, KindNoAPIPermission:
		return StatusNoPermission
	case KindUnavailable:
		return StatusUnavailable
	case KindTimeout:
		return StatusTimeout
	default:
		return StatusBadResponse
	}
}

// NormalizeVersion 去掉 TShock 版本号的前导 v（v1.4.5.8 → 1.4.5.8）。
func NormalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimSpace(v), "v")
}

func asAPIError(err error) *APIError {
	var e *APIError
	if errors.As(err, &e) {
		return e
	}
	return &APIError{Kind: KindUnavailable, Message: err.Error()}
}

func isTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func messageFromBody(body []byte) string {
	var env struct {
		Error    string `json:"error"`
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &env); err == nil {
		if env.Error != "" {
			return env.Error
		}
		if env.Response != "" {
			return env.Response
		}
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

func playerName(raw json.RawMessage) string {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj struct {
		Nickname string `json:"nickname"`
		Name     string `json:"name"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if obj.Nickname != "" {
			return obj.Nickname
		}
		return obj.Name
	}
	return ""
}

func decodeStringOrList(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errors.New("empty response")
	}
	var asList []string
	if err := json.Unmarshal(raw, &asList); err == nil {
		return asList, nil
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		if asString == "" {
			return []string{}, nil
		}
		return strings.Split(strings.ReplaceAll(asString, "\r\n", "\n"), "\n"), nil
	}
	return nil, errors.New("unsupported response shape")
}
