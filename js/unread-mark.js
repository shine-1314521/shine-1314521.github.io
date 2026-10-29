/* 会飞的皮卡 · 未读标记
 * 灵感来自张洪Heo的博客：localStorage 记录已读文章，列表页给未读标题加小红点。
 * 兼容 PJAX：pjax:complete 时重新装饰；点击即标记已读，返回列表时红点消失。
 * 任何 localStorage 不可用的情况（隐私模式等）静默降级，不影响浏览。
 */
(function () {
  var KEY_PREFIX = 'pika-read:';
  var DOT_CLASS = 'unread-dot';

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function isRead(path) {
    return safe(function () { return localStorage.getItem(KEY_PREFIX + path) === '1'; }, true);
  }

  function markRead(path) {
    safe(function () { localStorage.setItem(KEY_PREFIX + path, '1'); });
  }

  function pathOf(anchor) {
    return safe(function () { return new URL(anchor.href, location.href).pathname; }, '');
  }

  function isPostPath(path) {
    return path.indexOf('/posts/') === 0;
  }

  function removeDot(anchor) {
    var dot = anchor.querySelector('.' + DOT_CLASS);
    if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
  }

  function decorate() {
    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var path = pathOf(a);
      if (!isPostPath(path) || isRead(path)) continue;
      if (a.querySelector('.' + DOT_CLASS)) continue;
      if (!a.querySelector('img')) {
        var dot = document.createElement('span');
        dot.className = DOT_CLASS;
        dot.title = '未读';
        dot.setAttribute('aria-label', '未读');
        a.appendChild(dot);
      }
    }
  }

  function markCurrent() {
    if (isPostPath(location.pathname)) markRead(location.pathname);
  }

  function injectStyle() {
    var css = '.unread-dot{display:inline-block;width:7px;height:7px;border-radius:50%;'
      + 'background:#e24b4a;margin-left:6px;vertical-align:middle;flex:none}'
      + '.article-title .unread-dot{margin-left:6px}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var path = pathOf(a);
    if (isPostPath(path)) {
      markRead(path);
      removeDot(a);
    }
  }

  function init() {
    injectStyle();
    markCurrent();
    decorate();
    document.addEventListener('click', onClick, true);
    document.addEventListener('pjax:complete', function () {
      markCurrent();
      decorate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
