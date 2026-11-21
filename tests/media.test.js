import test from "node:test";
import assert from "node:assert/strict";
import { existingImage, uploadImage } from "../src/services/media.js";

test("Cloudinary image uploads validate files and use a signed Naivedya folder", async t => {
  const config = { cloudName: "example", apiKey: "test-key", apiSecret: "test-secret", folder: "naivedya" };
  await assert.rejects(uploadImage(Buffer.from("invalid"), "image/png", config), { code: "INVALID_IMAGE" });
  await assert.rejects(uploadImage(Buffer.from("invalid"), "image/png", {}), { code: "MEDIA_UNAVAILABLE" });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.cloudinary.com/v1_1/example/image/upload");
    assert.equal(options.body.get("folder"), "naivedya");
    assert.match(options.body.get("signature"), /^[a-f0-9]{40}$/);
    return new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/example/image/upload/v123/naivedya/test.png" }));
  };
  const image = Buffer.from("89504e470d0a1a0a00000000", "hex");
  assert.equal((await uploadImage(image, "image/png", config)).url, "https://res.cloudinary.com/example/image/upload/v123/naivedya/test.png");
  await assert.rejects(existingImage("https://res.cloudinary.com/example/image/upload/v123/other/test.png", true, config), { code: "INVALID_IMAGE" });
});
