package tshock

// 「在线授权」登录（TShockWebUI 的信使插件 WebUI 的 REST 端点）。
//
// 事实来源：本仓库插件源码 plugin/WebUI（REST 路由 /webui/auth/*）。
//   - POST/GET /webui/auth/request?name=&secret=  → 向在线玩家发起授权请求，返回票据
//   - POST/GET /webui/auth/poll?ticket=&secret=    → 轮询状态；批准则返回已铸造的 TShock token
//   - POST/GET /webui/auth/cancel?ticket=&secret=  → 放弃等待，回收票据
//
// 与其它信使插件一致的判定：
//   - 端点不存在（未安装插件）→ HTTP 404 → KindNotFound。
//   - 共享密钥不匹配 → HTTP 403 → KindPluginForbidden。
//   - 业务失败（玩家不在线 / 无账号 / 无权限 / 限流）→ HTTP 200 + code 字段 → KindPluginBusiness。
//
// 这些端点不需要 token（调用方在此刻还没有 token），安全边界是「玩家在游戏内确认」。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
)

const (
	webAuthRequestPath = "/webui/auth/request"
	webAuthPollPath    = "/webui/auth/poll"
	webAuthCancelPath  = "/webui/auth/cancel"
)

// 插件业务错误码（WebAuthEnvelope.Code）。
const (
	WebAuthCodeOK              = "ok"
	WebAuthCodeOffline         = "offline"
	WebAuthCodeNoAccount       = "no_account"
	WebAuthCodeNoAPIPermission = "no_api_permission"
	WebAuthCodeRateLimited     = "rate_limited"
	WebAuthCodeMissingName     = "missing_name"
	WebAuthCodeInvalidTicket   = "invalid_ticket"
)

// 轮询状态（WebAuthEnvelope.State）。
const (
	WebAuthStatePending  = "pending"
	WebAuthStateApproved = "approved"
	WebAuthStateDenied   = "denied"
	WebAuthStateExpired  = "expired"
)

// WebAuthRequestResult 是 /webui/auth/request 的成功结果。
type WebAuthRequestResult struct {
	// Ticket 是插件生成的验证码；后端据此轮询。
	Ticket string
	// Expires 是票据有效期（秒）。
	Expires int
	// Player 是实际匹配到的在线玩家名（可能与输入大小写不同）。
	Player string
	// Username 是 TShock 账号名（批准后 token 的关联用户）。
	Username string
}

// WebAuthPollResult 是 /webui/auth/poll 的结果。
type WebAuthPollResult struct {
	State string
	// Username / Token 仅在 State == approved 时非空。
	Username string
	Token    string
}

// webAuthEnvelope 是插件返回的统一信封（TShock 会把 status 原样序列化）。
type webAuthEnvelope struct {
	Status   string `json:"status"`
	Code     string `json:"code"`
	Error    string `json:"error"`
	Message  string `json:"message"`
	Ticket   string `json:"ticket"`
	Expires  int    `json:"expires"`
	Player   string `json:"player"`
	Username string `json:"username"`
	State    string `json:"state"`
	Token    string `json:"token"`
}

// WebAuthRequest 发起一次在线授权请求。
func (c *Client) WebAuthRequest(ctx context.Context, name, secret string) (*WebAuthRequestResult, error) {
	q := url.Values{}
	q.Set("name", name)
	setSecret(q, secret)

	env, err := c.webAuthCall(ctx, webAuthRequestPath, q)
	if err != nil {
		return nil, err
	}
	if env.Ticket == "" {
		return nil, &APIError{Kind: KindBadResponse, Message: "插件未返回票据"}
	}
	return &WebAuthRequestResult{
		Ticket:   env.Ticket,
		Expires:  env.Expires,
		Player:   env.Player,
		Username: env.Username,
	}, nil
}

// WebAuthPoll 轮询票据状态。
func (c *Client) WebAuthPoll(ctx context.Context, ticket, secret string) (*WebAuthPollResult, error) {
	q := url.Values{}
	q.Set("ticket", ticket)
	setSecret(q, secret)

	env, err := c.webAuthCall(ctx, webAuthPollPath, q)
	if err != nil {
		// invalid_ticket 不是错误，而是「票据已消费/不存在」的终态。
		var e *APIError
		if errors.As(err, &e) && e.Kind == KindPluginBusiness && e.Code == WebAuthCodeInvalidTicket {
			return &WebAuthPollResult{State: WebAuthStateExpired}, nil
		}
		return nil, err
	}
	state := env.State
	if state == "" {
		state = WebAuthStatePending
	}
	return &WebAuthPollResult{State: state, Username: env.Username, Token: env.Token}, nil
}

// WebAuthCancel 放弃等待并回收票据（尽力而为，失败不影响用户）。
func (c *Client) WebAuthCancel(ctx context.Context, ticket, secret string) {
	if ticket == "" {
		return
	}
	q := url.Values{}
	q.Set("ticket", ticket)
	setSecret(q, secret)
	_, _ = c.webAuthCall(ctx, webAuthCancelPath, q)
}

// WebAuthProbe 探测插件是否安装：用空 name 调一次 request。
//
//   - KindNotFound → 未安装
//   - KindPluginBusiness(code=missing_name) → 已安装且密钥正确
//   - KindPluginForbidden → 已安装但密钥不匹配
//   - nil → 已安装
func (c *Client) WebAuthProbe(ctx context.Context, secret string) error {
	_, err := c.WebAuthRequest(ctx, "", secret)
	return err
}

// webAuthCall 执行一次插件调用并解析信封。
func (c *Client) webAuthCall(ctx context.Context, path string, q url.Values) (*webAuthEnvelope, error) {
	status, body, err := c.do(ctx, path, q)
	if err != nil {
		return nil, err
	}

	var env webAuthEnvelope
	parseErr := json.Unmarshal(body, &env)

	switch {
	case status == http.StatusNotFound:
		return nil, &APIError{Kind: KindNotFound, Status: status, Message: messageFromBody(body)}
	case status == http.StatusForbidden:
		return nil, &APIError{Kind: KindPluginForbidden, Status: status, Code: env.Code, Message: firstNonEmpty(env.Error, env.Message)}
	case status >= 500:
		return nil, &APIError{Kind: KindUnavailable, Status: status, Message: messageFromBody(body)}
	case status >= 400:
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: messageFromBody(body)}
	case parseErr != nil:
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "在线授权插件返回非法 JSON"}
	}

	if env.Code == "" {
		env.Code = WebAuthCodeOK
	}
	if env.Code != WebAuthCodeOK {
		return nil, &APIError{Kind: KindPluginBusiness, Status: status, Code: env.Code, Message: firstNonEmpty(env.Message, env.Error)}
	}
	return &env, nil
}

// setSecret 只在密钥非空时附加 secret 参数（插件端 Secret 留空表示不校验）。
func setSecret(q url.Values, secret string) {
	if secret != "" {
		q.Set("secret", secret)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
