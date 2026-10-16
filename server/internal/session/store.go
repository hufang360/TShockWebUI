// Package session 实现进程内会话存储（ADR-10：无数据库，重启即失效）。
//
// 会话持有 TShock token，**只存在于后端内存**，绝不下发给浏览器
// （设计原则与约束 C15）。浏览器只有随机、HttpOnly 的会话 Cookie。
package session

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"
)

// Session 是一条登录会话。TShockToken 为敏感字段，不得序列化输出。
type Session struct {
	ID          string
	Username    string
	TShockToken string
	CreatedAt   time.Time
	LastSeen    time.Time
}

// Store 是并发安全的内存会话表。
type Store struct {
	mu       sync.RWMutex
	sessions map[string]Session
	ttl      time.Duration
	max      int
	now      func() time.Time // 便于测试注入时钟
}

// New 创建会话表。max<=0 时使用 1（避免无上限）。
func New(ttl time.Duration, max int) *Store {
	if max <= 0 {
		max = 1
	}
	return &Store{
		sessions: make(map[string]Session),
		ttl:      ttl,
		max:      max,
		now:      time.Now,
	}
}

// Create 生成随机会话 ID 并保存。已满时先清理过期条目，仍满则返回错误。
func (s *Store) Create(username, token string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	s.gcLocked(now)
	if len(s.sessions) >= s.max {
		return Session{}, fmt.Errorf("会话数量已达上限 %d", s.max)
	}

	id, err := randomID()
	if err != nil {
		return Session{}, err
	}
	sess := Session{
		ID:          id,
		Username:    username,
		TShockToken: token,
		CreatedAt:   now,
		LastSeen:    now,
	}
	s.sessions[id] = sess
	return sess, nil
}

// Get 返回会话副本并刷新 LastSeen；过期或不存在时返回 false。
func (s *Store) Get(id string) (Session, bool) {
	if id == "" {
		return Session{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.sessions[id]
	if !ok {
		return Session{}, false
	}
	now := s.now()
	if now.Sub(sess.LastSeen) > s.ttl {
		delete(s.sessions, id)
		return Session{}, false
	}
	sess.LastSeen = now
	s.sessions[id] = sess
	return sess, true
}

// Delete 删除会话（退出登录 / token 失效）。
func (s *Store) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

// Len 返回当前会话数（含尚未被惰性清理的过期条目）。
func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

// gcLocked 清理过期会话；调用方须持写锁。
func (s *Store) gcLocked(now time.Time) {
	for id, sess := range s.sessions {
		if now.Sub(sess.LastSeen) > s.ttl {
			delete(s.sessions, id)
		}
	}
}

// SetClock 仅供测试注入确定性时钟。
func (s *Store) SetClock(now func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.now = now
}

func randomID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成会话 ID 失败：%w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
