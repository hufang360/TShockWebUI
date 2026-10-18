package tshock

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestPluginStatusVersioned(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/meta" {
			t.Errorf("path = %s", r.URL.Path)
		}
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.2.0", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"commands", "me", "data", "serverinfo", "events", "sessions", "batch", "chat"},
		})
	}), time.Second)

	st, err := c.PluginStatus(context.Background(), "")
	if err != nil {
		t.Fatalf("PluginStatus: %v", err)
	}
	if !st.Installed || st.Legacy || !st.Compatible || st.Reason != "ok" {
		t.Fatalf("st = %+v", st)
	}
	if st.Version != "0.2.0" || st.BackendProtocol != BackendProtocol {
		t.Fatalf("st = %+v", st)
	}
}

// 插件协议与后端不兼容：protocol=0（minProtocol 0）时后端协议 1 落在 [0,0] 之外。
func TestPluginStatusProtocolMismatch(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "1.0.0", "protocol": 0, "minProtocol": 0,
			"capabilities": []string{"chat"},
		})
	}), time.Second)

	st, err := c.PluginStatus(context.Background(), "")
	if err != nil {
		t.Fatalf("PluginStatus: %v", err)
	}
	if st.Compatible || st.Reason != "protocol_mismatch" {
		t.Fatalf("st = %+v，期望 protocol_mismatch", st)
	}
}

// 协议兼容但缺少后端需要的能力。
func TestPluginStatusMissingCapabilities(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "WebUI", "version": "0.1.0", "protocol": 1, "minProtocol": 1,
			"capabilities": []string{"me", "chat"},
		})
	}), time.Second)

	st, err := c.PluginStatus(context.Background(), "")
	if err != nil {
		t.Fatalf("PluginStatus: %v", err)
	}
	if st.Compatible || st.Reason != "missing_capabilities" {
		t.Fatalf("st = %+v，期望 missing_capabilities", st)
	}
	if len(st.Missing) == 0 {
		t.Fatalf("应列出缺少的能力：%+v", st)
	}
}

// 没有 /webui/meta：用在线授权探测判定。探测返回业务错误（缺 name）→ 旧版插件。
func TestPluginStatusLegacy(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/webui/meta":
			http.NotFound(w, r)
		case "/webui/auth/request":
			writeJSON(w, 200, map[string]any{"status": "200", "code": "missing_name", "error": "缺少 name"})
		default:
			http.NotFound(w, r)
		}
	}), time.Second)

	st, err := c.PluginStatus(context.Background(), "")
	if err != nil {
		t.Fatalf("PluginStatus: %v", err)
	}
	if !st.Installed || !st.Legacy || !st.Compatible || st.Reason != "legacy" {
		t.Fatalf("st = %+v，期望 legacy", st)
	}
}

// 未安装：meta 与在线授权都 404。
func TestPluginStatusNotInstalled(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}), time.Second)

	st, err := c.PluginStatus(context.Background(), "")
	if err != nil {
		t.Fatalf("PluginStatus: %v", err)
	}
	if st.Installed || st.Compatible || st.Reason != "not_installed" {
		t.Fatalf("st = %+v，期望 not_installed", st)
	}
}

func TestClassifyFeature(t *testing.T) {
	full := &PluginMeta{Version: "0.2.0", Protocol: 1, MinProtocol: 1, Capabilities: []string{"chat"}}

	if e := ClassifyFeature(full, "chat"); e.Kind != KindPluginOutdated {
		t.Fatalf("端点与声明不一致应为 outdated：%+v", e)
	}
	if e := ClassifyFeature(full, "batch"); e.Kind != KindPluginOutdated || e.Message == "" {
		t.Fatalf("缺能力应为 outdated：%+v", e)
	}

	old := &PluginMeta{Version: "1.0.0", Protocol: 0, MinProtocol: 0, Capabilities: []string{"chat"}}
	if e := ClassifyFeature(old, "chat"); e.Kind != KindPluginProtocolError {
		t.Fatalf("协议不兼容应为 plugin_protocol_mismatch：%+v", e)
	}
}
