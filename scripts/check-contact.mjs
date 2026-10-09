/**
 * Smoke test for functions/contact.js — runs the real handler in Node
 * against an in-memory KV stub. Run with: node scripts/check-contact.mjs
 */

import { onRequestGet, onRequestPost } from "../functions/contact.js";

let failures = 0;

function check(label, condition, detail = "") {
  const mark = condition ? "ok  " : "FAIL";
  console.log(`${mark} ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!condition) failures++;
}

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function postRequest(body, contentType = "application/json") {
  return new Request("https://example.com/contact", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "cf-connecting-ip": "203.0.113.7",
    },
    body: JSON.stringify(body),
  });
}

const valid = { name: "Mira", email: "mira@example.com", message: "Hello, I have a question about the API." };

// 1. health check
const health = await onRequestGet();
const healthBody = await health.json();
check("GET /contact returns ok", health.status === 200 && healthBody.ok === true);

// 2. wrong content type
const wrongType = await onRequestPost({
  request: postRequest(valid, "text/plain"),
  env: {},
});
check("rejects non-JSON content type", wrongType.status === 415);

// 3. valid submission without KV binding
const noKv = await onRequestPost({ request: postRequest(valid), env: {} });
const noKvBody = await noKv.json();
check("accepts valid submission without KV", noKv.status === 200 && noKvBody.ok === true);

// 4. honeypot
const kvBot = memoryKv();
const spam = await onRequestPost({
  request: postRequest({ ...valid, website: "http://spam.test" }),
  env: { CONTACT_KV: kvBot },
});
check("honeypot returns ok but stores nothing", (await spam.json()).ok === true && kvBot.store.size === 0);

// 5. validation
const badEmail = await onRequestPost({
  request: postRequest({ ...valid, email: "not-an-email" }),
  env: { CONTACT_KV: memoryKv() },
});
check("rejects invalid email", badEmail.status === 400);

const shortMessage = await onRequestPost({
  request: postRequest({ ...valid, message: "hi" }),
  env: { CONTACT_KV: memoryKv() },
});
check("rejects too-short message", shortMessage.status === 400);

// 6. storage
const kv = memoryKv();
const stored = await onRequestPost({ request: postRequest(valid), env: { CONTACT_KV: kv } });
const storedKey = [...kv.store.keys()].find((k) => k.startsWith("message:"));
const storedRecord = storedKey ? JSON.parse(kv.store.get(storedKey)) : null;
check(
  "stores submission in KV",
  (await stored.json()).ok === true && storedRecord?.name === "Mira" && storedRecord?.email === "mira@example.com",
  storedKey ?? "nothing written",
);

// 7. Turnstile: secret configured, no token -> reject
const tsFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
const tsBlocked = await onRequestPost({
  request: postRequest(valid),
  env: { CONTACT_KV: memoryKv(), TURNSTILE_SECRET: "0x-secret" },
});
check("blocks when Turnstile is configured and token missing", tsBlocked.status === 403);

globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
const tsPassed = await onRequestPost({
  request: postRequest({ ...valid, "cf-turnstile-response": "token" }),
  env: { CONTACT_KV: memoryKv(), TURNSTILE_SECRET: "0x-secret" },
});
check("accepts valid Turnstile token", tsPassed.status === 200);
globalThis.fetch = tsFetch;

// 8. rate limit — same IP, fresh namespace
const rlKv = memoryKv();
const env = { CONTACT_KV: rlKv };
const statuses = [];
for (let i = 0; i < 6; i++) {
  const res = await onRequestPost({ request: postRequest(valid), env });
  statuses.push(res.status);
}
check(
  "rate limits the 5th request from one IP",
  statuses.slice(0, 4).every((s) => s === 200) && statuses[4] === 429 && statuses[5] === 429,
  statuses.join(","),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
