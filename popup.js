// popup.js - 弹出面板交互逻辑

const buttons = {
  like:      document.getElementById('likeBtn'),
  bookmark:  document.getElementById('bookmarkBtn'),
  follow:    document.getElementById('followBtn'),
  save:      document.getElementById('saveBtn'),
  all:       document.getElementById('allBtn')
};
const statusDiv = document.getElementById('status');

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
 * 向当前 Tab 的 content.js 发送操作指令
 * @param {'like'|'bookmark'|'follow'|'save'|'all'} action
 */
async function sendAction(action) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('pixiv.net/artworks')) {
      setStatus('请先打开 Pixiv 作品页', 'error');
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
      setStatus(`${actionLabels[action]} 失败，请检查页面`, 'error');
    }
  } catch (e) {
    // 常见原因：content script 尚未注入（页面刚加载/非作品页）
    const msg = e.message.includes('Could not establish connection')
      ? '无法连接页面，请刷新后重试'
      : `错误: ${e.message}`;
    setStatus(msg, 'error');
    console.error('[Pixiv Helper Popup]', e);
  }
}

// 绑定按钮事件
buttons.like.onclick     = () => sendAction('like');
buttons.bookmark.onclick = () => sendAction('bookmark');
buttons.follow.onclick   = () => sendAction('follow');
buttons.save.onclick     = () => sendAction('save');
buttons.all.onclick      = () => sendAction('all');
