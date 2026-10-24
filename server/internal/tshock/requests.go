package tshock

// 物资申请（信使插件 WebUI 的 /webui/requests* 端点）。
//
// 事实来源：本仓库插件源码 plugin/WebUI/Requisitions.cs 与 RequestRest.cs。
//
//   - GET /webui/requests?status=                 → 我的申请（需 webui.request.use）
//   - GET /webui/requests/create?items=&reason=&note= → 提交申请（需 webui.request.use）
//   - GET /webui/requests/cancel?id=              → 撤回自己的待审申请（需 webui.request.use）
//   - GET /webui/requests/all?status=             → 审核列表（需 webui.request.review）
//   - GET /webui/requests/review?id=&decision=&reason= → 审核（需 webui.request.review）
//   - GET /webui/requests/deliver?id=             → 补发（需 webui.request.review）
//
// 身份完全由 token 决定（插件侧取 SecureRest.TokenData.Username），本层不传玩家名。
// 发放由插件用 TShock 的 TSPlayer.GiveItemCheck 完成，尊重 item ban，不提权。

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

const (
	requestsPath        = "/webui/requests"
	requestsCreatePath  = "/webui/requests/create"
	requestsCancelPath  = "/webui/requests/cancel"
	requestsAllPath     = "/webui/requests/all"
	requestsReviewPath  = "/webui/requests/review"
	requestsDeliverPath = "/webui/requests/deliver"
)

// RequisitionItem 是一行申请：物品 id + 总数量。
type RequisitionItem struct {
	ID    int `json:"id"`
	Stack int `json:"stack"`
}

// Requisition 是一条物资申请（字段与插件 RequisitionStore.ToDict 对齐）。
type Requisition struct {
	ID            int               `json:"id"`
	Account       string            `json:"account"`
	Player        string            `json:"player"`
	Items         []RequisitionItem `json:"items"`
	Reason        string            `json:"reason"`
	Note          string            `json:"note"`
	Status        string            `json:"status"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
	ReviewedBy    string            `json:"reviewedBy"`
	ReviewedAt    string            `json:"reviewedAt"`
	DenyReason    string            `json:"denyReason"`
	DeliveredAt   string            `json:"deliveredAt"`
	DeliveryError string            `json:"deliveryError"`
	World         string            `json:"world"`
}

// RequestCapabilities 描述物资申请模块的可用性。
type RequestCapabilities struct {
	// Plugin 为 true 表示插件声明了 requests 能力。
	Plugin bool `json:"plugin"`
	// Submit 为 true 表示当前用户可提交 / 查看 / 撤回自己的申请。
	Submit bool `json:"submit"`
	// Review 为 true 表示当前用户可审核 / 补发。
	Review bool `json:"review"`
	// Reason 说明不可用的原因（空 = 可用）：not_installed / legacy /
	// protocol_mismatch / missing_capabilities，与信使插件握手同一套取值。
	Reason string `json:"reason,omitempty"`
}

// RequestList 返回当前 token 用户的申请列表。
func (c *Client) RequestList(ctx context.Context, token, status string) ([]Requisition, error) {
	q := url.Values{}
	if status != "" {
		q.Set("status", status)
	}
	return c.requestListAt(ctx, token, requestsPath, q)
}

// AllRequests 返回全部申请（审核视图）。
func (c *Client) AllRequests(ctx context.Context, token, status string) ([]Requisition, error) {
	q := url.Values{}
	if status != "" {
		q.Set("status", status)
	}
	return c.requestListAt(ctx, token, requestsAllPath, q)
}

func (c *Client) requestListAt(ctx context.Context, token, path string, q url.Values) ([]Requisition, error) {
	body, err := c.secureJSON(ctx, token, path, q)
	if err != nil {
		return nil, err
	}
	var out struct {
		Requests []Requisition `json:"requests"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "物资申请返回非法 JSON"}
	}
	if out.Requests == nil {
		out.Requests = []Requisition{}
	}
	return out.Requests, nil
}

// CreateRequest 提交一条物资申请。
func (c *Client) CreateRequest(ctx context.Context, token string, items []RequisitionItem, reason, note string) (*Requisition, error) {
	payload, err := json.Marshal(items)
	if err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "序列化物品失败"}
	}
	q := url.Values{}
	q.Set("items", string(payload))
	q.Set("reason", reason)
	if note != "" {
		q.Set("note", note)
	}
	return c.requestOne(ctx, token, requestsCreatePath, q)
}

// CancelRequest 撤回自己的待审申请。
func (c *Client) CancelRequest(ctx context.Context, token string, id int) (*Requisition, error) {
	q := url.Values{}
	q.Set("id", strconv.Itoa(id))
	return c.requestOne(ctx, token, requestsCancelPath, q)
}

// ReviewRequest 审核申请：decision = approve | deny。
func (c *Client) ReviewRequest(ctx context.Context, token string, id int, decision, reason string) (*Requisition, error) {
	q := url.Values{}
	q.Set("id", strconv.Itoa(id))
	q.Set("decision", decision)
	if reason != "" {
		q.Set("reason", reason)
	}
	return c.requestOne(ctx, token, requestsReviewPath, q)
}

// DeliverRequest 补发已批准但未发放的申请。
func (c *Client) DeliverRequest(ctx context.Context, token string, id int) (*Requisition, error) {
	q := url.Values{}
	q.Set("id", strconv.Itoa(id))
	return c.requestOne(ctx, token, requestsDeliverPath, q)
}

func (c *Client) requestOne(ctx context.Context, token, path string, q url.Values) (*Requisition, error) {
	body, err := c.secureJSON(ctx, token, path, q)
	if err != nil {
		return nil, err
	}
	var out struct {
		Request Requisition `json:"request"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "物资申请返回非法 JSON"}
	}
	if out.Request.ID == 0 {
		return nil, &APIError{Kind: KindBadResponse, Message: "物资申请返回缺少 request 字段"}
	}
	return &out.Request, nil
}
