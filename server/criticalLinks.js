'use strict';

/**
 * 关键连接（桥梁关系）纯逻辑（纯函数，不依赖 Node API，便于测试）。
 *
 * 把当前全部成员与父母→子女关系视为**无向连接**：每条关系连接其两端成员，
 * 忽略方向划分连通家族（连通分量），并在每个家族内找出**桥梁关系**——
 * 移除该单条关系就会把它原本所在的连通家族拆成两部分（两侧再无其他路径相连）。
 * 仍处于无向环上的关系（移除后仍有其他连接路径）不是桥梁，不会误报；
 * 原本互不连通的家族分别计算；没有任何关系的孤立成员各自成量、不产生桥梁。
 */

/**
 * 找出全部桥梁关系（纯函数，不修改 state、不写入任何数据）。
 *
 * 返回 {
 *   empty: boolean,          // 空谱（没有任何成员）
 *   memberCount,             // 成员总数
 *   edgeCount,               // 关系总数（端点都在谱内的边）
 *   componentCount,          // 忽略方向的连通家族数（孤立成员各自成量）
 *   bridges: [{
 *     parentId, childId,           // 关系的原始方向（父母 → 子女）
 *     parentSide: [memberId],      // 断开后父母一端所在侧的全部成员（含父母本人）
 *     childSide: [memberId],       // 断开后子女一端所在侧的全部成员（含子女本人）
 *   }],
 * }
 * bridges 按 (parentId, childId) 排序，两侧成员各自按成员录入顺序排列，结果确定。
 */
function findCriticalLinks(state) {
  const members = state.members || [];
  const ids = new Set(members.map((m) => m.id));

  // 边表：仅保留两端都在谱内的关系（防御异常数据）
  const edges = [];
  for (const [childId, parents] of Object.entries(state.parentsOf || {})) {
    for (const parentId of parents) {
      if (ids.has(parentId) && ids.has(childId)) edges.push({ parentId, childId });
    }
  }

  const empty = members.length === 0;

  // 无向邻接表：adj[id] = [{ to, edgeIndex }]，edgeIndex 用于区分边（Tarjan 判桥需要）
  const adj = new Map(members.map((m) => [m.id, []]));
  edges.forEach((e, i) => {
    adj.get(e.parentId).push({ to: e.childId, edgeIndex: i });
    adj.get(e.childId).push({ to: e.parentId, edgeIndex: i });
  });

  // Tarjan 低链值算法：disc 为首次访问次序，low 为不经过父边能回溯到的最早次序。
  // 树边 u—v（v 由 u 经该边首次发现）满足 low[v] > disc[u] 时即为桥梁：
  // v 一侧无法绕过这条边回到 u 及更早的节点，断开后两侧不再连通。
  // 家谱最多 30 人，递归深度有限。
  const disc = new Map();
  const low = new Map();
  const bridgeEdgeIndexes = new Set();
  let time = 0;
  let componentCount = 0;

  const dfs = (u, parentEdge) => {
    disc.set(u, time);
    low.set(u, time);
    time += 1;
    for (const { to: v, edgeIndex } of adj.get(u)) {
      if (edgeIndex === parentEdge) continue; // 不沿来路返回
      if (!disc.has(v)) {
        dfs(v, edgeIndex);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (low.get(v) > disc.get(u)) bridgeEdgeIndexes.add(edgeIndex);
      } else {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
  };

  // 原本互不连通的家族分别计算（孤立成员各自成为一个单成员家族）
  for (const m of members) {
    if (disc.has(m.id)) continue;
    componentCount += 1;
    dfs(m.id, -1);
  }

  // 成员录入顺序，用于两侧名单的稳定排列
  const orderOf = new Map(members.map((m, i) => [m.id, i]));

  // 断开桥梁边 blockedEdge 后，从 start 出发（不使用该边）可达的全部成员
  const reachWithout = (start, blockedEdge) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      for (const { to, edgeIndex } of adj.get(cur)) {
        if (edgeIndex === blockedEdge || seen.has(to)) continue;
        seen.add(to);
        stack.push(to);
      }
    }
    return [...seen].sort((a, b) => orderOf.get(a) - orderOf.get(b));
  };

  const bridges = edges
    .map((e, i) => ({ ...e, edgeIndex: i }))
    .filter((e) => bridgeEdgeIndexes.has(e.edgeIndex))
    .map((e) => ({
      parentId: e.parentId,
      childId: e.childId,
      parentSide: reachWithout(e.parentId, e.edgeIndex),
      childSide: reachWithout(e.childId, e.edgeIndex),
    }))
    .sort((a, b) =>
      a.parentId === b.parentId
        ? a.childId.localeCompare(b.childId)
        : a.parentId.localeCompare(b.parentId),
    );

  return {
    empty,
    memberCount: members.length,
    edgeCount: edges.length,
    componentCount,
    bridges,
  };
}

module.exports = { findCriticalLinks };
