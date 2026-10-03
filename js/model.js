/*
 * 2056 能源分配模擬器 — 模型核心
 * 純函式，不依賴 DOM；瀏覽器中掛在 window.EnergyModel，Node 中可 require()。
 *
 * 單位說明（皆為抽象單位，用來比較制度，不代表真實數據）：
 *   pop   人口（百萬人）
 *   need  人均基本能源需求（醫療、飲水、居住、通訊、取暖…）
 *   prod  產值係數：每單位能源能產生的邊際經濟效益（有遞減效應）
 *   priority  需求制下的優先等級：3 = 最優先（醫院、災區），1 = 一般
 */
(function (root) {
  'use strict';

  const DEFAULT_REGIONS = [
    { id: 'metro',    name: '都會核心',   pop: 30, need: 1.0, prod: 3.0, priority: 1 },
    { id: 'industry', name: '工業走廊',   pop: 20, need: 1.1, prod: 2.6, priority: 1 },
    { id: 'farm',     name: '農業平原',   pop: 18, need: 0.9, prod: 1.3, priority: 1 },
    { id: 'medical',  name: '醫療樞紐',   pop: 6,  need: 2.0, prod: 1.0, priority: 3 },
    { id: 'disaster', name: '災後重建區', pop: 10, need: 1.6, prod: 0.5, priority: 3 },
    { id: 'remote',   name: '偏鄉山區',   pop: 8,  need: 1.3, prod: 0.6, priority: 2 },
    { id: 'polar',    name: '高寒聚落',   pop: 4,  need: 1.8, prod: 0.7, priority: 2 },
  ];

  const METHODS = [
    { id: 'A', name: 'A 平均制', short: '平均制' },
    { id: 'B', name: 'B 需求制', short: '需求制' },
    { id: 'C', name: 'C 效率制', short: '效率制' },
    { id: 'D', name: 'D 兩層混合制', short: '兩層混合制' },
  ];

  const EPS = 1e-9;
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const basicNeed = (r) => r.pop * r.need;

  /* ---------- 基本分配演算法 ---------- */

  /** A 平均制：每個人分一樣多 */
  function allocateEqual(regions, E) {
    const P = sum(regions.map((r) => r.pop));
    return regions.map((r) => (P > 0 ? (E * r.pop) / P : 0));
  }

  /**
   * 依優先等級填滿 targets（每區目標量）。
   * 高優先等級先填；同一等級內按目標量比例分配。回傳 [分配, 剩餘能源]。
   */
  function fillByPriority(regions, targets, E) {
    const alloc = regions.map(() => 0);
    let remaining = E;
    const tiers = [...new Set(regions.map((r) => r.priority))].sort((a, b) => b - a);
    for (const tier of tiers) {
      const idx = regions.map((r, i) => i).filter((i) => regions[i].priority === tier);
      const tierNeed = sum(idx.map((i) => targets[i]));
      if (tierNeed <= EPS) continue;
      if (remaining >= tierNeed) {
        idx.forEach((i) => (alloc[i] = targets[i]));
        remaining -= tierNeed;
      } else {
        idx.forEach((i) => (alloc[i] = (remaining * targets[i]) / tierNeed));
        remaining = 0;
        break;
      }
    }
    return [alloc, remaining];
  }

  /** B 需求制：醫院、災區、弱勢地區優先滿足基本需求；剩餘按需求比例分 */
  function allocateNeed(regions, E) {
    const needs = regions.map(basicNeed);
    const [alloc, remaining] = fillByPriority(regions, needs, E);
    const totalNeed = sum(needs);
    if (remaining > EPS && totalNeed > 0) {
      needs.forEach((n, i) => (alloc[i] += (remaining * n) / totalNeed));
    }
    return alloc;
  }

  /** 產值函數：Y = prod · pop · ln(1 + x / pop)，邊際效益遞減 */
  function output(r, x) {
    return r.pop > 0 ? r.prod * r.pop * Math.log(1 + x / r.pop) : 0;
  }

  /**
   * C 效率制：在已有分配 base 之上，把 E 分給邊際產值最高的地方，
   * 使總產值最大（等邊際原則，二分搜尋 λ）。
   */
  function allocateEfficient(regions, E, base) {
    const b = base || regions.map(() => 0);
    if (E <= EPS) return regions.map(() => 0);
    const extraAt = (lambda) =>
      regions.map((r, i) => Math.max(0, r.pop * (r.prod / lambda - 1) - b[i]));
    let lo = 1e-12;
    let hi = Math.max(...regions.map((r) => r.prod)) + 1;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (sum(extraAt(mid)) > E) lo = mid;
      else hi = mid;
    }
    const extra = extraAt(hi);
    const s = sum(extra);
    // 數值修正，確保能源守恆
    return s > 0 ? extra.map((v) => (v * E) / s) : allocateEqual(regions, E);
  }

  /**
   * D 兩層混合制（本組提案）：
   *   第一層：最低能源權 = minRight × 基本需求，以需求制優先保障，不可被實驗。
   *   第二層：剩餘過剩能源中，industryShare 比例用效率制，其餘用平均制（公共過剩能源）。
   */
  function allocateHybrid(regions, E, opts) {
    const minRight = opts.minRight;
    const industryShare = opts.industryShare;
    const floors = regions.map((r) => basicNeed(r) * minRight);
    const [layer1, surplus] = fillByPriority(regions, floors, E);
    const pub = allocateEqual(regions, surplus * (1 - industryShare));
    const base = layer1.map((v, i) => v + pub[i]);
    const ind = allocateEfficient(regions, surplus * industryShare, base);
    return {
      total: base.map((v, i) => v + ind[i]),
      layers: { layer1, public: pub, industry: ind },
    };
  }

  /* ---------- 評估指標 ---------- */

  /** 人口加權吉尼係數；values 為每區人均值 */
  function gini(values, weights) {
    const items = values.map((v, i) => ({ v, w: weights[i] })).filter((d) => d.w > 0);
    const W = sum(items.map((d) => d.w));
    const mean = sum(items.map((d) => d.v * d.w)) / W;
    if (W <= 0 || mean <= EPS) return 0;
    let acc = 0;
    for (const a of items) for (const b of items) acc += a.w * b.w * Math.abs(a.v - b.v);
    return acc / (2 * W * W * mean);
  }

  /** Lorenz 曲線點：依需求調整後人均能源由低到高排序 */
  function lorenz(regions, alloc) {
    const rows = regions
      .map((r, i) => ({ pop: r.pop, x: alloc[i], ratio: alloc[i] / Math.max(basicNeed(r), EPS) }))
      .sort((a, b) => a.ratio - b.ratio);
    const P = sum(rows.map((d) => d.pop));
    const X = sum(rows.map((d) => d.x));
    const pts = [[0, 0]];
    let cp = 0;
    let cx = 0;
    for (const d of rows) {
      cp += d.pop;
      cx += d.x;
      pts.push([cp / P, X > 0 ? cx / X : 0]);
    }
    return pts;
  }

  function evaluate(regions, alloc) {
    const needs = regions.map(basicNeed);
    const sat = alloc.map((x, i) => (needs[i] > 0 ? Math.min(1, x / needs[i]) : 1));
    const totalNeed = sum(needs);
    const met = sum(alloc.map((x, i) => Math.min(x, needs[i])));
    const unmetPop = sum(regions.map((r, i) => (sat[i] < 0.999 ? r.pop : 0)));
    const ratio = alloc.map((x, i) => x / Math.max(needs[i], EPS)); // 需求調整後人均能源
    return {
      satisfaction: totalNeed > 0 ? met / totalNeed : 1,
      worstRegion: Math.min(...sat),
      unmetPop,
      gini: gini(ratio, regions.map((r) => r.pop)),
      output: sum(regions.map((r, i) => output(r, alloc[i]))),
      perRegion: regions.map((r, i) => ({
        id: r.id,
        energy: alloc[i],
        need: needs[i],
        ratio: ratio[i],
        satisfied: sat[i],
        output: output(r, alloc[i]),
      })),
    };
  }

  /** 跑一次完整模擬 */
  function simulate(regions, params) {
    const totalNeed = sum(regions.map(basicNeed));
    const E = params.totalEnergy != null ? params.totalEnergy : totalNeed * params.energyMultiplier;
    const hybrid = allocateHybrid(regions, E, params);
    const allocs = {
      A: allocateEqual(regions, E),
      B: allocateNeed(regions, E),
      C: allocateEfficient(regions, E),
      D: hybrid.total,
    };
    const results = {};
    for (const m of METHODS) {
      results[m.id] = Object.assign(evaluate(regions, allocs[m.id]), {
        alloc: allocs[m.id],
        lorenz: lorenz(regions, allocs[m.id]),
      });
    }
    results.D.layers = hybrid.layers;
    return { E, totalNeed, results };
  }

  /* ---------- 價值權重：同一組結果，不同價值觀會選出不同「最好」 ---------- */

  const METRICS = [
    { id: 'satisfaction', name: '基本需求滿足率', better: 'high', fmt: 'pct' },
    { id: 'worstRegion',  name: '最差地區滿足率', better: 'high', fmt: 'pct' },
    { id: 'gini',         name: '不平等（吉尼係數）', better: 'low', fmt: 'num3' },
    { id: 'output',       name: '總經濟產值', better: 'high', fmt: 'num1' },
  ];

  const VALUE_PRESETS = {
    efficiency: { name: '效率優先', weights: { satisfaction: 1, worstRegion: 0, gini: 0, output: 6 } },
    equality:   { name: '平等優先', weights: { satisfaction: 1, worstRegion: 1, gini: 6, output: 0 } },
    security:   { name: '保障優先', weights: { satisfaction: 3, worstRegion: 6, gini: 1, output: 1 } },
    balanced:   { name: '均衡',     weights: { satisfaction: 2, worstRegion: 2, gini: 2, output: 2 } },
  };

  /** 每個指標在各制度間做 min-max 正規化到 0–100，再依權重加總 */
  function score(results, weights, methodIds) {
    const ids = methodIds || METHODS.map((m) => m.id);
    const norm = {};
    for (const met of METRICS) {
      const vals = ids.map((id) => results[id][met.id]);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      norm[met.id] = {};
      ids.forEach((id) => {
        const v = results[id][met.id];
        let n = hi - lo < 1e-9 ? 100 : ((v - lo) / (hi - lo)) * 100;
        if (met.better === 'low') n = 100 - n;
        norm[met.id][id] = n;
      });
    }
    const W = sum(METRICS.map((m) => weights[m.id] || 0));
    const scores = {};
    ids.forEach((id) => {
      scores[id] = W > 0 ? sum(METRICS.map((m) => (weights[m.id] || 0) * norm[m.id][id])) / W : 0;
    });
    const ranking = [...ids].sort((a, b) => scores[b] - scores[a]);
    return { scores, ranking, norm };
  }

  /* ---------- 個人視角：我分到多少、從哪來、能自由支配多少 ---------- */

  /** 職業：決定能分到多少「產業能源（效率制）」——產業能源透過工作取得 */
  const OCCUPATIONS = [
    { id: 'industry', name: '產業／製造業', weight: 2.0 },
    { id: 'general',  name: '服務業／一般工作', weight: 1.0 },
    { id: 'public',   name: '公共服務（醫療、教育）', weight: 1.0 },
    { id: 'none',     name: '學生／退休／待業', weight: 0.5 },
  ];

  /** 特殊需求：提高個人的基本能源需求（以人均需求單位加計） */
  const SPECIAL_NEEDS = [
    { id: 'lifeSupport', name: '維生醫療設備（e.g.洗腎、呼吸器）', extra: 1.5 },
    { id: 'mobility',    name: '高齡或行動不便', extra: 0.4 },
    { id: 'infant',      name: '照顧嬰幼兒', extra: 0.3 },
  ];

  /**
   * 計算某個人在四種制度下分到的能源。
   * 假設：個人資料不改變地區總量（一個人相對全體可忽略），只決定這個人在地區內分到的份額。
   *   需求制部分 → 依「個人基本需求」等比例分（特殊需求會被照顧）
   *   平均制部分 → 地區人均
   *   效率制部分 → 地區人均 × 職業係數（產業工作者分得多）
   * profile: { regionId, occupation, special: [id...] }
   */
  function personal(regions, sim, profile) {
    const i = Math.max(0, regions.findIndex((r) => r.id === profile.regionId));
    const r = regions[i];
    const occ = OCCUPATIONS.find((o) => o.id === profile.occupation) || OCCUPATIONS[1];
    const extra = sum(SPECIAL_NEEDS.filter((s) => (profile.special || []).includes(s.id)).map((s) => s.extra));
    const myNeed = r.need + extra;
    const regionNeed = basicNeed(r);
    const perNeed = (x) => (regionNeed > 0 ? (x / regionNeed) * myNeed : 0);
    const perCap = (x) => (r.pop > 0 ? x / r.pop : 0);
    const R = sim.results;
    const L = R.D.layers;

    const sources = {
      A: { equal: perCap(R.A.alloc[i]), need: 0, efficiency: 0 },
      B: { equal: 0, need: perNeed(R.B.alloc[i]), efficiency: 0 },
      C: { equal: 0, need: 0, efficiency: perCap(R.C.alloc[i]) * occ.weight },
      D: { equal: perCap(L.public[i]), need: perNeed(L.layer1[i]), efficiency: perCap(L.industry[i]) * occ.weight },
    };
    const out = { region: r, regionIndex: i, occupation: occ, myNeed, extraNeed: extra, methods: {} };
    for (const id of Object.keys(sources)) {
      const s = sources[id];
      const total = s.equal + s.need + s.efficiency;
      out.methods[id] = {
        sources: s,
        total,
        basicUse: Math.min(total, myNeed),          // 必須用在基本需求的部分
        disposable: Math.max(0, total - myNeed),    // 可自由支配的額度
        shortfall: Math.max(0, myNeed - total),     // 基本需求缺口
      };
    }
    return out;
  }

  const EnergyModel = {
    DEFAULT_REGIONS, METHODS, METRICS, VALUE_PRESETS, OCCUPATIONS, SPECIAL_NEEDS,
    basicNeed, output, gini, lorenz, evaluate, simulate, score, personal,
    allocateEqual, allocateNeed, allocateEfficient, allocateHybrid,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = EnergyModel;
  else root.EnergyModel = EnergyModel;
})(typeof window !== 'undefined' ? window : globalThis);
