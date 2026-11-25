/* 杜裕杰的软件柜 · 离线缓存（Service Worker）
   策略：先用本地缓存立刻显示（几乎 0 延迟），同时后台悄悄下载最新版，下次打开就是新版。 */
const CACHE = "shelf-v18";

const FILES = [
  "./",
  "index.html",
  "login.html",
  "auth.js",
  "friends.html",
  "me.html",
  "world.html",
  "jizhangben.html",
  "tiku.html",
  "kuaiji.html",
  "baoan.html",
  "quiz.css",
  "quiz.js",
  "whack.html",
  "reflex.html",
  "hero.html",
  "xiangqi.html",
  "xiangqi.js",
  "privacy.html",
  "manifest.json",
  "logo-96.png",
  "libai.png",
  "supabase.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个缓存：某个文件失败也不影响其他文件进缓存（addAll 失败会整批作废）
      return Promise.all(FILES.map(function (f) {
        return cache.add(new Request(f, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 后台更新缓存，不阻塞页面；同一文件 5 分钟内只刷新一次，避免重复下载
const lastRefresh = {};
function refresh(req) {
  const key = req.url.split("?")[0];
  const now = Date.now();
  if (lastRefresh[key] && now - lastRefresh[key] < 300000) { return Promise.resolve(null); }
  lastRefresh[key] = now;
  return fetch(req).then(function (res) {
    if (res && res.ok && res.type !== "opaque") {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(new Request(key), copy); });
    }
    return res;
  }).catch(function () { return null; });
}

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") { return; }
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) { return; }

  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(function (hit) {
      if (hit) {
        refresh(req);                        // 后台悄悄更新，页面不等
        return hit;
      }
      return refresh(req).then(function (res) {
        if (res) { return res; }
        if (req.mode === "navigate") { return caches.match("index.html", { ignoreSearch: true, ignoreVary: true }); }
        return new Response("", { status: 504 });
      }).catch(function () {
        if (req.mode === "navigate") { return caches.match("index.html", { ignoreSearch: true, ignoreVary: true }); }
        return new Response("", { status: 504 });
      });
    })
  );
});
