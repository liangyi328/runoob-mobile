/** 子目录部署（如 GitHub Pages /owner.github.io/repo/）下的真实渲染验证。 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8850/runoob-mobile";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("requestfailed", (r) => {
  // 图片是外链，离线失败属预期；只记录非图片失败
  if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(r.url())) {
    errors.push("REQFAIL: " + r.url() + " :: " + r.failure()?.errorText);
  }
});

console.log("BASE =", BASE);
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const cards = await page.locator(".tut-card").count();
const sub = await page.locator(".home .sub").textContent().catch(() => null);
console.log("  首页卡片:", cards, "| 副标题:", sub?.replace(/\s+/g, " ").trim());

// 数据是否真的加载成功（子目录路径是否解析正确）
const flat = await page.evaluate(() => window.performance.getEntriesByType("resource")
  .filter(r => r.name.includes("/data/")).map(r => r.name.split("/").pop() + ":" + r.responseStatus));
console.log("  数据请求:", flat.join("  "));

// 打开章节
await page.goto(BASE + "/index.html#python3%2Fpython3-list.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("  章节标题:", await page.locator(".article-inner h1").textContent().catch(() => "null"));
console.log("  代码块:", await page.locator(".code-box").count(),
            "| 表格:", await page.locator(".tw").count());

// Service Worker 注册（Pages 子目录下 scope 是否正确）
const sw = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const r = await navigator.serviceWorker.getRegistration();
  return r ? "registered: " + r.scope : "not registered";
});
console.log("  ServiceWorker:", sw);

// manifest 是否可读
const mf = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.href;
  if (!href) return "no link";
  try { const r = await fetch(href); return r.status + " " + href; }
  catch (e) { return "ERR " + e.message; }
});
console.log("  manifest:", mf);

await page.screenshot({ path: "_scratch/shot-pages.png" });
console.log("  截图: _scratch/shot-pages.png");

console.log("\n=== 错误 ===");
console.log(errors.length ? errors.join("\n") : "无 ✓");
await browser.close();
