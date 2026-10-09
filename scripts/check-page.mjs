/**
 * Integration check: load the real public/index.html into jsdom, boot the
 * real contact-form.js against it, and verify the form wiring matches.
 * Run with: node scripts/check-page.mjs
 */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "https://example.com/", runScripts: "outside-only" });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { "content-type": "application/json" },
});

await import("../public/assets/js/contact-form.js");
// module boot ran on import because document exists and readyState is complete.

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!cond) failures++;
};

const form = document.querySelector("form[data-contact-form]");
check("form present", !!form);
check("boot attached novalidate", form?.getAttribute("novalidate") === "");
for (const n of ["name", "email", "message", "website", "cf-turnstile-response"]) {
  check(`field '${n}' exists`, !!form?.elements[n]);
}
check("error slots for name/email/message",
  !!form.querySelector('[data-error-for="name"]') &&
  !!form.querySelector('[data-error-for="email"]') &&
  !!form.querySelector('[data-error-for="message"]'));
check("status region exists", !!form.querySelector("[data-status]"));

// submitting empty triggers client-side errors (handler attached)
form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 0));
check("empty submit flags email invalid", form.elements.email.getAttribute("aria-invalid") === "true");

// links and logo wired
check("logo img present", !!document.querySelector("img.logo"));
check("NodeChart link", !![...document.querySelectorAll("a")].find((a) => a.href.includes("nodechart.cc")));
check("GitBinder link", !![...document.querySelectorAll("a")].find((a) => a.href.includes("gitbinder.pages.dev")));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
