package tshock

// 网页发言（信使插件 WebUI 的 /webui/chat 端点）。
//
//	POST/GET /webui/chat?text=&token=  → 以 [WebUI] 前缀把文本广播到游戏内聊天，
//	                                     并记入事件流（type=webui）。
//
// 任意有效 token（SecureRestCommand，不额外要求权限）：权限仍是 token 用户组本人。
// 消息不伪造身份——统一带 [WebUI] 前缀并把来源账号名列出来，与真实在线玩家的聊天区分。

import (
	"context"
	"encoding/json"
	"net/url"
)

const chatPath = "/webui/chat"

// ChatResult 是 /webui/chat 的结果（name 为游戏内角色名或账号名）。
type ChatResult struct {
	Name string `json:"name"`
	Text string `json:"text"`
	// Line 是插件实际广播的那一行（含可配置前缀，默认 `[WebUI]`）。
	Line string `json:"line"`
	// ID / Time 供前端做「发送中 / 已发送」与去重（插件生成）。
	ID     string `json:"id,omitempty"`
	Time   string `json:"time,omitempty"`
	Source string `json:"source,omitempty"`
}

// SendChat 调用 /webui/chat，把 text 发到游戏内聊天。
func (c *Client) SendChat(ctx context.Context, token, text string) (*ChatResult, error) {
	q := url.Values{}
	q.Set("text", text)
	body, err := c.secureJSON(ctx, token, chatPath, q)
	if err != nil {
		return nil, err
	}
	var out ChatResult
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "网页发言返回非法 JSON"}
	}
	return &out, nil
}
