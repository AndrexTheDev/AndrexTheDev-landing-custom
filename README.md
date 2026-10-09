# AndrexTheDev – landing

Static, hand-built landing page (no framework) for **AndrexTheDev**, deployed free on
Cloudflare Pages. Content is English; explanations here are for the maintainer.

```
public/            the whole site (build output)
  index.html
  assets/css, assets/js, assets/img
  _headers         security + caching
functions/
  contact.js       POST /contact  (Cloudflare Pages Function)
scripts/           node smoke tests
```

## Develop

```bash
npm install
npm run check                          # run all smoke tests
python3 -m http.server 8080 --directory public   # or any static server
```

## Deploy to Cloudflare Pages (free)

1. Push this repo to GitHub.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
   - Build command: *(leave empty)*
   - Build output directory: `public`
   - Functions directory: auto-detected (`functions/`)
3. Deploy. You get `https://<project>.pages.dev`.

The contact endpoint (`/contact`) stores messages in a KV namespace. It degrades
gracefully (returns `ok` but stores nothing) until you wire one up:

```bash
npx wrangler kv namespace create CONTACT_KV
# paste the returned id into wrangler.jsonc -> kv_namespaces
```

Optional spam protection (Cloudflare Turnstile):

```bash
npx wrangler pages secret put TURNSTILE_SECRET --project-name <project>
```

## Tests

- `scripts/check-contact.mjs` – exercises `functions/contact.js` (validation, honeypot,
  KV storage, Turnstile, rate limiting) against an in-memory KV stub.
- `scripts/check-contact-form.mjs` – DOM tests for `public/assets/js/contact-form.js`.
- `scripts/check-page.mjs` – loads the real `index.html` and verifies the form wiring.

Run them all: `npm run check`.
