// popup.js - 弹出面板交互逻辑

const buttons = {
  like:      document.getElementById('likeBtn'),
  bookmark:  document.getElementById('bookmarkBtn'),
  follow:    document.getElementById('followBtn'),
  save:      document.getElementById('saveBtn'),
  all:       document.getElementById('allBtn')
};
const statusDiv = document.getElementById('status');

// 全局模式状态
let isGlobalMode = false;
const toggle = document.getElementById('globalModeToggle');
if (toggle) {
  toggle.addEventListener('change', (e) => {
    isGlobalMode = e.target.checked;
    setStatus(isGlobalMode ? '全局模式已开启' : '全局模式已关闭', 'success');
  });
}

// 状态标签映射
const actionLabels = {
  like:      '点赞',
  bookmark:  '收藏',
  follow:    '关注',
  save:      '保存原图',
  all:       '一键四连'
};

/**
 * 设置状态提示文字，3 秒后自动恢复"就绪"
 * @param {string} msg
 * @param {'success'|'error'|''} type
 */
function setStatus(msg, type = '') {
  statusDiv.textContent = msg;
  statusDiv.className = 'status ' + type;
  setTimeout(() => {
    if (statusDiv.textContent === msg) {
      statusDiv.textContent = '就绪';
      statusDiv.className = 'status';
    }
  }, 3000);
}

/**
 * 在所有 Pixiv 作品页上执行操作
 * @param {'like'|'bookmark'|'follow'|'save'|'all'} action
 */
async function executeOnAllTabs(action) {
  try {
    // 查询所有 Pixiv 作品页标签页
    const tabs = await chrome.tabs.query({ url: "https://www.pixiv.net/artworks/*" });
    if (tabs.length === 0) {
      setStatus('未找到任何 Pixiv 作品页', 'error');
      return false;
    }

    setStatus(`正在对 ${tabs.length} 个页面执行 ${actionLabels[action]}...`);

    // 向每个标签页发送消息，并行执行
    const promises = tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, { action }).then(
        resp => ({ success: resp?.success === true, tabId: tab.id, error: null }),
        err => ({ success: false, tabId: tab.id, error: err.message })
      )
    );

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      setStatus(`已在 ${succeeded} 个页面中执行 ✓`, 'success');
    } else {
      setStatus(`部分成功: ${succeeded} 成功, ${failed} 失败`, 'error');
    }
    return succeeded > 0;
  } catch (e) {
    console.error('[Pixiv Helper Popup] 批量执行失败', e);
    setStatus(`批量执行失败: ${e.message}`, 'error');
    return false;
  }
}

/**
 * 向当前 Tab 的 content.js 发送操作指令
 * @param {'like'|'bookmark'|'follow'|'save'|'all'} action
 */
async function sendAction(action) {
  // 全局模式：对所有 Pixiv 页面执行
  if (isGlobalMode) {
    await executeOnAllTabs(action);
    return;
  }

  // 原有单页面逻辑保持不变
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('pixiv.net/artworks')) {
      setStatus('请先打开 Pixiv 作品页', 'error');
      // 上报到 Service Worker
      chrome.runtime.sendMessage({
        action: 'reportError',
        errorAction: action,
        errorMessage: '不在 Pixiv 作品页',
        errorDetail: `当前 URL: ${tab?.url || 'unknown'}`
      }).catch(() => {});
      return;
    }

    setStatus(`${actionLabels[action]} 执行中…`);

    const response = await chrome.tabs.sendMessage(tab.id, { action });

    if (response && response.success) {
      if (action === 'save') {
        setStatus('已在新标签页中打开原图 ✓', 'success');
      } else if (action === 'all') {
        setStatus('一键四连完成 ✓', 'success');
      } else {
        setStatus(`${actionLabels[action]} 成功 ✓`, 'success');
      }
    } else {
      const errorMsg = `${actionLabels[action]} 失败，请检查页面`;
      setStatus(errorMsg, 'error');
      // 上报到 Service Worker
      chrome.runtime.sendMessage({
        action: 'reportError',
        errorAction: action,
        errorMessage: errorMsg,
        errorDetail: `Tab ${tab.id}, Response: ${JSON.stringify(response)}`
      }).catch(() => {});
    }
  } catch (e) {
    // 常见原因：content script 尚未注入（页面刚加载/非作品页）
    const msg = e.message.includes('Could not establish connection')
      ? '无法连接页面，请刷新后重试'
      : `错误: ${e.message}`;
    setStatus(msg, 'error');
    console.error('[Pixiv Helper Popup]', e);
    
    // 上报到 Service Worker
    chrome.runtime.sendMessage({
      action: 'reportError',
      errorAction: action,
      errorMessage: msg,
      errorDetail: e.message,
      errorStack: e.stack || ''
    }).catch(() => {});
  }
}

// 绑定按钮事件
buttons.like.onclick     = () => sendAction('like');
buttons.bookmark.onclick = () => sendAction('bookmark');
buttons.follow.onclick   = () => sendAction('follow');
buttons.save.onclick     = () => sendAction('save');
buttons.all.onclick      = () => sendAction('all');
