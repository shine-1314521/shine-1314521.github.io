/* 瑶妹看板娘 v2 —— 素材来自本地桌宠项目 pet_app（transparent/*.png → WebP）
 *
 * 这一版把桌宠的交互搬上来了：
 *   单击        摸头（心情 +20、好感 +8）
 *   双击        换装（7 套循环）
 *   右键 / 长按 菜单：喂食、摸摸、换装、说说话、状态、藏起来
 *   拖动        可以拖着换位置，位置记在 localStorage
 *   对话        关键词直接触发动作（喂食/睡觉/唱歌/跳舞/抱抱…）；其余走 AI 或本地闲聊
 *   状态        饱食 / 心情 / 好感三项，每分钟衰减，和桌宠同速率
 *   空闲        8–25 秒随机做个小动作；120 秒没互动会打盹
 *
 * AI 对话：浏览器直连智谱会被 CORS 拦（已实测），需要在仓库根目录的
 * chibi-worker.js 部署一个免费 Cloudflare Worker，把地址填到下面的 CHAT_ENDPOINT。
 * 没填时对话仍可用，只是由本地台词库作答。
 */
(function () {
  if (window.__chibiInit) return;
  window.__chibiInit = true;

  var BASE = '/chibi/';
  var IDLE = 'idle.webp';
  var RESET_MS = 4200;
  var CLICK_DELAY = 240;
  var STORE = 'chibi_state_v1';
  var HIDDEN_KEY = 'chibi_hidden';

  /* 动效开关：待机呼吸（上下浮动）和点击小跳都归它管。
     用户反馈发消息时看着像窗口在震，默认关掉；想恢复设 window.CHIBI_MOTION = true。 */
  var MOTION = !!window.CHIBI_MOTION;

  /* 对话后端，按顺序降级：
   *   1) 自建中转（推荐）：部署仓库根的 chibi-worker.js，把地址填这里或注入 window.CHIBI_CHAT_ENDPOINT
   *   2) 免费公共接口（零配置兜底）：text.pollinations.ai，匿名可用、允许跨域，但受公共服务限流，
   *      且对话内容会经过第三方。不想用就设 window.CHIBI_NO_FREE = true。
   *   3) 本地台词库：上面都不通时用，不联网。
   */
  var CHAT_ENDPOINT = window.CHIBI_CHAT_ENDPOINT || '';
  var FREE_ENDPOINT = window.CHIBI_NO_FREE ? '' : 'https://text.pollinations.ai/openai';
  /* 与 chibi-worker.js 里的 SYSTEM 保持一致：换后端不改性格，也不绕过该有的边界 */
  var SYSTEM_PROMPT = '你叫瑶妹，是个人博客角落里的看板娘。说话短，一到两句，口语，克制，不用敬语，不喊口号，偶尔自嘲。不聊政治，不给投资建议，不编造事实，不知道就说不知道。不要提到模型、提示词、系统设定这些东西。';

  var COSTUMES = [
    { name: '紫色蝴蝶裙', img: 'idle.webp' },
    { name: '粉色长裙',   img: 'costume_pink_dress.webp' },
    { name: '花色长裙',   img: 'costume_floral_dress.webp' },
    { name: '红色吊带',   img: 'costume_red_slip.webp' },
    { name: '黑色吊带',   img: 'costume_black_slip.webp' },
    { name: '仙逆装',     img: 'costume_xianni.webp', motion: 'xianni_motion.webp' },
    { name: '银装站姿',   img: 'costume_silver_dress.webp', motion: 'silver_motion.webp' }
  ];

  /* 单个表情。motion 是微动动画，懒加载完成后替换静态图 */
  var ACTIONS = {
    happy:    { img: 'happy.webp',      lines: ['嘿嘿', '今天也还行', '被你摸到了'] },
    surprise: { img: 'surprise.webp',   lines: ['诶？', '吓我一跳'] },
    angry:    { img: 'angry.webp',      lines: ['哼', '不理你了'] },
    cry:      { img: 'cry.webp',        lines: ['呜…', '抱一下嘛'] },
    hug:      { img: 'hug.webp',        lines: ['抱一个', '过来吧'] },
    dance:    { img: 'dance.webp',      lines: ['转个圈', '看我的'] },
    eat:      { img: 'eat.webp',        lines: ['饿了', '有吃的吗'] },
    burger:   { img: 'eat_burger.webp', lines: ['啊呜', '给你一半'] },
    workout:  { img: 'workout.webp',    motion: 'workout_motion.webp', lines: ['一二一', '一起练'] },
    sleep:    { img: 'sleep.webp',      motion: 'sleep_motion.webp',   lines: ['困了…', '眯一会儿'] },
    pajama:   { img: 'pajama_rest.webp', lines: ['该睡了'] }
  };

  var LINES = {
    hungry:  ['肚子有点空', '想吃东西了', '你吃饭了吗'],
    lonely:  ['在忙吗', '有点无聊', '你怎么不理我'],
    night:   ['很晚了，睡吧', '夜里别熬太久', '早点休息'],
    morning: ['早上好', '醒了？'],
    noon:    ['午饭吃了吗', '该吃饭了'],
    evening: ['晚上好', '今天过得怎么样']
  };

  /* 本地闲聊：AI 未接或请求失败时的兜底，按关键词分组 */
  var SMALL_TALK = [
    { k: ['你好', '在吗', '嗨', 'hi', 'hello'], a: ['在的', '你好呀', '我在，慢慢说'] },
    { k: ['累', '忙', '烦', '困', '难受', '焦虑'], a: ['那就先歇会儿', '别硬撑', '喝口水再回来'] },
    { k: ['论文', '实验', '代码', '报错', '数据', '计算'], a: ['慢慢来，先看一遍报错', '卡住就先放一放', '跑通一次就够了，之后再谈好看'] },
    { k: ['喜欢', '可爱', '好看', '爱你'], a: ['少来', '我脸红了', '知道了知道了'] },
    { k: ['谢谢', '多谢', '感谢'], a: ['不客气', '小事'] },
    { k: ['再见', '拜拜', '走了', '晚安'], a: ['晚安', '路上小心', '明天见'] },
    { k: ['名字', '你是谁'], a: ['瑶妹', '你的桌宠，搬来这儿站岗了'] },
    { k: ['几点', '时间'], a: [function () { return '现在 ' + new Date().toTimeString().slice(0, 5); }] }
  ];

  var box = null, pic = null, bub = null, menu = null, chat = null, stats = null;
  var bubbleTimer = null, actionTimer = null, clickTimer = null, chatTimer = null;
  var state = null, busy = false, dozing = false, lastTouch = Date.now();
  var dragging = false, moved = false, dragStart = null, dragOrigin = null;
  var lastClick = 0;          /* 自己判双击，不依赖 dblclick 事件 */
  var history = [];           /* 对话上下文，只存在内存里，刷新即清空 */
  var chatSeq = 0;            /* 提问序号，用来丢弃迟到的过期回复 */
  var freeCooldown = 0;       /* 公共接口被限流后的冷却截止时间，冷却期内直接走本地台词 */

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* ---------- 状态 ---------- */
  function loadState() {
    var s = { hunger: 80, mood: 80, intimacy: 60, costume: 0, x: null, y: null, ts: Date.now() };
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in s) if (k in o) s[k] = o[k];
      }
    } catch (e) { /* 隐私模式读不到，用默认值 */ }

    /* 离线期间的衰减，和桌宠同速率（每分钟 -2 饱食、-1 心情），最多折算 12 小时 */
    var mins = clamp((Date.now() - (s.ts || Date.now())) / 60000, 0, 720);
    s.hunger = clamp(Math.round(s.hunger - mins * 2), 0, 100);
    s.mood = clamp(Math.round(s.mood - mins * 1), 0, 100);
    s.hunger = clamp(s.hunger, 0, 100);
    s.ts = Date.now();
    return s;
  }

  function saveState() {
    if (!state) return;
    state.ts = Date.now();
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
  }

  function greet() {
    var h = new Date().getHours();
    if (h < 6) return pick(LINES.night);
    if (h < 11) return pick(LINES.morning);
    if (h < 14) return pick(LINES.noon);
    if (h < 18) return '下午好，别光坐着';
    if (h < 23) return pick(LINES.evening);
    return pick(LINES.night);
  }

  /* ---------- 说话 / 换图 ---------- */
  function say(text, ms) {
    if (!bub) return;
    bub.textContent = text;
    bub.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bub.classList.remove('show'); }, ms || 4200);
  }

  /* 换图：先上静态图，带 motion 的在后台预加载，加载完且仍停留在该状态才替换 */
  function show(url, motion) {
    pic.dataset.want = url;
    pic.src = BASE + url;
    if (!motion) return;
    var want = url;
    var m = new Image();
    m.onload = function () { if (pic.dataset.want === want) pic.src = BASE + motion; };
    m.src = BASE + motion;
  }

  function boing() {
    if (!MOTION) return;
    box.classList.remove('boing');
    void box.offsetWidth;   /* 强制重排，让动画能重播 */
    box.classList.add('boing');
  }

  function setAction(key, ms) {
    var a = ACTIONS[key] || ACTIONS.happy;
    busy = true;
    show(a.img, a.motion);
    if (a.lines) say(pick(a.lines));
    boing();
    clearTimeout(actionTimer);
    actionTimer = setTimeout(backToIdle, ms || RESET_MS);
  }

  function backToIdle() {
    busy = false;
    var c = COSTUMES[state.costume] || COSTUMES[0];
    show(c.img, c.motion);
  }

  function nextCostume() {
    state.costume = (state.costume + 1) % COSTUMES.length;
    saveState();
    var c = COSTUMES[state.costume];
    show(c.img, c.motion);
    say(c.name);
    boing();
    clearTimeout(actionTimer);
    actionTimer = setTimeout(backToIdle, RESET_MS);
  }

  /* ---------- 状态条 ---------- */
  function bars() {
    if (!stats) return;
    var rows = [
      ['饱食', state.hunger, '#e8a33d'],
      ['心情', state.mood, '#5b8ac9'],
      ['好感', state.intimacy, '#d96a8b']
    ];
    stats.innerHTML = rows.map(function (r) {
      return '<div class="row"><span>' + r[0] + '</span>' +
        '<i><b style="width:' + r[1] + '%;background:' + r[2] + '"></b></i>' +
        '<em>' + r[1] + '</em></div>';
    }).join('');
  }

  function showStats(ms) {
    if (!stats) return;
    bars();
    stats.classList.add('show');
    clearTimeout(stats._t);
    stats._t = setTimeout(function () { stats.classList.remove('show'); }, ms || 5000);
  }

  /* ---------- 动作 ---------- */
  function feed() {
    touch();
    state.hunger = clamp(state.hunger + 25, 0, 100);
    state.mood = clamp(state.mood + 10, 0, 100);
    state.intimacy = clamp(state.intimacy + 5, 0, 100);
    saveState();
    setAction(Math.random() < 0.3 ? 'burger' : 'eat', 2600);
    say(state.hunger >= 100 ? '吃撑了' : '谢谢，好吃');
    showStats();
  }

  function pat() {
    touch();
    state.mood = clamp(state.mood + 20, 0, 100);
    state.intimacy = clamp(state.intimacy + 8, 0, 100);
    saveState();
    setAction(state.mood > 90 ? 'hug' : 'happy', 2600);
    var pool = state.intimacy > 80 ? ['被你摸顺毛了', '再摸一下'] : ['嘿嘿', '嗯…', '痒'];
    say(pick(pool));
    showStats();
  }

  function touch() { lastTouch = Date.now(); if (dozing) wake(); }

  function startDoze() {
    if (dozing || busy || dragging) return;
    dozing = true;
    show('sleep.webp', 'sleep_motion.webp');
    say(pick(['有点困了…', '眯一会儿，叫我']), 6000);
    box.classList.add('dozing');
  }

  function wake() {
    if (!dozing) return;
    dozing = false;
    box.classList.remove('dozing');
    setAction('surprise', 1600);
    say('你回来啦');
  }

  /* ---------- 菜单 ---------- */
  function buildMenu() {
    menu = document.createElement('div');
    menu.className = 'chibi-menu';
    menu.innerHTML =
      '<button data-act="feed">喂食</button>' +
      '<button data-act="pat">摸摸</button>' +
      '<button data-act="costume">换装</button>' +
      '<button data-act="chat">说说话</button>' +
      '<button data-act="stats">状态</button>' +
      '<button data-act="hide">藏起来</button>';
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var act = b.dataset.act;
      hideMenu();
      if (act === 'feed') feed();
      else if (act === 'pat') pat();
      else if (act === 'costume') nextCostume();
      else if (act === 'chat') openChat();
      else if (act === 'stats') { showStats(7000); say('饱食 ' + state.hunger + '　心情 ' + state.mood + '　好感 ' + state.intimacy, 7000); }
      else if (act === 'hide') hideChibi();
    });
    document.body.appendChild(menu);
  }

  function showMenu(x, y) {
    if (!menu) buildMenu();
    menu.classList.add('show');
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = clamp(x - w, 8, window.innerWidth - w - 8) + 'px';
    menu.style.top = clamp(y - h, 8, window.innerHeight - h - 8) + 'px';
  }

  function hideMenu() { if (menu) menu.classList.remove('show'); }

  /* ---------- 对话 ---------- */
  function buildChat() {
    chat = document.createElement('div');
    chat.className = 'chibi-chat';
    chat.innerHTML =
      '<div class="hd"><span>和瑶妹说话</span><button class="x" type="button">×</button></div>' +
      '<div class="log"></div>' +
      '<div class="in"><input type="text" maxlength="120" placeholder="说点什么，回车发送"><button type="button">发</button></div>';
    chat.querySelector('.x').addEventListener('click', closeChat);
    var input = chat.querySelector('input');
    var send = chat.querySelector('.in button');
    function submit() {
      var t = input.value.trim();
      if (!t) return;
      input.value = '';
      handleUser(t);
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    document.body.appendChild(chat);
  }

  function openChat() {
    if (!chat) buildChat();
    if (!chat.dataset.greet) {
      chat.dataset.greet = '1';
      addLine('瑶妹', '想聊什么？问我饿不饿也行');
    }
    chat.classList.add('show');
    var input = chat.querySelector('input');
    if (input) setTimeout(function () { input.focus(); }, 60);
    touch();
  }

  function closeChat() { if (chat) chat.classList.remove('show'); }

  /* 对话面板开着的时候，暂停随机小动作和定时搭话 */
  function chatting() { return !!(chat && chat.classList.contains('show')); }

  function addLine(who, text) {
    var log = chat.querySelector('.log');
    var d = document.createElement('div');
    d.className = who === '我' ? 'me' : 'her';
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function typing(on) {
    var log = chat.querySelector('.log');
    var t = log.querySelector('.typing');
    if (on) {
      if (!t) { t = document.createElement('div'); t.className = 'typing'; t.textContent = '…'; log.appendChild(t); log.scrollTop = log.scrollHeight; }
    } else if (t) { t.remove(); }
  }

  /* 关键词动作：命中就立刻动，不浪费一次模型调用 */
  function command(text) {
    var has = function () {
      for (var i = 0; i < arguments.length; i++) if (text.indexOf(arguments[i]) >= 0) return true;
      return false;
    };
    if (has('喂', '吃的', '饿了', '饿')) { if (text.length <= 10) { feed(); addLine('瑶妹', pick(['啊呜', '谢谢'])); return true; } }
    if (has('摸摸', '摸头', '抱抱', '抱一下', '撸')) { pat(); addLine('瑶妹', '嗯…'); return true; }
    if (has('换装', '换衣', '换套')) { nextCostume(); addLine('瑶妹', '换好了：' + COSTUMES[state.costume].name); return true; }
    if (has('睡', '晚安', '困')) { setAction('sleep', 6000); addLine('瑶妹', '那我先眯一会儿'); return true; }
    if (has('醒', '起床')) { dozing = false; box.classList.remove('dozing'); setAction('surprise', 1600); addLine('瑶妹', '醒了醒了'); return true; }
    if (has('唱')) { setAction('happy', 3200); addLine('瑶妹', '啦啦啦…'); return true; }
    if (has('跳')) { setAction('dance', 3600); addLine('瑶妹', '看我的'); return true; }
    if (has('锻炼', '健身', '运动')) { setAction('workout', 5000); addLine('瑶妹', '一起练'); return true; }
    if (has('汉堡')) { setAction('burger', 3600); addLine('瑶妹', '啊呜'); return true; }
    if (has('哭', '难过', '烦')) { setAction('cry', 3000); addLine('瑶妹', '那就难过一会儿，没事'); return true; }
    if (has('状态', '数据')) { showStats(8000); addLine('瑶妹', '饱食 ' + state.hunger + '，心情 ' + state.mood + '，好感 ' + state.intimacy); return true; }
    return false;
  }

  function localReply(text) {
    for (var i = 0; i < SMALL_TALK.length; i++) {
      var g = SMALL_TALK[i];
      for (var j = 0; j < g.k.length; j++) {
        if (text.indexOf(g.k[j]) >= 0) {
          var a = pick(g.a);
          return typeof a === 'function' ? a() : a;
        }
      }
    }
    if (state.hunger < 30) return pick(LINES.hungry);
    if (state.intimacy < 30) return pick(LINES.lonely);
    return pick(['嗯', '你说', '在听', '然后呢', '这个我不太懂，但我在听']);
  }

  /* 两种后端返回结构不同：自建 Worker 是 {reply}，公共/OpenAI 兼容是 choices[0].message.content */
  function replyFrom(data) {
    if (!data) return '';
    if (typeof data.reply === 'string' && data.reply) return data.reply;
    var c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return typeof c === 'string' ? c : '';
  }

  /* 模型容易絮叨、爱塞表情；按人设收一下：去表情、只留两句、限长 */
  function tidy(text) {
    var t = String(text || '')
      .replace(/[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/g, '')
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    var m = t.match(/^[^。！？!?]*[。！？!?]?[^。！？!?]*[。！？!?]?/);
    if (m && m[0]) t = m[0].trim();
    return t.slice(0, 120);
  }

  /* 单次请求；不管成功失败都回调一个字符串，空串表示这次没答案 */
  function postOnce(url, msgs, timeout, done) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* max_tokens 必须给：不限制的话服务端会生成很长一段，十几秒才回 */
      body: JSON.stringify({ messages: msgs, temperature: 0.85, max_tokens: 120 }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) { clearTimeout(timer); done(replyFrom(d)); })
      .catch(function () { clearTimeout(timer); done(''); });
  }

  /* 按 CHAT_ENDPOINT → 公共接口 的顺序试，前一个挂了不耽误后面；
     done(reply, viaFree) 的第二个参数告诉调用方「最后试的是不是公共接口」，用来记限流冷却 */
  function askRemote(msgs, done) {
    var chain = [];
    if (CHAT_ENDPOINT) chain.push(CHAT_ENDPOINT);
    if (FREE_ENDPOINT && Date.now() > freeCooldown && chain.indexOf(FREE_ENDPOINT) < 0) chain.push(FREE_ENDPOINT);
    if (!chain.length) { done('', false); return; }
    var per = chain.length > 1 ? 9000 : 12000;   /* 两条链路时单次别拖太久，否则总等待翻倍 */
    var i = 0;
    (function next() {
      if (i >= chain.length) { done('', chain[chain.length - 1] === FREE_ENDPOINT); return; }
      var url = chain[i++];
      postOnce(url, msgs, per, function (reply) {
        if (reply) { done(reply, url === FREE_ENDPOINT); return; }
        next();
      });
    })();
  }

  function handleUser(text) {
    addLine('我', text);
    touch();
    if (command(text)) return;

    history.push({ role: 'user', content: text });
    if (history.length > 8) history = history.slice(-8);

    var useFree = !!FREE_ENDPOINT && Date.now() > freeCooldown;
    if (!CHAT_ENDPOINT && !useFree) {
      /* 没配中转，或公共接口刚被限流：直接用本地台词，不白等一次网络 */
      setTimeout(function () { addLine('瑶妹', localReply(text)); }, 260);
      history.pop();
      return;
    }

    typing(true);
    var myId = ++chatSeq;                 /* 只让最新一句的回复落到界面上，避免迟到的答案插队 */
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT }].concat(history);
    /* 自建中转挂了会自动再走一次公共接口，所以这里拿到的可能是第二条链路的答案 */
    askRemote(msgs, function (reply, viaFree) {
      if (myId !== chatSeq) return;
      typing(false);
      var out = tidy(reply);
      if (!out) {
        history.pop();                    /* 没答上就把这条提问撤出上下文，免得越攒越乱 */
        if (viaFree) freeCooldown = Date.now() + 60000;   /* 多半是匿名限流，冷却一分钟再试 */
        out = localReply(text);            /* 后端都不通退回本地台词，对话框不留空 */
      } else {
        history.push({ role: 'assistant', content: out });
        if (history.length > 8) history = history.slice(-8);
      }
      addLine('瑶妹', out);
    });
  }

  /* ---------- 藏起来 / 放回来 ---------- */
  function hideChibi() {
    box.style.display = 'none';
    try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch (e) {}
    var r = document.getElementById('chibi-restore');
    if (!r) {
      r = document.createElement('button');
      r.id = 'chibi-restore';
      r.type = 'button';
      r.textContent = '瑶';
      r.title = '把看板娘叫回来';
      r.addEventListener('click', function () {
        box.style.display = '';
        r.remove();
        try { sessionStorage.removeItem(HIDDEN_KEY); } catch (e) {}
        setAction('surprise', 1600);
        say('我回来了');
      });
      document.body.appendChild(r);
    }
  }

  /* ---------- 拖动 ---------- */
  function place(x, y) {
    var w = box.offsetWidth, h = box.offsetHeight;
    x = clamp(x, 4, window.innerWidth - w - 4);
    y = clamp(y, 4, window.innerHeight - h - 4);
    box.classList.add('moved');
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    state.x = x; state.y = y;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (document.getElementById('live2d-widget')) return;
    var hadState = false;
    try { hadState = !!localStorage.getItem(STORE); } catch (e) {}
    state = loadState();

    box = document.createElement('div');
    box.id = 'live2d-widget';
    box.className = 'chibi' + (MOTION ? '' : ' still');

    pic = document.createElement('img');
    pic.alt = '瑶妹';
    pic.draggable = false;              /* 关掉浏览器原生图片拖拽，否则会打断 pointer 事件 */
    pic.dataset.want = IDLE;
    pic.src = BASE + (COSTUMES[state.costume] || COSTUMES[0]).img;

    bub = document.createElement('div');
    bub.className = 'l2d-bubble';

    stats = document.createElement('div');
    stats.className = 'chibi-stats';

    box.appendChild(pic);
    box.appendChild(bub);
    box.appendChild(stats);
    document.body.appendChild(box);

    if (state.x != null && state.y != null) place(state.x, state.y);

    /* 指针交互：拖动优先，未移动则按点击处理 */
    box.addEventListener('dragstart', function (e) { e.preventDefault(); });

    box.addEventListener('pointerdown', function (e) {
      if (e.button === 2) return;
      e.preventDefault();               /* 拦掉选中与浏览器原生拖拽 */
      dragging = true; moved = false;
      dragStart = { x: e.clientX, y: e.clientY };
      var r = box.getBoundingClientRect();
      dragOrigin = { x: r.left, y: r.top };
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
    });

    box.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      moved = true;
      box.classList.add('dragging');
      place(dragOrigin.x + dx, dragOrigin.y + dy);
    });

    box.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('dragging');
      try { box.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved) { saveState(); touch(); return; }
      /* 没拖动 → 自己判双击：320ms 内第二下算双击换装，否则单击摸头 */
      var now = Date.now();
      clearTimeout(clickTimer);
      if (now - lastClick < 320) {
        lastClick = 0;
        nextCostume();
      } else {
        lastClick = now;
        clickTimer = setTimeout(function () { pat(); }, CLICK_DELAY);
      }
    });

    box.addEventListener('pointercancel', function () {
      dragging = false;
      box.classList.remove('dragging');
    });

    box.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      touch();
      showMenu(e.clientX, e.clientY);
    });

    /* 长按也能出菜单（触屏 / 没右键的场合） */
    var pressTimer = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      pressTimer = setTimeout(function () { showMenu(e.clientX, e.clientY); }, 600);
    });
    ['pointerup', 'pointercancel', 'pointermove'].forEach(function (ev) {
      box.addEventListener(ev, function () { clearTimeout(pressTimer); });
    });

    document.addEventListener('click', function (e) {
      if (menu && menu.classList.contains('show') && !menu.contains(e.target)) hideMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideMenu(); closeChat(); }
    });

    if (state.hunger < 30) {
      setTimeout(function () { say(pick(LINES.hungry)); setAction('angry', 3000); }, 2000);
    } else {
      /* 第一次来提示一下入口，之后只打招呼 */
      setTimeout(function () { say(hadState ? greet() : '右键有菜单，点我也行', hadState ? 4200 : 5600); }, 1200);
    }

    /* 每分钟衰减一次，和桌宠一致 */
    setInterval(function () {
      state.hunger = clamp(state.hunger - 2, 0, 100);
      state.mood = clamp(state.mood - 1, 0, 100);
      saveState();
      if (state.hunger < 30 && !busy && !dozing) {
        say(pick(LINES.hungry));
        setAction('angry', 3000);
      }
    }, 60000);

    /* 空闲随机小动作：8–25 秒（正在对话时不动，免得打字时她乱换表情） */
    (function idleLoop() {
      var wait = 8000 + Math.random() * 17000;
      setTimeout(function () {
        if (!busy && !dozing && !document.hidden && !dragging && !chatting()) {
          setAction(pick(['happy', 'surprise', 'eat', 'angry', 'dance', 'workout', 'cry', 'hug']), 2600);
        }
        idleLoop();
      }, wait);
    })();

    /* 2–7 分钟随机说一句 */
    (function speakLoop() {
      var wait = 120000 + Math.random() * 300000;
      setTimeout(function () {
        if (!busy && !dozing && !document.hidden && !chatting()) {
          var pool = [greet()];
          if (state.hunger < 50) pool.push(pick(LINES.hungry));
          if (state.intimacy < 40) pool.push(pick(LINES.lonely));
          say(pick(pool));
          setAction('happy', 2200);
        }
        speakLoop();
      }, wait);
    })();

    /* 120 秒没互动打盹 */
    setInterval(function () {
      if (!busy && !dozing && !dragging && Date.now() - lastTouch > 120000) startDoze();
    }, 15000);

    try {
      if (sessionStorage.getItem(HIDDEN_KEY) === '1') hideChibi();   /* 走同一入口，顺带把召回钮建出来 */
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* PJAX 换页后容器可能被替换，兜底重建 */
  document.addEventListener('pjax:complete', function () {
    if (!document.getElementById('live2d-widget')) init();
  });
})();
