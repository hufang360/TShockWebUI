# 记录：合成表大类物品 ID

记录日期：2026-10-23

来源：`web/src/lib/recipeCategories.ts`（`RECIPE_CATEGORIES`，人工维护的「合成表」速查页大类配置）。
该页签属于 v0.1.0-rc.4 未发布期间的实现，已于 2026-10-23 **整体移除**（物品图鉴只保留「查一查」页签；
物品详情里的合成表 / 用于合成 / 微光嬗变不受影响）。本文件保留原大类的物品 ID 清单，供以后查用或恢复功能时参考。

说明：

- 顺序即原配置顺序（成品在前、材料在后）；
- `useOnly` 的物品即使有配方也只显示「用于合成」；
- 同一物品可出现在多个大类（如 193 黑曜石骷髅头同时属于泰拉靴与护盾）。

| 大类 id | 中文名 | 物品数 | 物品 ID（名称 / 内部名） |
| --- | --- | --- | --- |
| `phone` | 手机 | 9 | 5437 贝壳电话（ShellphoneDummy）<br>3123 个人数字助手（PDA）<br>17 金表（GoldWatch）<br>3122 R.E.K.3000（REK）<br>3121 哥布林数据仪（GoblinTech）<br>3036 探鱼器（FishFinder）<br>3124 手机（CellPhone）<br>395 全球定位系统（GPS）<br>50 魔镜（MagicMirror） |
| `zenith` | 天顶剑 | 11 | 4956 天顶剑（Zenith）<br>757 泰拉刃（TerraBlade）<br>675 真永夜刃（TrueNightsEdge）<br>273 永夜刃（NightsEdge）<br>121 火山（FieryGreatsword）<br>3507 铜短剑（CopperShortsword）<br>46 魔光剑（LightsBane）<br>795 血腥屠刀（BloodButcherer）<br>674 真断钢剑（TrueExcalibur）<br>190 草剑（BladeofGrass）<br>368 断钢剑（Excalibur） |
| `potions` | 药水 | 67 | 3544 超级治疗药水（SuperHealingPotion）<br>5496 丛林果汁（LifeFruitHealingPotion）<br>499 强效治疗药水（GreaterHealingPotion）<br>188 治疗药水（HealingPotion）<br>28 弱效治疗药水（LesserHealingPotion）<br>227 恢复药水（RestorationPotion）<br>2209 超级魔力药水（SuperManaPotion）<br>189 魔力药水（ManaPotion）<br>288 黑曜石皮药水（ObsidianSkinPotion）<br>289 再生药水（RegenerationPotion）<br>290 敏捷药水（SwiftnessPotion）<br>291 鱼鳃药水（GillsPotion）<br>292 铁皮药水（IronskinPotion）<br>293 魔力再生药水（ManaRegenerationPotion）<br>294 魔能药水（MagicPowerPotion）<br>295 羽落药水（FeatherfallPotion）<br>296 洞穴探险药水（SpelunkerPotion）<br>297 隐身药水（InvisibilityPotion）<br>298 光芒药水（ShinePotion）<br>299 夜猫子药水（NightOwlPotion）<br>300 战斗药水（BattlePotion）<br>301 荆棘药水（ThornsPotion）<br>302 水上漂药水（WaterWalkingPotion）<br>303 箭术药水（ArcheryPotion）<br>304 狩猎药水（HunterPotion）<br>305 重力药水（GravitationPotion）<br>353 麦芽酒（Ale）<br>1134 瓶装蜂蜜（BottledHoney）<br>2322 挖矿药水（MiningPotion）<br>2323 拾心药水（HeartreachPotion）<br>2324 镇静药水（CalmingPotion）<br>2325 建筑工药水（BuilderPotion）<br>2326 泰坦药水（TitanPotion）<br>2327 脚蹼药水（FlipperPotion）<br>2328 召唤药水（SummoningPotion）<br>2329 危险感药水（TrapsightPotion）<br>2344 弹药储备药水（AmmoReservationPotion）<br>2345 生命力药水（LifeforcePotion）<br>2346 耐力药水（EndurancePotion）<br>2347 暴怒药水（RagePotion）<br>2348 狱火药水（InfernoPotion）<br>2349 怒气药水（WrathPotion）<br>2351 传送药水（TeleportationPotion）<br>2352 爱情药水（LovePotion）<br>2353 臭味药水（StinkPotion）<br>2354 钓鱼药水（FishingPotion）<br>2355 声呐药水（SonarPotion）<br>2356 宝匣药水（CratePotion）<br>2359 保暖药水（WarmthPotion）<br>2756 变性药水（GenderChangePotion）<br>2997 虫洞药水（WormholePotion）<br>4477 弱效幸运药水（LuckPotionLesser）<br>4478 幸运药水（LuckPotion）<br>4479 强效幸运药水（LuckPotionGreater）<br>4870 返回药水（PotionOfReturn）<br>5211 生物群系视觉药水（BiomeSightPotion）<br>5573 火把神勋章（TorchGodPotion）<br>1340 毒液药剂（FlaskofVenom）<br>1353 诅咒焰药剂（FlaskofCursedFlames）<br>1354 烈火药剂（FlaskofFire）<br>1355 金药剂（FlaskofGold）<br>1356 灵液药剂（FlaskofIchor）<br>1357 纳米机器人药剂（FlaskofNanites）<br>1358 派对药剂（FlaskofParty）<br>1359 毒药剂（FlaskofPoison）<br>2350 回忆药水（RecallPotion）<br>126 瓶装水（BottledWater） |
| `boots` | 泰拉靴 | 9 | 5000 泰拉闪耀靴（TerrasparkBoots）<br>4038 熔火护身符（MoltenCharm）<br>907 黑曜石水上漂靴（ObsidianWaterWalkingBoots）<br>4004 黑曜石骷髅头玫瑰（ObsidianSkullRose）<br>1862 霜花靴（FrostsparkBoots）<br>193 黑曜石骷髅头（ObsidianSkull）<br>898 闪电靴（LightningBoots）<br>405 幽灵靴（SpectreBoots）<br>908 熔岩靴（LavaWaders） |
| `summon` | 召唤物 | 15 | 1133 憎恶之蜂（Abeemination）<br>3601 天界符（CelestialSigil）<br>5334 奥库瑞姆剃刀（MechdusaSummon）<br>1958 调皮礼物（NaughtyPresent）<br>560 史莱姆王冠（SlimeCrown）<br>556 机械蠕虫（MechanicalWorm）<br>544 机械魔眼（MechanicalEye）<br>557 机械骷髅头（MechanicalSkull）<br>361 哥布林战旗（GoblinBattleStandard）<br>1844 南瓜月勋章（PumpkinMoonMedallion）<br>70 蠕虫诱饵（WormFood）<br>1331 血腥脊椎（BloodySpine）<br>43 可疑眼球（SuspiciousLookingEye）<br>5120 鹿华（DeerThing）<br>2767 日耀碑牌（SolarTablet） |
| `stations` | 制作站 | 22 | 33 熔炉（Furnace）<br>363 锯木机（Sawmill）<br>2194 玻璃窑（GlassKiln）<br>966 篝火（Campfire）<br>36 工作台（WorkBench）<br>32 木桌（WoodenTable）<br>34 木椅（WoodenChair）<br>2827 木水槽（WoodenSink）<br>354 书架（Bookcase）<br>35 铁砧（IronAnvil）<br>716 铅砧（LeadAnvil）<br>332 织布机（Loom）<br>345 烹饪锅（CookingPot）<br>2172 重型组装机（HeavyWorkBench）<br>352 酒桶（Keg）<br>5008 茶壶（TeaKettle）<br>525 秘银砧（MythrilAnvil）<br>1220 山铜砧（OrichalcumAnvil）<br>5296 叶绿提炼机（ChlorophyteExtractinator）<br>524 精金熔炉（AdamantiteForge）<br>1221 钛金熔炉（TitaniumForge）<br>2193 血肉克隆台（FleshCloningVaat） |
| `gloves` | 手套 | 5 | 1343 烈火手套（FireGauntlet）<br>3992 狂战士手套（BerserkerGlove）<br>936 机械手套（MechanicalGlove）<br>897 强力手套（PowerGlove）<br>6182 邪恶之爪（WickedClaws） |
| `shields` | 护盾 | 13 | 1613 十字章护盾（AnkhShield）<br>1612 十字章护身符（AnkhCharm）<br>901 盔甲背带（ArmorBracing）<br>902 药用绷带（MedicatedBandage）<br>903 计划书（ThePlan）<br>904 反诅咒咒语（CountercurseMantra）<br>5354 反光墨镜（ReflectiveShades）<br>397 黑曜石护盾（ObsidianShield）<br>193 黑曜石骷髅头（ObsidianSkull）<br>3998 英雄护盾（HeroShield）<br>3997 冰冻护盾（FrozenShield）<br>6183 银盾（SilverShield）<br>6188 恢复之盾（RestorationShield） |
| `celestialShell` | 天界贝壳 | 3 | 3110 天界贝壳（CelestialShell）<br>1865 天界石（CelestialStone）<br>861 月亮贝壳（MoonShell） |
| `yoyo` | 悠悠球 | 6 | 5541 魔法悠悠球袋（MagicYoyoBag）<br>3366 悠悠球袋（YoyoBag）<br>5547 串接平衡锤（StrungCounterweight）<br>3306 白绳（WhiteString）<br>5540 魔法绳（MagicString）<br>3334 悠悠球手套（YoYoGlove） |
| `v145` | 1.4.5 | 10 | 6180 炽天使项链（SeraphNecklace）<br>6187 交错心形项链（CrossedHeartNecklace）<br>6189 秘术腰带（MysticArtsSash）<br>6166 鹰身女妖护符（HarpyCharm）（useOnly）<br>6167 碎裂之石（SnappingStone）<br>6165 淬毒刺（PoisonBarb）<br>6159 邪恶臂环（WickedArmlet）<br>6156 银护腕（SilverBracer）<br>6157 蛇形手环（SnakeBand）<br>156 钴护盾（CobaltShield） |

## 原配置的用途

每个大类 = 若干棵完整合成树（脑图）：成品在最左，材料逐层向右展开，节点带数量 / 制作站 / 环境条件，
树下方汇总基础材料与制作站；已被别的树包含的物品不单独占方块。建树与反向（拆解）配方过滤逻辑在
已删除的 `web/src/lib/craftTree.ts` 中，历史设计见 [`页面-物品图鉴.md`](页面-物品图鉴.md) §22–§25。

