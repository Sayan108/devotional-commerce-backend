# Naivedya API

Install and start from this directory with Node.js 22 and a running MongoDB replica set.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node --env-file=.env src/server.js
```

Set `MONGODB_URI` and `MONGODB_DATABASE` in `.env`. The example uses a local replica set named `arghya` on port 27017 and enables local OTP and payment demos. Check API readiness at `http://127.0.0.1:4000/v1/health`.

Credentialed browser access is restricted to the deployed storefront, admin, Android WebView origin (`https://localhost`), and the local Vite development origins. To change these, set `ALLOWED_ORIGINS` to a comma-separated list of exact origins without trailing slashes; include every frontend and Android origin that needs access. Requests without an Origin header, such as server-to-server webhooks, are unaffected.

The API serves customer endpoints under `/v1`, seller endpoints under `/admin`, and catalog images under `/media` from `public/media`. [Customer storefront](https://github.com/Sayan108/devotional-commerce-storefront) · [Seller admin](https://github.com/Sayan108/devotional-commerce-admin)

On startup, the bilingual catalog migration installs 91 products across ten categories and archives the old products, categories, and recurring offers. Existing order and inventory records remain available to order history and fulfilment. Each catalog item has English and Bengali names and descriptions, plus search aliases. New items become orderable once their variant has a confirmed price in paise and available inventory.

Run `npm test` to run the backend tests. Use `MONGODB_TEST_URI` for a dedicated test replica set. The tests create and remove an isolated test database.
