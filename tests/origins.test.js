import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { settings } from "../src/config/settings.js";

test("development and Android emulator origins are explicitly allowed", () => {
  const { allowedOrigins } = settings({ OTP_MODE: "demo" });
  for (const host of ["localhost", "127.0.0.1", "10.0.2.2"]) {
    for (const port of [3000, 3001, 5173, 5174]) {
      assert(allowedOrigins.has(`http://${host}:${port}`));
    }
  }
  assert(allowedOrigins.has("https://localhost"));
  assert(!allowedOrigins.has("http://untrusted.example:3000"));
});

test("credentialed browser requests require an allowed origin", async t => {
  const config = settings({ OTP_MODE: "demo", ALLOWED_ORIGINS: "https://admin.example" });
  const { app } = createApp({}, config);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/admin/metrics`;
  const allowed = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://admin.example" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://admin.example");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  const denied = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://untrusted.example" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const deniedRead = await fetch(url, { headers: { Origin: "https://untrusted.example" } });
  assert.equal(deniedRead.status, 403);
  assert.equal((await deniedRead.json()).code, "ORIGIN_DENIED");
});
