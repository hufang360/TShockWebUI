package tshock

import (
	"context"
	"errors"
	"net/http"
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
					{"serial": 1, "name": "生命水晶", "icon": "", "buyMax": 999, "needArgs": false, "map": []string{"物品"}, "desc": "[i:29] 生命水晶", "cost": "5 金币", "refund": 0},
					{"serial": 160, "name": "地图上找", "icon": "[i:5041]", "buyMax": 1, "needArgs": true, "map": []string{"find"}, "desc": "全图查找", "cost": "[i/s15:73]", "refund": 1, "allowGroup": []string{"GM"}, "allowPlayers": []string{"hf"}, "denyPlayers": []string{"bad"}},
				},
			},
		})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok")
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if shop.Name != "鱼店" || shop.Total != 2 || len(shop.Goods) != 2 {
		t.Fatalf("shop = %+v", shop)
	}
	if shop.Goods[0].Serial != 1 || shop.Goods[1].Name != "地图上找" || !bool(shop.Goods[1].Refund) {
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
}

func TestFishListEmptyGoodsIsArray(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"name": "x", "total": 0}})
	}), time.Second)

	shop, err := c.FishList(context.Background(), "tok")
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if shop.Goods == nil {
		t.Fatalf("Goods 不应为 nil（应与前端 [] 契约一致）")
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
			"response": map[string]any{"serial": 8, "name": "[i:29] 生命水晶", "amount": 5, "cost": "25 金币"},
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

// 新版插件去掉了 v3 前缀：先用 /fishshop/*，404 时回退 /v3/fishshop/*（v1.6.2 ~ v1.6.6）。
func TestFishListFallsBackToLegacyV3Prefix(t *testing.T) {
	var newPathHits int
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/fishshop/list":
			newPathHits++
			writeJSON(w, 404, map[string]any{"status": 404, "error": "Specified API endpoint doesn't exist."})
		case "/v3/fishshop/list":
			writeJSON(w, 200, map[string]any{"status": 200, "response": map[string]any{"name": "老鱼店", "total": 0}})
		default:
			t.Errorf("path = %s", r.URL.Path)
			writeJSON(w, 404, map[string]any{"error": "nope"})
		}
	}), time.Second)

	first, err := c.FishList(context.Background(), "tok")
	if err != nil {
		t.Fatalf("FishList: %v", err)
	}
	if first.Name != "老鱼店" {
		t.Fatalf("shop = %+v", first)
	}
	// 第二次调用应直接用已缓存的前缀，不再去试新地址。
	if _, err := c.FishList(context.Background(), "tok"); err != nil {
		t.Fatalf("FishList 再次调用：%v", err)
	}
	if newPathHits != 1 {
		t.Fatalf("/fishshop/list 命中 %d 次，期望 1（前缀应已缓存）", newPathHits)
	}
}

// 老版本插件只有游戏内指令、没有 REST：两前缀 404，但 /fish 能跑 → KindPluginOutdated。
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

// 两前缀 404 且游戏内也没有 /fish 指令 → 已安装老插件以外的情形，仍按未安装处理。
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

// 缺 serial 的 400 说明插件已安装（与 PlayerProbe 同样的判定思路）。
func TestFishProbeBadRequestMeansPresent(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("serial") != "" {
			t.Errorf("探测不应带 serial：%v", r.URL.Query())
		}
		writeJSON(w, 400, map[string]any{"status": 400, "error": "缺少 serial 参数"})
	}), time.Second)

	if err := c.FishProbe(context.Background(), "tok"); err != nil {
		t.Fatalf("插件存在时探测应成功，得到 %v", err)
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
