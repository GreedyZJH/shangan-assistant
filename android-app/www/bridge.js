/* 安卓桥接：DB 初始化完成后挂载 window.pywebview.api 并广播 pywebviewready。
 * app.js 零改动复用：启动轮询 window.pywebview 或监听 pywebviewready 均可。 */
(function () {
  'use strict';
  async function start() {
    try { await window.DB.init(); }
    catch (e) { console.error("数据库初始化失败", e); }
    window.pywebview = { api: window.AndroidAPI };
    try { window.dispatchEvent(new Event("pywebviewready")); } catch (e) {}
  }
  start();
})();
