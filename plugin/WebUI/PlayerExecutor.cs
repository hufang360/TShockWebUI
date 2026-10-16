using System.Collections.Generic;
using Microsoft.Xna.Framework;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// 「以真实在线玩家身份」执行指令时使用的捕获型玩家对象。
    ///
    /// 它继承 <see cref="TSPlayer"/> 并绑定到真实玩家的 Index：
    ///   - <c>RealPlayer</c> 为 true → TShock 不会因 <c>AllowServer=false</c> 拒绝；
    ///   - <c>TPlayer</c> 返回 <c>Main.player[Index]</c>（真实角色）→ 坐标 / 背包 / 状态都正确；
    ///   - 覆写 <c>SendMessage</c> 系列 → 指令输出被收集而不是发给真实客户端（output 回传给网页）。
    ///
    /// 权限用传入的 <paramref name="group"/>（token 所属组），与 rawcmd 一致，**不提权**。
    /// 仅在 <c>AllowInGameOnlyCommands</c> 打开且目标玩家在线时使用。
    /// </summary>
    internal class PlayerExecutor : TSPlayer
    {
        public readonly List<string> Output = new List<string>();

        public PlayerExecutor(int index, Group group) : base(index)
        {
            Group = group;
        }

        public override void SendMessage(string msg, Color color)
        {
            SendMessage(msg, color.R, color.G, color.B);
        }

        public override void SendMessage(string msg, byte red, byte green, byte blue)
        {
            if (msg == null) return;
            if (msg.Contains("\n"))
            {
                foreach (var line in msg.Split('\n'))
                    SendMessage(line, red, green, blue);
                return;
            }
            Output.Add(msg);
        }

        public override void SendInfoMessage(string msg) => SendMessage(msg, Color.Yellow);
        public override void SendSuccessMessage(string msg) => SendMessage(msg, Color.Green);
        public override void SendWarningMessage(string msg) => SendMessage(msg, Color.OrangeRed);
        public override void SendErrorMessage(string msg) => SendMessage(msg, Color.Red);
    }
}
