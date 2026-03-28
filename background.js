// background.js - Service Worker
// 负责处理来自 content.js 的文件下载请求（备用方式）
// 主要方式已改为模拟中键点击在新标签页中打开图片
// 此文件保留 chrome.downloads 下载能力作为后备

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
