/** 模拟 GitHub Pages 子目录部署：所有资源挂在 /<prefix>/ 下。 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "docs");
const PORT = Number(process.env.PORT || 8850);
const PREFIX = process.env.PREFIX || "runoob-mobile"; // 模拟 /runoob-mobile/

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".nojekyll": "text/plain",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!p.startsWith("/" + PREFIX)) {
      res.writeHead(404).end("expect /" + PREFIX + "/");
      return;
    }
    p = p.slice(PREFIX.length + 1) || "index.html";
    if (p === "" || p === "/") p = "index.html";

    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 " + p);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Service-Worker-Allowed": "/" + PREFIX + "/",
    });
    res.end(fs.readFileSync(full));
  })
  .listen(PORT, () => {
    console.log(`Pages 模拟服务器: http://localhost:${PORT}/${PREFIX}/`);
  });
