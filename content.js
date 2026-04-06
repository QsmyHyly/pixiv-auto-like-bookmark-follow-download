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
  //  工具：模拟鼠标中键点击（auxclick）
  //  在新标签页中打开链接，浏览器会自动携带正确的 Referer/Cookie
  //  避免 i.pximg.net 的 403 Forbidden
  // ─────────────────────────────────────────────────────────────
  function simulateMiddleClick(element) {
    // 方式1：通过 dispatchEvent 触发 auxclick
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

    // 方式2：如果元素有 href，直接用 window.open 作为后备
    // （某些浏览器可能不响应 programmatic auxclick）
    if (element.href) {
      // 延迟一点，避免被 preventDefault 拦截
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = element.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        // 模拟 Ctrl+Click（等效于中键）
        a.dispatchEvent(new MouseEvent('click', {
          button: 0,
          ctrlKey: true,
          metaKey: false,
          bubbles: true,
          cancelable: true
        }));
        // 清理
        setTimeout(() => a.remove(), 500);
      }, 100);
    }

    console.log(`${LOG} 已模拟中键点击，图片将在新标签页打开`);
    return true;
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
  //  点赞（增加详细诊断日志）
  // ═══════════════════════════════════════════════════════════════
  async function clickLike() {
    try {
      console.log(`${LOG} [Like] 开始查找点赞按钮...`);

      const likeBtn = await waitForElement('button.style_button__c7Nvf');

      // ── 详细诊断输出 ──
      console.log(`${LOG} [Like] 找到按钮:`, {
        tagName: likeBtn.tagName,
        className: likeBtn.className,
        allClasses: [...likeBtn.classList],
        disabled: likeBtn.disabled,
        innerText: (likeBtn.innerText || '').trim().substring(0, 50),
        ariaLabel: likeBtn.getAttribute('aria-label') || '',
        outerHTML: likeBtn.outerHTML.substring(0, 300),
      });

      // 检查是否已点赞
      const isLiked = likeBtn.classList.contains('style_liked__EIbS8');
      console.log(`${LOG} [Like] 已点赞检测: style_liked__EIbS8 = ${isLiked}`);

      if (isLiked) {
        console.log(`${LOG} [Like] 已点赞，跳过`);
        return true;
      }

      if (likeBtn.disabled) {
        console.warn(`${LOG} [Like] 点赞按钮已禁用`);
        return false;
      }

      // 额外安全检查：遍历页面上所有匹配的按钮，确认选中的是正确的
      const allBtns = document.querySelectorAll('button.style_button__c7Nvf');
      if (allBtns.length > 1) {
        console.warn(`${LOG} [Like] ⚠️ 页面上找到 ${allBtns.length} 个匹配按钮，使用了第一个`);
        allBtns.forEach((btn, idx) => {
          console.log(`  [${idx}] class="${btn.className}" text="${(btn.innerText||'').trim().substring(0, 30)}"`);
        });
      }

      likeBtn.click();
      console.log(`${LOG} [Like] ✓ 点赞成功`);
      return true;
    } catch (e) {
      console.warn(`${LOG} [Like] ✗ 点赞失败:`, e.message);
      reportError('like', e.message, '点赞操作失败', e.stack || '');

      // 额外诊断：列出页面上所有可能的按钮
      const candidates = document.querySelectorAll(
        'button[class*="button"], button[data-click-label], button[aria-label]'
      );
      if (candidates.length > 0) {
        console.log(`${LOG} [Like] 诊断 - 页面上的候选按钮:`);
        candidates.forEach((btn, idx) => {
          if (idx < 15) {
            console.log(`  [${idx}] class="${btn.className}" label="${btn.getAttribute('aria-label') || ''}" text="${(btn.innerText||'').trim().substring(0, 40)}"`);
          }
        });
      }

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  关注
  // ═══════════════════════════════════════════════════════════════
  async function clickFollow() {
    try {
      console.log(`${LOG} [Follow] 开始查找关注按钮...`);

      const followBtn = await waitForElement('button[data-click-label="follow"]');

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

      const isPrimary = followBtn.getAttribute('data-variant') === 'Primary' ||
                        followBtn.dataset.variant === 'Primary';

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
  //  选择器：button.gtm-main-bookmark（心形图标按钮）
  //  防重复：检查 SVG 内部的 filled path 是否有 fill 属性
  // ═══════════════════════════════════════════════════════════════
  async function clickBookmark() {
    try {
      console.log(`${LOG} [Bookmark] 开始查找收藏按钮...`);

      const bookmarkBtn = await waitForElement('button.gtm-main-bookmark');

      // ── 详细诊断输出 ──
      console.log(`${LOG} [Bookmark] 找到按钮:`, {
        tagName: bookmarkBtn.tagName,
        className: bookmarkBtn.className,
        allClasses: [...bookmarkBtn.classList],
        disabled: bookmarkBtn.disabled,
        ariaLabel: bookmarkBtn.getAttribute('aria-label') || '',
        outerHTML: bookmarkBtn.outerHTML.substring(0, 400),
      });

      // 检查是否已收藏
      // 已收藏时：SVG 中第二个 <path>（心形填充部分）没有 fill="none" 或有实际 fill 色
      // 未收藏时：第二个 <path> class 含 "jgGXut"，且被 mask 遮罩（mask 内的心形是镂空的）
      // 更可靠的方式：检查按钮的 aria-label 或 data 属性
      //
      // 从用户提供 HTML 分析：
      //   未收藏：mask 内有心形 path（class="sc-16466e35-0 jgGXut"），视觉上为空心
      //   已收藏：可能 class 变化，或 fill 变化
      //
      // 实际检测策略：
      // 1. 检查 aria-label（如有"收藏済み"/"已收藏"等关键词表示已收藏）
      // 2. 检查 SVG path 的 mask 引用：有 mask id 通常是未收藏
      const svgEl = bookmarkBtn.querySelector('svg');
      const hasMask = svgEl && svgEl.querySelector('mask') !== null;

      console.log(`${LOG} [Bookmark] SVG mask 检测: hasMask=${hasMask}`);

      // 检查 aria-label
      const ariaLabel = bookmarkBtn.getAttribute('aria-label') || '';
      const isBookmarked =
        ariaLabel.includes('済み') ||  // 日本語 "ブックマーク済み"
        ariaLabel.includes('已收藏') ||
        ariaLabel.includes('Saved') ||
        ariaLabel.includes('Bookmarked');

      console.log(`${LOG} [Bookmark] aria-label="${ariaLabel}", isBookmarked=${isBookmarked}`);

      if (isBookmarked) {
        console.log(`${LOG} [Bookmark] 已收藏，跳过`);
        return true;
      }

      if (bookmarkBtn.disabled) {
        console.warn(`${LOG} [Bookmark] 收藏按钮已禁用`);
        return false;
      }

      // 额外安全检查：列出匹配的按钮
      const allBtns = document.querySelectorAll('button.gtm-main-bookmark');
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
    // 先尝试直接找 <a>
    try {
      const aLink = await waitForElement('a.gtm-expand-full-size-illust', 3000);
      if (aLink && aLink.href) {
        console.log(`${LOG} [Save] DOM 已展开，找到 <a href="${aLink.href}">`);
        return aLink;
      }
    } catch (_) {}

    // 找到 <div> 版本，点击触发展开
    console.log(`${LOG} [Save] DOM 未展开，尝试点击触发展开...`);
    try {
      const container = document.querySelector('.gtm-expand-full-size-illust');
      if (container) {
        console.log(`${LOG} [Save] 找到容器: ${container.tagName.toLowerCase()}, class="${container.className}"`);

        // 模拟左键点击展开
        simulateLeftClick(container);
        await delay(1000); // 等待 React 渲染

        // 尝试找 <a>
        const aLink = await waitForElement('a.gtm-expand-full-size-illust', 5000);
        if (aLink && aLink.href) {
          console.log(`${LOG} [Save] 展开后找到 <a href="${aLink.href}">`);
          return aLink;
        }
      }
    } catch (e) {
      console.warn(`${LOG} [Save] 展开失败:`, e.message);
    }

    // 最终备用：任意包含 img-original 的链接
    try {
      const fallback = await waitForElement('a[href*="img-original"]', 3000);
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
  //  策略：
  //  1. 通过 Ajax API 获取所有分页 URL（_p0, _p1, _p2...）
  //  2. 对每个 URL，在 DOM 中找到对应的 <a> 标签并模拟中键点击
  //     → 浏览器自动携带正确的 Referer/Cookie，避免 403
  //  3. 如果无法中键点击（比如 DOM 不支持），退化为 window.open
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

      let successCount = 0;

      if (imageList.length === 1) {
        // 单图：直接用 DOM 链接中键点击
        const target = domLink || null;
        if (target && target.tagName.toLowerCase() === 'a') {
          console.log(`${LOG} [Save] → 模拟中键点击: ${target.href}`);
          simulateMiddleClick(target);
          successCount = 1;
        } else if (target) {
          // <div> 状态，先展开
          console.log(`${LOG} [Save] → 模拟左键展开查看器（请在查看器中右键另存为）`);
          simulateLeftClick(target);
          successCount = 1;
        } else {
          // 无 DOM 链接，用 API URL 创建临时 <a> 中键点击
          console.log(`${LOG} [Save] → 无 DOM 链接，使用 API URL`);
          const url = imageList[0].url;
          simulateMiddleClickWithUrl(url);
          successCount = 1;
        }
      } else {
        // 多图：逐个处理
        for (let i = 0; i < imageList.length; i++) {
          const { url } = imageList[i];
          console.log(`${LOG} [Save] → [${i}/${imageList.length - 1}] ${url}`);

          await delay(500); // 间隔避免浏览器拦截弹窗

          // 对于每张图，创建临时 <a> 标签模拟中键点击
          simulateMiddleClickWithUrl(url);
          successCount++;
        }

        console.log(`${LOG} [Save] ✓ 已在新标签页中打开 ${successCount} 张图片`);
        console.log(`${LOG} [Save] 提示：浏览器可能拦截了多个弹窗，请允许本站弹出窗口`);
      }

      return successCount > 0;
    }

    // ── 备用方案：纯 DOM 操作 ───────────────────────────────
    if (domLink) {
      console.log(`${LOG} [Save] 使用备用 DOM 方式...`);
      if (domLink.tagName.toLowerCase() === 'a' && domLink.href) {
        // 已展开的 <a>：中键点击
        simulateMiddleClick(domLink);
        return true;
      } else {
        // 未展开的 <div>：左键点击打开查看器
        simulateLeftClick(domLink);
        console.log(`${LOG} [Save] 已在查看器中打开，请右键另存为保存原图`);
        return true;
      }
    }

    console.warn(`${LOG} [Save] ✗ 未找到任何原图链接`);
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  //  工具：通过 URL 模拟中键点击（创建临时 <a> 标签）
  // ─────────────────────────────────────────────────────────────
  function simulateMiddleClickWithUrl(url) {
    // 方式A：创建 <a> 标签模拟中键点击
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);

    // 先尝试模拟真正的鼠标中键
    a.dispatchEvent(new PointerEvent('pointerdown', {
      button: 1, bubbles: true, cancelable: true, composed: true
    }));
    a.dispatchEvent(new MouseEvent('mousedown', {
      button: 1, bubbles: true, cancelable: true
    }));
    a.dispatchEvent(new MouseEvent('mouseup', {
      button: 1, bubbles: true, cancelable: true
    }));
    a.dispatchEvent(new MouseEvent('auxclick', {
      button: 1, bubbles: true, cancelable: true
    }));

    // 方式B：window.open 作为后备（部分浏览器不响应 programmatic 中键）
    setTimeout(() => {
      // 尝试 Ctrl+Click
      a.dispatchEvent(new MouseEvent('click', {
        button: 0, ctrlKey: true, bubbles: true, cancelable: true
      }));
      setTimeout(() => a.remove(), 1000);
    }, 100);
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
