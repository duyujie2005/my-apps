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
    el.innerHTML = "👤 " + name + ' <a href="javascript:void 0" style="color:#2b7cff;text-decoration:none;margin-left:6px">退出</a>';
    el.querySelector("a").onclick = function () { logout(); };
    document.body.appendChild(el);
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
