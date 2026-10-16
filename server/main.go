// Command tswui 是 TShockWebUI 的单二进制后端：
// 内嵌前端静态资源 + 固定 /api/* + 内存会话 + TShock REST 客户端。
//
// 架构与契约见 docs/ARCHITECTURE.md 与 docs/API_SPEC.md。
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"tshockwebui/server/internal/api"
	"tshockwebui/server/internal/config"
	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

// version 是构建版本号，由构建脚本注入：
//
//	go build -ldflags "-s -w -X main.version=1.2.3"
//
// 见 scripts/build-binary.sh（VERSION 环境变量）与根 Dockerfile（VERSION 构建参数）。
// 未注入时为 "dev"。
var version = "dev"

// embeddedWebdist 内嵌前端构建产物（构建期由 Dockerfile / 脚本拷入 internal/webdist）。
//
//go:embed all:internal/webdist
var embeddedWebdist embed.FS

func main() {
	showVersion := flag.Bool("version", false, "打印版本信息并退出")
	flag.Parse()
	if *showVersion {
		fmt.Println(versionLine())
		return
	}

	if err := run(); err != nil {
		slog.Error("启动失败", "error", err)
		os.Exit(1)
	}
}

// versionLine 是 `-version` 的输出（含 Go 版本与目标平台，便于排查平台/架构问题）。
func versionLine() string {
	return fmt.Sprintf("tswui %s (%s %s/%s)", version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.LogLevel)
	slog.SetDefault(logger)
	logger.Info("TShockWebUI 后端启动", "version", version, "config", cfg.LogValue())

	webFS, err := resolveWebFS(cfg.WebDistDir)
	if err != nil {
		return err
	}

	client := tshock.NewClient(cfg.TShockURL, cfg.TShockTimeout, logger, tshock.WithMethod(cfg.TShockMethod))
	store := session.New(cfg.SessionTTL, cfg.MaxSessions)
	commands := tshock.DefaultCommands()
	logger.Info("已加载 Tier A 指令白名单", "count", commands.Count())

	srv := api.New(api.Deps{
		Config:   cfg,
		Version:  version,
		Sessions: store,
		TShock:   client,
		Commands: commands,
		Web:      webFS,
		Logger:   logger,
	})

	httpServer := &http.Server{
		Addr:              cfg.Listen,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("开始监听", "addr", cfg.Listen)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("HTTP 服务异常退出：%w", err)
	case <-ctx.Done():
		logger.Info("收到退出信号，开始优雅关闭")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("优雅关闭失败：%w", err)
	}
	logger.Info("已关闭")
	return nil
}

// resolveWebFS 返回前端静态资源文件系统。
// WEB_DIST_DIR 非空时从磁盘读取（本地开发），否则使用内嵌资源。
func resolveWebFS(dir string) (fs.FS, error) {
	if dir != "" {
		info, err := os.Stat(dir)
		if err != nil {
			return nil, fmt.Errorf("WEB_DIST_DIR 不可用：%w", err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("WEB_DIST_DIR 不是目录：%s", dir)
		}
		slog.Default().Info("使用磁盘前端资源（开发模式）", "dir", dir)
		return os.DirFS(dir), nil
	}
	sub, err := fs.Sub(embeddedWebdist, "internal/webdist")
	if err != nil {
		return nil, fmt.Errorf("读取内嵌前端资源失败：%w", err)
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, errors.New("内嵌前端资源缺少 index.html：请先构建前端并拷入 internal/webdist（或用 WEB_DIST_DIR 覆盖）")
	}
	return sub, nil
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
