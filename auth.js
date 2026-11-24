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
      "background:#fff;border:1px solid #e3e7ee;border-radius:16px;padding:5px 10px;box-shadow:0 2px 8px #0000000f;" +
      "display:flex;align-items:center;gap:6px;";
    var av = document.createElement("span");
    av.textContent = "👤";
    av.style.cssText = "font-size:16px;line-height:1;";
    var nm = document.createElement("a");
    nm.href = "me.html";
    nm.title = "点这里设置头像和名字";
    nm.textContent = me.email.split("@")[0];
    nm.style.cssText = "color:#2b7cff;text-decoration:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    var tag = document.createElement("span");
    tag.textContent = "· 检测中…";
    tag.style.color = "#8a929e";
    var out = document.createElement("a");
    out.href = "javascript:void 0";
    out.textContent = "退出";
    out.style.cssText = "color:#2b7cff;text-decoration:none;margin-left:4px;";
    out.onclick = function () { logout(); };
    el.appendChild(av); el.appendChild(nm); el.appendChild(tag); el.appendChild(out);
    document.body.appendChild(el);

    // 头像/名字/同步状态直接用本机缓存，先显示出来（不联网、不加载 108KB 的 supabase.js）
    var cp = null;
    try { cp = JSON.parse(localStorage.getItem("byProfile") || "null"); } catch (e) { cp = null; }
    if (cp) {
      if (window.AV) { av.innerHTML = window.AV(cp.avatar, 18); }
      nm.textContent = cp.nick || nm.textContent;
    }
    var flag = null;
    try { flag = localStorage.getItem("bySyncFlag"); } catch (e) { flag = null; }
    if (flag === "1") { tag.textContent = "· ☁️已同步"; tag.style.color = "#2e9e63"; }
    else if (flag === "0") { tag.textContent = "· 仅本机"; tag.style.color = "#c8862a"; }
    else { tag.textContent = ""; }
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

// 头像渲染：以 data:image 开头就当成图片，否则当成表情（所有页面共用）
window.AV = function (a, px) {
  var size = px || 22;
  if (typeof a === "string" && a.indexOf("data:image") === 0) {
    return '<img src="' + a.replace(/"/g, "&quot;") + '" alt="" style="width:' + size + 'px;height:' + size +
      'px;border-radius:50%;object-fit:cover;flex:none;vertical-align:middle;display:inline-block">';
  }
  return '<span style="font-size:' + Math.round(size * 0.92) + 'px;line-height:1;display:inline-block">' +
    (a || "🙂") + '</span>';
};

// ---------- 云端同步（跨设备：题库掌握/错题、游戏榜单） ----------
// 依赖 supabase.js；没加载就动态补上。没登录或不联网时自动退回本机存储。
(function () {
  var URL_ = "https://jrykjjhxfxdkntenilyd.supabase.co";
  function randCode() {
    var s = "";
    for (var i = 0; i < 6; i++) { s += Math.floor(Math.random() * 10); }
    return s;
  }
  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    });
  }
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
        try { localStorage.setItem("bySyncFlag", se ? "1" : "0"); } catch (e) {}
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
    },
    // ---------- 头像 + 昵称 ----------
    // 取我的资料（昵称/头像/好友码）；force=true 时强制从云端刷新
    profile: function (force) {
      var c = null;
      try { c = JSON.parse(localStorage.getItem("byProfile") || "null"); } catch (e) { c = null; }
      if (c && !force) { return Promise.resolve(c); }
      return withSession(function (sb, se) {
        return sb.from("profiles").select("id,nick,avatar,code").eq("id", se.user.id).maybeSingle().then(function (x) {
          var p = x.data || {};
          var em = se.user.email || "";
          var o = { id: se.user.id, nick: p.nick || em.split("@")[0] || "玩家", avatar: p.avatar || "🙂", code: p.code || "" };
          try { localStorage.setItem("byProfile", JSON.stringify(o)); } catch (e) {}
          return o;
        });
      }).then(function (o) {
        if (o) { return o; }
        var s = null;
        try { s = JSON.parse(localStorage.getItem("byAuthUser") || "null"); } catch (e) {}
        return { id: "", nick: (s && s.email ? s.email.split("@")[0] : "玩家"), avatar: "🙂", code: "" };
      }).catch(function () {
        return { id: "", nick: "玩家", avatar: "🙂", code: "" };
      });
    },
    // 保存昵称和头像到云端（所有设备登录都能看到）
    saveProfile: function (nick, avatar) {
      return withSession(function (sb, se) {
        var em = se.user.email || "";
        return sb.from("profiles").select("id,code").eq("id", se.user.id).maybeSingle().then(function (q) {
          var has = !!(q.data && q.data.id);
          var code = (q.data && q.data.code) || "";
          if (has) {
            return sb.from("profiles").update({ nick: nick, avatar: avatar }).eq("id", se.user.id).then(function (u) {
              if (u.error) { throw u.error; }
              return { id: se.user.id, nick: nick, avatar: avatar, code: code };
            });
          }
          return sha256(em.toLowerCase()).then(function (h) {
            var c = code || randCode();
            return sb.from("profiles").insert({ id: se.user.id, code: c, nick: nick, avatar: avatar, email_hash: h }).then(function (u) {
              if (u.error) { throw u.error; }
              return { id: se.user.id, nick: nick, avatar: avatar, code: c };
            });
          });
        });
      }).then(function (o) {
        if (!o) { throw new Error("没登录"); }
        try { localStorage.setItem("byProfile", JSON.stringify(o)); } catch (e) {}
        return o;
      });
    },
    // 批量按 user_id 取资料（榜上显示头像和昵称用；profiles 表是公开可读的）
    profilesByIds: function (ids) {
      if (!ids || !ids.length) { return Promise.resolve({}); }
      return ensure().then(function (sb) {
        if (!sb) { return {}; }
        return sb.from("profiles").select("id,nick,avatar,code").in("id", ids).then(function (x) {
          var m = {};
          (x.data || []).forEach(function (p) { m[p.id] = p; });
          return m;
        });
      }).catch(function () { return {}; });
    },
    // 我的好友 id 集合
    friendIds: function () {
      return withSession(function (sb, se) {
        return sb.from("friends").select("owner,friend")
          .or("owner.eq." + se.user.id + ",friend.eq." + se.user.id)
          .then(function (x) {
            var out = {};
            (x.data || []).forEach(function (r) { out[r.owner === se.user.id ? r.friend : r.owner] = 1; });
            return out;
          });
      }).then(function (o) { return o || {}; }).catch(function () { return {}; });
    },
    // 加好友（重复加不会报错）
    addFriend: function (uid) {
      return withSession(function (sb, se) {
        if (uid === se.user.id) { throw new Error("不能加自己"); }
        return sb.from("friends").insert({ owner: se.user.id, friend: uid }).then(function (x) {
          if (x.error) {
            if (x.error.code === "23505") { return true; }
            throw x.error;
          }
          return true;
        });
      });
    },
    // ---------- 大世界（公共留言墙，所有账号都能看到） ----------
    worldList: function (limit) {
      return ensure().then(function (sb) {
        if (!sb) { return []; }
        return sb.from("world_msgs").select("id,user_id,body,created_at")
          .order("id", { ascending: false }).limit(limit || 60)
          .then(function (x) {
            if (x.error) { throw x.error; }
            return (x.data || []).slice().reverse();
          });
      }).catch(function () { return []; });
    },
    worldSend: function (body) {
      return withSession(function (sb, se) {
        return sb.from("world_msgs").insert({ user_id: se.user.id, body: body }).then(function (x) {
          if (x.error) { throw x.error; }
          return true;
        });
      });
    },
    worldDelete: function (id) {
      return withSession(function (sb, se) {
        return sb.from("world_msgs").delete().eq("id", id).eq("user_id", se.user.id).then(function (x) {
          if (x.error) { throw x.error; }
          return true;
        });
      });
    },
    // 我屏蔽了谁（这些人的大世界消息我不看）
    blockedIds: function () {
      return withSession(function (sb, se) {
        return sb.from("blocks").select("target").eq("owner", se.user.id).then(function (x) {
          var out = {};
          (x.data || []).forEach(function (r) { out[r.target] = 1; });
          return out;
        });
      }).then(function (o) { return o || {}; }).catch(function () { return {}; });
    },
    blockUser: function (uid) {
      return withSession(function (sb, se) {
        if (uid === se.user.id) { throw new Error("不能屏蔽自己"); }
        return sb.from("blocks").insert({ owner: se.user.id, target: uid }).then(function (x) {
          if (x.error) {
            if (x.error.code === "23505") { return true; }
            throw x.error;
          }
          return true;
        });
      });
    },
    unblockUser: function (uid) {
      return withSession(function (sb, se) {
        return sb.from("blocks").delete().eq("owner", se.user.id).eq("target", uid).then(function (x) {
          if (x.error) { throw x.error; }
          return true;
        });
      });
    }
  };
})();

// 全局：手机/电脑上点一下就立刻有反馈（去掉点击高亮延迟，按钮按下缩一点）
(function () {
  var css = "*{-webkit-tap-highlight-color:transparent}" +
    "button,a,.ava,.app,.fr{-webkit-touch-callout:none}" +
    "button:active,.ava:active,.app:active{transform:scale(.97)}";
  function put() {
    try {
      var s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    } catch (e) {}
  }
  if (document.head) { put(); } else { document.addEventListener("DOMContentLoaded", put); }
})();