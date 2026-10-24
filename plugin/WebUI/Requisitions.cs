using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Rests;
using Terraria;
using Terraria.ID;
using TShockAPI;
using TShockAPI.Localization;

namespace WebUI
{
    /// <summary>物资申请里的一行：物品 id + 总数量（发放时按 maxStack 自动拆组）。</summary>
    internal sealed class RequisitionItem
    {
        public int Id { get; set; }
        public int Stack { get; set; }
    }

    /// <summary>一条物资申请。状态见 <see cref="RequisitionStore"/> 顶部注释。</summary>
    internal sealed class RequisitionRecord
    {
        public int Id { get; set; }
        public string Account { get; set; }
        public string Player { get; set; }
        public List<RequisitionItem> Items { get; set; } = new List<RequisitionItem>();
        public string Reason { get; set; } = "";
        public string Note { get; set; } = "";
        public string Status { get; set; } = RequisitionStore.StatusPending;
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public string ReviewedBy { get; set; }
        public DateTime? ReviewedAt { get; set; }
        public string DenyReason { get; set; }
        public DateTime? DeliveredAt { get; set; }
        public string DeliveryError { get; set; }
        /// <summary>是否已在游戏内提醒过申请人结果（离线时下次登录补提醒）。</summary>
        public bool Notified { get; set; }
        public string World { get; set; }
    }

    internal sealed class RequisitionFile
    {
        public int NextId { get; set; } = 1;
        public List<RequisitionRecord> Requests { get; set; } = new List<RequisitionRecord>();
    }

    /// <summary>
    /// 物资申请存储（玩家提交 → 服主在游戏内 / 网页审核 → 发放）。
    ///
    /// 设计约束：
    ///   - 申请人身份只来自 token（<see cref="SecureRest.TokenData.Username"/>），不信任前端传名；
    ///   - 审核权限 <c>webui.request.review</c>，提交权限 <c>webui.request.use</c>；
    ///   - 发放用 TShock 自己的 <c>TSPlayer.GiveItemCheck</c>（尊重 item ban），不绕过任何限制；
    ///   - 数据落盘 <c>tshock/WebUI/requests.json</c>，原子替换 + 备份，重启不丢；
    ///   - 所有会写库存的操作都在游戏主线程执行。
    ///
    /// 状态机：
    ///   pending ──approve(在线+自动发放)──> delivered
    ///      │                 └─(离线/自动发放关)─> approved ──登录/手动──> delivered
    ///      ├──deny──> denied
    ///      └──cancel──> cancelled
    /// </summary>
    internal static class RequisitionStore
    {
        public const string StatusPending = "pending";
        public const string StatusApproved = "approved";
        public const string StatusDelivered = "delivered";
        public const string StatusDenied = "denied";
        public const string StatusCancelled = "cancelled";

        private const int MaxReasonLength = 200;
        private const int MaxNoteLength = 200;

        private static readonly object Lock = new object();
        private static readonly List<RequisitionRecord> Records = new List<RequisitionRecord>();

        private static WebAuthConfig _cfg;
        private static string _path;
        private static int _nextId = 1;

        /// <summary>由插件 Initialize 调用：建目录、加载历史。</summary>
        public static void Init(WebAuthConfig cfg)
        {
            _cfg = cfg;
            try
            {
                var dir = Path.Combine(TShock.SavePath, "WebUI");
                Directory.CreateDirectory(dir);
                _path = Path.Combine(dir, "requests.json");
                Load();
                lock (Lock)
                {
                    PruneLocked();
                    SaveLocked();
                }
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 物资申请存储初始化失败（将以内存模式运行）：" + ex);
            }
        }

        /// <summary>由插件 Dispose 调用：确保最后一次变更落盘。</summary>
        public static void Shutdown()
        {
            lock (Lock)
            {
                try { SaveLocked(); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 物资申请保存失败：" + ex.Message); }
            }
        }

        // ---------- REST 入口 ----------

        /// <summary>GET /webui/requests?status=：我的申请。</summary>
        public static object ListMine(SecureRest.TokenData token, string status)
        {
            var account = TokenAccount(token);
            if (account.Length == 0)
                return Error("403", "无效的登录身份");

            var filter = NormalizeStatusFilter(status);
            lock (Lock)
            {
                var list = Records
                    .Where(r => string.Equals(r.Account, account, StringComparison.OrdinalIgnoreCase))
                    .Where(r => MatchesStatus(r, filter))
                    .OrderByDescending(r => r.Id)
                    .Take(50)
                    .Select(ToDict)
                    .ToList();
                return new RestObject("200") { { "requests", list } };
            }
        }

        /// <summary>GET /webui/requests/create?items=&amp;reason=&amp;note=：提交申请。</summary>
        public static object Create(SecureRest.TokenData token, string itemsJson, string reason, string note)
        {
            if (_cfg == null || !_cfg.RequestsEnabled)
                return Error("403", "服务器未开启物资申请");

            var account = TokenAccount(token);
            if (account.Length == 0)
                return Error("403", "无效的登录身份");

            reason = CleanText(reason, MaxReasonLength);
            note = CleanText(note, MaxNoteLength);
            if (reason.Length == 0)
                return Error("400", "请填写申请用途");

            List<RequisitionItem> parsed;
            try
            {
                parsed = JsonConvert.DeserializeObject<List<RequisitionItem>>(itemsJson ?? "")
                         ?? new List<RequisitionItem>();
            }
            catch
            {
                return Error("400", "items 不是合法的 JSON 数组");
            }

            // 物品禁用判定需要玩家用户组（allowed groups 白名单）；离线时用账号组构造只读玩家。
            var banChecker = FindOnlineByAccount(account);
            if (banChecker == null)
            {
                try
                {
                    var user = TShock.UserAccounts.GetUserAccountByName(account);
                    var group = user != null ? TShock.Groups.GetGroupByName(user.Group) : null;
                    if (group != null) banChecker = new TSRestPlayer(account, group);
                }
                catch { /* 取不到账号就不做玩家级白名单判断 */ }
            }

            var error = ValidateItems(parsed, banChecker, out var items);
            if (error != null) return Error("400", error);

            var online = FindOnlineByAccount(account);
            var now = DateTime.UtcNow;
            RequisitionRecord record;
            lock (Lock)
            {
                if (!CanSubmitLocked(account, now, out var limitError))
                    return Error("400", limitError);

                record = new RequisitionRecord
                {
                    Id = _nextId++,
                    Account = account,
                    Player = online != null && !string.IsNullOrWhiteSpace(online.Name) ? online.Name : account,
                    Items = items,
                    Reason = reason,
                    Note = note,
                    Status = StatusPending,
                    CreatedAt = now,
                    UpdatedAt = now,
                    Notified = false,
                    World = SafeWorldName(),
                };
                Records.Add(record);
                SaveLocked();
            }

            NotifyReviewers($"# {record.Id} 来自 {record.Player}：{ItemSummary(record.Items)}，待审核（/web req show {record.Id}）");
            return new RestObject("200") { { "request", ToDict(record) } };
        }

        /// <summary>GET /webui/requests/cancel?id=：申请人撤回自己的待审申请。</summary>
        public static object Cancel(SecureRest.TokenData token, int id)
        {
            var account = TokenAccount(token);
            if (account.Length == 0)
                return Error("403", "无效的登录身份");

            RequisitionRecord record;
            lock (Lock)
            {
                record = FindLocked(id);
                if (record == null) return Error("400", "申请不存在");
                if (!string.Equals(record.Account, account, StringComparison.OrdinalIgnoreCase))
                    return Error("403", "不能撤回别人的申请");
                if (record.Status != StatusPending)
                    return Error("400", "只有待审核的申请可以撤回");

                record.Status = StatusCancelled;
                record.UpdatedAt = DateTime.UtcNow;
                record.Notified = true;
                SaveLocked();
                return new RestObject("200") { { "request", ToDict(record) } };
            }
        }

        /// <summary>GET /webui/requests/all?status=：审核列表（需 webui.request.review）。</summary>
        public static object ListAll(string status)
        {
            var filter = NormalizeStatusFilter(status);
            lock (Lock)
            {
                var list = Records
                    .Where(r => MatchesStatus(r, filter))
                    .OrderByDescending(r => r.Id)
                    .Take(100)
                    .Select(ToDict)
                    .ToList();
                return new RestObject("200") { { "requests", list } };
            }
        }

        /// <summary>GET /webui/requests/review?id=&amp;decision=approve|deny&amp;reason=：审核。</summary>
        public static object Review(SecureRest.TokenData token, int id, string decision, string reason, bool inline)
        {
            var reviewer = TokenAccount(token);
            if (reviewer.Length == 0)
                return Error("403", "无效的登录身份");

            decision = (decision ?? "").Trim().ToLowerInvariant();
            if (decision != "approve" && decision != "deny")
                return Error("400", "decision 必须是 approve 或 deny");

            RequisitionRecord record;
            lock (Lock)
            {
                record = FindLocked(id);
                if (record == null) return Error("400", "申请不存在");
                if (record.Status != StatusPending)
                    return Error("400", $"该申请已处理（{StatusText(record.Status)}）");

                record.ReviewedBy = reviewer;
                record.ReviewedAt = DateTime.UtcNow;
                record.UpdatedAt = DateTime.UtcNow;

                if (decision == "deny")
                {
                    var denyReason = CleanText(reason, MaxReasonLength);
                    record.Status = StatusDenied;
                    record.DenyReason = denyReason.Length > 0 ? denyReason : "未说明原因";
                    record.Notified = FindOnlineByAccount(record.Account) != null;
                    SaveLocked();
                    NotifyOwner(record.Account, $"[物资申请] # {record.Id} 已被拒绝：{record.DenyReason}");
                    return new RestObject("200") { { "request", ToDict(record) } };
                }

                if (_cfg == null || !_cfg.RequestAutoDeliver)
                {
                    record.Status = StatusApproved;
                    record.Notified = FindOnlineByAccount(record.Account) != null;
                    SaveLocked();
                    NotifyOwner(record.Account, $"[物资申请] # {record.Id} 已批准，等待发放。");
                    return new RestObject("200") { { "request", ToDict(record) }, { "deliveryScheduled", false } };
                }

                var online = FindOnlineByAccount(record.Account);
                if (online == null)
                {
                    record.Status = StatusApproved;
                    record.Notified = false;
                    SaveLocked();
                    NotifyOwner(record.Account, $"[物资申请] # {record.Id} 已批准；你下次登录时会自动发放。");
                    return new RestObject("200") { { "request", ToDict(record) }, { "deliveryScheduled", true } };
                }

                if (inline)
                {
                    // 游戏内指令：当前已在主线程，直接发放。
                    DeliverLocked(record, reviewer);
                    return new RestObject("200") { { "request", ToDict(record) }, { "deliveryScheduled", false } };
                }

                record.Status = StatusApproved;
                record.Notified = false;
                SaveLocked();
                // 先快照：调度到主线程后 record 可能马上变成 delivered。
                var snapshot = ToDict(record);
                Plugin.RunOnMainThread(() => DeliverNow(id, reviewer));
                return new RestObject("200")
                {
                    { "request", snapshot },
                    { "deliveryScheduled", true },
                };
            }
        }

        /// <summary>GET /webui/requests/deliver?id=：补发已批准但未发放的申请。</summary>
        public static object Deliver(SecureRest.TokenData token, int id, bool inline)
        {
            var reviewer = TokenAccount(token);
            if (reviewer.Length == 0)
                return Error("403", "无效的登录身份");

            RequisitionRecord record;
            lock (Lock)
            {
                record = FindLocked(id);
                if (record == null) return Error("400", "申请不存在");
                if (record.Status == StatusDelivered) return Error("400", "该申请已经发放");
                if (record.Status != StatusApproved) return Error("400", "只有已批准的申请可以补发");

                if (inline)
                {
                    DeliverLocked(record, reviewer);
                    return new RestObject("200") { { "request", ToDict(record) } };
                }

                var snapshot = ToDict(record);
                Plugin.RunOnMainThread(() => DeliverNow(id, reviewer));
                return new RestObject("200") { { "request", snapshot }, { "deliveryScheduled", true } };
            }
        }

        // ---------- 玩家登录后补发 / 补提醒 ----------

        /// <summary>PlayerPostLogin 钩子（主线程）：发放离线期间批准的申请，并补发结果提醒。</summary>
        public static void OnPlayerPostLogin(TSPlayer player)
        {
            var account = player?.Account?.Name;
            if (string.IsNullOrWhiteSpace(account)) return;

            var toNotify = new List<string>();
            lock (Lock)
            {
                foreach (var r in Records.Where(r =>
                             string.Equals(r.Account, account, StringComparison.OrdinalIgnoreCase)))
                {
                    if (r.Status == StatusApproved && _cfg != null && _cfg.RequestAutoDeliver)
                    {
                        // DeliverLocked 成功 / 失败都会给玩家发消息；成功后 Notified=true。
                        DeliverLocked(r, "WebUI");
                    }
                    else if (!r.Notified && r.Status == StatusApproved)
                    {
                        toNotify.Add($"[物资申请] # {r.Id} 已批准，等待服主发放。");
                        r.Notified = true;
                    }
                    else if (!r.Notified && r.Status == StatusDenied)
                    {
                        toNotify.Add($"[物资申请] # {r.Id} 已被拒绝：{r.DenyReason}");
                        r.Notified = true;
                    }
                    else if (!r.Notified && r.Status == StatusDelivered)
                    {
                        toNotify.Add($"[物资申请] # {r.Id} 已发放，请查收。");
                        r.Notified = true;
                    }
                }
                SaveLocked();
            }

            foreach (var text in toNotify.Take(10))
                SendInfo(player, text);
            if (toNotify.Count > 10)
                SendInfo(player, $"[物资申请] 另有 {toNotify.Count - 10} 条历史结果，请在网页「我的申请」查看。");
        }

        // ---------- 游戏内指令用 ----------

        public static string CommandList(string status)
        {
            var filter = NormalizeStatusFilter(status);
            lock (Lock)
            {
                var list = Records
                    .Where(r => MatchesStatus(r, filter))
                    .OrderByDescending(r => r.Id)
                    .Take(20)
                    .Select(r => $"# {r.Id} {r.Player}：{ItemSummary(r.Items)}（{StatusText(r.Status)}）")
                    .ToList();
                return list.Count == 0 ? "没有符合条件的申请。" : string.Join("\n", list);
            }
        }

        public static string CommandShow(int id)
        {
            lock (Lock)
            {
                var r = FindLocked(id);
                if (r == null) return "申请不存在。";
                var lines = new List<string>
                {
                    $"# {r.Id} {r.Player}（{r.Account}）{StatusText(r.Status)}",
                    $"物品：{ItemSummary(r.Items)}",
                    $"用途：{r.Reason}",
                };
                if (!string.IsNullOrWhiteSpace(r.Note)) lines.Add($"备注：{r.Note}");
                if (!string.IsNullOrWhiteSpace(r.World)) lines.Add($"世界：{r.World}");
                lines.Add($"提交：{LocalTime(r.CreatedAt)}");
                if (!string.IsNullOrWhiteSpace(r.ReviewedBy))
                    lines.Add($"审核：{r.ReviewedBy} @ {LocalTime(r.ReviewedAt)}");
                if (!string.IsNullOrWhiteSpace(r.DenyReason)) lines.Add($"拒绝原因：{r.DenyReason}");
                if (!string.IsNullOrWhiteSpace(r.DeliveryError)) lines.Add($"发放错误：{r.DeliveryError}");
                return string.Join("\n", lines);
            }
        }

        public static object ReviewFromCommand(TSPlayer player, int id, string decision, string reason)
        {
            var token = new SecureRest.TokenData
            {
                Username = player?.Account?.Name ?? player?.Name ?? "Console",
                UserGroupName = player?.Account?.Group ?? "superadmin",
            };
            // 游戏内指令在主线程执行，直接发放。
            return Review(token, id, decision, reason, true);
        }

        public static object DeliverFromCommand(TSPlayer player, int id)
        {
            var token = new SecureRest.TokenData
            {
                Username = player?.Account?.Name ?? player?.Name ?? "Console",
                UserGroupName = player?.Account?.Group ?? "superadmin",
            };
            return Deliver(token, id, true);
        }

        public static string StatusText(string status)
        {
            switch (status)
            {
                case StatusPending: return "待审核";
                case StatusApproved: return "已批准待发放";
                case StatusDelivered: return "已发放";
                case StatusDenied: return "已拒绝";
                case StatusCancelled: return "已撤回";
                default: return status ?? "";
            }
        }

        // ---------- 内部：取数 / 校验 ----------

        private static string TokenAccount(SecureRest.TokenData token)
        {
            return (token.Username ?? "").Trim();
        }

        private static RequisitionRecord FindLocked(int id)
        {
            return Records.FirstOrDefault(r => r.Id == id);
        }

        private static bool MatchesStatus(RequisitionRecord r, string filter)
        {
            if (filter.Length == 0 || filter == "all") return true;
            return string.Equals(r.Status, filter, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeStatusFilter(string status)
        {
            var filter = (status ?? "").Trim().ToLowerInvariant();
            switch (filter)
            {
                case StatusPending:
                case StatusApproved:
                case StatusDelivered:
                case StatusDenied:
                case StatusCancelled:
                case "all":
                    return filter;
                default:
                    return StatusPending;
            }
        }

        private static bool CanSubmitLocked(string account, DateTime now, out string error)
        {
            error = null;
            var cfg = _cfg;
            if (cfg == null) return true;

            var pending = Records.Count(r =>
                string.Equals(r.Account, account, StringComparison.OrdinalIgnoreCase) &&
                r.Status == StatusPending);
            if (cfg.RequestMaxPendingPerPlayer > 0 && pending >= cfg.RequestMaxPendingPerPlayer)
            {
                error = $"你已有 {pending} 条待审核申请，最多 {cfg.RequestMaxPendingPerPlayer} 条，请等待服主处理";
                return false;
            }

            var localToday = DateTime.Now.Date;
            var today = Records.Count(r =>
                string.Equals(r.Account, account, StringComparison.OrdinalIgnoreCase) &&
                r.CreatedAt.ToLocalTime().Date == localToday);
            if (cfg.RequestMaxPerDayPerPlayer > 0 && today >= cfg.RequestMaxPerDayPerPlayer)
            {
                error = $"今天最多提交 {cfg.RequestMaxPerDayPerPlayer} 条申请，请明天再试";
                return false;
            }

            if (cfg.RequestMinIntervalSeconds > 0)
            {
                var last = Records
                    .Where(r => string.Equals(r.Account, account, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(r => r.CreatedAt)
                    .FirstOrDefault();
                if (last != null && (now - last.CreatedAt).TotalSeconds < cfg.RequestMinIntervalSeconds)
                {
                    error = $"提交过于频繁，请 {cfg.RequestMinIntervalSeconds} 秒后再试";
                    return false;
                }
            }

            var totalPending = Records.Count(r => r.Status == StatusPending);
            if (cfg.RequestMaxPendingTotal > 0 && totalPending >= cfg.RequestMaxPendingTotal)
            {
                error = "服务器待审核申请过多，请稍后再试";
                return false;
            }

            return true;
        }

        private static string ValidateItems(List<RequisitionItem> raw, TSPlayer banChecker, out List<RequisitionItem> items)
        {
            items = new List<RequisitionItem>();
            if (raw == null || raw.Count == 0) return "请至少选择一种物品";

            var cfg = _cfg;
            var maxItems = cfg != null && cfg.RequestMaxItems > 0 ? cfg.RequestMaxItems : 10;
            var maxStacksPerLine = cfg != null && cfg.RequestMaxStacksPerLine > 0 ? cfg.RequestMaxStacksPerLine : 10;
            var maxTotalStacks = cfg != null && cfg.RequestMaxTotalStacks > 0 ? cfg.RequestMaxTotalStacks : 30;

            // 合并同 id 的行，避免绕过单行上限。
            var merged = new Dictionary<int, int>();
            foreach (var it in raw)
            {
                if (it == null) continue;
                if (it.Id <= 0 || it.Id >= ItemID.Count)
                    return $"物品 ID 不合法：{it.Id}";
                if (it.Stack <= 0)
                    return "物品数量必须大于 0";
                if (merged.TryGetValue(it.Id, out var old))
                    merged[it.Id] = old > int.MaxValue - it.Stack ? int.MaxValue : old + it.Stack;
                else
                    merged[it.Id] = it.Stack;
            }

            if (merged.Count == 0) return "请至少选择一种物品";
            if (merged.Count > maxItems) return $"一次最多申请 {maxItems} 种物品";

            var totalStacks = 0;
            foreach (var kv in merged)
            {
                var def = TShock.Utils.GetItemById(kv.Key);
                if (def == null || def.type == 0 || def.maxStack <= 0)
                    return $"物品 ID 不合法：{kv.Key}";
                var max = def.maxStack * maxStacksPerLine;
                if (kv.Value > max)
                    return $"「{ItemName(kv.Key)}」最多 {max} 个（{maxStacksPerLine} 组）";
                var stacks = (kv.Value + def.maxStack - 1) / def.maxStack;
                totalStacks += stacks;
                if (totalStacks > maxTotalStacks)
                    return $"一次申请总量过多，最多 {maxTotalStacks} 组，请减少数量";

                if (IsItemBanned(kv.Key, banChecker))
                    return $"「{ItemName(kv.Key)}」已被服务器禁用，不能申请";

                items.Add(new RequisitionItem { Id = kv.Key, Stack = kv.Value });
            }
            return null;
        }

        /// <summary>
        /// 与 TShock 的 <c>GiveItemCheck</c> 保持同一判定：只有开启了
        /// <c>PreventBannedItemSpawn</c> 才拦；玩家级白名单规则也按 TShock 配置处理。
        /// </summary>
        private static bool IsItemBanned(int id, TSPlayer player = null)
        {
            try
            {
                var settings = TShock.Config.Settings;
                if (!settings.PreventBannedItemSpawn) return false;
                var bans = TShock.ItemBans?.DataModel;
                if (bans == null) return false;
                var name = EnglishLanguage.GetItemNameById(id);
                if (!bans.ItemIsBanned(name)) return false;
                if (player == null) return true;
                return bans.ItemIsBanned(name, player) || !settings.AllowAllowedGroupsToSpawnBannedItems;
            }
            catch { return false; }
        }

        // ---------- 内部：发放 ----------

        /// <summary>在锁内执行发放（调用方必须已在主线程）。</summary>
        private static void DeliverLocked(RequisitionRecord record, string by)
        {
            var player = FindOnlineByAccount(record.Account);
            if (player == null)
            {
                record.Status = StatusApproved;
                record.UpdatedAt = DateTime.UtcNow;
                record.DeliveryError = null;
                SaveLocked();
                return;
            }

            var error = GiveAll(player, record.Items);
            record.UpdatedAt = DateTime.UtcNow;
            if (error == null)
            {
                record.Status = StatusDelivered;
                record.DeliveredAt = DateTime.UtcNow;
                record.DeliveryError = null;
                record.Notified = true;
                SaveLocked();
                SendInfo(player, $"[物资申请] # {record.Id} 已发放，请查收。");
            }
            else
            {
                // 保留 approved，方便服主修正后再次补发。
                record.Status = StatusApproved;
                record.DeliveryError = error;
                record.Notified = false;
                SaveLocked();
                SendInfo(player, $"[物资申请] # {record.Id} 发放失败：{error}");
                TShock.Log.ConsoleError($"[WebUI] 物资申请 #{record.Id} 发放失败：{error}");
            }
        }

        /// <summary>REST 线程调度到主线程后执行；会重新检查状态，避免重复发放。</summary>
        private static void DeliverNow(int id, string by)
        {
            lock (Lock)
            {
                var record = FindLocked(id);
                if (record == null || record.Status != StatusApproved) return;
                DeliverLocked(record, by);
            }
        }

        /// <summary>把一份申请的全部物品发给在线玩家；返回 null 表示成功。</summary>
        private static string GiveAll(TSPlayer player, List<RequisitionItem> items)
        {
            if (player == null || !player.Active) return "玩家不在线";

            // 先整体检查禁用，避免发一半才失败。
            foreach (var it in items)
            {
                if (IsItemBanned(it.Id, player))
                    return $"「{ItemName(it.Id)}」已被服务器禁用";
            }

            foreach (var it in items)
            {
                var def = TShock.Utils.GetItemById(it.Id);
                var max = Math.Max(1, def.maxStack);
                var remaining = it.Stack;
                while (remaining > 0)
                {
                    var n = Math.Min(max, remaining);
                    if (!player.GiveItemCheck(it.Id, EnglishLanguage.GetItemNameById(it.Id), n))
                        return $"「{ItemName(it.Id)}」发放被 TShock 拒绝（物品禁用）";
                    remaining -= n;
                }
            }
            return null;
        }

        private static bool NotifyOwner(string account, string message)
        {
            if (string.IsNullOrWhiteSpace(account)) return false;
            var player = FindOnlineByAccount(account);
            if (player == null) return false;
            SendInfo(player, message);
            return true;
        }

        private static void NotifyReviewers(string message)
        {
            if (_cfg != null && !_cfg.RequestNotifyReviewers) return;
            Plugin.RunOnMainThread(() =>
            {
                try
                {
                    foreach (var p in TShock.Players)
                    {
                        if (p == null || !p.Active) continue;
                        if (p.HasPermission(WebUiPermissions.RequestReview))
                            p.SendMessage("[物资申请] " + message, 255, 220, 120);
                    }
                }
                catch (Exception ex)
                {
                    TShock.Log.ConsoleError("[WebUI] 通知审核人失败：" + ex.Message);
                }
            });
        }

        private static void SendInfo(TSPlayer player, string message)
        {
            if (player == null) return;
            Plugin.RunOnMainThread(() =>
            {
                try { player.SendInfoMessage(message); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 发送物资申请消息失败：" + ex.Message); }
            });
        }

        private static TSPlayer FindOnlineByAccount(string account)
        {
            if (string.IsNullOrWhiteSpace(account)) return null;
            foreach (var p in TShock.Players)
            {
                if (p != null && p.Active && p.Account != null &&
                    string.Equals(p.Account.Name, account, StringComparison.OrdinalIgnoreCase))
                    return p;
            }
            return null;
        }

        // ---------- 内部：展示 / 持久化 ----------

        private static Dictionary<string, object> ToDict(RequisitionRecord r)
        {
            return new Dictionary<string, object>
            {
                { "id", r.Id },
                { "account", r.Account ?? "" },
                { "player", r.Player ?? "" },
                { "items", (r.Items ?? new List<RequisitionItem>()).Select(i => new Dictionary<string, object>
                    {
                        { "id", i.Id },
                        { "stack", i.Stack },
                    }).ToList() },
                { "reason", r.Reason ?? "" },
                { "note", r.Note ?? "" },
                { "status", r.Status ?? StatusPending },
                { "createdAt", Iso(r.CreatedAt) },
                { "updatedAt", Iso(r.UpdatedAt) },
                { "reviewedBy", r.ReviewedBy },
                { "reviewedAt", IsoOrNull(r.ReviewedAt) },
                { "denyReason", r.DenyReason },
                { "deliveredAt", IsoOrNull(r.DeliveredAt) },
                { "deliveryError", r.DeliveryError },
                { "world", r.World },
            };
        }

        private static string ItemSummary(List<RequisitionItem> items)
        {
            if (items == null || items.Count == 0) return "（无物品）";
            return string.Join("、", items.Select(i => $"[i:{i.Id}] {ItemName(i.Id)} x{i.Stack}"));
        }

        private static string ItemName(int id)
        {
            try
            {
                var name = Lang.GetItemNameValue(id);
                return string.IsNullOrWhiteSpace(name) ? $"物品#{id}" : name;
            }
            catch { return $"物品#{id}"; }
        }

        private static string CleanText(string s, int max)
        {
            s = (s ?? "").Trim();
            s = s.Replace("\r", " ").Replace("\n", " ");
            // 申请内容会出现在游戏内聊天里：转义 Terraria 富文本标签，避免意外染色 / 插入图标。
            s = s.Replace("[", "［").Replace("]", "］");
            if (s.Length > max) s = s.Substring(0, max);
            return s;
        }

        private static string SafeWorldName()
        {
            try { return Main.worldName ?? ""; }
            catch { return ""; }
        }

        private static string Iso(DateTime dt)
        {
            return DateTime.SpecifyKind(dt, DateTimeKind.Utc).ToString("o");
        }

        private static string IsoOrNull(DateTime? dt)
        {
            return dt.HasValue ? Iso(dt.Value) : null;
        }

        private static string LocalTime(DateTime? dt)
        {
            if (!dt.HasValue) return "";
            return dt.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
        }

        private static RestObject Error(string status, string message)
        {
            return new RestObject(status) { { "error", message } };
        }

        private static void Load()
        {
            lock (Lock)
            {
                Records.Clear();
                _nextId = 1;
                if (string.IsNullOrEmpty(_path) || !File.Exists(_path)) return;

                try
                {
                    var data = JsonConvert.DeserializeObject<RequisitionFile>(File.ReadAllText(_path));
                    if (data?.Requests != null)
                    {
                        foreach (var r in data.Requests.Where(r => r != null))
                        {
                            // 容错：手改 / 旧版本文件缺字段时不让整页列表崩掉。
                            r.Items ??= new List<RequisitionItem>();
                            r.Reason ??= "";
                            r.Note ??= "";
                            r.Account ??= "";
                            r.Player ??= r.Account;
                            r.World ??= "";
                            if (r.Status != StatusPending && r.Status != StatusApproved &&
                                r.Status != StatusDelivered && r.Status != StatusDenied &&
                                r.Status != StatusCancelled)
                                r.Status = StatusPending;
                            Records.Add(r);
                        }
                    }
                    _nextId = Math.Max(1, data?.NextId ?? 1);
                    foreach (var r in Records)
                        if (r.Id >= _nextId) _nextId = r.Id + 1;
                }
                catch (Exception ex)
                {
                    TShock.Log.ConsoleError("[WebUI] 读取 requests.json 失败，已备份坏文件：" + ex.Message);
                    try { File.Copy(_path, _path + ".bad-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"), true); }
                    catch { /* ignore */ }
                    Records.Clear();
                    _nextId = 1;
                }
            }
        }

        private static void PruneLocked()
        {
            var days = _cfg?.RequestHistoryDays ?? 30;
            if (days <= 0) return;
            var cutoff = DateTime.UtcNow.AddDays(-days);
            Records.RemoveAll(r =>
                (r.Status == StatusDelivered || r.Status == StatusDenied || r.Status == StatusCancelled) &&
                r.UpdatedAt < cutoff);
        }

        private static void SaveLocked()
        {
            if (string.IsNullOrEmpty(_path)) return;
            // 每次写盘顺带裁剪：长期运行的服务器不会无限增长。
            PruneLocked();
            var data = new RequisitionFile { NextId = _nextId, Requests = Records };
            var json = JsonConvert.SerializeObject(data, Formatting.Indented);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            try
            {
                if (File.Exists(_path)) File.Copy(_path, _path + ".bak", true);
            }
            catch { /* 备份失败不影响主流程 */ }
            File.Move(tmp, _path, true);
        }
    }
}
