package api

import (
	"testing"

	"tshockwebui/server/internal/plr"
)

// TestPlayerLookFromPLR 验证 .plr → PlayerLook 的槽位与颜色映射（与 TShock 的编码一致）。
func TestPlayerLookFromPLR(t *testing.T) {
	p := &plr.Player{
		Name:              "hf",
		Hair:              15,
		HairDye:           7,
		SkinVariant:       2,
		StatLife:          357,
		StatLifeMax:       500,
		StatMana:          20,
		StatManaMax:       200,
		ExtraAccessory:    true,
		UsingBiomeTorches: true,
		HairColor:         [3]byte{215, 90, 55},
		SkinColor:         [3]byte{255, 125, 90},
	}
	p.Inventory[0] = plr.Item{ID: 4956, Stack: 1, Prefix: 81}
	p.Armor[0] = plr.Item{ID: 3, Stack: 1}
	p.PiggyBank[0] = plr.Item{ID: 74, Stack: 26}
	p.VoidVault[0] = plr.Item{ID: 4131, Stack: 1, Favorited: true}

	look := playerLookFromPLR(p)
	if look.Name != "hf" || look.Online {
		t.Fatalf("name/online = %q/%v", look.Name, look.Online)
	}
	if look.Health != 357 || look.MaxHealth != 500 || look.Mana != 20 || look.MaxMana != 200 {
		t.Fatalf("hp/mp = %d/%d %d/%d", look.Health, look.MaxHealth, look.Mana, look.MaxMana)
	}
	if look.SpawnX != -1 || look.SpawnY != -1 {
		t.Fatalf("spawn = %d,%d，期望 -1,-1", look.SpawnX, look.SpawnY)
	}
	if len(look.Items) != 350 {
		t.Fatalf("items = %d，期望 350", len(look.Items))
	}
	byslot := func(n int) int {
		if n < 0 || n >= len(look.Items) {
			t.Fatalf("slot %d 越界", n)
		}
		return look.Items[n].ID
	}
	for slot, want := range map[int]int{0: 4956, 59: 3, 99: 74, 220: 4131} {
		if got := byslot(slot); got != want {
			t.Errorf("slot %d = %d，期望 %d", slot, got, want)
		}
	}
	if !look.Items[220].Favorited {
		t.Errorf("虚空袋 favorited 应为 true")
	}
	if look.SkinVariant != 2 || look.Hair != 15 || look.HairDye != 7 {
		t.Fatalf("外观 = skin %d hair %d dye %d", look.SkinVariant, look.Hair, look.HairDye)
	}
	if look.HairColor == nil || *look.HairColor != (215|90<<8|55<<16|255<<24) {
		t.Fatalf("hairColor = %v", look.HairColor)
	}
	if !look.ExtraSlot || !look.UsingBiomeTorches {
		t.Fatalf("标记位 = extra %v torches %v", look.ExtraSlot, look.UsingBiomeTorches)
	}
}
