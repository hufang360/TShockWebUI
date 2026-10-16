// Package plr 解析 Terraria 角色存档（.plr，仅读取，用于「玩家管理」的本地导入展示）。
//
// 事实来源：反编译源码 Terraria 1.4.5.8
//   - 加密：`Terraria/Player.cs` 的 `LoadPlayer` —— RijndaelManaged（AES-128-CBC，
//     PaddingMode.None），key 与 IV 均为 `ENCRYPTION_KEY`（`UnicodeEncoding().GetBytes("h3y_gUyZ")`）。
//   - 字段顺序与版本门槛：`Terraria/Player.cs` 的 `Deserialize`。
//   - 文件头：`Terraria.IO/FileMetadata`（version >= 135 时存在，20 字节）。
//   - 颜色：`Terraria/Utils.cs` 的 `ReadRGB`（R、G、B 各一字节）。
//
// 只解析到「随身仓储」结束（含 voidVaultInfo），足够展示外观 / 属性 / 背包 / 装备 / 银行；
// 之后的 buff、出生点、配装等不再读取（本功能仅展示）。
package plr

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"fmt"
	"unicode/utf8"
)

// encryptionKey 是 UnicodeEncoding（UTF-16LE）编码的 "h3y_gUyZ"。
var encryptionKey = []byte{
	0x68, 0x00, 0x33, 0x00, 0x79, 0x00, 0x5F, 0x00,
	0x67, 0x00, 0x55, 0x00, 0x79, 0x00, 0x5A, 0x00,
}

const (
	fileMagic  = 0x6369676F6C6572 // "relogic"（低 7 字节）
	fileTypeID = 3                // FileType.Player
	maxRelease = 326              // Main.curRelease
)

// ErrNotPlayer 表示输入不是可解析的角色存档（加密/文件头/版本/结构任一不合法）。
var ErrNotPlayer = errors.New("不是有效的 Terraria 角色存档")

// Item 是存档里的一个物品格（0 = 空）。
type Item struct {
	ID        int
	Stack     int
	Prefix    int
	Favorited bool
}

// Player 是 .plr 中本功能用到的字段。
type Player struct {
	Release     int
	Name        string
	Difficulty  int
	Hair        int
	HairDye     int
	SkinVariant int

	StatLife    int
	StatLifeMax int
	StatMana    int
	StatManaMax int

	ExtraAccessory       bool
	UnlockedBiomeTorches bool
	UsingBiomeTorches    bool
	AteArtisanBread      bool
	UsedAegisCrystal     bool
	UsedAegisFruit       bool
	UsedArcaneCrystal    bool
	UsedGalaxyPearl      bool
	UsedGummyWorm        bool
	UsedAmbrosia         bool

	HairColor       [3]byte
	SkinColor       [3]byte
	EyeColor        [3]byte
	ShirtColor      [3]byte
	UnderShirtColor [3]byte
	PantsColor      [3]byte
	ShoeColor       [3]byte

	// 槽位布局与 TShock `NetItem` 一致（见 PlayerLook.IntoItems）。
	Armor       [20]Item
	Dye         [10]Item
	Inventory   [58]Item
	MiscEquips  [5]Item
	MiscDyes    [5]Item
	PiggyBank   [40]Item
	Safe        [40]Item
	Forge       [40]Item
	VoidVault   [40]Item
	VoidVaultIn byte
}

// Slots 返回按 TShock `NetItem` 槽位（0..349）排列的物品；空格为 ID=0。
//
// 槽位顺序见 `web/src/lib/playerSlots.ts`：
// 背包 0–57 / 装备 59–78 / 染料 79–88 / 杂项装备 89–93 / 杂项染料 94–98 /
// 猪猪 99–138 / 保险箱 139–178 / 垃圾桶 179（.plr 不保存）/ 熔炉 180–219 /
// 虚空袋 220–259 / 三套配装 260–349（.plr 不读取→空）。
func (p *Player) Slots() [350]Item {
	var out [350]Item
	copy(out[0:58], p.Inventory[:])
	copy(out[59:79], p.Armor[:])
	copy(out[79:89], p.Dye[:])
	copy(out[89:94], p.MiscEquips[:])
	copy(out[94:99], p.MiscDyes[:])
	copy(out[99:139], p.PiggyBank[:])
	copy(out[139:179], p.Safe[:])
	copy(out[180:220], p.Forge[:])
	copy(out[220:260], p.VoidVault[:])
	return out
}

// Parse 解密并解析 .plr 字节。
func Parse(data []byte) (*Player, error) {
	plain, err := decrypt(data)
	if err != nil {
		return nil, fmt.Errorf("%w: 解密失败", ErrNotPlayer)
	}
	r := &reader{buf: plain}
	p, err := parsePlayer(r)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotPlayer, err)
	}
	return p, nil
}

func decrypt(data []byte) ([]byte, error) {
	if len(data) == 0 || len(data)%aes.BlockSize != 0 {
		return nil, errors.New("长度不是 AES 块大小的整数倍")
	}
	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, err
	}
	out := make([]byte, len(data))
	cipher.NewCBCDecrypter(block, encryptionKey).CryptBlocks(out, data)
	return out, nil
}

type reader struct {
	buf []byte
	pos int
}

func (r *reader) need(n int) error {
	if r.pos+n > len(r.buf) {
		return errors.New("存档数据不完整")
	}
	return nil
}

func (r *reader) u8() (byte, error) {
	if err := r.need(1); err != nil {
		return 0, err
	}
	b := r.buf[r.pos]
	r.pos++
	return b, nil
}

func (r *reader) i32() (int, error) {
	if err := r.need(4); err != nil {
		return 0, err
	}
	v := int(int32(binary.LittleEndian.Uint32(r.buf[r.pos:])))
	r.pos += 4
	return v, nil
}

func (r *reader) i64() (int64, error) {
	if err := r.need(8); err != nil {
		return 0, err
	}
	v := int64(binary.LittleEndian.Uint64(r.buf[r.pos:]))
	r.pos += 8
	return v, nil
}

func (r *reader) skip(n int) error {
	if err := r.need(n); err != nil {
		return err
	}
	r.pos += n
	return nil
}

// str 读 .NET BinaryReader.ReadString：7 位变长长度（字节数）+ UTF-8。
func (r *reader) str() (string, error) {
	length := 0
	shift := uint(0)
	for {
		b, err := r.u8()
		if err != nil {
			return "", err
		}
		length |= int(b&0x7f) << shift
		if b&0x80 == 0 {
			break
		}
		shift += 7
		if shift > 28 {
			return "", errors.New("字符串长度非法")
		}
	}
	if length < 0 {
		return "", errors.New("字符串长度非法")
	}
	if err := r.need(length); err != nil {
		return "", err
	}
	s := r.buf[r.pos : r.pos+length]
	r.pos += length
	if !utf8.Valid(s) {
		return "", errors.New("字符串不是合法 UTF-8")
	}
	return string(s), nil
}

func (r *reader) boolean() (bool, error) {
	b, err := r.u8()
	if err != nil {
		return false, err
	}
	return b != 0, nil
}

func (r *reader) rgb() ([3]byte, error) {
	if err := r.need(3); err != nil {
		return [3]byte{}, err
	}
	var c [3]byte
	copy(c[:], r.buf[r.pos:r.pos+3])
	r.pos += 3
	return c, nil
}

// itemWithStack 读「id + stack + prefix（+ favorited）」形式的格子。
func (r *reader) itemWithStack(favorited bool) (Item, error) {
	var it Item
	id, err := r.i32()
	if err != nil {
		return it, err
	}
	it.ID = id
	stack, err := r.i32()
	if err != nil {
		return it, err
	}
	it.Stack = stack
	prefix, err := r.u8()
	if err != nil {
		return it, err
	}
	it.Prefix = int(prefix)
	if favorited {
		f, err := r.boolean()
		if err != nil {
			return it, err
		}
		it.Favorited = f
	}
	return normalize(it), nil
}

// maxItemID 作为「非法物品 id」的宽松上界（1.4.5.8 实际物品 < 5500）；
// 超过时按游戏里的 netDefaults(0) 处理为空格。
const maxItemID = 10000

func normalize(it Item) Item {
	if it.ID <= 0 || it.ID >= maxItemID {
		return Item{}
	}
	if it.Stack <= 0 {
		it.Stack = 1
	}
	return it
}

// itemEquip 读「id + prefix（+ favorited）」形式的格子（护甲 / 染料 / 杂项）。
func (r *reader) itemEquip(favorited bool) (Item, error) {
	var it Item
	id, err := r.i32()
	if err != nil {
		return it, err
	}
	it.ID = id
	prefix, err := r.u8()
	if err != nil {
		return it, err
	}
	it.Prefix = int(prefix)
	if favorited {
		f, err := r.boolean()
		if err != nil {
			return it, err
		}
		it.Favorited = f
	}
	return normalize(it), nil
}

func parsePlayer(r *reader) (*Player, error) {
	p := &Player{}
	release, err := r.i32()
	if err != nil {
		return nil, err
	}
	p.Release = release
	if release < 135 || release > maxRelease {
		return nil, fmt.Errorf("不支持的角色存档版本 %d", release)
	}
	// FileMetadata：8 字节 magic（低 7 字节固定，高 1 字节为文件类型）+ u32 revision + u64 favorite。
	magic, err := r.i64()
	if err != nil {
		return nil, err
	}
	if uint64(magic)&0x00FFFFFFFFFFFFFF != fileMagic {
		return nil, errors.New("存档文件头不匹配")
	}
	if byte(uint64(magic)>>56) != fileTypeID {
		return nil, errors.New("不是角色存档")
	}
	if err := r.skip(4); err != nil { // revision
		return nil, err
	}
	if err := r.skip(8); err != nil { // favorite flag
		return nil, err
	}

	if p.Name, err = r.str(); err != nil {
		return nil, err
	}
	if release >= 17 {
		d, err := r.u8()
		if err != nil {
			return nil, err
		}
		p.Difficulty = int(d)
	}
	if release >= 138 {
		if _, err := r.i64(); err != nil { // play time
			return nil, err
		}
	}
	if p.Hair, err = r.i32(); err != nil {
		return nil, err
	}
	if p.Hair >= 228 {
		p.Hair = 0
	}
	if release >= 82 {
		d, err := r.u8()
		if err != nil {
			return nil, err
		}
		p.HairDye = int(d)
	}
	if release >= 283 {
		if _, err := r.u8(); err != nil { // team
			return nil, err
		}
	}
	if release >= 124 {
		if err := r.skip(2); err != nil { // hideVisibleAccessory（12 位）
			return nil, err
		}
	} else if release >= 83 {
		if err := r.skip(1); err != nil {
			return nil, err
		}
	}
	if release >= 119 {
		if _, err := r.u8(); err != nil { // hideMisc
			return nil, err
		}
	}
	if release >= 107 {
		sv, err := r.u8()
		if err != nil {
			return nil, err
		}
		p.SkinVariant = int(sv)
	}
	if p.StatLife, err = r.i32(); err != nil {
		return nil, err
	}
	if p.StatLifeMax, err = r.i32(); err != nil {
		return nil, err
	}
	if p.StatLifeMax > 500 {
		p.StatLifeMax = 500
	}
	if p.StatMana, err = r.i32(); err != nil {
		return nil, err
	}
	if p.StatManaMax, err = r.i32(); err != nil {
		return nil, err
	}
	if p.StatManaMax > 200 {
		p.StatManaMax = 200
	}
	if release >= 125 {
		if p.ExtraAccessory, err = r.boolean(); err != nil {
			return nil, err
		}
	}
	if release >= 229 {
		if p.UnlockedBiomeTorches, err = r.boolean(); err != nil {
			return nil, err
		}
		if p.UsingBiomeTorches, err = r.boolean(); err != nil {
			return nil, err
		}
		if release >= 256 {
			if p.AteArtisanBread, err = r.boolean(); err != nil {
				return nil, err
			}
		}
		if release >= 324 {
			if _, err := r.boolean(); err != nil { // 预留位
				return nil, err
			}
		}
		if release >= 260 {
			bools := []*bool{
				&p.UsedAegisCrystal, &p.UsedAegisFruit, &p.UsedArcaneCrystal,
				&p.UsedGalaxyPearl, &p.UsedGummyWorm, &p.UsedAmbrosia,
			}
			for _, bp := range bools {
				if *bp, err = r.boolean(); err != nil {
					return nil, err
				}
			}
		}
	}
	if release >= 182 {
		if _, err := r.boolean(); err != nil { // downedDD2EventAnyDifficulty
			return nil, err
		}
	}
	if release >= 128 {
		if _, err := r.i32(); err != nil { // taxMoney
			return nil, err
		}
	}
	if release >= 254 {
		if _, err := r.i32(); err != nil { // deaths PVE
			return nil, err
		}
		if _, err := r.i32(); err != nil { // deaths PVP
			return nil, err
		}
	}
	if p.HairColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.SkinColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.EyeColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.ShirtColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.UnderShirtColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.PantsColor, err = r.rgb(); err != nil {
		return nil, err
	}
	if p.ShoeColor, err = r.rgb(); err != nil {
		return nil, err
	}

	if release < 38 {
		return nil, errors.New("过旧的存档格式暂不支持")
	}
	armorFav := release >= 322
	for i := 0; i < 20; i++ {
		if p.Armor[i], err = r.itemEquip(armorFav); err != nil {
			return nil, err
		}
	}
	if release >= 47 {
		dyeCount := 3
		switch {
		case release >= 124:
			dyeCount = 10
		case release >= 81:
			dyeCount = 8
		}
		for i := 0; i < dyeCount; i++ {
			if p.Dye[i], err = r.itemEquip(armorFav); err != nil {
				return nil, err
			}
		}
	}
	if release >= 58 {
		for i := 0; i < 58; i++ {
			if p.Inventory[i], err = r.itemWithStack(release >= 114); err != nil {
				return nil, err
			}
		}
	} else {
		return nil, errors.New("过旧的存档格式暂不支持")
	}
	if release >= 117 {
		for i := 0; i < 5; i++ {
			if p.MiscEquips[i], err = r.itemEquip(false); err != nil {
				return nil, err
			}
			if p.MiscDyes[i], err = r.itemEquip(false); err != nil {
				return nil, err
			}
		}
	}
	for i := 0; i < 40; i++ {
		if p.PiggyBank[i], err = r.itemWithStack(false); err != nil {
			return nil, err
		}
	}
	for i := 0; i < 40; i++ {
		if p.Safe[i], err = r.itemWithStack(false); err != nil {
			return nil, err
		}
	}
	if release >= 182 {
		for i := 0; i < 40; i++ {
			if p.Forge[i], err = r.itemWithStack(false); err != nil {
				return nil, err
			}
		}
	}
	if release >= 198 {
		for i := 0; i < 40; i++ {
			if p.VoidVault[i], err = r.itemWithStack(release >= 255); err != nil {
				return nil, err
			}
		}
	}
	if release >= 199 {
		if p.VoidVaultIn, err = r.u8(); err != nil {
			return nil, err
		}
	}
	return p, nil
}
