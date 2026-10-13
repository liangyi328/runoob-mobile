/**
 * 菜鸟教程爬虫 —— 抓取「目录 + 正文」，输出结构化 JSON 供手机端 App 使用。
 *
 * 合规说明：
 *  - 遵守 https://www.runoob.com/robots.txt（禁止 /try/、/wp-admin/、/feed/ 等，本爬虫不触碰）
 *  - 单域名串行限速 + 重试，避免对源站造成压力
 *  - 仅用于个人离线学习，不重新分发内容
 */
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(ROOT, ".cache");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

const BASE = "https://www.runoob.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 要抓取的教程：入口目录页 slug -> 显示名 */
const TUTORIALS = [
  { slug: "python3", name: "Python3 教程", entry: "/python3/python3-tutorial.html" },
  { slug: "numpy", name: "NumPy 教程", entry: "/numpy/numpy-tutorial.html" },
  { slug: "pandas", name: "Pandas 教程", entry: "/pandas/pandas-tutorial.html" },
  { slug: "matplotlib", name: "Matplotlib 教程", entry: "/matplotlib/matplotlib-tutorial.html" },
];

// ---- 限速 / 重试 ----
const DELAY_MS = Number(process.env.DELAY_MS || 260); // 请求间隔
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const MAX_RETRY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { ok: 0, fail: 0, cached: 0 };

async function fetchRaw(url) {
  const key = url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(-120);
  const cacheFile = path.join(CACHE_DIR, key + ".html");
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 500) {
    stats.cached++;
    return fs.readFileSync(cacheFile, "utf8");
  }
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      fs.writeFileSync(cacheFile, text, "utf8");
      stats.ok++;
      await sleep(DELAY_MS);
      return text;
    } catch (e) {
      lastErr = e;
      await sleep(600 * attempt); // 退避
    }
  }
  stats.fail++;
  console.warn(`  ! 失败 ${url} :: ${lastErr?.message}`);
  return null;
}

/** 把页面里的链接归一化为绝对 URL；跨域 / 非教程页返回 null */
function normalizeHref(href, pageUrl) {
  if (!href) return null;
  href = href.trim();
  if (/^(#|javascript:|mailto:)/i.test(href)) return null;
  let abs;
  try {
    abs = new URL(href, pageUrl).href;
  } catch {
    return null;
  }
  // robots.txt 禁止的路径，直接跳过
  if (/\/(try|wp-admin|wp-includes|feed)(\/|$)/.test(new URL(abs).pathname)) return null;
  if (/\?s=/.test(abs)) return null;
  return new URL(abs).origin === BASE ? abs : null;
}

/** 解析目录页，返回 [{ title, url }] */
function parseTOC(html, entryUrl) {
  const $ = load(html);
  const out = [];
  const seen = new Set();
  $("#leftcolumn a").each((_, el) => {
    const a = $(el);
    const title = (a.attr("title") || a.text() || "").replace(/\s+/g, " ").trim();
    const url = normalizeHref(a.attr("href"), entryUrl);
    if (!title || !url || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url });
  });
  return out;
}

/** 提取正文：#content，去掉广告/评论区/脚本 */
function parseArticle(html, url) {
  const $ = load(html);
  // 移除噪声节点
  $(
    "script, style, noscript, iframe, .advertisement, .adsbygoogle, .responsive_ad1, " +
      ".article-heading-ad, #comments, .commentlist, #respond, .previous-next-links, " +
      "#runoob-detail-nav, .rn-ai-cards, .rn-ai-card, #aiNav, #ai-info, .share_code, " +
      ".upvotejs, #sidebar-right-re, .sidebar-box, #ad-336280, .qa_headline"
  ).remove();

  const $content = $("#content");
  if (!$content.length) return null;

  // 标题：优先 h1
  let title = ($content.find("h1").first().text() || "").replace(/\s+/g, " ").trim();
  if (!title) title = ($("title").text() || "").replace(/\s*[-|–]\s*.*$/, "").trim();

  const $body = $content.clone();

  // 处理代码块：<pre> 提取纯文本，交给前端高亮
  const blocks = [];
  $body.find("pre").each((i, el) => {
    const $pre = $(el);
    // 菜鸟教程常用 <pre> 或 div.example_code 包裹代码
    let code = $pre.text().replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!code) {
      code = $pre.find("code").text().trim();
    }
    const $ph = $("<pre-code></pre-code>");
    $ph.attr("data-idx", String(blocks.length));
    $pre.replaceWith($ph);
    blocks.push(code);
  });

  // 图片：保留外链（用户选择），补成绝对地址，加懒加载标记
  $body.find("img").each((_, el) => {
    const $img = $(el);
    const src =
      $img.attr("src") || $img.attr("data-src") || $img.attr("data-original") || "";
    if (!src) {
      $img.remove();
      return;
    }
    const abs = src.startsWith("http") ? src : new URL(src, BASE).href;
    $img.attr("src", abs);
    $img.attr("loading", "lazy");
    $img.attr("decoding", "async");
    $img.removeAttr("width");
    $img.removeAttr("height");
    $img.removeAttr("srcset");
    $img.removeAttr("sizes");
  });

  // 站内链接 -> 内部路由；站外链接 -> 新窗口
  $body.find("a").each((_, el) => {
    const $a = $(el);
    const href = normalizeHref($a.attr("href"), url);
    if (!href) {
      $a.removeAttr("href");
      return;
    }
    const p = new URL(href).pathname; // e.g. /python3/python3-list.html
    $a.attr("data-internal", p.replace(/^\//, ""));
    $a.removeAttr("href");
    $a.removeAttr("target");
  });

  // 表格 -> 可横向滚动容器（手机端关键）
  $body.wrapInner ? null : null;
  const html_out = $body.html() || "";
  if (!html_out.trim() && !blocks.length) return null;

  // 提取小节标题作为页内目录（手机端 TOC）
  const sections = [];
  $body.find("h2, h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) sections.push(t);
  });

  return {
    url,
    path: new URL(url).pathname.replace(/^\//, ""),
    title,
    html: html_out,
    codeBlocks: blocks,
    sections: sections.slice(0, 40),
  };
}

/** 并发受控的 map */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = null;
        console.warn("  ! worker error:", e.message);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ============ 主流程 ============
const onlySlug = process.argv[2]; // 可选：只爬某个 slug，用于快速试跑
const limitPer = Number(process.env.LIMIT || 0); // 可选：每个教程只爬前 N 页

const targets = onlySlug ? TUTORIALS.filter((t) => t.slug === onlySlug) : TUTORIALS;
if (!targets.length) {
  console.error(`未知 slug: ${onlySlug}，可选: ${TUTORIALS.map((t) => t.slug).join(", ")}`);
  process.exit(1);
}

console.log(`开始抓取 ${targets.length} 个教程 | 间隔 ${DELAY_MS}ms | 并发 ${CONCURRENCY}`);

const manifest = { generatedAt: new Date().toISOString(), tutorials: [] };

for (const tut of targets) {
  console.log(`\n[${tut.slug}] 读取目录: ${tut.entry}`);
  const entryHtml = await fetchRaw(BASE + tut.entry);
  if (!entryHtml) {
    console.error(`  × 目录页获取失败，跳过 ${tut.slug}`);
    continue;
  }
  let toc = parseTOC(entryHtml, BASE + tut.entry);
  console.log(`  目录条目: ${toc.length}`);
  if (limitPer > 0) toc = toc.slice(0, limitPer);

  const pagesRaw = await mapLimit(toc, CONCURRENCY, async (item) => {
    const html = await fetchRaw(item.url);
    if (!html) return null;
    return parseArticle(html, item.url);
  });

  const pages = pagesRaw.filter(Boolean);
  // 保持目录顺序
  const order = new Map(toc.map((t, i) => [t.url, i]));
  pages.sort((a, b) => (order.get(a.url) ?? 999) - (order.get(b.url) ?? 999));

  const outFile = path.join(OUT_DIR, `${tut.slug}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ slug: tut.slug, name: tut.name, entry: tut.entry, pages }, "utf8")
  );
  console.log(
    `  ✓ ${tut.slug}: ${pages.length}/${toc.length} 页 -> ${path.relative(ROOT, outFile)} ` +
      `(${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`
  );

  manifest.tutorials.push({
    slug: tut.slug,
    name: tut.name,
    count: pages.length,
    file: `data/${tut.slug}.json`,
    pages: pages.map((p) => ({ t: p.title, p: p.path })),
  });
}

fs.writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  JSON.stringify(manifest),
  "utf8"
);

console.log(
  `\n完成。请求成功 ${stats.ok} / 命中缓存 ${stats.cached} / 失败 ${stats.fail}`
);
console.log(`索引: ${path.join(OUT_DIR, "manifest.json")}`);
