/* 隐形账本 · 应用逻辑
   纯前端、无依赖、数据只存在本机 localStorage。 */

(function () {
  'use strict';

  const KEY = 'ylb.v1';
  const WEEK = 7 * 24 * 3600 * 1000;

  /* ---------------- 存储 ---------------- */
  const defaultState = () => ({
    rate: 40,
    name: '妈妈',
    records: [],
    lastReportHint: ''
  });

  let state = defaultState();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        state = Object.assign(defaultState(), p);
        if (!Array.isArray(state.records)) state.records = [];
      }
    } catch (e) { state = defaultState(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- 工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function startOfWeek(d) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (t.getDay() + 6) % 7; // 周一为 0
    t.setDate(t.getDate() - day);
    t.setHours(0, 0, 0, 0);
    return t;
  }

  function weekRange(offset) {
    const s = startOfWeek(new Date());
    s.setDate(s.getDate() - offset * 7);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    return [s.getTime(), e.getTime()];
  }

  const fmtMoney = (n) => (Math.round(n * 10) / 10).toLocaleString('zh-CN');
  const fmtHour = (min) => (Math.round(min / 6) / 10).toFixed(1);
  const mmdd = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}.${pad(d.getDate())}`; };
  const weekday = (ts) => '日一二三四五六'[new Date(ts).getDay()];

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const el = $('#view-' + name);
    if (el) el.classList.add('active');
    $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $('#main').scrollTop = 0;
    if (name === 'report') renderReport();
    if (name === 'dict') renderOverview();
    if (name === 'record') renderToday();
  }

  /* ---------------- 词典 ---------------- */
  let filterCat = '全部';
  let keyword = '';

  function starHTML(load) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<i class="${i <= load ? 'on' : ''}">★</i>`;
    return `<span class="stars" title="心理负荷 ${load}/5">${s}</span>`;
  }

  function catTag(cat) {
    const m = CAT_META[cat];
    return `<span class="tag tag--${m.key}">${cat}</span>`;
  }

  function renderChips() {
    const cats = ['全部', '统筹类', '情绪类', '记忆类', '补救类', '★5'];
    $('#chips').innerHTML = cats.map(c => {
      const active = c === filterCat ? ' active' : '';
      let dot = '';
      if (c !== '全部' && c !== '★5') {
        dot = `<span class="dot" style="background:${CAT_META[c].color}"></span>`;
      }
      const label = c === '★5' ? '高负荷 5★' : c;
      return `<button class="chip${active}" data-cat="${c}" type="button">${dot}${label}</button>`;
    }).join('');
  }

  function filteredDict() {
    let list = DICT.slice();
    if (filterCat === '★5') list = list.filter(d => d.load === 5);
    else if (filterCat !== '全部') list = list.filter(d => d.cat === filterCat);

    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(k) ||
        d.note.toLowerCase().includes(k) ||
        d.cat.includes(k) ||
        d.kw.some(w => w.toLowerCase().includes(k))
      );
    }

    const order = { '统筹类': 1, '情绪类': 2, '记忆类': 3, '补救类': 4 };
    list.sort((a, b) => b.load - a.load || order[a.cat] - order[b.cat]);
    return list;
  }

  function renderDict() {
    const list = filteredDict();
    $('#dictCount').textContent = `共 ${list.length} 项`;
    if (!list.length) {
      $('#dictList').innerHTML = `<div class="empty"><span class="big">◌</span>没有匹配的条目，换个词试试。</div>`;
      return;
    }
    $('#dictList').innerHTML = list.map(d => {
      const val = Math.round(d.min / 60 * state.rate);
      return `<article class="dict-card" data-id="${d.id}">
        <div class="dc-top">
          ${catTag(d.cat)}
          ${starHTML(d.load)}
        </div>
        <h3>${esc(d.name)}</h3>
        <p class="dc-note">${esc(d.note)}</p>
        <div class="dc-foot">
          <span>约 ${d.min} 分钟</span>
          <span>≈ ¥${val}</span>
          <span class="spacer"></span>
          <button class="mini-btn add-btn" data-id="${d.id}" type="button">记一笔</button>
        </div>
      </article>`;
    }).join('');
  }

  /* ---------------- 统计与概览 ---------------- */
  function overview() {
    const [s, e] = weekRange(0);
    const list = state.records.filter(r => r.ts >= s && r.ts < e);
    const total = list.reduce((a, r) => a + r.minutes, 0);
    const mom = list.filter(r => r.owner === state.name || r.owner === '妈妈').reduce((a, r) => a + r.minutes, 0);
    return { list, total, mom, share: total ? Math.round(mom / total * 100) : 0 };
  }

  function renderOverview() {
    const o = overview();
    $('#ovHours').textContent = fmtHour(o.total);
    $('#ovMoney').textContent = fmtMoney(o.total / 60 * state.rate);
    $('#ovCount').textContent = o.list.length;
    $('#ovShare').textContent = o.list.length ? o.share + '%' : '—';
    const q = $('#ovQuote');
    if (!o.list.length) {
      q.textContent = '先记下第一笔，数据会替你说话。';
    } else if (o.share >= 80) {
      q.textContent = `分配率 ${o.share}% —— 本周家庭运转高度依赖单一承担者。`;
    } else {
      q.textContent = `分配率 ${o.share}% —— 本周共 ${o.list.length} 笔隐形任务进入台账。`;
    }
  }

  /* ---------------- 语义拆解 ---------------- */
  const CAT_KW = {
    '统筹类': ['安排', '规划', '统筹', '预约', '协调', '计划', '准备', '排课', '对接', '订', '报名', '组织', '比价', '缴费', '采购', '清单', '买', '购物', '囤'],
    '情绪类': ['安抚', '情绪', '哭', '哄', '婆媳', '婆婆', '生气', '冷战', '安慰', '感受', '委屈', '气氛', '解释', '陪', '崩溃', '吵架', '忍着', '不高兴'],
    '记忆类': ['提醒', '记住', '记下', '别忘了', '记着', '到期', '生日', '通知', '惦记', '记得', '缴费日'],
    '补救类': ['送去', '补上', '发现', '收拾', '忘了', '忘带', '折返', '临时', '烂摊子', '漏了', '赶回', '修', '擦', '救场', '没带', '找']
  };

  const CAT_ORDER = ['统筹类', '情绪类', '记忆类', '补救类'];
  const DEFAULT_MIN = { '统筹类': 30, '情绪类': 40, '记忆类': 10, '补救类': 25 };
  const FAIL_KW = /忘带|忘了|忘记|没带|没做|没记|没发现|没打卡|忘了买|漏了/;

  function inferCats(text) {
    const hit = [];
    Object.keys(CAT_KW).forEach(cat => {
      if (CAT_KW[cat].some(w => text.includes(w))) hit.push(cat);
    });
    return hit;
  }

  function matchEntry(text) {
    let best = null, bestScore = 0;
    DICT.forEach(d => {
      let score = 0;
      d.kw.forEach(w => { if (text.includes(w)) score += w.length >= 3 ? 2 : 1; });
      if (text.includes(d.name)) score += 4;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return bestScore >= 1 ? best : null;
  }

  // 把一句话切成若干"动作"（只按标点与明确的连接词切，避免把"婆婆又说…"切碎）
  function segment(text) {
    return String(text)
      .replace(/[。！？!?；;\n]/g, '，')
      .split(/，|,|、|然后|接着|顺便|另外/)
      .map(s => s.trim())
      .filter(s => s.length >= 2);
  }

  function clean(s) {
    return s.replace(/^(我今天|今天|我刚|我刚去|我又|刚|又|然后|接着|还要|还得|去|得去|还有)+/, '')
      .replace(/(了|吧|啊|呢|呀)+$/, '')
      .trim();
  }

  function parseSegment(text) {
    const entry = matchEntry(text);
    const inferred = inferCats(text);

    // 类型：动词推断 + 条目所属类别，合并去重
    let cats = inferred.slice(0, 2);
    if (entry && !cats.includes(entry.cat)) cats.push(entry.cat);
    const isReminder = /提醒|别忘了|记着|记下|记得|惦记/.test(text);
    if (isReminder && !cats.includes('记忆类')) cats.unshift('记忆类');
    if (!cats.length) cats = ['记忆类'];
    cats = Array.from(new Set(cats)).slice(0, 2).sort((a, b) => {
      if (isReminder) return (a === '记忆类' ? -1 : b === '记忆类' ? 1 : 0);
      return CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b);
    });

    // 承担者：谁在说、谁被提醒
    const mentionsDad = /(他爸|爸爸|老公|孩子他爸)/.test(text);
    const towardDad = /(提醒|让|叫|催|跟|和|交代).{0,5}(他爸|爸爸|老公|孩子他爸)/.test(text);
    const dadActing = !towardDad && /^(爸爸|老公|他爸|他今天|他带|他送|他接|他昨天)/.test(text.trim());
    // 爸爸的"忘了/没带"= 失职事件，不计入其劳动时长
    const dadFail = mentionsDad && !towardDad && FAIL_KW.test(text);
    const owner = (dadActing || dadFail) ? '爸爸' : '妈妈';

    // 耗时
    let minutes;
    if (isReminder) minutes = 15;
    else if (entry) minutes = entry.min;
    else minutes = DEFAULT_MIN[cats[0]] || 20;

    const load = entry ? entry.load : Math.min(5, 2 + cats.length);

    let name = clean(text);
    if (name.length > 22) name = name.slice(0, 22) + '…';
    if (!name) name = entry ? entry.name : '未命名隐形任务';

    let verdict;
    if (dadFail) verdict = '否（该任务由爸爸承担，但因遗忘未完成，实际由妈妈兜底）';
    else if (owner === '爸爸') verdict = '否（本次由爸爸主动承担，已计入其名下时长）';
    else if (towardDad) verdict = '是（爸爸没有主动记起，需要妈妈提醒）';
    else verdict = '是（无对应分工、无人接替，且不计入家庭产出）';

    return {
      task: name,
      cats,
      owner,
      verdict,
      minutes: dadFail ? 0 : minutes,
      value: dadFail ? 0 : Math.round(minutes / 60 * state.rate),
      load,
      entry: entry ? entry.name : null,
      state: dadFail ? 'missed' : 'done',
      missType: dadFail ? 'promise' : null,
      raw: text.trim()
    };
  }

  function parseText(text) {
    const segs = segment(text);
    const out = [];
    const seen = new Set();
    const seenEntry = new Set();
    const VENT = /^(今天|昨天|刚才)?(气死|烦死|累死|郁闷|无语|烦透|真的服|唉|哎)/;
    segs.forEach(s => {
      const entry = matchEntry(s);
      const cats = inferCats(s);
      const c = clean(s);
      // 纯情绪宣泄（"今天气死我了"）不进入台账
      if (VENT.test(c) && c.length <= 12) return;
      if (!entry && !cats.length && c.length <= 10) return;
      const r = parseSegment(s);
      // 同一件事被切碎成多段时，只保留一条（不同承担者视为两件事，如"他忘带/我送去"）
      const byEntry = entry ? entry.id + '|' + r.owner : null;
      if (byEntry && seenEntry.has(byEntry)) return;
      const k = r.task + '|' + r.cats.join(',') + '|' + r.owner;
      if (seen.has(k)) return;
      if (byEntry) seenEntry.add(byEntry);
      seen.add(k);
      out.push(r);
    });
    return out.slice(0, 4);
  }

  function jsonFor(r) {
    return `{
  <span class="k">"任务名称"</span>: <span class="s">"${esc(r.task)}"</span>,
  <span class="k">"任务类型"</span>: <span class="s">"${esc(r.cats.join('+'))}"</span>,
  <span class="k">"承担者"</span>: <span class="s">"${esc(r.owner)}"</span>,
  <span class="k">"隐形劳动判定"</span>: <span class="s">"${esc(r.verdict)}"</span>,
  <span class="k">"预计耗时（分钟）"</span>: <span class="n">${r.minutes}</span>,
  <span class="k">"折合家政时薪价值（元）"</span>: <span class="n">${r.value}</span>
}`;
  }

  let pending = [];

  function renderParse(list) {
    pending = list;
    const box = $('#parseOut');
    if (!list.length) {
      box.innerHTML = `<div class="panel" style="color:#9C8B80;font-size:12px">没有识别到可结构的动作，换个说法再试一次。</div>`;
      return;
    }
    const total = list.reduce((a, r) => a + r.minutes, 0);
    const money = list.reduce((a, r) => a + r.value, 0);
    box.innerHTML = `
      <div class="panel">
        <p class="panel-title">结构化结果 · ${list.length} 个隐形任务</p>
        ${list.map(r => `<div class="json-card" style="margin-bottom:8px">
          <div class="json-head"><span>JSON</span><span class="ok">● 已归类</span></div>
          <pre class="json">${jsonFor(r)}</pre>
          ${r.entry ? `<div class="parsed-item">归类：<b>${esc(r.entry)}</b> · 心理负荷 ${r.load}/5</div>` : ''}
        </div>`).join('')}
        <div class="rec-actions">
          <button class="btn btn-primary" id="saveParsed" type="button">计入台账 · ${total} 分钟 / ¥${money}</button>
        </div>
      </div>`;
    $('#saveParsed').addEventListener('click', () => {
      const ts = Date.now();
      pending.forEach(r => {
        state.records.push({
          id: uid(), task: r.task, cats: r.cats, owner: r.owner, minutes: r.minutes,
          load: r.load, ts, state: r.state || 'done', missType: r.missType || null, raw: r.raw
        });
      });
      save();
      $('#parseOut').innerHTML = '';
      $('#voiceInput').value = '';
      renderToday(); renderOverview();
      toast(`已计入 ${pending.length} 笔 · ¥${money}`);
      pending = [];
    });
  }

  /* ---------------- 今日记录 ---------------- */
  function renderToday() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const list = state.records.filter(r => r.ts >= d.getTime()).sort((a, b) => b.ts - a.ts);
    $('#todayCount').textContent = list.length ? `· ${list.length} 笔` : '';
    $('#todayEmpty').style.display = list.length ? 'none' : 'block';

    $('#todayList').innerHTML = list.map(r => `
      <li class="rec-item">
        <div class="body">
          <div class="t">${esc(r.task)}
            ${r.cats.map(c => `<span class="tag tag--${CAT_META[c].key}" style="font-size:9.5px;padding:1px 6px">${c.replace('类', '')}</span>`).join('')}
          </div>
          <div class="m">
            <span class="who">${esc(r.owner)}</span> · ${r.minutes} 分钟 · ≈ ¥${Math.round(r.minutes / 60 * state.rate)}
            · ${new Date(r.ts).getHours()}:${pad(new Date(r.ts).getMinutes())}
          </div>
        </div>
        <button class="del" data-del="${r.id}" title="删除" type="button">×</button>
      </li>`).join('');
  }

  /* ---------------- 周报 ---------------- */
  let reportOffset = 0;

  function buildReport(offset) {
    const [s, e] = weekRange(offset);
    const list = state.records.filter(r => r.ts >= s && r.ts < e);

    const done = list.filter(r => r.state !== 'missed');
    const momRec = done.filter(r => r.owner !== '爸爸');
    const dadRec = done.filter(r => r.owner === '爸爸');

    const momMin = momRec.reduce((a, r) => a + r.minutes, 0);
    const dadMin = dadRec.reduce((a, r) => a + r.minutes, 0);
    const totalMin = momMin + dadMin;

    const catMin = { '统筹类': 0, '情绪类': 0, '记忆类': 0, '补救类': 0 };
    momRec.forEach(r => (r.cats || []).forEach(c => { if (catMin[c] != null) catMin[c] += r.minutes / r.cats.length; }));

    const core = catMin['统筹类'] + catMin['情绪类'];
    const coreShare = momMin ? Math.round(core / momMin * 100) : 0;
    const momShare = totalMin ? Math.round(momMin / totalMin * 100) : 0;

    const offences = list.filter(r => r.state === 'missed');
    const reds = momRec.slice().sort((a, b) => b.load - a.load || b.minutes - a.minutes).slice(0, 3);

    const dow = ['一', '二', '三', '四', '五', '六', '日'];
    const sD = new Date(s), eD = new Date(e - 1);

    return {
      list, s, e, momRec, dadRec, momMin, dadMin, totalMin, catMin,
      coreShare, momShare, offences, reds,
      rangeText: `${sD.getMonth() + 1}.${pad(sD.getDate())} – ${eD.getMonth() + 1}.${pad(eD.getDate())}`,
      weekNo: `${sD.getFullYear()} 第 ${Math.ceil(((s - new Date(sD.getFullYear(), 0, 1)) / 86400000 + 1) / 7)} 周`
    };
  }

  function donutSVG(pct, colorA, colorB) {
    const r = 40, c = 2 * Math.PI * r;
    const a = Math.max(0, Math.min(100, pct)) / 100 * c;
    return `<svg class="donut" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="#F3E7DE" stroke-width="12"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="${colorA}" stroke-width="12"
        stroke-dasharray="${a.toFixed(1)} ${(c - a).toFixed(1)}" stroke-linecap="round"
        transform="rotate(-90 50 50)"/>
      <text x="50" y="47" text-anchor="middle" font-size="17" font-weight="700" fill="#2A211D">${pct}%</text>
      <text x="50" y="61" text-anchor="middle" font-size="8.5" fill="#9C8B80" letter-spacing="1">MOM</text>
    </svg>`;
  }

  function renderReport() {
    const R = buildReport(reportOffset);
    const box = $('#reportBody');

    if (!R.list.length) {
      box.innerHTML = `<div class="panel" style="text-align:center;padding:34px 18px">
        <div style="font-size:26px;opacity:.3;margin-bottom:8px">◌</div>
        <div style="font-size:13px;color:#6B5B52;margin-bottom:6px">这一周还没有数据</div>
        <div style="font-size:11.5px;color:#9C8B80;line-height:1.8">周报由台账自动生成。<br>没有记录，就没有可以被讨论的分配。</div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
          <button class="mini-btn" data-go="record" type="button">去记一笔</button>
          <button class="mini-btn" id="demoBtn2" type="button">载入一周示例</button>
        </div>
      </div>`;
      const d2 = $('#demoBtn2');
      if (d2) d2.addEventListener('click', loadDemo);
      $$('[data-go]', box).forEach(b => b.addEventListener('click', () => switchView(b.dataset.go)));
      return;
    }

    const catRows = CAT_ORDER.map(c => {
      const pct = R.momMin ? Math.round(R.catMin[c] / R.momMin * 100) : 0;
      const m = CAT_META[c];
      return `<div class="bar-row">
        <div class="bar-label"><span>${c}</span><b>${pct}%</b></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${m.color}"></div></div>
      </div>`;
    }).join('');

    const offencesHTML = R.offences.length ? R.offences.map(o => {
      const status = o.missType === 'unfound' ? '未发现' : '未完成';
      const kind = o.missType === 'unfound' ? '该发现但未发现' : '承诺后未打卡';
      return `<div class="offence">
        <div class="h">${esc(o.task)}</div>
        <div>承担者：${esc(o.owner)} · 状态：<span class="st">${status}</span> · ${kind} · ${mmdd(o.ts)}</div>
      </div>`;
    }).join('') : `<div style="font-size:12px;color:#9C8B80">本周无失职记录。</div>`;

    const redsHTML = R.reds.length ? R.reds.map((r, i) => `
      <div class="red-item"><span class="rank">${i + 1}</span>
        <span style="flex:1">${esc(r.task)}</span>
        <span style="color:#9C8B80;font-size:11px;white-space:nowrap">${r.load}★ · ${r.minutes}min</span>
      </div>`).join('') : `<div style="font-size:12px;color:#9C8B80">暂无。</div>`;

    box.innerHTML = `
      <div class="report-card" style="background:linear-gradient(150deg,#FFFBF7,#FDF3EC);border-color:#F0DFD3">
        <div style="font-size:10.5px;letter-spacing:.16em;color:#9C8B80">FAMILY INVISIBLE LABOR REPORT</div>
        <div style="font-family:'Songti SC',Georgia,serif;font-size:17px;margin-top:4px;letter-spacing:.06em">家庭隐形劳动周报</div>
        <div style="font-size:11px;color:#8A7568;margin-top:3px">${R.rangeText} · ${R.weekNo} · 数据口径：本机台账</div>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <div class="lab">妈妈 · 隐形劳动</div>
          <div class="val">${fmtHour(R.momMin)}<small>小时</small></div>
          <div class="sub">折合 ¥${fmtMoney(R.momMin / 60 * state.rate)} · ${R.momRec.length} 笔</div>
        </div>
        <div class="stat">
          <div class="lab">爸爸 · 隐形劳动</div>
          <div class="val">${fmtHour(R.dadMin)}<small>小时</small></div>
          <div class="sub">折合 ¥${fmtMoney(R.dadMin / 60 * state.rate)} · ${R.dadRec.length} 笔</div>
        </div>
        <div class="stat">
          <div class="lab">统筹 + 情绪占比</div>
          <div class="val">${R.coreShare}<small>%</small></div>
          <div class="sub">由妈妈承担的份额</div>
        </div>
        <div class="stat">
          <div class="lab">分配率</div>
          <div class="val">${R.momShare}<small>%</small></div>
          <div class="sub">妈妈 / 爸爸 ${100 - R.momShare}%</div>
        </div>
      </div>

      <div class="split-card">
        <p class="panel-title">分工结构</p>
        <div class="split-row">
          ${donutSVG(R.momShare, '#C4674F')}
          <div class="split-legend">
            <div class="lg"><span class="sw" style="background:#C4674F"></span>妈妈 <b>${fmtHour(R.momMin)} h</b></div>
            <div class="lg"><span class="sw" style="background:#E7D6CA"></span>爸爸 <b>${fmtHour(R.dadMin)} h</b></div>
            <div style="font-size:10.5px;color:#9C8B80;margin-top:8px;line-height:1.7">
              合计 ${fmtHour(R.totalMin)} 小时 · ¥${fmtMoney(R.totalMin / 60 * state.rate)}<br>
              折算标准 ¥${state.rate}/小时
            </div>
          </div>
        </div>
      </div>

      <div class="report-card">
        <h4>分类分布（妈妈）</h4>
        ${catRows}
      </div>

      <div class="report-card">
        <h4>红榜 · 高负荷承担</h4>
        ${redsHTML}
        <div style="font-size:10.5px;color:#9C8B80;margin-top:9px;padding-top:9px;border-top:1px dashed #F7EEE7;line-height:1.7">
          以上为本周心理负荷最高的三项。星数占用的不是时长，是持续的后台注意力。
        </div>
      </div>

      <div class="report-card">
        <h4>失职通报 <span style="color:#B4553F;letter-spacing:0;font-size:11px">${R.offences.length} 项</span></h4>
        ${offencesHTML}
      </div>

      <div class="final-q">
        基于以上数据，请问本周的家庭运转是否处于公平分配状态？
      </div>

      <div class="rec-actions" style="margin:12px 0 6px">
        <button class="btn btn-ghost" id="copyReport" type="button" style="flex:1;justify-content:center">复制周报文本</button>
      </div>
      <p class="hint" style="text-align:center">周报每周日 21:00 生成。不含任何情绪化词汇。</p>
    `;

    $('#copyReport').addEventListener('click', () => copyReport(R));
  }

  function reportText(R) {
    const catLines = CAT_ORDER.map(c => {
      const pct = R.momMin ? Math.round(R.catMin[c] / R.momMin * 100) : 0;
      return `  ${c}：${pct}%`;
    }).join('\n');
    const off = R.offences.length
      ? R.offences.map((o, i) => `  ${i + 1}. ${o.task}｜承担者：${o.owner}｜状态：未完成｜${o.missType === 'unfound' ? '该发现但未发现' : '承诺后未打卡'}｜${mmdd(o.ts)}`).join('\n')
      : '  无';
    return `【家庭隐形劳动周报】
${R.rangeText} · ${R.weekNo}

一、数据展示
  妈妈本周隐形劳动：${fmtHour(R.momMin)} 小时，折合人民币 ${fmtMoney(R.momMin / 60 * state.rate)} 元（${R.momRec.length} 笔）
  爸爸本周隐形劳动：${fmtHour(R.dadMin)} 小时，折合人民币 ${fmtMoney(R.dadMin / 60 * state.rate)} 元（${R.dadRec.length} 笔）
  妈妈承担统筹与情绪劳动比例：${R.coreShare}%
  分配率：妈妈 ${R.momShare}% / 爸爸 ${100 - R.momShare}%

二、分类分布（妈妈）
${catLines}

三、失职通报
${off}

四、结论性反问
  基于以上数据，请问本周的家庭运转是否处于公平分配状态？

—— 隐形账本 · 蓝诺UFO李然`;
  }

  function copyReport(R) {
    const txt = reportText(R);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => toast('周报文本已复制'),
        () => fallbackCopy(txt)
      );
    } else fallbackCopy(txt);
  }

  function fallbackCopy(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('周报文本已复制'); }
    catch (e) { toast('复制失败，请长按选择'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 示例数据 ---------------- */
  function loadDemo() {
    const s = startOfWeek(new Date()).getTime();
    const day = (n, h) => s + (n - 1) * 86400000 + h * 3600000;

    const demo = [
      { task: '日用补货预警', cats: ['统筹类'], owner: '妈妈', minutes: 20, load: 5, ts: day(1, 9), state: 'done' },
      { task: '安抚孩子情绪崩溃', cats: ['情绪类'], owner: '妈妈', minutes: 30, load: 5, ts: day(1, 20), state: 'done' },
      { task: '亲子作业统筹', cats: ['记忆类', '统筹类'], owner: '妈妈', minutes: 15, load: 4, ts: day(2, 8), state: 'done' },
      { task: '家长会与演出服补救', cats: ['补救类'], owner: '妈妈', minutes: 60, load: 4, ts: day(3, 22), state: 'done' },
      { task: '接送兴趣班', cats: ['统筹类'], owner: '爸爸', minutes: 40, load: 4, ts: day(3, 17), state: 'missed', missType: 'promise' },
      { task: '婆媳边界处理', cats: ['情绪类'], owner: '妈妈', minutes: 40, load: 5, ts: day(4, 15), state: 'done' },
      { task: '忘带水壶送一趟', cats: ['补救类'], owner: '妈妈', minutes: 25, load: 3, ts: day(5, 10), state: 'done' },
      { task: '发现洗手液用完', cats: ['补救类'], owner: '爸爸', minutes: 10, load: 2, ts: day(5, 19), state: 'missed', missType: 'unfound' },
      { task: '收拾别人的烂摊子', cats: ['补救类'], owner: '妈妈', minutes: 30, load: 4, ts: day(6, 21), state: 'done' },
      { task: '家庭日程总表', cats: ['统筹类'], owner: '妈妈', minutes: 20, load: 4, ts: day(6, 23), state: 'done' },
      { task: '周末亲子计划', cats: ['统筹类'], owner: '爸爸', minutes: 35, load: 3, ts: day(6, 9), state: 'done' },
      { task: '兴趣班排课与接送', cats: ['统筹类'], owner: '妈妈', minutes: 40, load: 4, ts: day(2, 19), state: 'done' },
      { task: '就医陪诊安排', cats: ['统筹类', '补救类'], owner: '妈妈', minutes: 90, load: 5, ts: day(4, 10), state: 'done' }
    ];

    const now = Date.now();
    demo.forEach((d, i) => {
      // 避免未来时间落进"本周"，同时错开时刻，保持列表可读
      let ts = d.ts;
      if (ts > now - 3600000) ts = now - 3600000 - i * 2400000;
      state.records.push(Object.assign({ id: uid(), raw: '示例数据' }, d, { ts }));
    });
    save();
    renderOverview(); renderToday(); renderReport();
    toast('已载入 11 笔示例数据');
  }

  /* ---------------- 语音 ---------------- */
  function initSpeech() {
    const btn = $('#micBtn');
    const label = $('#micLabel');
    const setState = (on) => {
      btn.classList.toggle('rec', on);
      if (label) label.textContent = on ? '聆听中…' : '语音';
    };

    // APK 内：WebView 不支持 Web Speech API，改用原生 SpeechRecognizer 桥
    const native = window.AndroidVoice;
    if (native) {
      let listening = false;
      window.__nativeVoiceResult = (text, isFinal) => {
        if (typeof text === 'string' && text) $('#voiceInput').value = text;
        if (isFinal) { listening = false; setState(false); }
      };
      window.__nativeVoiceError = (msg) => {
        listening = false; setState(false);
        toast(msg || '没有听清，再试一次或直接输入');
      };
      btn.addEventListener('click', () => {
        if (listening) { try { native.stop(); } catch (e) {} listening = false; setState(false); return; }
        listening = true; setState(true);
        try { native.start(); } catch (e) { listening = false; setState(false); toast('麦克风无法启动'); }
      });
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.addEventListener('click', () => toast('当前浏览器不支持语音识别，请直接输入文字'));
      return;
    }
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    let listening = false;

    rec.onstart = () => { listening = true; setState(true); };
    rec.onend = () => { listening = false; setState(false); };
    rec.onerror = () => { listening = false; setState(false); toast('没有听清，再试一次或直接输入'); };
    rec.onresult = (ev) => {
      let txt = '';
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      $('#voiceInput').value = txt;
    };

    btn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      try { rec.start(); } catch (e) { toast('麦克风无法启动'); }
    });
  }

  /* ---------------- 设置 ---------------- */
  function openSheet() {
    $('#rateInput').value = state.rate;
    $('#nameInput').value = state.name;
    $('#mask').classList.add('show');
    $('#sheet').classList.add('show');
  }
  function closeSheet() {
    $('#mask').classList.remove('show');
    $('#sheet').classList.remove('show');
  }

  /* ---------------- 首次启动隐私同意 ---------------- */
  const CONSENT_KEY = 'invisible-ledger.consent.v1';

  function initConsent() {
    const box = $('#consent');
    if (!box) return;
    let agreed = null;
    try { agreed = localStorage.getItem(CONSENT_KEY); } catch (e) {}
    if (agreed === 'agreed') { box.remove(); return; }

    const card = box.querySelector('.consent-card');
    const agreeBtn = $('#consentAgree');
    const rejectBtn = $('#consentReject');
    if (!card || !agreeBtn || !rejectBtn) { box.remove(); return; }

    agreeBtn.addEventListener('click', () => {
      try { localStorage.setItem(CONSENT_KEY, 'agreed'); } catch (e) {}
      box.remove();
    });

    // 不同意：不退出、不索取，只说明后果，并允许重新阅读
    rejectBtn.addEventListener('click', () => {
      if (card.classList.contains('rejected')) {
        card.classList.remove('rejected');
        rejectBtn.textContent = '不同意';
        agreeBtn.textContent = '同意并继续';
      } else {
        card.classList.add('rejected');
        rejectBtn.textContent = '返回阅读';
        agreeBtn.textContent = '查看并同意';
      }
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    initConsent();
    load();

    $('#rateBtn').textContent = `¥${state.rate} / 时`;
    renderChips();
    renderDict();
    renderOverview();
    renderToday();
    renderReport();
    initSpeech();

    // 导航
    $$('#tabbar button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

    // 词典交互
    $('#chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      filterCat = c.dataset.cat;
      renderChips(); renderDict();
    });

    let kwTimer;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => { keyword = e.target.value.trim(); renderDict(); }, 120);
    });

    $('#dictList').addEventListener('click', (e) => {
      const btn = e.target.closest('.add-btn');
      if (!btn) return;
      const d = DICT.find(x => x.id === btn.dataset.id);
      if (!d) return;
      state.records.push({
        id: uid(), task: d.name, cats: [d.cat], owner: '妈妈',
        minutes: d.min, load: d.load, ts: Date.now(), state: 'done', raw: '词典'
      });
      save(); renderOverview(); renderToday();
      btn.textContent = '已记 ✓';
      btn.style.color = '#6F8B7A';
      setTimeout(() => { btn.textContent = '记一笔'; btn.style.color = ''; }, 1400);
      toast(`已记一笔：${d.name} · ${d.min} 分钟`);
    });

    // 记录交互
    $('#parseBtn').addEventListener('click', () => {
      const t = $('#voiceInput').value.trim();
      if (!t) { toast('先写一句，或点右下示例'); $('#voiceInput').focus(); return; }
      renderParse(parseText(t));
    });

    $('#todayList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      state.records = state.records.filter(r => r.id !== b.dataset.del);
      save(); renderToday(); renderOverview(); renderReport();
      toast('已删除');
    });

    $('#demoBtn').addEventListener('click', loadDemo);

    $('#sampleBtn').addEventListener('click', () => {
      $('#voiceInput').value = '今天气死我了，我刚安抚完娃，又去提醒他爸明天要交幼儿园手工作业。';
      $('#voiceInput').focus();
      toast('已填入示例，点「智能拆解」看看结果');
    });

    // 周报
    $$('.week-switch button').forEach(b => b.addEventListener('click', () => {
      $$('.week-switch button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      reportOffset = Number(b.dataset.week);
      renderReport();
    }));

    // 设置
    $('#rateBtn').addEventListener('click', openSheet);
    $('#mask').addEventListener('click', closeSheet);
    $('#saveSettings').addEventListener('click', () => {
      const r = Number($('#rateInput').value);
      if (r > 0 && r < 10000) state.rate = Math.round(r);
      const n = $('#nameInput').value.trim();
      if (n) state.name = n;
      save();
      $('#rateBtn').textContent = `¥${state.rate} / 时`;
      closeSheet();
      renderDict(); renderOverview(); renderReport(); renderToday();
      toast('设置已保存');
    });

    // 清空
    $('#clearBtn').addEventListener('click', () => {
      if (!state.records.length) { toast('台账已经是空的'); return; }
      if (confirm('确定清空全部本地记录？此操作不可恢复。')) {
        state.records = [];
        save(); renderOverview(); renderToday(); renderReport();
        toast('已清空');
      }
    });

    // 周日 21:00 周报提醒（本地判断，每周一次）
    const now = new Date();
    const isSundayEvening = now.getDay() === 0 && now.getHours() >= 21;
    const wk = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (isSundayEvening && state.lastReportHint !== wk && state.records.length) {
      state.lastReportHint = wk; save();
      setTimeout(() => toast('本周周报已生成，点底部「周报」查看'), 900);
    }
  }

  // 便于自测/二次开发
  if (typeof window !== 'undefined') {
    window.__ylb = { parseText, parseSegment, buildReport, getState: () => state };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
