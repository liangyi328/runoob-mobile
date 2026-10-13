/** 渲染冒烟：用无头浏览器加载页面，检查 JS 报错与关键 DOM 渲染。 */
import { chromium } from "playwright";

const BASE = "http://localhost:8848";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },   // iPhone 14 竖屏
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

console.log("→ 打开首页");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const homeCards = await page.locator(".tut-card").count();
const homeTitle = await page.locator(".home h1").textContent();
console.log(`  首页卡片: ${homeCards}  标题: ${homeTitle}`);

// 打开一个具体章节
console.log("→ 打开章节 python3/python3-list.html");
await page.goto(BASE + "/#python3%2Fpython3-list.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const artTitle = await page.locator(".article-inner h1").textContent().catch(() => null);
const codeBoxes = await page.locator(".code-box").count();
const tables = await page.locator(".tw").count();
const imgs = await page.locator(".article-inner img").count();
const pagerBtns = await page.locator(".pager button").count();
console.log(`  标题: ${artTitle}`);
console.log(`  代码块: ${codeBoxes}  表格容器: ${tables}  图片: ${imgs}  翻页按钮: ${pagerBtns}`);

// 检查横向溢出（手机端关键：正文不应超出视口）
const overflow = await page.evaluate(() => {
  const bad = [];
  const vw = document.documentElement.clientWidth;
  document.querySelectorAll(".article-inner *").forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.width > vw + 2 && !n.closest(".tw") && !n.closest(".code-box")) {
      bad.push(n.tagName + "." + (n.className || "").toString().slice(0, 30) + " w=" + Math.round(r.width));
    }
  });
  return { vw, bad: bad.slice(0, 8) };
});
console.log(`  视口宽: ${overflow.vw}  溢出元素: ${overflow.bad.length ? overflow.bad.join(" | ") : "无 ✓"}`);

// 抽屉目录
console.log("→ 测试抽屉目录");
await page.locator("#btnMenu").click();
await page.waitForTimeout(500);
const drawerVisible = await page.locator("#drawer.show").count();
const links = await page.locator("#drawerBody a[data-path]").count();
console.log(`  抽屉打开: ${drawerVisible > 0}  目录条目: ${links}`);
await page.locator("#btnCloseDrawer").click();
await page.waitForTimeout(300);

// 搜索
console.log("→ 测试搜索「列表推导式」");
await page.locator("#btnSearch").click();
await page.waitForTimeout(300);
await page.locator("#searchInput").fill("列表推导式");
await page.waitForTimeout(900);
const results = await page.locator(".sr-item").count();
console.log(`  搜索结果: ${results}`);

// 截图（手机视图）
await page.locator("#btnCloseSearch").click();
await page.waitForTimeout(300);
await page.screenshot({ path: "_scratch/shot-article.png", fullPage: false });
await page.locator("#btnMenu").click();
await page.waitForTimeout(600);
await page.screenshot({ path: "_scratch/shot-drawer.png" });
console.log("  截图已保存");

// 深色模式
await page.locator("#btnCloseDrawer").click();
await page.locator("#btnTheme").click();
await page.waitForTimeout(400);
await page.screenshot({ path: "_scratch/shot-dark.png" });
console.log("  深色模式截图已保存");

console.log("\n=== JS 错误 ===");
console.log(errors.length ? errors.join("\n") : "无 ✓");

await browser.close();
