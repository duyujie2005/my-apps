// 全站登录门禁：任何页面引入本文件即生效
// 用法：<script src="auth.js" data-guard="1"></script>
(function () {
  var KEY = "byAuthUser";
  var DAY = 86400000;
  var KEEP_DAYS = 30;

  function readRaw() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  function currentUser() {
    var s = readRaw();
    if (!s || !s.email) { return null; }
    if (Date.now() - (s.ts || 0) > KEEP_DAYS * DAY) { localStorage.removeItem(KEY); return null; }
    return s;
  }

  function setUser(email) {
    localStorage.setItem(KEY, JSON.stringify({ email: email, ts: Date.now() }));
  }

  function clearUser() { localStorage.removeItem(KEY); }

  function nextTarget() {
    var file = location.pathname.split("/").pop() || "index.html";
    return file + location.search;
  }

  function guard() {
    if (location.pathname.split("/").pop() === "login.html") { return true; }
    if (!currentUser()) {
      location.replace("login.html?next=" + encodeURIComponent(nextTarget()));
      return false;
    }
    return true;
  }

  function chip() {
    var me = currentUser();
    if (!me) { return; }
    var el = document.createElement("div");
    el.style.cssText = "position:fixed;right:12px;top:10px;z-index:20;font-size:12px;color:#6b7481;" +
      "background:#fff;border:1px solid #e3e7ee;border-radius:16px;padding:5px 10px;box-shadow:0 2px 8px #0000000f;";
    var name = me.email.split("@")[0];
    el.innerHTML = "👤 " + name + ' <span style="color:#8a929e">· 检测中…</span> <a href="javascript:void 0" style="color:#2b7cff;text-decoration:none;margin-left:6px">退出</a>';
    el.querySelector("a").onclick = function () { logout(); };
    document.body.appendChild(el);

    // 显示"记录是否已跟账号同步"，让人一眼看得出来
    if (window.SYNC) {
      window.SYNC.online().then(function (ok) {
        var tag = el.querySelector("span");
        if (!tag) { return; }
        tag.textContent = ok ? "· ☁️已同步" : "· 仅本机";
        tag.style.color = ok ? "#2e9e63" : "#c8862a";
      }).catch(function () {});
    }
  }

  function logout() {
    clearUser();
    try {
      if (window.supabase && window.SB_CLIENT) { SB_CLIENT.auth.signOut(); }
    } catch (e) {}
    location.replace("login.html");
  }

  window.AUTH = {
    user: currentUser,
    setUser: setUser,
    clear: clearUser,
    logout: logout,
    guard: guard
  };

  // 门禁
  var self = document.currentScript;
  var needGuard = self && self.dataset ? self.dataset.guard === "1" : false;
  if (needGuard) {
    if (!guard()) { return; }
    if (document.body) { chip(); } else {
      document.addEventListener("DOMContentLoaded", chip);
    }
  }
})();

// ---------- 云端同步（跨设备：题库掌握/错题、游戏榜单） ----------
// 依赖 supabase.js；没加载就动态补上。没登录或不联网时自动退回本机存储。
(function () {
  var URL_ = "https://jrykjjhxfxdkntenilyd.supabase.co";
  var KEY_ = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyeWtqamh4Znhka250ZW5pbHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MjUyMTcsImV4cCI6MjExMTAwMTIxN30.eEW940nO8CqJz6HB_4fZvPbbr4S10O5yhBLdXrLAZAg";
  var readyP = null;

  function ensure() {
    if (window.SB_CLIENT) { return Promise.resolve(window.SB_CLIENT); }
    if (readyP) { return readyP; }
    readyP = new Promise(function (res) {
      function mk() {
        try {
          window.SB_CLIENT = supabase.createClient(URL_, KEY_);
        } catch (e) { window.SB_CLIENT = null; }
        res(window.SB_CLIENT);
      }
      if (window.supabase) { mk(); return; }
      var s = document.createElement("script");
      s.src = "supabase.js";
      s.onload = mk;
      s.onerror = function () { res(null); };
      document.head.appendChild(s);
    });
    return readyP;
  }

  function withSession(fn) {
    return ensure().then(function (sb) {
      if (!sb) { return null; }
      return sb.auth.getSession().then(function (r) {
        var se = r && r.data ? r.data.session : null;
        if (!se) { return null; }
        return fn(sb, se);
      });
    });
  }

  window.SYNC = {
    ready: ensure,
    // 有云端账号会话吗？（用于界面上提示"已同步 / 仅本机"）
    online: function () {
      return withSession(function () { return true; }).catch(function () { return false; }).then(function (v) { return !!v; });
    },
    get: function (app) {
      return withSession(function (sb) {
        return sb.from("appdata").select("data").eq("app", app).maybeSingle().then(function (x) {
          if (x.error) { throw x.error; }
          return x.data ? x.data.data : null;
        });
      });
    },
    set: function (app, data) {
      return withSession(function (sb, se) {
        return sb.from("appdata").upsert({
          user_id: se.user.id,
          app: app,
          data: data,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id,app" }).then(function (x) {
          if (x.error) { throw x.error; }
          return true;
        });
      });
    },
    // 传一局成绩到全站榜单（会显示是谁打的）
    submitScore: function (game, score, valid, extra) {
      return withSession(function (sb, se) {
        var name = ((se.user.email || "").split("@")[0]) || "玩家";
        return sb.from("scores").insert({
          user_id: se.user.id,
          game: game,
          name: name,
          score: score,
          valid: (valid === undefined ? null : valid),
          extra: extra || {}
        }).then(function (x) {
          if (x.error) { throw x.error; }
          return true;
        });
      });
    },
    // 取全站榜：ascending=true 时小的排前面（反射弧用）；同一个人只保留最好的一条
    topScores: function (game, n, ascending) {
      var want = n || 10;
      return ensure().then(function (sb) {
        if (!sb) { return []; }
        return sb.from("scores")
          .select("user_id,name,score,valid,created_at")
          .eq("game", game)
          .order("score", { ascending: !!ascending })
          .limit(Math.min(want * 6, 60))
          .then(function (x) {
            if (x.error) { throw x.error; }
            var rows = x.data || [];
            var seen = {};
            var out = [];
            for (var i = 0; i < rows.length; i++) {
              var k = rows[i].user_id || ("n:" + rows[i].name);
              if (seen[k]) { continue; }
              seen[k] = 1;
              out.push(rows[i]);
              if (out.length >= want) { break; }
            }
            return out;
          });
      }).catch(function () { return []; });
    }
  };
})();
