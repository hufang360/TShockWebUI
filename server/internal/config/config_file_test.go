package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// isolateEnv 清掉所有会干扰断言的 env（保留 TSWUI_CONFIG，由各用例自己设）。
func isolateEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"LISTEN", "TSHOCK_URL", "TSHOCK_METHOD", "TSHOCK_TIMEOUT", "COOKIE_SECURE", "SESSION_TTL",
		"MAX_SESSIONS", "LOGIN_MAX_PER_MIN", "COMMAND_MAX_PER_MIN", "TRUST_PROXY", "LOG_LEVEL", "WEB_DIST_DIR",
		"TSWUI_AUTH_SECRET", "WEBAUTH_TIMEOUT", "TSWUI_ALLOW_INGAME_COMMANDS", "TSHOCK_ALLOW_CUSTOM_TARGETS",
	} {
		t.Setenv(k, "")
	}
}

// 首次启动：文件不存在就写模板，且**照常**返回可用配置（不阻塞启动 / 不退出）。
func TestLoadGeneratesTemplateOnFirstRun(t *testing.T) {
	isolateEnv(t)
	path := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("TSWUI_CONFIG", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.ConfigFileCreated {
		t.Fatalf("首次启动应标记已生成模板：%+v", cfg)
	}
	if cfg.ConfigPath != path || cfg.ConfigFileWarn != "" {
		t.Fatalf("路径/警告不对：path=%q warn=%q", cfg.ConfigPath, cfg.ConfigFileWarn)
	}
	if cfg.Listen != ":18080" {
		t.Fatalf("生成后仍应是默认端口：%q", cfg.Listen)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取模板：%v", err)
	}
	text := string(raw)
	for _, want := range []string{"_comment", `"LISTEN": ":18080"`, `"SESSION_TTL": "12h"`, `"WEB_DIST_DIR": ""`, `"TSWUI_INGAME_COMMANDS": []`} {
		if !strings.Contains(text, want) {
			t.Fatalf("模板缺少 %s：\n%s", want, text)
		}
	}
	if mode := fileMode(t, path); mode.Perm()&0o077 != 0 {
		t.Fatalf("模板可能含密钥，权限过宽：%v", mode.Perm())
	}
}

// 生成的模板再读回来必须等价于内置默认值（否则「改完重启」会莫名其妙变了东西）。
func TestGeneratedTemplateRoundTrips(t *testing.T) {
	isolateEnv(t)
	path := filepath.Join(t.TempDir(), "config.json")
	if err := writeConfigFile(path, Default()); err != nil {
		t.Fatalf("writeConfigFile: %v", err)
	}
	t.Setenv("TSWUI_CONFIG", path)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	def := Default()
	if cfg.Listen != def.Listen || cfg.TShockURL != def.TShockURL || cfg.TShockMethod != def.TShockMethod ||
		cfg.CookieSecure != def.CookieSecure || cfg.SessionTTL != def.SessionTTL || cfg.MaxSessions != def.MaxSessions ||
		cfg.LoginMaxPerMin != def.LoginMaxPerMin || cfg.CommandMaxPerMin != def.CommandMaxPerMin ||
		cfg.TrustProxy != def.TrustProxy || cfg.TShockAllowCustomTargets != def.TShockAllowCustomTargets ||
		cfg.WebAuthTimeout != def.WebAuthTimeout || cfg.AllowIngameCommands != def.AllowIngameCommands ||
		cfg.LogLevel != def.LogLevel || len(cfg.IngameCommands) != 0 {
		t.Fatalf("模板读回后与默认值不一致：\n got=%+v\n def=%+v", cfg, def)
	}
	if cfg.ConfigFileCreated {
		t.Fatalf("文件已存在时不应标记为新建")
	}
}

func TestLoadFromFile(t *testing.T) {
	isolateEnv(t)
	path := writeFile(t, `{
  "LISTEN": ":9001",
  "TSHOCK_URL": "http://10.0.0.5:7878",
  "TSHOCK_METHOD": "get",
  "TSHOCK_TIMEOUT": "3s",
  "SESSION_TTL": "30m",
  "WEBAUTH_TIMEOUT": "90s",
  "COOKIE_SECURE": true,
  "TRUST_PROXY": true,
  "TSHOCK_ALLOW_CUSTOM_TARGETS": true,
  "TSWUI_ALLOW_INGAME_COMMANDS": true,
  "TSWUI_INGAME_COMMANDS": ["/SpawnBoss", "spawnmob", "spawnboss"],
  "MAX_SESSIONS": 7,
  "LOGIN_MAX_PER_MIN": 3,
  "COMMAND_MAX_PER_MIN": 9,
  "LOG_LEVEL": "DEBUG",
  "TSWUI_AUTH_SECRET": "s3cret",
  "WEB_DIST_DIR": "/srv/dist"
}`)
	t.Setenv("TSWUI_CONFIG", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ConfigPath != path || cfg.ConfigFileCreated || cfg.ConfigFileWarn != "" {
		t.Fatalf("配置文件状态不对：%+v", cfg)
	}
	if cfg.Listen != ":9001" || cfg.TShockURL != "http://10.0.0.5:7878" || cfg.TShockMethod != "GET" {
		t.Fatalf("字符串项未生效：%+v", cfg)
	}
	if cfg.TShockTimeout != 3*time.Second || cfg.SessionTTL != 30*time.Minute || cfg.WebAuthTimeout != 90*time.Second {
		t.Fatalf("时长项未生效：%+v", cfg)
	}
	if !cfg.CookieSecure || !cfg.TrustProxy || !cfg.TShockAllowCustomTargets || !cfg.AllowIngameCommands {
		t.Fatalf("布尔项未生效：%+v", cfg)
	}
	if cfg.MaxSessions != 7 || cfg.LoginMaxPerMin != 3 || cfg.CommandMaxPerMin != 9 {
		t.Fatalf("数值项未生效：%+v", cfg)
	}
	if cfg.LogLevel != "debug" || cfg.WebAuthSecret != "s3cret" || cfg.WebDistDir != "/srv/dist" {
		t.Fatalf("归一/凭证/开发路径不对：%+v", cfg)
	}
	if len(cfg.IngameCommands) != 2 || cfg.IngameCommands[0] != "spawnboss" || cfg.IngameCommands[1] != "spawnmob" {
		t.Fatalf("名单归一错误：%+v", cfg.IngameCommands)
	}
}

// 环境变量优先：容器 / compose / CI 的老用法必须继续有效。
func TestEnvOverridesFile(t *testing.T) {
	isolateEnv(t)
	path := writeFile(t, `{"LISTEN": ":9001", "TSWUI_INGAME_COMMANDS": ["spawnboss"]}`)
	t.Setenv("TSWUI_CONFIG", path)
	t.Setenv("LISTEN", ":9100")
	t.Setenv("TSWUI_INGAME_COMMANDS", "spawnmob")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != ":9100" {
		t.Fatalf("env 应覆盖文件：%q", cfg.Listen)
	}
	if len(cfg.IngameCommands) != 1 || cfg.IngameCommands[0] != "spawnmob" {
		t.Fatalf("env 名单应覆盖文件：%+v", cfg.IngameCommands)
	}
}

// 未知键（笔误）必须报错，否则「改了没生效」无从发现。
func TestFileUnknownKeyRejected(t *testing.T) {
	isolateEnv(t)
	path := writeFile(t, `{"LITSEN": ":9001"}`)
	t.Setenv("TSWUI_CONFIG", path)

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "LITSEN") {
		t.Fatalf("未知键应报错并点名，实际：%v", err)
	}
}

func TestFileBadContent(t *testing.T) {
	isolateEnv(t)
	cases := map[string]string{
		"空文件":    "   \n",
		"坏 JSON": `{"LISTEN": }`,
		"坏时长":    `{"SESSION_TTL": "12 hours"}`,
		"类型不对":   `{"MAX_SESSIONS": "many"}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			path := writeFile(t, content)
			t.Setenv("TSWUI_CONFIG", path)
			if _, err := Load(); err == nil {
				t.Fatalf("应报错：%s", content)
			}
		})
	}
}

// 文件里的值仍要过统一校验（不能被绕过）。
func TestFileValuesStillValidated(t *testing.T) {
	isolateEnv(t)
	path := writeFile(t, `{"TSHOCK_URL": "ftp://host:1"}`)
	t.Setenv("TSWUI_CONFIG", path)
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "TSHOCK_URL") {
		t.Fatalf("非法 TShockURL 应报错：%v", err)
	}
}

func TestConfigFileDisabled(t *testing.T) {
	for _, off := range []string{"none", "off", "-", "OFF"} {
		t.Run(off, func(t *testing.T) {
			isolateEnv(t)
			dir := t.TempDir()
			t.Chdir(dir)
			t.Setenv("TSWUI_CONFIG", off)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.ConfigPath != "" || cfg.ConfigFileCreated {
				t.Fatalf("关闭后不应有配置文件：%+v", cfg)
			}
			if _, err := os.Stat(filepath.Join(dir, defaultConfigFile)); !os.IsNotExist(err) {
				t.Fatalf("关闭后不应生成文件：%v", err)
			}
		})
	}
}

// 默认路径是「启动目录下的 config.json」。
func TestDefaultPathIsCwd(t *testing.T) {
	isolateEnv(t)
	dir := t.TempDir()
	t.Chdir(dir)
	t.Setenv("TSWUI_CONFIG", "  ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := filepath.Join(dir, defaultConfigFile)
	if cfg.ConfigPath != want {
		t.Fatalf("ConfigPath = %q，期望 %q", cfg.ConfigPath, want)
	}
	if !cfg.ConfigFileCreated {
		t.Fatalf("应在启动目录生成模板")
	}
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("模板没写出来：%v", err)
	}
}

// 生成失败只告警，不阻塞启动（例如目录只读）。
func TestUnwritablePathWarns(t *testing.T) {
	isolateEnv(t)
	dir := t.TempDir()
	blocker := filepath.Join(dir, "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatalf("准备：%v", err)
	}
	t.Setenv("TSWUI_CONFIG", filepath.Join(blocker, "config.json"))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("生成失败不该阻塞启动：%v", err)
	}
	if cfg.ConfigFileCreated || cfg.ConfigFileWarn == "" {
		t.Fatalf("应给出警告且不标记为已生成：%+v", cfg)
	}
	if cfg.Listen != ":18080" {
		t.Fatalf("应退回默认值：%q", cfg.Listen)
	}
}

func writeFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("写测试配置：%v", err)
	}
	return path
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	return info.Mode()
}
