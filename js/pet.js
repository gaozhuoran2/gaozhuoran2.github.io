/* ============================================================
 * pet.js —— 桌宠「团子」（纯前端、纯本地、零外部依赖）
 * ------------------------------------------------------------
 * 单击 = 摸它; 双击 / 点🐾 = 小面板; 拖动 = 给它搬家
 * 五种情绪：开心 / 无聊 / 困倦 / 委屈 / 生气
 * 能打字聊天（关键词 + 台词库，不是 AI，台词在 pet-lines.js）
 * 主人模式（你自己的电脑）：喂食、心情 / 亲密度 / 等级 / 领养天数、长期存档
 * 访客模式（别人的电脑）：只能聊、能点、不养成、不写任何存档
 *
 * 「主人模式」三条任一命中即认：
 *   1. 聊天框输入暗号 → 比对源码里的 SHA-256（源码不含明文）
 *   2. 这台浏览器"永久记住过日记密码"（localStorage['diary-pw'] 且 exp === 0）
 *   3. 带秘密参数的链接访问一次（CONFIG.ownerLink，明文较弱，可改可关）
 * ⚠ 网页源码人人可看 → 这是"防君子不防小人"的等级。
 *
 * 想彻底停用：注掉 _config.butterfly.yml 里 inject 的那两行。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 一、配置（想调数值就改这里，改完 hexo clean & hexo g）
   * ============================================================ */
  var CONFIG = {
    /* --- 身份 --- */
    name: '团子',                     // 宠物名字（面板标题）
    ownerHash: '01dd22060ff706266a99b5d79b0536931c11f3fed3deeab07fae89ab92551c14', // 暗号的 SHA-256
    ownerLink: { param: 'pet', token: 'pet-owner-9f3c' }, // 秘密链接 ?pet=pet-owner-9f3c（param 置空=不用）
    diaryPwKey: 'diary-pw',           // 日记密码存储键（只读，用来判断"这是你的电脑"）
    saveKey: 'pet-save-v1',
    saveVersion: 1,

    /* --- 形象素材 --- */
    useImages: true,                  // false = 永远用内置占位形象（零图片请求）
    assetBase: '/img/pet/',           // 你的图片放这里：idle.png / happy.png / …
    assetExt: '.png',                 // 也可 '.gif' / '.webp' / '.svg'
    walkFrames: 0,                    // walk 雪碧图帧数（0 = 没有走路帧）
    walkFrameMs: 120,

    /* --- 大小 / 位置 --- */
    scale: 1,
    minScale: 0.5,
    maxScale: 2,
    bottomOffset: 26,                 // 脚底离屏幕底部
    sidePadding: 24,                  // 左右留白
    walkSpeed: 34,                    // 基础速度 px/s（情绪会再乘系数）

    /* --- 时间节奏 --- */
    boredAfterMs: 8 * 60 * 1000,      // 多久没互动 → 无聊
    sadAfterDays: 3,                  // 多久没来 → 委屈
    angryClicks: 5,                   // 1.2 秒内点这么多下 → 生气
    angryClickWindowMs: 1200,
    angryMs: 45 * 1000,               // 生气持续
    talkMinMs: 3 * 60 * 1000,         // 主动搭话：最早间隔
    talkMaxMs: 9 * 60 * 1000,         // 主动搭话：最晚间隔
    talkDelayMs: 25 * 1000,           // 进页面后多久才开口
    idleTalkAfterMs: 4 * 60 * 1000,   // 你多久没动 → 问"你还在吗"
    longReadAfterMs: 5 * 60 * 1000,   // 文章页读太久 → 提醒休息

    /* --- 养成数值 --- */
    hungerPerHour: 4,                 // 饱食度/小时（离线也掉）
    moodPerHour: 2,                   // 心情/小时
    petMood: 2.5,                     // 摸一下心情 +
    petBond: 0.25,                    // 摸一下亲密度 +
    feedHunger: 30, feedMood: 6, feedBond: 1.5, feedCooldownMs: 30 * 60 * 1000,
    diaryBond: 3, diaryMood: 8,       // 当天解锁过日记的奖励
    dailyVisitBond: 1,                // 每天第一次来
    levelStep: 12,                    // 每 12 亲密度 1 级
    nightStart: 23, nightEnd: 7,      // 深夜（困倦）

    /* --- 聊天 --- */
    maxLog: 40,                       // 面板里最多留几条对话
    maxMemories: 24,                  // 最多记多少条偏好
    typewriterMs: 26,                 // 逐字速度
    welcomeDelayMs: 700               // 进来多久后它冒第一句
  };

  /* ============================================================
   * 二、小工具
   * ============================================================ */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  /* 把文本转义后再塞进 innerHTML（面板里的对话、台词都走它） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return (arr && arr.length) ? arr[Math.floor(Math.random() * arr.length)] : ''; }
  function chance(p) { return Math.random() < p; }
  function hoursBetween(a, b) { return Math.max(0, (b - a) / 3600000); }
  function daysBetween(a, b) { return Math.max(0, Math.floor((b - a) / 86400000)); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /* 台词占位符替换：{pet} {me} {days} {level} {visits} {thing} */
  function fmt(tpl, extra) {
    if (typeof tpl !== 'string') return '';
    var map = {
      pet: App.data.name || CONFIG.name,
      me: App.data.callMe || '你',
      days: App.data.days,
      level: App.data.level,
      visits: App.data.visits
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) map[k] = extra[k];
      }
    }
    return tpl.replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m;
    });
  }

  /* SHA-256（浏览器内置 Web Crypto；没有就返回空串 = 认不出来） */
  function sha256Hex(text) {
    var c = window.crypto || window.msCrypto;
    if (!c || !c.subtle || !window.TextEncoder) return Promise.resolve('');
    return c.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var bytes = new Uint8Array(buf), out = '';
      for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
      return out;
    });
  }

  /* ------------------------------------------------------------
   * 台词库兜底：万一 pet-lines.js 没加载 / 被你改坏，也不会报错，
   * 只是话变少（功能全在，不会白屏）
   * ------------------------------------------------------------ */
  var FALLBACK = {
    intents: [],
    moods: {},
    moodRefuse: {},
    proactive: { random: ['……', '（它歪了歪头）'] },
    unknown: ['……（它好像没听懂）'],
    system: {
      born: '一只小宠物掉进了你的博客，它叫 {pet}。',
      firstToday: ['你来啦。'],
      backFromAway: ['你回来啦。'],
      levelUp: ['升级啦。'],
      feed: ['（吃得很开心）'],
      feedFull: '它还不饿。',
      petOk: ['（眯起眼睛）'],
      petTooFast: '你点得太快啦。',
      sleepNow: '（它睡着了）',
      wakeUp: '（它醒了）',
      ownerOk: '完整模式已开启。',
      ownerFail: '认不出来。',
      visitorTip: '我在陪你聊天。',
      visitorHello: '欢迎欢迎喵',
      exportOk: '存档已复制。',
      importOk: '存档已读入。',
      importBad: '存档看不懂。',
      resetOk: '已重置。',
      noClipboard: '复制失败。',
      /* AI 相关（pet-lines.js 没加载时的兜底，正常看不见这几句） */
      aiThinking: '（想了想）…',
      aiFail: '脑子卡住了，再说一次？',
      aiNoKey: '还没接上脑子。',
      aiKeyOk: 'key 收好了。',
      aiKeyBad: '要这么写：/api 你的key',
      aiKeyClear: 'key 擦掉了。',
      aiOwnerOnly: '这个只有主人模式能用。',
      aiOn: '接上了。',
      aiOff: '先不用脑子了。',
      aiModel: '换了模型：{model}',
      aiTestOk: '通了：{reply}',
      aiTestFail: '没通：{err}',
      aiForget: '清空了。',
      aiNoModule: '这个版本没有 AI 模块。',
      aiStatus: '脑子：{aiOn}／模型：{model}／key：{key}／问了 {calls} 次',
      help: ['（帮助文本没加载）']
    },
    memory: { likeSaved: '记住了。', hateSaved: '记住了。', recall: [] },
    callMeOptions: ['你'],
    ai: { persona: '你是{pet}，一只住在{me}博客里的桌面宠物。中文、口语、一次不超过 40 字，不用 markdown。' }
  };

  /* 每次要用台词时都重新取一遍（这样 pet-lines.js 改了不用动这里） */
  function lines() {
    var L = window.PetLines || {};
    return {
      intents: (L.intents && L.intents.length) ? L.intents : FALLBACK.intents,
      moods: L.moods || FALLBACK.moods,
      moodRefuse: L.moodRefuse || FALLBACK.moodRefuse,
      proactive: L.proactive || FALLBACK.proactive,
      unknown: L.unknown || FALLBACK.unknown,
      system: L.system || FALLBACK.system,
      memory: L.memory || FALLBACK.memory,
      callMeOptions: L.callMeOptions || FALLBACK.callMeOptions,
      ai: L.ai || FALLBACK.ai
    };
  }
  /* 取系统话术：可能是字符串，也可能是数组（数组就随机一条） */
  function sys(key, extra) {
    var v = lines().system[key];
    if (v == null) return '';
    return fmt(Array.isArray(v) ? pick(v) : v, extra);
  }

  /* ============================================================
   * 三、全局状态（App）+ 存档（Save）
   *    访客模式：App.isOwner = false → Save.write() 直接跳过，
   *    所以"别人的电脑上一个字节都不会写"
   * ============================================================ */
  var App = {
    data: null,                 // 存档内容
    isOwner: false,             // 是否主人模式
    lastInteract: Date.now(),   // 最后一次互动（不存档，刷新后重算）
    lastUserInput: Date.now(),
    lastUserMsg: '',
    lastTalkAt: 0,
    state: 'normal',
    panelOpen: false,
    seq: 0,                     // 聊天计数
    recent: [],                 // 最近几轮你说的话（只在内存里）
    refs: {}
  };

  var Save = {
    defaults: function () {
      var now = Date.now();
      return {
        v: CONFIG.saveVersion,
        owner: false,
        name: CONFIG.name,
        callMe: '你',
        born: now,
        lastSeen: now,
        lastDay: '',
        visits: 0,
        mood: 70,
        hunger: 80,
        bond: 0,
        level: 1,
        days: 1,
        grudge: 0,
        angryUntil: 0,
        lastPet: 0,
        lastFeed: 0,
        hugs: 0,
        feeds: 0,
        diaryBoostDay: '',      // 当天已领过"解锁日记"的奖励
        scale: CONFIG.scale,
        x: null,
        y: null,
        muted: false,
        prefs: { likes: [], hates: [] },
        memories: []
      };
    },

    read: function () {
      try {
        var raw = window.localStorage.getItem(CONFIG.saveKey);
        if (!raw) return null;
        var d = JSON.parse(raw);
        return (d && typeof d === 'object') ? d : null;
      } catch (e) { return null; }
    },

    write: function () {
      if (!App.isOwner || !App.data) return;     // 访客：不写任何东西
      try { window.localStorage.setItem(CONFIG.saveKey, JSON.stringify(App.data)); } catch (e) {}
    },

    load: function () {
      var saved = App.isOwner ? Save.read() : null;
      var d = Save.defaults(), k;
      if (saved) {
        for (k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) &&
              Object.prototype.hasOwnProperty.call(saved, k)) d[k] = saved[k];
        }
        d.memories = Array.isArray(saved.memories) ? saved.memories : [];
      }
      /* 偏好（喜欢/不喜欢）单独规整一遍，防止存档被改坏 */
      var p = (saved && saved.prefs && typeof saved.prefs === 'object') ? saved.prefs : {};
      d.prefs = {
        likes: Array.isArray(p.likes) ? p.likes.slice(0, CONFIG.maxMemories) : [],
        hates: Array.isArray(p.hates) ? p.hates.slice(0, CONFIG.maxMemories) : []
      };
      App.data = d;
      return !!saved;
    },

    exportText: function () { return JSON.stringify(App.data); },

    importText: function (txt) {
      try {
        var d = JSON.parse(txt);
        if (!d || typeof d !== 'object') return false;
        var base = Save.defaults(), k;
        for (k in base) {
          if (Object.prototype.hasOwnProperty.call(base, k) &&
              Object.prototype.hasOwnProperty.call(d, k)) base[k] = d[k];
        }
        base.owner = true;
        if (!base.prefs || typeof base.prefs !== 'object') base.prefs = { likes: [], hates: [] };
        base.prefs.likes = Array.isArray(base.prefs.likes) ? base.prefs.likes : [];
        base.prefs.hates = Array.isArray(base.prefs.hates) ? base.prefs.hates : [];
        base.memories = Array.isArray(base.memories) ? base.memories : [];
        App.data = base;
        App.isOwner = true;
        Save.write();
        return true;
      } catch (e) { return false; }
    },

    reset: function () {
      var keepOwner = App.isOwner;
      App.data = Save.defaults();
      App.data.owner = keepOwner;
      Save.write();
    }
  };

  /* ============================================================
   * 四、认主人（三条任一命中）
   * ============================================================ */
  var Owner = {
    /* 这台浏览器"永久记住过日记密码" → 只会在你自己的电脑上成立 */
    byDiaryPw: function () {
      try {
        var raw = window.localStorage.getItem(CONFIG.diaryPwKey);
        if (!raw) return false;
        var d = JSON.parse(raw);
        return !!(d && d.pw && Number(d.exp) === 0);
      } catch (e) { return false; }
    },
    /* 带秘密参数的链接（明文较弱，可改可关） */
    byLink: function () {
      if (!CONFIG.ownerLink || !CONFIG.ownerLink.param) return false;
      try {
        var q = new URLSearchParams(window.location.search);
        return q.get(CONFIG.ownerLink.param) === CONFIG.ownerLink.token;
      } catch (e) { return false; }
    },
    detect: function () {
      var saved = Save.read();
      if (saved && saved.owner) return true;
      if (Owner.byDiaryPw()) return true;
      if (Owner.byLink()) return true;
      return false;
    },
    /* 用暗号解锁：只比对 SHA-256，源码里没有明文 */
    unlock: function (text) {
      return sha256Hex(String(text || '').trim()).then(function (h) {
        return !!h && h === CONFIG.ownerHash;
      });
    },
    mark: function () {
      App.isOwner = true;
      if (App.data) { App.data.owner = true; Save.write(); }
    }
  };

  /* ============================================================
   * 五、数值与情绪
   *    访客模式下所有记账都被跳过，但当场情绪（摸它会不会开心）照常
   * ============================================================ */
  var Stats = {
    refresh: function () {
      var d = App.data;
      d.level = Math.max(1, Math.floor(d.bond / CONFIG.levelStep) + 1);
      d.days = Math.max(1, 1 + daysBetween(d.born, Date.now()));
    },

    /* 离线期间的时间流逝（进页面时算一次） */
    offline: function () {
      if (!App.isOwner) return;
      var d = App.data, now = Date.now();
      var hours = hoursBetween(d.lastSeen || now, now);
      if (hours > 0.03) {
        d.hunger = clamp(d.hunger - hours * CONFIG.hungerPerHour, 0, 100);
        var drop = hours * CONFIG.moodPerHour;
        if (d.hunger < 25) drop *= 1.8;               // 饿着心情掉更快
        d.mood = clamp(d.mood - drop, 0, 100);
      }
      var away = daysBetween(d.lastSeen || now, now);
      if (away >= CONFIG.sadAfterDays) {
        d.grudge = clamp(d.grudge + (away - CONFIG.sadAfterDays + 1) * 18, 0, CONFIG.maxGrudge);
      }
      Stats.refresh();
    },

    /* 这次访问：每天第一次算一次账 */
    visit: function () {
      var d = App.data, t = todayStr(), first = false;
      if (d.lastDay !== t) {
        d.lastDay = t;
        d.visits += 1;
        first = true;
        if (App.isOwner) {
          d.bond += CONFIG.dailyVisitBond;
          d.mood = clamp(d.mood + 4, 0, 100);
          if (d.grudge > 0) d.grudge = clamp(d.grudge - 25, 0, 100);
        }
        Stats.refresh();
      }
      return first;
    },

    touch: function () { App.lastInteract = Date.now(); },

    pet: function () {
      var d = App.data, now = Date.now();
      var factor = (now - (d.lastPet || 0)) < 1000 ? 0.4 : 1;   // 一秒内连摸收益打折
      if (App.isOwner) {
        d.mood = clamp(d.mood + CONFIG.petMood * factor, 0, 100);
        d.bond += CONFIG.petBond * factor;
        if (d.grudge > 0) d.grudge = clamp(d.grudge - 4, 0, 100);
      }
      d.hugs += 1;
      d.lastPet = now;
      Save.write();                 // 立刻落盘：关页面也不丢
      Stats.refresh();
      Stats.touch();
    },

    /* 喂食：ok / cool（冷却中）/ full（刚吃过） */
    feed: function () {
      var d = App.data, now = Date.now();
      if (now - (d.lastFeed || 0) < CONFIG.feedCooldownMs) return 'cool';
      if (d.hunger >= 92) return 'full';
      d.hunger = clamp(d.hunger + CONFIG.feedHunger, 0, 100);
      d.mood = clamp(d.mood + CONFIG.feedMood, 0, 100);
      d.bond += CONFIG.feedBond;
      d.feeds += 1;
      d.lastFeed = now;
      Save.write();                 // 喂食很珍贵（30 分钟冷却），必须马上记住
      Stats.refresh();
      Stats.touch();
      return 'ok';
    },

    /* 当天解锁过日记 → 它特别开心（每天只算一次） */
    diaryBonus: function () {
      var d = App.data, t = todayStr();
      if (!App.isOwner || d.diaryBoostDay === t) return false;
      d.diaryBoostDay = t;
      d.mood = clamp(d.mood + CONFIG.diaryMood, 0, 100);
      d.bond += CONFIG.diaryBond;
      Save.write();
      Stats.refresh();
      return true;
    },

    anger: function () {
      var d = App.data;
      d.angryUntil = Date.now() + CONFIG.angryMs;
      d.mood = clamp(d.mood - 6, 0, 100);
      Save.write();
    },

    /* 当前情绪：生气 > 困倦（深夜）> 委屈 > 无聊 > 开心 > 正常 */
    state: function () {
      var d = App.data, now = Date.now();
      if (now < (d.angryUntil || 0)) return 'angry';
      var h = new Date(now).getHours();
      var night = CONFIG.nightStart > CONFIG.nightEnd
        ? (h >= CONFIG.nightStart || h < CONFIG.nightEnd)
        : (h >= CONFIG.nightStart && h < CONFIG.nightEnd);
      if (night) return 'sleepy';
      if ((App.isOwner && d.grudge >= 55) || d.mood < 22) return 'sad';
      if (now - App.lastInteract > CONFIG.boredAfterMs) return 'bored';
      if (d.mood >= 72) return 'happy';
      return 'normal';
    },

    /* 情绪对走路速度的影响 */
    speedFactor: function (st) {
      if (st === 'sleepy') return 0.45;
      if (st === 'sad') return 0.6;
      if (st === 'bored') return 0.7;
      if (st === 'happy') return 1.35;
      return 1;
    }
  };

  /* ============================================================
   * 六、形象（Avatar）
   *    · 有图片素材 → 用图片（缺哪个状态就退到 idle，再缺就用内置占位）
   *    · 没图片素材 → 用下面这个内置的简易小动物（纯 SVG，零请求）
   *    · walkFrames > 0 且放了 walk 雪碧图 → 走路时真的迈腿
   * ============================================================ */

  /* 内置占位形象：一只圆头小猫（想换掉就放图片，见 桌宠指南.md） */
  var PLACEHOLDER_SVG =
    '<svg class="pet-fallback" viewBox="0 0 96 96" aria-hidden="true" focusable="false">' +
      '<ellipse cx="48" cy="91" rx="21" ry="4.5" fill="rgba(0,0,0,0.13)"/>' +
      '<path d="M76 76 q15 -5 11 -21" fill="none" stroke="#f0a97e" stroke-width="5.5" stroke-linecap="round"/>' +
      '<ellipse cx="48" cy="71" rx="21" ry="18" fill="#fbd3b4"/>' +
      '<path d="M25 37 l-4 -21 l20 12 z" fill="#fbd3b4"/>' +
      '<path d="M71 37 l4 -21 l-20 12 z" fill="#fbd3b4"/>' +
      '<path d="M28 35 l-2.5 -13 l12 7.5 z" fill="#f7b7c9"/>' +
      '<path d="M68 35 l2.5 -13 l-12 7.5 z" fill="#f7b7c9"/>' +
      '<circle cx="48" cy="47" r="26" fill="#fde3cd"/>' +
      '<g class="pet-eye-open">' +
        '<ellipse cx="38" cy="46" rx="3.6" ry="4.8" fill="#3c3c46"/>' +
        '<ellipse cx="58" cy="46" rx="3.6" ry="4.8" fill="#3c3c46"/>' +
        '<circle cx="39.2" cy="44.4" r="1.2" fill="#fff"/>' +
        '<circle cx="59.2" cy="44.4" r="1.2" fill="#fff"/>' +
      '</g>' +
      '<g class="pet-eye-shut">' +
        '<path d="M33.5 47 q4.5 4.5 9 0" fill="none" stroke="#3c3c46" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M53.5 47 q4.5 4.5 9 0" fill="none" stroke="#3c3c46" stroke-width="2.4" stroke-linecap="round"/>' +
      '</g>' +
      '<path d="M44 55 q4 3.5 8 0" fill="none" stroke="#c98a66" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle cx="30" cy="53" r="4.2" fill="#f9a8c0" opacity="0.55"/>' +
      '<circle cx="66" cy="53" r="4.2" fill="#f9a8c0" opacity="0.55"/>' +
    '</svg>';

  var Avatar = {
    assetState: 'idle',
    imgOk: {},          // 每张图是否可用（探测一次后记住）

    build: function () {
      var root = el('div');
      root.id = 'pet-root';
      root.setAttribute('data-state', 'normal');

      var body = el('div', 'pet-body');
      var flip = el('div', 'pet-flip');
      var anim = el('div', 'pet-anim');
      anim.setAttribute('data-eyes', 'open');

      var img = el('img', 'pet-img');
      img.setAttribute('alt', '');
      img.setAttribute('draggable', 'false');
      img.hidden = true;

      var fb = el('div', 'pet-face');
      fb.innerHTML = PLACEHOLDER_SVG;
      fb.style.display = 'block';

      anim.appendChild(img);
      anim.appendChild(fb);
      flip.appendChild(anim);
      body.appendChild(flip);

      var bubble = el('div', 'pet-bubble');
      var fx = el('div', 'pet-fx');
      var toggle = el('button', 'pet-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', '打开桌宠面板');
      toggle.textContent = '🐾';

      body.appendChild(bubble);
      body.appendChild(fx);
      body.appendChild(toggle);
      root.appendChild(body);
      document.body.appendChild(root);

      Avatar.root = root;
      Avatar.body = body;
      Avatar.flip = flip;
      Avatar.anim = anim;
      Avatar.img = img;
      Avatar.fb = fb;
      Avatar.bubble = bubble;
      Avatar.fx = fx;
      Avatar.toggle = toggle;
      return root;
    },

    /* 试着用图片：state → idle → 内置占位（异步探测，失败自动降级） */
    tryImage: function (state, cb) {
      if (!CONFIG.useImages) return cb(null);
      var list = (state === 'idle') ? ['idle'] : [state, 'idle'];
      var self = Avatar;
      (function next(i) {
        if (i >= list.length) return cb(null);
        var name = list[i];
        if (self.imgOk[name] === true) return cb(name);
        if (self.imgOk[name] === false) return next(i + 1);
        var probe = new Image();
        probe.onload = function () { self.imgOk[name] = true; cb(name); };
        probe.onerror = function () { self.imgOk[name] = false; next(i + 1); };
        probe.src = CONFIG.assetBase + name + CONFIG.assetExt;
      })(0);
    },

    apply: function (state) {
      if (!Avatar.root) return;
      Avatar.root.setAttribute('data-state', state);
      Avatar.anim.setAttribute('data-eyes', (state === 'sleepy' || state === 'sad') ? 'shut' : 'open');
      Avatar.assetState = state;
      Avatar.tryImage(state, function (name) {
        if (Avatar.imgOk['idle'] === false && name === null) {
          /* 什么图都没有 → 内置占位 */
          Avatar.img.hidden = true;
          Avatar.fb.hidden = false;
        } else if (name) {
          Avatar.img.hidden = false;
          Avatar.fb.hidden = true;
          Avatar.img.onload = Avatar.measure;
          Avatar.img.src = CONFIG.assetBase + name + CONFIG.assetExt;
        } else {
          Avatar.img.hidden = true;
          Avatar.fb.hidden = false;
        }
        Avatar.measure();
      });
    },

    /* 量一下高度（乘上缩放），气泡才知道该浮在多高 */
    measure: function () {
      if (!Avatar.root) return;
      var s = parseFloat(Avatar.root.style.getPropertyValue('--pet-scale')) || 1;
      var h = (Avatar.flip.offsetHeight || 110) * s;
      Avatar.root.style.setProperty('--pet-top', h + 'px');
    },

    setScale: function (s) {
      if (!Avatar.root) return;
      Avatar.root.style.setProperty('--pet-scale', String(s));
      Avatar.measure();
    },

    setDir: function (dir) {
      if (!Avatar.root) return;
      if (dir < 0) Avatar.root.classList.add('pet-dir-left');
      else Avatar.root.classList.remove('pet-dir-left');
    },

    walkCls: function (on) {
      if (!Avatar.root) return;
      Avatar.root.classList.toggle('pet-walking', !!on);
    }
  };

  /* ============================================================
   * 七、走路雪碧图（可选；CONFIG.walkFrames > 0 才启用）
   * ============================================================ */
  var Sheet = {
    el: null,
    frame: 0,
    lastAt: 0,
    ready: false,
    on: false,

    init: function () {
      if (!CONFIG.walkFrames || CONFIG.walkFrames < 2 || !CONFIG.useImages || !Avatar.anim) return;
      var probe = new Image(), self = Sheet;
      probe.onload = function () {
        var fw = Math.floor(probe.naturalWidth / CONFIG.walkFrames);
        var fh = probe.naturalHeight;
        if (!fw || !fh) return;
        var node = el('div', 'pet-sheet');
        node.style.width = fw + 'px';
        node.style.height = fh + 'px';
        node.style.backgroundImage = 'url("' + CONFIG.assetBase + 'walk' + CONFIG.assetExt + '")';
        node.style.backgroundSize = (CONFIG.walkFrames * 100) + '% 100%';
        node.style.backgroundPosition = '0% 0%';
        node.hidden = true;
        Avatar.anim.insertBefore(node, Avatar.anim.firstChild);
        self.el = node;
        self.frameW = fw;
        self.ready = true;
      };
      probe.src = CONFIG.assetBase + 'walk' + CONFIG.assetExt;
    },

    /* 走路时显示雪碧图并翻帧；停下就换回静态图 */
    toggle: function (walking) {
      if (!Sheet.ready) return;
      var want = !!walking;
      if (want === Sheet.on) return;
      Sheet.on = want;
      Sheet.el.hidden = !want;
      if (Avatar.img) Avatar.img.style.visibility = want ? 'hidden' : '';
      if (want) {
        Sheet.frame = 0;
        Sheet.el.style.backgroundPosition = '0% 0%';
      }
      Avatar.measure();
    },

    tick: function (now) {
      if (!Sheet.ready || !Sheet.on) return;
      if (now - Sheet.lastAt < CONFIG.walkFrameMs) return;
      Sheet.lastAt = now;
      Sheet.frame = (Sheet.frame + 1) % CONFIG.walkFrames;
      var pct = (Sheet.frame / (CONFIG.walkFrames - 1)) * 100;
      Sheet.el.style.backgroundPosition = pct + '% 0%';
    }
  };

  /* ============================================================
   * 八、说话（气泡 + 逐字）与小心心
   * ============================================================ */
  var Speech = {
    timer: 0,
    typeTimer: 0,
    hideTimer: 0,
    bw: 0, bh: 0,            // 上一次量到的气泡宽高（走路时按它重新摆，不去读实时宽度）
    nx: null, ny: null,      // 上一次写进去的左右/上下微调量

    say: function (text, opts) {
      if (!Avatar.bubble || !text) return;
      opts = opts || {};
      var full = String(text);
      Speech.stopTyping();
      Avatar.root.classList.add('pet-bubble-on');

      /* 先把整句塞进去量一次宽高，好决定气泡要不要往屏幕里挪一点；
         量完立刻清空，交给下面的逐字打——同一帧内完成，看不到闪 */
      Avatar.bubble.textContent = full;
      Speech.place(true);
      Avatar.bubble.textContent = '';

      var len = 0;
      var speed = opts.instant ? 0 : CONFIG.typewriterMs;
      if (speed <= 0) {
        Avatar.bubble.textContent = full;
      } else {
        Speech.typeTimer = setInterval(function () {
          len += 1;
          Avatar.bubble.textContent = full.slice(0, len);
          if (len >= full.length) Speech.stopTyping();
        }, speed);
      }
      Speech.growIn();

      clearTimeout(Speech.hideTimer);
      var hold = opts.hold || (1800 + full.length * 70);
      Speech.hideTimer = setTimeout(function () {
        Avatar.root.classList.remove('pet-bubble-on');
      }, Math.min(hold, 12000));
    },

    stopTyping: function () {
      if (Speech.typeTimer) { clearInterval(Speech.typeTimer); Speech.typeTimer = 0; }
    },

    /* ------------------------------------------------------------
     * 摆气泡：默认骑在宠物的脚底点上、浮在它头顶上方 6px；
     * 贴到屏幕左右边 / 被拖得很靠上时，往里挪一点，保证整条气泡看得见。
     *   place(true)  → 先清掉微调、量一次真实宽高（只有刚开口时做）
     *   place(false) → 用上次的宽高重算（它走动 / 被拖动时做，不读布局）
     * ------------------------------------------------------------ */
    place: function (measure) {
      var bubble = Avatar.bubble;
      if (!bubble || !Avatar.root) return;
      var pad = 10;                                   // 离屏幕边至少留这么多
      if (measure) {
        Avatar.root.style.setProperty('--pet-nudge', '0px');
        Avatar.root.style.setProperty('--pet-nudge-y', '0px');
        Speech.nx = null; Speech.ny = null;
        Speech.bw = bubble.offsetWidth || 0;
        Speech.bh = bubble.offsetHeight || 0;
      }
      var bw = Speech.bw, bh = Speech.bh;
      if (!bw || !bh) return;                         // 量不到（比如 jsdom 不做布局）就保持默认位置
      var vw = Mover.vw(), vh = Mover.vh();
      var top = parseFloat(Avatar.root.style.getPropertyValue('--pet-top')) || 110;

      var nx = 0, ny = 0;
      var left = Mover.x - bw / 2;                    // 气泡中心对着脚底点
      if (left < pad) nx = pad - left;                // 左边被切 → 往右推
      else if (left + bw > vw - pad) nx = (vw - pad) - (left + bw);   // 右边被切 → 往左推

      var topY = Mover.y - top - 6 - bh;              // 气泡顶边（往上浮）
      if (topY < pad) ny = pad - topY;                // 顶上装不下（被拖到很靠上）→ 往下压

      nx = Math.round(nx); ny = Math.round(ny);
      if (nx === Speech.nx && ny === Speech.ny) return;   // 没变就不写，省得走路时每帧改样式
      Speech.nx = nx; Speech.ny = ny;
      Avatar.root.style.setProperty('--pet-nudge', nx + 'px');
      Avatar.root.style.setProperty('--pet-nudge-y', ny + 'px');
    },

    /* 它走动 / 被拖动时跟着挪（只在气泡正亮着时干活） */
    reflow: function () {
      if (!Avatar.root || !Avatar.root.classList.contains('pet-bubble-on')) return;
      Speech.place(false);
    },

    growIn: function () {
      if (!Avatar.anim) return;
      Avatar.anim.style.transform = 'scale(1.06)';
      setTimeout(function () { if (Avatar.anim) Avatar.anim.style.transform = ''; }, 160);
    },

    hearts: function (n) {
      if (!Avatar.fx) return;
      var total = n || 1;
      for (var i = 0; i < total; i++) {
        (function (i) {
          setTimeout(function () {
            var h = el('span', 'pet-heart', chance(0.5) ? '❤' : '✦');
            h.style.left = (randInt(-16, 16)) + 'px';
            h.style.top = (-randInt(10, 26)) + 'px';
            Avatar.fx.appendChild(h);
            setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 1200);
          }, i * 110);
        })(i);
      }
    }
  };

  /* ============================================================
   * 九、溜达（在页面底部走来走去）
   * ============================================================ */
  var Mover = {
    x: 0, y: 0, tx: 0, dir: 1,
    walking: false, paused: false, dragging: false,
    raf: 0, lastTs: 0, pauseTimer: 0, cursorX: 0,

    vw: function () { return document.documentElement.clientWidth || window.innerWidth || 360; },
    vh: function () { return document.documentElement.clientHeight || window.innerHeight || 640; },
    ground: function () { return Mover.vh() - CONFIG.bottomOffset; },

    init: function () {
      var d = App.data;
      Mover.y = Mover.ground();
      if (d && typeof d.x === 'number') Mover.x = clamp(d.x, 12, Mover.vw() - 12);
      else Mover.x = Math.round(Mover.vw() * 0.22);
      if (d && typeof d.y === 'number') Mover.y = clamp(d.y, 90, Mover.vh() - 6);
      Mover.tx = Mover.x;
      Mover.place();
      Mover.loop();
    },

    onResize: function () {
      Mover.x = clamp(Mover.x, 12, Mover.vw() - 12);
      Mover.tx = clamp(Mover.tx, 12, Mover.vw() - 12);
      if (!Mover.dragging && Mover.y > Mover.vh() - 6) Mover.y = Mover.ground();
      Mover.place();
      Avatar.measure();
    },

    place: function () {
      if (!Avatar.body) return;
      Avatar.body.style.transform = 'translate3d(' + Math.round(Mover.x) + 'px,' + Math.round(Mover.y) + 'px,0)';
      Speech.reflow();          // 气泡跟着它一起挪，并留在屏幕看得见的地方
    },

    setWalking: function (on) {
      if (on === Mover.walking) return;
      Mover.walking = on;
      Avatar.walkCls(on);
      Sheet.toggle(on);
    },

    setDir: function (dir) {
      if (dir === Mover.dir) return;
      Mover.dir = dir;
      Avatar.setDir(dir);
    },

    newTarget: function () {
      var pad = CONFIG.sidePadding;
      Mover.tx = randInt(pad, Math.max(pad + 2, Mover.vw() - pad));
      Mover.setDir(Mover.tx > Mover.x ? 1 : -1);
    },

    /* 走一段就歇一会儿；困的时候歇得久 */
    rest: function () {
      Mover.paused = true;
      Mover.setWalking(false);
      clearTimeout(Mover.pauseTimer);
      var st = App.state;
      var lo = (st === 'sleepy') ? 4000 : 900;
      var hi = (st === 'sleepy') ? 14000 : 4800;
      if (st === 'happy') { lo = 600; hi = 2600; }
      Mover.pauseTimer = setTimeout(function () {
        Mover.paused = false;
        Mover.newTarget();
      }, randInt(lo, hi));
    },

    loop: function () {
      if (Mover.raf) return;
      Mover.lastTs = 0;
      var step = function (ts) {
        Mover.raf = window.requestAnimationFrame(step);
        if (document.hidden) return;                        // 标签页看不见 → 不干活
        var dt = Mover.lastTs ? (ts - Mover.lastTs) / 1000 : 0;
        Mover.lastTs = ts;
        if (dt <= 0 || dt > 0.4) return;                    // 切回来时不瞬移
        Sheet.tick(ts);
        if (Mover.dragging || Mover.paused) return;

        var speed = CONFIG.walkSpeed * Stats.speedFactor(App.state);
        var gap = Mover.tx - Mover.x;
        if (Math.abs(gap) < 2) { Mover.rest(); return; }
        Mover.setWalking(true);
        Mover.setDir(gap > 0 ? 1 : -1);
        Mover.x = clamp(Mover.x + Mover.dir * speed * dt, 8, Mover.vw() - 8);
        Mover.place();
        if (Math.abs(Mover.tx - Mover.x) < 2) Mover.rest();
      };
      Mover.raf = window.requestAnimationFrame(step);
    }
  };

  /* ============================================================
   * 十、交互：点它摸它 / 拖它搬家 / 双击开面板 / 鼠标靠近看你
   * ============================================================ */
  var Interact = {
    drag: null,
    clicks: [],
    suppressClick: false,

    bind: function () {
      var flip = Avatar.flip;
      flip.addEventListener('pointerdown', Interact.onDown);
      window.addEventListener('pointermove', Interact.onMove, { passive: true });
      window.addEventListener('pointerup', Interact.onUp);
      window.addEventListener('pointercancel', Interact.onUp);
      flip.addEventListener('click', Interact.onClick);
      flip.addEventListener('dblclick', Interact.onDbl);
      document.addEventListener('mousemove', Interact.onHover, { passive: true });
      Avatar.toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        Panel.toggle();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) Panel.close();
      });
      window.addEventListener('resize', function () {
        clearTimeout(Interact._rz);
        Interact._rz = setTimeout(Mover.onResize, 150);
      });
    },

    onDown: function (e) {
      if (e.pointerType !== 'touch' && e.button != null && e.button !== 0) return;
      Interact.drag = { sx: e.clientX, sy: e.clientY, ox: Mover.x, oy: Mover.y, moved: false };
      try { Avatar.flip.setPointerCapture(e.pointerId); } catch (err) {}
    },

    onMove: function (e) {
      var d = Interact.drag;
      if (!d) return;
      if (!d.moved && (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 6)) {
        d.moved = true;
        Mover.dragging = true;
        Mover.setWalking(false);
        Avatar.body.classList.add('pet-dragging');
      }
      if (!d.moved) return;
      Mover.x = clamp(d.ox + (e.clientX - d.sx), 12, Mover.vw() - 12);
      Mover.y = clamp(d.oy + (e.clientY - d.sy), 90, Mover.vh() - 6);
      Avatar.measure();
      Mover.place();
    },

    onUp: function () {
      var d = Interact.drag;
      if (!d) return;
      Interact.drag = null;
      if (!d.moved) return;
      Mover.dragging = false;
      Avatar.body.classList.remove('pet-dragging');
      Interact.suppressClick = true;              // 拖完别顺手当成"摸它"
      Mover.tx = Mover.x;
      App.data.x = Math.round(Mover.x);
      App.data.y = Math.round(Mover.y);
      Save.write();
      Stats.touch();
      if (chance(0.6)) petSay('（换了个地方，视野不错）');
    },

    onClick: function () {
      if (Interact.suppressClick) { Interact.suppressClick = false; return; }
      var now = Date.now();
      Interact.clicks = Interact.clicks.filter(function (t) { return now - t < CONFIG.angryClickWindowMs; });
      Interact.clicks.push(now);
      Stats.touch();

      /* 1.2 秒内猛点 → 生气 */
      if (Interact.clicks.length >= CONFIG.angryClicks) {
        Interact.clicks = [];
        Stats.anger();
        App.state = Stats.state();
        Avatar.apply(App.state);
        petSay(sys('petTooFast'), { hold: 2600 });
        Panel.syncStats();
        return;
      }

      Stats.pet();
      Speech.hearts(randInt(1, 2));
      if (chance(0.75)) petSay(sys('petOk'), { hold: 1500 });
      Panel.syncStats();
      App.state = Stats.state();
      Avatar.apply(App.state);
    },

    onDbl: function () {
      Interact.clicks = [];
      Panel.toggle();
    },

    /* 鼠标离它比较近时，它会转过来看你 */
    onHover: function (e) {
      Mover.cursorX = e.clientX;
      if (Mover.dragging || Mover.walking || Interact.drag) return;
      if (Math.abs(e.clientX - Mover.x) < 170 && Math.abs(e.clientY - Mover.y) < 210) {
        Mover.setDir(e.clientX < Mover.x ? -1 : 1);
      }
    }
  };

  /* ============================================================
   * 十一、说话的总入口：气泡 + 面板各记一份
   * ============================================================ */
  function petSay(text, opts) {
    if (!text) return;
    Speech.say(text, opts);
    Panel.log('pet', text);
  }

  /* ============================================================
   * 十二、聊天
   *    · 关键词命中 → 台词库随机一条
   *    · 当前情绪会"染色"（开心/无聊/困倦/委屈/生气 各有说话方式）
   *    · 记住你说过的"喜欢/不喜欢/叫我什么"
   *    · 听不懂时：主人模式且配好了 key → 交给 AI 兜底（pet-ai.js，可整行注掉）；
   *      访客模式没有 AI，永远只用上面的台词库
   * ============================================================ */

  /* 只给 AI 的人设卡当"词典"用：把内部状态名说成人话 */
  var STATE_NAME = {
    normal: '平常', happy: '开心', bored: '有点无聊',
    sleepy: '困得睁不开眼', sad: '有点委屈', angry: '在生气'
  };
  var PAGE_NAME = {
    pageHome: '首页', pagePost: '文章页', pageDiary: '日记页', pageOther: '别的页面'
  };

  var Chat = {
    /* 你在面板里说了一句 */
    onUser: function (raw) {
      var text = String(raw || '').trim();
      if (!text) return;
      Panel.log('me', text);
      App.lastUserInput = Date.now();
      App.seq += 1;
      App.recent.push(text);
      if (App.recent.length > 5) App.recent.shift();

      Chat.respond(text).then(function (reply) {
        if (reply) petSay(reply, { hold: 2200 + reply.length * 45 });
      });
    },

    /* 生成回答（异步：暗号要算哈希；没听懂时还要等 AI 的网络请求） */
    respond: function (text) {
      var lower = text.toLowerCase();

      /* 1) 斜杠命令（只有面板里输入才有斜杠，不用怕误触） */
      if (lower.charAt(0) === '/') return Chat.command(text);

      /* 2) 你告诉它的事：我叫X / 我喜欢X / 我不喜欢X */
      var mem = Chat.memorize(text);
      if (mem) return Promise.resolve(mem);

      /* 3) 整句就是暗号？→ 解锁主人模式 */
      return Owner.unlock(text).then(function (ok) {
        if (ok) {
          Owner.mark();
          Save.write();
          Panel.syncMode();
          Panel.syncStats();
          Speech.hearts(3);
          return sys('ownerOk');
        }
        return Chat.reply(text, lower);
      });
    },

    /* ---------------- 斜杠命令 ---------------- */
    command: function (text) {
      var body = text.replace(/^\/+\s*/, '');
      var m;

      /* /主人 暗号      ——  也可以用 /主人 或 /解锁 */
      m = /^(?:主人|owner|解锁|unlock)\s+(.+)$/i.exec(body);
      if (m) {
        return Owner.unlock(m[1]).then(function (ok) {
          if (!ok) return sys('ownerFail');
          Owner.mark();
          Save.write();
          Panel.syncMode();
          Panel.syncStats();
          Speech.hearts(3);
          return sys('ownerOk');
        });
      }
      /* /帮助 */
      if (/^(?:帮助|help|\?|？)$/i.test(body)) return Promise.resolve(pick(lines().system.help));
      /* /喂 */
      if (/^(?:喂|喂食|投喂|吃饭|饭)$/.test(body)) return Promise.resolve(Chat.doFeed());
      /* /改名 X */
      m = /^(?:改名|叫我|称呼)\s*(.{1,10})$/.exec(body);
      if (m) {
        App.data.callMe = m[1];
        Save.write();
        return Promise.resolve(fmt(lines().memory.nameSet || '好，{me}，我记住啦。'));
      }
      /* /导出 /导入 /放生 */
      if (/^(?:导出|export)$/i.test(body)) return Promise.resolve(Chat.doExport());
      m = /^(?:导入|import)\s+([\s\S]+)$/i.exec(body);
      if (m) return Promise.resolve(Chat.doImport(m[1].trim()));
      if (/^(?:放生|重置|重来|reset)$/i.test(body)) return Promise.resolve(Chat.doReset());
      /* /状态 */
      if (/^(?:状态|status)$/i.test(body)) {
        var d = App.data;
        return Promise.resolve(
          (App.isOwner
            ? fmt('心情 ' + Math.round(d.mood) + '／饱食 ' + Math.round(d.hunger) +
                  '／亲密度 ' + Math.round(d.bond) + '／{level} 级／第 {days} 天')

            : sys('visitorTip'))
        );
      }
      /* /api 你的key —— 存 AI 的 key（只有主人模式能存，且只存在这台浏览器） */
      m = /^(?:api|key)(?:\s+([\s\S]*))?$/i.exec(body);
      if (m) {
        if (!App.isOwner) return Promise.resolve(sys('aiOwnerOnly'));
        if (!window.PetAI) return Promise.resolve(sys('aiNoModule'));
        var key = String(m[1] == null ? '' : m[1]).trim();
        if (!key) return Promise.resolve(sys('aiKeyBad'));
        if (key === '清空' || key === '-' || key.toLowerCase() === 'clear') {
          window.PetAI.save({ key: '' });
          return Promise.resolve(sys('aiKeyClear'));
        }
        window.PetAI.save({ key: key });
        /* 只回显头几位，面板里永远不会出现完整 key */
        return Promise.resolve(sys('aiKeyOk', { key: window.PetAI.info().key }));
      }
      /* /ai 状态|测试|on|off|忘了|<模型名> */
      m = /^(?:ai|脑子)\s*([\s\S]*)$/i.exec(body);
      if (m) return Promise.resolve(Chat.aiCmd(m[1].trim()));

      /* 不认识的命令 */
      return Promise.resolve(pick(lines().unknown));
    },

    /* ---------------- 普通聊天：本地台词优先，没听懂才可能交给 AI ---------------- */
    /* 关键词匹配：命中多组时取"最长的那个关键词"所在组（越具体越优先） */
    match: function (text, lower) {
      var best = null, bestLen = 0, intents = lines().intents, i, j;
      for (i = 0; i < intents.length; i++) {
        var item = intents[i];
        if (!item || !item.k || !item.a || !item.a.length) continue;
        for (j = 0; j < item.k.length; j++) {
          var k = String(item.k[j] || '');
          if (!k) continue;
          var hit = (k.charCodeAt(0) < 128)
            ? (lower.indexOf(k.toLowerCase()) !== -1)
            : (text.indexOf(k) !== -1);
          if (hit && k.length > bestLen) { bestLen = k.length; best = item; }
        }
      }
      return best;
    },

    /* 情绪染色：把任何一句"裸回答"（本地台词 / AI 的话）说成团子的口气 */
    wrap: function (base) {
      var st = App.state;
      var pool = lines().moods[st] || [];
      var prefix = (pool.length && chance(0.5)) ? pick(pool) : '';
      var out = fmt(prefix + base);
      if (st === 'sleepy' && chance(0.45)) out = out.replace(/[。！!～~]$/, '……');
      return out;
    },

    /* 只用本地台词回答；hit=true 才是"真听懂了"（false = 那句"没听懂"） */
    local: function (text, lower) {
      var refuse = lines().moodRefuse[App.state] || [];
      /* 困 / 生气 时有可能干脆敷衍一句（这也算"听懂了"，不必去问 AI） */
      if (refuse.length && chance(0.28)) return { hit: true, text: pick(refuse) };

      var best = Chat.match(text, lower);
      if (best) return { hit: true, text: Chat.wrap(pick(best.a)) };

      var rec = Chat.recall(text, lower);
      if (rec) return { hit: true, text: Chat.wrap(rec) };

      return { hit: false, text: Chat.wrap(pick(lines().unknown)) };
    },

    /* 旧名字，留着（同步拿一句本地回答，方便别处调用） */
    pickReply: function (text, lower) { return Chat.local(text, lower).text; },

    /* 回答的总调度：本地命中 → 秒回（快、免费、有性格）；
       没听懂 → 只有"主人模式 + 配好了 key"才去问 AI；
       问不到（没配 / 超时 / 报错）就退回那句"没听懂"，永远不至于冷场 */
    reply: function (text, lower) {
      var loc = Chat.local(text, lower);
      if (loc.hit) return Promise.resolve(loc.text);

      var AI = window.PetAI;
      if (!AI || !App.isOwner || !AI.ready()) return Promise.resolve(loc.text);

      var mySeq = App.seq;                                  /* 连发多条时，过期的回答直接丢 */
      Speech.say(sys('aiThinking'), { hold: 2600 });        /* 气泡先冒一句"让我想想…"（不进面板对话） */
      return AI.chat(text, Chat.aiSystem()).then(function (out) {
        if (!out || App.seq !== mySeq) return '';
        return Chat.wrap(out);
      }, function () {
        if (App.seq !== mySeq) return '';
        return sys('aiFail');
      });
    },

    /* 它记得你说过的东西吗 */
    recall: function (text, lower) {
      var prefs = (App.data && App.data.prefs) || {};
      var mem = lines().memory;
      var lists = [{ key: 'likes', arr: prefs.likes || [] }, { key: 'hates', arr: prefs.hates || [] }];
      for (var i = 0; i < lists.length; i++) {
        for (var j = 0; j < lists[i].arr.length; j++) {
          var thing = String(lists[i].arr[j] || '');
          if (!thing) continue;
          var hit = /^[\x00-\x7F]+$/.test(thing)
            ? (lower.indexOf(thing.toLowerCase()) !== -1)
            : (text.indexOf(thing) !== -1);
          if (!hit || !chance(0.55)) continue;
          if (lists[i].key === 'likes' && mem.recall && mem.recall.length) {
            return fmt(pick(mem.recall), { thing: thing });
          }
          return '你以前说过不喜欢' + thing + '呀。';
        }
      }
      return '';
    },

    /* 记住：我叫X / 我喜欢X / 我不喜欢X（访客不落盘，只在这次会话里） */
    memorize: function (text) {
      var clean = text.replace(/[\s。！!？?,，~～.]+$/g, '');
      var m, arr;

      m = /^(?:我叫|我是|请叫我)(.{1,10})$/.exec(clean);
      if (m) {
        App.data.callMe = m[1];
        Save.write();
        return fmt(lines().memory.nameSet || '好，{me}，我记住啦。');
      }

      /* 先看"不喜欢 / 讨厌"，否则会被"喜欢"抢走 */
      m = /^(?:我)?(?:最|很|超|有点)?(?:不|没)(?:太)?喜欢(.{1,14})$/.exec(clean) ||
          /^(?:我)?(?:最|很|超)?讨厌(.{1,14})$/.exec(clean);
      if (m && App.isOwner) {
        arr = App.data.prefs.hates;
        if (arr.indexOf(m[1]) === -1) {
          arr.unshift(m[1]);
          App.data.prefs.hates = arr.slice(0, CONFIG.maxMemories);
        }
        Save.write();
        return fmt(lines().memory.hateSaved || '记住了。', { thing: m[1] });
      }

      m = /^(?:我)?(?:最|很|超)?喜欢(?:吃|喝|玩|看|上)?(.{1,14})$/.exec(clean);
      if (m && App.isOwner) {
        arr = App.data.prefs.likes;
        if (arr.indexOf(m[1]) === -1) {
          arr.unshift(m[1]);
          App.data.prefs.likes = arr.slice(0, CONFIG.maxMemories);
        }
        Save.write();
        return fmt(lines().memory.likeSaved || '记住了。', { thing: m[1] });
      }
      return '';
    },

    /* ---------------- AI（可选；只有主人模式用得上，见 桌宠指南.md） ---------------- */
    /* 给 AI 的"人设卡"：把存档里的现状填进 pet-lines.js 的 ai.persona 模板 */
    aiSystem: function () {
      var d = App.data || {};
      var p = d.prefs || {};
      var likes = (p.likes || []).slice(0, 4), hates = (p.hates || []).slice(0, 4);
      var h = new Date().getHours();
      var night = CONFIG.nightStart > CONFIG.nightEnd
        ? (h >= CONFIG.nightStart || h < CONFIG.nightEnd)
        : (h >= CONFIG.nightStart && h < CONFIG.nightEnd);
      return fmt((lines().ai || {}).persona || '', {
        mood: Math.round(d.mood || 0),
        hunger: Math.round(d.hunger || 0),
        state: STATE_NAME[App.state] || App.state,
        when: night ? '深夜' : '白天',
        page: PAGE_NAME[Proactive.pageKind()] || '别的页面',
        likes: likes.length ? likes.join('、') : '还没告诉过我',
        hates: hates.length ? hates.join('、') : '还没告诉过我',
        hugs: d.hugs || 0,
        feeds: d.feeds || 0
      });
    },

    /* /ai xxx 的子命令（返回值可以是字符串，也可以是 Promise） */
    aiCmd: function (arg) {
      var AI = window.PetAI;
      if (!AI) return sys('aiNoModule');
      if (!App.isOwner) return sys('aiOwnerOnly');       /* 访客：连这个入口都不给 */

      var a = String(arg || '').trim();
      var low = a.toLowerCase();

      /* 不带参数 / 状态 → 报个平安（顺便说出最近一次失败原因，方便排错） */
      if (!a || a === '状态' || low === 'status') {
        var i = AI.info();
        var on = !i.enabled ? '关着' : (i.ready ? '已接上' : '缺 key');
        if (i.lastError) on += '（上次失败：' + i.lastError + '）';
        return sys('aiStatus', {
          aiOn: on,
          model: i.model || '（没设）',
          key: i.hasKey ? i.key : '还没填',
          calls: i.calls
        });
      }
      if (low === 'on' || a === '开' || a === '打开') {
        AI.save({ enabled: true });
        return sys(AI.ready() ? 'aiOn' : 'aiNoKey');
      }
      if (low === 'off' || a === '关' || a === '关掉') {
        AI.save({ enabled: false });
        return sys('aiOff');
      }
      if (a === '忘了' || a === '清空' || low === 'forget') {
        AI.clear();
        return sys('aiForget');
      }
      /* 真发一次请求试试通不通（排错第一选择） */
      if (a === '测试' || low === 'test') {
        if (!AI.ready()) return sys('aiNoKey');
        Speech.say(sys('aiThinking'), { hold: 3200 });
        return AI.chat('你好，一句话证明你通了。', Chat.aiSystem()).then(function (r) {
          return sys('aiTestOk', { reply: r });
        }, function (e) {
          return sys('aiTestFail', { err: (e && e.message) || '不知道为啥' });
        });
      }
      /* 其它都当成"换模型"，例如 /ai deepseek-reasoner */
      AI.save({ model: a });
      return sys('aiModel', { model: a });
    },

    /* ---------------- 面板按钮 / 命令共用的动作 ---------------- */
    doFeed: function () {
      if (!App.isOwner) return sys('visitorTip');
      var r = Stats.feed();
      Panel.syncStats();
      App.state = Stats.state();
      Avatar.apply(App.state);
      if (r !== 'ok') return sys('feedFull');
      Speech.hearts(3);
      return sys('feed');
    },

    doExport: function () {
      var text = Save.exportText();
      Panel.showExport(text);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      } catch (e) {}
      return sys('exportOk');
    },

    doImport: function (txt) {
      var ok = Save.importText(txt);
      if (ok && window.PetAI) window.PetAI.clear();      /* 换了一份记忆，AI 的上下文也别留着 */
      Panel.syncMode();
      Panel.syncStats();
      Avatar.setScale(App.data.scale || CONFIG.scale);
      Mover.onResize();
      App.state = Stats.state();
      Avatar.apply(App.state);
      return ok ? sys('importOk') : sys('importBad');
    },

    doReset: function () {
      if (!App.isOwner) return sys('visitorTip');
      Save.reset();
      if (window.PetAI) window.PetAI.clear();            /* 从零开始 = 连 AI 的上下文一起忘 */
      Panel.syncStats();
      App.state = Stats.state();
      Avatar.apply(App.state);
      return sys('resetOk');
    }
  };

  /* ============================================================
   * 十三、主动搭话 + 时间流逝
   *   挑话优先级：你很久没动 > 它的状态(饿/委屈/困/无聊/开心)
   *              > 时间段 > 当前页面类型 > 随机
   * ============================================================ */
  var Proactive = {
    timer: 0,
    tickTimer: 0,
    _lastDecay: 0,
    _lastLevel: 1,
    idleTalkedAt: 0,
    longReadAt: 0,

    start: function () {
      Proactive._lastDecay = Date.now();
      /* 第一次主动搭话：进页面 talkDelayMs 之后；之后按 talkMinMs ~ talkMaxMs 循环 */
      clearTimeout(Proactive.timer);
      Proactive.timer = setTimeout(function () {
        Proactive.speak();
        Proactive.schedule();
      }, CONFIG.talkDelayMs);
      Proactive.tickTimer = setInterval(Proactive.tick, 30000);
    },

    schedule: function () {
      clearTimeout(Proactive.timer);
      var wait = randInt(CONFIG.talkMinMs, CONFIG.talkMaxMs);
      Proactive.timer = setTimeout(function () {
        Proactive.speak();
        Proactive.schedule();
      }, wait);
    },

    pageKind: function () {
      /* 用 URL 判断最稳（本博客固定链接是 :year/:month/:day/:title/）：
         /diary/...            → 日记
         /2026/09/26/xxx/      → 文章页
         / 、/page/2/          → 首页
         其它（归档/分类/标签/关于）→ 其它 */
      var p = (window.location.pathname || '/').toLowerCase();
      if (p.indexOf('/diary') === 0) return 'pageDiary';
      if (/^\/\d{4}\/\d{2}\/\d{2}\//.test(p)) return 'pagePost';
      if (p === '/' || p === '/index.html' || /^\/page\/\d+\/?$/.test(p)) return 'pageHome';
      return 'pageOther';
    },


    timePool: function () {
      var L = lines().proactive, h = new Date().getHours();
      if (h >= 5 && h < 11) return L.morning;
      if (h >= 11 && h < 14) return L.noon;
      if (h >= 14 && h < 18) return L.afternoon;
      if (h >= 18 && h < 23) return L.evening;
      return L.night;
    },

    speak: function () {
      if (App.data.muted || document.hidden) return;
      if (App.panelOpen && Panel.isTyping()) return;      // 你在打字，它不插嘴

      var L = lines(), st = App.state, now = Date.now(), pool = null;

      if (now - App.lastUserInput > CONFIG.idleTalkAfterMs && now - App.lastInteract > CONFIG.idleTalkAfterMs) {
        pool = L.proactive.youIdle;
      } else if (App.isOwner && App.data.hunger < 30) {
        pool = L.proactive.hungry;
      } else if (st === 'sad') {
        pool = L.proactive.sad;
      } else if (st === 'sleepy') {
        pool = L.proactive.sleepy;
      } else if (st === 'bored') {
        pool = L.proactive.bored;
      } else if (st === 'happy') {
        pool = L.proactive.happy;
      }

      if (!pool || !pool.length) pool = Proactive.timePool();
      if ((!pool || !pool.length || chance(0.4)) && chance(0.5)) {
        var kind = Proactive.pageKind();
        if (L.proactive[kind] && L.proactive[kind].length) pool = L.proactive[kind];
      }
      if (!pool || !pool.length) pool = L.proactive.random;
      if (!pool || !pool.length) return;

      petSay(pick(pool));
      App.lastTalkAt = Date.now();
    },

    /* 每 30 秒：情绪会变、在线也在慢慢饿、顺便存个档 */
    tick: function () {
      if (document.hidden) return;
      var now = Date.now();

      if (App.isOwner) {
        var d = App.data;
        var mins = (now - (Proactive._lastDecay || now)) / 60000;
        if (mins > 0.4) {
          d.hunger = clamp(d.hunger - CONFIG.hungerPerHour * mins / 60, 0, 100);
          d.mood = clamp(d.mood - CONFIG.moodPerHour * mins / 60, 0, 100);
          Stats.refresh();
        }
      }
      Proactive._lastDecay = now;

      var st = Stats.state();
      if (st !== App.state) {
        App.state = st;
        Avatar.apply(st);
      }
      Panel.syncStats();
      Save.write();

      /* 读太久了提醒休息（一篇文章只提醒一次） */
      if (!Proactive.longReadAt && Proactive.pageKind() === 'pagePost' &&
          now - App.lastInteract > CONFIG.longReadAfterMs && chance(0.5)) {
        Proactive.longReadAt = now;
        petSay(pick(lines().proactive.longRead || []));
      }
    }
  };

  /* 升级了就报喜（放在 syncStats 里调用，任何加分动作后都会触发） */
  function checkLevelUp() {
    var d = App.data;
    if (!d) return;
    if (d.level > Proactive._lastLevel) {
      Proactive._lastLevel = d.level;
      petSay(sys('levelUp'));
      Speech.hearts(3);
    }
    Proactive._lastLevel = d.level;
  }

  /* ============================================================
   * 十四、小面板（状态条 / 聊天 / 大小 / 存档）
   * ============================================================ */
  var Panel = {
    el: null, nameEl: null, modeEl: null, stateEl: null, statsEl: null,
    logEl: null, input: null, scaleEl: null, scaleVal: null, muteEl: null, tipEl: null,
    feedBtn: null, exportBtn: null, importBtn: null, resetBtn: null,

    build: function () {
      var p = el('div');
      p.id = 'pet-panel';
      p.hidden = true;
      p.innerHTML =
        '<div class="pet-p-head">' +
          '<span class="pet-p-name"></span>' +
          '<span class="pet-p-mode pet-mode-visitor">访客模式</span>' +
          '<span class="pet-p-state"></span>' +
          '<button class="pet-p-close" type="button" aria-label="关闭面板">✕</button>' +
        '</div>' +
        '<div class="pet-p-stats"></div>' +
        '<div class="pet-p-tools">' +
          '<span>大小</span>' +
          '<input class="pet-scale" type="range" min="50" max="200" step="5" value="100" aria-label="桌宠大小">' +
          '<span class="pet-scale-val">100%</span>' +
          '<label><input class="pet-mute" type="checkbox"> 静音</label>' +
        '</div>' +
        '<div class="pet-p-log"></div>' +
        '<div class="pet-p-input">' +
          '<input class="pet-chat" type="text" maxlength="120" placeholder="跟我说点什么…">' +
          '<button class="pet-btn pet-btn-main pet-send" type="button">发送</button>' +
        '</div>' +
        '<div class="pet-p-foot">' +
          '<button class="pet-btn pet-feed" type="button">🍚 喂食</button>' +
          '<button class="pet-btn pet-export" type="button">导出</button>' +
          '<button class="pet-btn pet-import" type="button">导入</button>' +
          '<button class="pet-btn pet-danger pet-reset" type="button">放生</button>' +
        '</div>' +
        '<div class="pet-p-tip"></div>';
      document.body.appendChild(p);

      Panel.el = p;
      Panel.nameEl = p.querySelector('.pet-p-name');
      Panel.modeEl = p.querySelector('.pet-p-mode');
      Panel.stateEl = p.querySelector('.pet-p-state');
      Panel.statsEl = p.querySelector('.pet-p-stats');
      Panel.logEl = p.querySelector('.pet-p-log');
      Panel.input = p.querySelector('.pet-chat');
      Panel.scaleEl = p.querySelector('.pet-scale');
      Panel.scaleVal = p.querySelector('.pet-scale-val');
      Panel.muteEl = p.querySelector('.pet-mute');
      Panel.tipEl = p.querySelector('.pet-p-tip');
      Panel.feedBtn = p.querySelector('.pet-feed');
      Panel.exportBtn = p.querySelector('.pet-export');
      Panel.importBtn = p.querySelector('.pet-import');
      Panel.resetBtn = p.querySelector('.pet-reset');
      if (Panel.tipEl) Panel.tipEl.style.whiteSpace = 'pre-line';

      App.logs = [];
      Panel.bindEvents();
    },

    /* ---------------- 打开 / 关闭 / 摆位置 ---------------- */
    toggle: function () { if (Panel.el.hidden) Panel.open(); else Panel.close(); },

    open: function () {
      Panel.el.hidden = false;
      App.panelOpen = true;
      Panel.syncMode();
      Panel.syncStats();
      Panel.renderLog();
      Panel.place();
      Panel.scaleEl.value = Math.round((App.data.scale || CONFIG.scale) * 100);
      Panel.scaleVal.textContent = Panel.scaleEl.value + '%';
      Panel.muteEl.checked = !!App.data.muted;
    },

    close: function () {
      Panel.el.hidden = true;
      App.panelOpen = false;
      if (Panel.input) Panel.input.blur();
    },

    /* 面板贴着它出现（手机上由 CSS 变成底部抽屉） */
    place: function () {
      var box = Panel.el;
      box.style.left = ''; box.style.top = ''; box.style.right = ''; box.style.bottom = '';
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;
      var w = box.offsetWidth || 330, h = box.offsetHeight || 420;
      var vw = Mover.vw(), vh = Mover.vh();
      var left = clamp(Mover.x - w / 2, 12, Math.max(12, vw - w - 12));
      var top = Mover.y - h - 36;
      if (top < 12) top = clamp(Mover.y + 34, 12, Math.max(12, vh - h - 12));
      box.style.left = Math.round(left) + 'px';
      box.style.top = Math.round(top) + 'px';
      box.style.bottom = 'auto';
    },

    /* ---------------- 渲染 ---------------- */
    bar: function (label, v) {
      var val = Math.round(clamp(v, 0, 100));
      return '<div class="pet-stat"><b>' + label + '</b>' +
        '<span class="pet-bar"><i style="width:' + val + '%"></i></span>' +
        '<span class="pet-stat-num">' + val + '</span></div>';
    },

    stateName: function (st) {
      var map = { happy: '开心', bored: '无聊', sleepy: '困倦', sad: '委屈', angry: '生气', normal: '照常' };
      return map[st] || '照常';
    },

    /* 面板里所有数字都从这儿刷新（顺便检查有没有升级） */
    syncStats: function () {
      checkLevelUp();
      if (!Panel.statsEl) return;
      var d = App.data;
      if (!App.isOwner) {
        Panel.statsEl.innerHTML =
          '<div class="pet-stat" style="grid-column:1/3">' + esc(sys('visitorHello')) + '</div>';
      } else {
        var lv = CONFIG.levelStep;
        Panel.statsEl.innerHTML =
          Panel.bar('心情', d.mood) +
          Panel.bar('饱食', d.hunger) +
          Panel.bar('亲密', ((d.bond % lv) / lv) * 100) +
          '<div class="pet-stat" style="grid-column:1/3">Lv.' + d.level + ' · 第 ' + d.days +
          ' 天 · 摸过 ' + d.hugs + ' 次 · 投喂 ' + d.feeds + ' 次</div>';
      }
      if (Panel.stateEl) Panel.stateEl.textContent = Panel.stateName(App.state);
    },

    syncMode: function () {
      if (!Panel.modeEl) return;
      Panel.modeEl.textContent = App.isOwner ? '完整模式' : '访客模式';
      Panel.modeEl.className = 'pet-p-mode' + (App.isOwner ? '' : ' pet-mode-visitor');
      if (Panel.nameEl) Panel.nameEl.textContent = App.data.name || CONFIG.name;

      var ownerOnly = [Panel.feedBtn, Panel.exportBtn, Panel.importBtn, Panel.resetBtn];
      for (var i = 0; i < ownerOnly.length; i++) {
        if (ownerOnly[i]) ownerOnly[i].style.display = App.isOwner ? '' : 'none';
      }
      if (Panel.tipEl && !Panel.tipEl.querySelector('textarea')) {
        /* 底部那块平时一律留空：主人不需要（暗号怎么开，主人本来就知道），
           访客也不需要（面板里写着"访客模式"，想开的人自己会去问）；
           空着就 display:none，不留空洞。它是"提示 + 导出文本框"共用容器，
           导出时会由 showExport() 重新露出来 */
        Panel.tipEl.textContent = '';
        Panel.tipEl.style.display = 'none';
      }
    },

    log: function (who, text) {
      if (!text) return;
      App.logs = App.logs || [];
      App.logs.push({ w: who, t: String(text) });
      if (App.logs.length > CONFIG.maxLog) App.logs.shift();
      if (!Panel.logEl || Panel.el.hidden) return;      // 面板没开就先不渲染
      Panel.renderLog();
    },

    renderLog: function () {
      if (!Panel.logEl) return;
      var logs = App.logs || [], html = '';
      for (var i = 0; i < logs.length; i++) {
        var w = logs[i].w;
        var cls = (w === 'me') ? 'from-me' : (w === 'sys' ? 'sys' : 'from-pet');
        html += '<div class="pet-msg pet-' + cls + '"><span>' + esc(logs[i].t) + '</span></div>';
      }
      Panel.logEl.innerHTML = html;
      Panel.logEl.scrollTop = Panel.logEl.scrollHeight;
    },

    isTyping: function () {
      return !!Panel.input && (document.activeElement === Panel.input || Panel.input.value.trim().length > 0);
    },

    /* 导出：把存档摊在面板底下，方便手动复制 */
    showExport: function (text) {
      if (!Panel.tipEl) return;
      Panel.tipEl.style.display = '';            /* 平时是藏起来的（提示那句去掉了），导出时要露出来 */
      Panel.tipEl.textContent = '存档（复制下面这段，找地方保管）：';
      var ta = el('textarea');
      ta.value = text;
      ta.style.width = '100%';
      ta.style.height = '72px';
      ta.style.marginTop = '4px';
      ta.style.fontSize = '11px';
      ta.style.boxSizing = 'border-box';
      Panel.tipEl.appendChild(ta);
      try { ta.focus(); ta.select(); } catch (e) {}
    },

    /* ---------------- 事件 ---------------- */
    bindEvents: function () {
      var p = Panel.el;

      p.querySelector('.pet-p-close').addEventListener('click', function () { Panel.close(); });

      /* 聊天：回车 / 点发送（中文输入法组词时的回车不算发送） */
      var send = function () {
        var v = Panel.input.value.trim();
        if (!v) return;
        Panel.input.value = '';
        Chat.onUser(v);
      };
      p.querySelector('.pet-send').addEventListener('click', send);
      Panel.input.addEventListener('keydown', function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); send(); }
      });

      /* 喂食 */
      Panel.feedBtn.addEventListener('click', function () { petSay(Chat.doFeed()); });

      /* 大小滑块（拖动即时生效，松手才存档） */
      Panel.scaleEl.addEventListener('input', function () {
        var s = clamp((parseInt(Panel.scaleEl.value, 10) || 100) / 100, CONFIG.minScale, CONFIG.maxScale);
        App.data.scale = s;
        Avatar.setScale(s);
        Panel.scaleVal.textContent = Math.round(s * 100) + '%';
      });
      Panel.scaleEl.addEventListener('change', function () { Save.write(); });

      /* 静音 = 不主动搭话（你去跟它说话它还是会回） */
      Panel.muteEl.addEventListener('change', function () {
        App.data.muted = !!Panel.muteEl.checked;
        Save.write();
      });

      /* 导出 / 导入 / 放生 */
      Panel.exportBtn.addEventListener('click', function () { petSay(Chat.doExport()); });

      Panel.importBtn.addEventListener('click', function () {
        var txt = window.prompt('把之前导出的存档文本粘进来：');
        if (!txt) return;
        petSay(Chat.doImport(txt));
      });

      Panel.resetBtn.addEventListener('click', function () {
        if (!window.confirm('确定要放生吗？它会忘记你、从零开始（存档会被清空）。')) return;
        petSay(Chat.doReset());
        Avatar.setScale(App.data.scale || CONFIG.scale);
        Panel.scaleEl.value = Math.round((App.data.scale || CONFIG.scale) * 100);
        Panel.scaleVal.textContent = Panel.scaleEl.value + '%';
        Save.write();
      });
    }
  };

  /* ============================================================
   * 十五、启动
   * ============================================================ */
  function boot() {
    if (window.__petBooted) return;         // 防止被注入两次时重复初始化
    window.__petBooted = true;
    if (!document.body || !window.localStorage) return;

    var now = Date.now();

    /* 1) 认主人（存过档 / 记着日记密码 / 秘密链接） */
    App.isOwner = Owner.detect();

    /* 2) 读存档：访客拿到的是内存里的默认值，而且永不落盘 */
    var hadSave = Save.load();
    if (App.isOwner && !hadSave) App.data.owner = true;
    Proactive._lastLevel = App.data.level;

    /* 3) 这次访问的账：离线衰减 → 每天第一次 → 更新"最后出现时间" */
    var awayDays = daysBetween(App.data.lastSeen || now, now);
    var awayHours = hoursBetween(App.data.lastSeen || now, now);
    Stats.offline();
    var firstToday = Stats.visit();
    App.data.lastSeen = now;
    App.state = Stats.state();
    Save.write();

    /* 4) 搭界面 */
    Avatar.build();
    Panel.build();
    Avatar.setScale(App.data.scale || CONFIG.scale);
    Avatar.apply(App.state);
    Avatar.setDir(1);
    Sheet.init();
    Mover.init();
    Interact.bind();
    Panel.syncMode();
    Panel.syncStats();

    /* 5) 进页面后打个招呼 */
    setTimeout(function () {
      bootGreet(!hadSave && App.isOwner, firstToday, awayDays);
    }, CONFIG.welcomeDelayMs);

    /* 6) 跑起来：主动搭话 + 每 30 秒的时间流逝 */
    Proactive.start();

    /* 7) 页面要走 / 切到后台 → 先存档 */
    window.addEventListener('pagehide', function () {
      App.data.lastSeen = Date.now();
      Save.write();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        App.data.lastSeen = Date.now();
        Save.write();
      } else {
        App.lastInteract = Date.now();
      }
    });

    /* 8) 控制台留一句，方便你确认它活着（不想要就删掉这行） */
    try {
      console.info('[桌宠] ' + (App.data.name || CONFIG.name) + ' 已入住 ｜ 模式：' +
        (App.isOwner ? '完整（本机）' : '访客') + ' ｜ 情绪：' + App.state);
    } catch (e) {}
  }

  /* 进页面的第一句话：刚出生 / 很久没来 / 每天第一次 / 顺便说点什么 */
  function bootGreet(isNew, firstToday, awayDays) {
    var L = lines();

    /* 第一次出生 */
    if (isNew) {
      petSay(sys('born'), { hold: 5200 });
      return;
    }
    /* 好几天没来看它 → 委屈地念一句 */
    if (App.isOwner && awayDays >= CONFIG.sadAfterDays) {
      petSay(pick(L.system.backFromAway), { hold: 4600 });
      return;
    }
    /* 这台设备记着日记密码 → 每天第一次"陪你去写日记"的奖励 */
    if (App.isOwner && Owner.byDiaryPw() && Stats.diaryBonus()) {
      Save.write();
      Panel.syncStats();
      Speech.hearts(2);
      petSay(pick(L.system.diaryHappy || L.proactive.happy), { hold: 4200 });
      return;
    }
    /* 每天第一次来 */
    if (firstToday) {
      petSay(pick(L.system.firstToday), { hold: 3000 });
      return;
    }
    /* 其它：一半概率按当前页面说一句 */
    if (chance(0.5)) {
      var kind = Proactive.pageKind();
      var pool = (L.proactive[kind] && L.proactive[kind].length) ? L.proactive[kind] : L.proactive.random;
      petSay(pick(pool));
    }
  }

  /* ---------------- 真正启动（注入到底部时 body 已存在） ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();














