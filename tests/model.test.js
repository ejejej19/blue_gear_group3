// 執行：node tests/model.test.js
const assert = require('assert');
const M = require('../js/model.js');

const regions = M.DEFAULT_REGIONS;
const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

for (const mult of [0.5, 0.9, 1.0, 1.5, 3.0]) {
  const params = { energyMultiplier: mult, minRight: 1.0, industryShare: 0.5 };
  const { E, results } = M.simulate(regions, params);
  console.log(`能源總量 = ${mult}× 基本需求`);

  test('四種制度都守恆（分配總和 = 能源總量）且不為負', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const s = results[id].alloc.reduce((a, b) => a + b, 0);
      assert(close(s, E, 1e-6), `${id}: ${s} vs ${E}`);
      assert(results[id].alloc.every((x) => x >= -1e-9), `${id} 有負值`);
    }
  });

  test('效率制總產值最高', () => {
    for (const id of ['A', 'B', 'D']) assert(results.C.output >= results[id].output - 1e-6, id);
  });

  test('需求制的基本需求滿足率最高', () => {
    for (const id of ['A', 'C', 'D']) assert(results.B.satisfaction >= results[id].satisfaction - 1e-9, id);
  });

  if (mult >= 1) {
    test('能源足夠時，需求制與兩層制（最低權=100%）都滿足所有基本需求', () => {
      assert(close(results.B.worstRegion, 1));
      assert(close(results.D.worstRegion, 1));
    });
  }

  test('平均制下人均能源相同', () => {
    const per = results.A.alloc.map((x, i) => x / regions[i].pop);
    per.forEach((p) => assert(close(p, per[0])));
  });
}

test('吉尼係數：完全平均為 0', () => {
  assert(close(M.gini([1, 1, 1], [1, 2, 3]), 0));
});

test('價值權重會改變排名（效率優先 vs 保障優先）', () => {
  const { results } = M.simulate(regions, { energyMultiplier: 1.5, minRight: 1, industryShare: 0.5 });
  const eff = M.score(results, M.VALUE_PRESETS.efficiency.weights).ranking[0];
  const sec = M.score(results, M.VALUE_PRESETS.security.weights).ranking[0];
  assert.notStrictEqual(eff, sec);
  console.log(`    效率優先 → ${eff}，保障優先 → ${sec}`);
});

console.log('個人視角');
{
  const sim = M.simulate(regions, { energyMultiplier: 1.5, minRight: 1, industryShare: 0.5 });
  const base = { regionId: 'remote', occupation: 'general', special: [] };
  const me = M.personal(regions, sim, base);
  const sick = M.personal(regions, sim, { ...base, special: ['lifeSupport'] });

  test('一般人在需求制下的分配 = 地區人均', () => {
    const r = regions.find((x) => x.id === 'remote');
    const i = regions.indexOf(r);
    assert(close(me.methods.B.total, sim.results.B.alloc[i] / r.pop));
  });

  test('可支配 + 基本用途 = 總量（無缺口時）', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const m = me.methods[id];
      assert(close(m.basicUse + m.disposable, m.total));
      assert(close(m.basicUse + m.shortfall, me.myNeed));
    }
  });

  test('特殊需求：需求制與兩層制會照顧，平均制與效率制不會', () => {
    assert(sick.myNeed > me.myNeed);
    assert(sick.methods.B.total > me.methods.B.total);
    assert(sick.methods.D.total > me.methods.D.total);
    assert(close(sick.methods.A.total, me.methods.A.total));
    assert(close(sick.methods.C.total, me.methods.C.total));
  });

  test('兩層制：能源足夠時，最低能源權完全覆蓋個人基本需求', () => {
    assert(sick.methods.D.sources.need >= sick.myNeed - 1e-9);
    assert(close(sick.methods.D.shortfall, 0));
  });

  test('職業只影響效率制（產業能源）的部分', () => {
    // 偏鄉產值低，效率制不分產業能源給它，所以用都會核心比較
    const me = M.personal(regions, sim, { ...base, regionId: 'metro' });
    const worker = M.personal(regions, sim, { ...base, regionId: 'metro', occupation: 'industry' });
    assert(worker.methods.D.sources.efficiency > me.methods.D.sources.efficiency);
    assert(close(worker.methods.D.sources.need, me.methods.D.sources.need));
    assert(close(worker.methods.A.total, me.methods.A.total));
  });
}

console.log('額度帳本');
test('總額 = 制度分配（購買、回收都不改變）；剩餘 = 總額 + 已購買 − 已用 − 已回收', () => {
  const l = M.ledger(2, 1.2, { bought: 0.5, recycled: 0.3 });
  assert(close(l.total, 2));
  assert(close(l.available, 2.5));
  assert(close(l.remaining, 1.0));
  assert(close(l.overuse, 0));
});
test('超用時剩餘為 0、顯示超用量', () => {
  const l = M.ledger(1, 1.5, {});
  assert(close(l.remaining, 0));
  assert(close(l.overuse, 0.5));
});
test('收入與支出：回收 × 回收價、購買 × 購買價', () => {
  const l = M.ledger(1, 0, { bought: 1, recycled: 2 });
  assert(close(l.earned, 2 * M.TRADE.recyclePrice));
  assert(close(l.spent, M.TRADE.buyPrice));
});
test('回收額度 > 剩餘額度 → 回收失敗，紀錄不變', () => {
  const L = M.ledger(2, 1.5, {});            // 剩餘 0.5
  const r = M.trade('recycle', 0.8, L);
  assert(!r.ok);
  assert.strictEqual(r.message, '回收失敗，剩餘額度不足');
  assert(close(r.trades.recycled, 0));
});
test('回收額度 ≤ 剩餘額度 → 成功，從剩餘額度扣除', () => {
  const L = M.ledger(2, 1.5, {});
  const r = M.trade('recycle', 0.5, L);
  assert(r.ok && r.message.startsWith('成功回收'));
  const after = M.ledger(2, 1.5, r.trades);
  assert(close(after.remaining, 0));
  assert(close(after.total, 2));       // 總額不變
  assert(close(after.recycled, 0.5));
});
test('購買 → 成功，累計到已購買額度，總額不變、剩餘增加', () => {
  const L = M.ledger(2, 1.5, {});
  const r = M.trade('buy', 0.3, L);   // 3 元，在初始金額內
  assert(r.ok && r.message.startsWith('成功購買'));
  const after = M.ledger(2, 1.5, r.trades);
  assert(close(after.total, 2));
  assert(close(after.bought, 0.3));
  assert(close(after.remaining, 0.8));
});
test('回收後再購買：剩餘額度 = 總額 − 已用 − 已回收', () => {
  const l = M.ledger(2, 1, { recycled: 0.4, bought: 0.3 });
  assert(close(l.total, 2));
  assert(close(l.remaining, 0.9));
});
test('擁有金額：初始金額 + 回收收入 − 購買支出', () => {
  const l = M.ledger(2, 0, { recycled: 1, bought: 0.5 });
  assert(close(l.balance, M.TRADE.startBalance + M.TRADE.recyclePrice - 0.5 * M.TRADE.buyPrice));
});
test('購買總價 > 擁有金額 → 警告並不執行', () => {
  const L = M.ledger(2, 0, {});
  const tooMuch = M.TRADE.startBalance / M.TRADE.buyPrice + 0.1;
  const r = M.trade('buy', tooMuch, L);
  assert(!r.ok);
  assert.strictEqual(r.message, '擁有金額不足，請先儲值或降低購買額度');
  assert(close(r.trades.bought, 0));
  assert(M.trade('buy', M.TRADE.startBalance / M.TRADE.buyPrice, L).ok); // 剛好買得起
});
test('儲值：增加擁有金額，之後就買得起', () => {
  const L = M.ledger(2, 0, {});
  assert(!M.trade('buy', 1, L).ok);                 // 10 元 > 5 元
  const d = M.trade('deposit', 20, L);
  assert(d.ok && d.message.startsWith('成功儲值'));
  const after = M.ledger(2, 0, d.trades);
  assert(close(after.balance, M.TRADE.startBalance + 20));
  assert(M.trade('buy', 1, after).ok);
  assert(!M.trade('deposit', 0, L).ok);
});
test('下一個月：購買額度的一半變成額外需求，其他額度歸零，金額保留', () => {
  const L = M.ledger(2, 1.2, { bought: 0.4, recycled: 0.1, deposited: 10 });
  const n = M.nextMonth(L);
  assert(close(n.extra, 0.2));
  assert.strictEqual(n.used, 0);
  const next = M.ledger(2 + n.extra, n.used, n.trades);
  assert(close(next.total, 2.2));
  assert(close(next.bought, 0) && close(next.recycled, 0) && close(next.deposited, 0));
  assert(close(next.balance, L.balance));          // 擁有金額帶到下個月
  assert(close(next.remaining, 2.2));
});
test('額外需求逐月累加：第 1 月買 1 → +0.5；第 2 月再買 1 → 共 +1；第 3 月沒買 → 維持 +1', () => {
  const base = 1.6;
  let extra = 0;
  let L = M.ledger(base + extra, 0, { bought: 1 });
  extra = M.nextMonth(L, extra).extra;
  assert(close(extra, 0.5));
  L = M.ledger(base + extra, 0, { bought: 1 });
  extra = M.nextMonth(L, extra).extra;
  assert(close(extra, 1));
  L = M.ledger(base + extra, 0, {});
  extra = M.nextMonth(L, extra).extra;
  assert(close(extra, 1));
});
test('輸入 0 或非數字 → 不執行', () => {
  const L = M.ledger(2, 1.5, {});
  assert(!M.trade('buy', 0, L).ok);
  assert(!M.trade('recycle', 'abc', L).ok);
});

console.log(`\n全部 ${passed} 項測試通過`);
