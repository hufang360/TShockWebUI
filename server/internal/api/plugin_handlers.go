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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

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
		s.writePluginError(ctx, w, &sess, client, tshock.CapCommands, err)
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
		s.writePluginError(ctx, w, &sess, client, tshock.CapMe, err)
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
		s.writePluginError(ctx, w, &sess, client, tshock.CapData, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"type": dataType, "items": items})
}

// handleServerInfo 返回世界事件 / Boss 进度等增强状态（按上游 30s 缓存，多玩家共享）。
func (s *Server) handleServerInfo(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	hub := s.hubFor(client)
	if info := hub.world(30 * time.Second); info != nil {
		writeJSON(w, http.StatusOK, info)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	info, err := client.ServerInfo(ctx, sess.TShockToken)
	if err != nil {
		s.writePluginError(ctx, w, &sess, client, tshock.CapServerInfo, err)
		return
	}
	hub.setWorld(info)
	writeJSON(w, http.StatusOK, info)
}

// legacyTailFetch 旧插件（含 RC2）没有 events_history 能力：
// 它们只有内存环形缓冲（旧版 Capacity=500），因此拉一次 since=0 再取尾部来模拟 tail。
const (
	legacyTailFetch    = 500
	defaultTailCount   = 100
	streamEventsLimit  = 200
	streamPingInterval = 15 * time.Second
)

// handleEvents 返回服务器动态事件流。
//
//   - 不传 tail：增量轮询（since=&limit=），行为与旧版一致；
//   - 传 tail=N：取最新 N 条（用于「打开网页先看最近 N 条」）。
//     新插件走 /webui/events?tail=N；旧插件自动降级为「拉一页再取尾部」。
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	if tailRaw := strings.TrimSpace(r.URL.Query().Get("tail")); tailRaw != "" {
		tail, _ := strconv.Atoi(tailRaw)
		if tail <= 0 {
			tail = defaultTailCount
		}
		page, err := s.eventsTail(ctx, client, sess.TShockToken, tail)
		if err != nil {
			s.writePluginError(ctx, w, &sess, client, tshock.CapEventsHistory, err)
			return
		}
		s.observeEventsInstance(client, page)
		writeJSON(w, http.StatusOK, page)
		return
	}

	since, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("since")), 10, 64)
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))

	page, err := client.Events(ctx, sess.TShockToken, since, limit)
	if err != nil {
		s.writePluginError(ctx, w, &sess, client, tshock.CapEvents, err)
		return
	}
	s.observeEventsInstance(client, page)
	writeJSON(w, http.StatusOK, page)
}

// observeEventsInstance 把非流式端点看到的实例身份告诉 hub：
// 同地址换服时作废旧缓存，并让正在看 SSE 的页面重新同步。
func (s *Server) observeEventsInstance(client *tshock.Client, page *tshock.EventsPage) {
	if page == nil || page.Instance == "" {
		return
	}
	if s.hubFor(client).observeInstance(page.Instance) {
		s.invalidateFeedCaches(client.BaseURL())
	}
}

// eventsTail 取最新 N 条：新插件直接 tail；旧插件拉一页后取尾部。
func (s *Server) eventsTail(ctx context.Context, client *tshock.Client, token string, tail int) (*tshock.EventsPage, error) {
	meta := s.pluginMeta(ctx, client)
	if meta != nil && meta.Has(tshock.CapEventsHistory) {
		return client.EventsTail(ctx, token, tail)
	}
	page, err := client.Events(ctx, token, 0, legacyTailFetch)
	if err != nil {
		return nil, err
	}
	if len(page.Events) > tail {
		page.Events = page.Events[len(page.Events)-tail:]
	}
	if len(page.Events) > 0 {
		page.FirstSeq = page.Events[0].Seq
	}
	return page, nil
}

// pluginMeta 返回插件 meta（按上游 60s 缓存）；失败 / 未安装返回 nil。
// 用于 tail 能力判定，避免每次请求都打一次插件。
func (s *Server) pluginMeta(ctx context.Context, client *tshock.Client) *tshock.PluginMeta {
	key := client.BaseURL()
	s.metaMu.Lock()
	if e, ok := s.metaCache[key]; ok && time.Since(e.at) < 60*time.Second {
		s.metaMu.Unlock()
		return e.meta
	}
	s.metaMu.Unlock()

	meta, err := client.FetchMeta(ctx, s.cfg.WebAuthSecret)
	if err != nil {
		return nil
	}
	s.metaMu.Lock()
	s.metaCache[key] = metaCacheEntry{meta: meta, at: time.Now()}
	s.metaMu.Unlock()
	return meta
}

// handleEventsStream 以 SSE 持续推送服务器动态（网页打开「动态」时用）。
//
// 走每个上游**共享**的 eventHub（见 feedhub.go）：只有一个 goroutine 轮询插件，
// fan-out 给所有订阅者 —— TShock 请求数与在线人数无关。
//
//   - 建连时先拉一次：token 失效等情况返回常规 JSON 错误，前端好降级；
//   - 随后先发 hub 缓存里的增量与世界状态，再持续读订阅通道；
//   - 心跳注释帧每 streamPingInterval 一次；客户端断开即结束。
func (s *Server) handleEventsStream(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("since")), 10, 64)

	// 建连先拉一次：既有数据立即下发，也能在 token 失效时返回常规 JSON 错误。
	ctx0, cancel0 := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	first, err := client.Events(ctx0, sess.TShockToken, since, streamEventsLimit)
	cancel0()
	if err != nil {
		s.writePluginError(r.Context(), w, &sess, client, tshock.CapEvents, err)
		return
	}

	hub := s.hubFor(client)
	// 建连时先看一次实例：同一个地址 / 端口后面换了服时，旧事件 / 世界状态都不再属于当前服，
	// 直接发一帧 reset 让前端重同步，不再下发旧实例的 first / backlog。
	reset := hub.observeInstance(first.Instance)
	if reset {
		s.invalidateFeedCaches(client.BaseURL())
	}
	sub := hub.subscribe(sess.TShockToken)
	defer hub.unsubscribe(sub)

	rc := http.NewResponseController(w)
	// 关掉 WriteTimeout（Server 默认 60s）：SSE 需要长连接。
	_ = rc.SetWriteDeadline(time.Time{})
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "retry: 3000\n\n")

	lastSeq := since
	if reset {
		lastSeq = 0
	}
	writeMessage := func(e tshock.ServerEvent) {
		if e.Seq <= lastSeq {
			return
		}
		writeSSE(w, e.Seq, "message", e)
		lastSeq = e.Seq
	}
	if reset {
		writeSSE(w, 0, "reset", map[string]string{"instance": first.Instance})
	} else {
		// 建连那一次的结果 + hub 缓存的增量（重连 / 多标签时补齐缺口）。
		for _, e := range first.Events {
			writeMessage(e)
		}
		for _, e := range hub.backlog(lastSeq) {
			writeMessage(e)
		}
		if info := hub.world(30 * time.Second); info != nil {
			writeSSE(w, 0, "world", info)
		}
	}
	_ = rc.Flush()

	ping := time.NewTicker(streamPingInterval)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-sub.ch:
			switch ev.kind {
			case feedMessage:
				writeMessage(ev.event)
			case feedWorld:
				if ev.world != nil {
					writeSSE(w, 0, "world", ev.world)
				}
			case feedReset:
				// 换了实例：前端清空列表后重拉；本连接从新实例的 seq 0 重新计。
				// 旧实例的帧一定排在这一帧之前（同一个通道、顺序写入），客户端收到 reset 就清空，
				// 所以这里不需要丢弃任何帧 —— 丢后面的反而会把新实例的事件弄丢。
				lastSeq = 0
				writeSSE(w, 0, "reset", map[string]string{"instance": ev.instance})
			case feedError:
				writeSSEError(w, ev.code, "事件流已失效")
				_ = rc.Flush()
				return
			}
			_ = rc.Flush()
		case <-ping.C:
			_, _ = io.WriteString(w, ": ping\n\n")
			_ = rc.Flush()
		}
	}
}

// writeSSE 写一帧 SSE 消息（含 id）。
func writeSSE(w io.Writer, id int64, event string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	if id > 0 {
		fmt.Fprintf(w, "id: %d\n", id)
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

// writeSSEError 写一帧 SSE 错误（前端据此降级 / 提示）。
func writeSSEError(w io.Writer, code, message string) {
	data, _ := json.Marshal(map[string]string{"code": code, "message": message})
	fmt.Fprintf(w, "event: error\ndata: %s\n\n", data)
}

type chatRequest struct {
	Text string `json:"text"`
}

// handleChat 把网页端提交的文本作为「网页发言」发到游戏内聊天。
//
//	POST /api/chat {"text":"..."} → {name,text,line}
//
// 消息由插件统一加 [WebUI] 前缀并标明账号名，与真实在线玩家区分；不提权、不伪造身份。
func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	sess, client, ok := s.requireSessionAndClient(w, r)
	if !ok {
		return
	}
	var req chatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "请求体格式错误")
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "发言内容不能为空")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	res, err := client.SendChat(ctx, sess.TShockToken, req.Text)
	if err != nil {
		s.writeChatError(w, &sess, s.refinePluginError(ctx, client, tshock.CapChat, err))
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// writeChatError 把网页发言的错误映射为 API 错误信封（尽量保留插件原文）。
func (s *Server) writeChatError(w http.ResponseWriter, sess *session.Session, err error) {
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "网页发言返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w, *sess)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNotFound:
		writeError(w, http.StatusNotImplemented, codePluginMissing, "服务器未安装 WebUI 信使插件")
	case tshock.KindPluginOutdated:
		writeError(w, http.StatusNotImplemented, codePluginOutdated, e.Message)
	case tshock.KindPluginProtocolError:
		writeError(w, http.StatusNotImplemented, codePluginProtocol, e.Message)
	case tshock.KindRateLimited:
		msg := e.Message
		if msg == "" {
			msg = "发言过于频繁，请稍后再试"
		}
		writeError(w, http.StatusTooManyRequests, codeRateLimited, msg)
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		msg := e.Message
		if msg == "" {
			msg = "权限不足"
		}
		writeError(w, http.StatusForbidden, codeNoPermission, msg)
	case tshock.KindBadRequest:
		writeError(w, http.StatusBadRequest, codeBadRequest, e.Message)
	case tshock.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
	case tshock.KindUnavailable:
		writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
	default:
		writeError(w, http.StatusBadGateway, codeBadResponse, "网页发言返回异常")
	}
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
		s.writePluginError(ctx, w, &sess, client, tshock.CapSessions, err)
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
		s.writePluginError(ctx, w, &sess, client, tshock.CapSessions, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"revoked": n})
}

// handlePluginStatus 返回当前上游的信使插件握手结果（版本 / 协议 / 能力 / 兼容性）。
//
//	GET /api/plugin/status → tshock.PluginStatus
//
// 不需要登录（只用共享 secret 调 /webui/meta），供「设置 → 信使插件」快速定位问题。
func (s *Server) handlePluginStatus(w http.ResponseWriter, r *http.Request) {
	client, ok := s.clientFor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TShockTimeout)
	defer cancel()

	st, err := client.PluginStatus(ctx, s.cfg.WebAuthSecret)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) {
			switch e.Kind {
			case tshock.KindTimeout:
				writeError(w, http.StatusGatewayTimeout, codeTShockTimeout, "TShock 响应超时，请重试")
				return
			case tshock.KindUnavailable:
				writeError(w, http.StatusBadGateway, codeTShockUnavail, "TShock 服务不可用")
				return
			}
		}
		writeError(w, http.StatusBadGateway, codeBadResponse, "无法读取插件信息")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// refinePluginError：当插件端点返回 404（KindNotFound）时，尝试用 /webui/meta 区分
// 「未安装」「版本过旧（缺端点/能力）」「协议不匹配」，返回更精确的 *tshock.APIError。
// meta 不可得（旧插件 / 确实没装）时原样返回，保持 plugin_not_installed 语义。
func (s *Server) refinePluginError(ctx context.Context, client *tshock.Client, feature string, err error) error {
	var e *tshock.APIError
	if !errors.As(err, &e) || e.Kind != tshock.KindNotFound {
		return err
	}
	meta, merr := client.FetchMeta(ctx, s.cfg.WebAuthSecret)
	if merr != nil || meta == nil {
		return err
	}
	return tshock.ClassifyFeature(meta, feature)
}

// writePluginError 把新插件端点的错误映射为 API 错误信封（与 writeBatchError 类似，
// 但文案用「插件」泛指，避免与 PlayerManager 混淆）。
func (s *Server) writePluginError(ctx context.Context, w http.ResponseWriter, sess *session.Session, client *tshock.Client, feature string, err error) {
	err = s.refinePluginError(ctx, client, feature, err)
	var e *tshock.APIError
	if !errors.As(err, &e) {
		writeError(w, http.StatusBadGateway, codeBadResponse, "信使插件返回异常")
		return
	}
	switch e.Kind {
	case tshock.KindTokenInvalid:
		s.sessions.Delete(sess.ID)
		s.clearSessionCookie(w, *sess)
		writeError(w, http.StatusUnauthorized, codeTokenInvalid, "登录状态已失效，请重新登录")
	case tshock.KindNoPermission, tshock.KindNoAPIPermission:
		writeError(w, http.StatusForbidden, codeNoPermission, "权限不足")
	case tshock.KindPluginOutdated:
		writeError(w, http.StatusNotImplemented, codePluginOutdated, e.Message)
	case tshock.KindPluginProtocolError:
		writeError(w, http.StatusNotImplemented, codePluginProtocol, e.Message)
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
