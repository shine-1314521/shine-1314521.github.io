/**
 * Twikoo 评论区兜底提示
 * 作用：当 Twikoo 未能成功渲染（envId 未配置、后端未部署、网络异常）时，
 *       在评论区位置显示友好提示，而不是留下一片空白。
 * 说明：不依赖任何外部资源；Twikoo 正常渲染时本脚本自动静默退出。
 */
(function () {
  'use strict'

  var CHECK_DELAY = 3000 // 评论区进入视野后，等待 3 秒再判断

  function getWrap() {
    return document.getElementById('twikoo-wrap')
  }

  function injectCss() {
    if (document.getElementById('twikoo-notice-css')) return
    var style = document.createElement('style')
    style.id = 'twikoo-notice-css'
    style.textContent =
      '.twikoo-notice{margin:1.6rem auto;max-width:540px;padding:18px 22px;' +
      'border:1px solid #e3e8ef;border-radius:10px;background:#f8fafc;' +
      'color:#4c4948;font-size:14px;line-height:1.8;text-align:center}' +
      '.twikoo-notice .twikoo-notice-title{display:block;margin-bottom:4px;' +
      'font-size:15px;font-weight:600;color:#49b1f5}' +
      '[data-theme="dark"] .twikoo-notice{background:#252a34;border-color:#3a4252;color:#c8d0dc}' +
      '[data-theme="dark"] .twikoo-notice .twikoo-notice-title{color:#7fa8dd}'
    document.head.appendChild(style)
  }

  function render(wrap) {
    injectCss()
    var box = document.createElement('div')
    box.className = 'twikoo-notice'
    var title = document.createElement('span')
    title.className = 'twikoo-notice-title'
    title.textContent = '评论区升级中'
    var text = document.createElement('div')
    text.textContent =
      '为了让大家免登录就能留言（只需填写昵称），评论区正在迁移到新系统，' +
      '配置完成后自动开放，敬请期待。'
    box.appendChild(title)
    box.appendChild(text)
    wrap.appendChild(box)

    // 防御：若 Twikoo 随后成功初始化，自动移除提示
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function () {
        if (wrap.querySelector('.tk-main, .tk-comments')) {
          mo.disconnect()
          box.remove()
        }
      })
      mo.observe(wrap, { childList: true, subtree: true })
    }
  }

  function start() {
    var wrap = getWrap()
    if (!wrap) return
    if (wrap.children.length) return // Twikoo 已渲染

    var timer = setTimeout(function () {
      var w = getWrap()
      if (w && !w.children.length) render(w)
    }, CHECK_DELAY)

    // 评论区进入视野后再开始计时，避免无谓等待
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) {
            io.disconnect()
            clearTimeout(timer)
            timer = setTimeout(function () {
              var w = getWrap()
              if (w && !w.children.length) render(w)
            }, CHECK_DELAY)
          }
        },
        { rootMargin: '120px' }
      )
      io.observe(wrap)
    }
  }

  // 初次加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }

  // PJAX 跳转后重新检查（Butterfly 的 PJAX 只替换 #body-wrap）
  document.addEventListener('pjax:complete', function () {
    setTimeout(start, 300)
  })
})()
