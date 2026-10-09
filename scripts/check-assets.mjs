/**
 * Static integrity check for public/index.html:
 *  - every local href/src resolves to a real file under public/
 *  - every in-page anchor (#x) has a matching id
 *  - external links are absolute https URLs
 *  - style.css has balanced braces
 * Run with: node scripts/check-assets.mjs
 */

import { readFileSync, existsSync } from "node:fs";

const pub = new URL("../public/", import.meta.url);
const html = readFileSync(new URL("index.html", pub), "utf8");

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!cond) failures++;
};

// local file references
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
const local = refs.filter((r) => r.startsWith("/"));
for (const r of local) {
  const path = r.split("#")[0].split("?")[0];
  check(`file exists ${path}`, existsSync(new URL("." + path, pub)));
}

// in-page anchors resolve
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const anchors = [...new Set(refs.filter((r) => r.startsWith("#")).map((r) => r.slice(1)))];
for (const a of anchors) check(`anchor target #${a} exists`, ids.has(a));

// external links are https and absolute
const external = refs.filter((r) => /^https?:\/\//.test(r));
for (const e of external) check(`external https ${e}`, e.startsWith("https://"));

// no accidental localhost / placeholder links
check("no localhost links", !refs.some((r) => /localhost|127\.0\.0\.1|example\.com/.test(r)));
check("no placeholder TODO", !/(TODO|FIXME)\s*[:\-]|lorem ipsum/i.test(html));

// css brace balance
const css = readFileSync(new URL("assets/css/style.css", pub), "utf8");
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
check("style.css braces balanced", open === close, `${open} open / ${close} close`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
