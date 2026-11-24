/* 杜裕杰的软件柜 · 离线缓存（Service Worker）
   作用：第一次打开把页面存到手机/电脑本地，以后断网也能打开。 */
const CACHE = "shelf-v10";

const FILES = [
  "./",
  "index.html",
  "login.html",
  "auth.js",
  "friends.html",
  "jizhangben.html",
  "tiku.html",
  "kuaiji.html",
  "baoan.html",
  "quiz.css",
  "quiz.js",
  "whack.html",
  "reflex.html",
  "hero.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "libai.png",
  "supabase.js"
];

// 安装：把清单里的文件一次性存进本地缓存
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES);
    }).then(function () { return self.skipWaiting(); })
  );
});

// 激活：清掉旧版本的缓存
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 取文件：页面优先走网络（保证是最新版），断网就用本地缓存
self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") { return; }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }   // 外站资源不接管

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match("index.html"); });
      })
    );
    return;
  }

  // 代码类文件（html/js/css/json）一律先走网络，保证每次更新都能立刻生效；断网才用缓存
  const isCode = /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isCode) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match("index.html"); });
      })
    );
    return;
  }

  // 图片等静态资源仍走缓存优先，省流量、断网也能看
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) { return hit; }
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
