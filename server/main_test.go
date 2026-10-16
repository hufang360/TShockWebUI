package main

import (
	"runtime"
	"strings"
	"testing"
)

// 未通过 ldflags 注入时，版本号必须是 dev（构建脚本/Dockerfile 会注入）。
func TestVersionDefaultIsDev(t *testing.T) {
	if version != "dev" {
		t.Fatalf("未注入 ldflags 时 version 应为 dev，实际 %q", version)
	}
}

func TestVersionLine(t *testing.T) {
	old := version
	defer func() { version = old }()

	version = "v1.2.3"
	got := versionLine()
	if !strings.HasPrefix(got, "tswui v1.2.3 (") {
		t.Fatalf("versionLine() = %q", got)
	}
	if !strings.Contains(got, runtime.Version()) {
		t.Fatalf("versionLine() 应包含 Go 版本：%q", got)
	}
	if !strings.Contains(got, runtime.GOOS+"/"+runtime.GOARCH) {
		t.Fatalf("versionLine() 应包含目标平台：%q", got)
	}
}
