// Package config 解析后端运行所需的环境变量（ARCHITECTURE.md 第 5 节）。
// 只使用标准库；启动时打印脱敏配置（不含任何凭证）。
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 是后端的全部运行时配置。
type Config struct {
	Listen        string
	TShockURL     string
	TShockTimeout time.Duration
	// TShockMethod 是后端调用 TShock REST 使用的 HTTP 方法：GET 或 POST（默认 POST）。
	// TShock 不校验方法（只按 URI 路由），参数始终只在 query string；
	// 默认 POST 是因为部分机房会把明文 GET 劫持成 302（见 docs/REST_API限制.md 第 1 节）。
	TShockMethod   string
	CookieSecure   bool
	SessionTTL     time.Duration
	MaxSessions    int
	LoginMaxPerMin int
	// CommandMaxPerMin 是每个会话（每个已登录玩家）每分钟可执行指令数上限（设计原则与约束 §5）。
	// 按**会话**而非 IP 计数：经反代时所有玩家共用一个来源 IP。
	CommandMaxPerMin int
	TrustProxy       bool
	LogLevel         string
	// TShockAllowCustomTargets 允许浏览器在 /api/* 请求里用 X-TSWUI-Target
	// 指定 TShock 上游（host[:port]）。关掉后只能用 TSHOCK_URL。
	TShockAllowCustomTargets bool
	// WebAuthSecret 是与 WebUI 信使插件共享的密钥（插件侧 Secret）。
	// 两者都留空时插件不校验 secret（仅建议在 REST 端口不对外暴露时）。
	WebAuthSecret string
	// WebAuthTimeout 是「在线授权」等待玩家在游戏内确认的总时长。
	WebAuthTimeout time.Duration
	// AllowIngameCommands 允许把 allowServer=false 的指令交给信使插件、
	// 以真实在线玩家身份执行（需要插件 AllowInGameOnlyCommands=true）。默认关。
	AllowIngameCommands bool
	// WebDistDir 仅用于本地开发：非空时从磁盘读取前端产物，替代内嵌资源。
	WebDistDir string
}

// Default 返回全部默认值。TSHOCK_URL 默认指向本机 TShock。
func Default() Config {
	return Config{
		Listen:         ":8080",
		TShockURL:      "http://127.0.0.1:7878",
		TShockTimeout:  10 * time.Second,
		TShockMethod:   "POST",
		CookieSecure:   false,
		SessionTTL:     12 * time.Hour,
		MaxSessions:    10000,
		LoginMaxPerMin: 10,
		// 默认 60/分钟：比 TShock 默认的 REST 限流（5/分钟）宽，又不至于让脚本刷屏。
		CommandMaxPerMin: 60,
		TrustProxy:       false,
		LogLevel:         "info",
		// 默认关闭：多服务器切换需要显式开启（TSHOCK_ALLOW_CUSTOM_TARGETS=true）。
		TShockAllowCustomTargets: false,
		// 在线授权：默认 60 秒等待玩家在游戏内确认；密钥默认空（不校验）。
		WebAuthTimeout: 60 * time.Second,
		// 默认禁止把 allowServer=false 的指令搬到网页执行（需显式开启 + 插件侧也开启）。
		AllowIngameCommands: false,
	}
}

// Load 读取环境变量并校验，返回最终配置。
func Load() (Config, error) {
	c := Default()

	c.Listen = env("LISTEN", c.Listen)
	c.TShockURL = env("TSHOCK_URL", c.TShockURL)
	c.TShockMethod = strings.ToUpper(strings.TrimSpace(env("TSHOCK_METHOD", c.TShockMethod)))
	c.LogLevel = strings.ToLower(env("LOG_LEVEL", c.LogLevel))
	c.WebAuthSecret = os.Getenv("TSWUI_AUTH_SECRET")
	c.WebDistDir = os.Getenv("WEB_DIST_DIR")

	var err error
	if c.TShockTimeout, err = envDuration("TSHOCK_TIMEOUT", c.TShockTimeout); err != nil {
		return c, err
	}
	if c.SessionTTL, err = envDuration("SESSION_TTL", c.SessionTTL); err != nil {
		return c, err
	}
	if c.WebAuthTimeout, err = envDuration("WEBAUTH_TIMEOUT", c.WebAuthTimeout); err != nil {
		return c, err
	}
	if c.CookieSecure, err = envBool("COOKIE_SECURE", c.CookieSecure); err != nil {
		return c, err
	}
	if c.TrustProxy, err = envBool("TRUST_PROXY", c.TrustProxy); err != nil {
		return c, err
	}
	if c.AllowIngameCommands, err = envBool("TSWUI_ALLOW_INGAME_COMMANDS", c.AllowIngameCommands); err != nil {
		return c, err
	}
	if c.TShockAllowCustomTargets, err = envBool("TSHOCK_ALLOW_CUSTOM_TARGETS", c.TShockAllowCustomTargets); err != nil {
		return c, err
	}
	if c.MaxSessions, err = envInt("MAX_SESSIONS", c.MaxSessions); err != nil {
		return c, err
	}
	if c.LoginMaxPerMin, err = envInt("LOGIN_MAX_PER_MIN", c.LoginMaxPerMin); err != nil {
		return c, err
	}
	if c.CommandMaxPerMin, err = envInt("COMMAND_MAX_PER_MIN", c.CommandMaxPerMin); err != nil {
		return c, err
	}

	if err := c.validate(); err != nil {
		return c, err
	}
	return c, nil
}

func (c Config) validate() error {
	if c.Listen == "" {
		return errors.New("LISTEN 不能为空")
	}
	u, err := url.Parse(c.TShockURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("TSHOCK_URL 非法：%q（需要形如 http://host:port）", c.TShockURL)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("TSHOCK_URL 仅支持 http/https，收到 %q", u.Scheme)
	}
	if c.TShockTimeout <= 0 {
		return errors.New("TSHOCK_TIMEOUT 必须为正")
	}
	// 与 tshock.NormalizeMethod 保持一致；这里直接报错而不是静默回退，避免配错后行为不明。
	switch c.TShockMethod {
	case "GET", "POST":
	default:
		return fmt.Errorf("TSHOCK_METHOD 非法：%q（仅支持 GET/POST）", c.TShockMethod)
	}
	if c.SessionTTL <= 0 {
		return errors.New("SESSION_TTL 必须为正")
	}
	if c.WebAuthTimeout <= 0 {
		return errors.New("WEBAUTH_TIMEOUT 必须为正")
	}
	if c.MaxSessions <= 0 {
		return errors.New("MAX_SESSIONS 必须为正")
	}
	if c.LoginMaxPerMin <= 0 {
		return errors.New("LOGIN_MAX_PER_MIN 必须为正")
	}
	if c.CommandMaxPerMin <= 0 {
		return errors.New("COMMAND_MAX_PER_MIN 必须为正")
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("LOG_LEVEL 非法：%q", c.LogLevel)
	}
	return nil
}

// LogValue 用于脱敏日志输出：只暴露非敏感字段。
// TSHOCK_URL 如含 userinfo（http://user:pass@host）会被脱敏。
func (c Config) LogValue() string {
	return fmt.Sprintf(
		"listen=%s tshock_url=%s tshock_timeout=%s tshock_method=%s cookie_secure=%t session_ttl=%s max_sessions=%d login_max_per_min=%d command_max_per_min=%d trust_proxy=%t allow_custom_targets=%t webauth_key_set=%t webauth_timeout=%s allow_ingame_commands=%t log_level=%s web_dist_dir=%q",
		c.Listen, redactURL(c.TShockURL), c.TShockTimeout, c.TShockMethod, c.CookieSecure, c.SessionTTL,
		c.MaxSessions, c.LoginMaxPerMin, c.CommandMaxPerMin, c.TrustProxy, c.TShockAllowCustomTargets,
		c.WebAuthSecret != "", c.WebAuthTimeout, c.AllowIngameCommands, c.LogLevel, c.WebDistDir,
	)
}

// redactURL 去掉 URL 中的 userinfo，避免日志泄露凭证。
func redactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return raw
	}
	u.User = url.User("redacted")
	return u.String()
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) (time.Duration, error) {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def, fmt.Errorf("%s 非法：%w", key, err)
	}
	return d, nil
}

func envBool(key string, def bool) (bool, error) {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def, fmt.Errorf("%s 非法：%w", key, err)
	}
	return b, nil
}

func envInt(key string, def int) (int, error) {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def, fmt.Errorf("%s 非法：%w", key, err)
	}
	return n, nil
}
