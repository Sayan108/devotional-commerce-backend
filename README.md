# Arghya API

Install and start from this directory with Node.js 22 and a running MongoDB replica set.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm start
```

Set `MONGODB_URI` and `MONGODB_DATABASE` in `.env`. The example uses a local replica set named `arghya` on port 27017 and enables local OTP and payment demos. Check API readiness at `http://127.0.0.1:4000/v1/health`.

The API serves customer endpoints under `/v1`, seller endpoints under `/admin`, and catalog images under `/media` from `public/media`. [Customer storefront](https://github.com/Sayan108/arghya-storefront) · [Seller admin](https://github.com/Sayan108/arghya-admin)

Run `npm test` to run the backend tests. Use `MONGODB_TEST_URI` for a dedicated test replica set. The tests create and remove an isolated test database.
