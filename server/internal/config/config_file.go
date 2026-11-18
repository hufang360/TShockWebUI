// config.json：给不方便设置环境变量的场景（典型是 Windows 双击运行 exe）提供一份
// 同名、可编辑的配置。优先级：环境变量 > config.json > 内置默认值；
// 键名与同名环境变量一致（清单见 docs/ARCHITECTURE.md 第 5 节）。
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	// configFileEnv 指定配置文件路径；none / off / - 表示关闭配置文件。
	configFileEnv = "TSWUI_CONFIG"
	// defaultConfigFile 是未设置 TSWUI_CONFIG 时的文件名（相对启动时的工作目录）。
	defaultConfigFile = "config.json"
)

// configFileComment 写进模板的 _comment（JSON 没有注释语法），改模板时一起改。
var configFileComment = []string{
	"TShockWebUI 配置文件：键名与同名环境变量一致，含义见 docs/ARCHITECTURE.md 第 5 节。",
	"优先级：环境变量 > 本文件 > 内置默认值；改完需要重启才会生效。",
	`时长写成 "12h" / "10s" 这样的字符串；名单写数组，例如 ["spawnboss","spawnmob"]。`,
	"删掉本文件（或把 TSWUI_CONFIG 设为 none）就不会再读写它。",
}

// fileConfig 是 config.json 的结构：字段全为指针，没出现的键保持内置默认值。
type fileConfig struct {
	Comment json.RawMessage `json:"_comment,omitempty"`

	Listen                   *string  `json:"LISTEN,omitempty"`
	TShockURL                *string  `json:"TSHOCK_URL,omitempty"`
	TShockMethod             *string  `json:"TSHOCK_METHOD,omitempty"`
	TShockTimeout            *string  `json:"TSHOCK_TIMEOUT,omitempty"`
	TShockAllowCustomTargets *bool    `json:"TSHOCK_ALLOW_CUSTOM_TARGETS,omitempty"`
	CookieSecure             *bool    `json:"COOKIE_SECURE,omitempty"`
	SessionTTL               *string  `json:"SESSION_TTL,omitempty"`
	MaxSessions              *int     `json:"MAX_SESSIONS,omitempty"`
	LoginMaxPerMin           *int     `json:"LOGIN_MAX_PER_MIN,omitempty"`
	CommandMaxPerMin         *int     `json:"COMMAND_MAX_PER_MIN,omitempty"`
	TrustProxy               *bool    `json:"TRUST_PROXY,omitempty"`
	WebAuthSecret            *string  `json:"TSWUI_AUTH_SECRET,omitempty"`
	WebAuthTimeout           *string  `json:"WEBAUTH_TIMEOUT,omitempty"`
	AllowIngameCommands      *bool    `json:"TSWUI_ALLOW_INGAME_COMMANDS,omitempty"`
	IngameCommands           []string `json:"TSWUI_INGAME_COMMANDS"`
	LogLevel                 *string  `json:"LOG_LEVEL,omitempty"`
	WebDistDir               *string  `json:"WEB_DIST_DIR,omitempty"`
}

// configFilePath 解析配置文件路径；返回空串表示不启用配置文件。
func configFilePath() (string, error) {
	raw := strings.TrimSpace(os.Getenv(configFileEnv))
	switch strings.ToLower(raw) {
	case "none", "off", "-":
		return "", nil
	}
	if raw == "" {
		raw = defaultConfigFile
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("%s 路径非法：%w", configFileEnv, err)
	}
	return abs, nil
}

// loadConfigFile 把文件里的值覆盖到 c 上。
// 文件不存在时写一份模板并返回 created=true；写不进去只回报警告（warn），不影响启动。
func loadConfigFile(path string, c *Config) (created bool, warn string, err error) {
	data, readErr := os.ReadFile(path)
	// ENOTDIR：路径中间是个同名普通文件，等同「不存在且写不进去」，下面会退化成警告。
	if errors.Is(readErr, fs.ErrNotExist) || errors.Is(readErr, syscall.ENOTDIR) {
		if writeErr := writeConfigFile(path, Default()); writeErr != nil {
			return false, fmt.Sprintf("无法生成配置文件 %s：%v（本次按内置默认值 + 环境变量运行）", path, writeErr), nil
		}
		return true, "", nil
	}
	if readErr != nil {
		return false, "", fmt.Errorf("读取配置文件失败：%w", readErr)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return false, "", fmt.Errorf("配置文件 %s 是空的：删掉它可重新生成模板，或填入配置项", path)
	}
	// 笔误的键名必须报错：静默忽略会让人以为改生效了，实际仍跑默认值。
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var f fileConfig
	if decErr := dec.Decode(&f); decErr != nil {
		return false, "", fmt.Errorf("配置文件 %s 解析失败：%w（键名须与同名环境变量一致，见 docs/ARCHITECTURE.md 第 5 节）", path, decErr)
	}
	return false, "", f.apply(c)
}

// apply 把文件里出现的键写到 c 上；字符串形式的大小写按环境变量的规则归一。
func (f fileConfig) apply(c *Config) error {
	setStr := func(dst *string, v *string) {
		if v != nil {
			*dst = strings.TrimSpace(*v)
		}
	}
	setBool := func(dst *bool, v *bool) {
		if v != nil {
			*dst = *v
		}
	}
	setInt := func(dst *int, v *int) {
		if v != nil {
			*dst = *v
		}
	}

	setStr(&c.Listen, f.Listen)
	setStr(&c.TShockURL, f.TShockURL)
	setStr(&c.WebAuthSecret, f.WebAuthSecret)
	setStr(&c.WebDistDir, f.WebDistDir)
	if f.TShockMethod != nil {
		c.TShockMethod = strings.ToUpper(strings.TrimSpace(*f.TShockMethod))
	}
	if f.LogLevel != nil {
		c.LogLevel = strings.ToLower(strings.TrimSpace(*f.LogLevel))
	}
	setBool(&c.TShockAllowCustomTargets, f.TShockAllowCustomTargets)
	setBool(&c.CookieSecure, f.CookieSecure)
	setBool(&c.TrustProxy, f.TrustProxy)
	setBool(&c.AllowIngameCommands, f.AllowIngameCommands)
	setInt(&c.MaxSessions, f.MaxSessions)
	setInt(&c.LoginMaxPerMin, f.LoginMaxPerMin)
	setInt(&c.CommandMaxPerMin, f.CommandMaxPerMin)
	// 数组按 env 的逗号格式归一（小写、去重、排序），两条通道行为一致。
	if f.IngameCommands != nil {
		c.IngameCommands = normalizeList(strings.Join(f.IngameCommands, ","))
	}
	for _, d := range []struct {
		name string
		v    *string
		dst  *time.Duration
	}{
		{"TSHOCK_TIMEOUT", f.TShockTimeout, &c.TShockTimeout},
		{"SESSION_TTL", f.SessionTTL, &c.SessionTTL},
		{"WEBAUTH_TIMEOUT", f.WebAuthTimeout, &c.WebAuthTimeout},
	} {
		if d.v == nil {
			continue
		}
		parsed, err := time.ParseDuration(strings.TrimSpace(*d.v))
		if err != nil {
			return fmt.Errorf("配置文件里 %s 非法：%w（形如 \"12h\" / \"90s\"）", d.name, err)
		}
		*d.dst = parsed
	}
	return nil
}

// writeConfigFile 把 c 的全部配置项写成模板（含 _comment）。
func writeConfigFile(path string, c Config) error {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	comment, err := marshalNoEscape(configFileComment)
	if err != nil {
		return err
	}
	f := fileConfig{
		Comment:                  comment,
		Listen:                   strPtr(c.Listen),
		TShockURL:                strPtr(c.TShockURL),
		TShockMethod:             strPtr(c.TShockMethod),
		TShockTimeout:            strPtr(durationText(c.TShockTimeout)),
		TShockAllowCustomTargets: boolPtr(c.TShockAllowCustomTargets),
		CookieSecure:             boolPtr(c.CookieSecure),
		SessionTTL:               strPtr(durationText(c.SessionTTL)),
		MaxSessions:              intPtr(c.MaxSessions),
		LoginMaxPerMin:           intPtr(c.LoginMaxPerMin),
		CommandMaxPerMin:         intPtr(c.CommandMaxPerMin),
		TrustProxy:               boolPtr(c.TrustProxy),
		WebAuthSecret:            strPtr(c.WebAuthSecret),
		WebAuthTimeout:           strPtr(durationText(c.WebAuthTimeout)),
		AllowIngameCommands:      boolPtr(c.AllowIngameCommands),
		IngameCommands:           append([]string{}, c.IngameCommands...),
		LogLevel:                 strPtr(c.LogLevel),
		WebDistDir:               strPtr(c.WebDistDir),
	}
	// 用 Encoder 关掉 HTML 转义：模板给人读，不想在 _comment 里看到 \u003e。
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(f); err != nil {
		return err
	}
	// 0600：文件里可能含 TSWUI_AUTH_SECRET。
	return os.WriteFile(path, buf.Bytes(), 0o600)
}

func strPtr(v string) *string { return &v }
func boolPtr(v bool) *bool    { return &v }
func intPtr(v int) *int       { return &v }

// durationText 把时长写成「好读但不丢信息」的形式（12h / 90m / 10s），
// 免得模板里出现 12h0m0s 那种要人自己解释的写法；结果仍可被 time.ParseDuration 解析。
func durationText(d time.Duration) string {
	switch {
	case d%time.Hour == 0:
		return fmt.Sprintf("%dh", int64(d/time.Hour))
	case d%time.Minute == 0:
		return fmt.Sprintf("%dm", int64(d/time.Minute))
	default:
		return d.String()
	}
}

// marshalNoEscape 序列化但关掉 HTML 转义（> < & 在模板里保持原样）。
func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
