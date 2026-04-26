// popup.js - 弹出面板交互逻辑 + 选择器配置管理

const buttons = {
  like:      document.getElementById('likeBtn'),
  bookmark:  document.getElementById('bookmarkBtn'),
  follow:    document.getElementById('followBtn'),
  save:      document.getElementById('saveBtn'),
  all:       document.getElementById('allBtn')
};
const statusDiv = document.getElementById('status');

// ═══════════════════════════════════════════════════════════════
//  内置默认选择器（与 content.js 保持同步）
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

// 选择器字段映射
const SELECTOR_KEYS = ['like', 'liked', 'bookmark', 'follow', 'expandContainer', 'expandLink', 'imgOriginal'];

// ═══════════════════════════════════════════════════════════════
//  全局模式
// ═══════════════════════════════════════════════════════════════
let isGlobalMode = false;
const toggle = document.getElementById('globalModeToggle');
if (toggle) {
  chrome.storage.local.get('globalMode', (data) => {
    isGlobalMode = data.globalMode || false;
    toggle.checked = isGlobalMode;
  });

  toggle.addEventListener('change', (e) => {
    isGlobalMode = e.target.checked;
    chrome.storage.local.set({ globalMode: isGlobalMode });
    setStatus(isGlobalMode ? '全局模式已开启' : '全局模式已关闭', 'success');
  });
}

// ═══════════════════════════════════════════════════════════════
//  选择器配置面板
// ═══════════════════════════════════════════════════════════════
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel  = document.getElementById('settingsPanel');
let panelOpen = false;

if (settingsToggle && settingsPanel) {
  settingsToggle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    if (panelOpen) {
      settingsPanel.classList.add('visible');
      settingsToggle.classList.add('open');
    } else {
      settingsPanel.classList.remove('visible');
      settingsToggle.classList.remove('open');
    }
  });

  // 加载已保存的选择器到输入框
  loadSelectorFields();

  // 恢复默认按钮
  document.getElementById('resetSelectorsBtn').addEventListener('click', () => {
    for (const key of SELECTOR_KEYS) {
      const input = document.getElementById('sel_' + key);
      if (input) input.value = DEFAULT_SELECTORS[key];
    }
    setStatus('已恢复为默认选择器（点击保存生效）', 'success');
  });

  // 保存按钮
  document.getElementById('saveSelectorsBtn').addEventListener('click', async () => {
    const selectors = {};
    for (const key of SELECTOR_KEYS) {
      const input = document.getElementById('sel_' + key);
      selectors[key] = (input && input.value.trim()) || DEFAULT_SELECTORS[key];
    }
    try {
      await chrome.storage.local.set({ selectors });
      setStatus('选择器配置已保存 ✓', 'success');
    } catch (e) {
      setStatus('保存失败: ' + e.message, 'error');
    }
  });
}

/**
 * 从 storage 加载用户配置到输入框
 */
async function loadSelectorFields() {
  try {
    const data = await chrome.storage.local.get('selectors');
    const saved = (data && data.selectors) || {};

    for (const key of SELECTOR_KEYS) {
      const input = document.getElementById('sel_' + key);
      if (!input) continue;

      // 用户保存过的值优先，否则显示默认值
      input.value = saved[key] || DEFAULT_SELECTORS[key];
    }
  } catch (e) {
    // 加载失败时显示默认值
    for (const key of SELECTOR_KEYS) {
      const input = document.getElementById('sel_' + key);
      if (input) input.value = DEFAULT_SELECTORS[key];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  状态提示
// ═══════════════════════════════════════════════════════════════
const actionLabels = {
  like:      '点赞',
  bookmark:  '收藏',
  follow:    '关注',
  save:      '保存原图',
  all:       '一键四连'
};

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

// ═══════════════════════════════════════════════════════════════
//  批量操作（全局模式）
// ═══════════════════════════════════════════════════════════════
async function executeOnAllTabs(action) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.pixiv.net/artworks/*" });
    if (tabs.length === 0) {
      setStatus('未找到任何 Pixiv 作品页', 'error');
      return false;
    }

    setStatus(`正在对 ${tabs.length} 个页面执行 ${actionLabels[action]}...`);

    const promises = tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, { action }).then(
        resp => ({ success: resp?.success === true, tabId: tab.id, error: null }),
        err => ({ success: false, tabId: tab.id, error: err.message })
      )
    );

    const results = await Promise.all(promises);
    const succeeded = results.filter(r => r.success).length;
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

// ═══════════════════════════════════════════════════════════════
//  发送操作指令
// ═══════════════════════════════════════════════════════════════
async function sendAction(action) {
  if (isGlobalMode) {
    await executeOnAllTabs(action);
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('pixiv.net/artworks')) {
      setStatus('请先打开 Pixiv 作品页', 'error');
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
      chrome.runtime.sendMessage({
        action: 'reportError',
        errorAction: action,
        errorMessage: errorMsg,
        errorDetail: `Tab ${tab.id}, Response: ${JSON.stringify(response)}`
      }).catch(() => {});
    }
  } catch (e) {
    const msg = e.message.includes('Could not establish connection')
      ? '无法连接页面，请刷新后重试'
      : `错误: ${e.message}`;
    setStatus(msg, 'error');
    console.error('[Pixiv Helper Popup]', e);

    chrome.runtime.sendMessage({
      action: 'reportError',
      errorAction: action,
      errorMessage: msg,
      errorDetail: e.message,
      errorStack: e.stack || ''
    }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
//  绑定按钮事件
// ═══════════════════════════════════════════════════════════════
buttons.like.onclick     = () => sendAction('like');
buttons.bookmark.onclick = () => sendAction('bookmark');
buttons.follow.onclick   = () => sendAction('follow');
buttons.save.onclick     = () => sendAction('save');
buttons.all.onclick      = () => sendAction('all');
