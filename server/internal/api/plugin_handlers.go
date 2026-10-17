package api

// 信使插件 WebUI 的只读信息 / 会话管理端点（需登录）。
//
//   GET  /api/commands          运行时指令目录（含插件指令，供前端补全）
//   GET  /api/me                当前用户档案（组 / 权限 / 是否可登录）
//   GET  /api/data?type=        补全数据源（regions | warps | npcs | buffs）
//   GET  /api/serverinfo        世界事件 / Boss 进度等增强状态
//   GET  /api/events?since=     服务器动态事件流
//   GET  /api/sessions          本插件的 web 会话列表
//   POST /api/sessions/revoke   吊销指定的 / 全部（保留当前）web 会话
//
// 权限仍由插件 / TShock 判定，本层不提权；插件未安装时返回 plugin_not_installed。

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"tshockwebui/server/internal/session"
	"tshockwebui/server/internal/tshock"
)

// requireSessionAndClient 取会话与上游客户端；失败时已写响应并返回 false。
func (s *Server) requireSessionAndClient(w http.ResponseWriter, r *http.Request) (session.Session, *tshock.Client, bool) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return session.Session{}, nil, false
	}
	client, ok := s.clientFor(w, r)
	if !ok {
		return session.Session{}, nil, false
	}
	return sess, client, true
}

// handleRuntimeCommands 返回 TShock 运行时指令目录（含插件指令）。
func (s *Server) handleRuntimeCommands(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	cmds, err := client.CommandCatalog(ctx, sess.TShockToken)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"commands": cmds})
}

// handleMe 返回当前 token 用户档案。
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	me, err := client.Me(ctx, sess.TShockToken)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, me)
}

// handleData 返回补全数据源；type 必填。
func (s *Server) handleData(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	dataType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
	switch dataType {
	case "regions", "warps", "npcs", "buffs":
	default:
		writeError(w, http.StatusBadRequest, codeBadRequest, "type 必须是 regions/warps/npcs/buffs")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	items, err := client.DataList(ctx, sess.TShockToken, dataType)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"type": dataType, "items": items})
}

// handleServerInfo 返回世界事件 / Boss 进度等增强状态。
func (s *Server) handleServerInfo(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	info, err := client.ServerInfo(ctx, sess.TShockToken)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleEvents 返回服务器动态事件流。
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("since")), 10, 64)
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	page, err := client.Events(ctx, sess.TShockToken, since, limit)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// handleSessions 返回本插件的 web 会话列表。
func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	list, err := client.Sessions(ctx, sess.TShockToken)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list})
}

type revokeRequest struct {
	ID  string `json:"id"`
	All bool   `json:"all"`
}

// handleRevokeSessions 吊销指定的 / 全部（保留当前）web 会话。
func (s *Server) handleRevokeSessions(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req revokeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	if req.ID == "" && !req.All {
		writeError(w, http.StatusBadRequest, codeBadRequest, "缺少 id 或 all")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	n, err := client.RevokeSessions(ctx, sess.TShockToken, req.ID, req.All)
	if err != nil {
		s.writePluginError(w, &sess, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"revoked": n})
}

// writePluginError 把新插件端点的错误映射为 API 错误信封（与 writeBatchError 类似，
// 但文案用「插件」泛指，避免与 PlayerManager 混淆）。
func (s *Server) writePluginError(w http.ResponseWriter, sess *session.Session, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "信使插件返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		writeError(w, http.StatusForbidden, codeNoPermission, "权限不足")
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 WebUI 信使插件")
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "信使插件返回异常")
	}
}
