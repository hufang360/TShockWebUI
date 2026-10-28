package tshock

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestFishListParsesGoods(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fishshop/list" || r.URL.Query().Get("token") != "tok" {
			t.Errorf("path=%s q=%v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"status": 200,
			"response": map[string]any{
				"name":  "鱼店",
				"total": 2,
				"goods": []map[string]any{
					{"serial": 1, "name": "生命水晶", "icon": "", "buyMax": 999, "needArgs": false, "map": []string{"物品"}, "desc": "[i:29] 生命水晶", "cost": "5 金币"},
					{"serial": 160, "name": "地图上找", "icon": "[i:5041]", "buyMax": 1, "needArgs": true, "map": []string{"find"}, "desc": "全图查找", "cost": "[i/s15:73]", "allowGroup": []string{"GM"}, "allowPlayers": []string{"hf"}, "denyPlayers": []string{"bad"},
						"id": 5041, "stack": 1, "prefix": 0, "iconId": 5041, "argCount": 1, "costMoney": 10000,
						"costItems": []map[string]any{{"id": 29, "stack": 3}}, "check": "需先击败骷髅王",
						"limit": 3, "serverLimit": 10, "cd": 60, "serverCd": 30,
						"needAlive": true, "needDay": false, "needNight": true},
				},
			},
		})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok", false)
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if shop.Name != "鱼店" || shop.Total != 2 || len(shop.Goods) != 2 {
		t.Fatalf("shop = %+v", shop)
	}
	if shop.Goods[0].Serial != 1 || shop.Goods[1].Name != "地图上找" || shop.Goods[1].ArgCount != 1 {
		t.Fatalf("goods = %+v", shop.Goods)
	}
	// map 是插件侧的 List<string>：必须按数组解析，否则整个货架会解析失败。
	if len(shop.Goods[1].Map) != 1 || shop.Goods[1].Map[0] != "find" {
		t.Fatalf("map = %+v", shop.Goods[1].Map)
	}
	// icon 是插件配置的图标标签，必须原样透传给前端。
	if shop.Goods[1].Icon != "[i:5041]" {
		t.Fatalf("icon = %q，期望 [i:5041]", shop.Goods[1].Icon)
	}
	// buyMax / needArgs 决定前端是否显示数量 / 参数输入。
	if shop.Goods[0].BuyMax != 999 || shop.Goods[1].BuyMax != 1 || !shop.Goods[1].NeedArgs {
		t.Fatalf("buyMax/needArgs = %+v", shop.Goods)
	}
	// 限购条件（限制组 / 限制玩家 / 禁止玩家）必须透传。
	if len(shop.Goods[1].AllowGroup) != 1 || shop.Goods[1].AllowGroup[0] != "GM" ||
		len(shop.Goods[1].AllowPlayers) != 1 || len(shop.Goods[1].DenyPlayers) != 1 {
		t.Fatalf("limits = %+v", shop.Goods[1])
	}
	// 结构化追加字段（docs/REST-API.md §2.1）：漏一个前端就少一行提示。
	g := shop.Goods[1]
	if g.ID != 5041 || g.Stack != 1 || g.Prefix != 0 || g.IconID != 5041 || g.ArgCount != 1 {
		t.Fatalf("id/stack/prefix/iconId/argCount = %+v", g)
	}
	if g.CostMoney != 10000 || len(g.CostItems) != 1 || g.CostItems[0].ID != 29 || g.CostItems[0].Stack != 3 {
		t.Fatalf("cost = %+v", g)
	}
	if g.Check != "需先击败骷髅王" {
		t.Fatalf("check = %q", g.Check)
	}
	if g.Limit != 3 || g.ServerLimit != 10 || g.CD != 60 || g.ServerCD != 30 {
		t.Fatalf("limit/cd = %+v", g)
	}
	if !g.NeedAlive || g.NeedDay || !g.NeedNight {
		t.Fatalf("needAlive/needDay/needNight = %+v", g)
	}
	// list 不带 shop（店名在顶层）；ask 才有。
	if g.Shop != "" {
		t.Fatalf("list 不应有 shop，实际 %q", g.Shop)
	}
}

func TestFishListEmptyGoodsIsArray(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"name": "x", "total": 0}})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok", false)
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if shop.Goods == nil {
		t.Fatalf("Goods 不应为 nil（应与前端 [] 契约一致）")
	}
}

// self=1：上游按 token 同名玩家算个人状态，多返回 8 个字段（docs/REST-API.md §2.2）。
func TestFishListSelfState(t *testing.T) {
	var sawSelf string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawSelf = r.URL.Query().Get("self")
		writeJSON(w, 200, map[string]any{
			"status": 200,
			"response": map[string]any{
				"name": "鱼店", "total": 1,
				"goods": []map[string]any{{
					"serial": 1, "name": "生命水晶", "limit": 3,
					"myCount": 2, "myRemain": 1, "serverCount": 5, "serverRemain": -1,
					"myCdRemain": 30, "serverCdRemain": 0,
					"canBuy": false, "blockReason": "个人冷却中，还需 30 秒",
				}},
			},
		})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok", true)
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if sawSelf != "1" {
		t.Fatalf("self = %q，期望 1", sawSelf)
	}
	g := shop.Goods[0]
	if g.CanBuy == nil || *g.CanBuy {
		t.Fatalf("canBuy = %v，期望 false", g.CanBuy)
	}
	if g.BlockReason != "个人冷却中，还需 30 秒" || g.MyRemain != 1 || g.MyCount != 2 ||
		g.ServerRemain != -1 || g.MyCdRemain != 30 {
		t.Fatalf("个人状态 = %+v", g)
	}
}

// 不带 self 时上游不会回 canBuy：必须保持 nil（→ JSON 里没有该字段），
// 前端靠「有没有这个字段」区分「不知道」与「不能买」。
func TestFishListWithoutSelfHasNoPersonalState(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("self") != "" {
			t.Errorf("不应带 self：%v", r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"name": "鱼店", "total": 1, "goods": []map[string]any{{"serial": 1, "name": "生命水晶"}}},
		})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok", false)
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if shop.Goods[0].CanBuy != nil {
		t.Fatalf("canBuy 应为 nil，实际 %v", *shop.Goods[0].CanBuy)
	}
	body, _ := json.Marshal(shop.Goods[0])
	if strings.Contains(string(body), "canBuy") {
		t.Fatalf("没有个人状态时不该序列化 canBuy：%s", body)
	}
}

// ask 的 response = list 的单条 + `shop`（店名）；其它字段与 list 完全一致。
func TestFishAskIncludesShopName(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fishshop/ask" || r.URL.Query().Get("serial") != "7" {
			t.Errorf("path=%s q=%v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"status": 200,
			"response": map[string]any{
				"serial": 7, "name": "生命水晶", "icon": "", "buyMax": 1, "needArgs": false,
				"map": []string{}, "desc": "[i:29] 生命水晶", "cost": "5 金币", "unlock": "", "comment": "",
				"argCount": 0, "limit": 0, "cd": 0, "shop": "hf 的鱼店",
			},
		})
	}), time.Second)

	good, err := c.FishAsk(context.Background(), "tok", 7, false)
	if err != nil {
		t.Fatalf("FishAsk: %v", err)
	}
	if good.Shop != "hf 的鱼店" || good.Serial != 7 {
		t.Fatalf("good = %+v", good)
	}
}

// FishShop 把业务错误放在 `error` 字段：必须原样保留文案（如「钱不够」）。
func TestFishBuyBusinessErrorKeepsMessage(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"status": 400, "error": "钱不够"})
	}), time.Second)

	_, err := c.FishBuy(context.Background(), "tok", 3, 1, "")
	var e *APIError
	if !errors.As(err, &e) {
		t.Fatalf("err = %v", err)
	}
	if e.Message != "钱不够" {
		t.Fatalf("message = %q，期望「钱不够」", e.Message)
	}
	if e.Status != 400 {
		t.Fatalf("status = %d，期望 400", e.Status)
	}
}

func TestFishBuySendsAmountAndArgs(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("serial") != "8" || q.Get("amount") != "5" || q.Get("args") != "hf" {
			t.Errorf("q = %v", q)
		}
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"serial": 8, "name": "[i:29] 生命水晶", "amount": 5, "requested": 5, "cost": "25 金币"},
		})
	}), time.Second)

	res, err := c.FishBuy(context.Background(), "tok", 8, 5, "hf")
	if err != nil {
		t.Fatalf("FishBuy: %v", err)
	}
	if res.Amount != 5 || res.Serial != 8 {
		t.Fatalf("res = %+v", res)
	}
}

// refunded=true：动作执行了但商品没发出去，支付已全额退还，amount 记 0、cost 为空。
func TestFishBuyRefunded(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"serial": 3, "name": "柚子仪式", "amount": 0, "requested": 1, "refunded": true, "cost": ""},
		})
	}), time.Second)

	res, err := c.FishBuy(context.Background(), "tok", 3, 1, "")
	if err != nil {
		t.Fatalf("FishBuy: %v", err)
	}
	if !res.Refunded || res.Amount != 0 || res.Requested != 1 || res.Cost != "" {
		t.Fatalf("res = %+v，期望 refunded=true / amount=0", res)
	}
}

// amount = **实际成交件数**（会被 buyMax / 堆叠上限夹小），requested = 请求值；
// 两者不一致时前端要告诉玩家少发了多少。
func TestFishBuyKeepsRequestedWhenClamped(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status":   200,
			"response": map[string]any{"serial": 8, "name": "生命水晶", "amount": 999, "requested": 5000, "cost": "5 金币"},
		})
	}), time.Second)

	res, err := c.FishBuy(context.Background(), "tok", 8, 5000, "")
	if err != nil {
		t.Fatalf("FishBuy: %v", err)
	}
	if res.Amount != 999 || res.Requested != 5000 {
		t.Fatalf("res = %+v，期望 amount=999 / requested=5000", res)
	}
}

// amount < 1 时应归一化为 1（与插件默认一致）。
func TestFishBuyClampsAmount(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("amount") != "1" {
			t.Errorf("amount = %q，期望 1", r.URL.Query().Get("amount"))
		}
		writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"serial": 1}})
	}), time.Second)

	if _, err := c.FishBuy(context.Background(), "tok", 1, 0, ""); err != nil {
		t.Fatalf("FishBuy: %v", err)
	}
}

func TestFishProbePluginMissingIsNotFound(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	err := c.FishProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v，期望 KindNotFound", err)
	}
}

// 不再回退 `/v3/fishshop/*`（只存在于未对外的 v1.6.2 ~ v1.6.6）：
// `/fishshop/list` 404 就是「没有 REST 接口」。
func TestFishListDoesNotFallBackToLegacyV3Prefix(t *testing.T) {
	var v3Hits int
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v3/fishshop") {
			v3Hits++
		}
		if r.URL.Path != "/fishshop/list" {
			t.Errorf("path = %s，期望只打 /fishshop/list", r.URL.Path)
		}
		writeJSON(w, 404, map[string]any{"status": 404, "error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	_, err := c.FishList(context.Background(), "tok", false)
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v，期望 KindNotFound", err)
	}
	if v3Hits != 0 {
		t.Fatalf("打到了 %d 次 /v3/fishshop/*，期望 0（不再回退旧前缀）", v3Hits)
	}
}

// 老版本插件只有游戏内指令、没有 REST：/fishshop/list 404，但 /fish 能跑 → KindPluginOutdated。
func TestFishProbeOldPluginWithoutRESTIsOutdated(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v3/server/rawcmd" {
			if r.URL.Query().Get("cmd") != "/fish help" {
				t.Errorf("cmd = %q", r.URL.Query().Get("cmd"))
			}
			writeJSON(w, 200, map[string]any{"status": 200, "response": []string{"/fish list，查看货架"}})
			return
		}
		writeJSON(w, 404, map[string]any{"status": 404, "error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	err := c.FishProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindPluginOutdated {
		t.Fatalf("err = %v，期望 KindPluginOutdated", err)
	}
}

// /fishshop/list 404 且游戏内也没有 /fish 指令 → 仍按未安装处理。
func TestFishProbeOldPluginWithoutCommandIsNotFound(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v3/server/rawcmd" {
			writeJSON(w, 200, map[string]any{"status": 200, "response": "Invalid command entered. Type /help for a list of valid commands."})
			return
		}
		writeJSON(w, 404, map[string]any{"status": 404, "error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	err := c.FishProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v，期望 KindNotFound", err)
	}
}

// 探测走 /fishshop/list（与消费端同一个端点）：2xx = 插件在、REST 可用。
func TestFishProbeUsesListEndpoint(t *testing.T) {
	var hit string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = r.URL.Path
		writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"name": "鱼店", "total": 0}})
	}), time.Second)

	if err := c.FishProbe(context.Background(), "tok"); err != nil {
		t.Fatalf("插件存在时探测应成功，得到 %v", err)
	}
	if hit != "/fishshop/list" {
		t.Fatalf("探测打了 %s，期望 /fishshop/list", hit)
	}
}

// 业务失败（如「商店打烊」）也是 400：端点存在、权限通过 → 探测仍算通过，
// 上游文案留给 /api/fish/list 原样展示。
func TestFishProbeBusinessFailureMeansPresent(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fishshop/list" {
			t.Errorf("path = %s，期望 /fishshop/list", r.URL.Path)
		}
		writeJSON(w, 400, map[string]any{"status": 400, "error": "商店打烊"})
	}), time.Second)

	if err := c.FishProbe(context.Background(), "tok"); err != nil {
		t.Fatalf("业务失败时探测应成功，得到 %v", err)
	}
}

func TestFishProbeNoPermission(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/tokentest" {
			writeJSON(w, 200, map[string]any{"associateduser": "hf"})
			return
		}
		writeJSON(w, 403, map[string]any{"error": "未授权。用户没有权限使用指定的 API 终结点。"})
	}), time.Second)

	err := c.FishProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNoPermission {
		t.Fatalf("err = %v，期望 KindNoPermission", err)
	}
}

// 新版插件不传权限参数：403 只可能是 token 无效（或用户组变动）→ 必须归类为 KindTokenInvalid，
// 让 API 层清会话回登录。区分靠 /tokentest（源码 SecureRest.cs 已核实）。
func TestFishProbeForbiddenWithInvalidTokenIsTokenInvalid(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// tokentest 也 403：说明这个 token 本身已失效。
		writeJSON(w, 403, map[string]any{"error": "未授权。指定的 API 终结点需要一个令牌，但提供的令牌无效。"})
	}), time.Second)

	err := c.FishProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindTokenInvalid {
		t.Fatalf("err = %v，期望 KindTokenInvalid", err)
	}
}
