package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	// 清空所有相关 env，确保拿到默认值。
	for _, k := range []string{
		"LISTEN", "TSHOCK_URL", "TSHOCK_METHOD", "TSHOCK_TIMEOUT", "COOKIE_SECURE", "SESSION_TTL",
		"MAX_SESSIONS", "LOGIN_MAX_PER_MIN", "COMMAND_MAX_PER_MIN", "TRUST_PROXY", "LOG_LEVEL", "WEB_DIST_DIR",
	} {
		t.Setenv(k, "")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != ":8080" || cfg.TShockURL != "http://127.0.0.1:7878" {
		t.Fatalf("默认值错误：%+v", cfg)
	}
	if cfg.TShockTimeout != 10*time.Second || cfg.SessionTTL != 12*time.Hour {
		t.Fatalf("默认时长错误：%+v", cfg)
	}
	if cfg.TShockMethod != "POST" {
		t.Fatalf("TSHOCK_METHOD 默认应为 POST：%+v", cfg)
	}
	if cfg.MaxSessions != 10000 || cfg.LoginMaxPerMin != 10 || cfg.CookieSecure || cfg.TrustProxy {
		t.Fatalf("默认数值错误：%+v", cfg)
	}
	if cfg.CommandMaxPerMin != 60 {
		t.Fatalf("COMMAND_MAX_PER_MIN 默认应为 60：%+v", cfg)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("LISTEN", ":9999")
	t.Setenv("TSHOCK_URL", "https://tshock.example:7878")
	t.Setenv("TSHOCK_TIMEOUT", "3s")
	// 小写也应被归一化为大写。
	t.Setenv("TSHOCK_METHOD", "get")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("SESSION_TTL", "30m")
	t.Setenv("MAX_SESSIONS", "5")
	t.Setenv("LOGIN_MAX_PER_MIN", "2")
	t.Setenv("COMMAND_MAX_PER_MIN", "7")
	t.Setenv("TRUST_PROXY", "1")
	t.Setenv("LOG_LEVEL", "DEBUG")
	t.Setenv("WEB_DIST_DIR", "/tmp/dist")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != ":9999" || cfg.TShockURL != "https://tshock.example:7878" {
		t.Fatalf("覆盖失败：%+v", cfg)
	}
	if cfg.TShockTimeout != 3*time.Second || cfg.SessionTTL != 30*time.Minute {
		t.Fatalf("时长覆盖失败：%+v", cfg)
	}
	if cfg.TShockMethod != "GET" {
		t.Fatalf("TSHOCK_METHOD 覆盖失败（应大写）：%+v", cfg)
	}
	if cfg.MaxSessions != 5 || cfg.LoginMaxPerMin != 2 || !cfg.CookieSecure || !cfg.TrustProxy {
		t.Fatalf("数值覆盖失败：%+v", cfg)
	}
	if cfg.CommandMaxPerMin != 7 {
		t.Fatalf("COMMAND_MAX_PER_MIN 覆盖失败：%+v", cfg)
	}
	if cfg.LogLevel != "debug" {
		t.Fatalf("日志级别应小写：%q", cfg.LogLevel)
	}
	if cfg.WebDistDir != "/tmp/dist" {
		t.Fatalf("WebDistDir = %q", cfg.WebDistDir)
	}
}

func TestLoadInvalid(t *testing.T) {
	cases := []struct {
		name  string
		key   string
		value string
	}{
		{"非法 URL", "TSHOCK_URL", "://nope"},
		{"不支持的 scheme", "TSHOCK_URL", "ftp://host:1"},
		{"非法时长", "TSHOCK_TIMEOUT", "abc"},
		{"零超时", "TSHOCK_TIMEOUT", "0s"},
		{"非正会话上限", "MAX_SESSIONS", "0"},
		{"非正限流", "LOGIN_MAX_PER_MIN", "-1"},
		{"非正指令限流", "COMMAND_MAX_PER_MIN", "0"},
		{"非法布尔", "COOKIE_SECURE", "maybe"},
		{"非法日志级别", "LOG_LEVEL", "verbose"},
		{"非法出站方法", "TSHOCK_METHOD", "PATCH"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatalf("%s=%q 应报错", tc.key, tc.value)
			}
		})
	}
}

func TestLogValueHasNoSecrets(t *testing.T) {
	cfg := Default()
	cfg.TShockURL = "http://user:secret@host:7878"
	v := cfg.LogValue()
	if strings.Contains(v, "secret") {
		t.Fatalf("LogValue 泄露了凭证：%s", v)
	}
	if !strings.Contains(v, "tshock_method=POST") {
		t.Fatalf("LogValue 应包含出站方法：%s", v)
	}
}
