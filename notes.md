# 本服实测笔记

> 这里记的是本机/本服**实际跑通**的 TShock 配置原文（`/group addperm` 等），
> 是「指令小抄 → 权限配置」分组的来源（见 `docs/页面-指令小抄.md`）。包含服主账号名，**不含密码 / token**。

## 小抄
```bash


# TShockWebUI支持
# 允许 创建 token（登录）/执行指令
/group addperm default tshock.rest.useapi tshock.rest.command

# 添加GM用户组
/group add GM * !tshock.ignore.ssc
/user group hf GM

# 允许使用 /home 指令
/group addperm default tshock.tp.home
 
# 允许使用 查一查 插件指令
# /r = /recipe 查合成表
# /s = /search 查物品id
/group addperm default hf.recipe hf.search

# 允许使用 /wi 和 /bi 指令（wm插件）
/group addperm default worldinfo bossinfo

# 允许使用 /lb 查背包指令（pm插件）
/group addperm default lookbag
```
