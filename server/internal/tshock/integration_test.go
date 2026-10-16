//go:build integration

package tshock

import (
	"context"
	"os"
	"testing"
	"time"
)

// 真实 TShock 联调（默认不跑）：
//
//	TSHOCK_URL=http://127.0.0.1:7878 TSHOCK_TOKEN=simpleToken \
//	  go test -tags integration -run Integration -v ./internal/tshock
//
// 需要一个可用的 token；若没有登录凭证，可用 TShock 的 ApplicationRestTokens。

func integrationClient(t *testing.T) (*Client, string) {
	t.Helper()
	url := os.Getenv("TSHOCK_URL")
	token := os.Getenv("TSHOCK_TOKEN")
	if url == "" || token == "" {
		t.Skip("未设置 TSHOCK_URL / TSHOCK_TOKEN，跳过真实联调")
	}
	return NewClient(url, 5*time.Second, testLogger()), token
}

func TestIntegrationServerStatus(t *testing.T) {
	c, token := integrationClient(t)
	st, err := c.ServerStatus(context.Background(), token)
	if err != nil {
		t.Fatalf("ServerStatus: %v", err)
	}
	if st.ServerVersion == "" || st.TShockVersion == "" {
		t.Fatalf("版本为空：%+v", st)
	}
	if st.ServerVersion != NormalizeVersion(st.ServerVersion) {
		t.Fatalf("版本未规范化：%q", st.ServerVersion)
	}
	t.Logf("真实服务器：%s terraria=%s tshock=%s world=%s port=%d",
		st.Name, st.ServerVersion, st.TShockVersion, st.World, st.Port)
}

func TestIntegrationTokenTest(t *testing.T) {
	c, token := integrationClient(t)
	name, err := c.TokenTest(context.Background(), token)
	if err != nil {
		t.Fatalf("TokenTest: %v", err)
	}
	if name == "" {
		t.Fatal("associateduser 为空")
	}
	t.Logf("token 关联用户：%s", name)
}

func TestIntegrationRawCmdClassification(t *testing.T) {
	c, token := integrationClient(t)
	res, err := c.RawCmd(context.Background(), token, "/time")
	t.Logf("rawcmd /time -> status=%s err=%v output=%v", res.Status, err, res.Output)
	switch res.Status {
	case StatusOK, StatusNoPermission, StatusCommandError:
		// 均属正常分类结果（取决于该 token 用户组的权限）。
	default:
		t.Fatalf("非预期的分类结果：%+v err=%v", res, err)
	}
}
