package api

// 统一能力矩阵（`GET /api/capabilities`）。
//
// 背景：前端以前要分别打 /api/batch|player|fish|requests/webauth/capabilities 与
// /api/plugin/status —— 启动时 4 次、首页 2 次、设置页 2 次，同一批插件被重复探测。
// 这里收敛成**一次**聚合请求：模块激活、首页「统一执行」、设置页模块状态都读它。
//
// 约定：
//   - 需要会话（所有探测都用当前玩家的 token，权限结果才准）；
//   - 各个探测**并行**；单个探测失败时降级为「不可用」，不让整个请求失败；
//   - `reachable=false` 表示上游 TShock 不可达/超时（此时其它字段不可信，前端忽略即可）；
//   - 3 秒微缓存（按上游 + 会话），`?fresh=1` 绕过（「重新检测」按钮用）。

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"tshockwebui/server/internal/tshock"
)

// capabilitiesCacheTTL 是聚合结果的微缓存时间。
// 启动时 App 与首页会各请求一次，短缓存避免把同一批探测打两遍。
const capabilitiesCacheTTL = 3 * time.Second

type webAuthCapability struct {
	Plugin bool `json:"plugin"`
}

// capabilitiesResponse 是 `GET /api/capabilities` 的响应（docs/API_SPEC.md §1.4）。
type capabilitiesResponse struct {
	// Reachable 为 false 表示上游 TShock 不可达 / 超时，其余字段不可信。
	Reachable bool                       `json:"reachable"`
	Messenger tshock.PluginStatus        `json:"messenger"`
	Batch     tshock.BatchCapability     `json:"batch"`
	Player    tshock.PlayerCapability    `json:"player"`
	Fish      tshock.FishCapability      `json:"fish"`
	Requests  tshock.RequestCapabilities `json:"requests"`
	WebAuth   webAuthCapability          `json:"webauth"`
}

// ---------- 单个探测（供 /api/capabilities 与各分端点共用） ----------

// probeMessenger 探测信使插件握手（版本 / 协议 / 能力）。
func (s *Server) probeMessenger(ctx context.Context, client *tshock.Client) (*tshock.PluginStatus, error) {
	return client.PluginStatus(ctx, s.cfg.WebAuthSecret)
}

// probeBatch 探测「批量执行」能力（信使插件 /webui/batch）。
func (s *Server) probeBatch(ctx context.Context, client *tshock.Client) (tshock.BatchCapability, error) {
	err := client.BatchProbe(ctx)
	if err == nil {
		return tshock.BatchCapability{Plugin: true, Ingame: s.cfg.AllowIngameCommands}, nil
	}
	var e *tshock.APIError
	if errors.As(err, &e) && e.Kind == tshock.KindNotFound {
		return tshock.BatchCapability{}, nil
	}
	return tshock.BatchCapability{}, err
}

// probePlayer 探测 PlayerManager（/pm/*）与 playermanager 权限。
func (s *Server) probePlayer(ctx context.Context, token string, client *tshock.Client) (tshock.PlayerCapability, error) {
	err := client.PlayerProbe(ctx, token)
	if err == nil {
		return tshock.PlayerCapability{Plugin: true, Permission: true}, nil
	}
	var e *tshock.APIError
	if errors.As(err, &e) {
		switch e.Kind {
		case tshock.KindNotFound:
			return tshock.PlayerCapability{}, nil
		case tshock.KindNoPermission:
			return tshock.PlayerCapability{Plugin: true}, nil
		}
	}
	return tshock.PlayerCapability{}, err
}

// probeFish 探测 FishShop（新旧前缀 + 版本过旧判定）。
func (s *Server) probeFish(ctx context.Context, token string, client *tshock.Client) (tshock.FishCapability, error) {
	err := client.FishProbe(ctx, token)
	if err == nil {
		return tshock.FishCapability{Plugin: true, REST: true, Permission: true}, nil
	}
	var e *tshock.APIError
	if errors.As(err, &e) {
		switch e.Kind {
		case tshock.KindNotFound:
			// 新旧前缀都 404：没装插件（rawcmd 也无法确认插件是否在跑）。
			return tshock.FishCapability{}, nil
		case tshock.KindPluginOutdated:
			// 插件在跑，但版本太老（v1.6.2 之前没有 REST 接口）。
			return tshock.FishCapability{Plugin: true}, nil
		case tshock.KindNoPermission:
			return tshock.FishCapability{Plugin: true, REST: true}, nil
		}
	}
	return tshock.FishCapability{}, err
}

// probeRequests 探测物资申请：插件能力 + 提交 / 审核权限。
func (s *Server) probeRequests(ctx context.Context, token string, client *tshock.Client) (tshock.RequestCapabilities, error) {
	meta, err := client.FetchMeta(ctx, s.cfg.WebAuthSecret)
	if err != nil {
		return tshock.RequestCapabilities{}, err
	}
	if meta == nil {
		// 没有 meta：没装插件，或者是「无 meta 的旧版插件」——都无法提供物资申请。
		return tshock.RequestCapabilities{Reason: tshock.ReasonNotInstalled}, nil
	}
	if !meta.ProtocolCompatible() {
		return tshock.RequestCapabilities{Reason: tshock.ReasonProtocolMismatch}, nil
	}
	if !meta.Has(tshock.CapRequests) {
		return tshock.RequestCapabilities{Reason: tshock.ReasonMissingCapabilities}, nil
	}

	cap := tshock.RequestCapabilities{Plugin: true}
	// 用真实端点探测提交权限：403 = 插件在装但缺 webui.request.use。
	if _, err := client.RequestList(ctx, token, ""); err != nil {
		if !isRequestNoPermission(err) {
			return cap, err
		}
	} else {
		cap.Submit = true
	}
	// 审核权限是可选能力：只有新插件声明 requests_review 才探测。
	if meta.Has(tshock.CapRequestsReview) {
		if _, err := client.AllRequests(ctx, token, ""); err != nil {
			if !isRequestNoPermission(err) {
				return cap, err
			}
		} else {
			cap.Review = true
		}
	}
	return cap, nil
}

// probeWebAuth 探测在线授权端点（/webui/auth/*）。
//
// 探测用空 name 调一次 request：只有 404 才是「没装」；
// 其它响应（业务失败 / 密钥不匹配 / 玩家不在线）都说明端点存在，即插件在装。
func (s *Server) probeWebAuth(ctx context.Context, client *tshock.Client) (webAuthCapability, error) {
	err := client.WebAuthProbe(ctx, s.cfg.WebAuthSecret)
	if err == nil {
		return webAuthCapability{Plugin: true}, nil
	}
	var e *tshock.APIError
	if errors.As(err, &e) {
		switch e.Kind {
		case tshock.KindNotFound:
			return webAuthCapability{}, nil
		case tshock.KindUnavailable, tshock.KindTimeout:
			return webAuthCapability{}, err
		}
	}
	return webAuthCapability{Plugin: true}, nil
}

// ---------- 聚合端点 ----------

// cachedCapabilities 读取微缓存。
func (s *Server) cachedCapabilities(key string) (capabilitiesResponse, bool) {
	s.capMu.Lock()
	defer s.capMu.Unlock()
	e, ok := s.capCache[key]
	if !ok || time.Since(e.at) > capabilitiesCacheTTL {
		return capabilitiesResponse{}, false
	}
	return e.resp, true
}

func (s *Server) storeCapabilities(key string, resp capabilitiesResponse) {
	s.capMu.Lock()
	defer s.capMu.Unlock()
	s.capCache[key] = capCacheEntry{resp: resp, at: time.Now()}
}

// handleCapabilities 一次返回这台服务器上所有可选能力的可用性。
//
//	GET /api/capabilities[?fresh=1] → capabilitiesResponse
func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	client, cerr := s.clientFor(w, r)
	if !cerr {
		return
	}

	key := client.BaseURL() + "|" + sess.ID
	if r.URL.Query().Get("fresh") != "1" {
		if cached, ok := s.cachedCapabilities(key); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*s.cfg.TShockTimeout)
	defer cancel()

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		unreach bool
		resp    capabilitiesResponse
	)
	resp.Reachable = true
	// recordErr：探测失败只记「上游是否不可达」，不让整次请求失败。
	recordErr := func(err error) {
		if err == nil {
			return
		}
		var e *tshock.APIError
		if errors.As(err, &e) && (e.Kind == tshock.KindUnavailable || e.Kind == tshock.KindTimeout) {
			mu.Lock()
			unreach = true
			mu.Unlock()
		}
	}

	wg.Add(6)
	go func() {
		defer wg.Done()
		st, err := s.probeMessenger(ctx, client)
		recordErr(err)
		if st != nil {
			resp.Messenger = *st
		}
	}()
	go func() {
		defer wg.Done()
		cap, err := s.probeBatch(ctx, client)
		recordErr(err)
		resp.Batch = cap
	}()
	go func() {
		defer wg.Done()
		cap, err := s.probePlayer(ctx, sess.TShockToken, client)
		recordErr(err)
		resp.Player = cap
	}()
	go func() {
		defer wg.Done()
		cap, err := s.probeFish(ctx, sess.TShockToken, client)
		recordErr(err)
		resp.Fish = cap
	}()
	go func() {
		defer wg.Done()
		cap, err := s.probeRequests(ctx, sess.TShockToken, client)
		recordErr(err)
		resp.Requests = cap
	}()
	go func() {
		defer wg.Done()
		cap, err := s.probeWebAuth(ctx, client)
		recordErr(err)
		resp.WebAuth = cap
	}()
	wg.Wait()

	mu.Lock()
	resp.Reachable = !unreach
	mu.Unlock()
	if resp.Messenger.Capabilities == nil {
		resp.Messenger.Capabilities = []string{}
	}

	// 上游不可达时不缓存（恢复后要能立刻拿到真实结果）。
	if resp.Reachable {
		s.storeCapabilities(key, resp)
	}
	writeJSON(w, http.StatusOK, resp)
}
