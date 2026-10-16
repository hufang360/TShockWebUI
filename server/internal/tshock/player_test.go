package tshock

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestParseInventory(t *testing.T) {
	items := ParseInventory("1,5,0,0~0,0,0,0~66,1,3,1")
	if len(items) != 3 {
		t.Fatalf("len = %d，期望 3", len(items))
	}
	if items[0].Slot != 0 || items[0].ID != 1 || items[0].Stack != 5 {
		t.Fatalf("items[0] = %+v", items[0])
	}
	if items[1].ID != 0 {
		t.Fatalf("空格子应保留：%+v", items[1])
	}
	if !items[2].Favorited || items[2].Prefix != 3 {
		t.Fatalf("items[2] = %+v", items[2])
	}
}

func TestParseInventoryMalformedKeepsSlots(t *testing.T) {
	items := ParseInventory("1,5,0,0~garbage~")
	if len(items) != 3 {
		t.Fatalf("len = %d，期望 3（格式异常按空格子处理）", len(items))
	}
	if items[1].ID != 0 || items[2].ID != 0 {
		t.Fatalf("异常格应为空：%+v", items)
	}
}

func TestPlayerLookParsesInventory(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pm/look" || r.URL.Query().Get("name") != "hf" {
			t.Errorf("path=%s q=%v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"name": "hf", "online": 1, "health": 400, "maxHealth": 500,
			"mana": 100, "maxMana": 200, "inventory": "4956,1,0,0~0,0,0,0",
		})
	}), time.Second)

	look, err := c.PlayerLook(context.Background(), "tok", "hf")
	if err != nil {
		t.Fatalf("PlayerLook: %v", err)
	}
	if !look.Online || look.Health != 400 || look.MaxHealth != 500 {
		t.Fatalf("look = %+v", look)
	}
	if len(look.Items) != 2 || look.Items[0].ID != 4956 {
		t.Fatalf("items = %+v", look.Items)
	}
}

func TestPlayerExportDecodesBase64(t *testing.T) {
	want := []byte("PLR\x00binary")
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("base64") != "true" {
			t.Errorf("缺少 base64=true：%v", r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{"names": []string{"hf"}, "base64s": []string{base64.StdEncoding.EncodeToString(want)}})
	}), time.Second)

	got, err := c.PlayerExport(context.Background(), "tok", "hf")
	if err != nil {
		t.Fatalf("PlayerExport: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("data = %q，期望 %q", got, want)
	}
}

func TestPlayerProbePluginMissingIsNotFound(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "Specified API endpoint doesn't exist."})
	}), time.Second)

	err := c.PlayerProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNotFound {
		t.Fatalf("err = %v，期望 KindNotFound", err)
	}
}

func TestPlayerProbeBadRequestMeansPresent(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"error": "未找到参数 name，或者值无效！"})
	}), time.Second)

	if err := c.PlayerProbe(context.Background(), "tok"); err != nil {
		t.Fatalf("插件存在时探测应成功，得到 %v", err)
	}
}

// TestPlayerLookBadRequestSurfacesMessage：插件用 400 表达业务错误（如查无此玩家），
// 必须归为 KindBadRequest 并保留原文，供 API 层透出给用户。
func TestPlayerLookBadRequestSurfacesMessage(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 400, map[string]any{"error": "找不到名为 hf 的玩家!"})
	}), time.Second)

	_, err := c.PlayerLook(context.Background(), "tok", "hf")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindBadRequest {
		t.Fatalf("err = %v，期望 KindBadRequest", err)
	}
	if e.Message != "找不到名为 hf 的玩家!" {
		t.Fatalf("message = %q", e.Message)
	}
}

func TestPlayerProbeNoPermission(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/tokentest" {
			writeJSON(w, 200, map[string]any{"associateduser": "hf"})
			return
		}
		writeJSON(w, 403, map[string]any{"error": "未授权。用户没有权限使用指定的 API 终结点。"})
	}), time.Second)

	err := c.PlayerProbe(context.Background(), "tok")
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindNoPermission {
		t.Fatalf("err = %v，期望 KindNoPermission", err)
	}
}

// 404 必须是 KindNotFound，而不是被当成普通 4xx。
func TestClassifyNotFound(t *testing.T) {
	if e := classify(http.StatusNotFound, []byte(`{"error":"nope"}`)); e == nil || e.Kind != KindNotFound {
		t.Fatalf("classify(404) = %+v", e)
	}
}

// 外观与只读信息字段（画角色 / 显示成就用）。
func TestPlayerLookParsesAppearanceAndExtras(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"name": "hf", "online": 1, "health": 1, "maxHealth": 2, "mana": 3, "maxMana": 4,
			"inventory":   "0,0,0,0",
			"skinVariant": 3, "hair": 42, "hairDye": 1,
			"hairColor": 16843009, "shirtColor": nil,
			"extraSlot": 1, "questsCompleted": 7, "spawnX": 100, "spawnY": 200,
			"usingBiomeTorches": true, "ateArtisanBread": 1, "usedAmbrosia": 0,
			"unlockedSuperCart": 1, "enabledSuperCart": 0,
		})
	}), time.Second)

	look, err := c.PlayerLook(context.Background(), "tok", "hf")
	if err != nil {
		t.Fatalf("PlayerLook: %v", err)
	}
	if look.SkinVariant != 3 || look.Hair != 42 || look.HairDye != 1 {
		t.Fatalf("外观 = %+v", look)
	}
	if look.HairColor == nil || *look.HairColor != 16843009 {
		t.Fatalf("hairColor = %v", look.HairColor)
	}
	if look.ShirtColor != nil {
		t.Fatalf("shirtColor 应为 nil，得到 %v", *look.ShirtColor)
	}
	if !look.ExtraSlot || look.QuestsCompleted != 7 || look.SpawnX != 100 || look.SpawnY != 200 {
		t.Fatalf("extras = %+v", look)
	}
	if !look.UsingBiomeTorches || !look.AteArtisanBread || look.UsedAmbrosia || !look.UnlockedSuperCart || look.EnabledSuperCart {
		t.Fatalf("bool extras = %+v", look)
	}
}

// flexBool：在线分支给 0/1、离线分支给 true/false，都要能解析。
func TestFlexBool(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want bool
	}{
		{`true`, true},
		{`false`, false},
		{`1`, true},
		{`0`, false},
		{`null`, false},
		{`"1"`, true},
		{`garbage`, false},
	} {
		var b flexBool
		if err := b.UnmarshalJSON([]byte(tc.in)); err != nil {
			t.Fatalf("UnmarshalJSON(%q): %v", tc.in, err)
		}
		if bool(b) != tc.want {
			t.Fatalf("flexBool(%q) = %v，期望 %v", tc.in, bool(b), tc.want)
		}
	}
}
