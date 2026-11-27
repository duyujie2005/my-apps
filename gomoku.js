/* 五子棋引擎 · 杜裕杰的软件柜
   15×15 交叉点，黑先白后，任意方向连成 5 子即胜。
   AI 用「棋型评分 + 一层/两层前瞻」，纯前端、无依赖。 */
(function (root) {
  "use strict";

  var N = 15;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  var BLACK = 1, WHITE = 2;

  function newBoard() { return new Int8Array(N * N); }
  function clone(b) { return Int8Array.from(b); }
  function I(x, y) { return y * N + x; }
  function inside(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
  function other(c) { return c === BLACK ? WHITE : BLACK; }

  /* ---------- 棋型识别 ---------- */
  /* 把以 (x,y) 为中心、沿某方向前后各 4 格取成 9 位字符串
     1 = 我方（中心恒为我方），0 = 空，2 = 对方或棋盘外 */
  function lineStr(b, x, y, dx, dy, c) {
    var s = "";
    for (var k = -4; k <= 4; k++) {
      if (k === 0) { s += "1"; continue; }
      var nx = x + dx * k, ny = y + dy * k;
      if (!inside(nx, ny)) { s += "2"; continue; }
      var v = b[I(nx, ny)];
      s += v === 0 ? "0" : (v === c ? "1" : "2");
    }
    return s;
  }

  var PAT = [
    [1000000, ["11111"]],
    [100000, ["011110"]],
    [10000, ["011112", "211110", "11011", "10111", "11101"]],
    [8000, ["011100", "001110", "010110", "011010", "001101", "101100"]],
    [800, ["001112", "211100", "010112", "211010", "011012", "210110", "10011", "11001", "10101"]],
    [500, ["001100", "011000", "000110", "010100", "001010", "010010"]],
    [50, ["000112", "211000", "001012", "210100", "010012", "210010", "10001"]]
  ];

  function scoreDir(s) {
    for (var i = 0; i < PAT.length; i++) {
      var list = PAT[i][1];
      for (var j = 0; j < list.length; j++) {
        if (s.indexOf(list[j]) >= 0) { return PAT[i][0]; }
      }
    }
    return 0;
  }

  /* 假设 (x,y) 落子给 c，这一步在四个方向上的价值 */
  function scorePoint(b, x, y, c) {
    if (!inside(x, y) || b[I(x, y)] !== 0) { return -1; }
    var total = 0;
    for (var d = 0; d < 4; d++) {
      total += scoreDir(lineStr(b, x, y, DIRS[d][0], DIRS[d][1], c));
    }
    return total;
  }

  /* 落子后是否已经五连 */
  function isWin(b, x, y, c) {
    for (var d = 0; d < 4; d++) {
      var cnt = 1;
      for (var s = 1; s <= 4; s++) {
        var nx = x + DIRS[d][0] * s, ny = y + DIRS[d][1] * s;
        if (!inside(nx, ny) || b[I(nx, ny)] !== c) { break; }
        cnt++;
      }
      for (var s2 = 1; s2 <= 4; s2++) {
        var mx = x - DIRS[d][0] * s2, my = y - DIRS[d][1] * s2;
        if (!inside(mx, my) || b[I(mx, my)] !== c) { break; }
        cnt++;
      }
      if (cnt >= 5) { return true; }
    }
    return false;
  }

  /* ---------- 候选点 ---------- */
  function neighbors(b, r) {
    var has = false, i, x, y;
    for (i = 0; i < b.length; i++) { if (b[i] !== 0) { has = true; break; } }
    if (!has) { return [{ x: 7, y: 7 }]; }

    var out = [];
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        if (b[I(x, y)] !== 0) { continue; }
        var near = false;
        for (var dy = -r; dy <= r && !near; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (dx === 0 && dy === 0) { continue; }
            var nx = x + dx, ny = y + dy;
            if (inside(nx, ny) && b[I(nx, ny)] !== 0) { near = true; break; }
          }
        }
        if (near) { out.push({ x: x, y: y }); }
      }
    }
    return out;
  }

  /* ---------- 单点评估（含攻防权重） ---------- */
  function rate(b, p, c, defW) {
    var my = scorePoint(b, p.x, p.y, c);
    var op = scorePoint(b, p.x, p.y, other(c));
    return my + op * defW;
  }

  /* 我下这步后，对方能拿到的最好单点价值 */
  function replyValue(b, p, c) {
    var oc = other(c);
    b[I(p.x, p.y)] = c;
    var best = 0, cands = neighbors(b, 2);
    for (var i = 0; i < cands.length; i++) {
      var v = scorePoint(b, cands[i].x, cands[i].y, oc);
      if (v > best) { best = v; }
      if (best >= 1000000) { break; }
    }
    b[I(p.x, p.y)] = 0;
    return best;
  }

  var LEVELS = [
    null,
    { name: "入门", depth: 0, defW: 0.55, top: 0, noise: 0.06 },
    { name: "简单", depth: 0, defW: 0.80, top: 0, noise: 0.02 },
    { name: "普通", depth: 1, defW: 0.95, top: 10, noise: 0 },
    { name: "困难", depth: 1, defW: 1.00, top: 14, noise: 0 },
    { name: "大师", depth: 2, defW: 1.00, top: 10, noise: 0 }
  ];

  /* ---------- 选点 ---------- */
  function best(b, c, level) {
    var cfg = LEVELS[level] || LEVELS[3];
    var cands = neighbors(b, 2);
    if (!cands.length) { return null; }

    /* 1. 自己能成五：直接赢 */
    var i, p, v;
    for (i = 0; i < cands.length; i++) {
      p = cands[i];
      if (scorePoint(b, p.x, p.y, c) >= 1000000) {
        return { x: p.x, y: p.y, score: 1000000, nodes: i + 1 };
      }
    }
    /* 2. 对方能成五：必须堵 */
    var oc = other(c);
    for (i = 0; i < cands.length; i++) {
      p = cands[i];
      if (scorePoint(b, p.x, p.y, oc) >= 1000000) {
        return { x: p.x, y: p.y, score: 1000000, nodes: i + 1 };
      }
    }

    /* 3. 打分排序 */
    var scored = [];
    for (i = 0; i < cands.length; i++) {
      p = cands[i];
      v = rate(b, p, c, cfg.defW);
      if (cfg.noise > 0) { v = v * (1 + (Math.random() * 2 - 1) * cfg.noise); }
      scored.push({ x: p.x, y: p.y, base: v });
    }
    scored.sort(function (a, b2) { return b2.base - a.base; });

    if (cfg.depth === 0 || scored.length === 1) {
      return { x: scored[0].x, y: scored[0].y, score: scored[0].base, nodes: scored.length };
    }

    /* 4. 前瞻：看对方最强反击，挑净分最高的 */
    var top = cfg.top > 0 ? Math.min(cfg.top, scored.length) : scored.length;
    var bestP = scored[0], bestNet = -1e18;
    for (i = 0; i < top; i++) {
      p = scored[i];
      var loss = replyValue(b, p, c);
      var net = p.base - loss * (cfg.depth >= 2 ? 0.62 : 0.5);
      if (net > bestNet) { bestNet = net; bestP = p; }
    }
    return { x: bestP.x, y: bestP.y, score: Math.round(bestNet), nodes: top };
  }

  /* ---------- 坐标表示 ---------- */
  var COLS = "ABCDEFGHIJKLMNO";
  function toName(x, y) { return COLS.charAt(x) + (N - y); }

  function full(b) {
    for (var i = 0; i < b.length; i++) { if (b[i] === 0) { return false; } }
    return true;
  }

  var api = {
    N: N,
    BLACK: BLACK,
    WHITE: WHITE,
    LEVELS: LEVELS,
    newBoard: newBoard,
    clone: clone,
    idx: I,
    other: other,
    scorePoint: scorePoint,
    isWin: isWin,
    neighbors: neighbors,
    best: best,
    toName: toName,
    full: full
  };

  root.GOMOKU = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : globalThis);
