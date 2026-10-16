package tshock

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// DefaultPort 是 TShock REST 的默认端口。
const DefaultPort = 7878

// NormalizeTarget 规范化客户端通过 `X-TSWUI-Target` 提交的上游地址。
//
// 接受 "host"、"host:port"、"http://host[:port]"/"https://host[:port]"；
// 返回 "scheme://host:port"。空字符串返回 ""，表示使用后端配置的默认上游
// （TSHOCK_URL）。只允许 http/https，且不得携带路径、查询、片段或账号信息，
// 以限制后端出站请求的目标面（不放宽通用 URL 转发）。
func NormalizeTarget(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	withScheme := raw
	if !strings.Contains(withScheme, "://") {
		withScheme = "http://" + withScheme
	}
	u, err := url.Parse(withScheme)
	if err != nil {
		return "", fmt.Errorf("地址格式错误：%q", raw)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("仅支持 http/https 地址")
	}
	if u.User != nil {
		return "", fmt.Errorf("地址不能包含账号信息")
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("地址不能包含路径")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("地址不能包含查询参数")
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("缺少主机名")
	}
	port := u.Port()
	if port == "" {
		port = strconv.Itoa(DefaultPort)
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("端口不合法：%q", port)
	}
	return scheme + "://" + net.JoinHostPort(host, port), nil
}
