# Naivedya API

Install and start from this directory with Node.js 22 and a running MongoDB replica set.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node --env-file=.env src/server.js
```

Set `MONGODB_URI` and `MONGODB_DATABASE` in `.env`. The example uses a local replica set named `arghya` on port 27017 and enables local OTP and payment demos. Check API readiness at `http://127.0.0.1:4000/v1/health`.

Credentialed browser access is restricted to the deployed storefront, admin, Android WebView origin (`https://localhost`), and HTTP development origins on ports 3000, 3001, 5173, 5174, 4173, and 4174 for `localhost`, `127.0.0.1`, and the Android emulator host `10.0.2.2`. To change these, set `ALLOWED_ORIGINS` to a comma-separated list of exact origins without trailing slashes; this replaces the defaults, so include every frontend and Android origin that needs access. An Android emulator accesses a host API via `10.0.2.2` rather than its own `localhost`. Requests without an Origin header, such as server-to-server webhooks, are unaffected.

The API serves customer endpoints under `/v1`, seller endpoints under `/admin`, and catalog images under `/media` from `public/media`. [Customer storefront](https://github.com/Sayan108/devotional-commerce-storefront) · [Seller admin](https://github.com/Sayan108/devotional-commerce-admin)

On startup, the bilingual catalog migration installs 91 products across ten categories and archives the old products, categories, and recurring offers. Existing order and inventory records remain available to order history and fulfilment. Each catalog item has English and Bengali names and descriptions, plus search aliases. New items become orderable once their variant has a confirmed price in paise and available inventory.

Staff-only admin APIs support product and category management, first-variant stock, homepage drafts and revisions, package drafts, order-linked support cases, and coverage changes. Product stock adjustments and content updates use database transactions and record an audit entry. Customer records shown in support are limited to customers with orders, and notes must not contain sensitive personal data. Additional variant management, homepage help content and full storefront previews, and courier integrations are not yet implemented.

For staff image uploads, configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` on the backend using the existing Cloudinary account. The secret stays server-side; uploads are signed and placed in the `naivedya` folder. JPEG, PNG and WebP files up to 5 MB are accepted. Without credentials, uploads return an explicit configuration error; bundled `/media/` images continue to work. Removing the displayed demo OTP text does not change `OTP_MODE=demo`: local demo sign-in still uses `123456`; configure Twilio for real SMS verification.

Run `npm test` to run the backend tests. Use `MONGODB_TEST_URI` for a dedicated test replica set. The tests create and remove an isolated test database.
