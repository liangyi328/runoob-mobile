# 菜鸟教程 · 手机学习版

把菜鸟教程爬下来，做成**移动优先、可离线**的学习 App。已收录 **183 个章节**。

| 教程 | 章节数 |
|---|---|
| Python3 教程 | 84 |
| Pandas 教程 | 54 |
| NumPy 教程 | 26 |
| Matplotlib 教程 | 19 |

## 快速开始（1 分钟）

```powershell
# 启动本地服务
node serve.mjs
```

终端会打印两个地址：

```
本机:   http://localhost:8848
手机:   http://192.168.x.x:8848   ← 手机连同一 WiFi 后访问
```

手机 Chrome / Safari 打开 `手机` 那个地址 → 菜单选 **「添加到主屏幕」**，
桌面会出现图标，点开就是全屏 App，**断网也能用**。

> 注意：必须走 `http://`，不能直接双击 `index.html`（`file://` 下 Service Worker 和 fetch 都会被浏览器拦截）。

## 已实现的手机端优化

- **移动优先排版**：正文 16px 基准、行高 1.75，标题带品牌色左边线
- **代码块**：独立卡片 + 语法高亮 + 一键复制 + 横向滚动（不撑破页面）
- **表格**：自动包裹横向滚动容器，宽表格可左右滑动查看
- **侧滑目录**：左抽屉按教程分组，支持章节名筛选，当前章节高亮
- **全文搜索**：标题 + 正文 + 代码内容全索引，结果带上下文摘要
- **深色模式**：右上角切换，自动记忆
- **阅读进度**：首页显示各教程已读百分比 + 「继续学习」接着上次看
- **上下章翻页**：底部大按钮，单手可点
- **完全离线**：Service Worker 预缓存全部内容

## 目录结构

```
runoob-mobile/
├── crawler/crawl.mjs        # 爬虫：解析目录 → 抓正文 → 输出 JSON
├── data/                    # 爬取结果（*.json）
│   └── manifest.json        # 索引
├── app/                     # PWA 应用（可直接部署）
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── sw.js                # 离线缓存
│   ├── manifest.webmanifest
│   ├── data/                # 教程数据（从 ../data 同步）
│   ├── icons/
│   └── vendor/highlight.min.js
├── android/                 # APK 工程（由 build_apk.py 生成）
├── scripts/
│   ├── make_icons.py        # 生成图标
│   ├── build_apk.py         # 生成/构建 Android 工程
│   └── install_android_sdk.ps1
└── serve.mjs                # 本地预览服务器
```

## 重新爬取 / 加教程

```powershell
# 全部重爬（默认 4 个教程，183 页，约 1 分钟）
node crawler/crawl.mjs

# 只爬某个教程
node crawler/crawl.mjs python3

# 试跑：每个教程只抓前 3 页
$env:LIMIT=3; node crawler/crawl.mjs
```

加了数据后同步到 app：

```powershell
Copy-Item data\*.json app\data\ -Force
```

想加别的教程，改 `crawler/crawl.mjs` 里的 `TUTORIALS` 数组即可（slug 就是菜鸟教程 URL
的第一段，如 `https://www.runoob.com/sql/sql-tutorial.html` → `slug: "sql"`）。

## 打包成 APK

本机**没有 Android SDK**，所以默认只生成工程。两条路：

### 路线 A：装 SDK 后在本机构建（自动）

```powershell
# 1) 一次性安装 Android 命令行工具（约 700MB，几分钟）
powershell -ExecutionPolicy Bypass -File scripts\install_android_sdk.ps1

# 2) 重开一个 PowerShell，然后构建
python scripts\build_apk.py
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`，装到手机：

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

### 路线 B：用 Android Studio 打开（图形界面）

工程已经生成好了，直接用 Android Studio `Open` → 选 `android` 目录 →
点 `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`。

### 路线 C：不装 SDK，用云构建

把 `app/` 目录推到 GitHub，用 **PWABuilder**（https://www.pwabuilder.com/）
输入你的 GitHub Pages 地址，它会在线帮你生成签名好的 APK，不用本地环境。

## 合规说明

- 严格遵守 `https://www.runoob.com/robots.txt`：不抓 `/try/`、`/wp-admin/`、`/feed/` 等禁止路径
- 限速 260ms + 并发 4 + 失败退避重试，不对源站造成压力
- 内容版权归菜鸟教程所有，本项目**仅供个人离线学习**，请勿重新分发
- 图片保留原站外链（联网时加载，离线时自动隐藏，不影响正文阅读）
