/* ============================================================
 * diary-unlock.js —— 日记板块的解锁脚本（纯前端解密）
 * ------------------------------------------------------------
 * · 密码不会出现在这个文件里；被加密的页面里只有密文 + salt/iv
 * · 算法：PBKDF2-SHA256 派生密钥 + AES-256-GCM（浏览器内置 Web Crypto）
 * · 验证一次后把密码存在 sessionStorage，同一标签页会话内
 *   浏览其它日记页面会自动解开，不用重复输入（关掉标签页即失效）
 * · 只作用于日记页面；没加密的页面运行时直接 return，什么都不做
 * ============================================================ */
(function () {
  'use strict';

  var lock = document.getElementById('diary-lock');
  var box = document.getElementById('diary-content');
  if (!lock || !box) return;

  var input = document.getElementById('diary-pw');
  var btn = document.getElementById('diary-unlock');
  var msg = document.getElementById('diary-msg');
  var foreverBox = document.getElementById('diary-forever');
  var forgetBtn = document.getElementById('diary-forget');
  var STORE_KEY = 'diary-pw';
  var ONE_DAY = 24 * 60 * 60 * 1000;

  /* 记住策略：
     · 勾选"本设备永久记住" → 永久（exp = 0），用在自己的电脑上
     · 不勾（默认）      → 这台设备记住 24 小时，用在别人的电脑上
     · 密码不会明文暴露在页面里，只存在浏览器的 localStorage 中 */
  function savePw (pw, forever) {
    var data = { pw: pw, exp: forever ? 0 : Date.now() + ONE_DAY };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function loadPw () {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.pw) return null;
      if (d.exp && Date.now() > d.exp) { localStorage.removeItem(STORE_KEY); return null; }
      return d.pw;
    } catch (e) {
      return null;
    }
  }

  function clearPw () {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  function b64ToBytes (str) {
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function decrypt (password) {
    var enc = new TextEncoder();
    var salt = b64ToBytes(lock.getAttribute('data-salt'));
    var iv = b64ToBytes(lock.getAttribute('data-iv'));
    var data = b64ToBytes(lock.getAttribute('data-ct'));
    var iterations = parseInt(lock.getAttribute('data-iter'), 10) || 150000;

    return crypto.subtle
      .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
      })
      .then(function (plain) {
        return new TextDecoder().decode(plain);
      });
  }

  function show (html) {
    box.innerHTML = html;
    box.hidden = false;
    if (lock.parentNode) lock.parentNode.removeChild(lock);
  }

  function unlock (password, silent) {
    if (!password) {
      if (!silent) msg.textContent = '请输入密码';
      return;
    }
    decrypt(password)
      .then(function (html) {
        // 只有手动输入时才更新"记住"的记录（自动解锁时不延长有效期）
        if (!silent) savePw(password, !!(foreverBox && foreverBox.checked));
        show(html);
      })
      .catch(function () {
        if (!silent) {
          msg.textContent = '密码不对，再试试～';
          if (input.select) input.select();
        }
      });
  }

  if (btn) btn.addEventListener('click', function () { unlock(input.value.trim()); });
  if (input) {
    input.addEventListener('keydown', function (e) {
      // 中文/日文输入法正在组词时按的回车（isComposing / keyCode 229）只是"确认候选词"，
      // 不是"提交密码" —— 不忽略它的话，用中文密码会被拿半成品去校验，看起来像"密码不对"
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') unlock(input.value.trim());
    });
  }

  if (forgetBtn) {
    forgetBtn.addEventListener('click', function (e) {
      e.preventDefault();
      clearPw();
      msg.textContent = '已清除这台设备记住的密码';
      if (input) input.focus();
    });
  }

  // 👁 显示 / 隐藏密码：切到明文后，被输入法"密码框保护"挡住的中文通常就能正常输入了
  var eyeBtn = document.getElementById('diary-eye');
  if (eyeBtn && input) {
    eyeBtn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });
  }

  var saved = loadPw();
  if (saved) {
    unlock(saved, true);   // 这台设备记住过密码 → 直接解开
  } else if (input) {
    input.focus();
  }
})();
