# Local Reader 本地阅读

在 VS Code 中离线管理和阅读本地 TXT、EPUB，支持侧边栏、文件标签页和底部原生终端分栏。书籍、进度与阅读记录保存在本机，不需要账号或联网。

## 安装与开始阅读

从 [GitHub Releases](https://github.com/Dawsonliu0202/vscode-local-reader/releases/latest) 下载最新 `.vsix` 安装包，源码可在仓库中浏览或下载。

1. 在 VS Code 扩展页面打开右上角 `…`，选择 **从 VSIX 安装**，选择 `local-reader-0.4.1.vsix`；旧版可直接覆盖升级，书库与记录保留。
2. 点击左侧活动栏的 **Local Reader 书本图标**，在书架点击“导入书籍”。
3. 选择一本或多本 `.txt` / `.epub`；导入完成后在书架点击书名或“继续”。
4. 以后按 `Ctrl+Alt+R` 继续最近一本书，按 `Ctrl+Alt+H` 隐藏插件内容。

也可以点击左侧活动栏新增的 **Local Reader 书本图标**，直接在侧栏进入书架管理，支持导入、筛选、改名、移除及查看统计。资源管理器中的 **Workspace Notes** 保留作为侧栏阅读模式。无需打开项目文件夹。

支持 VS Code 桌面版 1.95 及以上；主验收环境为 Windows、VS Code 1.144.0。macOS/Linux、浏览器版、Remote/WSL/SSH 和 Codespaces 尚未进行兼容性验收。

## 操作

| 操作 | 方式 |
| --- | --- |
| 继续阅读 | `Ctrl+Alt+R` |
| 隐藏正文、书架、记录与统计 | `Ctrl+Alt+H` 或界面右上角 `—` |
| 正文内快速隐藏 | `Esc`；有目录/菜单时先关闭弹层 |
| 上一页 / 下一页 | 点击正文左/右侧分区、正文内 `Left` / `Right` 或顶部 `‹` / `›` |
| 上一章 / 下一章 | 正文内 `Alt+Left` / `Alt+Right`，或顶部 `«` / `»` |
| 章节目录 | 顶部 `≡` |
| 切换模式、书架、统计、设置 | 顶部 `⋯` 菜单或命令面板；导入按钮仅在书架 |
| 字号、行高与左右布局 | 点击正文顶部 `⚙`，或书架的“设置”标签；字号可跟随编辑器 |

macOS 对应组合为 `Cmd+Option+R/H`。所有命令均可在 VS Code 的“键盘快捷方式”中重新绑定。

正文采用左右分页，滚轮、上下方向键、PageUp/PageDown 和空格不翻页。顶部显示当前章节和书名，底部显示“本章当前页 / 总页数”；页数随阅读区域、字号和行高变化，阅读位置仍按正文字符保存。

正文左右各三分之一为点击翻页区：左侧上一页，右侧下一页；中间区域不翻页。拖动选字、清除已有选区和菜单打开时的背景点击不触发翻页。此操作在三种阅读模式下均生效，跨章节延续原有分页规则。

为使终端获得焦点时仍能使用打开/隐藏快捷键，插件提供了 `terminal.integrated.commandsToSkipShell` 的默认补充。如果你已自定义该配置，请在原有数组中加入 `localReader.resume` 和 `localReader.hide`；启用 `terminal.integrated.sendKeybindingsToShell` 也可能改变按键路由。普通翻页键只在阅读正文内处理，不接管真实终端输入。[VS Code 终端按键说明](https://code.visualstudio.com/docs/terminal/advanced#_keybinding-and-the-shell)。

## 三种外观

- **侧边栏**：资源管理器中的 `Workspace Notes`，适合窄栏阅读。
- **文件页面**：名为 `notes.log` 的只读阅读标签，不创建真实项目文件。
- **底部终端 + 阅读分栏**：在原生 **Terminal / 终端** 标签内，默认左侧为可正常输入和执行命令的真实终端，右侧 `Task Output` 为阅读面板；可在阅读设置中对调左右位置，拖动原生分隔条调整比例。复用现有终端，没有时由 VS Code 创建默认终端。插件不会向终端自动输入命令。

切换模式会保留正文位置，并清除旧容器内容。隐藏会移除底部阅读分栏、关闭插件自己的阅读标签，书架视图清空并收起；真实代码文件和终端保留。重启不会自动展示正文，需要主动继续阅读。书架入口按 VS Code 的侧栏恢复规则显示管理页面。

底部分栏复用 VS Code 内置的视图移动命令，将插件阅读视图放到原生 Terminal 容器内；底部标签因此显示为 **Terminal**，不再是旧版独立的 Task Output 标签。选择此模式时会把面板放到底部，以便左右并排。若曾手工移动或隐藏视图，可以重新选择该模式恢复容器位置，再拖动分隔条调整宽度。

正常 Terminal + Reader 双栏会在进入底部模式时应用选定顺序；如果你在该容器里额外放入了其他扩展视图，仍可用 VS Code 的拖动操作整理布局。

## 阅读设置

点击正文顶部 `⚙`、书架“设置”或执行 **Local Reader: 阅读设置**，进入插件自己的设置页：

- 字号跟随编辑器，或自定义 8–40 px；行高 1.2–3.0 倍，文字预览即时更新。
- 底部布局选择“左侧 Terminal · 右侧 Reader”（默认）或反向布局，并显示排列预览。
- 点击“保存设置”后持久化；“保存并继续阅读”会应用设置并恢复当前书的位置。
- “恢复默认”先还原预览，保存后生效。

设置页暂停阅读计时；布局在进入底部模式时应用。从 VS Code 通用设置修改 `localReader.panelReaderSide` 时，当前可见的底部分栏也会立即调整。

正文、管理界面和预览的字体族跟随 VS Code 界面默认字体，字号默认跟随编辑器。隐藏按钮会清除书名与正文，不提供系统级隐藏或磁盘数据加密。

## 书籍与记录

- TXT 支持 UTF-8、GBK/GB18030；编码回退时先选择预览正常的编码。其他编码需先在外部转换。
- EPUB 支持无 DRM 的 EPUB 2/3 文字书，提取标题、正文与目录，不还原原版插图、复杂排版或固定版式。
- 每本上限 50 MiB；EPUB 额外限制条目数和实际解压体积。
- 相同内容不会重复导入；同名不同内容可共存。导入会保存副本，原文件移动后仍可读。
- 书架可按书名筛选、修改显示书名或移除。移除会删除插件副本、该书进度、记录和累计时长，原始文件保留。
- 进度表示当前正文位置，回翻时百分比会下降；到末尾显示 100%。

统计包括今日、最近 7 天、累计与单书时长，以及可按书筛选的阅读记录。记录按“同一本书、同一天”合并，显示日期、累计时长和可确定的首末进度；多次打开或隐藏不再产生重复列表项，原始会话保留。短于一分钟的时长显示秒数。

只在 **窗口前台、正文可见、最近 120 秒内有正文操作** 时累计；隐藏、失焦和空闲暂停。单纯移动鼠标或滚轮不算操作。内部按秒保存，跨午夜按系统本地日期拆分；异常退出可能丢失最近一个检查点（通常不超过 10 秒）。

## 数据与恢复

数据存放在 VS Code 分配给 `workspace-tools.local-reader` 的 `globalStorageUri` 中，不写入项目，不开启遥测，不加入 Settings Sync。

Windows 默认用户目录通常为 `%APPDATA%/Code/User/globalStorage/workspace-tools.local-reader/`，其他配置/便携模式实际位置以 VS Code 为准。其中 `state.json` 为书架和记录，`state.json.bak` 为上一份完整备份，`books/` 为副本与缓存。

缓存缺失时会从副本重建；状态损坏时尝试备份，二者均损坏则显示错误并保留目录，不静默清空。多窗口写入使用文件锁，窗口间不实时刷新；重新打开书架读取最新数据。

## 开发与验证

需要 Node.js 22 或更新的受支持版本，以及 npm。

```sh
npm ci
npm run check
npm test
npm run build
npm run test:ui
npm run test:host
npm run package
```

`test:ui` 使用已安装的 Microsoft Edge 无头运行；`test:host` 默认由官方测试工具下载隔离版 VS Code，也可设置 `VSCODE_EXECUTABLE_PATH` 指向现有 `Code.exe`。集成测试使用项目下 `.test-data/` 的独立配置，不向日常 VS Code 书架写入测试内容。Windows 可在 F5 启动配置中运行插件。

源码入口为 `src/extension.ts`，正文解析在 `src/content.ts`，存储在 `src/storage.ts`，计时在 `src/tracker.ts`，视图控制在 `src/controller.ts`，页面在 `webview/`。

源码目录中的 `docs/PRD.md`、`docs/IMPLEMENTATION_PLAN.md` 记录需求与实现边界，`docs/VERIFICATION.md` 记录验证结果。许可证为 MIT，打包依赖声明见 `THIRD_PARTY_NOTICES.txt`。
