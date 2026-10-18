package tshock

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestCommandCatalog(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/commands" || r.URL.Query().Get("token") != "tok" {
			t.Errorf("path/q = %s %v", r.URL.Path, r.URL.Query())
		}
		writeJSON(w, 200, map[string]any{
			"status": "200",
			"commands": []map[string]any{
				{"name": "fish", "aliases": []string{"钓鱼"}, "permissions": []string{}, "allowServer": true, "help": "鱼店"},
				{"name": "i", "aliases": []string{"item"}, "permissions": []string{}, "allowServer": false, "help": ""},
			},
		})
	}), time.Second)

	list, err := c.CommandCatalog(context.Background(), "tok")
	if err != nil {
		t.Fatalf("CommandCatalog: %v", err)
	}
	if len(list) != 2 || list[0].Name != "fish" || list[1].AllowServer {
		t.Fatalf("list = %+v", list)
	}
}

func TestMe(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status": "200", "username": "alice", "group": "default",
			"permissions": []string{"tshock.rest.useapi"}, "canUseApi": true, "canRunCommands": false,
		})
	}), time.Second)

	me, err := c.Me(context.Background(), "tok")
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if me.Username != "alice" || !me.CanUseAPI || me.CanRunCommands {
		t.Fatalf("me = %+v", me)
	}
}

func TestDataListRegionsAndNPCs(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("type") {
		case "regions":
			writeJSON(w, 200, map[string]any{"status": "200", "regions": []string{"主城", "商店"}})
		case "npcs":
			writeJSON(w, 200, map[string]any{"status": "200", "npcs": []map[string]any{{"id": 4, "name": "史莱姆王"}}})
		default:
			writeJSON(w, 400, map[string]any{"error": "bad"})
		}
	}), time.Second)

	regions, err := c.DataList(context.Background(), "tok", "regions")
	if err != nil || len(regions) != 2 || regions[0].Name != "主城" {
		t.Fatalf("regions = %+v err=%v", regions, err)
	}
	npcs, err := c.DataList(context.Background(), "tok", "npcs")
	if err != nil || len(npcs) != 1 || npcs[0].ID != 4 {
		t.Fatalf("npcs = %+v err=%v", npcs, err)
	}
}

func TestServerInfoAndEvents(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/webui/serverinfo":
			writeJSON(w, 200, map[string]any{"status": "200", "name": "world", "hardMode": true, "bosses": map[string]bool{"moonLord": false}})
		case "/webui/events":
			if r.URL.Query().Get("since") != "5" {
				t.Errorf("since = %q", r.URL.Query().Get("since"))
			}
			writeJSON(w, 200, map[string]any{
				"status": "200", "lastSeq": 7,
				"events": []map[string]any{
					{"seq": 6, "type": "join", "text": "Alice 加入", "time": "t"},
					{"seq": 7, "type": "chat", "text": "[WebUI] Alice: 你好", "time": "t", "source": "webui"},
				},
			})
		}
	}), time.Second)

	info, err := c.ServerInfo(context.Background(), "tok")
	if err != nil || !info.HardMode || info.Name != "world" {
		t.Fatalf("info = %+v err=%v", info, err)
	}
	page, err := c.Events(context.Background(), "tok", 5, 10)
	if err != nil || page.LastSeq != 7 || len(page.Events) != 2 {
		t.Fatalf("page = %+v err=%v", page, err)
	}
	if page.Events[1].Type != "chat" || page.Events[1].Source != "webui" {
		t.Fatalf("事件来源未透传：%+v", page.Events[1])
	}
}

func TestEventsTail(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webui/events" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("tail") != "100" {
			t.Errorf("tail = %q", r.URL.Query().Get("tail"))
		}
		writeJSON(w, 200, map[string]any{
			"status": "200", "lastSeq": 9, "firstSeq": 8,
			"events": []map[string]any{
				{"seq": 8, "type": "join", "text": "Alice 加入", "time": "t"},
				{"seq": 9, "type": "leave", "text": "Bob 离开", "time": "t"},
			},
		})
	}), time.Second)

	page, err := c.EventsTail(context.Background(), "tok", 100)
	if err != nil {
		t.Fatalf("EventsTail: %v", err)
	}
	if page.FirstSeq != 8 || page.LastSeq != 9 || len(page.Events) != 2 {
		t.Fatalf("page = %+v", page)
	}
}

func TestSessionsAndRevoke(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/webui/auth/sessions":
			writeJSON(w, 200, map[string]any{"status": "200", "sessions": []map[string]any{{"id": "abc", "created": "t", "expires": nil, "current": true}}})
		case "/webui/auth/revoke":
			if r.URL.Query().Get("all") != "true" {
				t.Errorf("all = %q", r.URL.Query().Get("all"))
			}
			writeJSON(w, 200, map[string]any{"status": "200", "revoked": 2})
		}
	}), time.Second)

	list, err := c.Sessions(context.Background(), "tok")
	if err != nil || len(list) != 1 || list[0].ID != "abc" {
		t.Fatalf("list = %+v err=%v", list, err)
	}
	n, err := c.RevokeSessions(context.Background(), "tok", "", true)
	if err != nil || n != 2 {
		t.Fatalf("n = %d err=%v", n, err)
	}
}

func TestRunBatchPlayerOffline(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("mode") != "player" {
			t.Errorf("mode = %q", r.URL.Query().Get("mode"))
		}
		writeJSON(w, 200, map[string]any{"status": "200", "code": "player_offline", "error": "该玩家不在线"})
	}), time.Second)

	_, err := c.RunBatchPlayer(context.Background(), "tok", []string{"/i 1"})
	var e *APIError
	if !errors.As(err, &e) || e.Kind != KindPluginBusiness || e.Code != "player_offline" {
		t.Fatalf("err = %v", err)
	}
	if e.Message != "该玩家不在线" {
		t.Fatalf("message = %q", e.Message)
	}
}
