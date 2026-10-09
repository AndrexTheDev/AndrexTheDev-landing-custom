/**
 * Contact form endpoint for Cloudflare Pages Functions.
 *
 * POST /contact  ->  validates, rate-limits, optionally checks Turnstile,
 *                    stores the submission in KV.
 * GET  /contact  ->  health check.
 *
 * Bindings (all optional, degrade gracefully when absent):
 *   CONTACT_KV          KV namespace where submissions are stored
 *   TURNSTILE_SECRET    server-side Turnstile secret
 */

const LIMITS = { name: 80, email: 254, message: 4000 };
const RATE_WINDOW_SECONDS = 600;
const RATE_MAX_REQUESTS = 4;
const SUBMISSION_TTL_SECONDS = 7776000; // 90 days

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function trim(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

async function overRateLimit(env, ip) {
  if (!env.CONTACT_KV || ip === "unknown") return false;
  const key = `rl:${ip}`;
  const seen = Number(await env.CONTACT_KV.get(key)) || 0;
  if (seen >= RATE_MAX_REQUESTS) return true;
  await env.CONTACT_KV.put(key, String(seen + 1), {
    expirationTtl: RATE_WINDOW_SECONDS,
  });
  return false;
}

async function turnstilePassed(token, ip, secret) {
  if (!secret) return true; // not configured -> skip
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  if (!response.ok) return false;

  const result = await response.json();
  return result.success === true;
}

export async function onRequestPost({ request, env }) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    return fail("Send JSON.", 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Malformed JSON.");
  }

  // Honeypot: a hidden field no human fills in.
  if (typeof body.website === "string" && body.website.length > 0) {
    return json({ ok: true });
  }

  const ip = clientIp(request);
  if (await overRateLimit(env, ip)) {
    return fail("Too many messages from your address. Try again later.", 429);
  }

  const name = trim(body.name, LIMITS.name);
  const email = trim(body.email, LIMITS.email);
  const message = trim(body.message, LIMITS.message);

  if (!name) return fail("A name is required.");
  if (!EMAIL_RE.test(email)) return fail("That email address does not look right.");
  if (message.length < 10) return fail("The message is too short.");

  const verified = await turnstilePassed(
    typeof body["cf-turnstile-response"] === "string"
      ? body["cf-turnstile-response"]
      : "",
    ip,
    env.TURNSTILE_SECRET,
  );
  if (!verified) return fail("Verification failed. Reload and try again.", 403);

  const id = crypto.randomUUID();
  const record = {
    id,
    receivedAt: new Date().toISOString(),
    ip,
    name,
    email,
    message,
  };

  if (env.CONTACT_KV) {
    await env.CONTACT_KV.put(`message:${record.receivedAt}:${id}`, JSON.stringify(record), {
      expirationTtl: SUBMISSION_TTL_SECONDS,
    });
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: "contact" });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { allow: "GET, POST, OPTIONS" },
  });
}
