package tshock

// 信使插件 WebUI 的只读信息与会话管理端点（SecureRestCommand，任意有效 token）。
//
//   - /webui/commands    → 运行时指令目录（含插件指令）
//   - /webui/me          → 当前 token 用户档案（组 / 权限 / 是否可登录）
//   - /webui/data        → 补全数据源（regions / warps / npcs / buffs，按权限过滤）
//   - /webui/serverinfo  → 世界事件 / Boss 进度等增强状态
//   - /webui/events      → 服务器动态事件流（轮询）
//   - /webui/auth/sessions + /webui/auth/revoke → 自助管理本插件的 web 会话
//
// 全部返回 TShock 的 RestObject 顶层字段（不包在 response 里），复用 rawcmd 的错误分类。

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

const (
	commandsPath    = "/webui/commands"
	mePath          = "/webui/me"
	dataPath        = "/webui/data"
	serverInfoPath_ = "/webui/serverinfo"
	eventsPath      = "/webui/events"
	sessionsPath    = "/webui/auth/sessions"
	revokePath      = "/webui/auth/revoke"
)

// RuntimeCommand 是插件运行时指令目录里的一条（字段与 TShock Command 对应）。
type RuntimeCommand struct {
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Permissions []string `json:"permissions"`
	AllowServer bool     `json:"allowServer"`
	Help        string   `json:"help"`
	DoLog       bool     `json:"doLog"`
}

// MeInfo 是当前 token 用户档案。
type MeInfo struct {
	Username       string   `json:"username"`
	Group          string   `json:"group"`
	Permissions    []string `json:"permissions"`
	CanUseAPI      bool     `json:"canUseApi"`
	CanRunCommands bool     `json:"canRunCommands"`
}

// NameItem 是补全数据源里的一条 {id, name}；regions/warps 的 id 为 0。
type NameItem struct {
	ID   int    `json:"id,omitempty"`
	Name string `json:"name"`
}

// ServerEvent 是事件流里的一条。
type ServerEvent struct {
	Seq  int64  `json:"seq"`
	Type string `json:"type"`
	Text string `json:"text"`
	Time string `json:"time"`
	// Source 是同类型事件的来源（如 type=chat 时 game | webui）；旧插件可能不返回。
	Source string `json:"source,omitempty"`
}

// EventsPage 是 /webui/events 的结果。
// FirstSeq 仅在新插件的 tail 模式下返回（最新一批的起始 seq）。
// Instance 是插件事件库的实例标识（同一地址换服会变），旧插件不返回。
type EventsPage struct {
	Events   []ServerEvent `json:"events"`
	LastSeq  int64         `json:"lastSeq"`
	FirstSeq int64         `json:"firstSeq,omitempty"`
	Instance string        `json:"instance,omitempty"`
}

// SessionInfo 是本插件铸造的一条 web 会话（不含 token 明文）。
type SessionInfo struct {
	ID      string `json:"id"`
	Created string `json:"created"`
	Expires string `json:"expires"`
	Current bool   `json:"current"`
}

// secureJSON 调用一个需要 token 的插件端点并返回原始 JSON。
func (c *Client) secureJSON(ctx context.Context, token, path string, q url.Values) ([]byte, error) {
	if q == nil {
		q = url.Values{}
	}
	q.Set("token", token)
	status, body, err := c.do(ctx, path, q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	return body, nil
}

// CommandCatalog 调用 /webui/commands。
func (c *Client) CommandCatalog(ctx context.Context, token string) ([]RuntimeCommand, error) {
	body, err := c.secureJSON(ctx, token, commandsPath, nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Commands []RuntimeCommand `json:"commands"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "指令目录返回非法 JSON"}
	}
	if out.Commands == nil {
		out.Commands = []RuntimeCommand{}
	}
	return out.Commands, nil
}

// Me 调用 /webui/me。
func (c *Client) Me(ctx context.Context, token string) (*MeInfo, error) {
	body, err := c.secureJSON(ctx, token, mePath, nil)
	if err != nil {
		return nil, err
	}
	var out MeInfo
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "用户档案返回非法 JSON"}
	}
	if out.Permissions == nil {
		out.Permissions = []string{}
	}
	return &out, nil
}

// DataList 调用 /webui/data?type=，返回统一为 {id, name} 的列表。
func (c *Client) DataList(ctx context.Context, token, dataType string) ([]NameItem, error) {
	q := url.Values{}
	q.Set("type", dataType)
	body, err := c.secureJSON(ctx, token, dataPath, q)
	if err != nil {
		return nil, err
	}

	// 区域 / 传送点是字符串列表；NPC / buff 是 {id,name} 列表。
	var names struct {
		Regions []string   `json:"regions"`
		Warps   []string   `json:"warps"`
		NPCs    []NameItem `json:"npcs"`
		Buffs   []NameItem `json:"buffs"`
	}
	if err := json.Unmarshal(body, &names); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "补全数据返回非法 JSON"}
	}
	switch dataType {
	case "regions":
		return plainNames(names.Regions), nil
	case "warps":
		return plainNames(names.Warps), nil
	case "npcs":
		return names.NPCs, nil
	case "buffs":
		return names.Buffs, nil
	default:
		return nil, &APIError{Kind: KindBadResponse, Message: "未知的数据类型"}
	}
}

func plainNames(names []string) []NameItem {
	if names == nil {
		return []NameItem{}
	}
	out := make([]NameItem, 0, len(names))
	for _, n := range names {
		out = append(out, NameItem{Name: n})
	}
	return out
}

// ServerInfoData 是 /webui/serverinfo 的结果。
type ServerInfoData struct {
	Name         string          `json:"name"`
	WorldID      int             `json:"worldId"`
	Difficulty   int             `json:"difficulty"`
	HardMode     bool            `json:"hardMode"`
	DayTime      bool            `json:"dayTime"`
	Time         float64         `json:"time"`
	BloodMoon    bool            `json:"bloodMoon"`
	Eclipse      bool            `json:"eclipse"`
	InvasionType int             `json:"invasionType"`
	InvasionSize int             `json:"invasionSize"`
	Raining      bool            `json:"raining"`
	SlimeRain    bool            `json:"slimeRain"`
	Players      int             `json:"players"`
	NPCCount     int             `json:"npcCount"`
	MaxNPC       int             `json:"maxNpc"`
	Bosses       map[string]bool `json:"bosses"`
}

// ServerInfo 调用 /webui/serverinfo。
func (c *Client) ServerInfo(ctx context.Context, token string) (*ServerInfoData, error) {
	body, err := c.secureJSON(ctx, token, serverInfoPath_, nil)
	if err != nil {
		return nil, err
	}
	var out ServerInfoData
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "服务器状态返回非法 JSON"}
	}
	if out.Bosses == nil {
		out.Bosses = map[string]bool{}
	}
	return &out, nil
}

// Events 调用 /webui/events?since=&limit=。
func (c *Client) Events(ctx context.Context, token string, since int64, limit int) (*EventsPage, error) {
	q := url.Values{}
	q.Set("since", strconv.FormatInt(since, 10))
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	return c.fetchEvents(ctx, token, q)
}

// EventsTail 调用 /webui/events?tail=N：返回**最新** N 条（升序）。
// 仅新插件（能力 events_history）支持；旧插件会把它当 since=0，需调用方兜底。
func (c *Client) EventsTail(ctx context.Context, token string, tail int) (*EventsPage, error) {
	q := url.Values{}
	q.Set("tail", strconv.Itoa(tail))
	return c.fetchEvents(ctx, token, q)
}

func (c *Client) fetchEvents(ctx context.Context, token string, q url.Values) (*EventsPage, error) {
	body, err := c.secureJSON(ctx, token, eventsPath, q)
	if err != nil {
		return nil, err
	}
	var out EventsPage
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "事件流返回非法 JSON"}
	}
	if out.Events == nil {
		out.Events = []ServerEvent{}
	}
	return &out, nil
}

// Sessions 调用 /webui/auth/sessions。
func (c *Client) Sessions(ctx context.Context, token string) ([]SessionInfo, error) {
	body, err := c.secureJSON(ctx, token, sessionsPath, nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Sessions []SessionInfo `json:"sessions"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "会话列表返回非法 JSON"}
	}
	if out.Sessions == nil {
		out.Sessions = []SessionInfo{}
	}
	return out.Sessions, nil
}

// RevokeSessions 调用 /webui/auth/revoke（id 或 all=true 二选一）。返回吊销数量。
func (c *Client) RevokeSessions(ctx context.Context, token, id string, all bool) (int, error) {
	q := url.Values{}
	if all {
		q.Set("all", "true")
	} else {
		q.Set("id", id)
	}
	body, err := c.secureJSON(ctx, token, revokePath, q)
	if err != nil {
		return 0, err
	}
	var out struct {
		Revoked int `json:"revoked"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return 0, &APIError{Kind: KindBadResponse, Message: "吊销结果返回非法 JSON"}
	}
	return out.Revoked, nil
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
