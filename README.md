# Pixiv Auto Like & Follow & Save

> Chrome 浏览器扩展 · 在 Pixiv 作品页一键完成「点赞 / 收藏 / 关注 / 保存原图」

---

## 📁 项目结构

```
自动点赞关注下载_pixiv/          ← 插件根目录（即扩展文件夹名）
├── manifest.json               ← 插件清单文件（MV3）
├── background.js               ← Service Worker，处理下载任务
├── content.js                  ← 注入 pixiv 作品页的操作脚本
├── popup.html                  ← 弹出面板 UI
├── popup.js                    ← 弹出面板交互逻辑
├── icons/
│   ├── icon16.png              ← 工具栏小图标 (16×16)
│   ├── icon48.png              ← 扩展管理页图标 (48×48)
│   └── icon128.png             ← 商店展示图标 (128×128)
└── README.md                   ← 本文档
```

---

## 🎯 功能说明

| 功能 | 描述 | 触发方式 |
|------|------|----------|
| 👍 点赞 | 自动点击当前作品的「赞！」按钮 | Popup 按钮 / 一键四连 |
| ❤️ 收藏 | 自动点击收藏按钮（添加书签） | Popup 按钮 / 一键四连 |
| ➕ 关注作者 | 若尚未关注，自动点击「加关注」按钮 | Popup 按钮 / 一键四连 |
| 💾 保存原图 | 模拟鼠标中键在新标签页打开原图（避免 403） | Popup 按钮 / 一键四连 |
| ⚡ 一键四连 | 依次执行点赞→收藏→关注→保存 | Popup 按钮 |

---

## 🏗️ 架构设计

### 整体流程

```diff
用户点击 Popup 按钮
        │
        ▼
  popup.js 查询当前 Tab
        │  chrome.tabs.query
        ▼
  发送 Message 至 content.js
        │  chrome.tabs.sendMessage
        ▼
  content.js 操作页面 DOM
    ├─ 点赞：waitForElement → button.click()
    ├─ 收藏：waitForElement → button.click()
    ├─ 关注：waitForElement → button.click()
    └─ 保存原图：
         ├─ 调用 /ajax/illust/{id}/pages 获取所有分页 URL
         ├─ 模拟鼠标中键点击 <a> 在新标签页打开（避免 403）
         └─ 备用：模拟左键点击打开 Pixiv 内部查看器
```

### 各文件职责

#### `manifest.json`
- Manifest V3 格式
- 声明权限：`activeTab`（读取当前页）、`downloads`（文件下载）、`storage`（预留）
- Host Permissions：`https://www.pixiv.net/*`（内容脚本注入）、`https://i.pximg.net/*`（原图下载）
- 内容脚本仅在 `https://www.pixiv.net/artworks/*` 页面注入，最小化影响范围

#### `content.js`
- 立即执行函数（IIFE），避免全局污染
- **`waitForElement(selector, timeout)`**：基于 `MutationObserver` 等待动态渲染的 DOM 元素，超时后 reject
- **`clickLike()`**：查找 `button.style_button__c7Nvf`，检查 `style_liked__EIbS8` 防重复，输出详细诊断日志
- **`clickBookmark()`**：查找 `button.gtm-main-bookmark`（心形图标），通过 aria-label 判断是否已收藏
- **`clickFollow()`**：查找 `button[data-click-label="follow"]`，文字+variant 双重校验
- **`saveOriginalImage()`**：
  1. 调用 `/ajax/illust/{id}/pages` 获取所有分页 URL（`_p0.jpg`, `_p1.jpg`, `_p2.jpg`...）
  2. 确保图片已展开（`<a.gtm-expand-full-size-illust>`）
  3. 模拟鼠标中键点击 `<a>` 在新标签页打开原图（浏览器自动携带 Referer/Cookie，避免 403）
  4. 备用：模拟左键点击打开 Pixiv 内部图片查看器
- 监听 `chrome.runtime.onMessage`，根据 `action` 字段分发调用

#### `background.js`
- Service Worker（MV3 要求）
- 监听 `download` 消息，调用 `chrome.downloads.download()` 执行文件下载（作为备用方式）
- 主要下载方式已改为模拟鼠标中键在新标签页打开原图

#### `popup.html / popup.js`
- 简洁 200px 宽弹窗，4 个操作按钮 + 状态文字
- `sendAction(action)`：查询当前 Tab → 校验是否为 pixiv 作品页 → 发送消息 → 显示结果
- 状态提示 2 秒后自动恢复"就绪"

---

## 🔑 关键技术点

### 1. MutationObserver 等待动态元素
Pixiv 为 React SPA，页面内容异步渲染。使用 `MutationObserver` 监听 DOM 变化，确保按钮真正出现后再操作，避免因时序问题导致操作失败。

### 2. 点赞防重复
通过检查按钮 class 是否包含 `style_liked__EIbS8` 来判断已点赞状态：
- 未点赞：`class="style_button__c7Nvf"`
- 已点赞：`class="style_liked__EIbS8 style_button__c7Nvf"`

### 3. 关注防重复（双重校验）
- **文字校验**：检查按钮文本是否含"加关注"（zh-CN）/ "フォロー"（ja）/ "Follow"（en）
- **样式校验**：未关注时 `data-variant="Primary"`，已关注时 `data-variant="Default"`
- `data-click-label="follow"` 在两种状态下均存在，不可单独用于判断关注状态

### 4. 原图保存策略（避免 403 Forbidden）

Pixiv 原图（`i.pximg.net`）在直接访问时会返回 `403 Forbidden`，因为需要正确的 Referer 和 Cookie。

**解决方案：模拟鼠标中键点击**
- 找到 `<a class="gtm-expand-full-size-illust">` 标签（展开状态时存在）
- 模拟 `auxclick` 事件（button=1，即鼠标中键），触发浏览器在新标签页打开
- 浏览器会自动携带正确的 Referer（pixiv.net）和 Cookie（已登录状态）
- 新标签页中的图片可直接右键另存为，或浏览器会自动提示下载

**备用方案：模拟左键点击打开查看器**
- 点击 `<div/a class="gtm-expand-full-size-illust">` 触发 Pixiv 内部图片查看器
- 查看器中显示的是完整原图，可直接右键另存为

**多页图片支持**
1. 调用 `/ajax/illust/{id}/pages` 获取所有分页 URL（`_p0`, `_p1`, `_p2`...）
2. 逐个创建临时 `<a>` 标签模拟中键点击在新标签页打开
3. 浏览器可能拦截多个弹窗，需允许本站弹出窗口

### 5. 诊断日志
点赞和关注操作会输出详细的诊断信息到浏览器控制台（F12），便于调试：
- 点赞按钮的完整 class 列表、是否已点赞、按钮状态
- 如果找不到按钮，会列出页面上所有候选按钮供排查
- 保存操作会输出所有获取到的图片 URL 和处理过程

### 6. 消息传递链路
`popup.js` → `content.js`（DOM 操作 + Ajax）→ `background.js`（下载），三层各司其职。

---

## 🚀 安装与使用

1. 确保 `icons/` 目录中包含三个 PNG 图标文件
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录
5. 访问 Pixiv 任意作品页，例如：`https://www.pixiv.net/artworks/142633255`
6. 点击工具栏中的插件图标，选择相应操作

---

## ⚠️ 注意事项

- 本插件仅限个人学习使用，请遵守 Pixiv 使用条款
- Pixiv 页面会不定期更新 class 名称，若操作失效请检查并更新 `content.js` 中的选择器
- 关注功能只在未关注状态下执行，已关注则自动跳过
- 下载的原图保存在 Chrome 默认下载文件夹
- 保存原图会**在新标签页中打开**，请在弹出的新标签页中右键另存为
- 多图作品会打开多个新标签页，如被浏览器拦截请允许本站弹出窗口

---

## 🛠️ 选择器维护指南

若某功能失效，打开 Pixiv 作品页，按 F12 进入开发者工具，定位对应按钮并更新 `content.js` 中的 CSS 选择器：

| 功能 | 当前选择器 / 方法 | 判断逻辑 | JS Bundle 来源 |
|------|-----------|----------|---------------|
| 点赞按钮 | `button.style_button__c7Nvf` | class 含 `style_liked__EIbS8` = 已点赞 | `82102.js` 模块 76480 |
| 收藏按钮 | `button.gtm-main-bookmark` | aria-label 含"済み"/"已收藏" = 已收藏 | 用户提供的实际 HTML |
| 关注按钮 | `button[data-click-label="follow"]` | 文字含"加关注" + `data-variant="Primary"` = 未关注 | `74851.js` 函数 x() |
| 原图 URL | Ajax API `/ajax/illust/{id}` | `body.urls.original` | `114363236.html` Ajax 响应 |
| 原图备用 | `a.gtm-expand-full-size-illust` | 仅展开状态下是 `<a>`，需先点击触发展开 | `82102.js` 函数 t6 |
| 多页漫画 | Ajax API `/ajax/illust/{id}/pages` | `body[i].urls.original`（_p0, _p1, _p2...） | Pixiv Ajax API |
| 避免下载 403 | 模拟中键 `auxclick`（button=1） | 浏览器自动携带 Referer/Cookie | content.js `simulateMiddleClick()` |
