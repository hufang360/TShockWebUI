package tshock

// 玩家管理（TShock 第三方插件 PlayerManager 的 REST 端点）。
//
// 事实来源：本地插件源码 `TShockPlayerManager/PlayerManager/Rest.cs`（v6.2.1）与实测。
//   - `GET /pm/look?name=&token=`    → 玩家血量/蓝量 + 背包；需要权限 `playermanager`。
//   - `GET /pm/export?name=&base64=true&token=` → 整个 .plr 存档的 base64；同样需要 `playermanager`。
//
// 权限完全由 TShock / PlayerManager 判定，本层不做提权：
//   - 端点不存在（服务器没装插件）→ HTTP 404 → KindNotFound。
//   - 有 token 但缺 `playermanager` → HTTP 403 → KindNoPermission。
//   - 参数缺失（探测用）→ HTTP 400。
//
// 背包数据格式：PlayerManager 把 `NetItem` 数组用 "~" 连接，每个 NetItem 的
// `ToString()` 是 "netId,stack,prefixId,favorited"（TShockAPI/NetItem.cs），
// 槽位顺序由 NetItem 的 Index 常量定义（背包 59、装备 20、染料 10、杂项 5+5、
// 猪猪 40、保险箱 40、垃圾桶 1、熔炉 40、虚空袋 40、三套配装各 20+10 = 350）。

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// PlayerItem 是背包里的一个格子（空格子 id=0）。
type PlayerItem struct {
	Slot      int  `json:"slot"`
	ID        int  `json:"id"`
	Stack     int  `json:"stack"`
	Prefix    int  `json:"prefix"`
	Favorited bool `json:"favorited"`
}

// PlayerLook 是 `/pm/look` 的规范化结果。
//
// 除背包外，PlayerManager 还会返回外观（画角色用）与一批只读的成就/永久增强标记；
// 颜色是 `TShock.Utils.EncodeColor` 的 int32 小端 RGBA（`R=b[0] G=b[1] B=b[2] A=b[3]`）。
type PlayerLook struct {
	Name      string       `json:"name"`
	Online    bool         `json:"online"`
	Health    int          `json:"health"`
	MaxHealth int          `json:"maxHealth"`
	Mana      int          `json:"mana"`
	MaxMana   int          `json:"maxMana"`
	Items     []PlayerItem `json:"items"`

	// 外观
	SkinVariant     int  `json:"skinVariant"`
	Hair            int  `json:"hair"`
	HairDye         int  `json:"hairDye"`
	HairColor       *int `json:"hairColor"`
	PantsColor      *int `json:"pantsColor"`
	ShirtColor      *int `json:"shirtColor"`
	UnderShirtColor *int `json:"underShirtColor"`
	ShoeColor       *int `json:"shoeColor"`
	SkinColor       *int `json:"skinColor"`
	EyeColor        *int `json:"eyeColor"`

	// 其它只读信息（成就 / 永久增强 / 重生点）
	ExtraSlot            bool `json:"extraSlot"`            // 恶魔之心：额外配饰槽
	SpawnX               int  `json:"spawnX"`               // 重生点 X（-1 = 未设置）
	SpawnY               int  `json:"spawnY"`               // 重生点 Y
	QuestsCompleted      int  `json:"questsCompleted"`      // 渔夫任务完成次数
	UsingBiomeTorches    bool `json:"usingBiomeTorches"`
	HappyFunTorchTime    bool `json:"happyFunTorchTime"`
	UnlockedBiomeTorches bool `json:"unlockedBiomeTorches"` // 火把神徽章
	CurrentLoadoutIndex  int  `json:"currentLoadoutIndex"`
	AteArtisanBread      bool `json:"ateArtisanBread"`
	UsedAegisCrystal     bool `json:"usedAegisCrystal"`
	UsedAegisFruit       bool `json:"usedAegisFruit"`
	UsedArcaneCrystal    bool `json:"usedArcaneCrystal"`
	UsedGalaxyPearl      bool `json:"usedGalaxyPearl"`
	UsedGummyWorm        bool `json:"usedGummyWorm"`
	UsedAmbrosia         bool `json:"usedAmbrosia"`
	UnlockedSuperCart    bool `json:"unlockedSuperCart"`
	EnabledSuperCart     bool `json:"enabledSuperCart"`
}

// PlayerCapability 描述 PlayerManager 的可用性（供前端决定是否显示模块）。
type PlayerCapability struct {
	// Plugin 为 true 表示服务器已安装 PlayerManager（`/pm/*` 端点存在）。
	Plugin bool `json:"plugin"`
	// Permission 为 true 表示当前登录用户所在组有 `playermanager` 权限。
	Permission bool `json:"permission"`
}

// playerLookRaw 是 `/pm/look` 的原始响应中我们用到的字段。
//
// 注意：`extraSlot` / `ateArtisanBread` / `usingBiomeTorches` 等字段在
// 在线分支返回 0/1（int）、离线分支返回 bool，故用 flexBool 兼容。
type playerLookRaw struct {
	Name      string `json:"name"`
	Online    int    `json:"online"`
	Health    int    `json:"health"`
	MaxHealth int    `json:"maxHealth"`
	Mana      int    `json:"mana"`
	MaxMana   int    `json:"maxMana"`
	Inventory string `json:"inventory"`

	SkinVariant     *int     `json:"skinVariant"`
	Hair            *int     `json:"hair"`
	HairDye         *int     `json:"hairDye"`
	HairColor       *int     `json:"hairColor"`
	PantsColor      *int     `json:"pantsColor"`
	ShirtColor      *int     `json:"shirtColor"`
	UnderShirtColor *int     `json:"underShirtColor"`
	ShoeColor       *int     `json:"shoeColor"`
	SkinColor       *int     `json:"skinColor"`
	EyeColor        *int     `json:"eyeColor"`
	ExtraSlot       flexBool `json:"extraSlot"`
	SpawnX          int      `json:"spawnX"`
	SpawnY          int      `json:"spawnY"`
	QuestsCompleted int      `json:"questsCompleted"`

	UsingBiomeTorches    flexBool `json:"usingBiomeTorches"`
	HappyFunTorchTime    flexBool `json:"happyFunTorchTime"`
	UnlockedBiomeTorches flexBool `json:"unlockedBiomeTorches"`
	CurrentLoadoutIndex  int      `json:"currentLoadoutIndex"`
	AteArtisanBread      flexBool `json:"ateArtisanBread"`
	UsedAegisCrystal     flexBool `json:"usedAegisCrystal"`
	UsedAegisFruit       flexBool `json:"usedAegisFruit"`
	UsedArcaneCrystal    flexBool `json:"usedArcaneCrystal"`
	UsedGalaxyPearl      flexBool `json:"usedGalaxyPearl"`
	UsedGummyWorm        flexBool `json:"usedGummyWorm"`
	UsedAmbrosia         flexBool `json:"usedAmbrosia"`
	UnlockedSuperCart    flexBool `json:"unlockedSuperCart"`
	EnabledSuperCart     flexBool `json:"enabledSuperCart"`
}

// flexBool 兼容 PlayerManager 返回的 `0`/`1`、`true`/`false` 与 `null`（另外容错非法值）。
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	switch s {
	case "", "null", "false":
		*b = false
		return nil
	case "true":
		*b = true
		return nil
	}
	n, err := strconv.Atoi(strings.Trim(s, `"`))
	if err != nil {
		*b = false
		return nil
	}
	*b = n != 0
	return nil
}

// ParseInventory 解析 PlayerManager 的 inventory 串。
// 容错：单个格子格式异常时按空格子处理，绝不因一格报错丢弃整份数据。
func ParseInventory(s string) []PlayerItem {
	parts := strings.Split(s, "~")
	items := make([]PlayerItem, 0, len(parts))
	for i, p := range parts {
		it := PlayerItem{Slot: i}
		fields := strings.Split(p, ",")
		if len(fields) >= 4 {
			if v, err := strconv.Atoi(strings.TrimSpace(fields[0])); err == nil {
				it.ID = v
			}
			if v, err := strconv.Atoi(strings.TrimSpace(fields[1])); err == nil {
				it.Stack = v
			}
			if v, err := strconv.Atoi(strings.TrimSpace(fields[2])); err == nil {
				it.Prefix = v
			}
			it.Favorited = strings.TrimSpace(fields[3]) == "1"
		}
		items = append(items, it)
	}
	return items
}

// PlayerLook 调用 `/pm/look`。name 为空时由调用方保证不触发（见 PlayerProbe）。
func (c *Client) PlayerLook(ctx context.Context, token, name string) (*PlayerLook, error) {
	q := url.Values{}
	q.Set("name", name)
	q.Set("token", token)

	status, body, err := c.do(ctx, "/pm/look", q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	var raw playerLookRaw
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "PlayerManager 返回非法 JSON"}
	}
	return &PlayerLook{
		Name:      raw.Name,
		Online:    raw.Online != 0,
		Health:    raw.Health,
		MaxHealth: raw.MaxHealth,
		Mana:      raw.Mana,
		MaxMana:   raw.MaxMana,
		Items:     ParseInventory(raw.Inventory),

		SkinVariant:     intOr0(raw.SkinVariant),
		Hair:            intOr0(raw.Hair),
		HairDye:         intOr0(raw.HairDye),
		HairColor:       raw.HairColor,
		PantsColor:      raw.PantsColor,
		ShirtColor:      raw.ShirtColor,
		UnderShirtColor: raw.UnderShirtColor,
		ShoeColor:       raw.ShoeColor,
		SkinColor:       raw.SkinColor,
		EyeColor:        raw.EyeColor,

		ExtraSlot:            bool(raw.ExtraSlot),
		SpawnX:               raw.SpawnX,
		SpawnY:               raw.SpawnY,
		QuestsCompleted:      raw.QuestsCompleted,
		UsingBiomeTorches:    bool(raw.UsingBiomeTorches),
		HappyFunTorchTime:    bool(raw.HappyFunTorchTime),
		UnlockedBiomeTorches: bool(raw.UnlockedBiomeTorches),
		CurrentLoadoutIndex:  raw.CurrentLoadoutIndex,
		AteArtisanBread:      bool(raw.AteArtisanBread),
		UsedAegisCrystal:     bool(raw.UsedAegisCrystal),
		UsedAegisFruit:       bool(raw.UsedAegisFruit),
		UsedArcaneCrystal:    bool(raw.UsedArcaneCrystal),
		UsedGalaxyPearl:      bool(raw.UsedGalaxyPearl),
		UsedGummyWorm:        bool(raw.UsedGummyWorm),
		UsedAmbrosia:         bool(raw.UsedAmbrosia),
		UnlockedSuperCart:    bool(raw.UnlockedSuperCart),
		EnabledSuperCart:     bool(raw.EnabledSuperCart),
	}, nil
}

func intOr0(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

// PlayerExport 调用 `/pm/export?base64=true`，返回解码后的 .plr 字节。
func (c *Client) PlayerExport(ctx context.Context, token, name string) ([]byte, error) {
	q := url.Values{}
	q.Set("name", name)
	q.Set("base64", "true")
	q.Set("token", token)

	status, body, err := c.doLimit(ctx, "/pm/export", q, maxExportBody)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}
	var out struct {
		Base64s []string `json:"base64s"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "PlayerManager 返回非法 JSON"}
	}
	if len(out.Base64s) == 0 || strings.TrimSpace(out.Base64s[0]) == "" {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "PlayerManager 未返回存档数据"}
	}
	data, derr := base64.StdEncoding.DecodeString(out.Base64s[0])
	if derr != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "存档 base64 解码失败"}
	}
	return data, nil
}

// PlayerProbe 探测 PlayerManager 是否可用：用「不带 name」调用 `/pm/look`。
//
//   - 404 → 插件未安装（KindNotFound）
//   - 403 → 缺权限（KindNoPermission）或 token 失效（KindTokenInvalid）
//   - 400 → 插件存在（PlayerManager 报「未找到参数 name」）
//   - 2xx → 插件存在
//
// 这是只读探测，不会导出/修改任何数据。
func (c *Client) PlayerProbe(ctx context.Context, token string) error {
	q := url.Values{}
	q.Set("token", token)

	status, body, err := c.do(ctx, "/pm/look", q)
	if err != nil {
		return err
	}
	if status == http.StatusBadRequest {
		// 插件已安装并已通过权限校验，只是缺 name 参数。
		return nil
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return e
	}
	return nil
}
