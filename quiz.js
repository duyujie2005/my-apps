// 通用答题引擎 —— 三个题库共用
// 页面只需提供 window.QUIZ_CFG，然后引入本文件
(function () {
  var CFG = window.QUIZ_CFG || {};
  var BANK = CFG.bank || [];
  var MODULES = CFG.modules || [{ k: "全部", n: "全部" }];
  var MODNAME = {};
  MODULES.forEach(function (m) { MODNAME[m.k] = m.n; });
  var KEYS = CFG.keys || { wrong: "qzWrong", master: "qzMaster" };
  var AUTO_MS = 1200;
  var SKIP_KEY = "qzSkipMaster";

  var wrongSet = new Set();
  var masterSet = new Set();
  try { JSON.parse(localStorage.getItem(KEYS.wrong) || "[]").forEach(function (t) { wrongSet.add(t); }); } catch (e) {}
  try { JSON.parse(localStorage.getItem(KEYS.master) || "[]").forEach(function (t) { masterSet.add(t); }); } catch (e) {}

  var moduleFilter = "全部";
  var mode = "order";
  var list = [];
  var idx = 0;
  var answered = false;
  var picks = [];
  var rightCount = 0;
  var doneCount = 0;
  var newMaster = 0;
  var autoNext = true;
  var skipMaster = localStorage.getItem(SKIP_KEY) === "1";
  var timer = null;
  var view = "quiz";

  function saveWrong() { localStorage.setItem(KEYS.wrong, JSON.stringify(Array.from(wrongSet))); schedulePush(); }
  function saveMaster() { localStorage.setItem(KEYS.master, JSON.stringify(Array.from(masterSet))); schedulePush(); }

  // ---------- 跨设备同步（登录同一账号后，错题/掌握记录跟着账号走） ----------
  var SYNC_KEY = "quiz:" + (KEYS.wrong || "qzWrong");
  var pushTimer = null;
  function schedulePush() {
    if (!window.SYNC) { return; }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushCloud, 800);
  }
  function pushCloud() {
    if (!window.SYNC) { return; }
    window.SYNC.set(SYNC_KEY, { wrong: Array.from(wrongSet), master: Array.from(masterSet) }).catch(function () {});
  }
  function cloudMerge() {
    if (!window.SYNC) { return; }
    window.SYNC.get(SYNC_KEY).then(function (d) {
      if (!d) { pushCloud(); return; }
      var changed = false;
      (d.wrong || []).forEach(function (t) { if (!wrongSet.has(t)) { wrongSet.add(t); changed = true; } });
      (d.master || []).forEach(function (t) { if (!masterSet.has(t)) { masterSet.add(t); changed = true; } });
      if (changed) {
        localStorage.setItem(KEYS.wrong, JSON.stringify(Array.from(wrongSet)));
        localStorage.setItem(KEYS.master, JSON.stringify(Array.from(masterSet)));
        buildChips(); setSubtitle(); updateStat(); updateProg();
      }
      pushCloud();
    }).catch(function () {});
  }

  function optionText(q) { return q.t === "judge" ? ["正确", "错误"] : q.o; }
  function isRight(q, chosen) {
    if (q.t === "judge") { return (q.a ? 0 : 1) === chosen[0]; }
    if (q.t === "single") { return q.a === chosen[0]; }
    return q.a.slice().sort().join(",") === chosen.slice().sort().join(",");
  }
  function rightAnswerText(q) {
    if (q.t === "judge") { return q.a ? "正确" : "错误"; }
    if (q.t === "single") { return q.o[q.a]; }
    return q.a.map(function (i) { return q.o[i]; }).join("、");
  }
  function typeName(t) { return t === "judge" ? "判断题" : (t === "single" ? "单选题" : "多选题"); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- 页面骨架 ----------
  function $(id) { return document.getElementById(id); }

  function buildSkeleton() {
    var app = document.getElementById("app");
    var chips = MODULES.map(function (m) { return '<button class="chip" data-k="' + m.k + '"></button>'; }).join("");
    app.innerHTML =
      '<h1>' + escapeHtml(CFG.title || "题库") + '</h1>' +
      '<p class="sub">' + (CFG.sub || "") + '</p>' +
      '<div class="chips" id="chips">' + chips + '</div>' +
      '<div class="bar">' +
        '<button id="btnOrder">顺序练</button>' +
        '<button id="btnRandom">随机练</button>' +
        '<button id="btnWrong">只练错题</button>' +
        '<button id="btnBook">错题本</button>' +
        '<button id="btnExport">导出错题</button>' +
        '<button id="btnReset">清空记录</button>' +
      '</div>' +
      '<div class="switches">' +
        '<label class="toggle"><input type="checkbox" id="autoChk" checked> 答对后自动下一题（1.2 秒）</label>' +
        '<label class="toggle"><input type="checkbox" id="skipChk"> 跳过已掌握的题（做对过的不再出现）</label>' +
      '</div>' +
      '<div class="prog"><div class="progbar" id="progbar"></div></div>' +
      '<p class="progcap" id="progcap"></p>' +
      '<div class="card" id="card"></div>' +
      '<p class="stat" id="stat"></p>' +
      '<p class="sub" style="margin-top:18px">' + (CFG.note || "") + '</p>';

    $("chips").querySelectorAll(".chip").forEach(function (b) {
      b.onclick = function () { moduleFilter = b.dataset.k; view = "quiz"; buildChips(); start(); };
    });
    $("btnOrder").onclick = function () { setMode("order"); };
    $("btnRandom").onclick = function () { setMode("random"); };
    $("btnWrong").onclick = practiceWrong;
    $("btnBook").onclick = showWrongBook;
    $("btnExport").onclick = exportWrong;
    $("btnReset").onclick = resetAll;
    $("autoChk").onchange = function () { autoNext = this.checked; };
    $("skipChk").checked = skipMaster;
    $("skipChk").onchange = function () {
      skipMaster = this.checked;
      localStorage.setItem(SKIP_KEY, skipMaster ? "1" : "0");
      start();
    };
  }

  function buildChips() {
    $("chips").querySelectorAll(".chip").forEach(function (b) {
      var k = b.dataset.k;
      var pool = k === "全部" ? BANK : BANK.filter(function (q) { return q.m === k; });
      var done = pool.filter(function (q) { return masterSet.has(q.q); }).length;
      b.className = "chip" + (k === moduleFilter ? " on" : "");
      b.textContent = (k === "全部" ? "全部" : (MODNAME[k] || k)) + "(" + done + "/" + pool.length + ")";
    });
  }

  function setSubtitle() {
    var c = { judge: 0, single: 0, multi: 0 };
    BANK.forEach(function (q) { c[q.t]++; });
    var parts = MODULES.filter(function (m) { return m.k !== "全部"; }).map(function (m) {
      return (MODNAME[m.k] || m.k) + " " + BANK.filter(function (q) { return q.m === m.k; }).length;
    });
    var mastered = BANK.filter(function (q) { return masterSet.has(q.q); }).length;
    var sub = $("app").querySelector(".sub");
    sub.innerHTML = "共 " + BANK.length + " 题（" + parts.join("、") + "）｜判断 " + c.judge +
      "、单选 " + c.single + "、多选 " + c.multi + "；已掌握 " + mastered + " 题。<br>" +
      "答对即记为“已掌握”，下一轮不会再出现；想重刷可以关掉“跳过已掌握的题”。";
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function poolOf(filter) {
    var pool = BANK.filter(function (q) { return filter === "全部" || q.m === filter; });
    var skipped = 0;
    if (skipMaster) {
      var all = pool.length;
      pool = pool.filter(function (q) { return !masterSet.has(q.q); });
      skipped = all - pool.length;
    }
    return { pool: pool, skipped: skipped };
  }

  function start() {
    clearTimeout(timer);
    view = "quiz";
    var r = poolOf(moduleFilter);
    list = mode === "random" ? shuffle(r.pool) : r.pool;
    idx = 0; rightCount = 0; doneCount = 0; newMaster = 0;
    if (list.length === 0) {
      var cardEl = $("card");
      cardEl.innerHTML = "<p class='done'>这个范围里的题你已经全掌握了（" + r.skipped + " 题都做对过）。<br>" +
        "想再巩固，把上面“跳过已掌握的题”关掉就能重刷。</p>";
      $("stat").textContent = "";
      updateProg();
      return;
    }
    show();
  }

  function setMode(m) {
    mode = m;
    $("btnOrder").style.background = m === "order" ? "#2b7cff" : "";
    $("btnOrder").style.color = m === "order" ? "#fff" : "";
    $("btnRandom").style.background = m === "random" ? "#2b7cff" : "";
    $("btnRandom").style.color = m === "random" ? "#fff" : "";
    start();
  }

  function practiceWrong() {
    clearTimeout(timer);
    var pool = BANK.filter(function (q) { return wrongSet.has(q.q); });
    if (pool.length === 0) { alert("错题本是空的，先练一轮吧。"); return; }
    view = "quiz";
    list = mode === "random" ? shuffle(pool) : pool;
    idx = 0; rightCount = 0; doneCount = 0; newMaster = 0;
    show();
  }

  function showWrongBook() {
    clearTimeout(timer);
    view = "wrongbook";
    var items = BANK.filter(function (q) { return wrongSet.has(q.q); });
    var html = "<div class='meta'><span class='tag'>错题本</span><span>共 " + items.length + " 题</span></div>";
    if (items.length === 0) {
      html += "<p class='done'>错题本还是空的。练题时答错会自动存到这里。</p>";
    } else {
      html += "<div class='wlist'>";
      items.forEach(function (q, i) {
        html += "<div class='witem'><p class='wq'>" + (i + 1) + ". " + escapeHtml(q.q) + "</p>" +
          "<p class='wa'>正确答案：" + escapeHtml(rightAnswerText(q)) + "</p>" +
          "<p class='we'>" + escapeHtml(q.e || "") + "</p></div>";
      });
      html += "</div>";
    }
    html += "<div class='foot'><button id='fPractice'>练这些错题</button>" +
      "<button class='ghost' id='fBack'>返回练题</button></div>";
    $("card").innerHTML = html;
    $("fPractice").onclick = practiceWrong;
    $("fBack").onclick = function () { view = "quiz"; clearTimeout(timer); show(); };
    updateStat();
  }

  function resetAll() {
    if (!confirm("清空错题本、已掌握记录和本轮统计？")) { return; }
    wrongSet = new Set();
    masterSet = new Set();
    localStorage.removeItem(KEYS.wrong);
    localStorage.removeItem(KEYS.master);
    pushCloud();
    buildChips();
    setSubtitle();
    start();
  }

  function show() {
    answered = false;
    picks = [];
    clearTimeout(timer);

    if (idx >= list.length) {
      var rate = doneCount === 0 ? 0 : Math.round(rightCount / doneCount * 100);
      $("card").innerHTML = "<p class='done'>这一轮练完了：共 " + doneCount + " 题，答对 " + rightCount +
        " 题，正确率 " + rate + "%。<br>本轮新掌握 <b>" + newMaster + "</b> 题，这些题以后不会再出现。<br>" +
        "答错的题已存进错题本（共 " + wrongSet.size + " 题）。</p>" +
        "<div class='foot'><button id='fAgain'>再练一轮</button>" +
        "<button class='ghost' id='fWrong'>只练错题</button>" +
        "<button class='ghost' id='fBook'>看错题本</button></div>";
      $("fAgain").onclick = start;
      $("fWrong").onclick = practiceWrong;
      $("fBook").onclick = showWrongBook;
      updateStat();
      updateProg();
      return;
    }

    var q = list[idx];
    var opts = optionText(q);
    var isM = masterSet.has(q.q);
    var html = "<div class='meta'><span class='tag'>" + escapeHtml(MODNAME[q.m] || "综合") +
      "</span><span class='tag type'>" + typeName(q.t) + "</span>" +
      (isM ? "<span class='tag mastered'>已掌握</span>" : "") +
      "<span>第 " + (idx + 1) + " / " + list.length + " 题</span></div>";
    html += "<p class='qtext'>" + escapeHtml(q.q) + "</p><div id='opts'>";
    opts.forEach(function (o, i) {
      html += "<button class='opt' data-i='" + i + "'>" + escapeHtml(o) + "</button>";
    });
    html += "</div><div id='feedback'></div><div class='foot' id='foot'></div>";
    $("card").innerHTML = html;
    $("opts").querySelectorAll(".opt").forEach(function (b) {
      b.onclick = function () { pick(Number(b.dataset.i)); };
    });
    renderFoot();
    updateStat();
    updateProg();
  }

  function renderFoot() {
    var q = list[idx];
    var html = "";
    if (q.t === "multi" && !answered) { html = "<button id='fSubmit'>提交答案</button>"; }
    if (answered && !(isRight(q, picks) && autoNext)) { html += "<button id='fNext'>下一题</button>"; }
    html += "<button class='ghost' id='fSkip'>跳过</button>";
    $("foot").innerHTML = html;
    if ($("fSubmit")) { $("fSubmit").onclick = submitMulti; }
    if ($("fNext")) { $("fNext").onclick = nextQ; }
    $("fSkip").onclick = skipQ;
  }

  function pick(i) {
    if (answered) { return; }
    var q = list[idx];
    var btns = document.querySelectorAll("#opts .opt");
    if (q.t === "multi") {
      var pos = picks.indexOf(i);
      if (pos >= 0) { picks.splice(pos, 1); } else { picks.push(i); }
      btns.forEach(function (b, k) { b.className = "opt" + (picks.indexOf(k) >= 0 ? " pick" : ""); });
      return;
    }
    picks = [i];
    judge();
  }

  function submitMulti() {
    if (picks.length === 0) { alert("先选好答案再提交。"); return; }
    judge();
  }

  function judge() {
    var q = list[idx];
    var btns = document.querySelectorAll("#opts .opt");
    var ok = isRight(q, picks);
    answered = true;
    doneCount++;
    if (ok) {
      rightCount++;
      if (!masterSet.has(q.q)) { masterSet.add(q.q); newMaster++; saveMaster(); buildChips(); setSubtitle(); }
      wrongSet.delete(q.q);
      saveWrong();
    } else {
      wrongSet.add(q.q);
      saveWrong();
    }

    var rightIdx = q.t === "judge" ? [(q.a ? 0 : 1)] : (q.t === "single" ? [q.a] : q.a);
    btns.forEach(function (b, k) {
      b.className = "opt";
      if (rightIdx.indexOf(k) >= 0) { b.className = "opt right"; }
      else if (picks.indexOf(k) >= 0) { b.className = "opt wrong"; }
      else { b.className = "opt dim"; }
      b.onclick = null;
    });

    var fb = $("feedback");
    if (ok) {
      fb.innerHTML = "<p class='result ok'>✅ 答对了 · 已记为掌握</p><p class='exp'>" + escapeHtml(q.e || "") + "</p>" +
        (autoNext ? "<p class='hint'>马上进入下一题…</p>" : "");
      if (autoNext) { timer = setTimeout(nextQ, AUTO_MS); }
    } else {
      fb.innerHTML = "<p class='result no'>❌ 答错了，正确答案：" + escapeHtml(rightAnswerText(q)) + "</p>" +
        "<p class='exp'>" + escapeHtml(q.e || "") + "</p>" +
        "<p class='hint'>这道题已自动存进错题本（共 " + wrongSet.size + " 题）</p>";
    }
    renderFoot();
    updateStat();
    updateProg();
  }

  function nextQ() { clearTimeout(timer); idx++; show(); }
  function skipQ() { clearTimeout(timer); idx++; show(); }

  function updateStat() {
    var rate = doneCount === 0 ? 0 : Math.round(rightCount / doneCount * 100);
    $("stat").innerHTML = "本轮已答 " + doneCount + " 题，答对 " + rightCount + " 题，正确率 " + rate +
      "%　｜　错题本：" + wrongSet.size + " 题　｜　题库共 " + BANK.length + " 题";
  }

  function updateProg() {
    var pool = moduleFilter === "全部" ? BANK : BANK.filter(function (q) { return q.m === moduleFilter; });
    var done = pool.filter(function (q) { return masterSet.has(q.q); }).length;
    var pct = pool.length ? done / pool.length * 100 : 0;
    if ($("progbar")) { $("progbar").style.width = pct.toFixed(1) + "%"; }
    if ($("progcap")) {
      $("progcap").textContent = "已掌握 " + done + " / " + pool.length + " 题（" +
        (moduleFilter === "全部" ? "全部" : (MODNAME[moduleFilter] || moduleFilter)) + "）";
    }
  }

  function exportWrong() {
    var items = BANK.filter(function (q) { return wrongSet.has(q.q); });
    if (items.length === 0) { alert("错题本是空的，先练一轮吧。"); return; }
    var txt = (CFG.title || "题库") + " · 错题本（共 " + items.length + " 题）\n\n";
    items.forEach(function (q, i) {
      txt += (i + 1) + ". [" + (MODNAME[q.m] || "综合") + " / " + typeName(q.t) + "] " + q.q + "\n";
      if (q.t !== "judge") {
        q.o.forEach(function (o, k) { txt += "    " + "ABCD"[k] + ". " + o + "\n"; });
      }
      txt += "    答案：" + rightAnswerText(q) + "\n    解析：" + (q.e || "") + "\n\n";
    });
    var blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (CFG.fileName || "错题本") + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  document.addEventListener("keydown", function (e) {
    if (view !== "quiz" || !list.length || idx >= list.length) { return; }
    var q = list[idx];
    if (e.key === "Enter") {
      if (q.t === "multi" && !answered) { submitMulti(); }
      else if (answered) { nextQ(); }
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      var n = Number(e.key) - 1;
      var cnt = q.t === "judge" ? 2 : q.o.length;
      if (n < cnt) { e.preventDefault(); pick(n); }
    }
  });

  buildSkeleton();
  buildChips();
  setSubtitle();
  setMode("order");
  cloudMerge();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
