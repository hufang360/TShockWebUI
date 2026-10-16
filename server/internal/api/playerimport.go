package api

import (
	"io"
	"net/http"

	"tshockwebui/server/internal/plr"
	"tshockwebui/server/internal/tshock"
)

// maxImportBody 是本地导入 .plr 的体积上限（角色存档通常 < 1 MiB）。
const maxImportBody = 4 << 20

// handlePlayerImport 解析浏览器上传的 .plr 并返回规范化后的 PlayerLook（**仅展示**，不落库、不改服）。
//
// 与 /api/player/look 的区别：数据来自本地文件而非 TShock；因此只需登录（不要求 playermanager）。
// 前端只在已安装 PlayerManager 且当前用户有权限时才显示入口。
func (s *Server) handlePlayerImport(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeNotAuthenticated, "请先登录")
		return
	}
	if !s.commandLimiter.Allow(sess.ID) {
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "操作过于频繁，请稍后再试")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxImportBody+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "读取文件失败")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "文件为空")
		return
	}
	if len(body) > maxImportBody {
		writeError(w, http.StatusBadRequest, codeBadRequest, "角色存档过大（上限 4 MiB）")
		return
	}
	p, perr := plr.Parse(body)
	if perr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "无法解析角色存档："+perr.Error())
		return
	}
	writeJSON(w, http.StatusOK, playerLookFromPLR(p))
}

// playerLookFromPLR 把 .plr 解析结果映射成与 /api/player/look 相同的结构，
// 让前端沿用同一套背包 / 角色渲染。未解析的字段用默认值（在线=false、重生点=-1）。
func playerLookFromPLR(p *plr.Player) tshock.PlayerLook {
	slots := p.Slots()
	items := make([]tshock.PlayerItem, 0, len(slots))
	for i, it := range slots {
		items = append(items, tshock.PlayerItem{
			Slot:      i,
			ID:        it.ID,
			Stack:     it.Stack,
			Prefix:    it.Prefix,
			Favorited: it.Favorited,
		})
	}
	// 与 TShock.Utils.EncodeColor 一致：int32 小端 RGBA（R=b0 G=b1 B=b2 A=b3），A 恒为 255。
	color := func(c [3]byte) *int {
		return intPtr(int(c[0]) | int(c[1])<<8 | int(c[2])<<16 | 255<<24)
	}
	return tshock.PlayerLook{
		Name:            p.Name,
		Online:          false,
		Health:          p.StatLife,
		MaxHealth:       p.StatLifeMax,
		Mana:            p.StatMana,
		MaxMana:         p.StatManaMax,
		Items:           items,
		SkinVariant:     p.SkinVariant,
		Hair:            p.Hair,
		HairDye:         p.HairDye,
		HairColor:       color(p.HairColor),
		PantsColor:      color(p.PantsColor),
		ShirtColor:      color(p.ShirtColor),
		UnderShirtColor: color(p.UnderShirtColor),
		ShoeColor:       color(p.ShoeColor),
		SkinColor:       color(p.SkinColor),
		EyeColor:        color(p.EyeColor),
		ExtraSlot:       p.ExtraAccessory,
		SpawnX:          -1,
		SpawnY:          -1,

		UsingBiomeTorches:    p.UsingBiomeTorches,
		UnlockedBiomeTorches: p.UnlockedBiomeTorches,
		AteArtisanBread:      p.AteArtisanBread,
		UsedAegisCrystal:     p.UsedAegisCrystal,
		UsedAegisFruit:       p.UsedAegisFruit,
		UsedArcaneCrystal:    p.UsedArcaneCrystal,
		UsedGalaxyPearl:      p.UsedGalaxyPearl,
		UsedGummyWorm:        p.UsedGummyWorm,
		UsedAmbrosia:         p.UsedAmbrosia,
	}
}
