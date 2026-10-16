package tshock

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultCommandsLoaded(t *testing.T) {
	idx := DefaultCommands()
	if idx.Count() == 0 {
		t.Fatal("commands.json 未加载到任何指令")
	}
}

func TestCheckRealData(t *testing.T) {
	idx := DefaultCommands()

	cases := []struct {
		cmd      string
		rejected bool
		marker   string
	}{
		{"/time 12:00", false, ""},
		{"time", false, ""},             // 缺少前导 / 也可识别
		{"/i 29", true, "in_game_only"}, // item 别名，allowServer=false
		{"/item 29", true, "in_game_only"},
		// 未知/插件指令不前置拒绝，交由 TShock 判定
		{"/definitely-not-a-command", false, "unknown"},
		{"/fish", false, "unknown"},
		{"   ", true, "unknown"},
	}
	for _, tc := range cases {
		out := idx.Check(tc.cmd)
		if out.Rejected != tc.rejected || out.Marker != tc.marker {
			t.Errorf("Check(%q) = {rejected=%v marker=%q}，期望 {rejected=%v marker=%q}",
				tc.cmd, out.Rejected, out.Marker, tc.rejected, tc.marker)
		}
	}
}

func TestCheckAliasResolvesToCanonical(t *testing.T) {
	idx := DefaultCommands()
	out := idx.Check("/i 29")
	if out.Def == nil || out.Def.Name != "item" {
		t.Fatalf("别名 i 未解析到 item：%+v", out.Def)
	}
	if out.Def.AllowServer {
		t.Fatal("item 的 allowServer 应为 false")
	}
}

func TestFirstToken(t *testing.T) {
	cases := map[string]string{
		"/time 12:00":   "time",
		"time":          "time",
		"///help":       "help",
		"  /seed  abc":  "seed",
		"\n/who\n/list": "who",
		"":              "",
		"   ":           "",
	}
	for in, want := range cases {
		if got := FirstToken(in); got != want {
			t.Errorf("FirstToken(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func TestLoadCommandsInvalidJSON(t *testing.T) {
	if _, err := LoadCommands([]byte("{not json")); err == nil {
		t.Fatal("非法 JSON 应报错")
	}
}

// TestEmbeddedCommandsMatchesRepo 防止内嵌副本与仓库根的 data/commands.json 漂移。
// 仓库根数据不存在时（例如仅在 server/ 内构建）跳过。
func TestEmbeddedCommandsMatchesRepo(t *testing.T) {
	repoFile := filepath.Join("..", "..", "..", "data", "commands.json")
	want, err := os.ReadFile(repoFile)
	if err != nil {
		t.Skipf("跳过：读取仓库根 commands.json 失败：%v", err)
	}

	var a, b struct {
		Meta     map[string]any `json:"meta"`
		Commands any            `json:"commands"`
	}
	if err := json.Unmarshal(want, &a); err != nil {
		t.Fatalf("解析仓库根 commands.json 失败：%v", err)
	}
	if err := json.Unmarshal(commandsJSON, &b); err != nil {
		t.Fatalf("解析内嵌 commands.json 失败：%v", err)
	}
	// 比较指令数量，避免因格式化差异误报。
	ca, _ := a.Commands.([]any)
	cb, _ := b.Commands.([]any)
	if len(ca) != len(cb) {
		t.Fatalf("内嵌副本已过期：仓库 %d 条，内嵌 %d 条；请运行 server/scripts/sync-commands.sh", len(ca), len(cb))
	}
}
