package session

import (
	"sync"
	"testing"
	"time"
)

func TestCreateGetDelete(t *testing.T) {
	s := New(time.Hour, 10)

	sess, err := s.Create("Alice", "tok-1")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if sess.ID == "" || sess.Username != "Alice" || sess.TShockToken != "tok-1" {
		t.Fatalf("会话字段不正确：%+v", sess)
	}

	got, ok := s.Get(sess.ID)
	if !ok || got.Username != "Alice" || got.TShockToken != "tok-1" {
		t.Fatalf("Get 未返回会话：%+v ok=%v", got, ok)
	}

	s.Delete(sess.ID)
	if _, ok := s.Get(sess.ID); ok {
		t.Fatal("删除后仍能取到会话")
	}
	if s.Len() != 0 {
		t.Fatalf("Len = %d，期望 0", s.Len())
	}
}

func TestRandomIDIsUnique(t *testing.T) {
	s := New(time.Hour, 100)
	seen := make(map[string]bool)
	for i := 0; i < 50; i++ {
		sess, err := s.Create("u", "t")
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if seen[sess.ID] {
			t.Fatalf("出现重复会话 ID：%s", sess.ID)
		}
		seen[sess.ID] = true
	}
}

func TestExpiry(t *testing.T) {
	s := New(30*time.Minute, 10)
	now := time.Unix(1_700_000_000, 0)
	s.SetClock(func() time.Time { return now })

	sess, err := s.Create("Alice", "tok")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// 空闲未超时：仍有效，并刷新 LastSeen。
	now = now.Add(20 * time.Minute)
	if _, ok := s.Get(sess.ID); !ok {
		t.Fatal("未超时的会话不应失效")
	}

	// 距上次命中又过了 20 分钟（< TTL）仍有效。
	now = now.Add(20 * time.Minute)
	if _, ok := s.Get(sess.ID); !ok {
		t.Fatal("刷新后不应失效")
	}

	// 超过 TTL。
	now = now.Add(31 * time.Minute)
	if _, ok := s.Get(sess.ID); ok {
		t.Fatal("超时的会话应失效")
	}
}

func TestGCOnCreate(t *testing.T) {
	s := New(time.Minute, 2)
	now := time.Unix(1_700_000_000, 0)
	s.SetClock(func() time.Time { return now })

	if _, err := s.Create("a", "t"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute) // 第一条过期
	// 上限 2，但有 1 条过期；gcLocked 应先清理。
	if _, err := s.Create("b", "t"); err != nil {
		t.Fatalf("清理后不应超限：%v", err)
	}
	if s.Len() != 1 {
		t.Fatalf("Len = %d，期望 1（过期条目被清理）", s.Len())
	}
}

func TestMaxSessions(t *testing.T) {
	s := New(time.Hour, 2)
	if _, err := s.Create("a", "t"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("b", "t"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("c", "t"); err == nil {
		t.Fatal("超过上限时应返回错误")
	}
}

func TestGetEmptyID(t *testing.T) {
	s := New(time.Hour, 10)
	if _, ok := s.Get(""); ok {
		t.Fatal("空 ID 不应命中")
	}
}

func TestConcurrentAccess(t *testing.T) {
	s := New(time.Hour, 1000)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sess, err := s.Create("u", "t")
			if err != nil {
				t.Errorf("Create: %v", err)
				return
			}
			for j := 0; j < 20; j++ {
				s.Get(sess.ID)
			}
			s.Delete(sess.ID)
		}()
	}
	wg.Wait()
}
