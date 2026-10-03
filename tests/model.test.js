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

console.log(`\n全部 ${passed} 項測試通過`);
