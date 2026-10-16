package tshock

// 鱼店（TShock 第三方插件 FishShop 的 REST 端点）。
//
// 事实来源：本地插件源码 `TShockFishShop/TShockFishShop/RestApi.cs`（v1.6）与
// `docs/REST-API.md`。
//   - `GET /v3/fishshop/list?token=`            → 货架；权限 `fishshop.rest.use`
//   - `GET /v3/fishshop/ask?serial=&token=`     → 询价；权限 `fishshop.rest.use`
//   - `GET /v3/fishshop/buy?serial=&amount=&player=&args=&token=`
//                                               → 购买；权限 `fishshop.rest.buy`（代购需 `buyas`）
//   - `GET /v3/fishshop/refund?seq=&player=&token=` → 退款；权限同 buy
//
// 权限完全由 TShock / FishShop 判定，本层不做提权：
//   - 端点不存在（服务器没装插件）→ HTTP 404 → KindNotFound。
//   - 有 token 但缺 `fishshop.rest.use` → HTTP 403 → KindNoPermission。
//   - 业务失败（缺参数 / 商品不存在 / 钱不够 / 商店打烊）→ HTTP 400 + `error` 文案。
//
// 与 PlayerManager 不同，鱼店把业务错误也放在 JSON 的 `error` 字段里，
// 因此 `messageFromBody` 取出的中文文案要原样回传给前端展示。

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

// stringList 容忍 JSON 数组或单个字符串。FishShop 的 `map` 字段是
// `List<string>`（一组别名标签），但为兼容不同插件版本也接受裸字符串。
type stringList []string

func (s *stringList) UnmarshalJSON(data []byte) error {
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*s = arr
		return nil
	}
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*s = []string{str}
		return nil
	}
	*s = nil
	return nil
}

// boolInt 容忍 JSON 布尔或数字（FishShop 的 `refund` 是 `int` 0/1）。
type boolInt bool

func (b *boolInt) UnmarshalJSON(data []byte) error {
	var n int
	if err := json.Unmarshal(data, &n); err == nil {
		*b = boolInt(n != 0)
		return nil
	}
	var v bool
	if err := json.Unmarshal(data, &v); err == nil {
		*b = boolInt(v)
		return nil
	}
	*b = false
	return nil
}

// MarshalJSON 统一输出布尔，供前端使用。
func (b boolInt) MarshalJSON() ([]byte, error) {
	if b {
		return []byte("true"), nil
	}
	return []byte("false"), nil
}

// FishGood 是货架上的一条商品。
type FishGood struct {
	Serial int    `json:"serial"`
	Name   string `json:"name"`
	// Icon 是插件配置的商品图标标签（如 "[i:5041]"），可能为空。
	// desc 对服务类商品（时间/天气/buff 等）只有文字，故需靠 icon 展示真实图标。
	Icon string `json:"icon"`
	// BuyMax 单次最多可购买件数（1 = 不允许调数量）。
	BuyMax int `json:"buyMax"`
	// NeedArgs 为 true 表示指令类商品含 {args}/{0} 占位符，购买时需填参数。
	NeedArgs bool       `json:"needArgs"`
	Map      stringList `json:"map"`
	Desc     string     `json:"desc"`
	Cost     string     `json:"cost"`
	Unlock   string     `json:"unlock"`
	Comment  string     `json:"comment"`
	Refund   boolInt    `json:"refund"`
	// 限购（空数组 = 不限）：限制用户组 / 限制玩家（白名单）/ 禁止玩家（黑名单）。
	AllowGroup   []string `json:"allowGroup"`
	AllowPlayers []string `json:"allowPlayers"`
	DenyPlayers  []string `json:"denyPlayers"`
}

// FishShop 是 /v3/fishshop/list 的规范化结果。
type FishShop struct {
	Name  string     `json:"name"`
	Total int        `json:"total"`
	Goods []FishGood `json:"goods"`
}

// FishCapability 描述 FishShop 的可用性（供前端决定是否显示模块）。
type FishCapability struct {
	// Plugin 为 true 表示服务器已安装 FishShop（`/v3/fishshop/*` 端点存在）。
	Plugin bool `json:"plugin"`
	// Permission 为 true 表示当前登录用户所在组有 `fishshop.rest.use` 权限。
	Permission bool `json:"permission"`
}

// FishBuyResult 是 /v3/fishshop/buy 的规范化结果。
type FishBuyResult struct {
	Serial int    `json:"serial"`
	Name   string `json:"name"`
	Amount int    `json:"amount"`
	Cost   string `json:"cost"`
}

// FishRefundResult 是 /v3/fishshop/refund 的规范化结果。
type FishRefundResult struct {
	Seq  int    `json:"seq"`
	Name string `json:"name"`
	// Amount 原始下单数量。
	Amount int `json:"amount"`
	// RefundMoney 退还的铜币（已进鱼罐）。
	RefundMoney int64 `json:"refundMoney"`
}

// decodeFishResponse 解析 TShock 的 REST 信封，取出 `response` 字段。
// FishShop 的业务错误放在 `error`，这里原样转成 APIError（Status 由调用方补充）。
func decodeFishResponse(body []byte) (json.RawMessage, error) {
	var env struct {
		Response json.RawMessage `json:"response"`
		Error    string          `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "FishShop 返回非法 JSON"}
	}
	if env.Error != "" {
		return nil, &APIError{Kind: KindBadResponse, Message: env.Error}
	}
	return env.Response, nil
}

// FishProbe 探测 FishShop 是否可用：用「不带 serial」调用 `/v3/fishshop/ask`。
//
//   - 404 → 插件未安装（KindNotFound）
//   - 403 → 缺权限（KindNoPermission）或 token 失效（KindTokenInvalid）
//   - 400 → 插件存在（FishShop 报「缺少 serial 参数」）
//   - 2xx → 插件存在
//
// 这是只读探测，不会购买或修改任何数据。
func (c *Client) FishProbe(ctx context.Context, token string) error {
	q := url.Values{}
	q.Set("token", token)

	status, body, err := c.do(ctx, "/v3/fishshop/ask", q)
	if err != nil {
		return err
	}
	if status == http.StatusBadRequest {
		// 插件已安装并已通过权限校验，只是缺 serial 参数。
		return nil
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return e
	}
	return nil
}

// FishList 调用 `/v3/fishshop/list`，返回货架。
func (c *Client) FishList(ctx context.Context, token string) (*FishShop, error) {
	q := url.Values{}
	q.Set("token", token)

	status, body, err := c.do(ctx, "/v3/fishshop/list", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	raw, derr := decodeFishResponse(body)
	if derr != nil {
		// 补上 HTTP 状态，便于调用方区分业务错误与解析错误。
		if ae, ok := derr.(*APIError); ok && ae.Status == 0 {
			ae.Status = status
		}
		return nil, derr
	}
	var shop FishShop
	if err := json.Unmarshal(raw, &shop); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "FishShop 货架数据无法解析"}
	}
	if shop.Goods == nil {
		shop.Goods = []FishGood{}
	}
	return &shop, nil
}

// FishAsk 调用 `/v3/fishshop/ask`，返回单条商品详情。
func (c *Client) FishAsk(ctx context.Context, token string, serial int) (*FishGood, error) {
	q := url.Values{}
	q.Set("serial", strconv.Itoa(serial))
	q.Set("token", token)

	status, body, err := c.do(ctx, "/v3/fishshop/ask", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	raw, derr := decodeFishResponse(body)
	if derr != nil {
		if ae, ok := derr.(*APIError); ok && ae.Status == 0 {
			ae.Status = status
		}
		return nil, derr
	}
	var good FishGood
	if err := json.Unmarshal(raw, &good); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "FishShop 商品数据无法解析"}
	}
	return &good, nil
}

// FishBuy 调用 `/v3/fishshop/buy` 为自己购买。
// args 会替换商品 cmds 的 `{args}` 占位符（按空格拆分）；仅指令类商品需要。
func (c *Client) FishBuy(ctx context.Context, token string, serial, amount int, args string) (*FishBuyResult, error) {
	if amount < 1 {
		amount = 1
	}
	q := url.Values{}
	q.Set("serial", strconv.Itoa(serial))
	q.Set("amount", strconv.Itoa(amount))
	if args != "" {
		q.Set("args", args)
	}
	q.Set("token", token)

	status, body, err := c.do(ctx, "/v3/fishshop/buy", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	raw, derr := decodeFishResponse(body)
	if derr != nil {
		if ae, ok := derr.(*APIError); ok && ae.Status == 0 {
			ae.Status = status
		}
		return nil, derr
	}
	var out FishBuyResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "FishShop 购买结果无法解析"}
	}
	return &out, nil
}
