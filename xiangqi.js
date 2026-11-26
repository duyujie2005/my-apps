/* 中国象棋引擎 v3（纯逻辑，不碰页面）
   棋盘 9×10，坐标 x 0..8（左→右），y 0..9（上→下）；黑方在上（y0-2 家），红方在下（y7-9 家）
   内部用整数表示棋子：红 1..7 = K A B N R C P；黑 -1..-7；0 空
   对外的 parseFEN / legalMoves / make 仍按字符数组工作，兼容旧页面与旧测试 */
(function (g) {
  "use strict";

  var START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR";

  // ---------------- 基础 ----------------
  function idx(x, y) { return y * 9 + x; }
  function inBoard(x, y) { return x >= 0 && x < 9 && y >= 0 && y < 10; }
  function other(s) { return s === "r" ? "b" : "r"; }

  var CHMAP = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7, k: -1, a: -2, b: -3, n: -4, r: -5, c: -6, p: -7 };
  var CHARR = "KABNRCP", CHARRB = "kabnrcp";

  function codeOf(ch) { return CHMAP[ch] || 0; }
  function charOf(p) {
    if (!p) { return ""; }
    return p > 0 ? CHARR.charAt(p - 1) : CHARRB.charAt(-p - 1);
  }
  function pindex(p) { return p > 0 ? p - 1 : 6 - p; }

  function isRed(p) {
    if (typeof p === "number") { return p > 0; }
    return !!p && p >= "A" && p <= "Z";
  }
  function sideOf(p) { return isRed(p) ? "r" : "b"; }

  function parseFEN(fen) {
    var b = new Array(90).fill("");
    var rows = (fen || START_FEN).split(" ")[0].split("/");
    for (var y = 0; y < rows.length && y < 10; y++) {
      var x = 0, row = rows[y];
      for (var i = 0; i < row.length; i++) {
        var ch = row.charAt(i);
        if (ch >= "1" && ch <= "9") { x += parseInt(ch, 10); }
        else { if (x < 9) { b[idx(x, y)] = ch; } x++; }
      }
    }
    return b;
  }

  function toInt(bChar) {
    var a = new Int8Array(90);
    for (var i = 0; i < 90; i++) {
      var ch = bChar[i];
      a[i] = ch ? (CHMAP[ch] || 0) : 0;
    }
    return a;
  }

  function toFEN(b, side) {
    var rows = [], isInt = (typeof b[0] === "number");
    for (var y = 0; y < 10; y++) {
      var s = "", empty = 0;
      for (var x = 0; x < 9; x++) {
        var p = b[idx(x, y)];
        var ch = isInt ? charOf(p) : (p || "");
        if (!ch) { empty++; }
        else { if (empty) { s += empty; empty = 0; } s += ch; }
      }
      if (empty) { s += empty; }
      rows.push(s);
    }
    return rows.join("/") + " " + (side || "r") + " - - 0 1";
  }

  function findKing(bChar, side) {
    var k = side === "r" ? "K" : "k";
    for (var y = 0; y < 10; y++) { for (var x = 0; x < 9; x++) { if (bChar[idx(x, y)] === k) { return { x: x, y: y }; } } }
    return null;
  }

  function inPalace(x, y, red) {
    if (x < 3 || x > 5) { return false; }
    return red ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }

  // 字符版 make/unmake（页面走棋用）
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

  // ---------------- 局面状态（搜索用） ----------------
  var BB = new Int8Array(90);
  var KPOS = new Int32Array(2);          // [0]=红王格子, [1]=黑王格子
  var TURN = 1;
  var EV = 0;                            // 红方视角的静态评估，增量维护
  var XT = new Int8Array(90), YT = new Int8Array(90);
  (function () { for (var i = 0; i < 90; i++) { XT[i] = i % 9; YT[i] = (i - i % 9) / 9; } })();

  function kingIdx(b, sgn) {
    var t = sgn > 0 ? 1 : -1;
    for (var i = 0; i < 90; i++) { if (b[i] === t) { return i; } }
    return -1;
  }

  function loadPos(bi) {
    BB.set(bi);
    KPOS[0] = kingIdx(BB, 1);
    KPOS[1] = kingIdx(BB, -1);
    var s = 0, i, p, pi, sg;
    for (i = 0; i < 90; i++) {
      p = BB[i];
      if (p !== 0) {
        pi = p > 0 ? p - 1 : 6 - p;
        sg = p > 0 ? 1 : -1;
        s += sg * (MAT[pi] + PST[i * 14 + pi]);
      }
    }
    EV = s;
  }

  function kingsFace() {
    var a = KPOS[0], c = KPOS[1];
    if (a < 0 || c < 0) { return false; }
    if ((a % 9) !== (c % 9)) { return false; }
    var lo = a < c ? a : c, hi = a < c ? c : a;
    for (var i = lo + 9; i < hi; i += 9) { if (BB[i] !== 0) { return false; } }
    return true;
  }

  // 着法编码：fx | fy<<4 | tx<<8 | ty<<12
  function enc(fx, fy, tx, ty) { return fx | (fy << 4) | (tx << 8) | (ty << 12); }

  // 走一步（int 棋盘），返回被吃子；hash / 王位置 / 评估同步更新，轮走方不切换
  var STK = new Int8Array(80);
  function makeI(ply, mv) {
    var fx = mv & 15, fy = (mv >> 4) & 15, tx = (mv >> 8) & 15, ty = (mv >> 12) & 15;
    var from = fy * 9 + fx, to = ty * 9 + tx;
    var pc = BB[from], cap = BB[to], pi = pc > 0 ? pc - 1 : 6 - pc;
    STK[ply] = cap;
    BB[to] = pc; BB[from] = 0;
    if (pc === 1) { KPOS[0] = to; } else if (pc === -1) { KPOS[1] = to; }
    var zf = from * 14 + pi, zt = to * 14 + pi;
    HLO ^= ZL[zf] ^ ZL[zt]; HHI ^= ZH[zf] ^ ZH[zt];
    var sg = pc > 0 ? 1 : -1;
    EV -= sg * (MAT[pi] + PST[from * 14 + pi]);
    EV += sg * (MAT[pi] + PST[to * 14 + pi]);
    if (cap) {
      var ci = cap > 0 ? cap - 1 : 6 - cap;
      var zc = to * 14 + ci;
      HLO ^= ZL[zc]; HHI ^= ZH[zc];
      EV -= (cap > 0 ? 1 : -1) * (MAT[ci] + PST[to * 14 + ci]);
    }
    return cap;
  }

  function unmakeI(ply, mv) {
    var fx = mv & 15, fy = (mv >> 4) & 15, tx = (mv >> 8) & 15, ty = (mv >> 12) & 15;
    var from = fy * 9 + fx, to = ty * 9 + tx;
    var pc = BB[to], cap = STK[ply], pi = pc > 0 ? pc - 1 : 6 - pc;
    BB[from] = pc; BB[to] = cap;
    if (pc === 1) { KPOS[0] = from; } else if (pc === -1) { KPOS[1] = from; }
    var zf = from * 14 + pi, zt = to * 14 + pi;
    HLO ^= ZL[zf] ^ ZL[zt]; HHI ^= ZH[zf] ^ ZH[zt];
    var sg = pc > 0 ? 1 : -1;
    EV += sg * (MAT[pi] + PST[from * 14 + pi]);
    EV -= sg * (MAT[pi] + PST[to * 14 + pi]);
    if (cap) {
      var ci = cap > 0 ? cap - 1 : 6 - cap;
      var zc = to * 14 + ci;
      HLO ^= ZL[zc]; HHI ^= ZH[zc];
      EV += (cap > 0 ? 1 : -1) * (MAT[ci] + PST[to * 14 + ci]);
    }
  }

  // ---------------- Zobrist --------------
  var ZL = new Int32Array(14 * 90), ZH = new Int32Array(14 * 90);
  var ZTL = 0, ZTH = 0, HLO = 0, HHI = 0;
  (function () {
    var seed = 20260101;
    function rnd() {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; seed = seed | 0;
      return seed;
    }
    for (var i = 0; i < ZL.length; i++) { ZL[i] = rnd(); ZH[i] = rnd(); }
    ZTL = rnd(); ZTH = rnd();
  })();

  function hashPos() {
    var lo = 0, hi = 0;
    for (var i = 0; i < 90; i++) {
      var p = BB[i];
      if (p) { var k = i * 14 + pindex(p); lo ^= ZL[k]; hi ^= ZH[k]; }
    }
    HLO = lo; HHI = hi;
  }

  // ---------------- 着法生成 ----------------
  var KD = [0, 0, -1, 1], KE = [-1, 1, 0, 0];
  var KAD = [-1, -1, 1, 1], KAE = [-1, 1, -1, 1];
  var KBD = [-2, -2, 2, 2], KBE = [-2, 2, -2, 2];
  var KND = [1, 2, 2, 1, -1, -2, -2, -1], KNE = [2, 1, -1, -2, -2, -1, 1, 2];

  function gen(side, buf, capsOnly) {
    var n = 0, red = side > 0, b = BB;
    for (var from = 0; from < 90; from++) {
      var pc = b[from];
      if (pc === 0) { continue; }
      if (red) { if (pc < 0) { continue; } } else { if (pc > 0) { continue; } }
      var x = XT[from], y = YT[from], t = pc > 0 ? pc : -pc, i, d, nx, ny, tp;

      if (t === 1) {
        var y0 = red ? 7 : 0, y1 = red ? 9 : 2;
        for (d = 0; d < 4; d++) {
          nx = x + KD[d]; ny = y + KE[d];
          if (nx < 3 || nx > 5 || ny < y0 || ny > y1) { continue; }
          tp = b[ny * 9 + nx];
          if (tp !== 0 && ((tp > 0) === red)) { continue; }
          if (capsOnly && tp === 0) { continue; }
          buf[n++] = enc(x, y, nx, ny);
        }
      } else if (t === 2) {
        for (d = 0; d < 4; d++) {
          nx = x + KAD[d]; ny = y + KAE[d];
          if (!inPalace(nx, ny, red)) { continue; }
          tp = b[ny * 9 + nx];
          if (tp !== 0 && ((tp > 0) === red)) { continue; }
          if (capsOnly && tp === 0) { continue; }
          buf[n++] = enc(x, y, nx, ny);
        }
      } else if (t === 3) {
        for (d = 0; d < 4; d++) {
          nx = x + KBD[d]; ny = y + KBE[d];
          if (!inBoard(nx, ny)) { continue; }
          if (red ? ny < 5 : ny > 4) { continue; }
          if (b[(y + KBE[d] / 2) * 9 + (x + KBD[d] / 2)] !== 0) { continue; }
          tp = b[ny * 9 + nx];
          if (tp !== 0 && ((tp > 0) === red)) { continue; }
          if (capsOnly && tp === 0) { continue; }
          buf[n++] = enc(x, y, nx, ny);
        }
      } else if (t === 4) {
        for (d = 0; d < 8; d++) {
          nx = x + KND[d]; ny = y + KNE[d];
          if (!inBoard(nx, ny)) { continue; }
          var lx = x + (KND[d] === 2 ? 1 : (KND[d] === -2 ? -1 : 0));
          var ly = y + (KNE[d] === 2 ? 1 : (KNE[d] === -2 ? -1 : 0));
          if (b[ly * 9 + lx] !== 0) { continue; }
          tp = b[ny * 9 + nx];
          if (tp !== 0 && ((tp > 0) === red)) { continue; }
          if (capsOnly && tp === 0) { continue; }
          buf[n++] = enc(x, y, nx, ny);
        }
      } else if (t === 5) {
        for (d = 0; d < 4; d++) {
          nx = x + KD[d]; ny = y + KE[d];
          while (inBoard(nx, ny)) {
            tp = b[ny * 9 + nx];
            if (tp === 0) { if (!capsOnly) { buf[n++] = enc(x, y, nx, ny); } }
            else {
              if ((tp > 0) !== red) { buf[n++] = enc(x, y, nx, ny); }
              break;
            }
            nx += KD[d]; ny += KE[d];
          }
        }
      } else if (t === 6) {
        for (d = 0; d < 4; d++) {
          nx = x + KD[d]; ny = y + KE[d];
          var screen = 0;
          while (inBoard(nx, ny)) {
            tp = b[ny * 9 + nx];
            if (!screen) {
              if (tp === 0) { if (!capsOnly) { buf[n++] = enc(x, y, nx, ny); } }
              else { screen = 1; }
            } else if (tp !== 0) {
              if ((tp > 0) !== red) { buf[n++] = enc(x, y, nx, ny); }
              break;
            }
            nx += KD[d]; ny += KE[d];
          }
        }
      } else {
        ny = y + (red ? -1 : 1);
        if (inBoard(x, ny)) {
          tp = b[ny * 9 + x];
          if (tp === 0 || (tp > 0) !== red) { if (!capsOnly || tp !== 0) { buf[n++] = enc(x, y, x, ny); } }
        }
        if (red ? y <= 4 : y >= 5) {
          if (x > 0) { tp = b[y * 9 + x - 1]; if ((tp === 0 || (tp > 0) !== red) && (!capsOnly || tp !== 0)) { buf[n++] = enc(x, y, x - 1, y); } }
          if (x < 8) { tp = b[y * 9 + x + 1]; if ((tp === 0 || (tp > 0) !== red) && (!capsOnly || tp !== 0)) { buf[n++] = enc(x, y, x + 1, y); } }
        }
      }
    }
    return n;
  }

  // ---------------- 将军检测 --------------
  function inCheckI(side) {
    var ki = side > 0 ? KPOS[0] : KPOS[1];
    if (ki < 0) { return false; }
    var kx = XT[ki], ky = YT[ki], b = BB, i, x, y, p;

    for (i = 0; i < 4; i++) {
      var dx = KD[i], dy = KE[i];
      x = kx + dx; y = ky + dy;
      var first = 0, fxi = 0, fyi = 0;
      while (inBoard(x, y)) {
        p = b[y * 9 + x];
        if (p !== 0) { first = p; fxi = x; fyi = y; break; }
        x += dx; y += dy;
      }
      if (first !== 0) {
        var ft = first > 0 ? first : -first;
        // 车/将 贴着这条线才算（将的照面另由 kingsFace 处理）
        if (((first > 0 ? 1 : -1) !== side) && (ft === 5 || ft === 1)) { return true; }
        // 炮：炮架可以是任何子（包括自己的士象），所以不管第一个子是谁，都要再看下一层
        x = fxi + dx; y = fyi + dy;
        while (inBoard(x, y)) {
          p = b[y * 9 + x];
          if (p !== 0) {
            if (((p > 0 ? 1 : -1) !== side) && (p > 0 ? p : -p) === 6) { return true; }
            break;
          }
          x += dx; y += dy;
        }
      }
    }

    for (i = 0; i < 8; i++) {
      x = kx + KND[i]; y = ky + KNE[i];
      if (!inBoard(x, y)) { continue; }
      var q = b[y * 9 + x];
      if (q === 0) { continue; }
      if ((q > 0 ? 1 : -1) === side) { continue; }
      if ((q > 0 ? q : -q) !== 4) { continue; }
      var legx = (KND[i] === 2 || KND[i] === -2) ? x - KND[i] / 2 : x;
      var legy = (KNE[i] === 2 || KNE[i] === -2) ? y - KNE[i] / 2 : y;
      if (b[legy * 9 + legx] === 0) { return true; }
    }

    if (side > 0) {
      if (ky > 0 && b[(ky - 1) * 9 + kx] === -7) { return true; }
      if (ky >= 5) {
        if (kx > 0 && b[ky * 9 + kx - 1] === -7) { return true; }
        if (kx < 8 && b[ky * 9 + kx + 1] === -7) { return true; }
      }
    } else {
      if (ky < 9 && b[(ky + 1) * 9 + kx] === 7) { return true; }
      if (ky <= 4) {
        if (kx > 0 && b[ky * 9 + kx - 1] === 7) { return true; }
        if (kx < 8 && b[ky * 9 + kx + 1] === 7) { return true; }
      }
    }
    return false;
  }

  function inCheck(bChar, side) {
    loadPos(toInt(bChar));
    return inCheckI(side === "r" ? 1 : -1) || kingsFace();
  }

  // ---------------- 评估 --------------
  var MAT = new Int32Array([0, 220, 220, 440, 1000, 500, 118, 0, 220, 220, 440, 1000, 500, 118]);
  var PST = new Int32Array(90 * 14);
  (function () {
    for (var p = -7; p <= 7; p++) {
      if (p === 0) { continue; }
      var pi = pindex(p), t = p > 0 ? p : -p, red = p > 0;
      for (var y = 0; y < 10; y++) {
        for (var x = 0; x < 9; x++) {
          var ry = red ? y : 9 - y;
          var cx = x < 4 ? 4 - x : x - 4;
          var v = 0;
          if (t === 7) {
            if (ry <= 4) { v = 14 + (4 - ry) * 9 + (4 - cx) * 7; }
            else if (ry === 5) { v = 6; }
            else if (ry === 6) { v = 2; }
          } else if (t === 4) {
            v = (4 - cx) * 9 + (ry <= 4 ? 10 : 0) + (ry <= 2 ? 6 : 0);
          } else if (t === 5) {
            v = (4 - cx) * 5 + (ry <= 4 ? 12 + (4 - ry) * 4 : 0);
          } else if (t === 6) {
            v = (4 - cx) * 8 + (ry <= 2 ? 8 : 0);
          } else if (t === 2 || t === 3) {
            v = ry >= 7 ? 8 : 0;
          }
          PST[idx(x, y) * 14 + pi] = v;
        }
      }
    }
  })();

  function evalBoard(b) {
    var s = 0, i, p, pi, sg;
    for (i = 0; i < 90; i++) {
      p = b[i];
      if (p !== 0) {
        pi = p > 0 ? p - 1 : 6 - p;
        sg = p > 0 ? 1 : -1;
        s += sg * (MAT[pi] + PST[i * 14 + pi]);
      }
    }
    return s;
  }

  function evalRed(b) { return evalBoard(typeof b[0] === "number" ? b : toInt(b)); }

  // ---------------- 置换表 / 启发 --------------
  var TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttKey = new Int32Array(TT_SIZE);
  var ttDepth = new Int8Array(TT_SIZE);
  var ttFlag = new Int8Array(TT_SIZE);
  var ttVal = new Int32Array(TT_SIZE);
  var ttMv = new Int32Array(TT_SIZE);

  var MAXPLY = 80;
  var gbuf = [], gsbuf = [];
  for (var q = 0; q < MAXPLY; q++) { gbuf.push(new Int32Array(160)); gsbuf.push(new Int32Array(160)); }
  var lbuf = new Int32Array(160);

  var killer = new Int32Array(MAXPLY * 2);
  var hist = new Int32Array(90 * 90);
  var pathHash = new Int32Array(MAXPLY);

  var MATE = 100000, INF = 200000;
  var nodes = 0, deadline = 0, stopped = false;

  // 排序：TT 着法 → 杀手 → 吃子（按被吃子等级降序）→ 其余
  // 直接在 buf 内原地分区，不再分配临时数组（这是每节点都跑的热路径）
  function orderMoves(size, mvTT, ply) {
    var buf = gbuf[ply], k0 = killer[ply * 2], k1 = killer[ply * 2 + 1];
    var n = 0, i, j, t, to, cap, sc, bs, bi;

    if (mvTT) {
      for (i = 0; i < size; i++) { if (buf[i] === mvTT) { t = buf[0]; buf[0] = buf[i]; buf[i] = t; break; } }
      n = 1;
    }
    for (j = 0; j < 2; j++) {
      var kk = j === 0 ? k0 : k1;
      if (!kk) { continue; }
      for (i = n; i < size; i++) { if (buf[i] === kk) { t = buf[n]; buf[n] = buf[i]; buf[i] = t; n++; break; } }
    }
    var capStart = n;
    for (i = n; i < size; i++) {
      to = ((buf[i] >> 12) & 15) * 9 + ((buf[i] >> 8) & 15);
      if (BB[to] !== 0) { t = buf[n]; buf[n] = buf[i]; buf[i] = t; n++; }
    }
    for (i = capStart; i < n - 1; i++) {
      bi = i; bs = -1;
      for (j = i; j < n; j++) {
        to = ((buf[j] >> 12) & 15) * 9 + ((buf[j] >> 8) & 15);
        cap = BB[to];
        sc = cap > 0 ? cap : -cap;
        if (sc > bs) { bs = sc; bi = j; }
      }
      if (bi !== i) { t = buf[i]; buf[i] = buf[bi]; buf[bi] = t; }
    }
    return size;
  }

  // ---------------- 静态搜索 --------------
  function qsearch(alpha, beta, ply) {
    if (stopped) { return 0; }
    nodes++;
    if ((nodes & 2047) === 0 && Date.now() > deadline) { stopped = true; return 0; }
    if (ply >= MAXPLY - 2) { return TURN * EV; }

    var stand = TURN * EV;
    if (stand >= beta) { return stand; }
    if (stand > alpha) { alpha = stand; }

    var size = gen(TURN, gbuf[ply], 1);
    orderMoves(size, 0, ply);
    var any = 0;
    for (var k = 0; k < size; k++) {
      var mv = gbuf[ply][k];
      var to = ((mv >> 12) & 15) * 9 + ((mv >> 8) & 15);
      var cap = BB[to];
      if (cap === 0) { break; }
      if (cap === 1 || cap === -1) { return MATE - ply; }
      makeI(ply, mv);
      if (kingsFace()) { unmakeI(ply, mv); continue; }
      any = 1;
      TURN = -TURN; HLO ^= ZTL; HHI ^= ZTH;
      var v = -qsearch(-beta, -alpha, ply + 1);
      HLO ^= ZTL; HHI ^= ZTH; TURN = -TURN;
      unmakeI(ply, mv);
      if (stopped) { return 0; }
      if (v >= beta) { return v; }
      if (v > alpha) { alpha = v; }
    }
    // 没有任何吃子时，若正被将军，需要把全部着法搜完
    if (!any && inCheckI(TURN)) {
      var size2 = gen(TURN, gbuf[ply]);
      var legal = 0;
      for (var k2 = 0; k2 < size2; k2++) {
        var mv2 = gbuf[ply][k2];
        var to2 = ((mv2 >> 12) & 15) * 9 + ((mv2 >> 8) & 15);
        if (BB[to2] === 1 || BB[to2] === -1) { return MATE - ply; }
        makeI(ply, mv2);
        if (kingsFace()) { unmakeI(ply, mv2); continue; }
        legal++;
        TURN = -TURN; HLO ^= ZTL; HHI ^= ZTH;
        var v2 = -qsearch(-beta, -alpha, ply + 1);
        HLO ^= ZTL; HHI ^= ZTH; TURN = -TURN;
        unmakeI(ply, mv2);
        if (stopped) { return 0; }
        if (v2 >= beta) { return v2; }
        if (v2 > alpha) { alpha = v2; }
      }
      if (legal === 0) { return -MATE + ply; }
    }
    return alpha;
  }

  // ---------------- 主搜索 --------------
  function negamax(depth, alpha, beta, ply) {
    if (stopped) { return 0; }
    nodes++;
    if ((nodes & 2047) === 0 && Date.now() > deadline) { stopped = true; return 0; }
    if (ply >= MAXPLY - 4) { return TURN * EV; }

    pathHash[ply] = HLO;
    for (var r = ply - 2; r >= 0 && r >= ply - 16; r -= 2) {
      if (pathHash[r] === HLO) { return 0; }
    }

    var tti = HLO & TT_MASK;
    var mvTT = 0;
    if (ttKey[tti] === HHI && ttDepth[tti] > 0) {
      var td = ttDepth[tti] - 1;
      mvTT = ttMv[tti];
      if (td >= depth) {
        var tv = ttVal[tti], f = ttFlag[tti];
        if (f === 1) { return tv; }
        if (f === 2 && tv >= beta) { return tv; }
        if (f === 3 && tv <= alpha) { return tv; }
      }
    }

    if (depth <= 0) { return qsearch(alpha, beta, ply); }

    var inChk = 0;
    if (depth >= 5) { inChk = inCheckI(TURN) ? 1 : 0; }

    if (depth >= 5 && !inChk && ply > 0 && alpha > -MATE + 2000 && beta < MATE - 2000) {
      TURN = -TURN; HLO ^= ZTL; HHI ^= ZTH;
      var nv = -negamax(depth - 3, -beta, -beta + 1, ply + 1);
      HLO ^= ZTL; HHI ^= ZTH; TURN = -TURN;
      if (stopped) { return 0; }
      if (nv >= beta) { return beta; }
    }

    var size = gen(TURN, gbuf[ply]);
    size = orderMoves(size, mvTT, ply);
    var best = -INF, bestMv = 0, origAlpha = alpha, legal = 0;
    var buf = gbuf[ply];

    for (var k = 0; k < size; k++) {
      var mv = buf[k];
      var to = ((mv >> 12) & 15) * 9 + ((mv >> 8) & 15);
      var cap = BB[to];
      if (cap === 1 || cap === -1) { return MATE - ply; }

      makeI(ply, mv);
      if (kingsFace()) { unmakeI(ply, mv); continue; }
      legal++;
      TURN = -TURN; HLO ^= ZTL; HHI ^= ZTH;

      var v;
      if (legal === 1) {
        v = -negamax(depth - 1, -beta, -alpha, ply + 1);
      } else {
        var reduce = (depth >= 4 && legal > 3 && cap === 0) ? 1 : 0;
        v = -negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1);
        if (!stopped && v > alpha && v < beta) {
          v = -negamax(depth - 1, -beta, -alpha, ply + 1);
        }
      }

      HLO ^= ZTL; HHI ^= ZTH; TURN = -TURN;
      unmakeI(ply, mv);
      if (stopped) { return 0; }

      if (v > best) {
        best = v; bestMv = mv;
        if (v > alpha) {
          alpha = v;
          if (alpha >= beta) {
            if (cap === 0) {
              if (killer[ply * 2] !== mv) { killer[ply * 2 + 1] = killer[ply * 2]; killer[ply * 2] = mv; }
              var f2 = ((mv >> 4) & 15) * 9 + (mv & 15);
              hist[f2 * 90 + to] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legal === 0) { return -MATE + ply; }

    if (best > -MATE + 1000 && best < MATE - 1000) {
      if (ttKey[tti] !== HHI || ttDepth[tti] <= depth + 1) {
        ttKey[tti] = HHI;
        ttDepth[tti] = depth + 1;
        ttFlag[tti] = best <= origAlpha ? 3 : (best >= beta ? 2 : 1);
        ttVal[tti] = best;
        ttMv[tti] = bestMv;
      }
    }
    return best;
  }

  // ---------------- 根节点 --------------
  function legalRootMoves(side) {
    var size = gen(side, lbuf), out = [], k;
    for (k = 0; k < size; k++) {
      var mv = lbuf[k];
      var to = ((mv >> 12) & 15) * 9 + ((mv >> 8) & 15);
      var tcap = BB[to];
      if (tcap === 1 || tcap === -1) { out.push(mv); continue; }
      makeI(0, mv);
      var bad = inCheckI(side) || kingsFace();
      unmakeI(0, mv);
      if (!bad) { out.push(mv); }
    }
    return out;
  }

  var LEVELS = [
    null,
    { name: "入门", depth: 2, ms: 150, noise: 700 },
    { name: "简单", depth: 4, ms: 300, noise: 260 },
    { name: "普通", depth: 6, ms: 700, noise: 70 },
    { name: "困难", depth: 10, ms: 1200, noise: 0 },
    { name: "大师", depth: 14, ms: 1800, noise: 0 },
    { name: "超强", depth: 20, ms: 3000, noise: 0 }
  ];

  function think(fen, side, level, onInfo, repList, msCap) {
    var cfg = LEVELS[level] || LEVELS[3];
    var bi = toInt(parseFEN(fen));
    loadPos(bi);
    TURN = side === "r" ? 1 : -1;
    hashPos();
    if (TURN < 0) { HLO ^= ZTL; HHI ^= ZTH; }
    nodes = 0; stopped = false;
    var budget = (msCap && msCap < cfg.ms) ? msCap : cfg.ms;
    deadline = Date.now() + budget;
    for (var i = 0; i < MAXPLY * 2; i++) { killer[i] = 0; }

    var t0 = Date.now();
    var list = legalRootMoves(TURN);
    if (!list.length) { return null; }
    var best = list[0], bestScore = 0, doneDepth = 0;
    var order = [];
    var oscore = [];
    for (i = 0; i < list.length; i++) {
      var mv = list[i];
      var to = ((mv >> 12) & 15) * 9 + ((mv >> 8) & 15);
      var cap = BB[to];
      order.push(i);
      oscore.push(cap ? MAT[cap > 0 ? cap - 1 : 6 - cap] : 0);
    }
    order.sort(function (a, b) { return oscore[b] - oscore[a]; });

    // 重复局面惩罚：避免 AI 在均势时反复走同一步
    var repPen = null;
    if (repList && repList.length) {
      repPen = new Int32Array(list.length);
      var oppSide = side === "r" ? "b" : "r";
      for (i = 0; i < list.length; i++) {
        makeI(0, list[i]);
        repPen[i] = repList.indexOf(toFEN(BB, oppSide)) >= 0 ? 30 : 0;
        unmakeI(0, list[i]);
      }
    }

    for (var d = 1; d <= cfg.depth; d++) {
      var alpha = -INF, bm = 0, bs = -INF, bsv = 0;
      for (var oi = 0; oi < order.length; oi++) {
        var mvi = list[order[oi]];
        makeI(0, mvi);
        TURN = -TURN; HLO ^= ZTL; HHI ^= ZTH;
        var v;
        if (oi === 0) {
          v = -negamax(d - 1, -INF, -alpha, 1);
        } else {
          v = -negamax(d - 1, -alpha - 1, -alpha, 1);
          if (!stopped && v > alpha) { v = -negamax(d - 1, -INF, -alpha, 1); }
        }
        HLO ^= ZTL; HHI ^= ZTH; TURN = -TURN;
        unmakeI(0, mvi);
        if (stopped) { break; }
        var vv = v + (cfg.noise ? (Math.random() * cfg.noise - cfg.noise / 2) : 0);
        if (repPen) { vv -= repPen[order[oi]]; }
        if (vv > bs) { bs = vv; bm = mvi; bsv = v; if (v > alpha) { alpha = v; } }
      }
      if (stopped && bm === 0) { break; }
      if (bm) {
        best = bm; bestScore = bsv; doneDepth = d;
        for (i = 0; i < order.length; i++) { if (list[order[i]] === bm) { order.unshift(order[i]); order.splice(i + 1, 1); break; } }
        if (onInfo) { onInfo({ depth: d, score: bsv, nodes: nodes, ms: Date.now() - t0 }); }
        if (Math.abs(bsv) > MATE - 2000) { break; }
      }
      if (stopped || Date.now() > deadline) { break; }
    }

    var fx = best & 15, fy = (best >> 4) & 15, tx = (best >> 8) & 15, ty = (best >> 12) & 15;
    return {
      fx: fx, fy: fy, tx: tx, ty: ty,
      cap: charOf(bi[ty * 9 + tx]),
      depth: doneDepth, score: bestScore, nodes: nodes, ms: Date.now() - t0
    };
  }

  function bestMove(fen, side, level) { return think(fen, side, level, null); }

  // ---------------- 对外包装（字符版，兼容旧调用） --------------
  function decObj(mv, bChar) {
    var fx = mv & 15, fy = (mv >> 4) & 15, tx = (mv >> 8) & 15, ty = (mv >> 12) & 15;
    return { fx: fx, fy: fy, tx: tx, ty: ty, cap: (bChar && bChar[idx(tx, ty)]) || "" };
  }

  function genMoves(bChar, side) {
    loadPos(toInt(bChar));
    var size = gen(side === "r" ? 1 : -1, lbuf), out = [], i;
    for (i = 0; i < size; i++) { out.push(decObj(lbuf[i], bChar)); }
    return out;
  }

  function legalMoves(bChar, side) {
    var bi = toInt(bChar);
    loadPos(bi);
    var list = legalRootMoves(side === "r" ? 1 : -1), out = [], i;
    for (i = 0; i < list.length; i++) { out.push(decObj(list[i], bChar)); }
    return out;
  }

  function gameOver(bChar, side) {
    var s = side === "r" ? 1 : -1;
    var list = legalMoves(bChar, side);
    if (!list.length) {
      loadPos(toInt(bChar));
      return { over: true, winner: other(side), reason: inCheckI(s) ? "将死" : "困毙" };
    }
    return { over: false };
  }

  // ---------------- 记谱 ----------
  var NAME = { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵" };
  var NAMEB = { K: "将", A: "士", B: "象", N: "马", R: "车", C: "炮", P: "卒" };
  function fileName(x, side) { return side === "r" ? 9 - x : x + 1; }
  var CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  function cn(n) { return CN[n] || String(n); }

  function moveText(b, mv) {
    var p = b[idx(mv.fx, mv.fy)];
    if (!p) { return "?"; }
    var side = sideOf(p), t = p.toUpperCase();
    var nm = side === "r" ? NAME[t] : NAMEB[t];
    var same = 0, isFront = false;
    for (var y = 0; y < 10; y++) {
      var q2 = b[idx(mv.fx, y)];
      if (q2 && sideOf(q2) === side && q2.toUpperCase() === t) {
        same++;
        if (side === "r" ? y < mv.fy : y > mv.fy) { isFront = true; }
      }
    }
    var head;
    if (same >= 2) { head = (isFront ? "前" : "后") + nm; }
    else { head = nm + cn(fileName(mv.fx, side)); }
    if (mv.fy === mv.ty) { return head + "平" + cn(fileName(mv.tx, side)); }
    var forward = side === "r" ? mv.ty < mv.fy : mv.ty > mv.fy;
    var act = forward ? "进" : "退";
    if (t === "N" || t === "B" || t === "A") { return head + act + cn(fileName(mv.tx, side)); }
    return head + act + cn(Math.abs(mv.ty - mv.fy));
  }

  g.XQ = {
    START_FEN: START_FEN,
    LEVELS: LEVELS,
    parseFEN: parseFEN,
    toFEN: toFEN,
    idx: idx,
    isRed: isRed,
    sideOf: sideOf,
    other: other,
    charOf: charOf,
    codeOf: codeOf,
    genMoves: genMoves,
    legalMoves: legalMoves,
    inCheck: inCheck,
    make: make,
    unmake: unmake,
    gameOver: gameOver,
    evalRed: evalRed,
    bestMove: bestMove,
    think: think,
    moveText: moveText,
    findKing: findKing
  };
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis));
