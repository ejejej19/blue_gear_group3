/*
 * 介面邏輯：讀取個人資料 → 執行模型 → 更新我的能源與額度交易
 */
(function () {
  'use strict';

  const M = window.EnergyModel;
  const $ = (id) => document.getElementById(id);

  // 固定情境：能源過剩 1.5 倍；D 制度最低能源權 100%、過剩能源一半給產業
  const SCENARIO = { energyMultiplier: 1.5, minRight: 1, industryShare: 0.5 };
  // 固定使用 D 兩層混合制
  const METHOD = 'D';
  const NOTE = '兩層混合制：最低能源權先保障你的基本需求（含特殊需求）；剩下的公共能源人人平分，產業能源透過工作取得。';

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const u = (v) => v.toFixed(2);
  const money = (v) => v.toFixed(2) + ' 元';

  const state = {
    regions: clone(M.DEFAULT_REGIONS),
    live: {
      profile: { regionId: 'remote', occupation: 'general', special: [] },
      used: null,           // null = 自動等於基本需求
      trades: { bought: 0, recycled: 0, deposited: 0 },
    },
    mode: null,             // 'recycle' | 'buy'
    msg: null,              // { mode, ok, text } 儲值結果（顯示在儲值面板）
    tradeMsg: null,         // { ok, text } 回收／購買結果（顯示在「額度交易」標題旁）
  };

  const cur = () => state.live;

  /* ---------- 建立輸入 ---------- */
  function buildProfile() {
    $('myRegion').innerHTML = state.regions.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    $('myOccupation').innerHTML = M.OCCUPATIONS.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
    $('mySpecial').innerHTML = M.SPECIAL_NEEDS.map((n) =>
      `<label><input type="checkbox" value="${n.id}" />${n.name}<span class="extra">+${n.extra}</span></label>`).join('');
  }

  /* ---------- 計算 ---------- */
  function compute() {
    const c = cur();
    const sim = M.simulate(state.regions, SCENARIO);
    const me = M.personal(state.regions, sim, c.profile);
    const m = me.methods[METHOD];
    // 分配額度取到小數兩位，讓畫面顯示的剩餘額度與回收檢查一致
    const base = Math.round(m.total * 100) / 100;
    const total = base;
    // 已用額度上限 = 我分配到的總額
    const used = Math.min(c.used == null ? me.myNeed : c.used, total);
    return { c, me, used, base, total, L: M.ledger(total, used, c.trades) };
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const r = compute();
    renderInputs(r);
    renderMe(r);
    renderTrade(r.L);
  }

  function renderInputs({ c, me, used, total }) {
    $('myRegion').value = c.profile.regionId;
    $('myOccupation').value = c.profile.occupation;
    document.querySelectorAll('#mySpecial input').forEach((cb) => { cb.checked = c.profile.special.includes(cb.value); });
    const slider = $('myUsed');
    slider.max = total;
    slider.value = used;
    $('usedOut').textContent = u(used);
    const cap = `上限為我分配到的總額 ${u(total)}。`;
    $('usedHint').textContent = c.used == null
      ? `預設等於你的基本需求 ${u(me.myNeed)}，${cap}`
      : `你的基本需求是 ${u(me.myNeed)}，${cap}`;
  }

  function renderMe({ c, me, base, L }) {
    const totalSub = `${me.region.name} · ${me.occupation.name}`;

    const third = L.overuse > 1e-6
      ? `<div class="stat bad"><div class="stat-label">剩餘額度</div><div class="stat-value">−${u(L.overuse)}<small>單位</small></div><div class="stat-sub">已超用，可購買額外額度</div></div>`
      : `<div class="stat free"><div class="stat-label">剩餘額度</div><div class="stat-value">${u(L.remaining)}<small>單位</small></div><div class="stat-sub"></div></div>`;
    $('meStats').innerHTML = `
      <div class="stat"><div class="stat-label">我分配到的總額</div><div class="stat-value">${u(L.total)}<small>單位</small></div><div class="stat-sub">${totalSub}</div></div>
      <div class="stat used"><div class="stat-label">已用額度</div><div class="stat-value">${u(L.used)}<small>單位</small></div><div class="stat-sub"></div></div>
      <div class="stat bought"><div class="stat-label">已購買額度</div><div class="stat-value">${u(L.bought)}<small>單位</small></div><div class="stat-sub">${L.bought > 0 ? `支付 ${money(L.spent)}` : '尚未購買'}</div></div>
      ${third}
      <div class="stat recycled"><div class="stat-label">已回收額度</div><div class="stat-value">${u(L.recycled)}<small>單位</small></div><div class="stat-sub">${L.recycled > 0 ? `獲得 ${money(L.earned)}` : '尚未回收'}</div></div>`;

    const xMax = Math.max(L.available, L.used) * 1.05 || 1;
    const srcSegs = [
      { name: '分配額度', value: base, color: 'var(--alloc)' },
      { name: '購買的額度', value: L.bought, color: 'var(--buy)' },
    ];
    const useSegs = [
      { name: '已用額度', value: Math.min(L.used, L.available), color: 'var(--use-basic)' },
      { name: '剩餘額度', value: L.remaining, color: 'var(--use-free)' },
      { name: '已回收', value: Math.min(L.recycled, Math.max(0, L.available - L.used)), dashed: true, dashColor: 'var(--text-muted)' },
      { name: '超用', value: L.overuse, dashed: true },
    ];
    Charts.personalBars($('meChart'), {
      rows: [{ label: '來源', segments: srcSegs }, { label: '使用', segments: useSegs }],
      xMax,
      segTip: (ri, seg) => `<div class="tt-title">${seg.name}</div><div>${u(seg.value)} 單位</div>`,
    });

    const item = (s) => s.value > 1e-6
      ? `<span class="it"><span class="swatch${s.dashed ? ' dash' : ''}" style="${s.dashed ? `border-color:${s.dashColor || 'var(--critical)'}` : `background:${s.color}`}"></span>${s.name} <b>${u(s.value)}</b></span>` : '';
    $('meLegend').innerHTML = `
      <span class="lg-group"><span class="lg-title">來源</span>${srcSegs.map(item).join('')}</span>
      <span class="lg-group"><span class="lg-title">使用</span>${useSegs.map(item).join('')}</span>`;
    $('meNote').textContent = NOTE;
  }

  function renderTrade(L) {
    const T = M.TRADE;
    // 右上角：擁有金額（回收增加、購買減少）
    $('balance').innerHTML = `${L.balance.toFixed(2)}<small>元</small>`;
    renderMsg('deposit');

    document.querySelectorAll('input[name="tradeMode"]').forEach((r) => {
      r.checked = r.value === state.mode;
      r.closest('.option').classList.toggle('selected', r.checked);
    });

    // 回收：顯示目前剩餘額度與回收總價
    const rAmt = parseFloat($('recycleAmt').value) || 0;
    $('recycleAvail').textContent = `剩餘額度 ${u(L.remaining)} 單位`;
    $('recycleCalc').innerHTML =
      `<span>回收總價</span><span class="formula">${u(rAmt)} × ${money(T.recyclePrice)} = <b>${money(rAmt * T.recyclePrice)}</b></span>`;

    // 購買：顯示擁有金額可買的上限與購買總價
    const bAmt = parseFloat($('buyAmt').value) || 0;
    $('buyAvail').textContent = `最多可購買 ${u(Math.floor((L.balance / T.buyPrice) * 100 + 1e-9) / 100)} 單位`;
    $('buyCalc').innerHTML =
      `<span>購買總價</span><span class="formula">${u(bAmt)} × ${money(T.buyPrice)} = <b>${money(bAmt * T.buyPrice)}</b></span>`;


    const log = [];
    if (L.recycled > 0) log.push(`已回收 ${u(L.recycled)} 單位（+${money(L.earned)}）`);
    if (L.bought > 0) log.push(`已購買 ${u(L.bought)} 單位（−${money(L.spent)}）`);
    if (L.deposited > 0) log.push(`已儲值 ${money(L.deposited)}`);
    $('tradeSummary').textContent = log.join('　');

    // 回收／購買結果提示
    const tm = $('tradeMsg');
    tm.hidden = !state.tradeMsg;
    if (state.tradeMsg) {
      tm.className = 'trade-msg ' + (state.tradeMsg.ok ? 'ok' : 'fail');
      tm.title = state.tradeMsg.text;
      tm.innerHTML = `<span class="icon">${state.tradeMsg.ok ? '✓' : '✕'}</span><span class="text">${state.tradeMsg.text}</span>`;
    }
    $('resetTrade').hidden = !log.length;
  }

  function renderMsg(mode) {
    const box = $(mode + 'Msg');
    const msg = state.msg && state.msg.mode === mode ? state.msg : null;
    box.hidden = !msg;
    if (msg) {
      box.className = 'alert ' + (msg.ok ? 'ok' : 'fail');
      box.innerHTML = `<span class="icon">${msg.ok ? '✓' : '✕'}</span><span>${msg.text}</span>`;
    }
  }

  /** 按下「確定回收／確定購買／確定儲值」：交給模型檢查，成功才寫入紀錄 */
  function confirmTrade(mode) {
    const input = $(mode + 'Amt');
    const { L } = compute();
    const r = M.trade(mode, input.value, L);
    // 回收、購買的結果顯示在「額度交易」標題旁；儲值結果顯示在儲值面板內
    if (mode === 'deposit') state.msg = { mode, ok: r.ok, text: r.message };
    else state.tradeMsg = { ok: r.ok, text: r.message };
    if (r.ok) {
      state.live.trades = r.trades;
      input.value = '';
    }
    render();
  }

  /* ---------- 其他事件 ---------- */
  const live = () => state.live;
  $('myRegion').addEventListener('input', (e) => { live().profile.regionId = e.target.value; render(); });
  $('myOccupation').addEventListener('input', (e) => { live().profile.occupation = e.target.value; render(); });
  $('mySpecial').addEventListener('change', () => {
    live().profile.special = [...document.querySelectorAll('#mySpecial input:checked')].map((c) => c.value);
    render();
  });
  $('myUsed').addEventListener('input', (e) => { live().used = +e.target.value; render(); });

  document.querySelectorAll('input[name="tradeMode"]').forEach((r) =>
    r.addEventListener('change', () => { state.mode = r.value; state.tradeMsg = null; render(); }));
  ['recycleAmt', 'buyAmt'].forEach((id) => {
    const mode = id === 'recycleAmt' ? 'recycle' : 'buy';
    $(id).addEventListener('input', () => { state.tradeMsg = null; render(); });
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmTrade(mode); });
  });
  $('confirmRecycle').addEventListener('click', () => confirmTrade('recycle'));
  $('confirmBuy').addEventListener('click', () => confirmTrade('buy'));

  // 儲值面板
  function toggleDeposit(open) {
    $('depositPanel').hidden = !open;
    $('depositBtn').setAttribute('aria-expanded', open);
    if (open) $('depositAmt').focus();
    else if (state.msg && state.msg.mode === 'deposit') { state.msg = null; render(); }
  }
  $('depositBtn').addEventListener('click', () => toggleDeposit($('depositPanel').hidden));
  $('depositClose').addEventListener('click', () => toggleDeposit(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('depositPanel').hidden) toggleDeposit(false); });
  document.addEventListener('click', (e) => {
    if (!$('depositPanel').hidden && !e.target.closest('.wallet-box')) toggleDeposit(false);
  });
  $('depositQuick').addEventListener('click', (e) => {
    const v = e.target.dataset.v;
    if (!v) return;
    $('depositAmt').value = (parseFloat($('depositAmt').value) || 0) + +v;
    if (state.msg && state.msg.mode === 'deposit') { state.msg = null; render(); }
  });
  $('depositAmt').addEventListener('input', () => { if (state.msg && state.msg.mode === 'deposit') { state.msg = null; render(); } });
  $('depositAmt').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmTrade('deposit'); });
  $('confirmDeposit').addEventListener('click', () => confirmTrade('deposit'));

  $('resetTrade').addEventListener('click', () => {
    live().trades = { bought: 0, recycled: 0, deposited: 0 };
    state.msg = null;
    state.tradeMsg = null;
    render();
  });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });

  buildProfile();
  render();
})();
