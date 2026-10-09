/**
 * DOM test for public/assets/js/contact-form.js — real jsdom, stubbed fetch.
 * Run with: node scripts/check-contact-form.mjs
 */

import { JSDOM } from "jsdom";
import { initContactForm } from "../public/assets/js/contact-form.js";

const MARKUP = `
<form data-contact-form action="/contact" method="post">
  <input name="name" id="name"><span data-error-for="name"></span>
  <input name="email" id="email"><span data-error-for="email"></span>
  <textarea name="message" id="message"></textarea><span data-error-for="message"></span>
  <input name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
  <input name="cf-turnstile-response" type="hidden" value="">
  <p data-status hidden></p>
  <button type="submit">Send</button>
</form>`;

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!condition) failures++;
}

function setup() {
  const dom = new JSDOM(`<!doctype html><body>${MARKUP}</body>`);
  const { window } = dom;
  const form = window.document.querySelector("form");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return setup.response ?? new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  initContactForm(form);
  const fill = (values) => {
    for (const [key, value] of Object.entries(values)) form.elements[key].value = value;
  };
  const submit = () => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  return { window, form, calls, fill, submit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// 1. invalid email blocks the request entirely
{
  const t = setup();
  t.fill({ name: "Mira", email: "nope", message: "I would like to ask about your work." });
  t.submit();
  await tick();
  check("invalid email is rejected client-side", t.calls.length === 0);
  check(
    "invalid email marks the field and shows a message",
    t.form.elements.email.getAttribute("aria-invalid") === "true" &&
      t.window.document.querySelector('[data-error-for="email"]').textContent.length > 0,
  );
}

// 2. short message is rejected
{
  const t = setup();
  t.fill({ name: "Mira", email: "mira@example.com", message: "hi" });
  t.submit();
  await tick();
  check("short message is rejected client-side", t.calls.length === 0);
}

// 3. valid submission posts trimmed JSON and swaps in the confirmation
{
  const t = setup();
  t.fill({ name: "  Mira  ", email: " mira@example.com ", message: "  Hello, a question about your work.  " });
  t.submit();
  await tick();
  const sent = t.calls[0]?.body;
  check("posts to /contact", t.calls.length === 1 && t.calls[0].url === "/contact");
  check(
    "payload is trimmed and complete",
    sent?.name === "Mira" && sent?.email === "mira@example.com" && sent?.message === "Hello, a question about your work.",
    JSON.stringify(sent),
  );
  const done = t.window.document.querySelector(".form-done");
  check("form is replaced by a confirmation", !!done && t.window.document.querySelector("form") === null);
}

// 4. honeypot: bots fill it, so nothing is sent
{
  const t = setup();
  t.fill({
    name: "Mira",
    email: "mira@example.com",
    message: "Hello, a question about your work.",
    website: "http://spam.test",
  });
  t.submit();
  await tick();
  check("honeypot suppresses the request", t.calls.length === 0);
}

// 5. server 429 with its own message: surface it verbatim, re-enable the button
{
  setup.response = new Response(
    JSON.stringify({ ok: false, error: "Too many messages from your address. Try again later." }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
  const t = setup();
  t.fill({ name: "Mira", email: "mira@example.com", message: "Hello, a question about your work." });
  t.submit();
  await tick();
  const status = t.window.document.querySelector("[data-status]");
  check("429 surfaces the server message", /ten minutes|later/i.test(status.textContent), status.textContent);
  check("status region is visible and flagged", status.hidden === false && status.dataset.tone === "error");
  check("submit button is re-enabled", t.form.querySelector("[type=submit]").disabled === false);
  setup.response = undefined;
}

// 5b. 429 with no usable body (WAF/edge page): fall back to the mapped message
{
  setup.response = new Response("<html>Rate limited</html>", {
    status: 429,
    headers: { "content-type": "text/html" },
  });
  const t = setup();
  t.fill({ name: "Mira", email: "mira@example.com", message: "Hello, a question about your work." });
  t.submit();
  await tick();
  const status = t.window.document.querySelector("[data-status]");
  check("429 without JSON body falls back to mapped message", /ten minutes/i.test(status.textContent), status.textContent);
  setup.response = undefined;
}

// 6. network failure is caught, not thrown
{
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const dom = new JSDOM(`<!doctype html><body>${MARKUP}</body>`);
  const form = dom.window.document.querySelector("form");
  initContactForm(form);
  form.elements.name.value = "Mira";
  form.elements.email.value = "mira@example.com";
  form.elements.message.value = "Hello, a question about your work.";
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await tick();
  const status = dom.window.document.querySelector("[data-status]");
  check("network failure shows a friendly message", /connection/i.test(status.textContent), status.textContent);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
