using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using Rests;
using TShockAPI;
using TShockAPI.DB;

namespace WebUI
{
    /// <summary>一次「在线授权」请求。</summary>
    internal class AuthTicket
    {
        public string Code;          // 6 位数字验证码，玩家在游戏内输入
        public string PlayerName;    // 发起时匹配到的在线玩家名（用于校验审批人）
        public string AccountName;   // TShock 账号名（token 使用）
        public string GroupName;     // 账号所属组名（token 使用）
        public string State;         // pending / approved / denied / expired
        public DateTime ExpiresAtUtc;
        public string Token;         // 轮询取走时才铸造，避免遗弃 token
    }

    /// <summary>
    /// 授权票据存储。所有状态变更都在 <see cref="_lock"/> 内完成；
    /// REST 线程、游戏主线程、清理定时器都会访问。
    /// </summary>
    internal class AuthStore
    {
        private const string StatePending = "pending";
        private const string StateApproved = "approved";
        private const string StateDenied = "denied";
        private const string StateExpired = "expired";

        private readonly object _lock = new object();
        private readonly Dictionary<string, AuthTicket> _tickets = new Dictionary<string, AuthTicket>();
        private readonly Dictionary<string, string> _pendingByPlayer = new Dictionary<string, string>();
        private readonly Dictionary<string, List<DateTime>> _requestTimes = new Dictionary<string, List<DateTime>>();
        private readonly RandomNumberGenerator _rng = RandomNumberGenerator.Create();
        private readonly WebAuthConfig _cfg;

        public AuthStore(WebAuthConfig cfg)
        {
            _cfg = cfg;
        }

        /// <summary>
        /// 发起一次授权请求：匹配在线玩家 → 生成验证码 → 让玩家在游戏内审批。
        /// 返回给后端的 RestObject（业务状态放在 code 字段，HTTP 仍是 200）。
        /// </summary>
        public RestObject Begin(string name, string clientIp)
        {
            name = (name ?? "").Trim();
            if (name.Length == 0)
                return Business("missing_name", "缺少 name 参数");

            var player = Plugin.FindPlayer(name);
            if (player == null)
                return Business("offline", "该玩家不在线");

            // 必须已用 TShock 账号登录：否则任何人都能顶着别人的角色名批准授权。
            UserAccount account = player.Account;
            if (account == null)
                return Business("no_account", "该玩家尚未登录 TShock 账号（请先在游戏内 /login）");

            Group group = TShock.Groups.GetGroupByName(account.Group);
            if (group == null || (!group.HasPermission(RestPermissions.restapi) && account.Group != "superadmin"))
                return Business("no_api_permission", "该账号所属用户组缺少 tshock.rest.useapi 权限，请联系管理员");

            var key = account.Name.ToLowerInvariant();
            if (!AllowRequest(key))
                return Business("rate_limited", "请求过于频繁，请稍后再试");

            string code;
            lock (_lock)
            {
                // 同一玩家已有未过期请求：复用，避免重复刷屏。
                if (_pendingByPlayer.TryGetValue(key, out var existing) &&
                    _tickets.TryGetValue(existing, out var ticket) &&
                    ticket.State == StatePending && ticket.ExpiresAtUtc > UtcNow)
                {
                    code = existing;
                }
                else
                {
                    code = NewCodeLocked();
                    var t = new AuthTicket
                    {
                        Code = code,
                        PlayerName = player.Name,
                        AccountName = account.Name,
                        GroupName = group.Name,
                        State = StatePending,
                        ExpiresAtUtc = UtcNow.AddSeconds(_cfg.TimeoutSeconds),
                    };
                    _tickets[code] = t;
                    _pendingByPlayer[key] = code;
                }
            }

            var expires = _cfg.TimeoutSeconds;
            var source = string.IsNullOrWhiteSpace(clientIp) ? "" : $"（来源：{clientIp.Trim()}）";
            Plugin.NotifyPlayer(player.Name,
                $"[网页登录] 有人请求以 {account.Name} 的身份登录网页端{source}。\n" +
                $"同意请发送：/web auth {code}（或直接回复 y）\n" +
                $"拒绝请发送：/web deny {code}（或直接回复 n）\n" +
                $"（{expires} 秒内有效）");

            return new RestObject("200")
            {
                { "code", "ok" },
                { "ticket", code },
                { "expires", expires },
                { "player", player.Name },
                { "username", account.Name },
            };
        }

        /// <summary>轮询票据状态（支持长轮询）；批准后铸造并返回 TShock token（仅返回一次）。</summary>
        public RestObject Poll(string code, int waitSeconds)
        {
            code = (code ?? "").Trim();
            if (code.Length == 0)
                return Business("invalid_ticket", "ticket 不能为空");

            // 长轮询：wait 秒内状态仍为 pending 就继续等待，减少后端请求数。
            var deadline = UtcNow.AddSeconds(Math.Max(0, waitSeconds));
            while (true)
            {
                var res = PollOnce(code);
                var state = res["state"] as string;
                if (state != StatePending || waitSeconds <= 0 || UtcNow >= deadline)
                    return res;
                System.Threading.Thread.Sleep(200);
            }
        }

        private RestObject PollOnce(string code)
        {
            code = (code ?? "").Trim();
            if (code.Length == 0)
                return Business("invalid_ticket", "ticket 不能为空");

            lock (_lock)
            {
                if (!_tickets.TryGetValue(code, out var t))
                    return new RestObject("200") { { "code", "invalid_ticket" }, { "state", StateExpired } };

                if (t.State == StatePending && t.ExpiresAtUtc <= UtcNow)
                    t.State = StateExpired;

                switch (t.State)
                {
                    case StatePending:
                        return new RestObject("200") { { "code", "ok" }, { "state", StatePending } };

                    case StateApproved:
                        if (string.IsNullOrEmpty(t.Token))
                            t.Token = Plugin.MintToken(t.AccountName, t.GroupName);
                        if (string.IsNullOrEmpty(t.Token))
                        {
                            RemoveLocked(t);
                            return Business("server_error", "无法创建访问令牌（TShock REST 未启用？）");
                        }
                        var approved = new RestObject("200")
                        {
                            { "code", "ok" },
                            { "state", StateApproved },
                            { "username", t.AccountName },
                            { "token", t.Token },
                        };
                        RemoveLocked(t);
                        return approved;

                    default:
                        var terminal = new RestObject("200") { { "code", "ok" }, { "state", t.State } };
                        RemoveLocked(t);
                        return terminal;
                }
            }
        }

        /// <summary>玩家直接回复 y / n 时的快捷确认；没有待确认请求时返回 null（不拦截聊天）。</summary>
        public string TryResolveByPlayer(string playerName, bool deny)
        {
            if (string.IsNullOrWhiteSpace(playerName)) return null;
            string code = null;
            lock (_lock)
            {
                foreach (var t in _tickets.Values)
                {
                    if (t.State == StatePending && t.ExpiresAtUtc > UtcNow &&
                        string.Equals(t.PlayerName, playerName, StringComparison.OrdinalIgnoreCase))
                    {
                        code = t.Code;
                        break;
                    }
                }
            }
            return code == null ? null : Resolve(code, playerName, deny);
        }

        /// <summary>后端放弃等待时回收票据（正常轮询取走 token 后票据已删除）。</summary>
        public RestObject Cancel(string code)
        {
            code = (code ?? "").Trim();
            lock (_lock)
            {
                if (_tickets.TryGetValue(code, out var t))
                {
                    if (!string.IsNullOrEmpty(t.Token))
                        Plugin.DestroyToken(t.Token);
                    RemoveLocked(t);
                }
            }
            return new RestObject("200") { { "code", "ok" } };
        }

        /// <summary>玩家在游戏内同意/拒绝。返回给玩家的提示文案。</summary>
        public string Resolve(string code, string playerName, bool deny)
        {
            code = (code ?? "").Trim();
            if (code.Length == 0)
                return "用法：/web auth <验证码> 或 /web deny <验证码>";

            lock (_lock)
            {
                if (!_tickets.TryGetValue(code, out var t))
                    return "验证码不存在或已过期。";
                if (t.State == StatePending && t.ExpiresAtUtc <= UtcNow)
                {
                    t.State = StateExpired;
                    RemoveLocked(t);
                    return "验证码已过期，请让网页端重新发起。";
                }
                if (t.State != StatePending)
                    return "该验证码已被处理。";
                if (!string.Equals(t.PlayerName, playerName, StringComparison.OrdinalIgnoreCase))
                    return "该验证码不属于你。";

                if (deny)
                {
                    t.State = StateDenied;
                    Plugin.NotifyPlayer(t.PlayerName, "[网页登录] 已拒绝本次登录请求。");
                    return "已拒绝本次网页登录请求。";
                }

                t.State = StateApproved;
                Plugin.NotifyPlayer(t.PlayerName, "[网页登录] 已同意，请返回网页端。");
                return "已同意，请返回网页端。";
            }
        }

        /// <summary>
        /// 清理过期票据；由 GameUpdate 周期调用。
        /// 只回收已超过有效期的票据：已批准但后端还没来得及轮询的票据必须保留到过期为止，
        /// 否则会在「玩家同意」与「后端轮询」之间被误删。
        /// </summary>
        public void Sweep()
        {
            lock (_lock)
            {
                var stale = _tickets.Values.Where(t => t.ExpiresAtUtc <= UtcNow).ToList();
                foreach (var t in stale)
                {
                    if (t.State == StatePending) t.State = StateExpired;
                    // 只有被 API 取走过 token 的票据才会带 token；此时若仍未交付则回收。
                    if (!string.IsNullOrEmpty(t.Token))
                        Plugin.DestroyToken(t.Token);
                    RemoveLocked(t);
                }

                // 限流窗口顺带裁剪，避免无限增长。
                var cutoff = UtcNow.AddMinutes(-2);
                foreach (var k in _requestTimes.Keys.ToList())
                {
                    _requestTimes[k].RemoveAll(ts => ts < cutoff);
                    if (_requestTimes[k].Count == 0) _requestTimes.Remove(k);
                }
            }
        }

        // ---------- 内部 ----------

        private void RemoveLocked(AuthTicket t)
        {
            _tickets.Remove(t.Code);
            foreach (var kv in _pendingByPlayer.ToList())
                if (kv.Value == t.Code) _pendingByPlayer.Remove(kv.Key);
        }

        private bool AllowRequest(string accountKey)
        {
            lock (_lock)
            {
                if (!_requestTimes.TryGetValue(accountKey, out var list))
                {
                    list = new List<DateTime>();
                    _requestTimes[accountKey] = list;
                }
                var since = UtcNow.AddMinutes(-1);
                list.RemoveAll(ts => ts < since);
                if (list.Count >= _cfg.MaxRequestsPerMinute) return false;
                list.Add(UtcNow);
                return true;
            }
        }

        private string NewCodeLocked()
        {
            for (int i = 0; i < 100; i++)
            {
                var bytes = new byte[4];
                _rng.GetBytes(bytes);
                var code = (BitConverter.ToUInt32(bytes, 0) % 1000000).ToString("D6");
                if (!_tickets.ContainsKey(code)) return code;
            }
            return Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        private static DateTime UtcNow => DateTime.UtcNow;

        private static RestObject Business(string code, string message)
        {
            return new RestObject("200") { { "code", code }, { "message", message } };
        }
    }
}
