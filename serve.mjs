/** 本地预览服务器：只读静态服务，用于手机同局域网访问与 PWA 验证。 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "app");
const PORT = Number(process.env.PORT || 8848);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/" || p === "") p = "/index.html";

  const full = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 " + p);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
    res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const nets = Object.values(os.networkInterfaces()).flat();
  const lan = nets.find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`\n  菜鸟教程手机学习版已启动\n`);
  console.log(`  本机:   http://localhost:${PORT}`);
  if (lan) console.log(`  手机:   http://${lan}:${PORT}   ← 手机连同一 WiFi 后访问`);
  console.log(`\n  手机 Chrome 打开后：菜单 → 「添加到主屏幕」即可像 App 一样离线使用`);
  console.log(`  Ctrl+C 停止\n`);
});
