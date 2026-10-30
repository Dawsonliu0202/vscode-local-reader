<h1 align="center">📖 Local Reader 本地阅读</h1>

<p align="center">在 VS Code 里，留一段安静的阅读时间。</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Dawson.local-reader"><img src="https://img.shields.io/badge/version-v0.5.1-2aa198" alt="版本 v0.5.1"></a>
  <img src="https://img.shields.io/badge/VS_Code-%E2%89%A5_1.95-007ACC" alt="VS Code 1.95 及以上">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-859900" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Dawson.local-reader">Marketplace 安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#快捷操作">快捷操作</a>
</p>

离线管理和阅读本地 **EPUB / TXT**，支持侧边栏、文件标签页与真实终端分栏。自动保存阅读位置和有效时长，书籍与记录留在本机，无需账号或联网。

![VS Code 中真实运行的阅读器与原生终端分栏](docs/images/terminal-reader.png)

<p align="center"><sub>Windows · VS Code 1.144.0 · Solarized Dark。示例中左侧为 Reader，右侧为真实 Terminal；左右位置可在阅读设置中切换。</sub></p>

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 📚 本地书架 | 批量导入、按书名筛选、修改显示名、移除书籍；相同内容自动去重 |
| 🪟 三种阅读模式 | 侧边栏 `Workspace Notes`、文件标签页 `notes.log`、底部 Terminal + Reader 分栏 |
| 👆 轻量翻页 | 左右点击分区、方向键与翻页按钮；目录支持章节搜索、键盘导航及当前章定位 |
| 🔖 进度恢复 | 自动保存正文位置，调整字号、窗口宽度或阅读模式后继续阅读 |
| 📊 阅读统计 | 今日、最近 7 天、累计与单书时长；同书同日的阅读记录合并展示 |
| ⚙️ 简洁设置 | 正文内预览字号和行高，应用或取消；完整设置保留底部分栏位置 |
| ⌨️ 快速隐藏 | 一键清除插件正文和管理页面，保留代码文件与真实终端 |

## 快速开始

1. 商店发布完成后，在 VS Code 扩展视图搜索 **`@id:Dawson.local-reader`**，或打开 [Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=Dawson.local-reader)。
2. 点击 **安装**；离线安装可使用 `local-reader-0.5.1.vsix`，通过扩展视图右上角 **`…` → 从 VSIX 安装** 选择本地安装包。
3. 点击左侧活动栏的 **Local Reader 书本图标**，在书架点击 **导入书籍**，选择 `.epub` 或 `.txt`。
4. 点击书名或 **继续** 开始阅读；以后按 `Ctrl+Alt+R` 恢复，按 `Ctrl+Alt+H` 隐藏。

**同一扩展标识下可覆盖升级，书库与阅读记录保留。** 无需打开项目文件夹，也无需运行 npm。

商店版使用发布者 **Dawson**，完整标识为 `Dawson.local-reader`。早期 v0.5.0 及以前的本地包使用 `workspace-tools.local-reader`，VS Code 会将它们视为两个扩展；首次使用商店版前，请先禁用旧扩展，避免重复注册命令和视图。旧书架和记录保留在原扩展的数据目录，不会自动迁移到商店版。

## 界面预览

以下是当前版本 Webview 的实际渲染截图，使用示例书籍和演示统计数据；上方分栏图截自实际运行的 VS Code。

### 书架管理

书籍、进度、累计时长和最近阅读时间集中展示，导入入口只在书架出现。

![本地书架：导入、筛选、阅读进度与书籍管理](docs/images/bookshelf.png)

<table>
  <tr>
    <th width="50%">阅读记录与时长</th>
    <th width="50%">阅读设置</th>
  </tr>
  <tr>
    <td valign="top"><img src="docs/images/statistics.png" alt="阅读统计：今日时长、最近七天图表、单书时长与合并记录" width="100%"></td>
    <td valign="top"><img src="docs/images/settings.png" alt="阅读设置：跟随字号、行高预览与终端分栏位置" width="100%"></td>
  </tr>
  <tr>
    <td>同书同日合并记录，保留日期、累计时长和可确定的起止进度。</td>
    <td>排版与分栏即时预览，支持保存、恢复默认及保存并继续阅读。</td>
  </tr>
</table>

## 快捷操作

| 操作 | 快捷键 / 鼠标 |
| --- | --- |
| 继续最近一本书 | `Ctrl+Alt+R` |
| 隐藏所有插件内容 | `Ctrl+Alt+H`，或右上角 `—` |
| 正文内快速隐藏 | `Esc`；目录、菜单或排版浮层打开时先关闭浮层 |
| 上一页 / 下一页 | `←` / `→`、顶部 `‹` / `›`，或点击正文左右分区 |
| 上一章 / 下一章 | `Alt+←` / `Alt+→`，或宽栏顶部 `«` / `»`；窄栏收在 `⋯` |
| 打开目录 | 顶部 `≡`；按章节名或章号搜索，`↑` / `↓` 选择、`Enter` 跳转、`Esc` 关闭 |
| 回到当前章 | 目录顶部 **回到当前章**：清空筛选并滚动到当前章 |
| 快速排版 | 宽栏顶部 `⚙` 或窄栏 `⋯` → **快速排版设置**，在实际正文中预览 |
| 完整设置与分栏 | 排版浮层 / `⋯` → **完整设置**，或管理页的 **设置** |
| 切换阅读模式、书架与统计 | 顶部 `⋯` 菜单或命令面板 |

**点击分区：** 正文左侧三分之一为上一页，右侧三分之一为下一页，中间区域不翻页。拖动选字、清除已有选区及菜单打开时的背景点击不会误翻页。滚轮、上下方向键、PageUp/PageDown 和空格不翻页。

顶部采用 42px 高的单行紧凑工具栏，两侧为操作按钮，中间上下显示章节名和书名，以整个阅读区域为准居中，长文本省略并可悬浮查看全文。阅读视图原生标题栏不再重复显示继续阅读、隐藏等插件操作。窄栏保留翻页、目录、隐藏和更多菜单，切章与快速排版自动收纳；宽度足够时展开。底部显示 **本章当前页 / 总页数**。页码随字号和阅读区域变化，保存的位置按正文字符确定。普通翻页键仅在正文内生效，不接管代码编辑器和真实终端输入。

**目录：** 搜索支持章节名、标题中的章号及目录序号；目录标题、搜索框和常用操作固定，只有章节列表滚动。当前章高亮与键盘选中框分别显示，同名章节按原始锚点跳转。中文输入法选字时的 Enter 不会跳转；无结果时可清空搜索。

**快速排版：** 可选择字号跟随 VS Code、自定义 **8–40 px** 字号和 **1.2–3.0 倍**行高。修改只在正文临时预览，点击 **应用** 才写入原有 VS Code 配置。点击 **取消**、关闭按钮或按 `Esc` 会恢复原排版与正文位置；隐藏、切书、切换模式或进入完整设置也会丢弃未应用的预览。字体继续跟随 VS Code 默认界面字体。

macOS 打开/隐藏对应 `Cmd+Option+R/H`；键位可在 VS Code 的“键盘快捷方式”中修改，平台兼容性范围见下方说明。

## 格式与数据

- **TXT**：支持 UTF-8、GBK/GB18030；编码回退时可先预览再确认。
- **EPUB**：支持无 DRM 的 EPUB 2/3 文字书，提取正文和目录，使用统一排版。
- **大小与副本**：每本上限 50 MiB；导入保存本地副本，原文件移动后仍可阅读。
- **时长口径**：仅在窗口前台、正文可见且最近 120 秒内有正文操作时累计。隐藏、失焦或空闲暂停；短于一分钟显示秒数，跨日按本地日期拆分。
- **移除书籍**：删除插件副本、进度、记录与该书累计时长，原始文件保留。

<details>
<summary><strong>数据存放与恢复</strong></summary>

数据保存在 VS Code 分配的 `globalStorageUri` 中，不写入项目，不开启遥测，也不加入 Settings Sync。

Windows 默认目录通常为 `%APPDATA%/Code/User/globalStorage/Dawson.local-reader/`（目录大小写以 VS Code 实际创建为准）；早期本地版本使用 `workspace-tools.local-reader/`。便携版或其他用户配置以 VS Code 实际位置为准。

| 文件 | 用途 |
| --- | --- |
| `state.json` | 书架、进度与原始阅读会话 |
| `state.json.bak` | 上一份完整状态备份 |
| `books/` | 导入副本与正文缓存 |

缓存缺失时从副本重建，状态损坏时尝试备份；两者均损坏会保留目录并报错。多窗口写入使用文件锁，重新打开书架可读取最新数据。异常退出可能丢失最近一个检查点，通常不超过 10 秒。

隐藏会清空插件内容、关闭自身阅读标签、收起书架并移除底部阅读分栏；真实终端和其他文件保留。重启后需主动继续阅读，不自动展示正文。本功能不提供系统级隐藏或磁盘数据加密。

</details>

<details>
<summary><strong>终端分栏与快捷键设置</strong></summary>

底部模式使用原生 Terminal 与阅读 Webview，分隔条可拖动，左右位置可在阅读设置中切换。插件复用已有终端，没有时创建默认终端，不会向 Shell 自动输入命令。文件页是只读 Webview，不创建真实项目文件。

如果手动移动过视图，重新选择底部模式可恢复容器位置；容器中额外放入其他扩展视图时，可通过 VS Code 拖动整理。

若自定义了 `terminal.integrated.commandsToSkipShell`，请在原有数组中加入 `localReader.resume` 和 `localReader.hide`。`terminal.integrated.sendKeybindingsToShell` 也可能影响终端内快捷键路由。[VS Code 官方说明](https://code.visualstudio.com/docs/terminal/advanced#_keybinding-and-the-shell)

</details>

<details>
<summary><strong>支持环境与范围</strong></summary>

支持 VS Code 桌面版 **1.95 及以上**，当前主要验证环境为 **Windows / VS Code 1.144.0**。macOS、Linux、浏览器版、Remote/WSL/SSH 与 Codespaces 尚未进行兼容性验收。

当前支持 EPUB/TXT 文字阅读，不包含 PDF、MOBI、DRM 解密、固定版式、扫描书、原版插图与复杂排版还原，也不提供在线书城和云同步。

</details>

## 开发与验证

需要 Node.js 22 或更新的受支持版本，以及 npm。克隆项目后执行：

```sh
npm ci
npm run check
npm test
npm run build
npm run test:ui
npm run test:host
npm run package
```

`test:ui` 使用本机 Microsoft Edge 无头运行；`test:host` 使用隔离的 VS Code 配置，不向日常书架写入测试内容。也可用 `VSCODE_EXECUTABLE_PATH` 指定已有 `Code.exe`，Windows 下可按 F5 调试插件。

| 文档 | 内容 |
| --- | --- |
| [功能 PRD](docs/PRD.md) | 功能与范围约定 |
| [实现方案](docs/IMPLEMENTATION_PLAN.md) | 模块、存储与阅读流程 |
| [验收记录](docs/VERIFICATION.md) | 已执行验证及兼容性范围 |
| [更新记录](CHANGELOG.md) | 各版本变更 |

## 许可证

[MIT](LICENSE) · 运行时依赖声明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
