/* 象棋 AI 后台线程：把长考从主线程挪走，页面不卡 */
importScripts("xiangqi.js");

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type !== "go") { return; }
  var t0 = Date.now();
  try {
    var res = self.XQ.think(d.fen, d.side, d.level, function (info) {
      self.postMessage({
        type: "info", id: d.id, depth: info.depth,
        score: info.score, nodes: info.nodes, ms: info.ms
      });
    }, d.repList || null);
    self.postMessage({ type: "move", id: d.id, mv: res, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ type: "error", id: d.id, msg: String((err && err.message) || err) });
  }
};
