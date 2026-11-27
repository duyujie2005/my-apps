/* 围棋引擎（9 路）· 杜裕杰的软件柜
   规则：气、提子、禁自杀、简化打劫、pass、中国规则数子（贴目 7.5）。
   AI：局面启发式 + 一步反击评估（快，够新手打）。 */
(function (root) {
  "use strict";

  var N = 9;
  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var KOMI = 7.5;

  function newBoard() { return new Int8Array(N * N); }
  function clone(b) { return Int8Array.from(b); }
  function I(x, y) { return y * N + x; }
  function X(i) { return i % N; }
  function Y(i) { return (i / N) | 0; }
  function inside(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
  function other(c) { return c === BLACK ? WHITE : BLACK; }
  function neigh(i) {
    var x = X(i), y = Y(i), out = [];
    if (y > 0) { out.push(i - N); }
    if (y < N - 1) { out.push(i + N); }
    if (x > 0) { out.push(i - 1); }
    if (x < N - 1) { out.push(i + 1); }
    return out;
  }

  /* 某点所在棋块：子列表 + 气 */
  function group(b, x, y) {
    var c = b[I(x, y)];
    if (!c) { return null; }
    var start = I(x, y);
    var seen = new Uint8Array(N * N);
    var stack = [start], stones = [], libs = new Set();
    seen[start] = 1;
    while (stack.length) {
      var p = stack.pop();
      stones.push(p);
      var ns = neigh(p);
      for (var i = 0; i < ns.length; i++) {
        var q = ns[i];
        if (b[q] === 0) { libs.add(q); }
        else if (b[q] === c && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    return { stones: stones, libs: libs.size };
  }

  /* 就地落子。返回 null = 非法；否则 {removed:[...], ko: 禁着点/-1} */
  function playAt(b, x, y, c, koIdx) {
    if (!inside(x, y)) { return null; }
    var i = I(x, y);
    if (b[i] !== 0) { return null; }
    if (i === koIdx) { return null; }

    b[i] = c;
    var oc = other(c), removed = [], ns = neigh(i);

    for (var k = 0; k < ns.length; k++) {
      var q = ns[k];
      if (b[q] === oc) {
        var g = group(b, X(q), Y(q));
        if (g && g.libs === 0) {
          for (var m = 0; m < g.stones.length; m++) {
            b[g.stones[m]] = 0;
            removed.push(g.stones[m]);
          }
        }
      }
    }

    /* 自杀判断：自己这块没气了（且没提到子）→ 非法，回滚 */
    var mine = group(b, x, y);
    if (!mine || mine.libs === 0) {
      b[i] = 0;
      for (var r = 0; r < removed.length; r++) { b[removed[r]] = oc; }
      return null;
    }

    /* 简化打劫：只提了 1 子，且自己这块也只有 1 口气 → 禁止对方立刻提回 */
    var koNext = -1;
    if (removed.length === 1 && mine.libs === 1) { koNext = removed[0]; }

    return { removed: removed, ko: koNext };
  }

  /* ---------- 数子（中国规则：子 + 空） ---------- */
  function score(b) {
    var blackStones = 0, whiteStones = 0, i;
    for (i = 0; i < b.length; i++) {
      if (b[i] === BLACK) { blackStones++; }
      else if (b[i] === WHITE) { whiteStones++; }
    }

    var seen = new Uint8Array(N * N);
    var blackTerritory = 0, whiteTerritory = 0, neutral = 0;

    for (i = 0; i < b.length; i++) {
      if (b[i] !== 0 || seen[i]) { continue; }
      var stack = [i], region = [], touchB = false, touchW = false;
      seen[i] = 1;
      while (stack.length) {
        var p = stack.pop();
        region.push(p);
        var ns = neigh(p);
        for (var k = 0; k < ns.length; k++) {
          var q = ns[k];
          if (b[q] === 0) {
            if (!seen[q]) { seen[q] = 1; stack.push(q); }
          } else if (b[q] === BLACK) { touchB = true; }
          else { touchW = true; }
        }
      }
      if (touchB && !touchW) { blackTerritory += region.length; }
      else if (touchW && !touchB) { whiteTerritory += region.length; }
      else { neutral += region.length; }
    }

    var black = blackStones + blackTerritory;
    var white = whiteStones + whiteTerritory + KOMI;
    return {
      blackStones: blackStones,
      whiteStones: whiteStones,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      neutral: neutral,
      black: black,
      white: white,
      margin: black - white,
      winner: black > white ? BLACK : WHITE
    };
  }

  /* ---------- 位置权重（9 路常识：三线好、一线差） ---------- */
  function posBonus(x, y) {
    var s = 0;
    if (x === 2 || x === 6) { s += 2.5; }
    if (y === 2 || y === 6) { s += 2.5; }
    if (x === 4 && y === 4) { s += 2; }
    if (x === 0 || x === 8 || y === 0 || y === 8) { s -= 5; }
    if (x === 1 || x === 7 || y === 1 || y === 7) { s -= 1.5; }
    return s;
  }

  /* 假设在 (x,y) 落子给 c，这一步的价值（越大越好；负 = 不划算） */
  function pointValue(b, x, y, c, koIdx) {
    var i = I(x, y);
    if (b[i] !== 0 || i === koIdx) { return -1e9; }

    var sim = clone(b);
    var r = playAt(sim, x, y, c, koIdx);
    if (!r) { return -1e9; }

    var s = 0;
    s += r.removed.length * 14;          /* 提子是实利 */
    s += posBonus(x, y);

    var oc = other(c);
    var ns = neigh(i), mine = 0, theirs = 0;
    for (var k = 0; k < ns.length; k++) {
      if (sim[ns[k]] === c) { mine++; }
      else if (sim[ns[k]] === oc) { theirs++; }
    }
    s += mine * 3.2 + theirs * 3.6;      /* 接触战 */

    /* 落子后自己这块的气 */
    var g = group(sim, x, y);
    if (g) {
      s += Math.min(g.libs, 5) * 1.4;
      if (g.libs === 1 && g.stones.length > 1) { s -= 6; }   /* 把自己接死 */
    }

    /* 别自己填眼 */
    var filled = 0;
    for (var k2 = 0; k2 < ns.length; k2++) {
      if (sim[ns[k2]] === c) { filled++; }
    }
    if (filled === ns.length && theirs === 0) { s -= 14; }

    /* 顺手救活只剩 1 气的自己人 */
    return s;
  }

  function candidates(b, koIdx) {
    var out = [], i, hasStone = false;
    for (i = 0; i < b.length; i++) { if (b[i] !== 0) { hasStone = true; break; } }

    for (i = 0; i < b.length; i++) {
      if (b[i] !== 0 || i === koIdx) { continue; }
      if (!hasStone) { out.push(i); continue; }
      var x = X(i), y = Y(i), near = false;
      for (var dy = -3; dy <= 3 && !near; dy++) {
        for (var dx = -3; dx <= 3; dx++) {
          var nx = x + dx, ny = y + dy;
          if (inside(nx, ny) && b[I(nx, ny)] !== 0) { near = true; break; }
        }
      }
      if (near) { out.push(i); }
    }
    if (!out.length) {
      for (var m = 0; m < b.length; m++) { if (b[m] === 0 && m !== koIdx) { out.push(m); } }
    }
    return out;
  }

  var LEVELS = [
    null,
    { name: "入门", noise: 0.55, reply: false, top: 0 },
    { name: "普通", noise: 0.12, reply: true, top: 12 },
    { name: "困难", noise: 0, reply: true, top: 18 }
  ];

  function best(b, c, koIdx, level) {
    var cfg = LEVELS[level] || LEVELS[2];
    var cands = candidates(b, koIdx);
    if (!cands.length) { return null; }

    var scored = [];
    for (var i = 0; i < cands.length; i++) {
      var v = pointValue(b, X(cands[i]), Y(cands[i]), c, koIdx);
      if (v <= -1e8) { continue; }
      if (cfg.noise > 0) { v = v * (1 + (Math.random() * 2 - 1) * cfg.noise); }
      scored.push({ i: cands[i], v: v });
    }
    if (!scored.length) { return null; }
    scored.sort(function (a, b2) { return b2.v - a.v; });

    if (!cfg.reply || scored.length === 1) {
      return { x: X(scored[0].i), y: Y(scored[0].i), score: scored[0].v, tried: scored.length };
    }

    /* 一步反击：我下这里之后，对方最好的一手值多少 */
    var top = cfg.top > 0 ? Math.min(cfg.top, scored.length) : scored.length;
    var bestP = scored[0], bestNet = -1e18;
    for (var k = 0; k < top; k++) {
      var p = scored[k];
      var sim = clone(b);
      var r = playAt(sim, X(p.i), Y(p.i), c, koIdx);
      if (!r) { continue; }
      var oc = other(c);
      var reply = 0;
      var cs2 = candidates(sim, r.ko);
      for (var m = 0; m < cs2.length; m++) {
        var v2 = pointValue(sim, X(cs2[m]), Y(cs2[m]), oc, r.ko);
        if (v2 > reply) { reply = v2; }
      }
      var net = p.v - reply * (reply > 20 ? 0.85 : 0.45);
      if (net > bestNet) { bestNet = net; bestP = p; }
    }
    return { x: X(bestP.i), y: Y(bestP.i), score: Math.round(bestNet), tried: top };
  }

  var COLS = "ABCDEFGHJ";
  function toName(x, y) { return COLS.charAt(x) + (N - y); }

  var api = {
    N: N,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    KOMI: KOMI,
    LEVELS: LEVELS,
    newBoard: newBoard,
    clone: clone,
    idx: I,
    inside: inside,
    other: other,
    neigh: neigh,
    group: group,
    playAt: playAt,
    score: score,
    pointValue: pointValue,
    candidates: candidates,
    best: best,
    toName: toName
  };

  root.WEIQI = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : globalThis);
