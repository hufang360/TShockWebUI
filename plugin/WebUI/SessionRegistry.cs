using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Rests;

namespace WebUI
{
    /// <summary>
    /// 本插件铸造过的 web 会话（REST token）登记表。
    /// 用于「自助查看 / 吊销会话」与可选的 token TTL；不把 token 明文返回给前端
    /// （列表里只有不可逆的短 id）。
    /// </summary>
    internal class SessionRegistry
    {
        private class Record
        {
            public string Id;
            public string Token;
            public string Username;
            public string Group;
            public DateTime CreatedUtc;
            public DateTime ExpiresUtc; // MinValue = 不过期
        }

        private readonly object _lock = new object();
        private readonly Dictionary<string, Record> _byId = new Dictionary<string, Record>();
        private readonly Dictionary<string, string> _byToken = new Dictionary<string, string>();

        private static string Hash(string token)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(token));
                return string.Concat(bytes.Take(8).Select(b => b.ToString("x2")));
            }
        }

        /// <summary>登记一条新铸造的 token。返回不可逆的会话 id。</summary>
        public string Register(string token, string username, string group, int ttlMinutes)
        {
            if (string.IsNullOrEmpty(token)) return null;
            var id = Hash(token);
            lock (_lock)
            {
                _byId[id] = new Record
                {
                    Id = id,
                    Token = token,
                    Username = username,
                    Group = group,
                    CreatedUtc = DateTime.UtcNow,
                    ExpiresUtc = ttlMinutes > 0 ? DateTime.UtcNow.AddMinutes(ttlMinutes) : DateTime.MinValue,
                };
                _byToken[token] = id;
            }
            return id;
        }

        /// <summary>列出某账号名下的会话（不含 token 明文）。</summary>
        public List<Dictionary<string, object>> ListFor(string username, string currentToken)
        {
            lock (_lock)
            {
                return _byId.Values
                    .Where(r => string.Equals(r.Username, username, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(r => r.CreatedUtc)
                    .Select(r => new Dictionary<string, object>
                    {
                        { "id", r.Id },
                        { "created", r.CreatedUtc.ToString("o") },
                        { "expires", r.ExpiresUtc == DateTime.MinValue ? null : r.ExpiresUtc.ToString("o") },
                        { "current", r.Token == currentToken },
                    })
                    .ToList();
            }
        }

        /// <summary>吊销指定 id（必须是该账号自己的）；all=true 吊销其全部会话。</summary>
        public int Revoke(string username, string id, bool all, string keepToken)
        {
            var removed = new List<Record>();
            lock (_lock)
            {
                foreach (var r in _byId.Values.ToList())
                {
                    if (!string.Equals(r.Username, username, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!all && !string.Equals(r.Id, id, StringComparison.Ordinal)) continue;
                    if (all && !string.IsNullOrEmpty(keepToken) && r.Token == keepToken) continue; // 不吊销当前会话
                    removed.Add(r);
                    _byId.Remove(r.Id);
                    _byToken.Remove(r.Token);
                }
            }
            foreach (var r in removed)
                Plugin.DestroyToken(r.Token);
            return removed.Count;
        }

        /// <summary>清理过期 token（TTL 生效时由 GameUpdate 周期调用）。</summary>
        public void SweepExpired()
        {
            var now = DateTime.UtcNow;
            var expired = new List<Record>();
            lock (_lock)
            {
                foreach (var r in _byId.Values.ToList())
                {
                    if (r.ExpiresUtc != DateTime.MinValue && r.ExpiresUtc <= now)
                    {
                        expired.Add(r);
                        _byId.Remove(r.Id);
                        _byToken.Remove(r.Token);
                    }
                }
            }
            foreach (var r in expired)
                Plugin.DestroyToken(r.Token);
        }

        /// <summary>token 被外部销毁（如后端 logout）后同步移除登记。</summary>
        public void Forget(string token)
        {
            if (string.IsNullOrEmpty(token)) return;
            lock (_lock)
            {
                if (_byToken.TryGetValue(token, out var id))
                {
                    _byToken.Remove(token);
                    _byId.Remove(id);
                }
            }
        }
    }
}
