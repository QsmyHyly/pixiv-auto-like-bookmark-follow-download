(() => {
  // ═══════════════════════════════════════════════════════════════
  //  Pixiv Auto Like & Follow & Save  ·  content.js
  //
  //  【点赞按钮】
  //    未点赞：class = "style_button__c7Nvf"
  //    已点赞：class = "style_liked__EIbS8 style_button__c7Nvf"
  //    → 通过检查是否含 style_liked__EIbS8 判断是否已点赞
  //
  //  【关注按钮】
  //    data-click-label="follow"（两种状态均存在）
  //    未关注：variant="Primary"，文字含"加关注"
  //    已关注：variant="Default"，文字含"正在关注"
  //
  //  【收藏按钮】
  //    class="... gtm-main-bookmark"（心形图标按钮）
  //    未收藏：心形为空心
  //    已收藏：心形为实心
  //    → 通过检查 SVG 内部 path 的 fill 状态或按钮 aria-label 判断
  //
  //  【原图保存 - 两种方式并存】
  //    方式A（模拟中键点击）：
  //      找到 <a class="gtm-expand-full-size-illust">，
  //      模拟鼠标中键（button=1 + auxclick 事件）触发新标签页打开原图
  //      浏览器会自动携带 Cookie/Referer，避免 403 Forbidden
  //    方式B（模拟单击图片）：
  //      点击 <div/a class="gtm-expand-full-size-illust"> 触发 Pixiv 内部图片查看器
  //      在查看器中可直接右键另存为原图
  //    方式C（DOM 方式备用）：
  //      若未展开，先点击触发展开，等待 <a> 出现后再中键点击
  //
  //  【多页图片】
  //    通过 /ajax/illust/{id}/pages API 获取所有分页 URL（_p0, _p1, _p2...）
  //    逐个模拟中键点击打开新标签页
  // ═══════════════════════════════════════════════════════════════

  const LOG = '[Pixiv Helper]';

  // ═══════════════════════════════════════════════════════════════
  //  选择器配置系统
  //  优先级：用户自定义(chrome.storage.local) > 内置默认值
  //  扩展更新时自带新默认值，用户覆盖值持久保留
  // ═══════════════════════════════════════════════════════════════
  const DEFAULT_SELECTORS = {
    like:            'button.style_button__c7Nvf',
    liked:           'style_liked__EIbS8',
    bookmark:        'button.gtm-main-bookmark',
    follow:          'button[data-click-label="follow"]',
    expandContainer: '.gtm-expand-full-size-illust',
    expandLink:      'a.gtm-expand-full-size-illust',
    imgOriginal:     'a[href*="img-original"]',
  };

  /**
   * 从 storage 读取用户自定义选择器，合并默认值
   * @returns {Promise<Object>} 合并后的选择器映射
   */
  async function loadSelectors() {
    try {
      const data = await chrome.storage.local.get('selectors');
      const user = (data && data.selectors) || {};
      // 用户配置优先，缺失的用默认值补全
      return { ...DEFAULT_SELECTORS, ...user };
    } catch (e) {
      return { ...DEFAULT_SELECTORS };
    }
  }

  /**
   * 上下文定位：从稳定的收藏按钮推导点赞按钮位置
   * 不依赖 hash 类名，作为最后防线
   * @returns {Element|null}
   */
  async function findLikeButtonByContext() {
    console.log(`${LOG} [Like] 尝试上下文定位...`);
    try {
      // 找到稳定的收藏按钮锚点
      const bookmarkBtn = await waitForElement('button.gtm-main-bookmark', 5000);

      // 向上查找工具栏容器（包含多个按钮的父元素）
      let toolbar = bookmarkBtn.parentElement;
      for (let i = 0; i < 6 && toolbar; i++) {
        const btns = toolbar.querySelectorAll('button');
        if (btns.length >= 2) break;
        toolbar = toolbar.parentElement;
      }
      if (!toolbar) return null;

      // 工具栏中找点赞按钮：第一个非已知按钮 + 有 SVG 图标
      const buttons = toolbar.querySelectorAll('button');
      const knownLabels = ['bookmark', 'follow', 'comment', 'share'];

      for (const btn of buttons) {
        const label = btn.getAttribute('data-click-label') || '';
        if (knownLabels.includes(label)) continue;

        const svg = btn.querySelector('svg');
        const text = (btn.textContent || '').trim();
        if (svg && text.length < 10) {
          console.log(`${LOG} [Like] 上下文定位成功: class="${btn.className}"`);
          return btn;
        }
      }

      // 宽松匹配：返回第一个非已知按钮
      for (const btn of buttons) {
        const label = btn.getAttribute('data-click-label') || '';
        if (!knownLabels.includes(label)) {
          console.log(`${LOG} [Like] 上下文定位(宽松): class="${btn.className}"`);
          return btn;
        }
      }
    } catch (e) {
      console.log(`${LOG} [Like] 上下文定位失败: ${e.message}`);
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：向 Service Worker 上报错误
  // ─────────────────────────────────────────────────────────────
  function reportError(errorAction, errorMessage, errorDetail = '', errorStack = '') {
    chrome.runtime.sendMessage({
      action: 'reportError',
      errorAction,
      errorMessage,
      errorDetail,
      errorStack
    }).catch(err => {
      // Service Worker 可能未激活，仅本地记录
      console.warn(`${LOG} 无法上报错误到 Service Worker:`, err.message);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：等待 DOM 元素出现
  // ─────────────────────────────────────────────────────────────
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout waiting for: ${selector}`));
      }, timeout);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：从当前 URL 提取 illustId
  // ─────────────────────────────────────────────────────────────
  function getIllustId() {
    const m = location.pathname.match(/\/artworks\/(\d+)/);
    return m ? m[1] : null;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：从 DOM 元素在新标签页打开图片（多路顺序 fallback）
  //  在新标签页中打开链接，浏览器会自动携带正确的 Referer/Cookie
  //  避免 i.pximg.net 的 403 Forbidden
  //
  //  Fallback 链（按可靠性排序，一个失败才试下一个）：
  //    1. chrome.tabs.create — 扩展 API，绕过弹窗拦截器，最可靠
  //    2. window.open        — 可能被弹窗拦截器拦截
  //    3. dispatchEvent auxclick — 部分浏览器可能响应
  // ─────────────────────────────────────────────────────────────
  async function openImageFromElement(element) {
    const url = element.href;
    if (!url) {
      console.warn(`${LOG} [Save] 元素无 href，无法打开`);
      return false;
    }

    // 方式1：chrome.tabs.create（扩展 API，绕过弹窗拦截器）
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab) {
        console.log(`${LOG} [Save] ✓ tabs.create 打开: ${url}`);
        return true;
      }
    } catch (e) {
      console.log(`${LOG} [Save] tabs.create 失败: ${e.message}`);
    }

    // 方式2：window.open（可能被弹窗拦截器拦截）
    const win = window.open(url, '_blank', 'noopener');
    if (win) {
      console.log(`${LOG} [Save] ✓ window.open 打开: ${url}`);
      return true;
    }
    console.log(`${LOG} [Save] window.open 被拦截，尝试 auxclick...`);

    // 方式3：dispatchEvent auxclick（最后手段）
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', {
        button: 1, bubbles: true, cancelable: true, composed: true
      }));
      element.dispatchEvent(new MouseEvent('mousedown', {
        button: 1, bubbles: true, cancelable: true
      }));
      element.dispatchEvent(new MouseEvent('mouseup', {
        button: 1, bubbles: true, cancelable: true
      }));
      element.dispatchEvent(new MouseEvent('auxclick', {
        button: 1, bubbles: true, cancelable: true
      }));
      console.log(`${LOG} [Save] 已尝试 auxclick 事件（浏览器可能忽略）`);
    } catch (e) {
      console.log(`${LOG} [Save] auxclick 失败: ${e.message}`);
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：模拟单击图片（打开 Pixiv 内部图片查看器）
  // ─────────────────────────────────────────────────────────────
  function simulateLeftClick(element) {
    element.dispatchEvent(new MouseEvent('click', {
      button: 0, bubbles: true, cancelable: true
    }));
    console.log(`${LOG} 已模拟左键点击，图片将在查看器中打开`);
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：延迟
  // ─────────────────────────────────────────────────────────────
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════
  //  点赞（完整 fallback 链：用户选择器 → 默认选择器 → 上下文定位 → 诊断）
  // ═══════════════════════════════════════════════════════════════
  async function clickLike() {
    try {
      const selectors = await loadSelectors();
      const likeSelector = selectors.like;
      const likedClass  = selectors.liked;

      console.log(`${LOG} [Like] 使用选择器: like="${likeSelector}", liked="${likedClass}"`);

      // ── 第1路：尝试当前选择器 ──────────────────────────
      let likeBtn = null;
      let foundBy = '';

      try {
        likeBtn = await waitForElement(likeSelector);
        foundBy = 'selector';
      } catch (_) {
        console.log(`${LOG} [Like] 选择器 "${likeSelector}" 未匹配，尝试上下文定位...`);
      }

      // ── 第2路：上下文定位（从收藏按钮推导） ─────────────
      if (!likeBtn) {
        likeBtn = await findLikeButtonByContext();
        if (likeBtn) foundBy = 'context';
      }

      // ── 第3路：全部失败，输出诊断 ──────────────────────
      if (!likeBtn) {
        console.warn(`${LOG} [Like] ✗ 所有方式均未找到点赞按钮`);
        const candidates = document.querySelectorAll(
          'button[class*="button"], button[data-click-label], button[aria-label]'
        );
        if (candidates.length > 0) {
          console.log(`${LOG} [Like] 诊断 - 页面上的候选按钮:`);
          candidates.forEach((btn, idx) => {
            if (idx < 15) {
              console.log(`  [${idx}] class="${btn.className}" label="${btn.getAttribute('aria-label') || ''}" text="${(btn.innerText||'').trim().substring(0, 40)}" data-click-label="${btn.getAttribute('data-click-label') || ''}"`);
            }
          });
        }
        return false;
      }

      // ── 详细诊断输出 ──
      console.log(`${LOG} [Like] 找到按钮 (via ${foundBy}):`, {
        tagName: likeBtn.tagName,
        className: likeBtn.className,
        allClasses: [...likeBtn.classList],
        disabled: likeBtn.disabled,
        innerText: (likeBtn.innerText || '').trim().substring(0, 50),
        ariaLabel: likeBtn.getAttribute('aria-label') || '',
        outerHTML: likeBtn.outerHTML.substring(0, 300),
      });

      // 检查是否已点赞
      const isLiked = likeBtn.classList.contains(likedClass);
      console.log(`${LOG} [Like] 已点赞检测: ${likedClass} = ${isLiked}`);

      if (isLiked) {
        console.log(`${LOG} [Like] 已点赞，跳过`);
        return true;
      }

      if (likeBtn.disabled) {
        console.warn(`${LOG} [Like] 点赞按钮已禁用`);
        return false;
      }

      likeBtn.click();
      console.log(`${LOG} [Like] ✓ 点赞成功`);
      return true;
    } catch (e) {
      console.warn(`${LOG} [Like] ✗ 点赞失败:`, e.message);
      reportError('like', e.message, '点赞操作失败', e.stack || '');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  关注
  // ═══════════════════════════════════════════════════════════════
  async function clickFollow() {
    try {
      const selectors = await loadSelectors();
      const followSelector = selectors.follow;

      console.log(`${LOG} [Follow] 使用选择器: "${followSelector}"`);

      const followBtn = await waitForElement(followSelector);

      const text = (followBtn.textContent || followBtn.innerText || '').trim();

      console.log(`${LOG} [Follow] 找到按钮:`, {
        tagName: followBtn.tagName,
        className: followBtn.className,
        allClasses: [...followBtn.classList],
        text: text,
        disabled: followBtn.disabled,
        dataVariant: followBtn.getAttribute('data-variant') || followBtn.dataset.variant || '',
        ariaLabel: followBtn.getAttribute('aria-label') || '',
      });

      const isUnfollowed =
        text.includes('加关注') ||
        text.includes('フォロー') ||
        text.includes('Follow');

      const isPrimary = followBtn.getAttribute('data-variant') === 'Primary';

      console.log(`${LOG} [Follow] 判断: textMatch=${isUnfollowed}, variantPrimary=${isPrimary}`);

      if (isUnfollowed || isPrimary) {
        if (followBtn.disabled) {
          console.warn(`${LOG} [Follow] 关注按钮已禁用`);
          return false;
        }
        followBtn.click();
        console.log(`${LOG} [Follow] ✓ 关注成功`);
        return true;
      }

      console.log(`${LOG} [Follow] 已关注，跳过（文字: "${text}"）`);
      return false;
    } catch (e) {
      console.warn(`${LOG} [Follow] ✗ 关注失败:`, e.message);
      reportError('follow', e.message, '关注操作失败', e.stack || '');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  收藏（添加书签）
  //  选择器可配置，防重复：aria-label + SVG mask 双重检测
  // ═══════════════════════════════════════════════════════════════
  async function clickBookmark() {
    try {
      const selectors = await loadSelectors();
      const bookmarkSelector = selectors.bookmark;

      console.log(`${LOG} [Bookmark] 使用选择器: "${bookmarkSelector}"`);

      const bookmarkBtn = await waitForElement(bookmarkSelector);

      // ── 详细诊断输出 ──
      console.log(`${LOG} [Bookmark] 找到按钮:`, {
        tagName: bookmarkBtn.tagName,
        className: bookmarkBtn.className,
        allClasses: [...bookmarkBtn.classList],
        disabled: bookmarkBtn.disabled,
        ariaLabel: bookmarkBtn.getAttribute('aria-label') || '',
        outerHTML: bookmarkBtn.outerHTML.substring(0, 400),
      });

      // 检查是否已收藏（双重检测，任一命中即为已收藏）
      //
      // 检测策略：
      // 1. aria-label 关键词（最可靠）
      //    - 已收藏时含"済み"/"已收藏"/"Bookmarked"/"Saved"
      // 2. SVG mask 检测（辅助）
      //    - 未收藏时：心形通过 mask 遮罩实现镂空效果，SVG 内含 <mask> 元素
      //    - 已收藏时：心形为实心填充，无 mask 元素
      const svgEl = bookmarkBtn.querySelector('svg');
      const hasMask = svgEl && svgEl.querySelector('mask') !== null;

      const ariaLabel = bookmarkBtn.getAttribute('aria-label') || '';
      const labelIndicatesBookmarked =
        ariaLabel.includes('済み') ||  // 日本語 "ブックマーク済み"
        ariaLabel.includes('已收藏') ||
        ariaLabel.includes('Saved') ||
        ariaLabel.includes('Bookmarked');

      // 双重检测：aria-label 明确表示已收藏，或没有 mask（实心心形）
      const isBookmarked = labelIndicatesBookmarked || !hasMask;

      console.log(`${LOG} [Bookmark] aria-label="${ariaLabel}", hasMask=${hasMask}, isBookmarked=${isBookmarked}`);

      if (isBookmarked) {
        console.log(`${LOG} [Bookmark] 已收藏，跳过`);
        return true;
      }

      if (bookmarkBtn.disabled) {
        console.warn(`${LOG} [Bookmark] 收藏按钮已禁用`);
        return false;
      }

      // 额外安全检查：列出匹配的按钮
      const allBtns = document.querySelectorAll(bookmarkSelector);
      if (allBtns.length > 1) {
        console.warn(`${LOG} [Bookmark] ⚠️ 页面上找到 ${allBtns.length} 个匹配按钮，使用了第一个`);
      }

      bookmarkBtn.click();
      console.log(`${LOG} [Bookmark] ✓ 收藏成功`);
      return true;
    } catch (e) {
      console.warn(`${LOG} [Bookmark] ✗ 收藏失败:`, e.message);
      reportError('bookmark', e.message, '收藏操作失败', e.stack || '');

      // 诊断：列出所有包含 bookmark 的按钮
      const candidates = document.querySelectorAll(
        'button[class*="bookmark"], button[aria-label*="bookmark"], button[aria-label*="收藏"]'
      );
      if (candidates.length > 0) {
        console.log(`${LOG} [Bookmark] 诊断 - 页面上的候选按钮:`);
        candidates.forEach((btn, idx) => {
          if (idx < 10) {
            console.log(`  [${idx}] class="${btn.className}" label="${btn.getAttribute('aria-label') || ''}"`);
          }
        });
      }

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  获取多页图片列表（通过 Ajax API）
  //  返回 URL 数组，如 ["..._p0.jpg", "..._p1.jpg", "..._p2.jpg"]
  // ═══════════════════════════════════════════════════════════════
  async function getAllImageUrls(illustId) {
    if (!illustId) return [];

    try {
      const resp = await fetch(
        `https://www.pixiv.net/ajax/illust/${illustId}/pages`,
        { credentials: 'include' }
      );
      if (!resp.ok) {
        console.warn(`${LOG} [Save] pages API 返回 ${resp.status}`);
        return [];
      }

      const json = await resp.json();
      if (json.error || !Array.isArray(json.body) || json.body.length === 0) {
        console.log(`${LOG} [Save] pages API 无数据，尝试单图`);
        return [];
      }

      const urls = json.body
        .map((page, idx) => {
          const url = page.urls && page.urls.original;
          return url ? { url, index: idx } : null;
        })
        .filter(Boolean);

      console.log(`${LOG} [Save] 通过 API 获取到 ${urls.length} 张图片:`);
      urls.forEach(({ url, index }) => {
        console.log(`  [${index}] ${url}`);
      });

      return urls;
    } catch (e) {
      console.warn(`${LOG} [Save] pages API 调用失败:`, e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  确保 DOM 中的图片展开状态（获取 <a> 标签而非 <div>）
  // ═══════════════════════════════════════════════════════════════
  async function ensureExpandedAndGetLink() {
    const selectors = await loadSelectors();
    const expandLinkSel  = selectors.expandLink;
    const containerSel   = selectors.expandContainer;
    const imgOriginalSel = selectors.imgOriginal;

    // 先尝试直接找 <a>
    try {
      const aLink = await waitForElement(expandLinkSel, 3000);
      if (aLink && aLink.href) {
        console.log(`${LOG} [Save] DOM 已展开，找到 <a href="${aLink.href}">`);
        return aLink;
      }
    } catch (_) {}

    // 找到容器（可能是 <div> 或 <a>），点击触发展开
    console.log(`${LOG} [Save] DOM 未展开，尝试点击触发展开...`);
    try {
      const container = await waitForElement(containerSel, 5000);
      console.log(`${LOG} [Save] 找到容器: ${container.tagName.toLowerCase()}, class="${container.className}"`);

      simulateLeftClick(container);
      await delay(1500);

      const aLink = await waitForElement(expandLinkSel, 5000);
      if (aLink && aLink.href) {
        console.log(`${LOG} [Save] 展开后找到 <a href="${aLink.href}">`);
        return aLink;
      }
    } catch (e) {
      console.warn(`${LOG} [Save] 展开失败:`, e.message);
    }

    // 最终备用：任意包含 img-original 的链接
    try {
      const fallback = await waitForElement(imgOriginalSel, 3000);
      if (fallback && fallback.href) {
        console.log(`${LOG} [Save] 备用找到链接: ${fallback.href}`);
        return fallback;
      }
    } catch (_) {}

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  保存原图（核心函数）
  //
  //  策略（多路顺序 fallback）：
  //  1. 通过 Ajax API 获取所有分页 URL（_p0, _p1, _p2...）
  //  2. 对每个 URL，按优先级尝试：tabs.create → window.open → downloads
  //  3. 若 API 失败，退化为纯 DOM 操作
  // ═══════════════════════════════════════════════════════════════
  async function saveOriginalImage() {
    const illustId = getIllustId();
    console.log(`${LOG} [Save] 开始保存原图，illustId=${illustId}`);

    // ── 步骤1：获取所有图片 URL ─────────────────────────────
    const imageList = await getAllImageUrls(illustId);

    if (imageList.length === 0) {
      // 单图：通过 /ajax/illust/{id} 获取
      console.log(`${LOG} [Save] 尝试单图 API...`);
      try {
        const resp = await fetch(
          `https://www.pixiv.net/ajax/illust/${illustId}`,
          { credentials: 'include' }
        );
        if (resp.ok) {
          const json = await resp.json();
          if (!json.error && json.body && json.body.urls && json.body.urls.original) {
            imageList.push({ url: json.body.urls.original, index: 0 });
            console.log(`${LOG} [Save] 单图 URL: ${json.body.urls.original}`);
          }
        }
      } catch (e) {
        console.warn(`${LOG} [Save] 单图 API 失败:`, e.message);
      }
    }

    // ── 步骤2：确保 DOM 展开状态 ─────────────────────────────
    const domLink = await ensureExpandedAndGetLink();
    if (domLink) {
      console.log(`${LOG} [Save] DOM 展开链接: href="${domLink.href}" tag=${domLink.tagName.toLowerCase()}`);
    } else {
      console.warn(`${LOG} [Save] 无法获取 DOM 链接`);
    }

    // ── 步骤3：保存图片 ─────────────────────────────────────
    if (imageList.length > 0) {
      console.log(`${LOG} [Save] 共 ${imageList.length} 张图片需要保存`);

      if (imageList.length === 1) {
        // 单图：优先用 DOM 链接（自带 Referer），否则用 API URL
        if (domLink && domLink.tagName.toLowerCase() === 'a' && domLink.href) {
          console.log(`${LOG} [Save] → 使用 DOM 链接打开`);
          return await openImageFromElement(domLink);
        } else if (domLink) {
          // <div> 状态，左键打开查看器
          console.log(`${LOG} [Save] → 模拟左键展开查看器（请在查看器中右键另存为）`);
          simulateLeftClick(domLink);
          return true;
        } else {
          // 无 DOM 链接，用 API URL
          console.log(`${LOG} [Save] → 无 DOM 链接，使用 API URL`);
          return await openImageFromUrl(imageList[0].url);
        }
      } else {
        // 多图：逐个用 API URL 打开
        let successCount = 0;
        for (let i = 0; i < imageList.length; i++) {
          const { url } = imageList[i];
          console.log(`${LOG} [Save] → [${i + 1}/${imageList.length}] ${url}`);

          await delay(600); // 间隔避免浏览器限流
          const ok = await openImageFromUrl(url);
          if (ok) successCount++;
        }

        console.log(`${LOG} [Save] ✓ 成功打开 ${successCount}/${imageList.length} 张图片`);
        if (successCount < imageList.length) {
          console.log(`${LOG} [Save] 提示：部分图片可能被拦截，请允许本站弹出窗口`);
        }
        return successCount > 0;
      }
    }

    // ── 步骤4：纯 DOM 备用（API 完全失败时） ─────────────────
    if (domLink) {
      console.log(`${LOG} [Save] API 无数据，使用纯 DOM 方式...`);
      if (domLink.tagName.toLowerCase() === 'a' && domLink.href) {
        return await openImageFromElement(domLink);
      } else {
        simulateLeftClick(domLink);
        console.log(`${LOG} [Save] 已在查看器中打开，请右键另存为保存原图`);
        return true;
      }
    }

    console.warn(`${LOG} [Save] ✗ 未找到任何原图链接`);
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：通过纯 URL 在新标签页打开图片（多路顺序 fallback）
  //
  //  Fallback 链（按可靠性排序，一个失败才试下一个）：
  //    1. chrome.tabs.create      — 扩展 API，最可靠
  //    2. window.open             — 可能被弹窗拦截器拦截
  //    3. chrome.downloads        — 直接下载到本地（通过 background.js）
  // ─────────────────────────────────────────────────────────────
  async function openImageFromUrl(url) {
    if (!url) return false;

    // 方式1：chrome.tabs.create（扩展 API，绕过弹窗拦截器）
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab) {
        console.log(`${LOG} [Save] ✓ tabs.create 打开: ${url}`);
        return true;
      }
    } catch (e) {
      console.log(`${LOG} [Save] tabs.create 失败: ${e.message}`);
    }

    // 方式2：window.open（可能被弹窗拦截器拦截）
    const win = window.open(url, '_blank', 'noopener');
    if (win) {
      console.log(`${LOG} [Save] ✓ window.open 打开: ${url}`);
      return true;
    }
    console.log(`${LOG} [Save] window.open 被拦截，尝试直接下载...`);

    // 方式3：chrome.downloads.download（通过 background.js 直接下载）
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'download', url });
      if (resp && resp.success) {
        console.log(`${LOG} [Save] ✓ downloads.download 已开始: ${url}`);
        return true;
      }
      console.log(`${LOG} [Save] downloads API 返回失败: ${JSON.stringify(resp)}`);
    } catch (e) {
      console.log(`${LOG} [Save] downloads API 调用失败: ${e.message}`);
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  //  消息监听（来自 popup.js）
  // ═══════════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      let result = false;
      let detail = '';

      switch (request.action) {
        case 'like':
          result = await clickLike();
          detail = 'like';
          break;
        case 'follow':
          result = await clickFollow();
          detail = 'follow';
          break;
        case 'bookmark':
          result = await clickBookmark();
          detail = 'bookmark';
          break;
        case 'save':
          result = await saveOriginalImage();
          detail = 'save';
          break;
        case 'all':
          console.log(`${LOG} [All] 一键四连开始`);
          const likeOk      = await clickLike();
          await delay(300);
          const bookmarkOk  = await clickBookmark();
          await delay(300);
          const followOk    = await clickFollow();
          await delay(300);
          const saveOk      = await saveOriginalImage();
          result = likeOk || bookmarkOk || followOk || saveOk;
          detail = `like=${likeOk} bookmark=${bookmarkOk} follow=${followOk} save=${saveOk}`;
          console.log(`${LOG} [All] 一键四连完成: ${detail}`);
          break;
        default:
          console.warn(`${LOG} 未知 action: ${request.action}`);
      }

      sendResponse({ success: result, detail });
    })();
    return true;
  });
})();
