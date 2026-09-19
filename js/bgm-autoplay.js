/* ============================================================
 * bgm-autoplay.js —— 背景音乐自动播放兜底
 * ------------------------------------------------------------
 * 背景：Chrome / Safari / 移动端浏览器的「自动播放策略」会拦截
 *       带声音的自动播放，所以 <meting-js autoplay="true"> 在首次
 *       访问（用户还没和页面交互过）时经常不响。
 *
 * 做法：在页面内第一次「点击 / 触摸 / 按键」时，尝试继续播放
 *       （MetingJS 创建的 APlayer 实例都挂在 window.aplayers 上）。
 *       一次尝试成功后就不再干扰，用户手动暂停不会被强行恢复。
 *
 * 依赖：主题的 aplayerInject（注入 APlayer + MetingJS），无需其它改动。
 * ============================================================ */
(function () {
  var done = false;

  function tryPlay () {
    if (done) return;
    if (!window.aplayers || !window.aplayers.length) return; // 播放器还没创建好，等下次交互

    for (var i = 0; i < window.aplayers.length; i++) {
      var player = window.aplayers[i];
      try {
        if (player && player.audio && player.audio.paused) {
          var r = player.play();
          if (r && typeof r.then === 'function') {
            r.then(function () { done = true; }, function () { /* 仍被拦截，等下次交互再试 */ });
          } else {
            done = true;
          }
        }
      } catch (e) {
        /* 忽略异常，等下一次交互 */
      }
    }
  }

  ['click', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, tryPlay, { passive: true });
  });
})();
