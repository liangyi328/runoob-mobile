import fs from "node:fs";
const d = JSON.parse(fs.readFileSync("data/python3.json", "utf8"));
console.log("pages:", d.pages.length);
for (const p of d.pages) {
  console.log(
    ` - ${p.title} | blocks:${p.codeBlocks.length} sections:${p.sections.length} html:${p.html.length}`
  );
}
console.log("\n--- HTML 预览 ---");
console.log(d.pages[0].html.slice(0, 800));
console.log("\n--- 代码块示例 ---");
console.log(JSON.stringify(d.pages[1]?.codeBlocks?.[0] || "(none)").slice(0, 300));
console.log("\n--- sections 示例 ---");
console.log(d.pages[0].sections.slice(0, 6).join(" / "));
console.log("\n--- 是否残留噪声 (应为 false) ---");
const h = d.pages.map((p) => p.html).join("");
console.log("含 script:", /<script/i.test(h));
console.log("含 comment:", /id="comments"/i.test(h));
console.log("含 adsbygoogle:", /adsbygoogle/i.test(h));
