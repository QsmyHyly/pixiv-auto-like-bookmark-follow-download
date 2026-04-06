// background.js - Service Worker
// 负责处理来自 content.js 的文件下载请求（备用方式）
// 主要方式已改为模拟中键点击在新标签页中打开图片
// 此文件保留 chrome.downloads 下载能力作为后备
// 同时接收并记录所有错误日志

// ─────────────────────────────────────────────────────────────
//  错误日志接收（来自 content.js 和 popup.js）
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理错误日志上报
  if (request.action === 'reportError') {
    const timestamp = new Date().toLocaleString('zh-CN');
    const tabInfo = sender.tab ? `Tab ${sender.tab.id} (${sender.tab.url || 'unknown'})` : 'No Tab';
    
    console.error(`[Pixiv Helper BG] ❌ 错误报告`, {
      timestamp,
      tabInfo,
      action: request.errorAction,
      message: request.errorMessage,
      detail: request.errorDetail || '',
      stack: request.errorStack || ''
    });
    
    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true;
  }

  // 处理下载请求
  if (request.action === 'download' && request.url) {
    // 从 URL 路径末尾提取文件名
    const rawName = request.url.split('/').pop() || 'pixiv_original.jpg';
    // 去掉 URL 参数部分（如 ?1234567890）
    const fileName = rawName.split('?')[0];

    chrome.downloads.download(
      {
        url: request.url,
        filename: fileName,
        conflictAction: 'uniquify' // 同名文件自动重命名，不覆盖
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[Pixiv Helper BG] 下载失败:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[Pixiv Helper BG] 下载已开始，ID:', downloadId);
          sendResponse({ success: true, downloadId });
        }
      }
    );

    return true; // 表示异步 sendResponse
  }
});
