# PCL2 (Plain Craft Launcher 2) 逆向分析

**目标**：`<PCL2 安装位置>/Plain Craft Launcher 2.1.exe`
**真实身份**：`Plain Craft Launcher 2` 版本 **2.13.1.1**（文件名只保留到 2.1，与实际版本号不一致）
**SHA-256**：`109f1208504299a11a7aadc5ac78307467d8be1e73dd33bd00d4789afce6b1e1`
**技术栈**：**WPF + VB.NET**（.NET Framework 4.0，IL-only，anycpu）
**规模**：5.5 MB 单文件；**643 个类型、6,116 个方法、3,503 个字段**

> **可复现性说明（关于 SHA-256）**：以上哈希锁定的是本文分析时的文件。
> PCL2 **自带更新机制**——我们写这份手册期间，安装目录里的文件已被它自己更新过
> （文件路径不变，但内容变成了新版：类型数、字符串数都会随之变化）。
> 如果你现在拿本机文件复跑本文的命令，数字对不上是正常的。
> 想精确复现：先按 SHA-256 确认文件，或接受"版本漂移"并在结论里注明你实际分析的版本。
> 这也是分析**任何自更新软件**时都适用的提醒：**在开始前记录哈希**。

> **引用说明**：本报告中的代码片段是在分析过程中**整理/重写的示意**，用于说明设计思想，
> 版权归原作者。报告基于合法获取的本机安装副本做**静态分析**
> （不加载、不执行目标程序，未绕过任何技术保护措施）。
>
> **报告不包含**：可用于规避授权/付费机制的操作细节、密钥或凭据、个人隐私信息。
> 就本对象而言，也就是不涉及账号登录与捐赠回馈机制的实现细节。

分析方法：REA 的 .NET 静态分析（`inspect-managed-*`）+ 自写的 PE/CLI 元数据解析器 +
`#US` 字符串堆解析。全过程**不加载、不执行**目标程序。

---

## 0. 一句话总结

PCL2 是一个**把"启动游戏"这件事做到工业化程度**的启动器：自研 WPF 控件库、6 种 Mod 加载器的统一抽象、
64 线程分片下载、版本继承合并、崩溃自动诊断、以及一个**从远程 URL 加载 XAML 当主页**的扩展系统。
它的代码组织方式是"大模块 + 中心化全局状态"，和现代模块化设计相反，但极其有效。

---

## 1. 程序集与依赖画像

```
自身: Plain Craft Launcher 2  2.13.1.1
引用 (23 个):
  mscorlib, PresentationFramework, PresentationCore, System.Xaml, WindowsBase   ← WPF
  Microsoft.VisualBasic, System, System.Core, System.Drawing, System.Windows.Forms  ← VB.NET + 混用 WinForms
  Newtonsoft.Json          ← 版本 JSON 解析
  MeloongCore, MeloongCore.Wpf   ← 作者的通用 .NET 库（PCL 仓库的 submodule，自身仓库用 Apache-2.0；
                                 ← 注意 PCL 主仓不是 Apache-2.0，它用《PCL 分发有限许可》）
  PCLCS                    ← 自家 C# 辅助库（VB 主工程 + C# 工具库）
  System.IO.Compression    ← zip 处理
  NAudio                   ← 音频（音乐播放/BGM）
  System.Net.Http, System.Xml.Linq
  CacheCow.Client.FileStore / .Client / .Common   ← HTTP 磁盘缓存
  ThrottleDebounce         ← 节流防抖
  Imazen.WebP              ← WebP 图片解码（UI 用 WebP 省体积）
```

**P/Invoke 只有 8 个系统 DLL**：`user32, shell32, ole32, ntdll, advapi32, kernel32`。
**没有 winhttp/wininet/ws2_32** —— 网络全部走 .NET 托管栈。

> 这说明它的原生依赖几乎为零，是纯托管应用。可移植性和审计友好度都高。

---

## 2. 模块化的全局状态：`ModBase` / `ModMain`

PCL2 不用 DI 容器，而是**一组静态模块类**，每个管一块：

| 类 | 方法 | 字段 | 职责 |
| --- | --- | --- | --- |
| `ModBase` | 47 | 26 | 通用工具：INI 读写、线程调度、进程启动、搜索 |
| `ModMain` | 26 | 61 | 全局状态：所有窗体的引用、定时器、拖拽控制 |
| `ModNet` | 19 | 8 | 网络层 |
| `ModDownload` | 40 | 24 | 下载任务编排 |
| `ModDownloadLib` | 54 | 5 | 下载库：各加载器的具体实现 |
| `ModLaunch` | 42 | 14 | 启动编排 |
| `ModMinecraft` | 34 | 12 | MC 专有启动逻辑 |
| `ModJava` | 13 | 4 | Java 检测/管理 |
| `ModAnimation` | 36 | 9 | 动画引擎 |
| `ModSecret` | 22 | 42 | （见 §12.4） |
| `ModLoader` | 6 | 4 | 模块加载 |
| `ModWatcher` | 4 | 3 | 进程监视 |
| `ModValidate` | 1 | 0 | 校验 |
| `ModModpack` | 12 | 0 | 整合包 |
| `ModMusic` | 12 | 4 | 音乐 |

### 关键设计：所有窗体预先实例化并集中持有

`ModMain` 的 61 个字段里，**41 个是窗体引用**：

```vb
FrmMain, FrmStart, FrmLaunchLeft, FrmLaunchRight, FrmSelectLeft, FrmSelectRight,
FrmSpeedLeft, FrmSpeedRight, FrmLinkMain, FrmDownloadLeft, FrmDownloadInstall,
FrmDownloadMod, FrmDownloadPack, FrmDownloadDataPack, FrmDownloadShader,
FrmDownloadResourcePack, FrmSetupLeft, FrmSetupLaunch, FrmSetupUI, FrmSetupSystem,
FrmSetupLink, FrmOtherLeft, FrmOtherHelp, FrmOtherAbout, FrmOtherTest,
FrmLoginLegacy, FrmLoginNide, FrmLoginNideSkin, FrmLoginAuth, FrmLoginAuthSkin,
FrmLoginMs, FrmLoginMsSkin, FrmInstanceLeft, FrmInstanceOverall, FrmInstanceMod,
FrmInstanceModDisabled, FrmInstanceSetup, FrmInstanceExport, FrmDownloadResourceDetail
```

命名规律是 **`Frm<区域><Left|Right>`**（左右双栏布局）或 **`Frm<功能>`**。
这些窗体是**预创建、常驻内存**的，切换页面 = 显示/隐藏 + 换内容，不是销毁重建。

> **代价**：启动时全部构造，内存占用高。**收益**：页面切换极快，且状态天然保持
> （因为对象一直在）。这是"桌面应用"思维，和移动端的"按需创建/销毁"完全相反。

### 持久化：INI 文件，不是 JSON/数据库

```vb
IniGetContent(path) -> ConcurrentDictionary(Of String, String)   ' Private
ReadIni(path, key, Optional defaultValue) -> String
WriteIni(path, key, value)                                       ' value 为 Nothing 时删除该键
HasIniKey / DeleteIniKey / IniClearCache
```

**INI 是扁平的单层 `键:值`，没有节（section）的概念**——`IniGetContent` 直接按第一个冒号切分，
`WriteIni` 遇到键名含冒号还会抛异常。所以 PCL2 的配置不存在 `[Section]` 分组，
这也是它"文件小、可手改"的一部分原因。

**所有配置走 INI 文本**，且有一层内存缓存（`IniCache`）。这解释了为什么 PCL2 的配置文件
人类可读、可手工编辑、可版本对比——对"用户自己折腾"的场景是正确选择。

### 线程模型

```vb
RunInUi(action)                     ' 调度到 UI 线程
RunInUiWait(action)                 ' 调度并等待
RunInThread(action)                 ' 后台线程
RunInNewThread(action, name, prio)  ' 新线程 + 命名
GetResultWithTimeout(task, ..., ms) ' 带超时的等待
```

配套护栏（从字符串证据）：
```
"McLaunchStart 必须在 UI 线程调用！"
"在 UI 线程执行了网络请求"        ← 明确的违规检测
"由于代码在主线程运行，将不再进行重试"
```

> **它把线程纪律写成了运行时可检测的断言**，而不是靠约定。这是很成熟的做法。

---

## 3. 多版本管理：继承 + 隔离

### 3.1 版本继承：两处实现，各司其职

**先澄清一个容易混淆的点**：PCL2 里有两个"合并"：
- **`ModDownloadLib.MergeJson`** —— **安装时**用（把原版 + 各加载器的 JSON 合成磁盘上的版本定义）
- **`McInstance.get_JsonObject`** —— **运行时**用（惰性合并，供启动游戏时读取）

两者目的不同。这里讲的是**运行时的那个**，因为它是每次启动都会走的路径。

#### 运行时继承合并（`ModMinecraft.vb:420-495`）

> 同样转写成 C# 便于阅读；源码是 VB.NET。

核心是**惰性合并（merge-on-access）**：磁盘上**不物化合并结果**，
每次访问 `JsonObject` 时在内存里合并一次。

```csharp
// 1. HMCL 格式的特殊处理（含 patches 数组且无 time）
if (有 patches && 无 time) {
    _JsonObject["patches"] 按 priority 排序 → 逐个 Merge   // "合并 HMCL 分支项：{0}"
    _JsonObject["id"] = Name;                        // 注入 id
    _JsonObject.Remove("inheritsFrom");              // 清继承标记
}

// 2. 官方 inheritsFrom 的循环处理
object inherit = _JsonObject["inheritsFrom"]?.ToString() ?? "";
if (inherit == Name) {                               // 自引用检测
    Logger.Warn($"自引用的继承版本：{Name}");
    inherit = "";                                    // 静默忽略，不抛异常
}
else {
    while (inherit != "") {                          // ★ 遍历整条继承链
        McInstance parent = new McInstance(inherit);

        // 嵌套检测（父的父 == 父自己 → 死循环）
        if (parent.InheritName == inherit)
            throw new Exception($"版本依赖项出现嵌套：{inherit}");

        inherit = parent.InheritName;

        // ★ 关键手法：父库前置拼接
        JArray merged = (JArray)_JsonObject["libraries"].DeepClone();  // ① 拷贝子库
        foreach (var lib in parent.JsonObject["libraries"])
            merged.Add(lib);                                          // ② 追加父库
        parent.JsonObject.Merge(_JsonObject);                         // ③ 子覆盖父
        _JsonObject = parent.JsonObject;
        _JsonObject["libraries"] = merged;                            // ④ 恢复拼接结果
    }
}

// 3. 合并失败只 Warn，不中断
catch (Exception ex) {
    Logger.Warn(ex, $"合并版本依赖项 JSON 失败（{obj ?? "null"}）");
}
```

#### 三个值得学的细节

**① 父库前置拼接（第 ③④ 步）**

`JContainer.Merge` 是"后者覆盖前者"（子覆盖父，这是对的——
子版本的 `mainClass`、`id` 应该赢）。但 **`libraries` 不能被覆盖**，
因为子版本只需要列出**自己新增的库**，父版本的库必须保留。

所以做法是：
1. 先把**子库拷一份**
2. 把**父库追加**到后面
3. 让 `Merge` 正常跑（此时 `libraries` 字段被子版本覆盖了——但没关系）
4. **最后把拼接好的数组塞回去**

**为什么父库在前**：classpath 顺序决定类加载优先级——
父版本的库在前，子版本同名的库在后，**后者会覆盖前者**。
这是有意为之的版本覆盖语义。

**② 自引用 vs 嵌套：两种循环，两种处理**
```csharp
inheritsFrom == Name        → Warn + 静默忽略（不致命，继续用未合并的 JSON）
parent.InheritName == chain → throw（致命，因为无法确定终止）
```

**区别对待的理由**：自引用是"这个版本声称继承自己"——
可能只是写错了，忽略后退化成"不继承"，游戏大概率还能跑。
而嵌套死循环会让 `while` 永不结束——必须中断。

**③ 合并失败只 Warn**

整个合并包在 `try/catch` 里，失败只记 Warn 并**保留未合并的 JSON**。
这意味着：**即使继承链有问题，PCL2 也会尝试启动游戏**（可能失败，但至少试了），
而不是在合并阶段就放弃。

对比：`MergeJson`（安装时）遇错是**抛异常**的，因为安装时出错应该停下来。
**同一个问题在两个场景下的处理策略不同——这是成熟的表现。**

#### 版本号的识别：极度容错

`McInstance.get_Version`（1,626 字节 IL）用**一条优先级链**从各种格式里提取原版号：

```
releaseTime → "type"=="pending" → "clientVersion"
→ "patches"[id="game"].version        （HMCL 格式）
→ arguments.game 正则
→ Forge:  --fml.mcVersion / libraries 里 (?<=net.minecraftforge:forge:)[0-9]{1,2}\.[0-9+.]+
→ OptiFine: (?<=optifine:OptiFine:)
→ Fabric:   (?<=((fabricmc)|(quiltmc)):intermediary:)
→ jar 内嵌 version.json
```

**每一步都是"上一个失败了才试下一个"**。这解释了为什么 PCL2 能识别
各种第三方启动器装的版本——它不假设版本 JSON 是标准格式。

#### 版本比较：Drop 序数系统

字符串比版本号是灾难（`1.10 < 1.9`？`15w14a` 怎么比？）。
PCL2 的解法是**映射成整数序数**（内部叫 "Drop"）：

```csharp
McVersion.Drop()          // 得到可比较的 int
VersionToDrop(string)     // "1.20.1" → int
DropToVersion(int)        // 反向
NameToVersion(string)     // 特殊别名映射
```

**别名的硬编码表**（`NameToVersion`）：
```
"2.0"                → 1.5.1
"15w14a"             → 1.8.3        ← 愚人节版本
"oneblockatatime"    → 1.18.2
"24w14potato"        → 1.20.4
"25w14craftmine"     → 1.21.4
"26w14a"             → 26.1.1
```

以及两条正则分支处理新旧版本号格式：
```
^1\.\d    → 1.x 系列
^[2-9]\d\. → 2x.x 系列（Minecraft 在 2026 年改成了新的版本号方案）
```

**无法识别时返回 `Version(9999,0,0)` 哨兵**——排在所有已知版本之后，
而不是抛异常或返回 0（返回 0 会让它排到最前面，明显错误）。

**这个设计的价值**：一次转换，之后所有比较都是整数比较。
排序、筛选、"这个版本比那个新吗"全都变成 `<` / `>`。


### 3.2 版本隔离：一个带三重兜底判定的决策系统

**先纠正一个常见误读**（也是我最初的误读）：隔离**不是"三态"，也不是简单的开关**。
它是**"全局五档默认策略 + 实例级显式覆盖"**的组合，
而且**首次判定时有三重兜底**。

#### 精确的判定逻辑（源码级，`ModMinecraft.vb:240-282`）

> 源码是 VB.NET，下面转写成 C# 便于阅读；逻辑与源码逐行对应。

```csharp
public string PathIndie {
    get {
        if (!Settings.HasSaved("VersionArgumentIndieV2", this)) {
            if (!IsLoaded) Load();
            // ── 三重兜底，按顺序尝试 ──
            // ① 从旧版设置迁移
            if (Settings.HasSaved("VersionArgumentIndie", this)
                && Settings.Get<int>("VersionArgumentIndie", this) > 0) {
                Logger.Info($"版本隔离初始化（{Name}）：从老的版本独立设置中迁移");
                return Settings.Get<int>("VersionArgumentIndie", this) == 1;
            }
            // ② 从已有文件布局推断
            DirectoryInfo mods  = DirectoryUtils.GetInfo(PathVersion + "mods\\");
            DirectoryInfo saves = DirectoryUtils.GetInfo(PathVersion + "saves\\");
            if ((mods.Exists && mods.EnumerateFiles().Any())
             || (saves.Exists && saves.EnumerateDirectories().Any())) {
                Logger.Info($"版本隔离初始化（{Name}）：版本文件夹下存在 mods 或 saves 文件夹，自动开启");
                return true;
            }
            // ③ 按全局默认策略（五档）
            bool isRelease = State != Fool && State != Old && State != Snapshot;
            Logger.Info($"版本隔离初始化（{Name}）：从全局默认设置中（{Settings.Get<int>("LaunchArgumentIndieV2")}）判断，"
                      + $"State {State}，IsRelease {isRelease}，Modable {Modable}");
            return Settings.Get<int>("LaunchArgumentIndieV2") switch {
                0 => false,                    // 关闭
                1 => Modable,                  // 隔离可安装 Mod 的版本
                2 => !isRelease,               // 隔离非正式版
                3 => !isRelease || Modable,    // 隔离可安装 Mod 的版本，或非正式版
                _ => true,                     // 隔离所有版本
            };
        }
        // 已显式保存过 → 直接用
        if (!Settings.Get<bool>("VersionArgumentIndieV2", this))
            return McFolderSelected;    // ★ 不隔离 → 返回 .minecraft 根
        return PathVersion;             // ★ 隔离 → 返回版本目录
    }
}
```

**判定结果只用于一件事**：决定**工作目录**指向哪里。
- 隔离 → `PathVersion`（`versions\<版本名>\`）
- 不隔离 → `McFolderSelected`（`.minecraft` 根，全版本共享）

#### 三重兜底的设计价值

| 顺序 | 依据 | 解决的问题 |
| --- | --- | --- |
| ① | 旧版设置 | **升级不丢配置**（老用户的偏好被尊重） |
| ② | 已有 `mods/` `saves/` 目录 | **从文件布局反推意图**——用户既然在这里放了 mod，说明他期望隔离 |
| ③ | 全局五档策略 | **新用户的合理默认**（按版本类型和是否可装 mod 区分） |

**第 ② 条是最巧的**：它不问用户，直接观察用户已经做的选择。
如果用户手动往 `versions/1.20.1/mods/` 放了 mod，那他要的就是隔离——
PCL2 直接照做，**并且把判定结果持久化**（`Settings.Set("VersionArgumentIndieV2", ...)`），
所以这个推断**只发生一次**，之后就是显式值。

#### 全局五档的语义（`LaunchArgumentIndieV2`）

```
0  关闭
1  隔离可安装 Mod 的版本        → Modable
2  隔离非正式版                 → !isRelease（非 release 类型）
3  隔离可安装 Mod 的版本，或非正式版  → !isRelease || Modable
4  隔离所有版本                 → true（默认）
```

注意 **`3` 是"或"（`||`）不是"与"**——即**满足任一条件就隔离**，
比 `2` 和 `1` 都更激进。

`Modable` 的判定（`ModMinecraft.vb`，转写成 C#）：
```csharp
public bool Modable => HasFabric || HasForgelike || HasLiteLoader || DisplayType;
```
即"装了某种 Mod 加载器"或"用户手动标记为可装 mod"。

#### 隔离的运行时消费点

`PathIndie` 一旦确定，**一处决定、多处生效**：

```
进程工作目录:   ProcessStartInfo.WorkingDirectory = PathIndie      (ModLaunch.McLaunchRun)
参数替换:       ${game_directory} ← PathIndie
存档/Mod 按钮:  OpenExplorer(PathIndie + "saves\") / ("mods\")     (PageInstanceOverall)
Mod 列表监视:   LoaderFolderRun(LocalResourceLoader, PathIndie + "mods\")
删除实例:       扫描 PathIndie + "saves\" 并提示"这会删除以下存档：…"
```

#### 变更隔离时的处理：**不自动迁移，只告知**

```csharp
// PageInstanceSetup.ComboArgumentIndieV2_SelectionChanged
选择变化 → 弹警告：
  "调整版本隔离设置后，你需要游戏存档、Mod 等文件手动迁移到新的游戏文件夹中…"
按钮: [我知道我在做什么] / [取消]
取消 → 回滚 SelectedIndex
确认 → Settings.Set("VersionArgumentIndieV2", SelectedIndex, instance)
```

**这个决定值得注意**：PCL2 有能力自动搬迁（它有全套文件操作工具），
但它选择**让用户自己搬**。理由应该是：
- 自动搬迁有风险（大目录、可能失败、可能覆盖）
- 用户手动搬能看见到底发生了什么
- 隔离变更不频繁，手动成本可接受

**"诚实告知代价"** 的一贯做法（呼应 §3.2 末尾和 §13.2 第 9 条）。

#### 目录布局（完整）

```
<McFolder>.minecraft\
├── versions\<版本名>\
│   ├── <版本名>.json          ← 官方版本身份文件
│   ├── <版本名>.jar
│   ├── PCL\config.json        ← 实例级配置（MeloongCore.JsonConfigProvider）
│   ├── PCL\Setup.ini          ← ★ 实例独立设置（隔离的核心）
│   ├── mods\  saves\  screenshots\    ← 隔离开启时是"私有"的
│   └── <版本名>-natives\      ← natives 解压首选位置（三段回退的第 1 段）
├── libraries\                 ← 全版本共享（Maven 三段式布局）
├── assets\                    ← 全版本共享
├── versions\                  ← 隔离关闭时，工作目录指向这里（?!）
└── .pclignore                 ← 目录级忽略清单
```

**注意 `PCL\Setup.ini`**：这是**实例独立设置的载体**。
`Settings` 的 `Sources` 枚举有三个值：

```csharp
enum Sources { Normal = 0, Registry = 1, Instance = 2 }

// Normal   → PCL.ini 的 [Setup] 段（全局）
// Registry → HKCU\Software\PCL（解锁档、加密项）
// Instance → <版本目录>\PCL\Setup.ini（★ 每个实例独立）
```

所有 `Version*` 前缀的设置键（`VersionArgumentIndieV2`、`VersionArgumentJavaV2`、
`VersionRamType`、`VersionAdvanceAssets/Jvm/GC/Run`、`VersionServerLogin` …）
全部注册为 `Sources.Instance`；对应的 `Launch*` 前缀是全局默认。

**这解释了"实例隔离"的实现机制**：
不是运行时判断"该读哪个配置"，而是**配置本身就存在不同位置**——
读实例配置时直接读 `<版本目录>\PCL\Setup.ini`。

**UI 与配置同构**（`SettingService` 的附加属性）：
```xml
<PCL:MyComboBox PCL:SettingService.Key="VersionArgumentTitle" />
```
XAML 里直接写设置键，控件就自动变成"实例独立设置控件"。
**这是"一个 key 决定全局还是实例"的优雅实现**。


### 3.3 版本目录命名规则

`McInstallLoader` 的字符串暴露了命名模板：

```
"versions\forge-"        → versions/forge-<版本>
"versions\neoforge-"     → versions/neoforge-<版本>
"versions\fabric-loader-"→ versions/fabric-loader-<版本>
"-LiteLoader"            → ...-LiteLoader
"-OptiFine_" / "_HD_U_" / "HD_U_" / "preview_" / "pre"   ← OptiFine 版本号规范化
```

以及**版本号脏值清洗**（`McUpdateLogShow` 里的映射表）：
```
"combat test 7c"  → "1.16_combat-3"
"combat test 8b"  → "1.16_combat-5"
"3d shareware v1.34" → "3D_Shareware_v1.34"
"1.19_deep_dark_experimental_snapshot-" → "1_19_deep_dark_experimental_snapshot-"
"release" / "snapshot" / "special"  ← 发布类型分类
"Java版" / " Pre-Release " / "-pre" / "b" / "Beta_"  ← 显示名拼装
```
> 把非标准版本号（愚人节版本、Combat Test、快照）映射成合法的文件夹名/显示名。

---

## 4. 下载系统

### 4.1 原版下载流水线（`McDownloadClientLoader`）

字符串常量就是**逐步的执行日志**，顺序即是流程：

```
1. 获取原版 json 文件下载地址
2. 下载原版 json 文件
3. 读取 json 文件
4. 分析原版支持库文件（副加载器）      ← "副加载器" = 子任务/二级加载器
5. 下载原版支持库文件（副加载器）
6. 下载原版支持库文件
7. 分析资源文件索引地址（副加载器）
8. 下载资源文件索引（副加载器）
9. 分析所需资源文件（副加载器）
10. 下载资源文件（副加载器）
11. 下载原版资源文件
```

**关键设计**：**"分析"与"下载"分离**。先把要下什么算清楚（读 JSON、展开依赖、
解析 asset index），再统一下载。这样能：
- 提前知道总大小 → 准确的进度条
- 合并去重 → 多个版本共享的 library 只下一次
- 分阶段重试 → 分析失败和下载失败区别对待

### 4.2 加载器安装（`McInstallLoader`，923 条 CIL）

```
"下载 Fabric API" / "下载 OptiFabric"        ← 依赖的附加组件
"下载原版 {0}" / "下载 OptiFine {0}" / "下载 Forge {0}" / "下载 NeoForge {0}"
"下载 LiteLoader {0}" / "下载 Fabric {0}"
"安装游戏"
"分析游戏支持库文件（副加载器）"
"下载游戏支持库文件（副加载器）"
"下载游戏支持库文件"
"OptiFine 将作为 Mod 进行下载"              ← 特殊处理：OptiFine 在 1.13+ 是 mod 形态
"版本 {0}{1}.json 已经存在！" + "添加忽略标识" / "删除忽略标识"   ← 幂等重装
"对应的原版版本：{0}"
"缓存：OptiFine 缓存：{0} / Forge 缓存：{0} / ..."                ← 每种加载器独立缓存
```

**"添加忽略标识/删除忽略标识"**是个细节：重装时先标记"忽略该版本"，
装完再解除，避免安装过程中被自己的版本扫描逻辑错误处理。

### 4.3 并发模型：双层并行 + 双调度器 + 显式节流

**先说结论**：这不是"开 64 个线程下载"那么简单。
它是**"文件级并行 × 文件内分片并行"**的两层结构，
配**两个工作窃取调度器**，还有**对镜像源的主动限流**。

（以下全部是 CIL 级确证——从方法体的指令和常量表提取。）

#### 4.3.1 两个调度器，按 `State % 2` 分工

`NetManagerClass.StartManager` 启动 **3 个常驻线程**：

```
"NetManager ThreadStarter 0"    ← 调度器 A
"NetManager ThreadStarter 1"    ← 调度器 B
"NetManager StatRefresher"      ← 统计刷新（250ms 级）
```

两个调度器各自循环（**每 20ms** 一轮），分工方式是：

```csharp
// 遍历所有待下载文件，按状态奇偶分给两个调度器
foreach (file in AllFiles) {
    if (file.State % 2 == arg)        // arg = 0 或 1（调度器编号）
        // 调度器 0 处理 State 为偶数的，调度器 1 处理奇数的
}
```

**为什么这么分**：避免两个调度器抢同一个文件。
`State` 是 `WaitingToDownload=0 / Connecting=1 / Reading=2 / Downloading=3`，
所以调度器 0 主要管"还没开始的"，调度器 1 主要管"正在跑的"。
**这是个轻量的分工，不需要锁。**

#### 4.3.2 分片数学：切走 40%

`NetFile.TryBeginThread` 的核心算法：

```csharp
// 1. 找出当前"剩余未下载量最多"的那个分片线程 T
// 2. 要求 T.DownloadUndone >= 262144   (FilePieceLimit = 256 KiB)
// 3. 新分片起点 = Round(T.DownloadEnd - T.DownloadUndone * 0.4)
//    ↑ 从 60% 位置切开：切走该片剩余量的 40%
// 4. 插入链表：T.NextThread = 新线程;  新线程.NextThread = 旧T.NextThread

// 分片用单向链表组织，每片记录：
//   DownloadStart（Range 起点）
//   DownloadDone （本片已收字节数）
//   get_DownloadEnd() = 下一片起点 - 1（或 FileSize - 1 如果是最后一片）
```

**为什么是 40% 而不是对半切**：切得太碎会让请求数暴涨（每个请求有握手开销），
切得太少则无法利用多连接的带宽。40% 是个经验值——
它让每片在被再次切分前至少还能跑一会儿。

**注意这个设计的效果**：分片是**动态的**，不是"启动时把文件平均切成 N 份"。
随着下载进行，**剩余最多的片会被继续切**——
所以慢的连接会被逐渐"卸载"，快的连接承担更多。
**这是自适应负载均衡，不是静态分配。**

#### 4.3.3 三类文件强制单线程

```csharp
get_IsNoSplit => IsUnknownSize || FileSize < 1048576;    // 小于 1 MiB 单线程

// 另外这些源的任何文件都强制单线程（URL 前缀匹配）：
"pcl2-server"     // PCL 自建服务器
"meloong.com"     // 作者自有域名
"bmclapi"         // ★ 镜像源
"github.com"      // GitHub（CDN 对 Range 支持不稳）
"optifine.net"
"momot.rs"
```

**`bmclapi` 被强制单线程**是个重要的自我约束——
BMCLAPI 是国内公益镜像（bangbang93 个人维护），
**PCL2 主动不对它做并发分片**，避免把镜像站打垮。

而且调度器里还有第二层节流（见下）。

#### 4.3.4 对镜像源的主动限流（关键细节）

```csharp
// _Lambda$__9-0 调度循环里，每次要开新线程时：
t = file.TryBeginThread();
if (t != null && t.Source.Url.Contains("bmclapi"))
    Thread.Sleep(100);      // ★ 每条新线程睡 100ms
```

**效果**：从镜像源开线程的速率被限制在**每秒 10 条**。
官方源没有这个限制。

**这是一个"懂事"的设计**：镜像站是公益的、带宽有限的，
PCL2 以它的用户量级并发拉取，全速会给镜像站造成明显压力——
所以它**主动给自己限速**，而不是"能跑多快跑多快"。

**这个细节值得国内工具开发者学习**：用别人的公益基础设施时，
把限流做在客户端（且默认开启），比等服务端封禁要好。

#### 4.3.5 全局线程上限与配置

```
默认线程上限:  64   (滑条 Value=63，代码里 +1)
范围:          1~256 (滑条 Max=255，同样 +1)
```

```csharp
get_NetTaskThreadLimit() => Settings.Get("ToolDownloadThread") + 1;

// UI 层还有保护
SliderDownloadThread_PreviewChange:
    if (Value >= 100 && !已提示过) 弹出警告
```

ToolTip 原文：
```
"线程数越多限速的文件下载越快…一般而言 64 线程已可以保证足够的下载速度"
"如果设置过多的下载线程，可能会导致下载时出现非常严重的卡顿。"
```

**计数是全局共享的**（静态 `ModNet.NetTaskThreadCount`，
用 `Interlocked.Increment/Decrement`）——**不是每文件 64 条**，
而是**所有文件加起来 64 条**。

#### 4.3.6 分片补位策略

调度器对"正在下载"的文件还有一轮补位逻辑：

```csharp
foreach (file in listB) {          // listB = State ∈ {Connecting, Downloading}
    int busy = file.Threads.Count(t => t.State < 3);   // 还在跑的
    int done = file.Threads.Count(t => t.State == 3);  // 已完成的
    if (busy <= done)              // ★ 完成的不比在跑的少 → 该补新片了
        file.TryBeginThread();
}
```

**这个条件 `busy <= done` 很巧妙**：
当完成数追平或超过在跑数时，说明并发度在下降，应该补新片。
如果没有这个逻辑，一个文件的分片会逐渐跑完然后变成单线程——
而实际上可能还有大量剩余。

#### 4.3.7 限速：分挡公式 + 令牌桶 + 自适应

**设置分挡**（`get_NetTaskSpeedLimitHigh`，滑条值 `v`）：

```
v <= 14        →  (v+1) × 0.1 MB/s        (0.1 ~ 1.5 MB/s)
15 <= v <= 31  →  (v-11) × 0.5 MB/s       (2.0 ~ 10 MB/s)
32 <= v <= 41  →  (v-21) × 1.0 MB/s       (11 ~ 20 MB/s)
v > 41         →  -1（不限速）
```

**三段的步进是 0.1 / 0.5 / 1.0 MB/s**——低速时给精细控制，
高速时给粗粒度（因为高速区间里 0.1MB/s 的差别没意义）。

**令牌桶实现**：

```csharp
NetTaskSpeedLimitLeft          // 全局剩余额度（初始 -1 = 不限速）
// 读循环每 16ms 检查：额度不足 → Sleep(16) 等待
// 每次实际读取 min(读到的字节, 片剩余) 从额度扣减
// StatRefresher 线程每 100ms 注入 High/10（即每秒恢复 10% 额度）
```

**自适应下限提升**（`RefreshStat`）：

```csharp
// 当 SpeedLast 窗口 ≥10 个样本时
avg = 最近 10 个样本的均值
candidate = avg × 0.85
if (candidate > NetTaskSpeedLimitLow) {
    NetTaskSpeedLimitLow = candidate;
    Log("速度下限已提升到 {0}");
}
```

`NetTaskSpeedLimitLow` 初始 `262144`（256 KB/s），
并作为**调度循环的退出阈值**（速度低于它时不再补新片）。
**这个"下限自动提升"的意义**：如果实测能跑到 5MB/s，
就把"够用"的标准提到 4.25MB/s，避免调度器在低效状态下空转。

**带宽统计**：每 100ms 一个样本，`SpeedLast` 列表上限 31 项，
加权平均（**新样本权重递增**，1..n）。

#### 4.3.8 完整的状态机

```csharp
enum NetState {
    WaitingToCheck    = -1,   // 等待校验
    WaitingToDownload =  0,   // 等待下载
    Connecting        =  1,   // 建立连接
    Reading           =  2,   // 读响应头
    Downloading       =  3,   // 传输中
    Merging           =  4,   // 合并分片
    Finished          =  5,
    Canceled          =  6,
}
```

**进度映射**（`NetFile.get_Progress`，按状态返回固定权重）：

```csharp
-1 → 0.00        等待校验
 0 → 0.01        等待下载
 1 → 0.02        连接中
 2 → 0.04        读响应
 3 → 1 - (1-x)^0.9   然后 × 0.93 + 0.05   ← ★ 收敛式映射
 4 → 0.99        合并中
 5/6 → 1.00
```

**`1 - (1-x)^0.9` 这个映射值得注意**：它让进度条在**开始时涨得快、接近完成时变慢**。
（因为 `x<1` 时 `(1-x)^0.9 > (1-x)`，所以 `1-(1-x)^0.9 < x`——
实际是**前段显示得比真实进度慢**，这样不会出现"卡在 99%"。）

有个**很小的细节**：复用文件（`IsCopy`）在进度中**只算 0.2 权重**。
因为它是本地拷贝，几乎瞬间完成，不该让它把进度条瞬间拉满。


### 4.4 镜像源体系：三种策略 + 自动探测

**先说结论**：这不是"配一个镜像地址"那么简单。它有**三个独立的源设置**、
**三种不同的重写策略**、还有一个**基于实测延迟的自动切换**。

#### 4.4.1 三个独立的源设置（用户可分别配置）

```
"文件下载源"      ComboDownloadSource    → 影响 client jar / libraries / assets
"版本列表源"      ComboDownloadVersion   → 影响 version_manifest.json
"社区资源源"      ComboDownloadMod       → 影响 Modrinth / CurseForge
```

每个都是三档（**默认选中第一档**）：

```
档位 0:  尽量使用镜像源          ← 默认
档位 1:  优先使用官方源，加载缓慢时换镜像
档位 2:  尽量使用官方源
```

**为什么分成三个**：这三类资源的失败特征不同。版本列表是个小 JSON
（镜像同步可能滞后，提示"可能缺少刚刚更新的版本"）；
而 jar/libraries 是大文件（镜像能显著提速）。
**分开配置让用户能按需取舍。**

#### 4.4.2 自动探测：实测延迟决定优先级

```csharp
// DlClientListMojangMain：请求官方 version_manifest.json 并计时
耗时 = 请求 https://launchermeta.mojang.com/mc/game/version_manifest.json
if (耗时 < 4000ms)  DlPreferMojang = true;
Log("Mojang 官方源加载耗时：{0}ms，可优先使用官方源/不优先使用官方源");
```

然后 `DlSourceOrder(official, mirror)`（CIL 确证，用 `Enumerable.Union`）：

```csharp
return preferMojang ? official.Union(mirror)     // 官方优先
                    : mirror.Union(official);    // 镜像优先
```

**返回的是一个有序的 URL 序列**——不是"选一个"，
而是**"按优先级排好的候选列表"**（`Union` 会去重）。
这份列表交给 `NetFile` 作为多源，逐源失败禁用、跨源自动重试（§4.5）。

**这个设计的价值**：网络状况是动态的。
今天官方快就用官方，明天官方被墙就自动用镜像，**用户不用改设置**。

**注意档位 0 的特殊性**：它跳过探测，**永远 `preferMojang = false`**。
即"尽量使用镜像源"是**无条件的**（不给官方任何优先机会）——
这是给"官方源基本不可达"的用户准备的。

#### 4.4.3 三种重写策略（按资源类型分流）

**① Assets：前缀替换**

```csharp
// 先把 http 升级为 https
"http://resources.download.minecraft.net" → "https://resources.download.minecraft.net"
// 镜像：三条前缀替换，全部指向 /assets
"piston-data.mojang.com"              → "https://bmclapi2.bangbang93.com/assets"
"piston-meta.mojang.com"              → "https://bmclapi2.bangbang93.com/assets"
"resources.download.minecraft.net"    → "https://bmclapi2.bangbang93.com/assets"
```

**② Libraries：按来源分两种变体**（最复杂的一处）

```csharp
if (URL 含 "minecraftforge" || "fabricmc" || "neoforged") {
    // 三方 maven：生成两个候选变体
    变体A = 替换 "piston-data"/"piston-meta"/"libraries.minecraft.net"
            → "https://bmclapi2.bangbang93.com/maven"
    变体B = 同样替换但 → "https://bmclapi2.bangbang93.com/libraries"
} else {
    // 官方 maven：只需要 /maven 变体
    变体 = → "https://bmclapi2.bangbang93.com/maven"
}
DlSourceOrder([original, 变体A, 变体B], [original]);   // 多候选排序
```

**为什么三方 maven 要两个变体**：BMCLAPI 对 Forge/Fabric 的 Maven 路径
有两种可能的映射（`/maven` 和 `/libraries`），**PCL2 不确定哪个对，
所以两个都试**——按顺序，第一个成功就用。

**③ Json/Meta：四条全替换**

```csharp
"piston-data.mojang.com"    → "https://bmclapi2.bangbang93.com"
"piston-meta.mojang.com"    → "https://bmclapi2.bangbang93.com"
"launcher.mojang.com"       → "https://bmclapi2.bangbang93.com"
"launchermeta.mojang.com"   → "https://bmclapi2.bangbang93.com"
```

**④ 社区资源：不走 `DlSourceOrder`，直接替换**

```csharp
// 注意这里用的是 mcimirror.top，不是 BMCLAPI
"api.modrinth.com"            → "mod.mcimirror.top/modrinth"
"staging-api.modrinth.com"    → "mod.mcimirror.top/modrinth"
"cdn.modrinth.com"            → "mod.mcimirror.top"
"edge.forgecdn.net"           → "mod.mcimirror.top"
"mediafilez.forgecdn.net"     → "mod.mcimirror.top"
"media.forgecdn.net"          → "mod.mcimirror.top"
"api.curseforge.com"          → "mod.mcimirror.top/curseforge"
```

**Modrinth 和 CurseForge 用不同的镜像站**（`mcimirror.top` 而非 BMCLAPI）——
因为 BMCLAPI 只管 Minecraft 官方的资源，社区资源是另一套。

#### 4.4.4 版本列表 URL 的完整对照

```
来源        官方                                          镜像
Mojang     launchermeta.mojang.com/mc/game/version_manifest.json
           → bmclapi2.bangbang93.com/mc/game/version_manifest.json
OptiFine   optifine.net/downloads
           → bmclapi2.bangbang93.com/optifine/versionList
Forge      files.minecraftforge.net/maven/.../forge/index_*.html
           → bmclapi2.bangbang93.com/forge/minecraft
NeoForge   maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge
           → bmclapi2.bangbang93.com/neoforge/meta/api/maven/details/releases/net/neoforged/neoforge
Fabric     meta.fabricmc.net/v2/versions
           → bmclapi2.bangbang93.com/fabric-meta/v2/versions
```

**注意 NeoForge 那条**：镜像路径甚至**不是简单的前缀替换**——
官方是 `api/maven/versions/releases/`，镜像是 `api/maven/details/releases/`
（`versions` → `details`）。说明这是**逐个 API 手工对齐过的**。

#### 4.4.5 "竞速"：同时问多个源

**每个加载器的列表请求都有三个变体方法**：
```
Dl*ListMojangMain      ← 竞速入口
Dl*ListOfficial        ← 只用官方
Dl*ListBmclapi         ← 只用镜像
```

`Dl*ListMain` 按设置和 `IsForceRestarting` 决定调用顺序，
而 `NetRequestByClientMultiple` 实现了**逐源串行、250ms 步进、每源线程可 Interrupt 取消**——
即"同时发起多个源的请求，先返回的赢"。

#### 4.4.6 `{CDN}` 占位符与请求签名

PCL 自建服务器（`pcl2-server`）的资源 URL 以 `{CDN}` 结尾，
由 `ModSecret.SecretCdnSign` 替换为**带签名的 CDN 地址**（具体签名算法不在此记录）。

> **证据边界**：本节的判断来自 2.13.1.1 发布版二进制。在开源版源码里，
> `SecretCdnSign` 已被裁剪成空壳——只做 `{CDN}` 占位符替换和 URL 编码，
> 不含任何签名逻辑。所以"带签名"这个结论只对发布版成立，不能用源码交叉验证。

**为什么要签名**：这是 PCL 自建的"主页市场""公告"等服务的 CDN 地址，
签名用于**限制第三方直接引用其 CDN 资源**，避免流量被外部站点消耗。

**对 dsh 的启示**：如果将来 dsh 要自建服务（比如版本兼容矩阵、公告），
"轻量签名限制引用"这个思路是够用的——不需要复杂的鉴权系统。

#### 4.4.7 全局限流（呼应 §4.3.4）

```csharp
if (URL.Contains("bmclapi")) Thread.Sleep(100);   // 每条新线程
```

**BMCLAPI 是公益镜像**（bangbang93 个人维护）。
PCL2 有几百万用户，**主动把对镜像的请求速率限制在每秒 10 条新线程**，
而不是"能跑多快跑多快"。

**这个自我约束值得学习**：用别人的公益基础设施时，
**把限流做在客户端且默认开启**，比等服务端封禁要好。

> **总结**：国内的"启动器能用"不是配个镜像地址那么简单。
> 需要（1）按资源类型分策略重写，（2）实测延迟自动切换，
> （3）多源候选+逐个禁用，（4）**对镜像站主动限流**。
> 最后一条尤其体现"长期共存"的意识。


### 4.5 重试与容错：分层的失败策略

**这是整个下载系统最"磨出来"的部分**——每个数字都是被真实网络环境教育出来的。

#### 4.5.1 双层重试

**第一层：单文件级**（`NetFile.SourceFail`，411 条指令）

失败的分类处理逻辑（CIL 确证）：

```csharp
source.FailCount++;
线程.State = Canceled;
source.Ex = ex;

// ── 禁用源的判定（按错误类型分流）──
if (Range 类错误 || Message 含 "(416)")
    → 无条件禁用该源           // Range 不支持，重试无意义

else if (错误含 "(502)/(404)/未能解析/无返回数据/空间不足")
    → 也不重试该源             // 服务端问题或本地问题，重试无用

else if (错误含 "(403)/(429)" && URL 不含 bmclapi)
    → 重试                     // 限流/拒绝，等一会儿可能好

else if (source.FailCount >= Clamp(5, 30, ...) && 已下载 >= 1 字节)
    → 禁用该源                 // 连续失败够多次
    Log("{0}下载源 {1} 已被禁用")
    // ★ 注意：URL 含 bmclapi 时日志前缀带"单线程"字样
```

**分流的智慧**：
- **416（Range 越界）** 是"这个源不支持分片"的确定信号——立即禁用，不浪费时间
- **502/404** 是服务端问题——重试同一个源没意义，但**别的源可能行**
- **403/429** 是限流——**值得重试**（尤其对官方源）
- **`bmclapi` 特殊对待**：对它更宽容（因为知道它是公益镜像，可能只是临时过载）

**禁用 ≠ 放弃**：被禁用的是**那个源**，不是那个文件。
文件还有别的源可用时继续跑。

**自动重试（整个文件级）**：

```csharp
if (space 不足) → 直接 Fail（重试无用）
else if (还有可用源 && !isNetworkError) {
    if (!Retried) {                      // 第一次失败
        清空并重建 SourcesOnce（所有源 Reset IsFailed=false）   // ★ 给所有源第二次机会
        Reset(); State = WaitingToDownload;
        Log("{0}：文件下载失败，正在自动重试……");
    }
    else if (还有可用源) { Reset(); State = WaitingToDownload; }  // 第二次：只重置
    else → Fail（"已无可用下载源，下载失败"，合并各源异常后抛出）
}
```

**`Retried` 只有一个标志位**——意味着**每个文件最多自动重试一次**。
但第一次重试时**会把所有被禁用的源重新启用**——
这相当于"换个时间再试一遍所有源"，而不是死磕一个。

**第二层：整批级**（`LoaderDownload.set_FailCount`）

```csharp
// 同一批下载中连续失败次数达到阈值 → 强制失败整批
threshold = Min(10000, Max(FileRemain × 8, ThreadLimit × 8 + 3));
Log("由于同加载器中失败次数过多引发强制失败：连续失败了 {0} 次");
```

**这个公式值得注意**：阈值**随剩余文件数和线程数动态调整**。
- `FileRemain × 8`：剩余越多，允许失败越多（可能只是网络抖动）
- `ThreadLimit × 8 + 3`：**并发的分母**——如果只有 4 条线程，连续失败 35 次就该停了

**为什么要这个**：防止"每个文件都失败、但每个都还在重试"的雪崩状态。
比如网络完全断了，64 个文件各失败 1-2 次还没触发单文件的重试上限，
但已经浪费了大量时间和请求。**这一层是"整体止损"。**

#### 4.5.2 四种超时

```csharp
// ① 连接超时 —— 随失败次数递增（给慢源更多耐心）
连接超时 = Max(平均连接耗时, 15000) × (FailCount + 1)
上限     = 30000 ms

// ② 慢速断开（★ 最有意思的一个）
if (LastReceiveTime > 0 && 距上次接收 > 5000ms && 期间收到字节 < 累计时间)
    抛 TimeoutException("由于速度过慢断开链接，下载 {n} B，消耗 {ms} ms。")

// ③ 无数据超时
if (LastReceiveTime > 0 && (now - LastReceiveTime) > 读超时)
    抛 "操作超时，无数据。"

// ④ 响应长度异常
if (ContentLength 读到 > 声明长度)
    抛 "返回的 ContentLength 过多：..."
```

**② 的判据很精妙**：它不是"5 秒没数据就断"，
而是"**5 秒没数据** 且 **期间收到的字节数 < 消耗的毫秒数**"——
即速率低于 **1 字节/毫秒 = 1KB/s** 才算慢速。

**为什么需要它**：有些服务器会保持连接但龟速传输
（TCP 连接活着，但每秒只给几十字节）。单纯的"无数据超时"抓不到这种情况——
因为一直有数据。而"太慢了"这个判据能抓到。

**① 的递增逻辑**：第一次超时 15 秒，第二次 30 秒……
**给"第一次慢了但可能是偶发"的源更多机会**，但也封顶在 30 秒
（避免用户等到天荒地老）。

#### 4.5.3 小请求的独立重试序列

`NetRequestByClientRetry`（版本列表这类小请求专用，与文件下载完全不同的策略）：

```csharp
// 最多 3 次尝试，超时序列：
第 1 次:  10000 ms
  Sleep(500)
第 2 次:  30000 ms
  Sleep(500)     // 且仅在已耗时 > 5500ms 时才进入第 3 次
第 3 次:   4000 ms

// 特例
403 / 404 → 直接 rethrow，不重试
429       → Sleep(10000) 后重试
```

**注意超时是 10s → 30s → 4s**——**最后反而变短了**。
为什么？因为前两次已经等了 40 秒，如果还没成功，
第三次快速失败然后**走别的源**（版本列表有 Main/Official/Bmclapi 三个变体）比继续等更有意义。

**版本列表还用"竞速"策略**（`NetRequestByClientMultiple`）：
```
逐源串行、250ms 步进、每源线程 Interrupt 取消
```
即：**同时发起多个源的请求，先返回的赢，其他的取消**。

#### 4.5.4 校验的三道关

```csharp
// ① 下载前：命中复用（CheckExistingFile）
if (FileChecker.Check(目标路径)) → 判定可复用
    → 在多个候选目录搜索副本（见 4.6 去重）
    → 找到则 Copy + 标记完成（进度权重只算 0.2）

// ② 下载后：合并前校验（NetFile.Merge）
if (!Check.Check(LocalPath))
    → 先重试 Merge 3 次（每次 Sleep 500×n ms）
    → 仍失败 → SourceFail

// ③ 大文件合并前：二次确认
if (Check.ActualSize == -1)
    → 用请求得到的 FileSize 再验一次
```

**② 的"重试 Merge 3 次"很细**：分片合并失败可能是**磁盘瞬时问题**
（文件被占用、写入缓存未刷），重试往往就好了——重下整个文件是浪费。

#### 4.5.5 磁盘空间预检

```csharp
GetDrives() 检查目标盘:
    if (TotalFreeSpace < 文件大小 × 1.1 + 5 MiB)
        抛错("…盘空间不足…下载时需要与文件同等大小的空间存放缓存")
```

**`× 1.1 + 5MiB`**：预留 10% + 5MB。
10% 是因为要同时存放"下载中的临时分片"和"最终文件"（合并时两者并存）；
5MB 是给其他临时文件的余量。

对应的用户提示（字符串证据）：
```
"下载时需要与文件同等大小的空间存放缓存，你可以在设置中调整缓存文件夹的位置。"
```

#### 4.5.6 关键常量汇总

| 常量 | 值 | 含义 |
| --- | --- | --- |
| 默认线程上限 | 64（滑条 63 + 1） | 全局共享，不是每文件 |
| 分片单位 | 256 KiB | `FilePieceLimit` |
| 单线程阈值 | 1 MiB | 小于此值不分片 |
| 新分片切走比例 | 剩余量的 40% | 从 60% 位置切 |
| 源禁用阈值 | 连续失败 ≥5 次且已下载≥1B | 特定错误立即禁用 |
| 整批止损阈值 | `Min(10000, Max(FileRemain×8, ThreadLimit×8+3))` | 动态 |
| 慢速断开 | 5s 内速率 < 1 KB/s | ★ 不是单纯无数据 |
| 调度器间隔 | 20 ms | |
| BMCLAPI 节流 | 每条新线程 100 ms | ★ 主动限流 |
| 统计窗口 | 100ms × 31 项，加权平均 | 新样本权重更大 |
| Merge 重试 | 3 次，Sleep 500×n ms | |
| 磁盘预检 | 大小 × 1.1 + 5 MiB | |

### 4.6 网络层：`ModNet`

```vb
' 字段 —— 注意是"双客户端"模型
RequestClient / RequestClientLock    ← API 请求专用 HttpClient
ThreadClient                         ← 下载专用（可能有不同超时/连接池配置）
NetTaskSpeedLimitLow / _High / Left  ← 限速的三段状态
NetTaskThreadCount                   ← 线程数
NetManager                           ← 任务管理器

' 方法
NetRequestByClient / NetRequestByClientRetry / NetRequestByClientMultiple
NetRequestByLoader                   ← ★ 把网络请求包装成 Loader 任务
NetDownloadByClient / NetDownloadByLoader
SendRequest
get_NetTaskThreadLimit / get_NetTaskSpeedLimitHigh / UpdateNetTaskSpeedLimitHigh
HasDownloadingTask
FindFreePort / FindFreePorts / GetUsedPorts / Ping     ← 联机功能配套
ShouldValidateSslCertificateOnLogin                    ← 正版登录的 SSL 验证开关
```

**三个设计要点**：

1. **请求与下载分离成两个 HttpClient**。API 请求要低延迟、少连接；
   下载要高吞吐、多并发。混用一个客户端会互相干扰（连接池争抢、超时策略冲突）。

2. **限速是自适应三段式**（`Low` / `High` / `Left` + `UpdateNetTaskSpeedLimitHigh`）。
   不是"限速 1MB/s"这种静态值，而是一个会动态调整的区间——
   推测是根据当前下载表现自动升降，兼顾"跑满带宽"和"不把网络打死"。

3. **`NetDownloadByLoader`**：下载直接产出一个 `Loader` 节点接入任务树（§5）。
   这是整套框架自洽的体现——网络层不需要知道 UI 怎么显示进度，
   它只负责返回一个可监听的节点。

### 4.7 统一资源模型：`ResourceVersion`

Modrinth 和 CurseForge 是两套完全不同的 API，PCL2 用一个模型统一：

```vb
' 字段
Id, ResourceType, Display, ReleaseDate, DownloadCount, Version,
ModLoaders, GameVersions, ReleaseType, FileName, DownloadUrls,
Hash, Size, RawDependencies, Dependencies, ProjectFilesCache

' 方法
FromPlatformJson      ← 从平台 JSON 构造
FromProjectId         ← 从 project id 构造
FromCacheJson / ToCacheJson    ← 缓存序列化
ParseModrinthTrackArguments    ← Modrinth 专有解析
ParseCurseForgeDownloadUrls    ← CurseForge 专有解析
ToNetFile / ToListItem / get_DownloadAvailable / get_ReleaseTypeDisplay
```

**适配器模式**：平台差异收敛在 `From*` 和 `Parse*` 里，上层只认 `ResourceVersion`。

---

## 5. 核心架构：`Loader*` 可组合任务树框架

**这是整个 PCL2 最重要的架构决策**，也是本次逆向最有价值的发现。
它不在 §2 的模块列表里显眼，但**所有耗时操作（下载、安装、启动、资源检查）
都跑在这套框架上**。

### 5.1 `LoaderBase` —— 抽象任务节点

```vb
' 树结构
Parent / InitParent / get_RealParent     ← 任务形成一棵树
_IsLoader                                 ← 是否是个"加载器"节点

' 状态机
_State / _LoadingState                    ← 运行态 / 加载态（两套）
get_State / set_State
get_LoadingState / set_LoadingState
add_LoadingStateChanged / remove_...
_Error / get_Error / set_Error

' 进度（加权聚合）
_Progress / get_Progress / set_Progress
_ProgressWeight / get_ProgressWeight      ← ★ 子任务按权重贡献父进度
add_ProgressChanged / remove_...
CreateSyncProgressProvider

' 事件（线程/UI 双通道）
add_OnStateChangedThread / remove_...     ← ★ 后台线程事件
add_OnStateChangedUi / remove_...         ← ★ UI 线程事件
add_PreviewFinish / RaisePreviewFinish

' 生命周期
Start / Cancel / Failed
CancellationTokenSource                   ← 标准取消传播
Block / Show                              ← UI 呈现控制
IsForceRestarting / WaitForExitTimeoutMessage
Uuid / Name / LockState
```

**三个关键设计**：

1. **权重化进度聚合**。每个节点有 `_ProgressWeight`，父节点的进度 =
   子节点进度按权重加权平均。这让"下载 100 个小文件 + 1 个大文件"的进度条
   能反映真实耗时，而不是"完成 50 个文件 = 50%"。

2. **线程事件与 UI 事件分离**。`OnStateChangedThreadEvent` 和
   `OnStateChangedUiEvent` 是两个独立通道。后台逻辑订阅前者（不阻塞），
   界面更新订阅后者（自动调度到 UI 线程）。**这从框架层面消灭了
   "在后台线程更新 UI"这个 WPF 最常见的错误类别**——呼应了 §2 里
   `"McLaunchStart 必须在 UI 线程调用！"` 的运行时断言。

3. **取消是一等公民**。`CancellationTokenSource` 内建在基类，
   取消沿树自动传播到所有子任务。

### 5.2 `LoaderCombo(Of T)` —— 组合节点（分支）

```vb
字段: Loaders (子任务列表), Input
方法: GetLoaderList()      ← ★ 动态展开：运行时决定有哪些子任务
      Update()             ← 状态聚合
      SubTaskStateChanged()← 子任务状态变化回调
      Start / Cancel / Failed
```

**`GetLoaderList` 是延迟求值的**——组合节点在启动时才向 `Input` 请求子任务列表。
这正是"分析/下载两阶段分离"（§4.1）的实现基础：
先用一个 Combo 展开"要下什么"，再用下一个 Combo 执行下载。

### 5.3 `LoaderTask(Of TIn, TOut)` —— 叶子节点（执行）

```vb
字段: InputDelegate      ← 如何取得输入（可能是耗时的）
      LoadDelegate       ← 实际工作
      Output             ← 产物
      ThreadPriority     ← 线程优先级
      ReloadTimeout      ← 重载超时
      LastFinishedTime / LastRunningThread   ← ★ 重入/重复执行保护
方法: StartGetInput / ShouldStart / Start
      IsCanceledWithThread / TriggerThreadInterrupt
```

`InputDelegate` 与 `LoadDelegate` 的分离再次体现两阶段思想：
**取输入可能本身就要联网/读盘，它也是一个可取消、可计时的阶段**。

`LastRunningThread` + `LastFinishedTime` 解决的是"同一任务被意外启动两次"
——启动前检查上次是谁在跑、什么时候跑完的。

### 5.4 `LoaderWorker` —— 最底层

```vb
字段: _Worker / get_Worker / set_Worker
方法: Start / Cancel / Worker_Succeeded / Failed
```

包装 `BackgroundWorker`，是唯一真正"碰线程"的类。上层完全不知道线程的存在。

### 5.5 为什么这个设计好

| 问题 | 这个框架的答案 |
| --- | --- |
| 进度条不准 | 权重化聚合，反映真实耗时分布 |
| 后台线程更新 UI 崩溃 | 事件双通道，框架强制分离 |
| 用户取消后资源泄漏 | `CancellationTokenSource` 沿树传播 |
| 任务重复启动 | `LastRunningThread` / `LastFinishedTime` 检查 |
| 嵌套异步难以组合 | Combo 可嵌套 Combo，形成任意深度的任务树 |
| 出错后不知道哪一步挂了 | 树结构自带"失败路径"，错误挂在具体节点上 |
| 每个功能重写一套进度逻辑 | 全部复用同一套基类 |

> **一句话**：它把"一个可能失败的、可取消的、有进度的、分阶段的长任务"
> 抽象成了一个可组合的类型，然后用它统一了整个启动器的所有异步操作。
>
> 这是**本次逆向中最值得借鉴的设计**。对比项目目前的"任务区"是手动管理的，
> 而这是一个经过了真实项目（64 线程下载、多加载器安装、崩溃诊断）验证的框架。

---

## 6. 启动管线与进程管控

### 6.1 启动 = 一棵带权重的任务 DAG

`McLaunchStart` 构造一个 `LoaderCombo`（任务树，§5 的框架），
**10 个任务按顺序执行，每个带进度权重**：

| # | 任务名 | 方法 | 权重 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 获取 Java | `McLaunchJava` | **4** | 含自动下载（见 6.4） |
| 2 | （登录） | `McLoginLoader` | — | 复用已有 loader |
| 3 | 补全文件 | `DlClientFix` | **15** | 最重的一步（要下 jar/libs/assets） |
| 4 | 获取启动参数 | `McLaunchArgumentMain` | 2 | |
| 5 | 解压文件 | `McLaunchNatives` | 2 | |
| 6 | 预启动处理 | `McLaunchPrerun` | 1 | GPU 偏好、options.txt、皮肤包 |
| 7 | 执行自定义命令 | `McLaunchCustom` | 1 | |
| 8 | 启动进程 | `McLaunchRun` | 2 | |
| 9 | 等待游戏窗口出现 | `McLaunchWait` | 1 | |
| 10 | 结束处理 | `McLaunchEnd` | 1 | |

**条件插入**：当 "需要内存优化" 且设置开启时，
在第 3 步后 `Insert(3, "内存优化", weight=30)`——**权重 30，是最大的一步**。

**`Block` 语义**（§5 提到的"串行屏障"）：第 3 步默认 `Block=false`
（可以并行），但在内存优化场景下被置回 `true`——
因为内存优化要在文件补全后、启动前独占执行。

**进度条是这些权重的加权平均**——这就是为什么用户看到的进度条
在"补全文件"阶段走得慢（权重 15/29），在"结束处理"阶段几乎不动（权重 1/29）。

### 6.2 前置检查（`McLaunchPrecheck`，596 条 IL）

```
1. 调试延时（SystemDebugDelay 时 Sleep 100-2000ms）
2. 路径合法性：PathIndie / PathVersion 不得含 ! 或 ;
   → 抛"游戏路径中不可包含 ! 或 ;（…）"     ← ★ 为什么？见下
3. 版本加载失败 → 抛"未选择 Minecraft 版本！" / "Minecraft 存在问题：{Info}"
4. 登录方式校验（各方式对应缓存键缺失则提示）
5. 未登录正版 + 中文环境 → 弹窗"你必须先登录正版账号，才能进行离线登录！"
   按钮：正版验证 / 购买正版 / 试玩 / 返回
   选"试玩" → ExtraGameArgs.Add("--demo") + "游戏将以试玩模式启动！"
```

**第 2 条那个限制值得解释**：`!` 和 `;` 在 Windows 批处理里有特殊含义。
PCL2 会生成 `LatestLaunch.bat`（启动脚本导出），
如果路径含这些字符，生成的脚本会执行出错。**所以它从入口就拒绝。**

### 6.3 `Watcher`：每实例一个进程监督器（19 个方法）

**这是"如何监督一个子进程并诊断它"的完整实现**。

#### 状态机

```csharp
enum MinecraftState { Loading = 0, Running = 1, Crashed = 2, Ended = 3, Canceled = 4 }
```

#### 构造与日志采集

```csharp
GameProcess.BeginOutputReadLine();   // 异步事件
GameProcess.BeginErrorReadLine();
GameProcess.add_OutputDataReceived(LogReceived);
GameProcess.add_ErrorDataReceived(LogReceived);

// ★ 双重缓冲：
//   LogReceived 只在锁内把行 append 到 WaitingLog（容量 1000）
//   —— 事件回调里不做任何处理，避免阻塞管道
//   LatestLog（ConcurrentQueue，上限 500）供崩溃分析
```

#### 监督主循环（专用线程）

```csharp
while (true) {
    for (tick = 0; tick < 4; tick++) {
        TimerWindow();     // 探测游戏窗口
        TimerLog();        // 批量处理日志
        // 窗口标题支持 {date}/{time} 占位符
        if (窗口已就绪 && State == Running && !HasExited && 标题含占位符)
            SetWindowText(WindowHandle, "Minecraft {date:yyyy/M/d} {time:HH:mm:ss}");
        Sleep(64);         // ~256ms 一批
    }
    if (State in (Crashed, Ended)) break;
    if (Loader.State == Canceled && State != Crashed) break;
    if (State == Crashed && GameProcess.HasExited) break;
}
```

**`SetWindowText` 改游戏窗口标题**是个贴心功能——
让窗口标题显示启动时间（用 `{date}`/`{time}` 占位符配置），
方便用户区分开了几个实例。

#### 退出检测：三种情况，三种结论

```csharp
if (GameProcess.HasExited) {
    if (State == Loading)
        // ★ 启动阶段就退出 = 崩溃
        Log("Minecraft 尚未加载完成，可能已崩溃");
        Crashed();

    else if (State == Running && ExitCode != 0 && instance.ReleaseTime.Year >= 2012)
        // ★ 运行中非零退出 = 崩溃
        //   2012 年前的老版本退出码不可靠，豁免
        Log("Minecraft 返回值异常，可能已崩溃");
        Crashed();

    else if (State != Crashed)
        State = Ended;    // 正常退出
}
```

**"2012 年前豁免"这个细节**：老版本的 Minecraft 退出码不遵循约定，
有些正常退出也返回非零。用 `ReleaseTime.Year >= 2012` 做分界，
**避免了在老版本上误报崩溃**。

#### 日志里程碑：5 级进度（★ 可移植性最强的一部分）

```csharp
LogProgress 只增不减，按日志内容推进：
  1/5  任意日志输出
  2/5  含 "Setting user:"
  3/5  含 "lwjgl version"（忽略大小写）
  4/5  含 "OpenAL initialized" 或 "Starting up SoundSystem"
  5/5  含 "Created" + "textures" + "-atlas"  或  "Found animation info"
```

**进度映射**：
```csharp
if (IsWindowAppeared || LogProgress == 5)
    loader.Progress = 0.95;  State = Running;  // "Minecraft 加载已完成"
else
    loader.Progress = min(LogProgress, 3) / 3 * 0.9;   // 最多 0.9，留给窗口出现
```

**这是纯 stdout 判定**——不依赖任何平台 API，
**可以直接 1:1 移植到任何环境的子进程监督**。

#### 实时崩溃检测（行级子串匹配）

```csharp
// 正常关闭信号
"Someone is closing me!"  /  "Restarting Minecraft with command"  → State = Ended

// 崩溃信号（命中即 Crashed()）
"Crash report saved to"
"This crash report has been saved to:"
"Could not save crash report to"
"/ERROR]: Unable to launch"
"An exception was thrown, the game will display an error screen and halt."

// 每次命中都先写日志 "识别为崩溃的 Log：<原文>"
```

#### 窗口探测（`TimerWindow`，388 条 IL）

```csharp
// P/Invoke EnumWindows 逐个枚举
// 类名白名单（覆盖各代 MC 的窗口系统）：
类名 ∈ { "GLFW30", "SDL_app", "LWJGL", "SunAwtFrame" }

// 排除：
标题不以 "FML" / "Quilt Loader" 开头    // Mod 加载器闪屏
非 "PopupMessageWindow"                   // 消息框
不以 "GLFW" 开头

// ★ 关键防误抓：窗口进程的 StartTime 必须 >= 游戏进程 StartTime
//   防止抓到之前遗留的同名窗口

// 异常处理（反作弊/安全软件拦截 SetWindowText）：
Logger.Error("由于反作弊或安全软件拦截，PCL 无法操作游戏窗口");
IsWindowFinished = true;   // 放弃，但不影响游戏运行
```

#### 崩溃分析编排

```csharp
Crashed() {
    State = Crashed;
    Log("Minecraft 已崩溃，将在 2 秒后开始崩溃分析");
    Hint("检测到 Minecraft 出现错误，错误分析已开始……");
    RunInNewThread(() => {
        Sleep(2000);       // ★ 等 MC 把 crash report 落盘
        analyzer = new CrashAnalyzer(instance);
        analyzer.Collect(instance.PathIndie, LatestLog.ToList());
        analyzer.Prepare();
        analyzer.Analyze();
        analyzer.Output(isExport: false, OutputFiles: [
            PathVersion + Name + ".json",
            PCL\Log1.txt,
            PCL\LatestLaunch.bat
        ]);
    }, "Crash Analyzer");
}
```

**`Sleep(2000)` 是个易遗漏的竞态处理**——崩溃报告是游戏进程在退出前写的，
立即去读可能读到不完整的文件。

### 6.4 Java 管理：两段式发现 + 12 条需求规则

#### 候选目录表（19 类，硬编码顺序）

```
1.     %APPDATA%\.minecraft\runtime\              ← Mojang 官方
2-5.   %APPDATA%\{.hmcl\java, ATLauncher\runtimes\minecraft,
                    ModrinthApp\meta\java_versions, PrismLauncher\java}\
6-9.   %LOCALAPPDATA%\{curseforge\minecraft\Install\runtime, .jdks,
                       .sdkman\candidates\java, .ftba\bin\runtime}\
10.    \Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe\...\runtime\   ← MS Store
11-13. %ProgramFiles%\{Minecraft Launcher\runtime, Minecraft\runtime,
                       C:\Curse\Minecraft\Install\runtime}\
14-18. %ProgramFiles(x86)%\{Java, Eclipse Adoptium, Amazon Corretto, Zulu, Microsoft}\
19.    JDK_HOME + ";" + JAVA_HOME（按 ; 切分）
```

**它扫描了 6 个第三方启动器的 Java 目录**——HMCL、ATLauncher、Modrinth App、
Prism、CurseForge、FTB。**用户装过的 Java 被别的启动器找回的，PCL2 也能用**。

**扫描时的过滤**（都很细）：
```csharp
· HasReparsePoint 过滤（重解析点/junction）
  ★ 但"全部命中时放弃过滤保留全部"——避免过滤掉所有结果
· 特殊路径过滤：java8path_target_ / javapath_target_ / javatmp / system32
  ★ 同样"全命中保留"
```

#### 单次调用拿全部信息

```csharp
java.exe -XshowSettings:properties -version    // 超时 15000ms
// 一次调用解析出：版本号、架构、file.encoding、native.encoding
```

**版本号解析的容错**：
```
正则 (?<=version ")[^"]+     回落 (?<=openjdk )[0-9]+
'_'/'+' → '.'
取 '-' 之前的部分
剥离 "1.x" 前缀
补足 4 段构造 System.Version
合法性检查：major ∈ (4, 100)，否则抛"分析详细信息失败，获取的版本为 {0}"
```

**架构门槛**：输出必须含 `64-bit`，否则抛
`"该 Java 为 32 位版本，请安装 64 位的 Java"`。
**PCL2 只接受 64 位 Java**——因为 32 位无法给 MC 分配足够内存。

#### ★ 12 条版本→Java 需求映射（最精彩的一处）

`GetJavaRequirement` 从 `ValueRange.All()` 开始，**逐条 `Intersect`（取交集）**：

| 规则 | 条件 | 约束 |
| --- | --- | --- |
| R1 | Vanilla ≥20.0.5 或快照 ≥2024-04-02 | `≥21` |
| R2 | ≥18 或 ≥2021-11-16 | `≥17` |
| R3 | ≥17 或 ≥2021-05-11 | `≥16` |
| R4 | ReleaseTime.Year ≥2017 | `≥8` |
| R5 | ≤2013-05-01 且 Year ≥2001 | `<9` |
| R6 | JSON `javaVersion.majorVersion` ≥22 | `≥n` + 推荐组件名 |
| R7 | OptiFine：major<7 / ==12 → `<9`；8-11 → `[8,9)` | |
| R8 | Forge：6.0.1-7.0.2 → `[7,8)`；≤12 → `<9`；≤14 → `[8,11)`；==15 → `[8,16)`；34.0.0-36.2.25 → `≤8.0.320`；36.2.26-36.999999 → `<24`；37.0.0-37.0.79 → `<17`；18+OptiFine → `<19`；45.0.21-45.0.65 → `<20`；45.0.66-47.4.8 → `<22` | |
| R9 | NeoForge 20.0.1 或 ≥20.2.62-beta | `<22` |
| R10 | Fabric：15-16 → `≥8`；≥18 → `≥17` | |
| R11 | LiteLoader | `<9` |
| R12 | 登录方式 Nide | `≥8.0.141` |

**冲突（交集为空）→ 抛 "Java 版本需求存在冲突…"**。

**这个表是"版本管理的知识沉淀"**——每一条都是被真实用户踩出来的
（"某个 Forge 版本配某个 Java 会崩"）。它的形式（区间交集）
比"if-else 一把梭"好得多：**多条规则自然叠加，冲突时能明确报错**。

#### 自动下载 Java

```
URL: piston-meta.mojang.com/v1/products/java-runtime/.../all.json
     ↔ bmclapi2.bangbang93.com/...（镜像）
解析 windows-x64 节点（跳过 minecraft-java-exe）
选优：先匹配 RecommendedComponent 组件名，再匹配版本区间
下载：每项 downloads.raw{url,sha1,size} → NetFile + FileChecker
      ★ 硬编码跳过 3 个 sha1（lzma 变体）
落盘：%APPDATA%\.minecraft\runtime\<组件名>\<相对路径>
★ 失败/取消 → 清理整个下载目录（避免留下半成品）
```

### 6.5 JVM 参数构建

**完整的参数组装顺序**（`McLaunchArgumentMain`）：

```
JVM 参数（McLaunchArgumentsJVM）
+ mainClass
+ 游戏参数（McLaunchArgumentsGame）
→ 占位符替换（McLaunchArgumentsReplace）
→ 含特殊字符的参数加引号
→ Join(" ")
```

**JVM 参数的处理链**：
```
1. 新版 JSON：逐项按 rules 过滤（McJsonRuleCheck）
   旧版 JSON：用硬编码默认值
2. 继承链：沿 inheritsFrom 上溯合并
3. 用户附加参数 → 分词（手写分词器，支持引号与转义）→ 去重
4. 登录方式扩展：
   · Nide:  -javaagent:nide8auth.jar=...
   · Auth:  -javaagent:authlib-injector.jar=...
            + -Dauthlibinjector.yggdrasil.prefetched=<Base64(预取响应)>
            ★ Java≥6 加 -Djavax.net.ssl.trustStoreType=WINDOWS-ROOT
5. JLW（Java Launch Wrapper）
   · ★ 非 GBK 环境才启用（IsGBKEncoding 为真则禁用）
   · 含用户 -javaagent 时禁用并警示"这可能导致游戏崩溃！"
   · -jar <pure>\Launch\JavaWrapper.jar
6. LUA（LwjglUnsafeAgent）：检测到 lwjgl 3.4.1 时注入
7. 内存与 GC
8. 编码处理
9. 去重（DeduplicateJavaArguments）
```

**GC 模式选择**（`LaunchAdvanceGC`，版本级覆盖优先）：

```
模式 0 (默认): Java≥15 → G1GC
模式 1:        Java≥21 → G1GC
模式 2/4:      G1GC
模式 3:        ZGC（Java 21/22 加 -XX:+ZGenerational）
★ Windows 10 build < 17763 → 强制 G1GC    ← 老系统上 ZGC 有问题
```

G1GC 参数组：
```
-XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20
-XX:G1HeapRegionSize=32M -XX:MaxGCPauseMillis=50
+ 非调试模式: -XX:+PerfDisableSharedMem    ← 减少 hsperfdata 文件写入
+ Java≤7: -XX:MaxPermSize=512m
+ Java==8: -XX:+ParallelRefProcEnabled
+ Java≥12: Min/MaxHeapFreeRatio
+ Java≥24: -XX:+UseCompactObjectHeaders
```

**安全相关的两个**：
```csharp
Remove("-XX:MaxDirectMemorySize=256M");     // 移除某些整合包带的有害参数
Add("-Dlog4j2.formatMsgNoLookups=true");    // ★ Log4Shell 缓解
```

**编码处理**（Java 的编码混乱是老大难）：
```
Java≥21 → UTF-8
Java≥18 → NativeEncodingName
否则    → FileEncodingName
GBK → 提升为 GB18030

Java≥19 → 注入 -Dstdout.encoding / -Dstderr.encoding
否则    → -Dsun.stdout.encoding / -Dsun.stderr.encoding
Java∈[18,21) → 加 -Dfile.encoding=COMPAT
```

**`DeduplicateJavaArguments`** 的三种策略：
```
单值参数（-key value 的 key 已存在）→ 丢弃
--tweakClass                        → 特殊：同 key 覆盖
布尔 / -key=value                   → 直接去重
```

### 6.6 游戏参数与自动进服

```csharp
// 自动进服（ServerIp 或 VersionServerEnter）
if (版本 ReleaseTime > 2023-04)
    → --quickPlayMultiplayer <ip>        // ★ 新版官方参数
else
    → --server <ip> --port <port>        // 老版，缺 port 用 25565

// 含 OptiFine 时提醒"OptiFine 与自动进入服务器可能不兼容…"
```

**`--quickPlayMultiplayer` 是 1.20+ 的原生"直接进服"参数**——
PCL2 按版本日期自动选对参数形式。

**OptiFineForge TweakClass 修补**（一个历史坑）：
```csharp
// 有 OptiFine + Forge/LiteLoader 时
// 把错误的 --tweakClass optifine.OptiFineTweaker
// 换成 optifine.OptiFineForgeTweaker
// ★ 并改写版本 JSON 文件内容（持久化修复）
// 失败仅 Warn："替换 OptiFineForge TweakClass 失败"
```

### 6.7 完整占位符表（`McLaunchArgumentsReplace`）

**这是 Minecraft 启动参数的标准占位符集**（730 条 IL）：

```
基础:
  ${classpath_separator}   = ";"
  ${natives_directory}     = GetNativesFolder()
  ${library_directory}     = McFolderSelected + "libraries"
  ${libraries_directory}   = 同上
  ${pure_directory}        = PathPure（全 ASCII 路径，见下）
  ${launcher_name}         = "PCL"
  ${launcher_version}      = "410"
  ${version_name}          = instance.Name
  ${game_directory}        = instance.PathIndie
  ${assets_root}           = McFolderSelected + "assets"
  ${user_properties}       = "{}"
  ${primary_jar}           = PathVersion + Name + ".jar"
  ${game_assets}           = assets\virtual\legacy   （旧版资源）
  ${assets_index_name}     = McAssetsGetIndexName(instance)

认证:
  ${auth_player_name}      = McLoginResult.Name
  ${auth_uuid}             = Uuid
  ${auth_session}          = AccessToken
  ${auth_access_token}     = AccessToken
  ${access_token}          = AccessToken
  ${user_type}             = "msa"

窗口:
  ${resolution_width}      / ${resolution_height}
    按窗口类型：2=跟随启动器窗口；3=用设置值；否则 854×480
    ★ Java 8u200-8u321 且 MC≤1.12 且无 OptiFine/Forge
      → 尺寸按 DPI 反缩放（"已应用窗口大小过大修复"）

类路径:
  ${classpath}             = 非 natives 库的 LocalPath 用 ";" Join
                            ★ OptiFine 库被移到列表末尾
```

**`${version_type}` 的特殊处理**：
```csharp
未禁用 VersionArgumentInfo 时 → 用户自定义的标题
禁用时 → "\"\"" 并★从参数列表中删掉 --versionType 及其值
```

**为什么要"全 ASCII 路径"（`${pure_directory}`）**：
Java 对非 ASCII 路径（中文、空格）的处理有 bug，
尤其是 javaagent 加载 jar 时。所以 PCL2 维护一条回退链：
```
Paths.Base  →  Base + "PCL\"  →  AppDataThenName
→  OsDrive + "ProgramData\PCL\"     ← 逐级找 ASCII-only 的
```

### 6.8 预启动处理：那些"游戏之外"的事

```
· 设置 GPU 偏好（SetGPUPreference）
  ★ 失败时以管理员身份重启自身 --gpu "{0}"（RunAsAdmin）
· 写 launcher_profiles.json（微软登录时）
  ★ 内嵌 JSON 模板 + GB18030 编码；失败则删除重建重试
· 更新 options.txt 的语言与全屏
  ★ 兼容 Yosbr mod 的 config/yosbr/options.txt 路径
  ★ <1.11 的按键值裁剪
· 老版本 Alex 皮肤提醒
· 离线自定义皮肤打包（resourcepacks\PCL2 Skin.zip，按版本 6-20 生成不同格式）
```

**`launcher_profiles.json` 的用途**：原版启动器和很多 Mod 安装器
（Forge、OptiFine 的安装器）会检查这个文件判断"这里是个 Minecraft 安装"。
PCL2 主动写一份，**让这些第三方工具能认出 PCL2 的目录**。

**"失败则删除重建重试"**：如果文件损坏，删掉重写——
因为这个文件是给第三方工具看的，重置的代价很低。

### 6.9 结束处理

```csharp
enum 行为（LaunchArgumentVisible，6 值）：
  0 → 关闭启动器（"已根据设置，在启动后关闭启动器"）
  1/5 → 不动
  2/3 → 隐藏
  4 → 最小化
```
配套：`SystemLaunchCount` 自增（对应主题解锁的"启动 99 次"）。

**全局状态联动**（`ModWatcher.WatcherStateChanged`）：
```csharp
// 扫描所有 watcher，判断是否还有游戏在跑
HasRunningMinecraft = 任一 watcher State ∈ {Loading, Running}
                  或（Crashed 且进程未退出）

// 从"有"变"无"时触发 MinecraftStop(cleanFlag)
★ 游戏崩溃时若设置为"隐藏"，启动器会重新显示（以便看到错误弹窗）
★ 干净退出且设置为"关闭"时自动关启动器
```

**"崩溃时强制显示"这个细节**：如果用户设置了"启动后隐藏启动器"，
但游戏崩了，PCL2 会**违背设置把窗口弹回来**——
因为这时候用户需要看到错误信息。**这是"设置让位于实际需要"。**


## 7. 实例导出：从"打包"到"发布到 Modrinth"

`PageInstanceExport`（94 个方法、36 个字段）不只是打个 zip——它是一个
**面向分发的、带合规检查的整合包制作工具**。

### 7.1 可选择的内容清单

```vb
' 页面控件字段直接暴露了可勾选项
_CheckOptionsBasic           基础（版本信息）
_CheckOptionsOptions         版本设置
_CheckOptionsMod             Mod
_CheckOptionsResourcePacks   资源包
_CheckOptionsShaderPacks     光影包
_CheckOptionsShaderPackSettings  光影设置
_CheckOptionsSaves           存档
_CheckOptionsJava            Java 运行时
_CheckOptionsPcl             PCL 自身配置
_CheckOptionsPclCustom       PCL 个性化（主页/背景音乐/图片等）
_CheckAdvancedInclude        高级：是否内联打包资源
_CheckAdvancedModrinth       高级：Modrinth 上传模式

' 排除机制
SubOptionBlackList           黑名单（用户手动排除的项）
_RulesOverrides              规则覆盖
ExtraFiles                   额外附加文件
```

**二级扫描**（`GetAllOptions` / `GetExportOption` / `ReloadSubOptions`）：
```vb
"共发现 {0} 个可行的二级文件/文件夹"     ← 支持勾选到单个文件的粒度
"文件夹" / "*.zip" / "*.rar" / "resourcepacks" / "texturepacks" / "saves" / "shaderpacks"
```

### 7.2 配置是"带注释的声明式文本"

从字符串提取的完整配置模板（`export_config.txt`）：

```yaml
Name:              # 整合包名
Version:           # 版本

# 当版本设置中选择了「使用版本文件夹中的 Java」时，是否打包版本文件夹中的 Java。
IncludeJava:

# 是否打包正式版 PCL，以便没有启动器的玩家安装整合包。
IncludeLauncher:

# 是否打包 PCL 个性化内容，例如功能隐藏设置、主页、背景音乐和图片等。
IncludeLauncherCustom:

# 是否将 Mod、资源包、光影包的文件直接放入整合包中，这样在导入时就无需联网下载它们。
# 建议仅在无法稳定连接 CurseForge 或 Modrinth 时才考虑启用。
# 二次分发可能违反使用协议，请尽量不要公开发布包含资源文件的整合包！
DontCheckHostedAssets:

# 若资源未在 Modrinth 上托管，则将其原始文件直接放入整合包中。
# 如果你想将整合包上传到 Modrinth，这能帮助你分辨哪些文件未在 Modrinth 上托管。
# 此选项与 DontCheckHostedAssets 冲突。
ModrinthUploadMode:

# 导出的文件的存放位置。
# 若设置了此项，在导出时会直接将文件放到此路径，不会弹窗要求选择。
# 若 IncludeLauncher 为 True，应以 .zip 结尾；若为 False，应以 .mrpack 结尾。
PackPath:
```

**三个设计亮点**：

1. **`.mrpack` 是 Modrinth 官方整合包格式**。PCL2 支持直接导出成可上传 Modrinth 的格式，
   并且 `ModrinthUploadMode` 会**检查每个资源是否已托管在 Modrinth**——
   只把未托管的文件打进包里。这是**为平台分发生成的优化**。

2. **配置是纯文本 + 内嵌注释**。用户可以直接编辑这个文件来批量制作整合包
   （`CacheExportConfig` / `保存配置失败` / `选择配置文件`）。
   再次呼应 §2 的"INI 友好"哲学：**让高级用户能用文本工具批量操作**。

3. **主动做合规提醒**：`"二次分发可能违反使用协议，请尽量不要公开发布包含资源文件的整合包！"`
   —— 工具本身提示法律风险，而不是等用户自己踩坑。这是负责任的做法。

---

## 8. 崩溃诊断：`CrashAnalyzer`

19 个方法、11 个字段。这是**启动器把"用户求助"变成"自动诊断"**的功能。

### 8.1 结构与诊断策略

```vb
' 输入（多种来源）
AnalyzeRawFiles / DirectFile     ← 原始文件 / 直接指定
LogMc / LogMcDebug / LogHs / LogCrash / LogAll   ← 五类日志

' 输出
CrashReasons                     ← ★ 结论是"多条原因"的集合
OutputFiles

' 流程
Collect          收集日志文件
Import           导入用户提供的日志（"自主导入"路径）
Prepare          准备日志文本
GetHeadTailLines ★ 只取首尾若干行（异常在前，环境在后，中间是噪音）
Analyze          主分析入口
  AnalyzeCrit1 / AnalyzeCrit2 / AnalyzeCrit3   ← 三个"硬规则"判定
  AnalyzeStackKeyword                          ← 堆栈关键词匹配
  AnalyzeModName / TryAnalyzeModName ×2        ← 从堆栈正则提取 Mod 名
AppendReason ×2  追加结论
Output / GetAnalyzeResult
```

字符串证据完整对应（**分步日志**）：
```
"步骤 1：收集日志文件完成，收集到 {0} 个文件"
"步骤 1：自主导入日志文件，收集到 {0} 个文件"
"步骤 2：准备日志文本" / "[Crash] 步骤 2：准备日志文本完成，找到"
"步骤 2：准备日志文本完成，没有任何可供分析的日志"
"步骤 3：分析崩溃原因"
"步骤 3：分析崩溃原因完成，未找到可能的原因"
"步骤 3：分析崩溃原因完成，找到 {0} 条可能的原因"     ← ★ 可能是多条
"开始进行崩溃日志堆栈分析"
"输出报告：{0}，作为 Minecraft 崩溃报告"
```

### 8.2 结论有置信度分级

从文案差异可读出**三档确定性**：

```
确定：  "名为 {0} 的 Mod 导致了游戏出错。"
                     "你可以尝试禁用此 Mod，然后观察游戏是否还会崩溃。"

怀疑：  "PCL 怀疑名为 {0} 的 Mod 导致了游戏出错，但不能完全确定。"
        "PCL 怀疑以下 Mod 导致了游戏出错，但不能完全确定：\n - {0}\n"
                     "你可以尝试依次禁用上述 Mod，然后观察游戏是否还会崩溃。"

机制：  "{0} 的 Mod 注入失败，导致游戏出错。"
                     "这一般代表着它与其他 Mod 或当前环境不兼容，或是它存在 Bug。"
```

**每条结论都带"建议动作"**，不只是说"哪里错了"。

### 8.3 完整流程：收集 → 分类 → 四遍分析

#### 收集（`Collect`，923 条 IL）

```csharp
// 三个来源
· <PathIndie>\crash-reports\*                     ← MC 崩溃报告
· <PathIndie>\..\..\ 与 <PathIndie>\ 下的 *.log   ← 主文件夹/隔离文件夹日志
· 固定候选：logs\latest.log、logs\debug.log
· watcherStdout（游戏进程的实时输出）→ 写成 Temp\RawOutput.log

// ★ 时间过滤（关键）
只保留"最后修改 < 3 分钟 且 非空"的文件
日志："可能可用的日志文件：{0}（{1} 分钟）"
     /"未发现可能可用的日志文件"
```

**"3 分钟内"这个判据**：崩溃分析是在崩溃后立即启动的，
所以相关日志必然是刚刚被写入的。**过滤掉历史日志**避免误判。

#### 分类（`Prepare`，2539 条 IL）

按文件名分派**优先级**：

```
4 = hs_err*           ← JVM 虚拟机错误（最高，因为它最精确）
? = crash-*           ← Minecraft 崩溃报告
1 = latest.log / latest log.txt / debug.log / debug log.txt
    / 游戏崩溃前的输出.txt / rawoutput.log
? = 启动器日志.txt / PCL2 启动器日志.txt / PCL 启动器日志.txt / log1.txt
```

产出四个字段：`LogMc`（游戏主日志）、`LogMcDebug`、`LogHs`（hs_err）、`LogCrash`（崩溃报告）。

**边界情况**：只找到额外日志时 →
`"由于仅发现了额外日志，将它们视作 Minecraft 日志进行分析"`。

#### 分析（`Analyze`，740 条 IL）

```
LogAll = LogMc ?? LogMcDebug ?? "" + LogHs + LogCrash

AnalyzeCrit1();   if (CrashReasons.Any()) return;    ← 字面量规则
AnalyzeCrit2();   if (CrashReasons.Any()) return;    ← 加载器自报
if (LogAll 含 "orge" | "abric" | "uilt" | "iteloader") {   ← 有 Mod 加载器痕迹
    if (LogCrash != null) → AnalyzeStackKeyword(LogCrash.BeforeFirst("System Details"))
    if (LogMc != null)    → 正则 "/FATAL] .+?(?=[\n]+\[)" 收集致命行
                           + "Unreported exception thrown!"
                             （JLW 包装：取 "Unreported…" 到 "at oolloo.jlw.Wrapper" 之间）
    if (LogHs != null)    → AnalyzeStackKeyword(Between(LogHs, "T H R E A D", "Registers:"))
    合并关键字 → AnalyzeModName(list)
} else Log("可能并未安装 Mod，不进行堆栈分析")

AnalyzeCrit3();   ← 兜底
```

**注意 `AnalyzeCrit1/2` 命中即返回**——这是**短路设计**：
字面量规则最可靠，一旦命中就不做更模糊的堆栈分析。

### 8.4 完整规则集：46 个原因 × 触发条件 × 用户模板

#### `CrashReason` 枚举全表（46 个值，实测常量）

| # | 名称 | # | 名称 |
| --- | --- | --- | --- |
| 0 | Java虚拟机参数有误 | 23 | Mod初始化失败 |
| 1 | Mod文件被解压 | 24 | 堆栈分析发现关键字 |
| 2 | MixinBootstrap缺失 | 25 | 堆栈分析发现Mod名称 |
| 3 | 内存不足 | 26 | OptiFine导致无法加载世界 |
| 4 | 使用JDK | 27 | 特定方块导致崩溃 |
| 5 | 显卡不支持OpenGL | 28 | 特定实体导致崩溃 |
| 6 | 使用OpenJ9 | 29 | 材质过大或显卡配置不足 |
| 7 | Java版本过高 | 30 | 没有可用的分析文件 |
| 8 | Java版本不兼容 | 31 | 使用32位Java导致JVM无法分配足够多的内存 |
| 9 | Mod名称包含特殊字符 | 32 | Mod重复安装 |
| 10 | 显卡驱动不支持导致无法设置像素格式 | 33 | Mod互不兼容 |
| 11 | 极短的程序输出 | 34 | OptiFine与Forge不兼容 |
| 12 | Intel驱动不兼容导致EXCEPTION_ACCESS_VIOLATION | 35 | Fabric报错 |
| 13 | AMD驱动不兼容导致EXCEPTION_ACCESS_VIOLATION | 36 | Fabric报错并给出解决方案 |
| 14 | Nvidia驱动不兼容导致EXCEPTION_ACCESS_VIOLATION | 37 | Forge报错 |
| 15 | 玩家手动触发调试崩溃 | 38 | 低版本Forge与高版本Java不兼容 |
| 16 | 光影或资源包导致OpenGL1282错误 | 39 | 版本Json中存在多个Forge |
| 17 | 文件或内容校验失败 | 40 | Mod过多导致超出ID限制 |
| 18 | 确定Mod导致游戏崩溃 | 41 | NightConfig的Bug |
| 19 | 怀疑Mod导致游戏崩溃 | 42 | ShadersMod与OptiFine同时安装 |
| 20 | Mod配置文件导致游戏崩溃 | 43 | Forge安装不完整 |
| 21 | ModMixin失败 | 44 | Mod需要Java11 |
| 22 | Mod加载器报错 | 45 | Mod缺少前置或MC版本错误 |

> **注意 #35 "Fabric报错" 在分析代码里没有生产者**——模板存在但
> `AnalyzeCrit1/2` 都不产生它。推测为历史遗留或预留。

#### `AnalyzeCrit1`：字面量主表（约 70 条规则）

三段扫描顺序：`LogCrash` → `LogMc` → `LogHs` → `LogCrash`（第二遍）。

| 触发条件 | 原因 | 附加信息提取 |
| --- | --- | --- |
| 三段日志全空 | 30 没有可用的分析文件 | — |
| `Unable to make protected final java.lang.Class java.lang.ClassLoader.defineClass` | 7 Java版本过高 | — |
| `Failed loading config file ` | 20 Mod配置文件 | 正则取 modid + 配置文件名 |
| `Unrecognized option:` | 0 Java虚拟机参数有误 | — |
| `Found multiple arguments for option fml.forgeVersion…` | 39 多个Forge | — |
| `The driver does not appear to support OpenGL` | 5 显卡不支持OpenGL | — |
| `java.lang.ClassCastException: java.base/jdk` | 4 使用JDK | — |
| 6 条 `NoSuchMethodError`（SpriteContents/RenderSystem/ BakedQuad/ForgeGui/DistanceManager/Font） | 34 OptiFine与Forge不兼容 | — |
| `Open J9 is not supported` / `.J9VMInternals.` | 6 使用OpenJ9 | — |
| `java.lang.NoSuchFieldException: ucp` / `because module java.base does not export` / `NashornScriptEngineFactory` / `LambdaMetafactory` | 7 Java版本过高 | — |
| `The directories below appear to be extracted jar files` | 1 Mod文件被解压 | — |
| `ClassNotFoundException: org.spongepowered.asm.launch.MixinTweaker` | 2 MixinBootstrap缺失 | — |
| `Couldn't set pixel format` | 10 像素格式 | — |
| `java.lang.OutOfMemoryError` / `an out of memory error` | 3 内存不足 | — |
| `Shaders Mod detected…OptiFine has built-in support for shaders` | 42 ShadersMod冲突 | — |
| `NoSuchMethodError: sun.security.util.ManifestEntryVerifier` | **38** 低版本Forge与高版本Java | — |
| `1282: Invalid operation` | 16 OpenGL1282 | — |
| `signer information does not match…` | 17 校验失败 | `(?<=class ")[^']+(?="'s signer information)` |
| `Maybe try a lower resolution resourcepack?` | 29 材质过大 | — |
| `shouldForceTicks(J)Z` 且含 `OptiFine` | 26 OptiFine世界加载 | — |
| `com.electronwill.nightconfig…Not enough data available` | 41 NightConfig | — |
| `Cannot find launch target fmlclient` | 43 Forge安装不完整 | — |
| `Invalid paths argument, contained no existing paths` + `libraries\net\minecraftforge\fmlcore` | 43 同上 | — |
| `Invalid module name: '' is not a Java identifier` | **9** Mod名称特殊字符 | — |
| `class file version 55.0` / `JAVA_11 could not be set` | 44 Mod需要Java11 | — |
| `Unsupported class file major version` / `Unsupported major.minor version` | 8 Java版本不兼容 | — |
| `Invalid maximum heap size` | **31** 32位Java内存限制 | — |
| `Could not reserve enough space` + `for 1048576KB object heap` | 31 同上 | — |
| `Could not reserve enough space`（其他） | 3 内存不足 | — |
| `Caught exception from ` | 18 确定Mod崩溃 | `(?<=Caught exception from )[^\n]+?` → TryAnalyzeModName |
| `DuplicateModsFoundException` | 32 Mod重复安装 | `(?<=\n\t[\w]+ : [A-Z]:[^\n]+(/|\\))[^/\\\n]+?.jar` |
| `Found a duplicate mod` | 32 同上 | 该行 `[^\\/]+.jar` |
| `Found duplicate mods` | 32 同上 | `(?<=Mod ID: ')\w+?(?=' from mod files:)` |
| `ModResolutionException: Duplicate` | 32 同上 | 该行 `[^\\/]+.jar` |
| `Incompatible mods found!` | 33 Mod互不兼容 | 正则取不兼容详情段 |
| `Missing or unsupported mandatory dependencies:` | 45 前置缺失 | 正则取依赖列表 |
| `The system is out of physical RAM or swap space`（LogHs） | 3 内存不足 | — |
| `EXCEPTION_ACCESS_VIOLATION` + `# C  [ig` / `[atio` / `[nvoglv`（LogHs） | 12 / 13 / 14 驱动细分 | 命中即分类 |
| `maximum id range exceeded`（LogCrash） | 40 ID上限 | — |
| `Pixel format not accelerated`（LogCrash） | 10 像素格式 | — |
| `Manually triggered debug crash`（LogCrash） | 15 玩家手动 | — |
| `has mods that were not found` + OptiFine 正则（LogCrash） | 34 OptiFine与Forge | — |
| `-- MOD ` 且 `Between("-- MOD ", "Failure message:")` 含 `.jar` | 18 确定Mod崩溃 | `(?<=Mod File: ).+` |
| 同上但无 `.jar` | **22 Mod加载器报错** | `(?<=Failure message: )[\w\W]+?(?=\tMod)` |
| `Multiple entries with same key: `（LogCrash） | 18 确定Mod崩溃 | `(?<=Multiple entries with same key: )[^=]+` |
| `LoaderExceptionModCrash: Caught exception from `（LogCrash） | 18 同上 | `(?<=…from )[^\n]+` |

#### `AnalyzeCrit2`：加载器自报 + Mixin

| 触发 | 原因 | 提取 |
| --- | --- | --- |
| Mixin 六条关键词（`Mixin prepare failed` / `MixinApplyError` / …） | 21 ModMixin失败 | `(?<=from mod )[^.\/ ]+(?=\] from)` 或 `(?<=for mod )[^.\/ ]+(?= failed)` |
| `An exception was thrown, the game will display an error screen and halt.` | **37 Forge报错** | 正则抽异常段 |
| `A potential solution has been determined[:…]`（3 种措辞） | **36 Fabric报错并给出解决方案** | 抽 `- ` 列表 |
| `due to errors, provided by '` | 18 确定Mod崩溃 | `(?<=due to errors, provided by ')[^']+` |
| LogCrash 的 `Suspected Mod … Stacktrace` 段 | **19 怀疑Mod崩溃** | `(?<=\n\t[^(\t]+\()[^)\n]+` |

#### `AnalyzeCrit3`：低置信度补充

| 触发 | 原因 | 附加 |
| --- | --- | --- |
| `LogMc` 短(<100) 且无 `at net.` / `INFO]` 且无其他日志 | 11 极短输出 | LogMc 全文 |
| `Mod resolution failed` | 22 Mod加载器报错 | — |
| `Failed to create mod instance.` | 23 Mod初始化失败 | `ModID: ` 或 `ModId ` 后取值 |
| `\tBlock location: World: `（LogCrash） | **27 特定方块崩溃** | `Block{<名>}` + 坐标 |
| `\tEntity's Exact location: `（LogCrash） | **28 特定实体崩溃** | `Entity Type: <类型>` + 坐标 |

#### 堆栈分析：两层黑名单（★ 最精巧的部分）

```csharp
// 第一层：包名前缀黑名单（20 项，命中即丢弃）
java, sun, javax, jdk, oolloo, org.lwjgl, com.sun, net.minecraftforge,
paulscode.sound, com.mojang, net.minecraft, cpw.mods, com.google,
org.apache, org.spongepowered, net.fabricmc, com.mumfrey,
com.electronwill.nightconfig, it.unimi.dsi,
MojangTricksIntelDriversForPerformance_javaw

// 取类名最左侧 4 段（Mod 包名核心区），每段：
//   长度 > 2 且 不以 func_ 开头 且 不在第二层黑名单
//
// 第二层：关键词黑名单（106 项）—— 全是"技术词汇"而非 Mod 名：
com, org, net, asm, fml, mod, jar, sun, lib, map, gui, dev, nio, api, dsi,
top, mcp, core, init, mods, main, file, game, load, read, done, util, tile,
item, base, fake, oshi, impl, data, pool, task, forge, setup, block, model,
mixin, event, unimi, netty, world, lwjgl, fakes, fabric, gitlab, common,
server, config, mixins, compat, loader, launch, script, entity, assist,
client, plugin, modapi, mojang, shader, events, github, recipe, render,
packet, preinit, preload, machine, reflect, channel, general, handler,
content, systems, modules, service, scripts, network, fastutil, optifine,
internal, platform, override, fabricmc, neoforge, external, injection,
listeners, scheduler, minecraft, universal, multipart, neoforged,
microsoft, transformer, transformers, minecraftforge, blockentity,
spongepowered, electronwill, concurrent

// ★ 熔断：若结果 > 10 个 → "关键词过多，考虑匹配出错，不纳入考虑" → 返回空列表
```

**这两层黑名单的设计思路值得学**：
第一层挡"JDK 和 MC 自己的包"，第二层挡"技术通用词"——
**剩下的才可能是 Mod 的独特包名**。

而 **"> 10 个就熔断"** 是个务实的保护：
如果提取出十几个"关键词"，那基本是匹配出了错
（正常情况下一个崩溃只涉及一两个 Mod），**宁可不报也不要误导**。

### 8.5 结果表达：46 个原因 → 人类文案

`CrashReason` 是 **46 个值的枚举**（`Java虚拟机参数有误`、`内存不足`、
`使用JDK`、`使用OpenJ9`、`版本Json中存在多个Forge`…）。

`GetAnalyzeResult` 把它映射成**长段人类文案**，且带**决策分叉**：

```csharp
// 例：32 位问题按操作系统分叉两条文案
if (Environment.Is64BitOperatingSystem)
    "你正在使用 32 位的 Java…请安装 64 位的 Java"
else
    "你正在使用 32 位的操作系统…你或许只能重装 64 位的操作系统来解决此问题。\n"
  + "如果你的电脑内存在 2GB 以内，那或许只能换台电脑了……"

// 有明细的原因（前置缺失、Mod 名、关键词）做 Join(" - ") 内联
// 末尾统一拼接：
//   \h → "你可以查看错误报告了解错误具体是如何发生的。"
//   \e → 求助提示
// ★ 启动器非最新时追加更新提示（PageSetupSystem.IsLauncherNewest）
```

**"启动器非最新时追加更新提示"**——因为很多"崩溃"其实是老版本的 bug。

### 8.6 导出：一键打包诊断包

```csharp
Output() → MyMsgBox("Minecraft 出现错误" / "错误报告分析结果")
           按钮：[查看输出] / [导出错误报告]

查看输出 → DirectFile 存在则用默认程序打开
         否则写 PathTemp\Crash.txt 后打开

导出 → 收集 OutputFiles（含 version.json、Log1.txt、LatestLaunch.bat）
     → 复制进 Temp\Report\ 并★重命名成中文：
        LatestLaunch.bat  → "启动脚本.bat"
        Log1.txt          → "PCL 启动器日志.txt"（UTF-8）
        RawOutput.log     → "游戏崩溃前的输出.txt"（UTF-8）
     → ★ 内容过 FilterAccessToken / FilterUserName 脱敏
     → CreateZipFromDirectory → Hint("错误报告已导出！") → OpenExplorer
```

**"重命名成中文"是个体贴的设计**：用户把 zip 发给别人时，
对方打开看到的文件名是能看懂的（而不是 `Log1.txt`）。

**"自动脱敏"是必须的**：启动器日志里会包含 accessToken 和用户名，
**导出前必须打码**（accessToken 保留首尾 5 字符，用户名路径打码）。

### 8.7 设计评价

1. **取首尾行（`GetHeadTailLines`）**：崩溃报告可能几万行，关键信息集中在
   头部（异常类型 + 堆栈）和尾部（环境/Mod 列表），中间是噪音。

2. **多结论 + 置信度**：不假装给出唯一答案，而是列出所有可能。比"猜一个"诚实。

3. **每条结论都给可执行建议**：不是"你 Mod 冲突了"，而是"禁用这个 Mod 再试"。

4. **覆盖"非代码原因"**：32 位系统、内存不足、其他启动器改坏文件——
   这些是**用户环境问题**但用户会归咎于启动器。主动识别既帮了用户，
   也减少了无效反馈。

5. **诊断本身也是 Loader 任务**（`"加载线程 {0} 已启动/已完成/已中断"`），
   不卡 UI，可取消。

---
---

## 9. UI 架构（概要）

### 9.1 自研 WPF 控件库（`My*` 系列，40+ 个）

**PCL2 没有用任何第三方 UI 库**（没有 MahApps、HandyControl、MaterialDesign）。
全部自绘，为了完全控制视觉。

#### 核心原语：`MyCard`

`MyCard`（48 个方法、25 个字段）不是普通的卡片容器，它**内建了三种交互模式**：

```vb
' 1. 展开/收起（折叠面板）
_SwapType / _IsSwapped / IsSwapedProperty    ← 依赖属性，可绑定
SwapControl / _CanSwap / SwappedHeight       ← 展开后的高度
_SwapLogoRight / SwapEvent / PreviewSwapEvent ← 展开箭头 + 事件

' 2. 悬停阴影动画
DropShadowIdleOpacity / DropShadowHoverOpacity   ← 两档阴影透明度
_HasMouseAnimation / _UseAnimation               ← 动画开关

' 3. 高度动画
IsHeightAnimating / ActualUsedHeight             ← 平滑高度过渡

' 4. WPF 标准扩展点
TitleProperty / IsSwapedProperty                 ← DependencyProperty
MainGrid / MainBorder / MainChrome / _MainTextBlock / _MainSwap  ← 模板部件
Uuid                                             ← 实例标识
```

**设计解读**：它把"一个可展开的、悬停有反馈的、高度会动画的卡片"
封装成一个控件。PCL2 的设置页、实例页、下载页大量复用它——
所以那些页面的代码量能压在 100-250 个方法（而不是散落各处写动画逻辑）。

#### 完整控件清单

```
基础输入:  MyButton, MyTextButton, MyIconTextButton, MyExtraButton,
          MyExtraTextButton, MyTextBox, MyComboBox(Item), MyCheckBox,
          MyRadioBox(IMyRadio), MySlider, MySearchBox

列表/导航: MyListItem, MyMenuItem, MyScrollBar, MyScrollViewer,
          MyListItem, MyPageLeft, MyPageRight,
          MyVirtualizingElement(Of T)          ← 泛型虚拟化容器

对话框:    MyMsgInput, MyMsgSelect, MyMsgText, MyMsgLogin   ← 四种语义化弹窗
提示:      MyHint                                   ← toast/提示条
异步状态:  MyLoading, MyLoadingStateSimulator, ILoadingTrigger
图片/皮肤: MyImage, MySkin
列表项:    MyResourceItem, MyLocalModItem
其他:      MyCard, MyIconTextButton, LazyLoadBehavior
```

#### 几个值得注意的实现细节

**`MyVirtualizingElement(Of T)` + `LazyLoadBehavior`**
说明它认真处理了**长列表性能**。PCL2 的 Mod 列表、资源列表可能几千项，
泛型虚拟化容器 + WPF Behavior（`LazyLoadBehavior` 挂在滚动事件上按需加载）
是标准解法。

**`MyLoadingStateSimulator`**（10 个方法）——"加载状态模拟器"。
这是个很有意思的设计：**当实际加载太快时，人为延长动画**，
避免 UI 闪烁。这是"感知性能"的优化，不是"实际性能"。

**四种语义化弹窗**（而不是一个通用 Dialog）：
```
MyMsgInput   ← 需要用户输入
MyMsgSelect  ← 需要用户选择
MyMsgText    ← 纯信息展示
MyMsgLogin   ← 登录专用（有特殊布局）
```
**按使用场景分类，而不是按 UI 形态分类**——调用方不需要自己拼按钮。

**`IRefreshable` / `IDispatcherUnhandledException`** 两个接口
（各 1 个方法）——前者是"主题/语言变更时刷新"的契约，
后者是全局异常处理的接入点。

#### 与对比项目的启示

| PCL2 的做法 | 说明 |
| --- | --- |
| **把交互模式封装进控件**（MyCard 含折叠+阴影+高度动画） | 页面代码量大幅下降 |
| **按使用场景命名弹窗**（MyMsgInput/Select/Text/Login） | 调用方不用拼装 |
| **`MyLoadingStateSimulator`**（感知性能优化） | 短任务也做过渡，避免闪烁 |
| **自研而非用第三方库** | 代价是 40+ 个控件的工作量，收益是完全可控 |

**对比项目的情况不同**：B 用 FCL 的 `fcllibrary`（也是一个自研控件体系，
有 `FCLMenuView`、`FCLDynamicIsland`、`FCLTabLayout` 等），
并且有 `docs/reports/animation-vs-fcl.md` 记录"FCL 16 类动画 16/16 对齐"。
**这说明 B 走的是同一条路（自研控件 + 完整动画体系）**，
只是 B 是继承 FCL 的资产，PCL2 是自己建的。

值得借鉴的具体一条：**`MyLoadingStateSimulator` 的"感知性能"思路**。
B 有"入场动画去重"（`freshIds` 差集）等优化，
但"短任务也要有过渡感"这个角度可以再想。

#### 从内嵌 XAML 看控件的实际实现

**PCL2 的 XAML 是编译进程序集的**（`PCL.Resources.resources.bin`，45KB，
内含 41 个 XAML 模板）。把它们解码出来，能看到控件的真实结构——
而不是只能靠类型名推测。

**`MyButton` 的完整模板**（解码自 `controls__mybutton.xaml`）：

```xml
<p:MyButton Name="PanBack" Focusable="True" UseLayoutRounding="False">
  <p:MyButton.Child>
    <Border Name="PanFore" CornerRadius="3" BorderThickness="1"
            BorderBrush="{DynamicResource }" Background="{StaticResource }"
            RenderTransformOrigin="0.5,0.5">
      <Border.RenderTransform>
        <ScaleTransform />                 <!-- ★ 缩放动画载体 -->
      </Border.RenderTransform>
      <Border.Child>
        <TextBlock Name="LabText" FontSize="13" IsHitTestVisible="False"
                   TextOptions.TextFormattingMode="Display" SnapsToDevicePixels="True"
                   RenderTransformOrigin="0.5,0.5">
          <TextBlock.RenderTransform>
            <ScaleTransform />             <!-- ★ 文字独立缩放 -->
          </TextBlock.RenderTransform>
        </TextBlock>
      </Border.Child>
    </Border>
  </p:MyButton.Child>
</p:MyButton>
```

**三个关键机制**：

1. **`{DynamicResource}` / `{StaticResource}` 占位**
   —— 主题色在运行时注入，XAML 里不写死颜色。
   这就是 §12.4 里那套 `Color1..8` + 8 级灰阶的**消费端**。

2. **`ScaleTransform` 分别挂在 Border 和 TextBlock 上**
   —— 悬停/点击时的缩放动画有**两个独立载体**。
   这意味着可以做"边框放大但文字不放大"或"两者不同步"的效果。

3. **`SnapsToDevicePixels="True"` + `TextFormattingMode="Display"`**
   —— 像素对齐 + 显示模式文字渲染。
   **这是桌面应用追求"文字锐利"的典型做法**（代价是不适合任意缩放）。

**注意那个 `Foreground="{Binding Parent.BorderBrush, RelativeSource={RelativeSource Self}}"`**
（在我最初读到的版本里）——**文字颜色绑定到边框色**。
这是"一处改色，全控件联动"的 WPF 惯用法，
配合 `ColorState`（Normal/Highlight/Red 等状态）就能实现状态切换时的整体变色。

**对整个 `My*` 控件库的判断**：
PCL2 的控件是**"模板化 + 资源占位 + 变换动画"**三件套，
不是简单的样式叠加。41 个 XAML 模板 = 41 个精心设计的控件结构。

> 这也解释了为什么 PCL2 的 UI 看起来"有质感"：
> 它不是用现成控件拼的，而是**每个控件都从模板层设计过**。

**对对比项目的启示**：B 用 FCL 的 `fcllibrary`（也是自研控件体系），
路线相同。可借鉴的具体一点：**"文字色跟随父级色"的绑定模式**，
可以让"控件状态变化"只需改一个属性。


### 9.2 主题与皮肤

**先纠正一个常见误解**（我自己也先判错了）：`MySkin` **不是主题引擎**，
它是 **Minecraft 皮肤预览控件**（40 个方法，带前后图层 `_ImgBack`/`_ImgFore`、
披风按钮 `_BtnSkinCape`、保存/刷新按钮、鼠标按下状态）。

真正的主题引擎在 **`ModSecret`**（见 §12.4），配套三个枚举类型：

```vb
'Themes（主题枚举，全局命名空间）
Color / White / Black / Red / Custom      ← PCL2 的主题基色

'ColorState（控件状态 × 颜色的矩阵）—— 注意有三套不同定义（不同控件各用一套）
Normal / Highlight / Red                  ← 通用三态
Black / Highlight                         ← 深色控件两态
White / Highlight                         ← 浅色控件两态

'MyColor（31 个方法）                       ← 颜色工具类
```

**这是"控件状态 × 主题"的矩阵设计**：每个自定义控件用 `ColorState` 声明自己
需要哪几档颜色，由 `MyColor` 从主题基色（`ModSecret.Color1..8` + 8 级灰阶）
派生出具体值。所以换主题时不需要逐控件改，改基色 + HSL 参数即可。

#### 主题做成了"收集品"（彩蛋系统）

从字符串证据提取的完整主题列表：

```
十一个主题（"众所周知，十大主题一定有十一个！"）
  可见：极客蓝 / 欧皇彩 / 滑稽彩 / 玄素黑 / 跳票红 / 铁杆粉 / ...
  隐藏：真·滑稽彩 / 星空蓝 / ...

解锁文案（原样引用，刻意写得"欠打"）：
  "解锁新隐藏主题！"
  "隐藏主题 极客蓝 已解锁！{0}难道，这就是终点了？还是说……？"
  "* It fills you with determination."          ← Undertale 梗
  "点击千万别点，可以获得所有主题。"              ← 典型的"别按这个按钮"
  "这解密主题到底怎么解啊啊啊啊啊啊啊！"
  "隐藏主题解锁给点提示行不行啊 QAQ！"
  "我不会告诉你，鼠标悬浮在隐藏主题上，会显示出什么不可告人的秘密！"
  "属于宇宙的数字！"
  "需要解锁三个隐藏主题"
  "！PCL 中还有两种隐藏主题：真·滑稽彩和星空蓝。要怎么获得他们呢？提示：你猜！"

健壮性：
  "检测到尚未解锁的主题：{0}，已重置为默认主题"
  "解锁的主题列表存档已损坏，主题解锁已被重置"
  "检查主题失败" / "刷新主题颜色失败"
```

**设计解读**：

1. **主题是"成就"而非"设置"**。不能直接选，得先解锁。
   这把纯外观功能变成了**参与动机**——用户会去研究怎么解锁，
   从而更深入地了解这个软件。

2. **解锁状态持久化且有损坏恢复**。存档坏了就重置，不会崩。

3. **文案风格统一**：调皮、玩梗、假装不情愿。和 §12.5 的
   `"多线程被卡住了不玩手机玩什么呀！（绝望）"` 一致——
   **这是软件的性格，不是个别彩蛋**。

#### 离线自定义皮肤：动态生成资源包

**这是 PCL2 一个很巧的技术方案**。字符串证据完整揭示了实现：

```
"选择皮肤文件" / "皮肤文件"
"皮肤图片大小应为 64x32 像素或 64x64 像素！"      ← 两种合法格式
"正在构建自定义皮肤资源包，格式为："
",\"description\":\"PCL 自定义离线皮肤资源包\"}}"
"resourcepacks\PCL2 Skin.zip"                    ← ★ 生成一个资源包
"\"file/PCL2 Skin.zip\""
"CustomSkin.png" / "PCL\CustomSkin_Cliped.png"
"该 Minecraft 版本不支持双层皮肤，已进行裁剪"       ← ★ 按版本能力裁剪
"此 Minecraft 版本尚不支持 Alex 皮肤，你的皮肤可能会显示为 Steve！"
"Minecraft 版本过老，尚不支持自定义离线皮肤"
"正在清空自定义皮肤资源包"
"由于离线皮肤设置，使用正版 UUID：{0}"            ← 让正版服也能显示皮肤
```

配套枚举/字段：
```vb
McSkinInfo: IsSlim / LocalFile / IsVaild
LaunchSkinSlim / LaunchSkinType
```

**方案解读**：Minecraft 的离线登录本来无法自定义皮肤。PCL2 的做法是
**在本地动态生成一个资源包**（`resources\PCL2 Skin.zip`），
里面放用户的皮肤图，然后让游戏加载它。

难点处理得很细：
- **格式兼容**：64x32（旧版）和 64x64（新版）都支持
- **能力探测**：老版本不支持双层皮肤 → 自动裁剪；
  不支持 Alex（细手臂）模型 → 提前告知"可能显示为 Steve"
- **太老的版本** → 明确说不支持，而不是静默失败
- **`使用正版 UUID`**：即使用离线登录，也用正版 UUID 覆盖，
  这样在**正版服务器**里别人也能看到你的皮肤（而不是显示为默认皮肤）

> 这个方案体现了一个通用能力：**当平台不提供某个能力时，用平台的扩展机制
> （资源包）自造一个**，而不是"做不到就算了"。

### 9.3 动画：`ModAnimation`（36 个方法）

字符串里有 `"动画线程开始"` —— **动画走独立线程**，不是 WPF 的 Storyboard 驱动。
配套：`MyLoadingStateSimulator`（加载状态模拟器，用于让短任务也有过渡感）。
调用了 `ThrottleDebounce` 库做节流防抖。

### 9.4 页面体系

```
Page<区域><Left|Right>      左右分栏
PageDownloadInstall (246 方法！)  ← 下载安装页，最复杂的页面
PageSetupUI (255 方法！)          ← 设置页 UI
PageInstanceSetup (152) / PageInstanceMod (127) / PageLaunchLeft (106)
```

`PageDownloadInstall` 和 `PageSetupUI` 各 250+ 方法——**巨型页面类**，
把"一个页面的全部交互逻辑"塞进一个类。

---

### 9.5 设置绑定：XAML 里写个 key 就完事

**这是 PCL2 UI 工程中最优雅的一处设计**，也是"250 个方法的设置页"能管理得过来的原因。

#### 三层结构

```csharp
// ① 控件接口（每个输入控件实现）
public interface ISettingControl {
    void RefreshSetting(string NewValue);    // 从设置值刷新 UI
    string GetCurrentSetting();              // 从 UI 取出当前值
}

// 实现者：MyCheckBox / MyComboBox / MyRadioBox / MyTextBox / MySlider / ...

// ② 附加属性（XAML 里用）
public static class SettingService {
    public static readonly DependencyProperty KeyProperty   = /* string */;
    public static readonly DependencyProperty ValueProperty = /* string */;
    public static string GetKey(DependencyObject obj);
    public static string GetValue(DependencyObject obj);

    public static void ResetSettings(DependencyObject Target);   // 递归重置整棵子树
    public static void RefreshSettings(DependencyObject Target); // 递归刷新整棵子树
    public static void SaveSetting(object sender);               // 保存单个控件
}

// ③ 存储（三个来源）
enum Sources { Normal = 0, Registry = 1, Instance = 2 }
Settings.Get(key, instance) / Settings.Set(key, value, instance)
```

#### 使用方式

XAML 里就这样写：

```xml
<p:MyCheckBox p:SettingService.Key="VersionAdvanceJvm" Content="自动选择 JVM 参数" />
<p:MyComboBox p:SettingService.Key="VersionArgumentJavaV2" />
```

**不需要一行 C#/VB 代码**。`SettingService` 会自动：
1. 读取 `Settings.Get("VersionAdvanceJvm", 当前实例)` → 调用控件的 `RefreshSetting`
2. 用户改动 → 调用控件的 `GetCurrentSetting` → `Settings.Set(...)`
3. 「重载版本独立设置」按钮 → `ResetSettings(整个面板)` 递归重置所有 key

#### 递归实现

```csharp
public static void ResetSettings(DependencyObject Target) {
    // 先递归所有逻辑子元素
    foreach (var child in LogicalTreeHelper.GetChildren(Target).OfType<DependencyObject>())
        ResetSettings(child);
    // 再处理自己
    string key = GetKey(Target);
    if (key != null) Settings.Reset(key, PageInstanceLeft.Instance);
}
```

**这解决了一个实际问题**：实例设置页有几十个控件，
如果每加一个设置都要写"读值/写值/重置"三处代码，会极其繁琐且容易漏。

#### 一个细节：保存时检查动画状态

```csharp
public static void SaveSetting(object sender) {
    if (ModAnimation.AniControlEnabled != 0 || !(sender is ISettingControl))
        return;                                   // ★ 动画进行中不保存
    ...
}
```

**为什么**：`AniControlEnabled` 是"批量 UI 变更期"的闸门（§9.3）。
当整页在重建/换主题时，控件的 `SelectionChanged` 会因**代码设置值**而触发——
如果不拦，会把中间态的默认值写回设置。

**这是"程序性变更 vs 用户变更"的经典问题**，PCL2 用动画闸门顺手解决了。

#### 对比：Android 的等价问题

FCL/dsh 用 XML 布局，**没有附加属性机制**。等价的做法通常是：
- 手写 `findViewById` + 逐控件 `setOnCheckedChangeListener`
- 或者用 DataBinding / ViewBinding 的 `app:onCheckedChanged`

**PCL2 这套的价值**在于：
- **声明式**：key 写在布局里，逻辑在框架里
- **递归操作**：整面板刷新/重置是一行调用
- **来源可切换**：同一个 key，`Sources.Instance` 就是实例级，`Normal` 就是全局

**对 dsh 的启示**：如果实例设置页开始变多（现在有 `DshInstanceSettingPage`），
可以考虑一个类似的轻量抽象——**用一个注解或统一的 `SettingBinder` 把
"控件 ↔ 设置键"的映射集中起来**，而不是每处手写。

---

### 9.6 设计系统的"数字指纹"

从常量表（`ldc.i4` / `ldc.r8` 的字段初值）提取出的 368 个常量里，
有一组**能直接读出设计规范**的数字。

#### 动画时长：一个严格的模式

```
控件                    进入(ms)   退出(ms)   倍率
MyButton                100        200        2.0×
MyCheckBox              100        200        2.0×
MyRadioBox              100        200        2.0×
MyTextButton            100        200        2.0×
MyMenuItem              100        200        2.0×
MyIconTextButton        100        150        1.5×
MyExtraButton           120        150        1.25×
MyExtraTextButton       120        150        1.25×
MyIconButton            120        150        1.25×
MyRadioButton            90        150        1.67×
MyComboBoxItem          100        300        3.0×
```

**三个可读出的规范**：

1. **进入统一 100ms，退出统一 200ms**（主要控件）
   —— 退出是进入的**两倍慢**。

   **这是有意的**：进入要"快"，让操作感觉即时响应；
   退出要"缓"，让用户来得及看清发生了什么。

2. **变体分档**：
   - 标准控件 100/200
   - 次级按钮（Extra/Icon）120/150——**更短的行程，更短的时长**
   - 单选框（RadioButton）**最快**（90/150）——因为它的开合是最轻的交互
   - 组合框项（ComboBoxItem）**退出最慢**（300）——因为下拉菜单收起
     需要让用户确认选择

3. **颜色动画略慢于位置动画**：
   ```
   MyExtraButton: AnimationColorIn = 120, AnimationColorOut = 150
   ```
   而它的（未列出的）位置动画是 100/150。
   **颜色变化刻意慢一点**——因为颜色渐变比位移更难察觉，慢一点更顺眼。

#### 其他有价值的常量

```csharp
// ★ 真实的加密与认证参数
ModSecret.EcdsaPublicKey  = （Base64 编码的 ECDSA P-256 公钥，用于更新包验签）
ModSecret.OAuthClientId   = （微软登录用的应用注册 ID）
ModSecret.VersionBranchMain = "Official"
ModSecret.RegFolder       = "PCL"

// ★ 埋点（腾讯云 CLS，不是第三方分析）
ModSecret.ClsBaseUrl = "https://{region}.cls.tencentcs.com/track?topic_id=<APPID>"   // 发布版填的是具体区域与 APPID，此处脱敏

// 虚拟化与分页
ResourceSearcher.RESULT_PAGE_SIZE = 40
PageResource.PAGE_SIZE            = 40
PageSpeedLeft.WatcherInterval     = 300     // 网速轮询间隔 ms

// 性能探测
PageLinkMain.INVITE_CODE_VERSION = 2        // 联机邀请码协议版本

// 拖放（DragHelper 的 Win32 消息常量；本报告未展开其实现）
DragHelper.WM_COPYGLOBALDATA = 73
DragHelper.WM_COPYDATA       = 74
DragHelper.WM_DROPFILES      = 563          // ★ UAC 提权后恢复拖放的关键
DragHelper.MSGFLT_ADD        = 1
DragHelper.MAX_PATH          = 260
```

**`EcdsaPublicKey` 是一串 Base64** —— 这是 §12.3.3 里那套
`BCryptImportKeyPair` + `BCryptVerifySignature` 的**实际密钥**。
它用于验证更新包签名（防中间人替换）。

**`OAuthClientId`** 是微软登录用的应用注册 ID（相关处理见 §6.8 预启动阶段写 `launcher_profiles.json` 那一段）。

**埋点走腾讯云 CLS**（`ap-shanghai` 区域）——**不是 Google Analytics 或第三方**。
这符合 PCL2 一贯的"数据尽量留在国内、依赖尽量自建"的取向。

> **证据边界**：开源版源码里 `ClsBaseUrl = ""`（空串），region 只是 `{region}` 占位符；
> 上报逻辑 `Telemetry()` 有短路条件"`ClsBaseUrl` 不以 `http` 开头就不上报"。
> 所以具体的 `ap-shanghai` 只能从 2.13.1.1 发布版二进制的字符串堆里读到，
> 无法用源码交叉验证。

#### 这个常量表本身就是设计文档

**368 个常量集中在字段初值里**，而不是散落在方法体中。
好处是：
- 改动画时长不用翻遍代码（都在声明处）
- 命名统一（`AnimationTimeOfMouseIn` / `AnimationColorOut`）——
  看名字就知道是哪个交互的哪一段
- **可以整个提取出来当"设计规范"读**（就像这里做的）

**对 dsh 的启示**：对比项目（FCL）也在做类似的事（其仓库里记录了"16 类动画 16/16 对齐"）。
**下一步可以把这些时长也提成集中常量**
（如果还没），好处相同：改一处、全局一致、可审计。


---

## 10. 联机功能：内置 P2P 穿透（EasyTier）

PCL2 有一个**不太为人知但技术上很有意思**的功能：**一键联机**——
让玩家和朋友直连，不需要公网 IP、不需要端口映射、不需要第三方对战平台。

### 10.1 技术底座：EasyTier

从字符串证据：

```
"EasyTier\"                        ← 安装目录
"EasyTier CLI"
"准备下载联机模块" / "下载联机模块" / "启动联机模块"
"联机模块已崩溃" / "联机模块主时钟出错" / "读取 EasyTier 信息失败"
"tcp://mc1.easytier.cn:55558"      ← 自建的公共节点
"https://uptime.easytier.cn/api/nodes"  ← 社区节点源（首选）
"https://easytier.meloong.com/?page=1&per_page=1000"   ← 作者自建节点源（回退）
"从源站获取节点列表失败，将使用 CDN 缓存"
"CPU 是不支持的 {0} 架构，这可能会导致联机模块无法启动！"
```

**EasyTier 是一个开源的 P2P 组网工具**（Rust 写的，去中心化 VPN）。
PCL2 把它作为**外部 CLI 程序下载并管理**，而不是自己实现穿透。

### 10.2 用户流程

```
房主：
  "尝试创建房间，网络名 {0}，网络密码 {1}，端口 {2}"
  "已创建房间"
  "把邀请码发给朋友，让大家加入房间吧！\n邀请码：{1}"
  邀请码内容 = 网络名 + 密码（"实际使用的邀请码：{0}"）

加入者：
  "输入邀请码" / "输入房主发给你的邀请码。"
  "使用上一次的邀请码"              ← 记住上次的
  "嘿，是否使用复制的邀请码加入房间？"  ← 检测剪贴板（很贴心）
  "尝试加入房间，网络名 {0}，网络密码 {1}，端口 {2}，发现节点 {3}"
  "已加入房间\n在多人游戏页面的最下方就能找到联机房间！\n注意：使用离线登录时不要手动输入 IP！"
```

**错误处理覆盖了各种失败**：
```
"邀请码为空！"
"请让房主使用 PCL 创建房间！"              ← 邀请码不是 PCL 生成的
"请让房主使用非社区版的 PCL 创建房间！"     ← 社区版不支持联机
"邀请码有误，请让房主使用 PCL 创建房间！"
"你的 PCL 版本太老了，请在更新 PCL 之后再联机！"   ← 协议版本检查
"你已经在联机房间中了！"
"广播联机房间端口失败"
```

**"请让房主使用非社区版"** 这条很说明问题：正式版会**拒绝 10 位的社区版邀请码**
（源码注释里写作 `PCL CE`）。判据是**邀请码长度**——正式版的标准格式是 23 位，
任何 10 位字符串都被判为 CE，源码里没有解析、没有版本号比较、没有握手失败。
真正的协议版本检查是另一条分支（比较邀请码第 18–19 位嵌入的 `INVITE_CODE_VERSION`）。
所以这是**格式层面的不兼容**，不是协议握手层面的不互通。

另外，源码本身只区分 `OpenSource` / `Official` 两种构建（`VersionBranchMain`），
**没有"社区版"这个概念**——PCL-CE 是项目外独立维护的分支，这里只能从"被拒绝的邀请码长度"看出它的存在。

### 10.3 NAT 类型诊断（技术上最专业的部分）

```vb
enum NATTypes {
    Unknown, OpenInternet, NoPAT, FullCone,
    Restricted, PortRestricted, Symmetric,
    SymUdpFirewall, SymmetricEasyInc, SymmetricEasyDec, Pending
}
```

**这是 NAT 穿透领域的标准分类**（RFC 3489 / RFC 5780 的 NAT 行为学）：

| 类型 | 含义 | 穿透难度 |
| --- | --- | --- |
| `OpenInternet` | 公网 IP，无 NAT | 最容易 |
| `FullCone` | 全锥形 | 容易（经典 STUN 可穿透） |
| `Restricted` | 地址受限锥形 | 中等 |
| `PortRestricted` | 端口受限锥形 | 中等 |
| `Symmetric` | 对称型 | **最难**（需中继） |
| `SymUdpFirewall` | 对称 + UDP 防火墙 | 最难 |
| `SymmetricEasyInc/Dec` | 对称型的可预测变体 | EasyTier 的特殊优化 |

配套的状态枚举：
```vb
enum LinkStates { Waiting, Loading, Failed, Finished }
```

**用户可见的诊断信息**：
```
"{0} - {1} - Ping {2:0.0}ms [中继? {3}] - NAT {4}"
```
显示每个节点的：名称、地址、**延迟**、**是否走中继**、**NAT 类型**。

**这是给用户的完整质量报告**——如果延迟高或走了中继，用户能自己判断
"是不是我的网络问题"，而不是只看到"连不上"。

### 10.4 设计解读

| 决策 | 价值 |
| --- | --- |
| **不自研穿透，用成熟开源工具**（EasyTier） | 节省大量工作量，且 NAT 穿透是专门的领域 |
| **把 CLI 工具当"模块"管理**（下载/启动/崩溃检测） | 复用 §5 的 Loader 框架，行为一致 |
| **邀请码抽象** | 用户不需要理解"网络名/密码/节点"，只需要转发一串码 |
| **检测剪贴板**（"是否使用复制的邀请码"） | 减少一次手工操作 |
| **显示 NAT 类型 + Ping + 中继状态** | 用户可自助诊断，减少求助 |
| **社区版不提供** | 社区版邀请码是 10 位、正式版是 23 位，按长度直接判为不兼容 |
| **节点列表有 CDN 回退** | 单点故障时仍可用 |

**这是"平台化"的思路**：PCL2 不只启动游戏，还提供**联机基础设施**。
和它的"主页市场""整合包发布"一起，构成了一个**围绕启动器的小生态**。

---

## 11. 扩展系统：远程 XAML 主页

**这是 PCL2 最独特的架构决策**，也是它生态化的核心。

> **先纠正一个容易搞错的点**：主页不是 `PageLinkMain`（那是**联机页**，
> `PageLinkMain` 的成员是 `NATType` / `NetworkSecret` 两个私有字段，
> 外加一个 `GetInviteCode()` 方法——邀请码是拼出来的（网络名-网络密钥-版本），不是存储的字段）。
> **真正的主页是 `PageLaunchRight`**（`Pages\PageLaunch\PageLaunchRight.xaml.vb`，
> 即“启动页右侧”），它实现了 `IRefreshable` / `IDispatcherUnhandledException`。

### 11.1 它允许什么

主页的内容可以来自四种来源（`Settings.UiCustomType`）：

```
0 = 空白
1 = 本地文件      PCL\Custom.xaml
2 = 联网          用户输入的 URL
3 = 预设          20 个内置预设（2 个内嵌 XAML + 18 个社区 URL）
```

然后这个 XAML **被直接实例化成 UI**。

### 11.2 完整流水线（源码级）

```
Refresh()  → RunInThread(RefreshReal)，外套 RefreshLock 互斥

RefreshReal()  switch (UiCustomType)：
  ├ case 1 (本地)：读 <启动器目录>\PCL\Custom.xaml
  ├ case 2 (联网)：url = UiCustomNet
  └ case 3 (预设)：20 路 switch
       前 2 个 = 编译进 IL 的 XAML 字面量（约 1200 字符）
       后 18 个 = 硬编码 URL

  ── 联网缓存逻辑（url 非空时）──
  若 CacheSavedPageUrl == url 且 %TEMP%\PCL\Cache\Custom.xaml 存在：
      日志"主页自定义数据来源：联网缓存文件"
      先读缓存填充 UI → 后台启动版本检查 loader
  否则：
      日志"主页自定义数据来源：联网全新下载"
      Hint("正在加载主页……")
      RunInUiWait(LoadContent(null))          ← 先清空 UI
      Settings.Set("CacheSavedPageVersion", "")
      启动 loader（Input = (url, forceDownload=true)）

OnlineLoaderSub(url, force)：          ← 版本检查 + 下载
  1. 占位符替换（值做 HtmlEncode）
  2. 推导版本地址：
       含 ".xaml"  → url.Replace(".xaml", ".xaml.ini")
       否则        → {url去query}/version
  3. GET 版本文本，长度 > 1000 字符 → 抛"获取的主页版本过长（{0} 字符）"
  4. 与 CacheSavedPageVersion 比较：
       相同且都非空 → "当前缓存的主页已为最新" → return（不下载）
       否则 → "需要下载联网主页"
  5. ★ 版本请求失败时 fail-open：
       "无法检查联网主页版本，将直接下载" → 继续下载
  6. 下载正文 → 更新 CacheSavedPageUrl/Version → 写缓存 → 递归 Refresh()

LoadContent(content)：                 ← 实例化
  · SyncLock + GetStableHashCode(content) 比较
    → 内容未变则直接跳过（幂等，避免重复解析）
  · PanCustom.Children.Clear()
  · 占位符替换（★ 值做 XmlEscape —— 防注入）
  · ★ 命名空间剥离：
      while content.Contains("xmlns"):
          RegexReplace(content, "xmlns[^\"']*(\"|')[^\"']*(\"|')", "")
      然后 Replace("xmlns","")
  · 包裹固定外壳（6 个 ns 前缀：presentation/x/sys/local/core/corewpf）
  · ModBase.GetObjectFromXML(content)   ← ★ 消毒器（见 11.5）
  · PanCustom.Children.Add(...)
  · 耗时 > 3000ms → Hint("主页加载过于缓慢（花费了 {0} 秒）…")
```

**三个值得注意的设计**：

1. **版本检查是 `.xaml.ini` 同级文件**（或 `/version`）——
   主页作者只需在服务端放一个小文本文件写版本号，**用户不必重下整个主页**。

2. **缓存放在 `%TEMP%\PCL\Cache\Custom.xaml`**，不是启动器目录。
   `PathTemp` 可由设置重定向。**放临时目录意味着系统清理时会自动清掉。**

3. **命名空间剥离 + 固定外壳注入**——这是**安全的第一道防线**（见 11.5）。

### 11.3 自定义事件：24 种能力（不是任意代码）

XAML 里可以声明事件，由启动器执行：

```xml
<local:MyButton EventType="刷新主页" EventData="/" Content="刷新" />
```

**`EventType` 是枚举，共 24 项**（源码级，完整执行语义）：

| 值 | 事件 | 行为 |
| --- | --- | --- |
| 1 | 打开网页 | `OpenWebsite(url)`，必须含 `://` |
| 2 | 打开文件 | 路径解析 → **安全确认** → `ProcessStartInfo` 启动 |
| 3 | 打开帮助 | 进入帮助页 |
| 4 | 执行命令 | 同 2（语义区分） |
| 5 | 启动游戏 | 参数 `\current` 取当前实例；可带服务器 IP 直连 |
| 6 | 复制文本 | 写剪贴板 |
| 7 | 刷新主页 | `ForceRefresh()` |
| 8 | 刷新页面 | 需当前页实现 `IRefreshable` |
| 9 | 刷新帮助 | |
| 10 | 今日人品 | 彩蛋功能 |
| 11/12 | 内存优化 / 清理垃圾 | 后台任务 |
| 13 | 弹出窗口 | ≥2 个参数：`标题\|内容[|按钮]` |
| 14 | 弹出提示 | `Hint(内容[, 等级])` |
| 15 | 切换页面 | 按 `PageType` 枚举跳转 |
| 16/17 | 导入 / 安装整合包 | UI 线程内执行 |
| 18 | 下载文件 | **强制 http(s)**（否则提示"PCL 不支持其他乱七八糟的下载协议"） |
| 19/20 | 修改 / 写入设置 | `键\|值` → `Settings.SetSafe` |
| 21/22 | 修改 / 写入变量 | ★ **写注册表** `HKCU\Software\PCL\CustomEvent{键}` |
| 23 | 加入房间 | 空参数弹输入框；带码直接加入 |
| 24 | 检查更新 | |

**危险事件有二次确认**（`CustomEvent.EventSafetyConfirm`）：
- 打开文件 / 执行命令 → "即将执行：…"（可勾选"今后不再要求确认"）
- 下载文件 → "即将从该网址下载文件"
- 加入房间 → 确认

**触发机制**：`ModMain.RaiseCustomEvent(obj)` 在每个控件交互后被调用——
**全程序集扫描出 16 个控件挂载了事件**（MyButton / MyIconButton / MyCheckBox /
MyRadioBox / MyRadioButton / MyComboBox / MyMenuItem / MySearchBox /
MyTextBox / MyExtraButton / MyExtraTextButton / MyIconTextButton /
MyTextButton / MyCard / MyHint …）。

**"任意控件挂任意事件"**——这就是"可编程仪表盘"的实现。

### 11.4 占位符系统：宿主数据的注入点

`ModMain.ArgumentReplace(input, escapeHandler, bool)` 在解析前替换。

**变量清单**（源码级）：

```
版本信息:  {pcl_version} {pcl_version_code} {pcl_version_branch} {pcl_build_type}
          {pcl_branch} {pcl_md5} {pcl_sha1}
路径:      {path} {path_with_name} {path_temp} {version_path} {verpath}
            {version_indie} {verindie}
环境:      {date} {time} {java} {minecraft}
加载器:    {forge} {fabric} {neoforge} {liteloader}
账户:      {user} {uuid} {login}
机器:      {identify}

动态取值:  {hint}                         → 随机"你知道吗"提示
          {cave}                         → 随机"回声洞"
          {setup:<键>}                    → Settings.GetSafe(键, 当前实例)
          {variable:<名>[:默认值]}         → ★ 读注册表 CustomEvent<名>
```

**两个关键安全设计**：

1. **所有替换值都过 `escapeHandler`**
   - 主页内容 → `XmlEscape`
   - URL → `HtmlEncode`

   **这意味着变量值无法注入标记**——即使用户在注册表里写了 `</MyCard><evil>`，
   它会被转义成文本而不是结构。

2. **`{variable}` 让主页可以持久化状态**

   教学文件里有个"隐藏百度 Logo"的按钮，实现是：
   ```xml
   <local:MyButton EventType="修改变量" EventData="TutorialVisibility1|Collapsed" />
   <local:MyImage Visibility="{variable:TutorialVisibility1:Visible}" />
   ```
   点一下就写注册表，下次打开还是隐藏的。

   **这是"零后端的持久化"** —— 不需要服务器，主页就有跨会话状态。

### 11.5 安全分析：一个真实的自研 XAML 消毒器

**在 WPF 里加载远程 XAML 确实是一个代码执行面**——
XAML 能通过 `xmlns` 引用任意 .NET 类型，能构造对象、设置属性。
PCL2 的做法值得细看，因为**它真的实现了消毒器**（不是靠自觉）。

#### 第一道防线：命名空间剥离（`LoadContent`）

```csharp
// 删除所有 xmlns 声明
while (content.Contains("xmlns"))
    content = RegexReplace(content, "xmlns[^\"']*(\"|')[^\"']*(\"|')", "");
content = content.Replace("xmlns", "");

// 注入恰好 6 个前缀（固定外壳）
var wrapper = "<StackPanel "
    + "xmlns=...presentation "
    + "xmlns:sys=clr-namespace:System;assembly=mscorlib "
    + "xmlns:x=... "
    + "xmlns:local=clr-namespace:PCL;assembly=Plain Craft Launcher 2 "
    + "xmlns:core=clr-namespace:MeloongCore;assembly=MeloongCore "
    + "xmlns:corewpf=clr-namespace:MeloongCore.Wpf;assembly=MeloongCore.Wpf>"
    + content + "</StackPanel>";
```

**效果**：远程 XAML **不能声明任意 `clr-namespace:` 引其他程序集**。
它只能引用 PCL、MeloongCore(.Wpf)、mscorlib 里的给定命名空间。

**这道防线比黑名单更根本**——它从根上限制了"能碰到哪些类型"。

#### 第二道防线：类型黑名单（`ModBase.GetObjectFromXML`，590 条 IL）

```csharp
// 用 XamlXmlReader 遍历 token 流
while (reader.Read()) {
    Type[] forbidden = {
        typeof(System.Windows.Controls.WebBrowser),   // 内嵌浏览器
        typeof(System.Windows.Controls.Frame),        // 导航
        typeof(System.Windows.Controls.MediaElement), // 媒体
        typeof(System.Windows.Data.ObjectDataProvider),  // ★ 能调任意方法
        typeof(System.Xaml.XamlReader),               // ★ 递归加载（绕过检查）
        typeof(System.Windows.Window),                // 开新窗口
        typeof(System.Windows.Data.XmlDataProvider),  // XML 绑定（XXE）
        typeof(PCL.SettingService),                   // ★ 直读写设置
    };
    foreach (Type t in forbidden) {
        if (t.IsAssignableFrom(reader.Type?.UnderlyingType))
            throw new UnauthorizedAccessException($"基于安全考虑，不允许使用 {t.Name} 类型。");
        if (Equals(reader.Value, t.Name))
            throw new UnauthorizedAccessException($"基于安全考虑，不允许使用 {t.Name} 值。");
    }
    // 成员黑名单
    string[] forbiddenMembers = { "Code", "FactoryMethod", "Static" };
    foreach (string m in forbiddenMembers) {
        if (reader.Member?.Name == m)
            throw new UnauthorizedAccessException($"基于安全考虑，不允许使用 {m} 成员。");
    }
}
System.Windows.Markup.XamlReader.Load(stream);   // 消毒后真正加载
```

**为什么这 8 个类型选得准**：

| 类型 | 挡住的攻击 |
| --- | --- |
| `ObjectDataProvider` | **调任意方法**（`MethodName` + `ObjectInstance`）——这是 XAML 里最经典的代码执行路径 |
| `XmlDataProvider` | 数据绑定 + XXE |
| `XamlReader` | **递归加载**——外层合法、内层未检查，最关键的堵漏 |
| `SettingService` | 恶意主页改写设置（比如把下载源指向恶意镜像） |
| `WebBrowser` / `Frame` / `MediaElement` | 绕过 PCL 的网络策略，直接加载外部内容 |
| `Window` | 弹伪造窗口钓鱼 |

**成员黑名单的三个名**也是精确打击：
- `Code` = `x:Code` 内联代码（XAML 里唯一能直接写代码的地方）
- `FactoryMethod` = 对象工厂调用
- `Static` = `{x:Static}` 静态成员访问（PCL2 的 `System.Xaml` 生态里这是反射入口）

**遍历 token 流而不是文本正则**：无法通过编码变形绕过。

#### 第三道防线：事件走受控执行器

```csharp
// 预改写：把裸 EventType 改写成限定名
content.Replace("EventType=\"", "local:CustomEventService.EventType=\"")
       .Replace("EventData=\"", "local:CustomEventService.EventData=\"")
       /* … 共 8 组，覆盖单双引号和 Property 形式 … */;
```

**效果**：用户写 `<MyButton EventType="刷新主页" />` 而**不需要引用任何命名空间**，
且事件只能进 §11.3 的 24 项枚举执行器——**不能是任意代码**。

#### 第四道防线：其他缓解

```
④ 版本响应长度限制    >1000 字符抛"获取的主页版本过长"
⑤ 用户可见警告        "请谨慎使用陌生人提供的主页，恶意代码可能会造成损害！"
                     （黄色提示条，可关闭）
⑥ 危险事件二次确认    打开文件/执行命令/下载/加入房间
⑦ 幂等实例化          哈希相同则跳过，避免重复解析
⑧ 慢加载提示          >3 秒提示"请向主页作者反馈"
⑨ 错误兜底            XamlParseException → Handled=true + 显示错误 + 保留重试按钮
⑩ 拖拽加载有覆盖确认   拖入 .xaml 时若已存在会问"是否覆盖"
```

#### 审计视角的观察（设计取舍）

> 以下是对该消毒器**设计边界**的分析，目的是学习"如何审计一个声明式 UI 加载面"。
> **不含任何利用步骤**。

| 设计取舍 | 说明 |
| --- | --- |
| **长度限制只覆盖版本响应** | 主页正文本身无长度上限。设计上依赖"3 秒慢加载提示"作为体验兜底，而非硬性阻止 |
| **`local:` 命名空间内的类型仍可达** | 消毒器限制了"能引用哪些程序集"，但没有逐一审计 PCL 自身控件的构造副作用。这是一个**可继续深入的审计方向** |
| **图片源未做来源限制** | `MyImage.Source` 不做 URL 白名单。这在功能上是必要的（主页要能显示远程图片），但意味着**主页作者能观察到请求来源**——这是所有"远程内容 + 远程图片"架构的共性，不是本工具特有的缺陷 |
| **内容完整性靠哈希而非签名** | 用哈希判重（避免重复下载），但不做签名校验。项目把更新的完整性要求（MsDelta + ECDSA）和主页的要求分成了两档——**这是有意的风险分级** |
| **黑名单而非白名单** | 列了 8 个禁止类型，而不是"只允许这些类型"。WPF 类型数以千计，黑名单天然是"覆盖已知危险"而非"穷尽安全" |

**风险判断**：这是**"桌面端合理、移动端绝不可行"**的典型。
桌面用户对本地机器有完全控制权，主页能做的事不比"下载一个 exe 运行"更多；
而移动端沙箱模型完全不同。

**但它的威胁模型认识是清醒的**——8 个类型精确覆盖了
"间接代码执行"的常见路径，说明作者知道自己在防什么。

### 11.6 预设系统：把社区作品变成官方分发渠道

**20 个预设**，全部编译进 IL（不是资源文件）：

```
0  你知道吗？                      内嵌 XAML 字面量
1  回声洞                          内嵌 XAML 字面量
2  Minecraft 新闻（最亮的信标）     https://mcnews.meloong.com
3  简单主页                         pclhomeplazaoss.lingyunawa.top:26994/...
4  每日整合包推荐（wkea）           pclsub.sodamc.com
5  Minecraft 皮肤推荐（wkea）       forgepixel.com/pcl_sub_file
6  OpenBMCLAPI 仪表盘 Lite          pcl-bmcl.milu.ink
7  主页市场                         pclhomeplazaoss...:26994/p/Homepages/Homepage.Market/
8  更新日志（Joker2184）            .../Joker2184/UpdateHomepage.xaml
9  PCL 新功能说明书（WForst-Breeze）raw.gitcode.com/WForst-Breeze/WhatsNewPCL/...
10 OpenMCIM Dashboard               files.mcimirror.top/PCL
11 杂志主页（CreeperIsASpy）        http://118.195.192.193:26995/...   ← 纯 http
12 PCL GitHub 仪表盘（Deep-Dark-Forest） ddf.pcl-community.top/Custom.xaml
13 PCL 更新摘要（pynickle）         raw.gitcode.com/ENC_Euphony/...
14 今日新闻热点（EYicheng）         pcl.wyc-w.top/index.xaml
15 Minecraft 芝士站（awaEric233）   www.xxag.top/mkss
16 整合包推荐引擎（CHMYGZ）         qawsedrftgyhujiko.fun/pcl2/Custom.xaml
17-19 Bangumi / Bilibili / 云音乐    *.p.kaphia.qzz.io
```

**注意 `0` 和 `1` 是内嵌的 XAML 字面量**（约 1200 字符，直接 `ldstr`），
其余 18 个是社区作者的 URL——**标题里带作者署名**。

**投稿通道**：联网模式的提示条挂了事件
`EventType=1, EventData="https://github.com/Meloong-Git/PCL/discussions/2528"`。

**这个系统的价值**：把社区作品变成**官方分发渠道**——
作者只要提供一个 URL，PCL2 的预设列表里就有它，
而且**能在服务端更新**（版本探测机制），不必让 PCL2 发版。

### 11.7 教学文件：把用户变成作者

设置页有个"生成教学文件"按钮（`BtnCustomFile_Click`）→
`ExtractResources("PCL\Custom.xaml", "Custom")` 释放内嵌资源。

**这个文件是 28,188 字节的完整教学**，含 31 个 `MyCard` 示例，
覆盖全部事件类型用法。它的首行注释是作者口吻：

> "这是 PCL 的主页自定义文件……如果你倒腾这个文件把 PCL 玩炸了，
> 把这个文件直接删除就行了"

**配套的三件套**：
1. **教学文件**（照着写）
2. **拖拽加载**（`FormMain` 的拖放处理器：后缀 `.xaml` → 问是否覆盖 → 写入并刷新）
3. **`{variable}` 变量**（有状态）

**结果**：一个不懂编程的用户也能改主页（改文字、换图片、加按钮），
而懂一点的可以做出"仪表盘""推荐引擎"。

### 11.8 帮助系统走同一条管线

`PageOtherHelpDetail.Init`（244 条 IL）对帮助 XAML 做
**同样的命名空间剥离 + 包裹 + `GetObjectFromXML`**。

即：**远程帮助页也过同一个消毒器**。

而且 `HelpEntry` 支持 `IsEvent` / `EventType` / `EventData` 字段——
**帮助条目可以直接变成事件菜单项**（点一下"清理垃圾"就执行）。

内嵌的 `Help.zip` 有 **43 条帮助条目**（JSON + XAML），
验证了"JSON → XAML → 消毒器"这条同管线。

### 11.9 设计意图与得失

#### 为什么选"远程 XAML"而不是"JSON 驱动 UI"

**四个理由**（都是源码可证的）：

1. **零新渲染层**。PCL2 自身 UI 就是 WPF/XAML（用 `DynamicResource ColorBrush1`
   动态换肤）。XAML 直接复用全部自绘控件与主题系统，
   **连"护眼模式"都自动跟随**。JSON 方案要么造一套 JS 运行时，要么重写控件映射表。

2. **表现力 = 功能**。主页可挂任意控件 + 事件，
   直接调启动游戏/开网页/下载/写设置，成为"可编程仪表盘"——
   这是纯配置格式做不到的。

3. **分发即内容**。主页可在服务端更新，作者不必发版；
   预设区把社区作品变成官方渠道。

4. **用户可编程性**。本地文件 + 拖拽 + 教学文件 + `{variable}`，
   形成一套低门槛的"用户脚本层"。

#### 代价

1. **执行面巨大**。XAML = 对象图 + 绑定 + 事件，本质是代码执行。
   对策是黑名单消毒器——属"缓解"而非"隔离"。

2. **无签名、部分无 TLS**。内容凭哈希判重但无签名；
   预设含明文 http 目标。**主页的优先级明显被定为"低价值/低风险"**。

3. **隐私**。远程主页可加载任意图片 URL，等于给作者一个客户端 IP 信标。

4. **体验风险由用户承担**（有提示 + "删除即恢复"兜底）——
   **作者选择了"功能优先"**。

#### 对 dsh 的启示（重要）

**如果 dsh 想对标这种扩展性，最小可行切口是**：

```
静态布局（现有 XML）
+ 受控事件总线        ← 等价 CustomEventService（枚举化能力，不是任意代码）
+ 变量/占位符命名空间  ← 等价 ArgumentReplace + 注册表变量
```

**不必触碰 WebView/JS 沙箱**。PCL2 证明了：
**枚举化能力（24 个动作）+ 声明式 UI + 持久变量**，
就能做出足够的扩展性，而且安全性可控得多。

**PCL2 的消毒器清单本身就是一份"声明式 UI 逃逸面"威胁清单**，
可直接映射为 Android 侧的黑名单：
```
WebBrowser   → WebView
Frame        → 隐式 Intent 跳转
ObjectDataProvider / XmlDataProvider → 反射/数据绑定逃逸
XamlReader   → 动态代码加载
Window       → 新 Activity
SettingService → 直接读写配置
Code / Static / FactoryMethod → 动态执行入口
```


---

## 12. 值得注意的工程细节

### 12.1 字符串常量的信息密度

PCL2 把**执行日志当字符串常量内联**，这让静态分析出奇地有效：
```vb
Log("下载原版支持库文件")     ' 阅读方法字符串 = 阅读执行流程
```
代价是国际化困难（中文硬编码），但换来的是**"字符串即文档"**——
本次分析的绝大部分结论都来自这些字符串。

### 12.2 调试路径泄漏 —— 意外还原了完整源码树

所有方法里都带完整源码路径（`CallerFilePath` 特性留下的，用于异常堆栈定位）。
**发布版没剥离**，直接暴露了源码目录结构。

用 UTF-16LE 扫描整个 `.text` 段（554 万字节），还原出 **52 个源码路径**
（这些是 PCL 作者编译机上的路径，随调试信息留在发布版里，不是本手册分析者的路径）：

```
E:\Projects\PCL\本体代码\
├── MeloongCore\                         ← 独立共享库（作者自建，submodule，其自身仓库用 Apache-2.0）
│   └── Shared\
│       ├── Utils\  CryptographyUtils.cs, DirectoryUtils.cs, FileUtils.cs,
│       │           PathUtils.cs, RegistryUtils.cs, TaskUtils.cs
│       ├── Extensions\  StringExtensions.cs
│       └── General\     Config.cs, Logger.cs, MsDelta.cs
├── PCLCS\                               ← C# 辅助库（主工程是 VB）
│   ├── Java.cs
│   └── Launch\LaunchUtils.cs
└── Plain Craft Launcher 2\              ← 主工程（VB.NET + WPF）
    ├── Application.xaml.vb
    ├── Controls\                        ← 自研控件库
    │   ├── MyCheckBox.xaml.vb, MyComboBox.vb, MyExtraButton.xaml.vb,
    │   │   MyIconTextButton.xaml.vb, MyImage.vb, MyListItem.xaml.vb,
    │   │   MyScrollBar.vb, MySlider.xaml.vb, MyTextButton.vb
    │   └── MyMsg\  MyMsgInput.xaml.vb, MyMsgSelect.xaml.vb, MyMsgText.xaml.vb
    ├── Modules\
    │   ├── Base\      ModAnimation.vb, ModNet.vb, MyBitmap.vb
    │   ├── Minecraft\ ModDownload.vb, ModJava.vb, ModLaunch.vb, ModMinecraft.vb
    │   └── Resource\  LocalResourceLoaders.vb, ResourceProject.vb
    └── Pages\
        ├── PageDownload\  ModDownloadLib.vb, Resource\MyResourceItem.xaml.vb,
        │                  Resource\PageDownloadCompDetail.xaml.vb
        ├── PageInstance\  MyLocalModItem.xaml.vb, PageInstanceLeft.xaml.vb,
        │                  PageInstanceMod.xaml.vb, PageInstanceSetup.xaml.vb
        ├── PageLaunch\    MyMsgLogin.xaml.vb, MySkin.xaml.vb,
        │                  ★ PageLaunchRight.xaml.vb ← 主页！PageLoginAuthSkin/PageLoginMs.xaml.vb
        ├── PageLink\      PageLinkMain.xaml.vb ← 联机页（NAT 类型 / GetInviteCode 合成邀请码）
        └── PageSetup\     PageSetupLaunch.xaml.vb, PageSetupLeft.xaml.vb,
                           PageSetupSystem.xaml.vb
```

**几个有价值的发现**：

1. **命名约定统一**：`Mod*.vb`（模块）、`Page*.xaml.vb`（页面）、`My*.xaml.vb`（自研控件）。
   和类型名完全一致 —— 说明架构是**先设计分类再写代码**，不是随意堆砌。

2. **`MeloongCore/MsDelta.cs`** —— **微软的差分更新算法**（MSDelta，Windows 系统更新用的
   二进制差分格式）。这说明 **PCL2 的自更新是差分的**（只下载变化的部分），
   而不是每次下载完整包。这解释了它为什么能把 5.5MB 的程序更新得很快。
   同一个目录还有 `CryptographyUtils.cs`（ECDSA P-256 验签，见 §12.3）。

3. **`PCLCS/Java.cs`** —— Java 相关逻辑用 **C#** 单独写（主工程是 VB）。
   说明作者在需要更精确控制的模块上会切换语言。

4. **`MyBitmap.vb`** 在 `Modules/Base/` 下 —— 位图工具（配合 WebP 解码库用）。

5. **`PageLaunch/MySkin.xaml.vb`** —— 确认了 `MySkin` 属于"启动页"（皮肤选择在启动页），
   而不是通用控件（印证 §9.2 的修正）。

**对开发者的教训**：如果不想暴露源码结构，编译时要剥离 `CallerFilePath`。
但对逆向者是礼物 —— 它让"类型名 → 源码文件 → 目录归类"这条链完全闭合。

### 12.3 `MeloongCore`：藏在主程序里的通用基础库

**这是逆向中最意外的一块收获**。从 `.text` 段的 UTF-16 数据里，
还原出了 `MeloongCore` 这个**独立共享库**的完整能力清单
（它和 `MeloongCore.Wpf` 分别被主工程与 `PCLCS` 引用——是这两个库各自被引用，不是 Wpf 用 Shared）。

#### 12.3.1 日志系统（`Logger.cs`）

```
"日志初始化结束"
"开始轮转日志文件" / "整理日志文件失败"
"{0:HH':'mm':'ss'.'fff} {1} {2}[{3}]"       ← 时间戳 + 级别 + 来源
"<Async>"                                    ← 异步任务标记
"<{0} · {1}>"                                ← 任务名 + 阶段
"可能同时开启了多个程序，这或许会导致未知问题"   ← ★ 多实例检测！
```

**多实例检测**是个细节：日志文件被占用时会给出明确提示，
而不是静默失败或覆盖。对比项目的 `DshLogBus` 也做了类似的事
（`FIFO 保序` + `写失败有界重试`），但 PCL2 把它做成了一条用户可见的诊断。

#### 12.3.2 配置文件 + 加密（`Config.cs`）

```
"配置已修改：{0} = {1}"
"读取配置文件失败" / "config.json" / "secret.json"
"未找到密钥：{0}"
"解密配置失败，该配置将被重置"
"EncryptKey"
"加密需要改为使用识别码，现在尚未实现。"      ← ★ 开发者的 TODO！
```

**两个发现**：

1. **配置分公开和私密两部分**（`config.json` vs `secret.json`），
   敏感的走加密（配合 §12.4 的 AES-HMAC）。
2. **开发者遗留的 TODO 被发布出去了**："加密需要改为使用识别码，现在尚未实现。"
   —— 说明设计上计划从固定密钥（`EncryptKey`）迁移到用机器识别码派生（具体实现未见）。
   **这和 dsh 项目的 `registerSecret` token 脱敏是同类问题的两种阶段**。

#### 12.3.3 密码学实现（`CryptographyUtils.cs`）

从字符串还原出的**完整实现路径**：

```
对称加密:  "AES-HMAC|"                        ← 自定义封装格式（带 MAC）
           "数据不是一个有效的 Base64 字符串"
           "对称加密数据长度有误"
           "对称加密数据校验失败"              ← HMAC 校验失败

非对称:    "ECDSA_P256"
           "BCryptOpenAlgorithmProvider"      ← ★ Windows CNG API
           "ECCPUBLICBLOB" / "ECCPRIVATEBLOB" ← CNG 的密钥 BLOB 格式
           "BCryptImportKeyPair"
           "BCryptVerifySignature"            ← 验签（更新包校验）
           "BCryptSignHash"                   ← 签名
           "签名验证失败"
           "{0} 失败，错误码 {1}"              ← CNG 错误码透传
```

**评价**：这是**正确且扎实的做法**——
- 直接用 Windows CNG（`bcrypt.dll`）而不是自己实现椭圆曲线运算
- 用标准的 BLOB 格式（`ECCPUBLICBLOB` / `ECCPRIVATEBLOB`）
- AES-HMAC 组合（加密 + 完整性，不是裸 AES）
- 注意：这个模块**不在 P/Invoke 列表里**——因为 .NET 的 `System.Security.Cryptography`
  内部已经封装了 CNG，所以这些 API 名是字符串而非 P/Invoke 声明。

**用途**（结合 §12.4）：**更新包的 ECDSA 验签** + **配置/凭据的 AES 加密**。

#### 12.3.4 差分更新（`MsDelta.cs`）

```
"正在生成补丁：{0} → {1}，补丁文件将输出到：{2}"
"补丁文件不存在：{0}"
"正在应用补丁：原始文件 {0} + 补丁文件 {1} → 输出至 {2}"
```

**这是微软的 MSDelta 算法**（Windows 系统更新用的二进制差分格式）。

**意义**：PCL2 的自动更新**不是每次下载完整的 5.5MB**，
而是**下载"旧版→新版"的补丁**。一个 5.5MB 的程序，
两个版本之间的差异可能只有几百 KB。

**这是一个成熟桌面应用才会做的优化**——移动端项目（对比项目 B）
通常直接下整包，因为：
- 补丁的生成需要服务端配合（为每个旧版本预生成）
- 移动端的存储/网络约束让"多一次差分计算"不划算

**但有一个变体值得 B 考虑**：**资产文件（rootfs/scripts）的差分**。
如果 rootfs 有 300MB，而每次更新只改几个脚本，
"重下 300MB"和"下 1MB 补丁"的差距是巨大的。

#### 12.3.5 其他工具（`DirectoryUtils.cs` 等）

```
文件夹操作（完整语义）:
  "复制文件夹到自身，不执行操作"
  "复制文件夹到自身，但大小写不同，等效于重命名文件夹"    ← ★ 大小写敏感处理！
  "剪切文件夹到同一磁盘" / "剪切文件夹到不同磁盘"        ← 跨盘要复制+删除
  "删除文件夹到回收站"
  "无法将文件夹删除到回收站，回退到永久删除"             ← ★ 优雅降级
  "不应操作磁盘根目录" / "不应操作文件夹"                ← ★ 安全护栏
  "该文件夹可能为孤立的符号链接，尝试直接删除"           ← ★ 边界情况

Worker 工具（RedoableWorker.cs）:
  "接到重启请求"
  "从未成功完成过"
  "该 Worker 没有返回值。"

区间解析工具:
  "子项进度必须为正数且不能为空"
  "开头必须是 [ 或 (" / "结尾必须是 ] 或 )"
  "需要用逗号分隔两个值"
  "-∞" / "+∞" / "∞" / "(" / "[" / ")" / "]"           ← 数学区间语法
"没有定义 FlagsAttribute"                                ← 枚举校验
```

**`DirectoryUtils` 的护栏值得注意**：
- **"不应操作磁盘根目录"** / **"不应操作文件夹"** —— 硬编码的防误删保护
- **"剪切到不同磁盘"** —— 识别出跨盘剪切必须用复制+删除（不是 `move`）
- **"大小写不同等效于重命名"** —— 处理 Windows 文件系统的大小写不敏感特性
- **"回收站回退到永久删除"** —— 优雅降级而不是直接失败

**这些是"被真实用户的数据损失教育出来的"护栏**。
对比项目 B 的 `deleteRecursively` 目前没有这些保护——
考虑到 B 管理着 300MB 的 rootfs 和用户实例数据，**这几条值得在自己的实现里独立考虑**：

```kotlin
// 建议给 DshInstances.delete / DshPaths 加：
- 拒绝对 filesDir 根、dsh 根目录做递归删除
- 跨卷（不同存储）时不要用 rename，用 copy+delete
- 删除前检查路径是否在预期根之下（防止路径拼接 bug 导致删错地方）
```


#### 12.3.6 内嵌程序集 `PCLCS`

`AssemblyRef` 里有 `PCLCS` 但在文件系统上找不到——因为它**作为资源打包在主程序内**
（`ManifestResource: 2` 的来源）。从资源里提取出来是 **918KB、68 个类型、175 个方法**。

**它的用途**：**枚举与工具的定义库**（Objective-C 式的"共享常量 + 工具"分离）。

```
PCLCS 命名空间的类型：
  Configs / ResourceTypes / ResourcePlatforms / ModLoaders   ← 枚举（前三个是 [Flags] 位标志）
  Versions                                                  ← 静态类 + const，不是枚举
  Java / JavaUtils / LaunchUtils   ← Java 检测与启动（异步：CheckAllAsync / SearchFoldersAsync）
  WikiEntry / Resource             ← 数据模型
```

**这些定义本身揭示了设计细节**：

```vb
' 每个子系统独立版本号（静态类 + const，不是枚举）—— ★ 这是正确做法
Versions: LocalModCacheVersion=21, McInstanceCacheVersion=39,
          JavaConfigVersion=1, McInstallManifestVersion=1

' 资源配置（[Flags] 位标志）
ResourceTypes:     Mod=1, ModPack=2, ResourcePack=4, Shader=8, DataPack=16,
                   Plugin=32, Map=64, ModOrDataPack=Mod|DataPack,
                   Any=Mod|ModPack|ResourcePack|Shader|DataPack|Plugin|Map
ResourcePlatforms: CurseForge, Modrinth, Any
ModLoaders:        None=0, Forge=1, LiteLoader=2, Fabric=4, NeoForge=16,
                   All=Forge|LiteLoader|Fabric|NeoForge
                   （只有 6 个。NeoForge 占 16 而不是 8，说明 8 这个位曾属于某个
                     后来移出的加载器——很可能就是 OptiFine，现在它走独立字段）

Configs: JavaConfigVersion, JavaList, JavaRemovedList, JavaMigrated, JavaForced
```

**`Versions` 这个静态类特别值得注意**——它证明 **PCL2 对每个需要迁移的子系统
都有独立版本号**（Mod 缓存/实例缓存/Java 配置/安装清单）。
对比 PCL2 文档 §7.2（实例导出）里那条建议：**"资产的版本是需要比较、迁移、
回滚的一等概念，不是布尔标记"**——这里就是那个原则的具体实现。

**对 dsh 的直接启示**：`Versions` 这种设计正是解决 K18/K20（升级链断裂）的模板。
不用一个 `KEY_SETUP_DONE` 布尔，而是：

```kotlin
object DshAssetVersions {
    const val ROOTFS = 3          // rootfs 布局版本
    const val SCRIPTS = 7         // 脚本协议版本
    const val NODE_MODULES = 2    // 依赖树版本
}
// 启动时逐项比较，只在版本落后时重做对应的事
```

**这一点让 PCL2 的"版本化资产"从"推测的好做法"变成了
"有具体代码结构佐证的、经过十年使用的做法"。**


### 12.4 `ModSecret` 不是密钥库，而是"视觉配置 + 更新验证 + 服务端配置"

名字很有误导性。它的 42 个字段实际分四组：

**A. 主题色系统（20+ 字段）**
```vb
Color1..Color8               ← 8 个主题色槽位
ColorBg0, ColorBg1           ← 背景色
ColorGray1..ColorGray8       ← 8 级灰阶（完整明度阶梯）
ColorSemiTransparent         ← 半透明遮罩色

ThemeNow                     ← 当前主题
ColorHue / ColorSat          ← HSL 色相、饱和度
ColorLightAdjust             ← 明度调整
ColorHueTopbarDelta          ← 顶栏色相偏移（顶栏与内容区分色调）
ColorHueDelta
ThemeDontClick               ← "别点"主题开关
IsThemeColorfulLoaded
```

**整套主题系统的数据源**：主题不是硬编码的配色表，而是
**一个 HSL 基色 + 一组派生规则**（8 灰阶 + 明度/色相偏移）。
所以"极客蓝""欧皇彩""跳票红"实际是同一套色板的不同参数。
配套方法：`ThemeRefresh` / `ThemeRefreshMain` / `ThemeCheckAll` / `ThemeCheckOne` / `ThemeUnlock`。

**B. 更新系统（带签名验证）**
```vb
IsUpdating / IsUpdateWaitingRestart / IsUpdateRestartWaitingTasks / UpdateMark
EcdsaPublicKey                     ← ★ 内嵌 ECDSA 公钥
SecretCdnSign / SecretHeadersSign  ← 请求签名
UpdateCheckByButton / UpdateStart / UpdateRestart / UpdateReplace
DownloadLatestPCL
```
字符串证据：`ECDSA_P256` / `签名验证失败`
→ **更新包走 ECDSA P-256 签名验证**，请求带签名头。这是防中间人替换更新包的正确做法。

**C. 服务端配置与反代保护**
```vb
ServerConfig / ServerLoader / ServerSub / ServerRequirement
ClsBaseUrl / OAuthClientId / RegFolder
```
配套 URL（注意 `{CDN}` 占位符）：
```
https://pcl2-server-1253424809.file.myqcloud.com/ServerConfig.json{CDN}
https://pcl2-server-1253424809.file.myqcloud.com/notice.json{CDN}
https://pcl2-server-1253424809.file.myqcloud.com/minecraft/download.json{CDN}
https://uptime.easytier.cn/api/nodes                  ← 联机节点列表（社区源）
https://easytier.meloong.com/?page=1&per_page=1000     ← 同一列表的备用源（作者自建）
```
字符串：`从源站获取节点列表失败，将使用 CDN 缓存`
→ **源站 + CDN 双层回退**，`{CDN}` 是运行时替换参数（增加抓取成本）。

**D. 捐赠回馈校验（略）**

> 本节原记录了对该应用本地捐赠回馈标识的分析。
> 出于对独立开发者的尊重，以及避免任何可能被用于规避其运营机制的风险，
> **该分析已移除**。
>
> 可以保留的结论是：该应用有一套**本地校验的捐赠回馈标识**。
> 它与付费解锁无关，也不是访问控制；具体的结构、绑定方式与生成路径不再记录。

### 12.5 一些"人味"的代码

```
"多线程被卡住了不玩手机玩什么呀！（绝望）"     ← 错误提示
"主页可以使用特定的预设，在设置中看看吧！"
"IsAprilEnabled" / "AprilDifficultiedDistance"  ← 愚人节彩蛋的物理模拟参数
"TimerFool"（愚人节定时器）、"IdieCount"（"爱die计数"？）
```
`ModMain` 里有一组 `$STATIC$TimerFool$001$*` 静态字段：`IdieCount`、`MousePosLast`、
`Speed`、`GiveUpDistance`——**这是一个愚人节玩笑的完整物理模拟**（追踪鼠标、算速度、
算"放弃距离"）。

---

## 13. 对移动端（Android）的可借鉴性

> 本节给出方向性判断（完整的横向对比未随本手册发布）。
>
> **阅读提示**：文中 "dsh"、"对比项目 B"、"FCL" 指同一类内部对照对象——
> 作者自己的 Android 启动器项目（基于 FCL 生态，详情不随本手册发布）。
> 它们是"学习迁移"的落点，理解设计思想时可直接跳过这些指代。

### 13.1 可直接借鉴（架构级，3 条）

1. **`Loader` 可组合任务树**（§5）—— 最重要的一个。
   把"一个可能失败的、可取消的、有进度的、长任务"抽象成可组合类型：
   - 权重化进度聚合（`_ProgressWeight`）
   - 线程事件 / UI 事件分离
   - 取消沿树传播
   - 任务重复启动保护

   **注意**：对比项目 B 的仓库里**已经有一套同级框架**
   （FCL 的 `com.tungsten.fclcore.task`，有依赖图、状态机、
   `updateProgress(progress, total)`、`getInheritedStage()`、`TaskSignificance`），
   只是 dsh 的新代码绕开了它。**建议取其设计而非直接用**。

2. **"分析 / 执行" 两阶段分离**（§4.1）—— 先算清单再下载：
   - 提前知道总大小 → 进度准确
   - 合并去重 → 共享资源只下一次
   - 分析失败 vs 下载失败可分别重试

3. **版本化资产而非布尔标记**（§12.4 的 `Versions` 静态类）——
   ```vb
   Versions: PotatoVersion, LocalModCacheVersion,
             McInstanceCacheVersion, JavaConfigVersion
   ```
   **每个需要迁移的子系统各有独立版本号**。这是"升级链不失效"的保障。

### 13.2 可直接借鉴（模式级，7 条）

4. **镜像源的 URL 级精确重写**（§4.4）—— 国内网络刚需，
   且要做到路径格式都对齐（不只是换域名）
5. **幂等安装 + 忽略标识**（§4.2）—— 重装时先标记"忽略"，
   装完解除，避免被自己的扫描逻辑误伤
6. **从已有文件布局推断用户意图**（§3.2）—— "版本文件夹下存在 mods
   就自动开启隔离"，不问、直接做对的事
7. **失败诊断的"多结论 + 置信度 + 建议动作"**（§8）——
   每个失败模式给出：原因 + 是否确定 + **可执行的下一步**
8. **文件操作的护栏**（§12.3.5）—— `DirectoryUtils` 里那些硬编码保护：
   - "不应操作磁盘根目录"（防误删）
   - "剪切到不同磁盘"要复制+删除（不是 `move`）
   - "大小写不同等效于重命名"（Windows 大小写不敏感）
   - "回收站回退到永久删除"（优雅降级）
9. **诚实告知代价与合规风险**（§3.2 / §7.2）——
   `"调整版本隔离后，你需要手动迁移文件"`
   `"二次分发可能违反使用协议"`
10. **受控扩展的三件套**（§11.3/11.4/11.7）—— 对 dsh 最有价值的一条：
    - **枚举化能力**（24 个动作）而非"执行任意代码"
    - **声明式 UI + 事件总线**（任意控件可挂 24 种事件之一）
    - **变量/占位符命名空间**（`{variable:名:默认}`，零后端持久化）
    不需碰 WebView/JS 沙箱就能做出足够的扩展性。

### 13.3 需要改造，不能照搬（5 条）

| PCL2 做法 | 为什么不能抄 |
| --- | --- |
| **所有窗体预创建常驻**（41 个 Window 字段） | 移动端内存紧张，Activity 常驻会被系统杀 |
| **64 线程并发下载** | 要省电、省流量、避免被系统限制 |
| **远程 XAML 加载主页**（§11） | 这是**代码执行面**；移动端沙箱下不可行 |
| **INI 文件持久化** | 手机用户不会去编辑文件；并发写风险高 |
| **250+ 方法的巨型页面类** | 维护性差（`PageSetupUI` 255 方法、`PageDownloadInstall` 246 方法） |

**关于远程 XAML**：PCL2 敢这么做是因为 (a) 桌面用户对本地机器有完全控制权，
(b) 社区互信，(c) 它显示来源 URL 让用户判断。**这三条在 Android 上一条都不成立。**
若要扩展性，用**受限的声明式 JSON 描述 UI**。

### 13.4 方法论借鉴（最容易被忽略，但可能最有价值）

#### (a) "字符串即文档"

PCL2 把**执行日志当字符串常量内联**：

```vb
Log("分析原版支持库文件（副加载器）")
Log("下载原版支持库文件")
Log("读取 json 文件")
```

**收益**：本次逆向的绝大部分结论都来自这些字符串——
**阅读方法字符串 = 阅读执行流程**。

**对 dsh 的启示**：日志/任务状态文本要写清楚"现在在做什么"。
B 的 `DshTask.stage` 和安装脚本的 `[setup] STAGE=<key>` 协议已经是对的方向，
可以再进一步：**关键流程的日志加统一步骤编号**（PCL2 有
`"步骤 1：收集日志文件完成"` 这样的结构）。

#### (b) 让"高级用户"能用文本工具

PCL2 的两处示范：
- **所有配置走 INI 文本**（可手工编辑、可 diff、可版本控制）
- **实例导出配置是带注释的声明式文本**（`export_config.txt`，
  用户可以写脚本批量制作整合包）

**对 dsh 的启示**：即使主要存储用结构化格式，
**导出/导入也该用人类可读的文本**——这既是调试手段，也是高级用户的自动化入口。

#### (c) 把"感知性能"当成一等目标

`MyLoadingStateSimulator`（"加载状态模拟器"）——
**当实际加载太快时，人为延长动画**，避免 UI 闪烁。

**这是"感知性能"而非"实际性能"的优化**。B 目前有"入场动画去重"
（`freshIds` 差集）等优化，但"短任务也要有过渡感"这个角度可以再想。

#### (d) 运行时的纪律断言

```
"McLaunchStart 必须在 UI 线程调用！"
"在 UI 线程执行了网络请求"          ← 明确的违规检测
```

**把线程纪律写成运行时可检测的断言**，而不是靠约定。
B 用协程 + `Dispatchers` 天然规避了大部分这类问题，
但**其他纪律**（如"Snapshot 必须在主线程读"、
"proot 调用前必须写 resolv.conf"）也可以用同样的思路做运行时检查。

### 13.5 一句话

> **PCL2 最值得学的不是它的 150 个功能，而是它把
> "长任务 / 失败 / 迁移" 这三件麻烦事都制度化了。**
>
> 而它对移动端最大的启示是反面的：
> **它那些"豪华"的做法（窗体常驻、64 线程、远程 XAML）
> 全部依赖"桌面环境的宽松假设"**——
> 手机上的每一份宽松都要用电池、内存、安全来换。
