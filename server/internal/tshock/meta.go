package tshock

// 插件与后端的协议握手（信使插件 WebUI 的 /webui/meta 端点）。
//
//   - 插件声明：版本号 version、协议号 protocol、仍兼容的最旧后端协议 minProtocol、能力清单 capabilities[]。
//   - 后端声明：BackendProtocol。兼容条件 = minProtocol <= BackendProtocol <= protocol，且要求能力都在清单里。
//   - 用途：① 诊断端点给前端展示「装没装 / 什么版本 / 哪些能力」；
//           ② 某端点 404 时，用 meta 区分「未安装」「版本过旧」「协议不匹配」，给出可定位的错误。
//
// 约定：破坏性改动才 +1 协议号；只新增端点 / 字段时扩充能力清单，不动协议号。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
)

const (
	metaPath = "/webui/meta"

	// BackendProtocol 是后端当前实现的协议号（与插件 Meta.Protocol 对应）。
	// 破坏性变更 +1；新增能力只扩充能力清单。
	BackendProtocol = 1
)

// 能力名（与插件 Meta.Capabilities() 一一对应，勿随意改名）。
const (
	CapAuth       = "auth"
	CapBatch      = "batch"
	CapCommands   = "commands"
	CapMe         = "me"
	CapData       = "data"
	CapServerInfo = "serverinfo"
	CapEvents     = "events"
	// CapEventsHistory：新插件支持 /webui/events?tail=N（磁盘历史 + 取最新 N 条）。
	// 旧插件（含 RC2）没有此能力，后端会自动降级为「拉 since=0 再取尾部」。
	CapEventsHistory = "events_history"
	// CapEventsInstance：新插件在 /webui/events 响应里返回 instance（事件库实例标识）。
	// 同一个地址 / 端口下换了服（另一份存档目录）时它会变，后端据此作废旧缓存；
	// 旧插件没有这个字段，后端退回「seq 回退」启发式。
	CapEventsInstance = "events_instance"
	CapSessions       = "sessions"
	CapChat           = "chat"
	// CapRequests：物资申请（/webui/requests、/create、/cancel）。
	CapRequests = "requests"
	// CapRequestsReview：物资申请审核 / 补发（/webui/requests/all、/review、/deliver）。
	CapRequestsReview = "requests_review"
)

// RequiredCapabilities 是后端会用到、期望插件声明具备的能力。
var RequiredCapabilities = []string{
	CapCommands, CapMe, CapData, CapServerInfo, CapEvents, CapSessions, CapBatch, CapChat,
}

// 握手不兼容的原因（PluginStatus.Reason 与 RequestCapabilities.Reason 共用）。
const (
	ReasonOK                  = "ok"
	ReasonNotInstalled        = "not_installed"
	ReasonLegacy              = "legacy"
	ReasonProtocolMismatch    = "protocol_mismatch"
	ReasonMissingCapabilities = "missing_capabilities"
)

// PluginMeta 是 /webui/meta 的结果。
type PluginMeta struct {
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Protocol     int      `json:"protocol"`
	MinProtocol  int      `json:"minProtocol"`
	Capabilities []string `json:"capabilities"`
}

// Has 判断插件是否声明具备某能力。
func (m *PluginMeta) Has(capability string) bool {
	if m == nil {
		return false
	}
	for _, c := range m.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

// ProtocolCompatible 判断插件协议是否兼容当前后端协议。
func (m *PluginMeta) ProtocolCompatible() bool {
	if m == nil {
		return false
	}
	return m.MinProtocol <= BackendProtocol && BackendProtocol <= m.Protocol
}

// MissingCapabilities 返回 required 中插件未声明具备的能力。
func (m *PluginMeta) MissingCapabilities(required []string) []string {
	missing := []string{}
	for _, c := range required {
		if !m.Has(c) {
			missing = append(missing, c)
		}
	}
	sort.Strings(missing)
	return missing
}

// FetchMeta 调 /webui/meta。
//
//	返回 (nil, nil) 表示 404：插件未安装 **或** 是「无 meta 的旧版插件」，调用方需另法判定。
//	其它错误（403 密钥不匹配 / 超时 / 服务不可用）原样返回。
func (c *Client) FetchMeta(ctx context.Context, secret string) (*PluginMeta, error) {
	q := url.Values{}
	setSecret(q, secret)
	status, body, err := c.do(ctx, metaPath, q)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	if e := classify(status, body); e != nil {
		return nil, e
	}
	var meta PluginMeta
	if err := json.Unmarshal(body, &meta); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "插件 meta 返回非法 JSON"}
	}
	return &meta, nil
}

// PluginStatus 是某上游的插件握手结果（供诊断端点与前端展示）。
type PluginStatus struct {
	Installed       bool     `json:"installed"`
	Legacy          bool     `json:"legacy"`
	Version         string   `json:"version,omitempty"`
	Protocol        int      `json:"protocol"`
	MinProtocol     int      `json:"minProtocol"`
	Capabilities    []string `json:"capabilities"`
	BackendProtocol int      `json:"backendProtocol"`
	Compatible      bool     `json:"compatible"`
	Missing         []string `json:"missingCapabilities,omitempty"`
	// Reason ∈ ok | not_installed | legacy | protocol_mismatch | missing_capabilities
	Reason string `json:"reason"`
}

// PluginStatus 探测某上游插件状态：
//
//   - 有 /webui/meta → 版本化插件，按协议 + 能力判定兼容性；
//   - 无 /webui/meta → 用在线授权探测区分「未安装」与「旧版插件（无 meta）」；
//   - 探测本身失败（超时 / 服务不可用）→ 返回错误。
func (c *Client) PluginStatus(ctx context.Context, secret string) (*PluginStatus, error) {
	st := &PluginStatus{
		BackendProtocol: BackendProtocol,
		Capabilities:    []string{},
		Reason:          ReasonNotInstalled,
	}
	meta, err := c.FetchMeta(ctx, secret)
	if err != nil {
		return nil, err
	}
	if meta == nil {
		installed := true
		if perr := c.WebAuthProbe(ctx, secret); perr != nil {
			var e *APIError
			if errors.As(perr, &e) && e.Kind == KindNotFound {
				installed = false
			}
		}
		st.Installed = installed
		if installed {
			// 旧版插件：没有 meta，按「尽力兼容」处理，但明确标记 legacy。
			st.Legacy = true
			st.Compatible = true
			st.Reason = ReasonLegacy
		}
		return st, nil
	}

	st.Installed = true
	st.Version = meta.Version
	st.Protocol = meta.Protocol
	st.MinProtocol = meta.MinProtocol
	st.Capabilities = meta.Capabilities
	if st.Capabilities == nil {
		st.Capabilities = []string{}
	}
	st.Missing = meta.MissingCapabilities(RequiredCapabilities)

	switch {
	case !meta.ProtocolCompatible():
		st.Reason = ReasonProtocolMismatch
	case len(st.Missing) > 0:
		st.Reason = ReasonMissingCapabilities
	default:
		st.Compatible = true
		st.Reason = ReasonOK
	}
	return st, nil
}

// ClassifyFeature 在「端点 404 但 meta 可取到」时，给出可定位的错误：
//
//   - 协议不兼容 → KindPluginProtocolError
//   - 能力缺失 / 端点与声明不一致 → KindPluginOutdated
//
// feature 为空表示只判断协议兼容性。
func ClassifyFeature(meta *PluginMeta, feature string) *APIError {
	if meta == nil {
		return &APIError{Kind: KindNotFound, Message: "服务器未安装 WebUI 信使插件"}
	}
	who := fmt.Sprintf("WebUI %s（协议 %d，后端 %d）", meta.Version, meta.Protocol, BackendProtocol)
	if !meta.ProtocolCompatible() {
		return &APIError{
			Kind:    KindPluginProtocolError,
			Message: fmt.Sprintf("%s 与后端协议不兼容，请升级插件或后端", who),
		}
	}
	if feature != "" && !meta.Has(feature) {
		return &APIError{
			Kind:    KindPluginOutdated,
			Message: fmt.Sprintf("%s 不支持「%s」，请升级插件", who, feature),
		}
	}
	return &APIError{
		Kind:    KindPluginOutdated,
		Message: fmt.Sprintf("%s 缺少该端点，请升级插件", who),
	}
}
