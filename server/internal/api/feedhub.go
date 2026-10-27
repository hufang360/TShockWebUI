package api

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"tshockwebui/server/internal/tshock"
)

// 服务器动态的「每上游共享轮询器」。
//
// 背景：SSE 每 2.5s 要问一次插件，如果按「每个浏览器连接」各轮询一次，玩家越多
// 对 TShock REST 的请求就线性放大（且 TShock 限流按来源 IP 算，全站共用一个桶）。
//
// 本 hub 每个 TShock 上游只跑**一个** goroutine 轮询 `/webui/events?since=`：
//   - 把增量广播给所有 SSE 订阅者（fan-out）；
//   - 同时缓存最近事件与世界状态，供普通轮询 / 重连复用；
//   - TShock 侧请求数与在线人数无关（恒定 ~6~24/min，见退避策略）。
//
// 鉴权：订阅者已登录，hub 借用其中一个会话的 TShock token 读事件流
// （事件流本身对所有有效 token 公开，**不提权**）；token 失效就换另一个订阅者的。
const (
	hubEventsLimit   = 200
	hubRing          = 500
	hubSeedCount     = 100
	hubFastInterval  = 2500 * time.Millisecond  // 有事件 / 刚活动
	hubIdleInterval  = 5000 * time.Millisecond  // 静默 > hubIdleFor
	hubSlowInterval  = 10000 * time.Millisecond // 静默 > hubSlowFor
	hubIdleFor       = 30 * time.Second
	hubSlowFor       = 120 * time.Second
	hubWorldInterval = 20 * time.Second
	hubPollTimeout   = 10 * time.Second
)

type feedKind uint8

const (
	feedMessage feedKind = iota
	feedWorld
	feedError
	// feedReset：上游换了实例（同一个地址 / 端口后面换了另一个服），
	// 订阅者要清空本地列表后重拉，否则两个服的事件会串在一起。
	feedReset
)

// feedEvent 是 hub 广播给订阅者的一条消息。
type feedEvent struct {
	kind     feedKind
	event    tshock.ServerEvent
	world    *tshock.ServerInfoData
	code     string
	instance string
}

// feedSub 是一个 SSE 订阅者。
type feedSub struct {
	ch    chan feedEvent
	token string
}

type eventHub struct {
	s      *Server
	client *tshock.Client

	mu          sync.Mutex
	subs        map[*feedSub]struct{}
	token       string
	badTokens   map[string]bool
	ring        []tshock.ServerEvent
	lastSeq     int64
	lastEventAt time.Time
	lastWorld   *tshock.ServerInfoData
	lastWorldAt time.Time
	// instance 是上游插件事件库的实例标识（旧插件为空）。同地址换服时它会变。
	instance string
	// seeded 表示 ring / lastSeq 已用「最近 N 条」垫过；换实例后会重置为 false。
	seeded  bool
	running bool
	wake    chan struct{}
}

func newEventHub(s *Server, client *tshock.Client) *eventHub {
	return &eventHub{
		s:         s,
		client:    client,
		subs:      map[*feedSub]struct{}{},
		badTokens: map[string]bool{},
		wake:      make(chan struct{}, 1),
	}
}

// hubFor 取（必要时创建）某上游的 hub；key 用客户端 baseURL。
func (s *Server) hubFor(client *tshock.Client) *eventHub {
	key := client.BaseURL()
	s.hubMu.Lock()
	defer s.hubMu.Unlock()
	h := s.hubs[key]
	if h == nil {
		h = newEventHub(s, client)
		s.hubs[key] = h
	}
	return h
}

// subscribe 注册一个订阅者并（必要时）启动轮询。
func (h *eventHub) subscribe(token string) *feedSub {
	sub := &feedSub{ch: make(chan feedEvent, 128), token: token}
	h.mu.Lock()
	h.subs[sub] = struct{}{}
	if token != "" {
		h.token = token
		delete(h.badTokens, token)
	}
	if !h.running {
		h.running = true
		go h.loop()
	}
	h.mu.Unlock()
	h.nudge()
	return sub
}

// unsubscribe 移除订阅者（不关闭 channel，避免与 loop 的发送竞争）。
func (h *eventHub) unsubscribe(sub *feedSub) {
	h.mu.Lock()
	delete(h.subs, sub)
	h.mu.Unlock()
}

func (h *eventHub) nudge() {
	select {
	case h.wake <- struct{}{}:
	default:
	}
}

// backlog 返回缓存中 seq > since 的事件（升序副本）。
func (h *eventHub) backlog(since int64) []tshock.ServerEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]tshock.ServerEvent, 0, len(h.ring))
	for _, e := range h.ring {
		if e.Seq > since {
			out = append(out, e)
		}
	}
	return out
}

// world 返回缓存的世界状态；仅在 maxAge 内新鲜时返回，否则 nil。
func (h *eventHub) world(maxAge time.Duration) *tshock.ServerInfoData {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.lastWorld != nil && time.Since(h.lastWorldAt) <= maxAge {
		return h.lastWorld
	}
	return nil
}

// setWorld 手动写入世界状态缓存（供 /api/serverinfo 直接调用时复用）。
func (h *eventHub) setWorld(info *tshock.ServerInfoData) {
	if info == nil {
		return
	}
	h.mu.Lock()
	h.lastWorld = info
	h.lastWorldAt = time.Now()
	h.mu.Unlock()
}

func (h *eventHub) loop() {
	// 首次启动 / 换实例后：用「最近 N 条」把 ring / lastSeq 垫上，避免从头重放整段历史。
	h.mu.Lock()
	needSeed := !h.seeded
	token := h.pickTokenLocked()
	h.mu.Unlock()
	if needSeed && token != "" {
		h.seed(token)
	}

	for {
		h.mu.Lock()
		if len(h.subs) == 0 {
			h.running = false
			h.mu.Unlock()
			return
		}
		token = h.pickTokenLocked()
		h.mu.Unlock()

		if token == "" {
			// 没有可用 token（全部失效）：通知订阅者把连接关掉（前端会提示重登 / 降级）。
			h.mu.Lock()
			h.broadcastLocked(feedEvent{kind: feedError, code: codeTokenInvalid})
			h.mu.Unlock()
			select {
			case <-h.wake:
			case <-time.After(time.Second):
			}
			continue
		}

		h.pollOnce(token)

		h.mu.Lock()
		idle := time.Since(h.lastEventAt)
		h.mu.Unlock()
		interval := hubFastInterval
		if idle > hubSlowFor {
			interval = hubSlowInterval
		} else if idle > hubIdleFor {
			interval = hubIdleInterval
		}

		select {
		case <-h.wake:
		case <-time.After(interval):
		}
	}
}

// pickTokenLocked 选一个可用 token：优先当前 token，否则任一订阅者的；已被判定失效的跳过。
func (h *eventHub) pickTokenLocked() string {
	if h.token != "" && !h.badTokens[h.token] {
		return h.token
	}
	for sub := range h.subs {
		if sub.token != "" && !h.badTokens[sub.token] {
			h.token = sub.token
			return sub.token
		}
	}
	return ""
}

func (h *eventHub) pollOnce(token string) {
	h.mu.Lock()
	since := h.lastSeq
	h.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), hubPollTimeout)
	defer cancel()

	page, err := h.client.Events(ctx, token, since, hubEventsLimit)
	if err != nil {
		var e *tshock.APIError
		if errors.As(err, &e) && e.Kind == tshock.KindTokenInvalid {
			h.mu.Lock()
			h.badTokens[token] = true
			if h.token == token {
				h.token = ""
			}
			h.mu.Unlock()
		}
		return
	}

	now := time.Now()
	h.mu.Lock()
	changed := h.detectInstanceLocked(page)
	if changed {
		// 同一个地址 / 端口后面换了服：旧 ring / lastSeq / 世界状态全部作废。
		h.resetLocked(now)
		h.broadcastLocked(feedEvent{kind: feedReset, instance: h.instance})
		h.mu.Unlock()
		// 插件 meta 缓存也可能属于旧服（版本 / 能力不同），一并作废。
		h.s.invalidateFeedCaches(h.client.BaseURL())
		return
	}
	if len(page.Events) > 0 {
		for _, ev := range page.Events {
			if ev.Seq <= h.lastSeq {
				continue
			}
			h.ring = append(h.ring, ev)
			if len(h.ring) > hubRing {
				h.ring = h.ring[len(h.ring)-hubRing:]
			}
			h.lastSeq = ev.Seq
			h.broadcastLocked(feedEvent{kind: feedMessage, event: ev})
		}
		h.lastEventAt = now
	}
	needWorld := now.Sub(h.lastWorldAt) >= hubWorldInterval
	h.mu.Unlock()

	if needWorld {
		if info, werr := h.client.ServerInfo(ctx, token); werr == nil && info != nil {
			h.mu.Lock()
			h.lastWorld = info
			h.lastWorldAt = time.Now()
			h.broadcastLocked(feedEvent{kind: feedWorld, world: info})
			h.mu.Unlock()
		}
	}
}

// resetLocked 作废该上游的全部缓存（换实例时用）；调用方需持有 h.mu。
// activeAt 写入 lastEventAt：刚换服视为「刚活动」，下一轮用快节奏轮询。
func (h *eventHub) resetLocked(activeAt time.Time) {
	h.ring = nil
	h.lastSeq = 0
	h.lastWorld = nil
	h.lastWorldAt = time.Time{}
	h.lastEventAt = activeAt
	h.seeded = false
}

// detectInstanceLocked 比对本次响应里的实例身份（或旧插件的 seq 回退），
// 发现换服时更新 h.instance 并返回 true。调用方需持有 h.mu。
func (h *eventHub) detectInstanceLocked(page *tshock.EventsPage) bool {
	switch {
	case page.Instance != "":
		changed := h.instance != "" && h.instance != page.Instance
		h.instance = page.Instance
		return changed
	case page.LastSeq < h.lastSeq && (page.LastSeq > 0 || len(page.Events) == 0):
		// 旧插件没有 instance：seq 回退（含新服从 0 开始）说明事件库被换成了另一个。
		return true
	}
	return false
}

// observeInstance 记录从非流式端点看到的实例身份；
// 发现换服时作废缓存、通知 SSE 订阅者重同步，并返回 true。
func (h *eventHub) observeInstance(instance string) bool {
	if instance == "" {
		return false
	}
	h.mu.Lock()
	if h.instance == instance {
		h.mu.Unlock()
		return false
	}
	changed := h.instance != ""
	h.instance = instance
	if changed {
		// 刚换服 = 刚活动：立刻用快节奏轮询把新服的事件补上，不按「静默」退避。
		h.resetLocked(time.Now())
		h.broadcastLocked(feedEvent{kind: feedReset, instance: instance})
	}
	h.mu.Unlock()
	if changed {
		// 共享轮询器可能正在长睡眠：叫醒它，建立一个轮询周期内就重同步。
		h.nudge()
	}
	return changed
}

// seed 用「最近 N 条」重建 ring / lastSeq（首次启动或换实例后）。
func (h *eventHub) seed(token string) {
	ctx, cancel := context.WithTimeout(context.Background(), hubPollTimeout)
	defer cancel()
	page, err := h.s.eventsTail(ctx, h.client, token, hubSeedCount)
	if err != nil || page == nil {
		return
	}
	h.mu.Lock()
	if h.instance != "" && page.Instance != "" && page.Instance != h.instance {
		// 拉取期间上游又换了实例（HTTP 请求与共享轮询并发）：丢弃这次 seed，
		// 让下一轮 poll 重新识别 + 重置，避免把旧实例的 ring 写回去。
		h.mu.Unlock()
		return
	}
	h.ring = append(h.ring[:0], page.Events...)
	h.lastSeq = page.LastSeq
	if page.Instance != "" {
		h.instance = page.Instance
	}
	h.seeded = true
	h.mu.Unlock()
}

// invalidateFeedCaches 作废某上游的短期缓存（目前只有插件 meta）。
//
// 换实例后旧服的插件版本 / 能力可能不同（例如换成了旧插件），
// 继续用 60s 的 meta 缓存会让 tail 判定出错。
func (s *Server) invalidateFeedCaches(upstream string) {
	s.metaMu.Lock()
	delete(s.metaCache, upstream)
	s.metaMu.Unlock()

	s.capMu.Lock()
	for key := range s.capCache {
		if strings.HasPrefix(key, upstream+"|") {
			delete(s.capCache, key)
		}
	}
	s.capMu.Unlock()
}

func (h *eventHub) broadcastLocked(ev feedEvent) {
	for sub := range h.subs {
		select {
		case sub.ch <- ev:
		default:
			// 订阅者消费慢：丢弃这条，绝不阻塞轮询。
		}
	}
}
