/**
 * Contact form behaviour. Progressive enhancement: the form still submits
 * as a normal POST when JavaScript is unavailable.
 *
 * Usage:
 *   <form data-contact-form action="/contact" method="post"> ... </form>
 *   <script type="module" src="/assets/js/contact-form.js"></script>
 */

const LIMITS = { name: 80, email: 254, message: 4000 };
const MIN_MESSAGE = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MESSAGES = {
  missingName: "Please add a name so I know who I am replying to.",
  badEmail: "That email address does not look right.",
  shortMessage: "A few more words, please — ten characters minimum.",
  network: "The message did not go through. Check your connection and try again.",
  blocked: "Verification failed. Reload the page and try once more.",
  tooMany: "That is a lot of messages from one address. Give it ten minutes.",
  generic: "Something went wrong on my end. Try again, or reach out on GitHub.",
};

function statusFor(status) {
  if (status === 429) return MESSAGES.tooMany;
  if (status === 403) return MESSAGES.blocked;
  return MESSAGES.generic;
}

function fieldError(form, name, message) {
  const input = form.elements[name];
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (slot) slot.textContent = message || "";
  return !message;
}

function validate(form) {
  const name = (form.elements.name?.value || "").trim();
  const email = (form.elements.email?.value || "").trim();
  const message = (form.elements.message?.value || "").trim();

  const okName = fieldError(form, "name", name ? "" : MESSAGES.missingName);
  const okEmail = fieldError(form, "email", EMAIL_RE.test(email) ? "" : MESSAGES.badEmail);
  const okMessage = fieldError(
    form,
    "message",
    message.length >= MIN_MESSAGE ? "" : MESSAGES.shortMessage,
  );

  return okName && okEmail && okMessage;
}

function setStatus(form, text, tone) {
  const region = form.querySelector("[data-status]");
  if (!region) return;
  region.textContent = text;
  region.dataset.tone = tone || "";
  region.hidden = !text;
}

function setBusy(form, busy) {
  const submit = form.querySelector("[type=submit]");
  if (submit) {
    submit.disabled = busy;
    submit.dataset.busy = busy ? "true" : "false";
  }
}

function confirmSent(form) {
  const done = form.ownerDocument.createElement("div");
  done.className = "form-done";
  done.setAttribute("role", "status");
  done.setAttribute("tabindex", "-1");
  done.textContent =
    "Thanks — your message is in. I read everything myself and usually reply within a few days.";
  form.replaceWith(done);
  done.focus();
}

export function initContactForm(form, options = {}) {
  const endpoint = options.endpoint || form.getAttribute("action") || "/contact";

  form.setAttribute("novalidate", "");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(form, "");

    if (!validate(form)) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    // Honeypot stays empty for humans.
    if ((form.elements.website?.value || "").length > 0) return;

    const turnstileInput = form.elements["cf-turnstile-response"];
    const payload = {
      name: form.elements.name.value.trim().slice(0, LIMITS.name),
      email: form.elements.email.value.trim().slice(0, LIMITS.email),
      message: form.elements.message.value.trim().slice(0, LIMITS.message),
      website: form.elements.website?.value || "",
    };
    if (turnstileInput?.value) payload["cf-turnstile-response"] = turnstileInput.value;

    setBusy(form, true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok && body.ok) {
        confirmSent(form);
        return;
      }
      // The endpoint returns reader-facing strings; fall back to a mapped
      // message when the body is missing (edge errors, WAF pages, timeouts).
      const detail = typeof body.error === "string" && body.error.trim()
        ? body.error
        : statusFor(response.status);
      setStatus(form, detail, "error");
    } catch {
      setStatus(form, MESSAGES.network, "error");
    } finally {
      setBusy(form, false);
    }
  });

  return form;
}

function boot() {
  document.querySelectorAll("[data-contact-form]").forEach((form) => initContactForm(form));
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
