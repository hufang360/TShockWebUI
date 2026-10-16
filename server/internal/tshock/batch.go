package tshock

// 批量执行指令（TShockWebUI 的信使插件 WebUI 的 /webui/batch 端点）。
//
// 事实来源：本仓库插件源码 plugin/WebUI/Batch.cs。
//   - POST/GET /webui/batch?cmds=<json数组>&token=  → 逐条执行并返回各自输出
//   - 需要 token，且该用户组要有 tshock.rest.command（与 /v3/server/rawcmd 一致）。
//   - 每条指令仍由 TShock 按 token 用户的权限判定；`AllowServer=false` 同样被拒。
//
// 与单条 rawcmd 的区别：一次 HTTP 请求执行多条，输出按输入顺序返回。
//
// 由于 TShock 只从 query string 取参（不解析请求体），一次请求能带的指令总量受 URI 长度限制；
// 超过时由本文件在本层**自动拆成多次请求**（对上层与前端透明），结果仍按原顺序拼接。

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
)

const batchPath = "/webui/batch"

// MaxBatchCommands 是**单次** /webui/batch 请求能执行的指令数上限（与插件 BatchExecutor.MaxCommands 一致）。
// 后端一次 /api/batch 最多接收这么多条；超长时会在本层拆成多次插件调用。
const MaxBatchCommands = 64

// maxBatchQueryBytes 是单次请求 URI（path + "?" + query）的字节预算。
// 插件只能从 query 取参，而 TShock 的 HttpServer 在 ~24KB 以上会不稳定，
// 常见反代（如 nginx 默认）更把请求行限制在 8KB；取 6KB 留足余量。
const maxBatchQueryBytes = 6000

// BatchCapability 描述「批量执行」信使插件的可用性。
type BatchCapability struct {
	// Plugin 为 true 表示服务器已安装支持批量执行的信使插件。
	Plugin bool `json:"plugin"`
	// Ingame 为 true 表示后端允许把 allowServer=false 的指令交给插件、
	// 以真实在线玩家身份执行（还需插件侧 AllowInGameOnlyCommands=true）。
	Ingame bool `json:"ingame"`
}

// RunBatch 调用 /webui/batch 执行多条指令，返回与 cmds 等长、同序的结果。
//
// 指令较多或较长时会自动拆成多次请求（每次仍是一个合法的 /webui/batch 调用），
// 任意一次失败即整体失败；成功时按原顺序拼接。
func (c *Client) RunBatch(ctx context.Context, token string, cmds []string) ([]Result, error) {
	return c.runBatchMode(ctx, token, cmds, "server")
}

// RunBatchPlayer 用真实在线玩家身份执行（mode=player，可跑 AllowServer=false 的指令）。
func (c *Client) RunBatchPlayer(ctx context.Context, token string, cmds []string) ([]Result, error) {
	return c.runBatchMode(ctx, token, cmds, "player")
}

func (c *Client) runBatchMode(ctx context.Context, token string, cmds []string, mode string) ([]Result, error) {
	if len(cmds) == 0 {
		return []Result{}, nil
	}
	results := make([]Result, 0, len(cmds))
	for _, chunk := range splitBatchChunks(token, cmds) {
		part, err := c.runBatchChunk(ctx, token, chunk, mode)
		if err != nil {
			return nil, err
		}
		results = append(results, part...)
	}
	return results, nil
}

// runBatchChunk 执行一块（一次 HTTP 请求）。
func (c *Client) runBatchChunk(ctx context.Context, token string, cmds []string, mode string) ([]Result, error) {
	payload, err := json.Marshal(cmds)
	if err != nil {
		return nil, &APIError{Kind: KindBadResponse, Message: "序列化指令失败"}
	}
	q := url.Values{}
	q.Set("cmds", string(payload))
	q.Set("token", token)
	if mode != "" && mode != "server" {
		q.Set("mode", mode)
	}

	status, body, err := c.do(ctx, batchPath, q)
	if err != nil {
		return nil, err
	}
	if e := c.apiError(ctx, token, status, body); e != nil {
		return nil, e
	}

	var out struct {
		Code    string `json:"code"`
		Error   string `json:"error"`
		Results []struct {
			Cmd    string          `json:"cmd"`
			Output json.RawMessage `json:"output"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &APIError{Kind: KindBadResponse, Status: status, Message: "批量执行返回非法 JSON"}
	}
	// player 模式可能在 200 里返回业务码（player_offline / disabled）。
	if out.Code != "" && out.Code != "ok" {
		return nil, &APIError{Kind: KindPluginBusiness, Status: status, Code: out.Code, Message: out.Error}
	}

	results := make([]Result, 0, len(out.Results))
	for _, item := range out.Results {
		lines, derr := decodeStringOrList(item.Output)
		if derr != nil {
			lines = []string{}
		}
		results = append(results, classifyOutput(lines))
	}
	return results, nil
}

// splitBatchChunks 按条数与 URI 长度把指令切成多块，保持原顺序。
//
//   - 每块不超过 MaxBatchCommands 条；
//   - 每块的请求 URI 尽量不超过 maxBatchQueryBytes；
//   - 单条指令本身就超过预算时单独成块（无法再拆，交给上游判定）。
func splitBatchChunks(token string, cmds []string) [][]string {
	var chunks [][]string
	cur := make([]string, 0, MaxBatchCommands)
	flush := func() {
		if len(cur) == 0 {
			return
		}
		chunk := make([]string, len(cur))
		copy(chunk, cur)
		chunks = append(chunks, chunk)
		cur = cur[:0]
	}

	for _, cmd := range cmds {
		// 试探性加入后是否超限。
		cur = append(cur, cmd)
		if len(cur) > 1 && (len(cur) > MaxBatchCommands || batchQuerySize(token, cur) > maxBatchQueryBytes) {
			// 回退这一条，把之前的作为一块，再用这条开新块。
			last := cur[len(cur)-1]
			cur = cur[:len(cur)-1]
			flush()
			cur = append(cur, last)
		}
	}
	flush()
	return chunks
}

// batchQuerySize 估算一次 /webui/batch 请求的 URI 字节数（与 Client.do 的 url.Values.Encode 一致）。
func batchQuerySize(token string, cmds []string) int {
	payload, err := json.Marshal(cmds)
	if err != nil {
		return maxBatchQueryBytes + 1
	}
	q := url.Values{}
	q.Set("cmds", string(payload))
	if token != "" {
		q.Set("token", token)
	}
	// path + "?" + query
	return len(batchPath) + 1 + len(q.Encode())
}

// BatchProbe 探测批量执行端点是否存在：不带 token 调用。
//
//   - 404 → 未安装插件（KindNotFound）
//   - 401/403/其它 → 端点存在（安全端点要求 token）
func (c *Client) BatchProbe(ctx context.Context) error {
	status, body, err := c.do(ctx, batchPath, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return &APIError{Kind: KindNotFound, Status: status, Message: messageFromBody(body)}
	}
	return nil
}
