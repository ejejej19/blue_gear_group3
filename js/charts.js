/*
 * 簡易 SVG 圖表（不依賴外部函式庫，可離線使用）
 */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      // CSS 變數要放在 style 中才能在 SVG 生效（支援深色模式）
      if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) node.style[k] = v;
      else node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function text(parent, x, y, str, attrs) {
    const t = el('text', Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }

  /** 水平長條：左端貼齊基線，右端 4px 圓角 */
  function hBarPath(x, y, w, h, r) {
    if (w <= 0) return '';
    const rr = Math.min(r, w, h / 2);
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }

  /* ---------- tooltip ---------- */
  function showTip(evt, html) {
    const t = document.getElementById('tooltip');
    t.innerHTML = html;
    t.hidden = false;
    const pad = 14;
    const rect = t.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  function hideTip() { document.getElementById('tooltip').hidden = true; }

  /**
   * 個人堆疊條：多列（來源／用途）共用同一刻度。
   * rows: [{ label, segments: [{ name, value, color, dashed? }] }]
   * ref: { value, label } 垂直參考線（我的基本需求）
   * segTip(rowIdx, seg) 回傳 tooltip HTML
   */
  function personalBars(container, { rows, xMax, ref, segTip }) {
    container.innerHTML = '';
    const W = Math.max(container.clientWidth || 760, 300);
    const left = 44;
    const right = 16;
    const top = ref ? 22 : 8; // 有參考線時留空間給標籤
    const barH = 26;
    const rowH = 40;
    const plotBottom = top + rows.length * rowH;
    const H = plotBottom + 22;
    const xs = (v) => left + (v / xMax) * (W - left - right);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '我的能源組成' }, container);

    const step = niceStep(xMax, W < 560 ? 4 : 8);
    for (let v = 0; v <= xMax + 1e-9; v += step) {
      el('line', { x1: xs(v), x2: xs(v), y1: top - 4, y2: plotBottom, class: 'grid-line' }, svg);
      text(svg, xs(v), plotBottom + 16, +v.toFixed(2) + '', { 'text-anchor': 'middle' });
    }

    rows.forEach((row, ri) => {
      const y = top + ri * rowH + (rowH - barH) / 2;
      text(svg, 0, y + barH / 2 + 4, row.label, { class: 'label-strong' });
      const solid = row.segments.filter((s) => !s.dashed && s.value > 1e-6);
      let acc = 0;
      row.segments.forEach((s) => {
        if (s.value <= 1e-6) return;
        const isLastSolid = s === solid[solid.length - 1];
        const x0 = xs(acc) + (acc > 0 ? 1 : 0); // 2px 表面色間隙
        const x1 = xs(acc + s.value) - (isLastSolid || s.dashed ? 0 : 1);
        const w = Math.max(0, x1 - x0);
        let node;
        if (s.dashed) {
          node = el('rect', { x: x0 + 0.75, y: y + 0.75, width: Math.max(0, w - 1.5), height: barH - 1.5, rx: 4,
            fill: 'none', stroke: s.dashColor || 'var(--critical)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
        } else if (isLastSolid) {
          node = el('path', { d: hBarPath(x0, y, w, barH, 4), fill: s.color }, svg);
        } else {
          node = el('rect', { x: x0, y, width: w, height: barH, fill: s.color }, svg);
        }
        // 較大的 hover 區域
        const hit = el('rect', { x: x0, y: y - 4, width: Math.max(w, 6), height: barH + 8, class: 'hit' }, svg);
        hit.addEventListener('mousemove', (e) => showTip(e, segTip(ri, s)));
        hit.addEventListener('mouseleave', hideTip);
        acc += s.value;
      });
    });

    el('line', { x1: left, x2: left, y1: top - 4, y2: plotBottom, class: 'axis-line' }, svg);
    if (ref) {
      const x = xs(ref.value);
      el('line', { x1: x, x2: x, y1: top - 6, y2: plotBottom, class: 'ref-line', 'pointer-events': 'none' }, svg);
      const anchor = x > W - 120 ? 'end' : x < left + 60 ? 'start' : 'middle';
      text(svg, x, top - 10, ref.label, { 'text-anchor': anchor, 'font-size': 11 });
    }
  }

  function niceStep(max, ticks) {
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  root.Charts = { personalBars };
})(window);
