'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findCriticalLinks } = require('../server/criticalLinks');

/** 测试辅助：批量建成员；条目为 [id, name] 或字符串（id 与姓名相同） */
function makeState(entries) {
  const state = { maxMembers: 30, members: [], parentsOf: {} };
  for (const entry of entries) {
    const [id, name] = Array.isArray(entry) ? entry : [entry, entry];
    state.members.push({ id, name, birthday: null, deathday: null });
    state.parentsOf[id] = [];
  }
  return state;
}

function add(state, parent, child) {
  state.parentsOf[child].push(parent);
}

/** 按「父母→子女」关系取桥梁结果，找不到则失败 */
function bridgeOf(result, parent, child) {
  const hit = result.bridges.find((b) => b.parentId === parent && b.childId === child);
  assert.ok(hit, `桥梁关系中应包含 ${parent} → ${child}`);
  return hit;
}

test('关键连接：空谱返回空状态', () => {
  const r = findCriticalLinks(makeState([]));
  assert.equal(r.empty, true);
  assert.equal(r.memberCount, 0);
  assert.equal(r.edgeCount, 0);
  assert.equal(r.componentCount, 0);
  assert.deepEqual(r.bridges, []);
});

test('关键连接：单条关系就是桥梁，两侧各含端点本人', () => {
  const state = makeState(['甲', '乙']);
  add(state, '甲', '乙');
  const r = findCriticalLinks(state);
  assert.equal(r.empty, false);
  assert.equal(r.componentCount, 1);
  assert.equal(r.bridges.length, 1);
  const b = r.bridges[0];
  assert.equal(b.parentId, '甲');
  assert.equal(b.childId, '乙');
  assert.deepEqual(b.parentSide, ['甲']);
  assert.deepEqual(b.childSide, ['乙']);
});

test('关键连接：链式家族中每条关系都是桥梁，断开后两侧人数正确', () => {
  const state = makeState(['A', 'B', 'C', 'D']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'C', 'D');
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 1);
  assert.equal(r.bridges.length, 3);
  // 断开 A→B：A 一侧 1 人，B 一侧含 B、C、D
  const ab = bridgeOf(r, 'A', 'B');
  assert.deepEqual(ab.parentSide, ['A']);
  assert.deepEqual(ab.childSide, ['B', 'C', 'D']);
  // 断开 B→C：上游 A、B，下游 C、D
  const bc = bridgeOf(r, 'B', 'C');
  assert.deepEqual(bc.parentSide, ['A', 'B']);
  assert.deepEqual(bc.childSide, ['C', 'D']);
  // 断开 C→D：D 被单独分开
  const cd = bridgeOf(r, 'C', 'D');
  assert.deepEqual(cd.parentSide, ['A', 'B', 'C']);
  assert.deepEqual(cd.childSide, ['D']);
});

test('关键连接：无向三角形环上的任何一条关系都不是桥梁（不误报）', () => {
  const state = makeState(['A', 'B', 'C']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'A', 'C'); // 忽略方向后 A-B-C-A 成环，每条边都有替代路径
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 1);
  assert.equal(r.edgeCount, 3);
  assert.equal(r.bridges.length, 0);
});

test('关键连接：钻石结构（父系/母系两条路径）无桥梁', () => {
  const state = makeState(['R', '甲', '乙', '丙']);
  add(state, 'R', '甲');
  add(state, 'R', '乙');
  add(state, '甲', '丙');
  add(state, '乙', '丙');
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 1);
  assert.equal(r.bridges.length, 0);
});

test('关键连接：钻石加一条单代延伸，仅延伸关系为桥梁且两侧成员完整', () => {
  const state = makeState(['R', '甲', '乙', '丙', '丁']);
  add(state, 'R', '甲');
  add(state, 'R', '乙');
  add(state, '甲', '丙');
  add(state, '乙', '丙');
  add(state, '丙', '丁'); // 丁只有一条连接，断开后被单独分开
  const r = findCriticalLinks(state);
  assert.equal(r.bridges.length, 1);
  const b = r.bridges[0];
  assert.equal(b.parentId, '丙');
  assert.equal(b.childId, '丁');
  assert.deepEqual(b.parentSide, ['R', '甲', '乙', '丙']);
  assert.deepEqual(b.childSide, ['丁']);
});

test('关键连接：方向汇聚（两位父母指向同一子女）仍连通，环内关系不报桥', () => {
  const state = makeState(['A', 'B', 'C']);
  add(state, 'A', 'C');
  add(state, 'B', 'C');
  // 忽略方向后 A-C-B 是一棵树：A→C 与 B→C 都是桥梁（A、B 各自为叶）
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 1);
  assert.equal(r.bridges.length, 2);
  const ac = bridgeOf(r, 'A', 'C');
  assert.deepEqual(ac.parentSide, ['A']);
  assert.deepEqual(ac.childSide, ['B', 'C']);
  const bc = bridgeOf(r, 'B', 'C');
  assert.deepEqual(bc.parentSide, ['B']);
  assert.deepEqual(bc.childSide, ['A', 'C']);
});

test('关键连接：原本互不连通的家族分别计算，孤立成员各自成量且不产生桥梁', () => {
  const state = makeState(['A', 'B', 'C', 'D', 'E', 'F']);
  add(state, 'A', 'B');
  add(state, 'B', 'C'); // 家族一：A→B→C（两条桥梁）
  add(state, 'D', 'E'); // 家族二：D→E（一条桥梁）
  // F 无任何关系：单成员家族
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 3);
  assert.equal(r.bridges.length, 3);
  // 每个家族只报自己内部的桥梁，断开不影响另一家族
  const de = bridgeOf(r, 'D', 'E');
  assert.deepEqual(de.parentSide, ['D']);
  assert.deepEqual(de.childSide, ['E']);
});

test('关键连接：仅有孤立成员时没有桥梁', () => {
  const state = makeState(['甲', '乙']);
  const r = findCriticalLinks(state);
  assert.equal(r.componentCount, 2);
  assert.equal(r.edgeCount, 0);
  assert.deepEqual(r.bridges, []);
});

test('关键连接：断开后两侧成员数之和等于原家族总人数', () => {
  const state = makeState(['A', 'B', 'C', 'D', 'E', 'F']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'A', 'C'); // A-B-C 成环，无桥
  add(state, 'C', 'D'); // 桥：分出 D
  add(state, 'D', 'E'); // 桥：分出 D-E
  add(state, 'E', 'F'); // 桥：分出 F
  const r = findCriticalLinks(state);
  assert.equal(r.bridges.length, 3);
  for (const b of r.bridges) {
    assert.equal(b.parentSide.length + b.childSide.length, 6);
    // 两侧互不相交
    assert.equal(
      new Set([...b.parentSide, ...b.childSide]).size,
      6,
      '两侧成员应互不重叠且覆盖整个家族',
    );
  }
  // D→E 断开：一侧 A、B、C、D，另一侧 E、F
  const de = bridgeOf(r, 'D', 'E');
  assert.deepEqual(de.parentSide, ['A', 'B', 'C', 'D']);
  assert.deepEqual(de.childSide, ['E', 'F']);
});

test('关键连接：结果确定（重复计算一致）且为纯函数不修改家谱', () => {
  const state = makeState(['A', 'B', 'C', 'D']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'C', 'D');
  const snapshot = JSON.parse(JSON.stringify(state));
  const r1 = findCriticalLinks(state);
  const r2 = findCriticalLinks(state);
  assert.deepEqual(r1, r2);
  assert.deepEqual(state, snapshot, '计算关键连接不得修改家谱');
});

test('HTTP：GET /api/critical-links 只读返回桥梁关系、两侧姓名与所依据版本，不写家谱', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-links-http-'));
  process.env.DATA_FILE = path.join(dir, 'family.json');
  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) =>
    fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    // 空谱：明确空状态
    let res = await fetch(`${base}/api/critical-links`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.empty, true);
    assert.equal(body.bridgeCount, 0);
    assert.deepEqual(body.bridges, []);
    assert.equal(body.version, 0);

    // 录入五名成员：甲→乙→丙→丁（三条桥），另有孤立成员戊
    const ids = {};
    for (const name of ['甲', '乙', '丙', '丁', '戊']) {
      res = await post('/api/members', { name });
      assert.equal(res.status, 201);
      const st = await res.json();
      ids[name] = st.members.find((m) => m.name === name).id;
    }
    for (const [p, c] of [['甲', '乙'], ['乙', '丙'], ['丙', '丁']]) {
      res = await post('/api/edges', { parentId: ids[p], childId: ids[c] });
      assert.equal(res.status, 201);
    }

    res = await fetch(`${base}/api/critical-links`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.empty, false);
    assert.equal(body.version, 8, '结果应标注所依据的家谱版本');
    assert.equal(body.memberCount, 5);
    assert.equal(body.edgeCount, 3);
    assert.equal(body.componentCount, 2, '链式家族 + 孤立成员戊');
    assert.equal(body.bridgeCount, 3);
    const first = body.bridges[0];
    assert.ok(first.parentName && first.childName, '桥梁两端应带姓名');
    assert.ok(first.parentSide.count > 0 && first.childSide.count > 0);
    assert.ok(first.parentSide.members.every((m) => m.id && m.name));
    assert.ok(first.childSide.members.every((m) => m.id && m.name));
    // 断开甲→乙：甲一侧仅甲本人
    const ab = body.bridges.find(
      (b) => b.parentId === ids['甲'] && b.childId === ids['乙'],
    );
    assert.ok(ab);
    assert.equal(ab.parentSide.count, 1);
    assert.equal(ab.parentSide.members[0].name, '甲');
    assert.deepEqual(ab.childSide.members.map((m) => m.name), ['乙', '丙', '丁']);

    // 只读：查询不推进版本
    const st = await (await fetch(`${base}/api/state`)).json();
    assert.equal(st.version, body.version);
    assert.equal(st.members.length, 5);
    assert.equal(st.edges.length, 3);

    // 再补一条 甲→丁：忽略方向后 甲-乙-丙-丁-甲 成环，每条关系都有替代路径，
    // 不应再有任何桥梁（有其他连接路径的关系不误报）
    res = await post('/api/edges', { parentId: ids['甲'], childId: ids['丁'] });
    assert.equal(res.status, 201);
    res = await fetch(`${base}/api/critical-links`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.version, 9);
    assert.equal(body.edgeCount, 4);
    assert.equal(body.componentCount, 2);
    assert.equal(body.bridgeCount, 0);
    assert.deepEqual(body.bridges, []);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    delete process.env.DATA_FILE;
  }
});
