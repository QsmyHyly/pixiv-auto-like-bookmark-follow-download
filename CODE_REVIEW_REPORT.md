# Pixiv 浏览器扩展 · 代码审查报告（含修复记录）

> 审查日期：2026-04-26  
> 修复日期：2026-04-26  
> 审查范围：全部 6 个源文件（manifest.json, background.js, content.js, popup.html, popup.js, README.md）

---

## 📊 总体评估

| 维度 | 修复前 | 修复后 | 说明 |
|------|:------:|:------:|------|
| 功能完整性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 下载功能从"可能失效"变为"多路可靠 fallback" |
| 代码健壮性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 竞态条件、死代码、冗余逻辑全部修复 |
| 可维护性 | ⭐⭐⭐ | ⭐⭐⭐⭐ | 消除冗余代码，逻辑更清晰 |
| 安全性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 无变化，本身就很安全 |

---

## 🐛 已修复问题一览

| # | 优先级 | 问题 | 状态 |
|:--:|:------:|------|:----:|
| 1 | 🔴 P0 | 程序化鼠标事件无效 → 下载功能失效 | ✅ 已修复 |
| 2 | 🔴 P0 | 双重触发 → 多开标签页 | ✅ 已修复 |
| 3 | 🟡 P1 | `hasMask` 死代码 | ✅ 已修复 |
| 4 | 🟡 P1 | `saveOriginalImage` 冗余备用逻辑 | ✅ 已修复 |
| 5 | 🟡 P1 | `ensureExpandedAndGetLink` 竞态条件 | ✅ 已修复 |
| 6 | 🟡 P1 | `clickFollow` data-variant 双重检查不一致 | ✅ 已修复 |
| 7 | 🟢 P2 | 全局模式不持久化 | ✅ 已修复 |
| 8 | 🟢 P2 | popup.html 空 `<span>` 元素 | ✅ 已修复 |
| 9 | 🟢 P2 | `Promise.allSettled` 冗余 | ✅ 已修复 |
| 10 | 🔵 D | 选择器硬编码 | ⚠️ 长期风险（非代码问题） |

---

## 🔧 修复详情

### 修复 1+2：`simulateMiddleClick` → `openImageFromElement`（P0 双重触发 + 事件无效）

**文件**: `content.js` 第 84-140 行

**原问题**:
- `dispatchEvent(auxclick)` 在现代浏览器中不触发导航
- 事件分发 + `setTimeout` 创建 `<a>` 同时执行，导致重复打开

**修复方案**（保持多路 fallback 哲学）:
```
顺序尝试（一个失败才试下一个）：
  1. chrome.tabs.create({url, active: false})  ← 扩展 API，绕过弹窗拦截器，最可靠
  2. window.open(url, '_blank')                ← 可能被弹窗拦截器拦截
  3. dispatchEvent auxclick                    ← 最后手段（部分浏览器可能响应）
```

**关键改动**:
- 函数从同步改为 `async`，返回 `boolean` 表示是否成功
- 三种方式**顺序执行**，前一个成功则立即返回，不再尝试后续方式
- 新增 `chrome.tabs.create` 作为首选（扩展 API 不受弹窗拦截器影响）

---

### 修复 1+2：`simulateMiddleClickWithUrl` → `openImageFromUrl`（P0 双重触发 + 事件无效）

**文件**: `content.js` 第 546-589 行

**原问题**: 同上，且纯 URL 场景下无 DOM 元素可依赖

**修复方案**（保持多路 fallback 哲学）:
```
顺序尝试（一个失败才试下一个）：
  1. chrome.tabs.create({url, active: false})  ← 扩展 API，最可靠
  2. window.open(url, '_blank')                ← 可能被拦截
  3. chrome.downloads.download (via bg.js)     ← 直接下载到本地
```

**关键改动**:
- 函数从同步改为 `async`，返回 `boolean`
- 新增 `chrome.downloads.download` 作为第三路 fallback（通过 background.js）
- 三种方式顺序执行，不重复触发

---

### 修复 3：`hasMask` 死代码 → 纳入收藏判断逻辑

**文件**: `content.js` 第 297-318 行

**原问题**: `hasMask` 变量被计算并记录日志，但从未用于判断

**修复方案**: 将 `hasMask` 作为收藏状态的辅助检测条件

```javascript
// 双重检测：aria-label 明确表示已收藏，或没有 mask（实心心形）
const isBookmarked = labelIndicatesBookmarked || !hasMask;
```

**逻辑**:
- 未收藏 → 心形通过 `<mask>` 遮罩实现镂空效果 → `hasMask = true`
- 已收藏 → 心形为实心填充 → `hasMask = false`
- 与 aria-label 关键词检测互补，提高检测准确率

---

### 修复 4：`saveOriginalImage` 冗余备用逻辑

**文件**: `content.js` 第 448-544 行

**原问题**: 当 API 获取图片列表为空时，有一个"备用方案"代码块与步骤 3 的单图逻辑高度重复

**修复方案**: 重构为清晰的四步流程

```
步骤1：getAllImageUrls() → imageList（多页 API）
        ↓ 若为空，尝试单图 API
步骤2：ensureExpandedAndGetLink() → domLink（DOM 展开状态）
步骤3：有 API 数据 → 单图用 DOM 链接 / 多图逐个打开
步骤4：API 完全失败 → 纯 DOM 备用（仅此一处）
```

**关键改动**:
- 消除了重复的 `domLink` 处理代码块
- 步骤 3 和步骤 4 职责清晰分离，不再交叉
- 所有下载调用统一使用 `openImageFromElement` / `openImageFromUrl`

---

### 修复 5：`ensureExpandedAndGetLink` 竞态条件

**文件**: `content.js` 第 417-419 行

**原问题**: `document.querySelector('.gtm-expand-full-size-illust')` 在 React 未渲染时返回 `null`

**修复方案**: 改用 `waitForElement`，并将等待时间从 1000ms 增加到 1500ms

```javascript
// 修复前
const container = document.querySelector('.gtm-expand-full-size-illust');

// 修复后
const container = await waitForElement('.gtm-expand-full-size-illust', 5000);
await delay(1500); // 等待 React 重新渲染（比之前多 500ms 余量）
```

---

### 修复 6：`clickFollow` data-variant 双重检查不一致

**文件**: `content.js` 第 253 行

**原问题**: 同时使用 `getAttribute` 和 `dataset` 两种方式检查，说明开发者不确定哪种有效

**修复方案**: 统一使用 `getAttribute('data-variant')`

```javascript
// 修复前
const isPrimary = followBtn.getAttribute('data-variant') === 'Primary' ||
                  followBtn.dataset.variant === 'Primary';

// 修复后
const isPrimary = followBtn.getAttribute('data-variant') === 'Primary';
```

> 注：诊断日志中仍保留 `dataset.variant` 用于调试输出，不影响判断逻辑。

---

### 修复 7：全局模式开关持久化

**文件**: `popup.js` 第 13-26 行

**原问题**: `isGlobalMode` 每次打开 popup 都重置为 `false`

**修复方案**: 使用 `chrome.storage.local` 读写状态

```javascript
// 初始化时从 storage 恢复
chrome.storage.local.get('globalMode', (data) => {
  isGlobalMode = data.globalMode || false;
  toggle.checked = isGlobalMode;
});

// 切换时持久化
toggle.addEventListener('change', (e) => {
  isGlobalMode = e.target.checked;
  chrome.storage.local.set({ globalMode: isGlobalMode });
  setStatus(isGlobalMode ? '全局模式已开启' : '全局模式已关闭', 'success');
});
```

---

### 修复 8：popup.html 空元素

**文件**: `popup.html` 第 141-144 行

**修复**: 删除未使用的 `<span class="slider"></span>`

---

### 修复 9：`Promise.allSettled` 冗余

**文件**: `popup.js` 第 70-72 行

**原问题**: 所有 promise 已被 `.catch()` 处理，永远不会 reject，`allSettled` 等价于 `all`

**修复方案**: 简化为 `Promise.all`

```javascript
// 修复前
const results = await Promise.allSettled(promises);
const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

// 修复后
const results = await Promise.all(promises);
const succeeded = results.filter(r => r.success).length;
```

---

## ⚠️ 未修复项（设计层面 / 非代码问题）

### D1 · CSS 选择器硬编码 — Pixiv 更新即失效

**状态**: ✅ 已通过策略 D 解决

所有关键选择器现在支持三层防护：

1. **用户自定义**（`chrome.storage.local`）— 用户可在 popup 面板中直接编辑选择器，持久保存
2. **内置默认值**（代码中硬编码）— 扩展更新时自带新默认值，自动覆盖
3. **上下文定位**（仅点赞按钮）— 从稳定的收藏按钮推导位置，不依赖任何 hash 类名

详见下方「策略 D 实现」章节。

---

## 🏗️ 修复后的 Fallback 架构总览

```
用户点击「保存原图」
        │
        ▼
  saveOriginalImage()
        │
        ├── 步骤1: Ajax API 获取图片 URL 列表
        │     ├── /ajax/illust/{id}/pages  (多页)
        │     └── /ajax/illust/{id}        (单页 fallback)
        │
        ├── 步骤2: ensureExpandedAndGetLink()
        │     ├── waitForElement('a.gtm-expand-full-size-illust')
        │     ├── waitForElement('.gtm-expand-full-size-illust') → click → waitForElement('a...')
        │     └── waitForElement('a[href*="img-original"]')
        │
        └── 步骤3/4: 打开图片（每张图独立 fallback 链）
              │
              ├── 有 DOM 元素 → openImageFromElement()
              │     1. chrome.tabs.create  ← 最可靠
              │     2. window.open         ← 可能被拦截
              │     3. auxclick 事件       ← 最后手段
              │
              └── 纯 URL → openImageFromUrl()
                    1. chrome.tabs.create  ← 最可靠
                    2. window.open         ← 可能被拦截
                    3. downloads.download  ← 直接下载
```

**核心原则**: 每一层都有多路 fallback，但**顺序执行**而非同时触发，避免重复操作。

---

## 🛡️ 策略 D 实现：可配置选择器 + 自动更新 + 上下文定位

> 实现日期：2026-04-26

### 架构

```
┌─────────────────────────────────────────────────────────┐
│                    选择器解析优先级                        │
│                                                         │
│  1. 用户自定义 (chrome.storage.local)  ← 用户可编辑       │
│          ↓ 未配置                                        │
│  2. 内置默认值 (DEFAULT_SELECTORS)     ← 扩展更新自带      │
│          ↓ 选择器失效                                     │
│  3. 上下文定位 (findLikeButtonByContext) ← DOM 关系推导    │
│          ↓ 全部失败                                       │
│  4. 诊断输出 (列出所有候选按钮)          ← 方便手动修复      │
└─────────────────────────────────────────────────────────┘
```

### 存储方案

使用 Chrome 内置的 `chrome.storage.local`（无需远程服务器）：

```javascript
// 存储结构
{
  "selectors": {
    "like":            "button.style_button__c7Nvf",
    "liked":           "style_liked__EIbS8",
    "bookmark":        "button.gtm-main-bookmark",
    "follow":          "button[data-click-label=\"follow\"]",
    "expandContainer": ".gtm-expand-full-size-illust",
    "expandLink":      "a.gtm-expand-full-size-illust",
    "imgOriginal":     "a[href*=\"img-original\"]"
  }
}
```

- 用户保存的配置持久保留，不受扩展更新影响
- 扩展更新时，`DEFAULT_SELECTORS` 同步更新，未覆盖的字段自动使用新默认值
- 无需任何远程服务器或网络请求

### 用户操作流程

```
打开 popup → 点击「⚙️ 选择器配置」→ 编辑字段 → 点击「保存配置」
                                                    ↓
                                          写入 chrome.storage.local
                                                    ↓
                                    下次点击操作按钮时 content.js 自动读取
```

### 上下文定位原理（点赞按钮专用）

```
页面 DOM 结构（示意）：
┌──────────────────────────────────────────┐
│  [👍 点赞]  [❤️ 收藏]  [💬]  [🔗]        │  ← 工具栏
│     ↑           ↑                        │
│  目标按钮    gtm-main-bookmark（稳定锚点）  │
└──────────────────────────────────────────┘

定位步骤：
1. 找到 button.gtm-main-bookmark（GTM 类名，稳定）
2. 向上遍历找包含多个 button 的父容器（工具栏）
3. 在工具栏中找第一个非已知按钮（排除 bookmark/follow/comment/share）
4. 验证：有 SVG 图标 + 文本很短 → 确认为点赞按钮
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `content.js` | 新增 `DEFAULT_SELECTORS`、`loadSelectors()`、`findLikeButtonByContext()`；`clickLike/clickBookmark/clickFollow/ensureExpandedAndGetLink` 全部改为读取配置化选择器 |
| `popup.html` | 宽度增至 260px，新增可折叠「⚙️ 选择器配置」面板，7 个输入框 + 恢复默认/保存按钮 |
| `popup.js` | 新增 `DEFAULT_SELECTORS`、`loadSelectorFields()`、保存/重置逻辑 |

---

## ✅ 做得好的地方（不变）

1. **诊断日志完善** — 点赞/收藏/关注都有详细的元素信息输出，方便调试
2. **防重复机制** — 点赞（class 检测）、收藏（aria-label + mask 双重检测）、关注（文字+variant 双重检测）
3. **错误上报机制** — `reportError` 统一上报到 Service Worker，集中管理
4. **IIFE 封装** — content.js 使用立即执行函数，避免全局污染
5. **Manifest V3** — 使用最新的扩展清单版本
6. **README 详尽** — 文档覆盖架构、选择器来源、维护指南，质量很高
7. **多页图片支持** — 通过 Ajax API 获取分页 URL，考虑周全

---

*报告完毕。所有 P0/P1/P2 代码问题已修复，多路 fallback 哲学完整保留。*
