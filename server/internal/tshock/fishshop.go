package tshock

// 鱼店（TShock 第三方插件 FishShop 的 REST 端点）。
//
// 事实来源：本地插件源码 `TShockFishShop/TShockFishShop/RestApi.cs`（新版）与
// `docs/REST-API.md`。
//   - `GET /fishshop/list?token=`              → 货架
//   - `GET /fishshop/ask?serial=&token=`       → 询价
//   - `GET /fishshop/buy?serial=&amount=&args=&token=`
//                                              → 为自己购买（只能是 token 同名的在线玩家）
//
// 前缀有历史包袱（见 `fishPrefix` / `fishPrefixV3`）：新版去掉了 `v3`，
// v1.6.2 ~ v1.6.6 仍是 `/v3/fishshop/*`，两个都试并按上游地址缓存结果。
// v1.6.2 之前**没有 REST 接口**（只有游戏内 `/fish` 指令），探测时报 KindPluginOutdated。
//
// 权限完全由 TShock / FishShop 判定，本层不做提权：
//   - **新版不需要任何自定义权限**（与游戏内 `/fish` 一致）：任意有效 token 都能调，
//     游客买会被插件自己拒绝（SSC 开启时），以 400 + `error`「游客无法访问鱼店」返回。
//   - 老版本（v1.6.2 ~ v1.6.6）仍要求 `fishshop.rest.use` / `buy`，缺权限时 403，
//     所以 `KindNoPermission` 分支保留给老版本。
//   - 端点不存在（没装插件 / 老版本没接口）→ HTTP 404 → KindNotFound / KindPluginOutdated。
//   - 业务失败（缺参数 / 商品不存在 / 钱不够 / 商店打烊 / 游客 等）→ HTTP 400 + `error` 文案。
//
// 与 PlayerManager 不同，鱼店把业务错误也放在 JSON 的 `error` 字段里，
// 因此 `messageFromBody` 取出的中文文案要原样回传给前端展示。
//
// 另外：新版插件删除了代购（`player` 参数）与退款（`/fishshop/refund`、商品 `refund` 字段），
// 本层本来就不发 `player`；`refund` 字段解析保留仅为了兼容 v1.6.2 ~ v1.6.6。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"sync"
)

// 上游 REST 前缀：
//   - fishPrefix：新版（插件未发布的下一版起）去掉了 v3 前缀；
//   - fishPrefixV3：v1.6.2 ~ v1.6.6 的旧地址，仅作兼容回退。
const (
	fishPrefix   = "/fishshop"
	fishPrefixV3 = "/v3/fishshop"
)

// fishPrefixCache 记住每个 TShock 上游实际可用的前缀，避免旧版插件每次调用都多打一次 404。
// key = 上游地址（Client.baseURL），value = fishPrefix / fishPrefixV3。
var fishPrefixCache sync.Map

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

// boolInt 容忍 JSON 布尔或数字（老版本 FishShop 的 `refund` 是 `int` 0/1）。
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
	// Refund 是「可退款次数」→ bool（上游为 int 0/1）。**仅老版本 v1.6.2 ~ v1.6.6 返回**：
	// 新版插件已删除自助退款，字段不再下发（解析成 false，前端不显示可退徽章）。
	Refund boolInt `json:"refund"`
	// 限购（空数组 = 不限）：限制用户组 / 限制玩家（白名单）/ 禁止玩家（黑名单）。
	AllowGroup   []string `json:"allowGroup"`
	AllowPlayers []string `json:"allowPlayers"`
	DenyPlayers  []string `json:"denyPlayers"`
}

// FishShop 是 `/fishshop/list` 的规范化结果。
type FishShop struct {
	Name  string     `json:"name"`
	Total int        `json:"total"`
	Goods []FishGood `json:"goods"`
}

// FishCapability 描述 FishShop 的可用性（供前端决定是否显示模块）。
type FishCapability struct {
	// Plugin 为 true 表示服务器在跑 FishShop（含「版本过旧、没有 REST 接口」）。
	Plugin bool `json:"plugin"`
	// REST 为 true 表示插件注册了 REST 端点（v1.6.2+）；false 表示老版本只有游戏内指令。
	REST bool `json:"rest"`
	// Permission 为 true 表示当前登录用户可访问鱼店。新版插件不需要任何自定义权限，
	// 探测走「缺 serial → 400」分支，因此恒为 true；只有老版本（v1.6.2 ~ v1.6.6）
	// 缺 `fishshop.rest.use` 时才会是 false。
	Permission bool `json:"permission"`
}

// FishBuyResult 是 `/fishshop/buy` 的规范化结果。
type FishBuyResult struct {
	Serial int    `json:"serial"`
	Name   string `json:"name"`
	Amount int    `json:"amount"`
	Cost   string `json:"cost"`
}

// FishRefundResult 是 `/fishshop/refund` 的规范化结果（**仅老版本 v1.6.2 ~ v1.6.6**；
// 新版插件已删除自助退款，后端从未接线、仅保留类型）。
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

// fishDo 调用 FishShop 的一个端点（endpoint 形如 "/list"），前缀按上游自动选择：
// 先试新版 `/fishshop`，404 再回退旧版 `/v3/fishshop`，成功的前缀按上游地址缓存。
// 两个前缀都 404 时返回最后一次的状态（调用方据此判定「没有 REST 接口」）。
func (c *Client) fishDo(ctx context.Context, endpoint string, q url.Values) (int, []byte, error) {
	order := [2]string{fishPrefix, fishPrefixV3}
	if v, ok := fishPrefixCache.Load(c.baseURL); ok {
		if p, _ := v.(string); p == fishPrefixV3 {
			order = [2]string{fishPrefixV3, fishPrefix}
		}
	}
	var status int
	var body []byte
	var err error
	for _, prefix := range order {
		status, body, err = c.do(ctx, prefix+endpoint, q)
		if err != nil {
			return 0, nil, err
		}
		if status == http.StatusNotFound {
			continue // 该前缀没注册端点：试下一个
		}
		fishPrefixCache.Store(c.baseURL, prefix)
		return status, body, nil
	}
	return status, body, nil
}

// FishProbe 探测 FishShop 是否可用：用「不带 serial」调用 `/fishshop/ask`。
//
//   - 400 → 插件存在（FishShop 报「缺少 serial 参数」）
//   - 2xx → 插件存在
//   - 403 → 缺权限（KindNoPermission）或 token 失效（KindTokenInvalid）
//   - 404（新旧前缀都没有）→ 没装插件（KindNotFound），
//     或装了 v1.6.2 之前的老版本（只有指令、没有 REST）→ KindPluginOutdated
//
// 这是只读探测，不会购买或修改任何数据。
func (c *Client) FishProbe(ctx context.Context, token string) error {
	q := url.Values{}
	q.Set("token", token)

	status, body, err := c.fishDo(ctx, "/ask", q)
	if err != nil {
		return err
	}
	if status == http.StatusBadRequest {
		// 插件已安装并已通过权限校验，只是缺 serial 参数。
		return nil
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		if e.Kind == KindNotFound {
			return c.fishNoREST(ctx, token, e)
		}
		return e
	}
	return nil
}

// fishNoREST 区分「没装插件」与「老版本插件没有 REST 接口」：
// 两个 REST 前缀都 404 时，用游戏内 `/fish help` 探一下指令是否存在
// （rawcmd 只读，输出是用法提示；不提权，也不改任何数据）。
//
//   - 指令正常执行 → 插件在跑，只是没有 REST → KindPluginOutdated
//   - 明确报「指令无效」/ rawcmd 不可用 → 维持 KindNotFound（前端会提示两种可能）
func (c *Client) fishNoREST(ctx context.Context, token string, restErr error) error {
	res, err := c.RawCmd(ctx, token, "/fish help")
	if err != nil {
		var e *APIError
		if errors.As(err, &e) && e.Kind == KindTokenInvalid {
			return e
		}
		return restErr
	}
	if res.Status != StatusOK {
		return restErr
	}
	return &APIError{Kind: KindPluginOutdated, Status: http.StatusNotFound, Message: "FishShop 版本过旧，未提供 REST 接口"}
}

// FishList 调用 `/fishshop/list`，返回货架。
func (c *Client) FishList(ctx context.Context, token string) (*FishShop, error) {
	q := url.Values{}
	q.Set("token", token)

	status, body, err := c.fishDo(ctx, "/list", q)
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

// FishAsk 调用 `/fishshop/ask`，返回单条商品详情。
func (c *Client) FishAsk(ctx context.Context, token string, serial int) (*FishGood, error) {
	q := url.Values{}
	q.Set("serial", strconv.Itoa(serial))
	q.Set("token", token)

	status, body, err := c.fishDo(ctx, "/ask", q)
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

// FishBuy 调用 `/fishshop/buy` 为自己购买。
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

	status, body, err := c.fishDo(ctx, "/buy", q)
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
