/*
 * 介面邏輯：讀取個人資料 → 執行模型 → 更新我的能源
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

  const state = {
    regions: clone(M.DEFAULT_REGIONS),
    live: {
      profile: { regionId: 'remote', occupation: 'general', special: [] },
      used: null,           // null = 自動等於基本需求
    },
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
    return { c, me, used, base, total, L: M.ledger(total, used, {}) };
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const r = compute();
    renderInputs(r);
    renderMe(r);
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
      ? `<div class="stat bad"><div class="stat-label">剩餘額度</div><div class="stat-value">−${u(L.overuse)}<small>單位</small></div><div class="stat-sub">已超用</div></div>`
      : `<div class="stat free"><div class="stat-label">剩餘額度</div><div class="stat-value">${u(L.remaining)}<small>單位</small></div><div class="stat-sub"></div></div>`;
    $('meStats').innerHTML = `
      <div class="stat"><div class="stat-label">我分配到的總額</div><div class="stat-value">${u(L.total)}<small>單位</small></div><div class="stat-sub">${totalSub}</div></div>
      <div class="stat used"><div class="stat-label">已用額度</div><div class="stat-value">${u(L.used)}<small>單位</small></div><div class="stat-sub"></div></div>
      ${third}`;

    const xMax = Math.max(L.available, L.used) * 1.05 || 1;
    const srcSegs = [
      { name: '分配額度', value: base, color: 'var(--alloc)' },
    ];
    const useSegs = [
      { name: '已用額度', value: Math.min(L.used, L.available), color: 'var(--use-basic)' },
      { name: '剩餘額度', value: L.remaining, color: 'var(--use-free)' },
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

  /* ---------- 其他事件 ---------- */
  const live = () => state.live;
  $('myRegion').addEventListener('input', (e) => { live().profile.regionId = e.target.value; render(); });
  $('myOccupation').addEventListener('input', (e) => { live().profile.occupation = e.target.value; render(); });
  $('mySpecial').addEventListener('change', () => {
    live().profile.special = [...document.querySelectorAll('#mySpecial input:checked')].map((c) => c.value);
    render();
  });
  $('myUsed').addEventListener('input', (e) => { live().used = +e.target.value; render(); });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });

  buildProfile();
  render();
})();
