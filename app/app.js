/* ===== 菜鸟教程 手机学习版 · 应用逻辑 ===== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const el = {
    topbarTitle: $("#topbarTitle"),
    drawer: $("#drawer"),
    drawerBody: $("#drawerBody"),
    drawerFilter: $("#drawerFilter"),
    overlay: $("#overlay"),
    searchPanel: $("#searchPanel"),
    searchInput: $("#searchInput"),
    searchResults: $("#searchResults"),
    main: $("#main"),
    homeView: $("#homeView"),
    articleView: $("#articleView"),
    articleInner: $("#articleInner"),
    pager: $("#pager"),
    loading: $("#loading"),
  };

  const STORE = "runoob_mobile_v1";
  let DB = { tutorials: [], byPath: new Map(), flat: [] };
  let searchIndex = [];
  let current = null; // 当前页 { path, slug }

  // ---------- 本地状态 ----------
  const ls = {
    get(k, d) {
      try { const v = localStorage.getItem(STORE + ":" + k); return v ? JSON.parse(v) : d; }
      catch { return d; }
    },
    set(k, v) { try { localStorage.setItem(STORE + ":" + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- 主题 ----------
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.querySelector('meta[name="theme-color"]').setAttribute("content",
      t === "dark" ? "#16191c" : "#0e7a5f");
  }
  applyTheme(ls.get("theme", "light"));

  // ---------- 加载数据 ----------
  async function loadData() {
    const manifest = await fetch("data/manifest.json").then((r) => r.json());
    const tuts = [];
    for (const t of manifest.tutorials) {
      const d = await fetch(t.file).then((r) => r.json());
      tuts.push({ slug: d.slug, name: d.name, pages: d.pages });
    }
    DB.tutorials = tuts;
    for (const t of tuts) {
      for (let i = 0; i < t.pages.length; i++) {
        const p = t.pages[i];
        p.slug = t.slug;
        p.idx = i;
        DB.byPath.set(p.path, p);
        DB.flat.push({ path: p.path, title: p.title, slug: t.slug });
      }
    }
    buildSearchIndex();
    return manifest;
  }

  // ---------- 搜索索引（标题 + 正文纯文本 + 代码） ----------
  function stripHtml(h) {
    const d = document.createElement("div");
    d.innerHTML = h;
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }
  function buildSearchIndex() {
    searchIndex = DB.flat.map((f) => {
      const p = DB.byPath.get(f.path);
      const text = stripHtml(p.html) + " " + (p.codeBlocks || []).join(" ");
      return { path: f.path, title: f.title, slug: f.slug, text: text.toLowerCase() };
    });
  }

  // ---------- 渲染首页 ----------
  function renderHome() {
    const last = ls.get("last", null);
    const prog = ls.get("progress", {});
    let html = `<h1>菜鸟教程 · 手机学习版</h1>
      <div class="sub">共 <b>${DB.flat.length}</b> 个章节 · 完全离线可用 · 移动优先排版</div>`;

    if (last && DB.byPath.has(last.path)) {
      const p = DB.byPath.get(last.path);
      html += `<div class="section-title">继续学习</div>
        <div class="continue-card" data-path="${esc(p.path)}">
          <div>
            <div class="cc-label">上次阅读 · ${esc(tutName(p.slug))}</div>
            <div class="cc-title">${esc(p.title)}</div>
          </div>
          <div class="cc-go"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>
        </div>`;
    }

    html += `<div class="section-title">选择教程</div><div class="card-grid">`;
    for (const t of DB.tutorials) {
      const done = Object.keys(prog).filter((k) => {
        const p = DB.byPath.get(k); return p && p.slug === t.slug;
      }).length;
      const pct = t.pages.length ? Math.round((done / t.pages.length) * 100) : 0;
      html += `<div class="tut-card" data-slug="${t.slug}">
        <div class="tc-name">${esc(t.name)}</div>
        <div class="tc-meta">${t.pages.length} 章 · 已读 ${pct}%</div>
        <div class="tc-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }
    html += `</div>`;
    el.homeView.innerHTML = html;

    el.homeView.querySelectorAll("[data-path]").forEach((n) =>
      n.addEventListener("click", () => openPage(n.dataset.path)));
    el.homeView.querySelectorAll(".tut-card").forEach((n) =>
      n.addEventListener("click", () => {
        const t = DB.tutorials.find((x) => x.slug === n.dataset.slug);
        if (t && t.pages.length) { openDrawer(); openGroup(t.slug); openPage(t.pages[0].path); }
      }));
  }

  function tutName(slug) {
    const t = DB.tutorials.find((x) => x.slug === slug);
    return t ? t.name : slug;
  }

  // ---------- 渲染抽屉目录 ----------
  function renderDrawer() {
    let html = "";
    for (const t of DB.tutorials) {
      html += `<div class="tut-group" data-slug="${t.slug}">
        <div class="tg-head">
          <span>${esc(t.name)}</span>
          <span class="tg-count">${t.pages.length}</span>
          <span class="chev"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
        </div>
        <div class="tg-list">${t.pages.map((p) =>
          `<a href="#${encodeURIComponent(p.path)}" data-path="${esc(p.path)}">${esc(p.title)}</a>`
        ).join("")}</div>
      </div>`;
    }
    el.drawerBody.innerHTML = html;

    el.drawerBody.querySelectorAll(".tg-head").forEach((h) =>
      h.addEventListener("click", () => h.parentElement.classList.toggle("open")));
    el.drawerBody.querySelectorAll("[data-path]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openPage(a.dataset.path);
        closeDrawer();
      }));
  }

  function openGroup(slug) {
    const g = el.drawerBody.querySelector(`.tut-group[data-slug="${slug}"]`);
    if (g) g.classList.add("open");
  }

  // ---------- 打开正文 ----------
  function openPage(path, push) {
    const p = DB.byPath.get(path);
    if (!p) { toast("章节不存在（可能未收录）"); return; }

    const t = DB.tutorials.find((x) => x.slug === p.slug);
    const siblings = t ? t.pages : [];
    const prev = siblings[p.idx - 1];
    const next = siblings[p.idx + 1];

    current = { path, slug: p.slug };
    el.topbarTitle.textContent = p.title;
    el.homeView.hidden = true;
    el.articleView.hidden = false;

    // 渲染正文：HTML + 代码块还原
    let html = p.html;
    // 去掉原文自带的首个 h1（我们已用 p.title 渲染标题，避免重复）
    html = html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/i, "");
    html = html.replace(/<pre-code data-idx="(\d+)"><\/pre-code>/g, (m, i) => {
      const code = p.codeBlocks[Number(i)] || "";
      return renderCode(code, guessLang(code, p.slug));
    });
    el.articleInner.innerHTML = `<h1>${esc(p.title)}</h1>` + html;
    postProcessArticle();

    // 上下页
    el.pager.innerHTML =
      (prev ? `<button class="prev" data-path="${esc(prev.path)}"><span class="pl">← 上一节</span><span class="pt">${esc(prev.title)}</span></button>` : `<button disabled><span class="pl">← 上一节</span><span class="pt">已是首节</span></button>`) +
      (next ? `<button class="next" data-path="${esc(next.path)}"><span class="pl">下一节 →</span><span class="pt">${esc(next.title)}</span></button>` : `<button disabled><span class="pl">下一节 →</span><span class="pt">已是末节</span></button>`);
    el.pager.querySelectorAll("[data-path]").forEach((b) =>
      b.addEventListener("click", () => openPage(b.dataset.path, true)));

    // 高亮抽屉当前项
    el.drawerBody.querySelectorAll("a[data-path]").forEach((a) =>
      a.classList.toggle("active", a.dataset.path === path));
    openGroup(p.slug);

    // 记录进度
    ls.set("last", { path, title: p.title, slug: p.slug });
    const prog = ls.get("progress", {});
    prog[path] = Date.now();
    ls.set("progress", prog);

    el.main.scrollTop = 0;
    if (push !== false) {
      history.pushState({ path }, "", "#" + encodeURIComponent(path));
    }
  }

  // ---------- 代码块渲染 ----------
  function guessLang(code, slug) {
    const c = code.slice(0, 400);
    if (/\b(def |import |print\(|self\b|lambda |elif )/.test(c)) return "python";
    if (/\b(pip |conda |npm )/.test(c) || /^\$\s/m.test(c)) return "bash";
    if (/^\s*[<#]/.test(c) || /<div|<html|SELECT\s/i.test(c)) return "xml";
    return slug === "python3" || slug === "numpy" || slug === "pandas" || slug === "matplotlib"
      ? "python" : "plaintext";
  }

  function renderCode(code, lang) {
    const escHtml = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let highlighted = escHtml;
    try {
      if (window.hljs && lang !== "plaintext") {
        highlighted = hljs.highlight(code, { language: lang }).value;
      }
    } catch { /* 回落纯文本 */ }
    return `<div class="code-box">
      <div class="code-head"><span class="ch-lang">${lang}</span>
        <button class="copy-btn" type="button">复制</button></div>
      <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
    </div>`;
  }

  // ---------- 正文后处理：表格滚动容器 / 内部链接 / 复制按钮 ----------
  function postProcessArticle() {
    el.articleInner.querySelectorAll("table").forEach((tb) => {
      if (tb.parentElement.classList.contains("tw")) return;
      const w = document.createElement("div");
      w.className = "tw";
      tb.parentNode.insertBefore(w, tb);
      w.appendChild(tb);
    });
    // 图片外层包裹（保留外链，联网加载）
    el.articleInner.querySelectorAll("img").forEach((im) => {
      im.addEventListener("error", () => {
        im.style.display = "none"; // 离线时静默隐藏，避免破图
      }, { once: true });
    });
    // 内部链接跳转
    el.articleInner.querySelectorAll("a[data-internal]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = a.dataset.internal;
        if (DB.byPath.has(target)) openPage(target, true);
        else openExternal("https://www.runoob.com/" + target);
      });
    });
    // 复制
    el.articleInner.querySelectorAll(".copy-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const code = b.closest(".code-box").querySelector("code");
        const text = code ? code.textContent : "";
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); ta.remove();
        }
        b.textContent = "已复制";
        setTimeout(() => (b.textContent = "复制"), 1400);
      });
    });
  }

  function openExternal(url) {
    if (window.confirm("该章节未收录，是否在浏览器中打开原文？")) {
      window.open(url, "_blank", "noopener");
    }
  }

  // ---------- 搜索 ----------
  function doSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) { el.searchResults.innerHTML = ""; return; }
    const res = [];
    for (const it of searchIndex) {
      let score = 0;
      const ti = it.title.toLowerCase().indexOf(q);
      if (ti >= 0) score += 100 - Math.min(ti, 40);
      const xi = it.text.indexOf(q);
      if (xi >= 0) score += 30;
      if (score > 0) res.push({ it, score, xi });
    }
    res.sort((a, b) => b.score - a.score);
    const top = res.slice(0, 60);
    if (!top.length) {
      el.searchResults.innerHTML = `<div class="sr-empty">没有找到「${esc(q)}」</div>`;
      return;
    }
    el.searchResults.innerHTML = top.map(({ it, xi }) => {
      let snip = "";
      if (xi >= 0) {
        const s = Math.max(0, xi - 30);
        snip = it.text.slice(s, s + 110).replace(/</g, "&lt;");
        snip = snip.replace(new RegExp(escReg(q), "gi"), (m) => `<mark>${m}</mark>`);
      }
      return `<div class="sr-item" data-path="${esc(it.path)}">
        <div class="sr-title"><span>${esc(it.title)}</span><span class="sr-tag">${esc(tutName(it.slug))}</span></div>
        ${snip ? `<div class="sr-snip">…${snip}…</div>` : ""}
      </div>`;
    }).join("");
    el.searchResults.querySelectorAll("[data-path]").forEach((n) =>
      n.addEventListener("click", () => { closeSearch(); openPage(n.dataset.path); }));
  }

  // ---------- 交互 ----------
  function openDrawer() { el.drawer.classList.add("show"); el.overlay.classList.add("show"); }
  function closeDrawer() { el.drawer.classList.remove("show"); el.overlay.classList.remove("show"); }
  function openSearch() { el.searchPanel.classList.add("show"); el.searchInput.focus(); doSearch(el.searchInput.value); }
  function closeSearch() { el.searchPanel.classList.remove("show"); el.searchInput.blur(); }

  $("#btnMenu").addEventListener("click", openDrawer);
  $("#btnCloseDrawer").addEventListener("click", closeDrawer);
  el.overlay.addEventListener("click", closeDrawer);
  $("#btnSearch").addEventListener("click", openSearch);
  $("#btnCloseSearch").addEventListener("click", closeSearch);
  $("#btnTheme").addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(now); ls.set("theme", now);
  });
  el.searchInput.addEventListener("input", () => doSearch(el.searchInput.value));
  el.drawerFilter.addEventListener("input", () => {
    const q = el.drawerFilter.value.trim().toLowerCase();
    el.drawerBody.querySelectorAll("a[data-path]").forEach((a) => {
      a.classList.toggle("hide", q ? !a.textContent.toLowerCase().includes(q) : false);
    });
    if (q) el.drawerBody.querySelectorAll(".tut-group").forEach((g) => g.classList.add("open"));
  });

  // 侧滑返回（右滑打开目录已由按钮负责；这里处理浏览器返回）
  window.addEventListener("popstate", (e) => {
    const path = e.state?.path || decodeHash(location.hash);
    if (path && DB.byPath.has(path)) openPage(path, false);
    else showHome();
  });

  function showHome() {
    el.homeView.hidden = false;
    el.articleView.hidden = true;
    el.topbarTitle.textContent = "菜鸟教程";
    current = null;
    renderHome();
  }

  function decodeHash(h) {
    try { return decodeURIComponent((h || "").replace(/^#/, "")); } catch { return ""; }
  }

  // 顶栏标题点击 -> 回首页
  el.topbarTitle.addEventListener("click", () => {
    if (current) { history.pushState({}, "", "#"); showHome(); }
  });

  function toast(msg) {
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);" +
      "background:rgba(0,0,0,.82);color:#fff;padding:9px 16px;border-radius:20px;" +
      "font-size:13px;z-index:999;max-width:80vw;text-align:center";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---------- 启动 ----------
  (async function init() {
    try {
      el.loading.hidden = false;
      await loadData();
      renderDrawer();
      const path = decodeHash(location.hash);
      if (path && DB.byPath.has(path)) {
        renderHome();
        openPage(path, false);
      } else {
        showHome();
      }
      el.loading.hidden = true;

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      }
    } catch (e) {
      el.loading.innerHTML = `<span>数据加载失败：${esc(e.message)}<br><br>请通过本地服务器打开（不要用 file:// 直接打开）。</span>`;
    }
  })();
})();
