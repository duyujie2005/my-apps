/* 中国象棋引擎（纯逻辑，不碰页面）
   棋盘 9×10，坐标 x 0..8（左→右），y 0..9（上→下）；黑方在上（y0-2 家），红方在下（y7-9 家）
   棋子：大写=红方 K帅 A仕 B相 N马 R车 C炮 P兵；小写=黑方 k将 a士 b象 n马 r车 c炮 p卒 */
(function (g) {
  var START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR";

  function idx(x, y) { return y * 9 + x; }
  function inBoard(x, y) { return x >= 0 && x < 9 && y >= 0 && y < 10; }
  function isRed(p) { return p >= "A" && p <= "Z"; }
  function sideOf(p) { return isRed(p) ? "r" : "b"; }
  function other(s) { return s === "r" ? "b" : "r"; }
  function isEnemy(a, b) { return !!a && !!b && sideOf(a) !== sideOf(b); }

  function parseFEN(fen) {
    var b = new Array(90).fill("");
    var rows = (fen || START_FEN).split(" ")[0].split("/");
    for (var y = 0; y < rows.length && y < 10; y++) {
      var x = 0;
      for (var i = 0; i < rows[y].length; i++) {
        var ch = rows[y][i];
        if (ch >= "1" && ch <= "9") { x += parseInt(ch, 10); }
        else { if (x < 9) { b[idx(x, y)] = ch; } x++; }
      }
    }
    return b;
  }

  function toFEN(b, side) {
    var rows = [];
    for (var y = 0; y < 10; y++) {
      var s = "", empty = 0;
      for (var x = 0; x < 9; x++) {
        var p = b[idx(x, y)];
        if (!p) { empty++; }
        else { if (empty) { s += empty; empty = 0; } s += p; }
      }
      if (empty) { s += empty; }
      rows.push(s);
    }
    return rows.join("/") + " " + (side || "r") + " - - 0 1";
  }

  function findKing(b, side) {
    var k = side === "r" ? "K" : "k";
    for (var y = 0; y < 10; y++) { for (var x = 0; x < 9; x++) { if (b[idx(x, y)] === k) { return { x: x, y: y }; } } }
    return null;
  }

  function inPalace(x, y, side) {
    if (x < 3 || x > 5) { return false; }
    return side === "r" ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }

  // 伪合法走法（不考虑自己被将军）
  function genMoves(b, side) {
    var out = [];
    function push(fx, fy, tx, ty) {
      if (!inBoard(tx, ty)) { return; }
      var t = b[idx(tx, ty)];
      if (t && sideOf(t) === side) { return; }
      out.push({ fx: fx, fy: fy, tx: tx, ty: ty, cap: t || "" });
    }
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = b[idx(x, y)];
        if (!p || sideOf(p) !== side) { continue; }
        var t = p.toUpperCase();
        if (t === "K") {
          var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
          for (var i = 0; i < 4; i++) {
            var nx = x + dirs[i][0], ny = y + dirs[i][1];
            if (inPalace(nx, ny, side)) { push(x, y, nx, ny); }
          }
        } else if (t === "A") {
          var dd = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
          for (var j = 0; j < 4; j++) {
            var ax = x + dd[j][0], ay = y + dd[j][1];
            if (inPalace(ax, ay, side)) { push(x, y, ax, ay); }
          }
        } else if (t === "B") {
          var bd = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
          for (var k = 0; k < 4; k++) {
            var bx = x + bd[k][0], by = y + bd[k][1];
            if (!inBoard(bx, by)) { continue; }
            if (side === "r" ? by < 5 : by > 4) { continue; }            // 象不过河
            if (b[idx(x + bd[k][0] / 2, y + bd[k][1] / 2)]) { continue; }  // 塞象眼
            push(x, y, bx, by);
          }
        } else if (t === "N") {
          var nd = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
          for (var m = 0; m < 8; m++) {
            var hx = x + nd[m][0], hy = y + nd[m][1];
            var lx = x + (Math.abs(nd[m][0]) === 2 ? nd[m][0] / 2 : 0);
            var ly = y + (Math.abs(nd[m][1]) === 2 ? nd[m][1] / 2 : 0);
            if (b[idx(lx, ly)]) { continue; }                            // 蹩马腿
            push(x, y, hx, hy);
          }
        } else if (t === "R") {
          var rd = [[0, -1], [0, 1], [-1, 0], [1, 0]];
          for (var r = 0; r < 4; r++) {
            var rx = x + rd[r][0], ry = y + rd[r][1];
            while (inBoard(rx, ry)) {
              var rp = b[idx(rx, ry)];
              if (!rp) { push(x, y, rx, ry); }
              else { if (sideOf(rp) !== side) { push(x, y, rx, ry); } break; }
              rx += rd[r][0]; ry += rd[r][1];
            }
          }
        } else if (t === "C") {
          var cd = [[0, -1], [0, 1], [-1, 0], [1, 0]];
          for (var c = 0; c < 4; c++) {
            var cx = x + cd[c][0], cy = y + cd[c][1];
            var screen = false;
            while (inBoard(cx, cy)) {
              var cp = b[idx(cx, cy)];
              if (!screen) {
                if (!cp) { push(x, y, cx, cy); }
                else { screen = true; }
              } else if (cp) {
                if (sideOf(cp) !== side) { push(x, y, cx, cy); }
                break;
              }
              cx += cd[c][0]; cy += cd[c][1];
            }
          }
        } else if (t === "P") {
          var fy2 = side === "r" ? -1 : 1;
          push(x, y, x, y + fy2);
          var crossed = side === "r" ? y <= 4 : y >= 5;
          if (crossed) { push(x, y, x - 1, y); push(x, y, x + 1, y); }
        }
      }
    }
    return out;
  }

  // 我这一方被将军了吗（含将帅照面）
  function inCheck(b, side) {
    var k = findKing(b, side);
    if (!k) { return false; }
    var kx = k.x, ky = k.y, opp = other(side);
    // 直线：车 / 将帅照面 / 炮
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (var d = 0; d < 4; d++) {
      var x = kx + dirs[d][0], y = ky + dirs[d][1], first = null, firstX = -1, firstY = -1;
      while (inBoard(x, y)) {
        var p = b[idx(x, y)];
        if (p) { first = p; firstX = x; firstY = y; break; }
        x += dirs[d][0]; y += dirs[d][1];
      }
      if (first && sideOf(first) === opp) {
        var fu = first.toUpperCase();
        if (fu === "R" || fu === "K") { return true; }
      }
      if (first) {
        x = firstX + dirs[d][0]; y = firstY + dirs[d][1];
        while (inBoard(x, y)) {
          var p2 = b[idx(x, y)];
          if (p2) {
            if (sideOf(p2) === opp && p2.toUpperCase() === "C") { return true; }
            break;
          }
          x += dirs[d][0]; y += dirs[d][1];
        }
      }
    }
    // 马
    var nd = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
    for (var n = 0; n < 8; n++) {
      var nx = kx + nd[n][0], ny = ky + nd[n][1];
      if (!inBoard(nx, ny)) { continue; }
      var np = b[idx(nx, ny)];
      if (!np || sideOf(np) !== opp || np.toUpperCase() !== "N") { continue; }
      var lx = nx + (Math.abs(nd[n][0]) === 2 ? -nd[n][0] / 2 : 0);
      var ly = ny + (Math.abs(nd[n][1]) === 2 ? -nd[n][1] / 2 : 0);
      if (!b[idx(lx, ly)]) { return true; }
    }
    // 兵/卒（黑兵往下走、红兵往上走）
    var px = kx, py = ky + (side === "r" ? -1 : 1);
    if (inBoard(px, py) && b[idx(px, py)] && sideOf(b[idx(px, py)]) === opp && b[idx(px, py)].toUpperCase() === "P") { return true; }
    var sideY = [kx - 1, kx + 1];
    for (var s2 = 0; s2 < 2; s2++) {
      var sx = sideY[s2], sy = ky;
      if (inBoard(sx, sy) && b[idx(sx, sy)] && sideOf(b[idx(sx, sy)]) === opp && b[idx(sx, sy)].toUpperCase() === "P") {
        var crossedEnemy = opp === "r" ? sy <= 4 : sy >= 5;
        if (crossedEnemy) { return true; }
      }
    }
    return false;
  }

  function make(b, mv) {
    var cap = b[idx(mv.tx, mv.ty)];
    b[idx(mv.tx, mv.ty)] = b[idx(mv.fx, mv.fy)];
    b[idx(mv.fx, mv.fy)] = "";
    mv.cap = cap || "";
    return cap;
  }
  function unmake(b, mv) {
    b[idx(mv.fx, mv.fy)] = b[idx(mv.tx, mv.ty)];
    b[idx(mv.tx, mv.ty)] = mv.cap || "";
  }

  // 真正合法走法（走完不能自己被将军 / 不能将帅照面）
  function legalMoves(b, side) {
    var all = genMoves(b, side), out = [];
    for (var i = 0; i < all.length; i++) {
      make(b, all[i]);
      var bad = inCheck(b, side);
      unmake(b, all[i]);
      if (!bad) { out.push(all[i]); }
    }
    return out;
  }

  function gameOver(b, side) {
    var mv = legalMoves(b, side);
    if (!mv.length) { return { over: true, winner: other(side), reason: inCheck(b, side) ? "将死" : "困毙" }; }
    return { over: false };
  }

  // ---------------- 评估 ----------------
  var VAL = { K: 10000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };
  function evalRed(b) {
    var s = 0;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = b[idx(x, y)];
        if (!p) { continue; }
        var t = p.toUpperCase(), v = VAL[t] || 0, sign = isRed(p) ? 1 : -1;
        if (t === "P") {
          var crossed = isRed(p) ? y <= 4 : y >= 5;
          v = crossed ? 190 : 100;
          if (crossed) { v += (isRed(p) ? (5 - y) : (y - 5)) * 8; }
        }
        // 马炮往中路和过河靠：给一点点位置分
        if (t === "N" || t === "C") { v += (4 - Math.abs(x - 4)) * 6; }
        if (t === "R") { v += (4 - Math.abs(x - 4)) * 3; }
        s += sign * v * 1.0;
      }
    }
    return s;
  }
  function evalSide(b, side) { var v = evalRed(b); return side === "r" ? v : -v; }

  function mvvlva(m) {
    var cap = m.cap ? (VAL[m.cap.toUpperCase()] || 0) : 0;
    var me = VAL[(m.cap ? "" : "P")] || 0;
    return cap * 10;
  }
  function orderMoves(list) {
    list.sort(function (a, b2) { return mvvlva(b2) - mvvlva(a); });
  }

  var MATE = 90000;
  // 搜索里用“能吃将=赢”的写法，不做自我将军过滤，速度比 legalMoves 快 5~10 倍；
  // 根节点仍用 legalMoves，保证 AI 走出真正合法的棋。
  function negamax(b, side, depth, alpha, beta, ply) {
    if (depth <= 0) { return evalSide(b, side); }
    var moves = genMoves(b, side);
    if (!moves.length) { return -MATE + ply; }
    orderMoves(moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].cap && moves[i].cap.toUpperCase() === "K") { return MATE - ply; }
      make(b, moves[i]);
      var v = -negamax(b, other(side), depth - 1, -beta, -alpha, ply + 1);
      unmake(b, moves[i]);
      if (v > best) { best = v; }
      if (best > alpha) { alpha = best; }
      if (alpha >= beta) { break; }
    }
    return best === -Infinity ? -MATE + ply : best;
  }

  // 选一步棋：level 1 简单 / 2 普通 / 3 困难
  function bestMove(fen, side, level) {
    var b = parseFEN(fen);
    var moves = legalMoves(b, side);
    if (!moves.length) { return null; }
    if (level <= 1) {
      // 简单：优先吃大子，其余随机
      orderMoves(moves);
      var top = moves.slice(0, Math.min(3, moves.length));
      return top[Math.floor(Math.random() * top.length)];
    }
    var depth = level === 2 ? 3 : 4;
    orderMoves(moves);
    var best = moves[0], bestV = -Infinity, alpha = -Infinity;
    var t0 = Date.now();
    var limit = level === 2 ? 900 : 1600;
    for (var i = 0; i < moves.length; i++) {
      make(b, moves[i]);
      var v = -negamax(b, other(side), depth - 1, -Infinity, -alpha, 1);
      unmake(b, moves[i]);
      v += Math.random() * 6;                       // 同分棋随机，免得每局一模一样
      if (v > bestV) { bestV = v; best = moves[i]; alpha = bestV; }
      if (Date.now() - t0 > limit) { break; }
    }
    return best;
  }

  // ---------------- 记谱（中式写法） ----------------
  var NAME = { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵" };
  var NAMEB = { K: "将", A: "士", B: "象", N: "马", R: "车", C: "炮", P: "卒" };
  function fileName(x, side) { return side === "r" ? 9 - x : x + 1; }
  var CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  function cn(n) { return CN[n] || String(n); }

  function moveText(b, mv) {
    var p = b[idx(mv.fx, mv.fy)];
    var side = sideOf(p);
    var t = p.toUpperCase();
    var nm = side === "r" ? NAME[t] : NAMEB[t];
    // 同一列上有两个同样的子，用“前/后”
    var same = 0, isFront = false;
    for (var y = 0; y < 10; y++) {
      var q = b[idx(mv.fx, y)];
      if (q && sideOf(q) === side && q.toUpperCase() === t) {
        same++;
        if (side === "r" ? y < mv.fy : y > mv.fy) { isFront = true; }
      }
    }
    var head = nm;
    if (same >= 2) {
      head = (isFront ? "前" : "后") + nm;
    } else {
      head = nm + cn(fileName(mv.fx, side));
    }
    if (mv.fy === mv.ty) { return head + "平" + cn(fileName(mv.tx, side)); }
    var forward = side === "r" ? mv.ty < mv.fy : mv.ty > mv.fy;
    var act = forward ? "进" : "退";
    if (t === "N" || t === "B" || t === "A") { return head + act + cn(fileName(mv.tx, side)); }
    return head + act + cn(Math.abs(mv.ty - mv.fy));
  }

  g.XQ = {
    START_FEN: START_FEN,
    parseFEN: parseFEN,
    toFEN: toFEN,
    idx: idx,
    isRed: isRed,
    sideOf: sideOf,
    other: other,
    genMoves: genMoves,
    legalMoves: legalMoves,
    inCheck: inCheck,
    make: make,
    unmake: unmake,
    gameOver: gameOver,
    evalRed: evalRed,
    bestMove: bestMove,
    moveText: moveText,
    findKing: findKing
  };
})(typeof window !== "undefined" ? window : globalThis);
