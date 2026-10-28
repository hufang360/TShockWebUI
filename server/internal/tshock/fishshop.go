package tshock

// 鱼店（TShock 第三方插件 FishShop 的 REST 端点）。
//
// 事实来源：本地插件源码 `TShockFishShop/TShockFishShop/RestApi.cs`（新版）与
// `docs/REST-API.md`。
//   - `GET /fishshop/list?token=`              → 货架（也用作能力探测，见 FishProbe）
//   - `GET /fishshop/ask?serial=&token=`       → 单件详情
//   - `GET /fishshop/buy?serial=&amount=&args=&token=`
//                                              → 为自己购买（只能是 token 同名的在线玩家）
//
// 前缀只有 `/fishshop/*`。`/v3/fishshop/*` 只存在于 v1.6.2 ~ v1.6.6（未对外），新版插件已去掉 `v3`，
// 所以**不做旧前缀回退**：老版本插件会 404，再靠 rawcmd `/fish help` 判成「版本过旧」。
// v1.6.2 之前**没有 REST 接口**（只有游戏内 `/fish` 指令），同样报 KindPluginOutdated。
//
// 权限完全由 TShock / FishShop 判定，本层不做提权：
//   - **新版不需要任何自定义权限**（与游戏内 `/fish` 一致）：任意有效 token 都能调，
//     游客买会被插件自己拒绝（SSC 开启时），以 400 + `error`「游客无法访问鱼店」返回。
//   - 老版本（v1.6.2 ~ v1.6.6）曾要求 `fishshop.rest.use` / `buy`，缺权限时 403，
//     所以 `KindNoPermission` 分支保留给老版本。
//   - 端点不存在（没装插件 / 老版本没接口）→ HTTP 404 → KindNotFound / KindPluginOutdated。
//   - 业务失败（缺参数 / 商品不存在 / 钱不够 / 商店打烊 / 游客 等）→ HTTP 400 + `error` 文案。
//
// 与 PlayerManager 不同，鱼店把业务错误也放在 JSON 的 `error` 字段里，
// 因此 `messageFromBody` 取出的中文文案要原样回传给前端展示。
//
// 字段与 `TShockFishShop/docs/REST-API.md` §2.1 一一对应（上游「只增不改名」）：
// `list` 的每条 = `ask` 的整个 response（`ask` 另多 `shop`），`buy` 返回 `amount`（实际成交）
// + `requested`（请求值）。
//
// 另外：新版插件删除了代购（`player` 参数）与退款（`/fishshop/refund`、商品 `refund` 字段），
// 本层本来就不发 `player`，也已不再解析 `refund`（老版本未对外，没有兼容必要）。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

// 上游 REST 端点（插件注册的完整路径，见 RestApi.cs `RegisterRestApi`）。
const (
	fishList = "/fishshop/list"
	fishAsk  = "/fishshop/ask"
	fishBuy  = "/fishshop/buy"
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

// FishCostItem 是购买时要扣的一件物品（不含货币；「任意类」上游已解析成具体物品）。
type FishCostItem struct {
	ID    int `json:"id"`
	Stack int `json:"stack"`
}

// FishGood 是货架上的一条商品。
//
// 字段来源：插件 `TShockFishShop/TShockFishShop/RestApi.cs` 的 `GoodsJson`，与
// `docs/REST-API.md` §2.1 一致——`list` 的每条 = `ask` 的整个 response（`ask` 另多 `shop`）。
// 上游约定「只增不改名」：新字段直接加，老字段别改。
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
	// 限购（空数组 = 不限）：限制用户组 / 限制玩家（白名单）/ 禁止玩家（黑名单）。
	AllowGroup   []string `json:"allowGroup"`
	AllowPlayers []string `json:"allowPlayers"`
	DenyPlayers  []string `json:"denyPlayers"`

	// ── 结构化追加字段（给前端做展示 / 粗筛能否购买） ──
	// ID：>0 原版物品，<0 内置商品/服务（多条商品可共用一个 id）。
	ID    int `json:"id"`
	Stack int `json:"stack"`
	// Prefix 是词缀数值 id（0 = 无词缀）。
	Prefix int `json:"prefix"`
	// IconID 是图标的物品 id（0 = 没配图标）；不想解析 Icon 字符串就用它。
	IconID int `json:"iconId"`
	// ArgCount 是需要的透传参数个数：0 = 不需要，{args} 记 1，{0}{1}… 取最大序号 +1。
	ArgCount int `json:"argCount"`
	// CostMoney 是单件价格的铜币数（不含扣物品）。
	CostMoney int64 `json:"costMoney"`
	// CostItems 是要扣的物品（不含货币）。
	CostItems []FishCostItem `json:"costItems"`
	// Check 是购买前检查（check）的说明文本，空串 = 无检查。
	Check string `json:"check"`
	// Limit / ServerLimit：每人限购次数 / 全服限购总数（0 = 不限）。**这是配置值**，
	// 「你还剩几次」与调用者绑定，list/ask 拿不到，只能靠 buy 的报错。
	Limit       int `json:"limit"`
	ServerLimit int `json:"serverLimit"`
	// CD / ServerCD：同一玩家 / 全服冷却秒数（0 = 不限）。
	CD       int `json:"cd"`
	ServerCD int `json:"serverCd"`
	// NeedAlive / NeedDay / NeedNight：死亡不能买 / 只能白天买 / 只能夜晚买。
	NeedAlive bool `json:"needAlive"`
	NeedDay   bool `json:"needDay"`
	NeedNight bool `json:"needNight"`
	// Shop 是店名，**只有 `/fishshop/ask` 返回**（list 的店名在顶层 name）。
	Shop string `json:"shop,omitempty"`

	// ── 个人状态字段（**仅上游 `?self=1` 时返回**；见 docs/REST-API.md §2.2） ──
	// CanBuy 为 nil = 这次没带 self（不知道能不能买）；false 时 BlockReason 是上游给的原因。
	// 用指针是为了把「没带」与「不能买」区分开。
	CanBuy      *bool  `json:"canBuy,omitempty"`
	BlockReason string `json:"blockReason,omitempty"`
	// MyCount / ServerCount：该玩家已买过几次 / 全服已卖出几个（按商品 id 统计）。
	MyCount     int `json:"myCount,omitempty"`
	ServerCount int `json:"serverCount,omitempty"`
	// MyRemain / ServerRemain：还能买几次 / 全服还能卖几个；**-1 = 不限**。
	MyRemain     int `json:"myRemain,omitempty"`
	ServerRemain int `json:"serverRemain,omitempty"`
	// MyCdRemain / ServerCdRemain：个人 / 全服冷却剩余秒数（0 = 可买）。
	MyCdRemain     int `json:"myCdRemain,omitempty"`
	ServerCdRemain int `json:"serverCdRemain,omitempty"`
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
	// Amount 是**实际成交件数**（会被 buyMax / 物品堆叠上限夹小）。
	Amount int `json:"amount"`
	// Requested 是请求的件数（没被夹小时与 Amount 相同）。
	Requested int `json:"requested"`
	// Refunded 为 true = 动作执行了但商品没发出去（仪式失败等），支付已自动全额退还到鱼罐，
	// 此时 Amount 记 0、Cost 为空串。
	Refunded bool   `json:"refunded"`
	Cost     string `json:"cost"`
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

// FishProbe 探测 FishShop 是否可用：读一次货架（`/fishshop/list`，与 FishList 同一个端点）。
//
// 为什么用 list 而不是 ask：ask 的语义是「问某个商品怎么卖」，空 serial 只能靠插件回
// 「缺少 serial 参数」反推「端点在」，属于借报错探测；list 本身就是拿货架，
// 一次只读请求就能回答「插件在不在 / REST 通不通 / 这个 token 能不能用」。
//
//   - 2xx → 插件在、REST 可用、当前 token 能访问（货架数据由 /api/fish/list 单独取）
//   - 400 → 同上，只是业务上拿不到货架（如「商店打烊」）：探测仍算通过，
//     页面展示上游原文，比误报「无法检测鱼店插件」更准确
//   - 403 → 缺权限（老版本 `fishshop.rest.use`）或 token 失效（KindTokenInvalid）
//   - 404 → 没注册端点：没装插件（KindNotFound），
//     或装了 v1.6.2 之前的老版本（只有指令、没有 REST）→ KindPluginOutdated
//
// 这是只读探测，不会购买或修改任何数据。
func (c *Client) FishProbe(ctx context.Context, token string) error {
	_, err := c.FishList(ctx, token, false)
	if err == nil {
		return nil
	}
	var e *APIError
	if !errors.As(err, &e) {
		return err
	}
	switch e.Kind {
	case KindBadRequest:
		// 端点存在、权限通过，只是业务失败（商店打烊等）。
		return nil
	case KindNotFound:
		return c.fishNoREST(ctx, token, e)
	}
	return err
}

// fishNoREST 区分「没装插件」与「老版本插件没有 REST 接口」：
// `/fishshop/list` 404 时，用游戏内 `/fish help` 探一下指令是否存在
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
//
// self=true 时带 `self=1`：上游按 token 同名玩家身份算限购 / 冷却，每条多返回个人状态
// （`canBuy` / `myRemain` / `myCdRemain` …）。代价是**该玩家必须在线**，否则上游 400。
func (c *Client) FishList(ctx context.Context, token string, self bool) (*FishShop, error) {
	q := url.Values{}
	q.Set("token", token)
	if self {
		q.Set("self", "1")
	}

	status, body, err := c.do(ctx, fishList, q)
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

// FishAsk 调用 `/fishshop/ask`，返回单条商品详情（「问某个商品怎么卖」）。
// self=true 同 FishList：多返回个人状态，但要求玩家在线。
func (c *Client) FishAsk(ctx context.Context, token string, serial int, self bool) (*FishGood, error) {
	q := url.Values{}
	q.Set("serial", strconv.Itoa(serial))
	q.Set("token", token)
	if self {
		q.Set("self", "1")
	}

	status, body, err := c.do(ctx, fishAsk, q)
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
// args 按空格拆成多个参数，替换商品 cmds 的 `{args}` / `{0}{1}…` 占位符；仅指令类商品需要。
// amount < 1 归一到 1（插件侧会直接 400，API 层约定「缺省 = 1」，所以永远发 ≥1）。
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

	status, body, err := c.do(ctx, fishBuy, q)
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
