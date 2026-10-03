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

console.log(`\n全部 ${passed} 項測試通過`);
