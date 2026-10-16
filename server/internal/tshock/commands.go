package tshock

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// commandsJSON 是前端使用的同一份 data/commands.json 的构建期副本
// （由 server/scripts/sync-commands.sh 同步）。用于 Tier A 前置校验。
//
//go:embed data/commands.json
var commandsJSON []byte

// CommandDef 是指令定义（与前端 types.ts 的 CommandDef 对应）。
type CommandDef struct {
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Permission  *string  `json:"permission"`
	Help        string   `json:"help"`
	AllowServer bool     `json:"allowServer"`
	DoLog       bool     `json:"doLog"`
}

// CommandIndex 按指令名与别名建立索引。
type CommandIndex struct {
	byToken map[string]*CommandDef
	count   int
}

// CheckOutcome 是 Tier A 校验结果。
type CheckOutcome struct {
	// Def 为解析到的指令定义；未知指令时为 nil。
	Def *CommandDef
	// Rejected 为 true 时表示不应发往 TShock（未知或 allowServer=false）。
	Rejected bool
	// Message 面向玩家的拒绝原因。
	Message string
	// Marker 便于测试/统计区分拒绝原因："unknown" | "in_game_only"。
	Marker string
}

// LoadCommands 从 JSON 数据构建索引。
func LoadCommands(data []byte) (*CommandIndex, error) {
	var file struct {
		Commands []CommandDef `json:"commands"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("解析 commands.json 失败：%w", err)
	}
	idx := &CommandIndex{byToken: make(map[string]*CommandDef, len(file.Commands)*2)}
	for i := range file.Commands {
		def := &file.Commands[i]
		idx.byToken[strings.ToLower(def.Name)] = def
		for _, alias := range def.Aliases {
			idx.byToken[strings.ToLower(alias)] = def
		}
		idx.count++
	}
	return idx, nil
}

// DefaultCommands 是内嵌数据构建的索引；数据非法时 panic（构建期问题）。
func DefaultCommands() *CommandIndex {
	idx, err := LoadCommands(commandsJSON)
	if err != nil {
		panic(err)
	}
	return idx
}

// Count 返回已索引的指令定义数量。
func (c *CommandIndex) Count() int { return c.count }

// Lookup 用指令首 token（不含前导 /）查表。
func (c *CommandIndex) Lookup(token string) (*CommandDef, bool) {
	def, ok := c.byToken[strings.ToLower(strings.TrimSpace(token))]
	return def, ok
}

// FirstToken 取出指令的首个 token：去前导 /、取第一段空白分隔的文本。
// 多行输入只取第一条非空行（与前端 firstCommandLine 行为一致）。
func FirstToken(cmd string) string {
	line := ""
	for _, l := range strings.Split(strings.ReplaceAll(cmd, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(l) != "" {
			line = strings.TrimSpace(l)
			break
		}
	}
	line = strings.TrimLeft(line, "/")
	if line == "" {
		return ""
	}
	return strings.Fields(line)[0]
}

// Check 执行 Tier A 前置校验（ADI-9：纵深防御，不是权限边界）。
//
// 未知指令**不拒绝**：插件指令（如 FishShop 的 /fish）无法静态枚举，
// 交由 TShock 判定（不存在 → “无效指令”；allowServer=false → “只能在游戏内使用”）。
// 只有内置白名单里明确 allowServer=false 的才在前置拒绝，避免无意义的出站请求。
func (c *CommandIndex) Check(cmd string) CheckOutcome {
	token := FirstToken(cmd)
	if token == "" {
		return CheckOutcome{Rejected: true, Marker: "unknown", Message: "请输入指令"}
	}
	def, ok := c.Lookup(token)
	if !ok {
		return CheckOutcome{Marker: "unknown"}
	}
	if !def.AllowServer {
		return CheckOutcome{
			Def:      def,
			Rejected: true,
			Marker:   "in_game_only",
			Message:  fmt.Sprintf("/%s 只能在游戏内执行", def.Name),
		}
	}
	return CheckOutcome{Def: def}
}
