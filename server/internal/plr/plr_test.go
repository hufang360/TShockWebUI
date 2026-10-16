package plr

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"os"
	"testing"
	"unicode/utf16"
)

// binaryWriter 按 Terraria `Player.Deserialize` 的写序构造合成存档。
type binaryWriter struct {
	buf bytes.Buffer
}

func (w *binaryWriter) u8(v byte) { w.buf.WriteByte(v) }
func (w *binaryWriter) bool(v bool) {
	if v {
		w.u8(1)
	} else {
		w.u8(0)
	}
}
func (w *binaryWriter) i32(v int) { _ = binary.Write(&w.buf, binary.LittleEndian, int32(v)) }
func (w *binaryWriter) i64(v int64) {
	_ = binary.Write(&w.buf, binary.LittleEndian, v)
}
func (w *binaryWriter) u32(v uint32) { _ = binary.Write(&w.buf, binary.LittleEndian, v) }
func (w *binaryWriter) u64(v uint64) { _ = binary.Write(&w.buf, binary.LittleEndian, v) }

func (w *binaryWriter) str(s string) {
	n := len(s)
	for {
		b := byte(n & 0x7f)
		n >>= 7
		if n > 0 {
			w.u8(b | 0x80)
		} else {
			w.u8(b)
			break
		}
	}
	w.buf.WriteString(s)
}

func (w *binaryWriter) rgb(c [3]byte) { w.buf.Write(c[:]) }

func encrypt(plain []byte) []byte {
	pad := (aes.BlockSize - len(plain)%aes.BlockSize) % aes.BlockSize
	plain = append(plain, make([]byte, pad)...)
	block, _ := aes.NewCipher(encryptionKey)
	out := make([]byte, len(plain))
	cipher.NewCBCEncrypter(block, encryptionKey).CryptBlocks(out, plain)
	return out
}

type itemSpec struct {
	id     int
	stack  int
	prefix int
	fav    bool
}

func writeStackItems(w *binaryWriter, n int, specs map[int]itemSpec, fav bool) {
	for i := 0; i < n; i++ {
		s := specs[i]
		w.i32(s.id)
		w.i32(s.stack)
		w.u8(byte(s.prefix))
		if fav {
			w.bool(s.fav)
		}
	}
}

func writeEquipItems(w *binaryWriter, n int, specs map[int]itemSpec, fav bool) {
	for i := 0; i < n; i++ {
		s := specs[i]
		w.i32(s.id)
		w.u8(byte(s.prefix))
		if fav {
			w.bool(s.fav)
		}
	}
}

// build326 构造一个 release 326（1.4.5.8）的合成存档。
func build326() []byte {
	w := &binaryWriter{}
	w.i32(326)
	w.u64(fileMagic | (uint64(fileTypeID) << 56))
	w.u32(0)
	w.u64(0)
	w.str("测试角色")
	w.u8(2)  // difficulty
	w.i64(0) // play time
	w.i32(15)
	w.u8(7)       // hairDye
	w.u8(0)       // team
	w.u8(0xFF)    // hideVisibleAccessory byte 0
	w.u8(0x03)    // hideVisibleAccessory byte 1
	w.u8(0)       // hideMisc
	w.u8(2)       // skinVariant
	w.i32(357)    // life
	w.i32(500)    // lifeMax
	w.i32(20)     // mana
	w.i32(200)    // manaMax
	w.bool(true)  // extraAccessory
	w.bool(true)  // unlockedBiomeTorches
	w.bool(false) // usingBiomeTorches
	w.bool(true)  // ateArtisanBread
	w.bool(false) // reserved (>=324)
	w.bool(true)  // usedAegisCrystal
	w.bool(false) // usedAegisFruit
	w.bool(true)  // usedArcaneCrystal
	w.bool(false) // usedGalaxyPearl
	w.bool(true)  // usedGummyWorm
	w.bool(false) // usedAmbrosia
	w.bool(false) // downedDD2
	w.i32(1234)   // tax
	w.i32(3)      // deaths pve
	w.i32(4)      // deaths pvp
	w.rgb([3]byte{215, 90, 55})
	w.rgb([3]byte{255, 125, 90})
	w.rgb([3]byte{105, 90, 75})
	w.rgb([3]byte{175, 165, 140})
	w.rgb([3]byte{160, 180, 215})
	w.rgb([3]byte{255, 230, 175})
	w.rgb([3]byte{160, 105, 60})

	// armor[20]: 59 → 头盔 3, 60 → 上衣 4（带 favorited）
	writeEquipItems(w, 20, map[int]itemSpec{
		0: {id: 3, prefix: 0, fav: true},
		1: {id: 4, prefix: 5, fav: false},
	}, true)
	// dye[10]: 79 → 染料 3（favorited）
	writeEquipItems(w, 10, map[int]itemSpec{0: {id: 3, fav: true}}, true)
	// inventory[58]
	writeStackItems(w, 58, map[int]itemSpec{
		0: {id: 4956, stack: 1, prefix: 81},
		1: {id: 71, stack: 999, prefix: 0, fav: true},
	}, true)
	// miscEquips[5] + miscDyes[5]
	for i := 0; i < 5; i++ {
		if i == 0 {
			w.i32(7) // 抓钩
			w.u8(2)
		} else {
			w.i32(0)
			w.u8(0)
		}
	}
	for i := 0; i < 5; i++ {
		w.i32(0)
		w.u8(0)
	}
	// bank 99 / bank2 139 / bank3 180
	writeStackItems(w, 40, map[int]itemSpec{0: {id: 74, stack: 26}}, false)
	writeStackItems(w, 40, nil, false)
	writeStackItems(w, 40, map[int]itemSpec{0: {id: 346, stack: 1}}, false)
	// bank4 220（带 favorited）
	writeStackItems(w, 40, map[int]itemSpec{0: {id: 4131, stack: 1, fav: true}}, true)
	w.u8(1) // voidVaultInfo

	return encrypt(w.buf.Bytes())
}

func TestParseSynthetic326(t *testing.T) {
	p, err := Parse(build326())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if p.Release != 326 || p.Name != "测试角色" {
		t.Fatalf("release/name = %d/%q", p.Release, p.Name)
	}
	if p.Hair != 15 || p.HairDye != 7 || p.SkinVariant != 2 {
		t.Fatalf("hair/hairDye/skin = %d/%d/%d", p.Hair, p.HairDye, p.SkinVariant)
	}
	if p.StatLife != 357 || p.StatLifeMax != 500 || p.StatMana != 20 || p.StatManaMax != 200 {
		t.Fatalf("hp/mp = %d/%d %d/%d", p.StatLife, p.StatLifeMax, p.StatMana, p.StatManaMax)
	}
	if !p.ExtraAccessory || !p.UnlockedBiomeTorches || !p.AteArtisanBread {
		t.Fatalf("标记位错误：%+v", p)
	}
	if !p.UsedAegisCrystal || !p.UsedArcaneCrystal || !p.UsedGummyWorm {
		t.Fatalf("增强位错误：%+v", p)
	}
	if p.HairColor != [3]byte{215, 90, 55} || p.ShoeColor != [3]byte{160, 105, 60} {
		t.Fatalf("颜色错误：%v %v", p.HairColor, p.ShoeColor)
	}

	slots := p.Slots()
	checks := []struct {
		slot int
		id   int
	}{
		{0, 4956},  // 背包
		{1, 71},    // 背包
		{59, 3},    // 装备
		{60, 4},    // 装备
		{79, 3},    // 染料
		{89, 7},    // 杂项装备（抓钩）
		{99, 74},   // 猪猪
		{139, 0},   // 保险箱空
		{180, 346}, // 熔炉
		{220, 4131},
	}
	for _, c := range checks {
		if slots[c.slot].ID != c.id {
			t.Errorf("slot %d = %+v，期望 id=%d", c.slot, slots[c.slot], c.id)
		}
	}
	if slots[1].Stack != 999 || !slots[1].Favorited {
		t.Errorf("背包 stack/favorited = %+v", slots[1])
	}
	if !slots[59].Favorited || slots[60].Favorited {
		t.Errorf("装备 favorited = %v/%v", slots[59].Favorited, slots[60].Favorited)
	}
	if !slots[220].Favorited {
		t.Errorf("虚空袋 favorited 应为 true：%+v", slots[220])
	}
}

// TestParseReal326Fixture 用真实的 1.4.5.8（release 326）新角色存档回归：
// 校验 release 门槛（324 预留位、322 favorited 等）与背包起始物品都对齐。
func TestParseReal326Fixture(t *testing.T) {
	data, err := os.ReadFile("testdata/webui-326.plr")
	if err != nil {
		t.Fatalf("读取 fixtures: %v", err)
	}
	p, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if p.Release != 326 || p.Name != "webui" {
		t.Fatalf("release/name = %d/%q", p.Release, p.Name)
	}
	if p.Hair != 68 || p.SkinVariant != 9 || p.HairDye != 0 || p.Difficulty != 0 {
		t.Fatalf("外观 = hair %d skin %d dye %d diff %d", p.Hair, p.SkinVariant, p.HairDye, p.Difficulty)
	}
	if p.StatLife != 100 || p.StatLifeMax != 100 || p.StatMana != 0 || p.StatManaMax != 20 {
		t.Fatalf("hp/mp = %d/%d %d/%d", p.StatLife, p.StatLifeMax, p.StatMana, p.StatManaMax)
	}
	if p.ExtraAccessory || p.UnlockedBiomeTorches {
		t.Fatalf("新角色不应有增强标记：%+v", p)
	}
	if p.HairColor != [3]byte{215, 90, 55} || p.SkinColor != [3]byte{255, 125, 90} {
		t.Fatalf("颜色 = %v %v", p.HairColor, p.SkinColor)
	}
	slots := p.Slots()
	// 1.4.5.8 新角色的起始物品：铜短剑 / 铜镐 / 铜斧。
	for i, want := range []int{3507, 3509, 3506} {
		if slots[i].ID != want || slots[i].Stack != 1 {
			t.Errorf("inventory[%d] = %+v，期望 id=%d", i, slots[i], want)
		}
	}
	// 其余槽位（含银行）应为空。
	for i, it := range slots {
		if i > 2 && it.ID != 0 {
			t.Errorf("slot %d 应空，得到 %+v", i, it)
		}
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	if _, err := Parse([]byte("not a plr file")); !errors.Is(err, ErrNotPlayer) {
		t.Fatalf("err = %v，期望 ErrNotPlayer", err)
	}
	if _, err := Parse(nil); !errors.Is(err, ErrNotPlayer) {
		t.Fatalf("err = %v，期望 ErrNotPlayer", err)
	}
}

func TestParseRejectsTruncated(t *testing.T) {
	full := build326()
	// 去掉尾部若干块，制造「解出来后字段不完整」。
	if _, err := Parse(full[:len(full)-32]); !errors.Is(err, ErrNotPlayer) {
		t.Fatalf("err = %v，期望 ErrNotPlayer", err)
	}
}

func TestParseRejectsWrongVersion(t *testing.T) {
	w := &binaryWriter{}
	w.i32(999)
	w.u64(fileMagic | (uint64(fileTypeID) << 56))
	w.u32(0)
	w.u64(0)
	if _, err := Parse(encrypt(w.buf.Bytes())); !errors.Is(err, ErrNotPlayer) {
		t.Fatalf("err = %v，期望 ErrNotPlayer", err)
	}
}

// TestEncryptionKeyUTF16 防止 ENCRYPTION_KEY 被改错（"h3y_gUyZ" 的 UTF-16LE）。
func TestEncryptionKeyUTF16(t *testing.T) {
	want := utf16.Encode([]rune("h3y_gUyZ"))
	if len(want) != 8 {
		t.Fatalf("utf16 len = %d", len(want))
	}
	for i, r := range want {
		if encryptionKey[2*i] != byte(r) || encryptionKey[2*i+1] != byte(r>>8) {
			t.Fatalf("key[%d] 不匹配", i)
		}
	}
}
