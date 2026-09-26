/* ============================================================
 * pet-ai.js —— 桌宠「团子」的脑子（可选模块）
 * ------------------------------------------------------------
 * 给它接一个 OpenAI 兼容的接口（DeepSeek / 硅基流动 / 月之暗面 / 本地 Ollama…）。
 *
 * · 只有「主人模式」用得上：pet.js 里先走本地台词，没听懂才来问它；
 *   访客模式 ready() 恒为 false → 一个请求都不发，还是原来那只宠物。
 * · key 只存在你这台浏览器的 localStorage['pet-ai-v1']，不进宠物存档
 *   （所以「导出存档」发给别人时，不会把 key 一起送出去）。
 * · 聊天框命令：/api sk-xxx（填 key）、/ai 状态、/ai 测试、/ai on|off、/ai 模型名
 * · 不想要了：注掉 _config.butterfly.yml 里 pet-ai.js 那一行，pet.js 自动退回本地台词。
 * · 详细说明（怎么申请 key、怎么换模型、花多少钱）：桌宠指南.md
 * ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'pet-ai-v1';

  /* 预设：全是 OpenAI 兼容格式（/chat/completions），所以换一家只改这两个字段。
     needKey = false 表示本地服务（Ollama）不校验 key，空着也能用 */
  var PRESET = {
    deepseek:    { url: 'https://api.deepseek.com/v1',   model: 'deepseek-chat',            needKey: true },
    siliconflow: { url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', needKey: true },
    moonshot:    { url: 'https://api.moonshot.cn/v1',    model: 'moonshot-v1-8k',           needKey: true },
    ollama:      { url: 'http://localhost:11434/v1',     model: 'qwen2.5:7b',               needKey: false }
  };

  var CFG = {
    enabled: true,          // /ai off 可以临时关掉（关了只剩本地台词）
    provider: 'deepseek',
    endpoint: '',           // 留空 = 用上面的预设；自建代理也填这里
    model: '',              // 留空 = 用上面的预设
    key: '',
    maxTokens: 120,         // 每次最多让它吐多少 token（省钱的阀门）
    maxChars: 120,          // 气泡里最多显示多少字（多了截断成"…"）
    temperature: 1.15,      // 高一点更像宠物，不像客服
    timeoutMs: 12000,       // 超过就放弃，回落成本地台词
    history: 6              // 记住最近几轮（0 = 不带上下文，最省）
  };

  var hist = [];            // [{role, content}] 只在内存里，刷新即忘
  var calls = 0;            // 这次会话问了几次（/ai 状态 里能看到）
  var lastError = '';       // 最近一次失败原因（同上）

  function str(v) { return String(v == null ? '' : v); }
  function trimTo(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  /* 回显 key 时只露头，绝不在面板里出现完整 key */
  function mask(k) { k = str(k); return k ? (k.length > 10 ? k.slice(0, 6) + '****' : '****') : ''; }

  /* ---------------- 读 / 写设置（坏数据一律忽略，绝不因此报错） ---------------- */
  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return CFG;
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        for (var k in CFG) {
          if (Object.prototype.hasOwnProperty.call(d, k) &&
              Object.prototype.hasOwnProperty.call(CFG, k) &&
              typeof d[k] === typeof CFG[k]) CFG[k] = d[k];
        }
      }
    } catch (e) {}
    return CFG;
  }

  function save(patch) {
    if (patch && typeof patch === 'object') {
      for (var k in CFG) {
        if (Object.prototype.hasOwnProperty.call(patch, k) &&
            Object.prototype.hasOwnProperty.call(CFG, k) &&
            typeof patch[k] === typeof CFG[k]) CFG[k] = patch[k];
      }
    }
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(CFG)); } catch (e) {}
    return CFG;
  }

  /* ---------------- 现在的接口长什么样 ----------------
     注意：这个函数千万别叫 resolve / reject，会和下面 new Promise 的参数撞名 */
  function endpoint() {
    var pre = PRESET[CFG.provider] || PRESET.deepseek;
    return {
      url: str(CFG.endpoint || pre.url).replace(/\/+$/, ''),
      model: str(CFG.model || pre.model),
      needKey: pre.needKey !== false
    };
  }

  /* 配置齐了没（pet.js 还会自己再判一次"是不是主人模式"） */
  function ready() {
    if (!CFG.enabled) return false;
    if (typeof window.fetch !== 'function') return false;
    var c = endpoint();
    if (!c.url || !c.model) return false;
    return c.needKey ? !!str(CFG.key) : true;
  }

  /* 把 AI 的话收拾成人话：去掉 markdown 痕迹、压成一行、按 maxChars 截断 */
  function tidy(s) {
    var t = str(s).replace(/\s+/g, ' ').trim();
    t = t.replace(/\*\*/g, '').replace(/^[*_>\-\s]+/, '')
         .replace(/^["“”'『「]+/, '').replace(/["“”'』」]+$/, '').trim();
    return trimTo(t, CFG.maxChars);
  }

  /* 报错也翻译成人话（/ai 状态 里能看到） */
  function explain(status) {
    if (status === 401 || status === 403) return 'key 好像不对（' + status + '）';
    if (status === 402) return '余额不够了（402）';
    if (status === 404) return '接口地址不对（404）';
    if (status === 429) return '问得太快或额度用完了（429）';
    if (status >= 500) return '对面服务器打瞌睡了（' + status + '）';
    return 'HTTP ' + (status || '?');
  }

  /* ---------------- 真正的请求：chat(你这句话, 人设卡) → Promise<字符串> ---------------- */
  function chat(text, system) {
    return new Promise(function (resolve, reject) {
      if (!ready()) return reject(new Error('还没接好（缺 key 或接口地址）'));
      var c = endpoint();

      var msgs = [];
      if (system) msgs.push({ role: 'system', content: str(system) });
      for (var i = 0; i < hist.length; i++) msgs.push(hist[i]);
      msgs.push({ role: 'user', content: str(text) });

      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, CFG.timeoutMs);

      var fail = function (e) {
        clearTimeout(timer);
        var msg = (e && e.message) ? e.message : str(e);
        if (e && e.name === 'AbortError') msg = '等太久没答复（' + Math.round(CFG.timeoutMs / 1000) + ' 秒）';
        lastError = msg;
        reject(new Error(msg));
      };

      var headers = { 'Content-Type': 'application/json' };
      if (str(CFG.key)) headers.Authorization = 'Bearer ' + str(CFG.key);

      window.fetch(c.url + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: c.model,
          messages: msgs,
          max_tokens: CFG.maxTokens,
          temperature: CFG.temperature,
          stream: false
        }),
        signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        if (!res || !res.ok) throw new Error(explain(res ? res.status : 0));
        return res.json();
      }).then(function (data) {
        var out = '';
        try { out = data.choices[0].message.content; } catch (e) {}
        if (!out) throw new Error('对面返回里没有文字');
        clearTimeout(timer);
        /* 成功才记住这轮；失败不污染上下文 */
        hist.push({ role: 'user', content: str(text) });
        hist.push({ role: 'assistant', content: str(out) });
        while (hist.length > Math.max(0, CFG.history) * 2) hist.shift();
        calls += 1;
        lastError = '';
        resolve(tidy(out));
      }).catch(fail);
    });
  }

  /* 换了存档 / 放生 → 上下文也忘掉，别把上一份记忆带过来 */
  function clear() { hist = []; return true; }

  /* 给 /ai 状态 用 */
  function info() {
    var c = endpoint();
    return {
      enabled: !!CFG.enabled,
      ready: ready(),
      provider: CFG.provider,
      model: c.model,
      url: c.url,
      hasKey: !!str(CFG.key),
      key: mask(CFG.key),
      calls: calls,
      turns: Math.floor(hist.length / 2),
      lastError: lastError,
      maxChars: CFG.maxChars
    };
  }

  window.PetAI = {
    load: load,
    save: save,
    ready: ready,
    chat: chat,
    clear: clear,
    info: info,
    providers: PRESET,
    config: CFG
  };

  load();      // 进页面就读一次设置；读不到就用默认值（pet.js 只会在主人模式下问它）
})();
