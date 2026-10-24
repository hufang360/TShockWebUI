package api

// 物资申请（信使插件 WebUI 的 /webui/requests*）。
//
//   GET  /api/requests/capabilities → {plugin, submit, review}
//   GET  /api/requests?status=      → 我的申请
//   POST /api/requests              → 提交申请
//   POST /api/requests/cancel       → 撤回自己的待审申请
//   GET  /api/requests/all?status=  → 审核列表（需 webui.request.review）
//   POST /api/requests/review       → 审核（approve / deny）
//   POST /api/requests/deliver      → 补发
//
// 权限仍由插件 / TShock 判定；本层只做参数校验、限流与错误映射，不传递玩家名。

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

const (
	maxRequestItems = 10
	maxRequestStack = 999999
	maxRequestText  = 200
)

type requestCreatePayload struct {
	Items  []tshock.RequisitionItem `json:"items"`
	Reason string                   `json:"reason"`
	Note   string                   `json:"note"`
}

type requestIDPayload struct {
	ID int `json:"id"`
}

type requestReviewPayload struct {
	ID       int    `json:"id"`
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

// handleRequestCapabilities 探测物资申请模块：插件是否声明 requests / requests_review，
// 以及当前 token 用户是否有提交 / 审核权限。
func (s *Server) handleRequestCapabilities(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	// 探测逻辑与 /api/capabilities 共用（capabilities.go 的 probeRequests）。
	cap, err := s.probeRequests(ctx, sess.TShockToken, client)
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequests, err)
		return
	}
	switch cap.Reason {
	case tshock.ReasonProtocolMismatch:
		writeError(w, http.StatusNotImplemented, codePluginProtocol,
			"WebUI 插件与后端协议不兼容，请升级插件或后端")
		return
	case tshock.ReasonMissingCapabilities:
		writeError(w, http.StatusNotImplemented, codePluginOutdated,
			"服务器上的 WebUI 插件版本过旧，不支持物资申请，请升级插件")
		return
	}
	writeJSON(w, http.StatusOK, cap)
}

func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	list, err := client.RequestList(ctx, sess.TShockToken, r.URL.Query().Get("status"))
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequests, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": list})
}

func (s *Server) handleAllRequests(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	list, err := client.AllRequests(ctx, sess.TShockToken, r.URL.Query().Get("status"))
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequestsReview, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": list})
}

func (s *Server) handleCreateRequest(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req requestCreatePayload
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}

	items := make([]tshock.RequisitionItem, 0, len(req.Items))
	for _, it := range req.Items {
		if it.ID < 1 || it.ID >= 10_000_000 || it.Stack < 1 || it.Stack > maxRequestStack {
			writeError(w, http.StatusBadRequest, codeBadRequest, "物品或数量不合法")
			return
		}
		items = append(items, it)
	}
	if len(items) == 0 || len(items) > maxRequestItems {
		writeError(w, http.StatusBadRequest, codeBadRequest, "一次最多申请 10 种物品")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	note := strings.TrimSpace(req.Note)
	if reason == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请填写申请用途")
		return
	}
	if !validRequestText(reason) || !validRequestText(note) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "申请文字过长或包含非法字符")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	out, err := client.CreateRequest(ctx, sess.TShockToken, items, reason, note)
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequests, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": out})
}

func (s *Server) handleCancelRequest(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req requestIDPayload
	if err := decodeJSON(r, &req); err != nil || req.ID < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "id 不合法")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	out, err := client.CancelRequest(ctx, sess.TShockToken, req.ID)
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequests, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": out})
}

func (s *Server) handleReviewRequest(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req requestReviewPayload
	if err := decodeJSON(r, &req); err != nil || req.ID < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "id 不合法")
		return
	}
	decision := strings.ToLower(strings.TrimSpace(req.Decision))
	if decision != "approve" && decision != "deny" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "decision 必须是 approve 或 deny")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if !validRequestText(reason) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "拒绝原因过长或包含非法字符")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	out, err := client.ReviewRequest(ctx, sess.TShockToken, req.ID, decision, reason)
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequestsReview, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": out})
}

func (s *Server) handleDeliverRequest(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req requestIDPayload
	if err := decodeJSON(r, &req); err != nil || req.ID < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "id 不合法")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	out, err := client.DeliverRequest(ctx, sess.TShockToken, req.ID)
	if err != nil {
		s.writeRequestError(ctx, w, &sess, client, tshock.CapRequestsReview, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": out})
}

// validRequestText 校验申请文字：最多 200 字符，不含控制字符。
func validRequestText(s string) bool {
	if s == "" {
		return true
	}
	if utf8.RuneCountInString(s) > maxRequestText {
		return false
	}
	return !strings.ContainsAny(s, "\x00\r\n")
}

func isRequestNoPermission(err error) bool {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		return false
	}
	return e.Kind == tshock.KindNoPermission || e.Kind == tshock.KindNoAPIPermission
}

// writeRequestError 把物资申请调用错误映射为 API 错误信封。
// 业务错误（插件 400）保留原文，方便玩家看到「超出上限」「物品被禁用」等具体原因。
func (s *Server) writeRequestError(ctx context.Context, w http.ResponseWriter, sess *session.Session, client *tshock.Client, feature string, err error) {
	err = s.refinePluginError(ctx, client, feature, err)
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "物资申请返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w, *sess)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		// TShock 的 403 文案是通用的「没有权限使用指定的 API 终结点」，
		// 这里换成可操作的具体权限节点，避免玩家猜。
		writeError(w, http.StatusForbidden, codeNoPermission,
			"缺少物资申请权限：提交需要 webui.request.use，审核 / 补发需要 webui.request.review。请联系服主授予。")
	case tshock.KindBadRequest, tshock.KindPluginBusiness:
		msg := strings.TrimSpace(e.Message)
		if msg == "" {
			msg = "物资申请失败"
		}
		writeError(w, http.StatusBadRequest, codeRequestError, msg)
	case tshock.KindPluginOutdated:
		writeError(w, http.StatusNotImplemented, codePluginOutdated, e.Message)
	case tshock.KindPluginProtocolError:
		writeError(w, http.StatusNotImplemented, codePluginProtocol, e.Message)
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 WebUI 信使插件")
	case tshock.KindRateLimited:
		msg := strings.TrimSpace(e.Message)
		if msg == "" {
			msg = "操作过于频繁，请稍后再试"
		}
		writeError(w, http.StatusTooManyRequests, codeRateLimited, msg)
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "物资申请返回异常")
	}
}
