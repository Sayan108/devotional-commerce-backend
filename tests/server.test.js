import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { settings } from "../src/config/settings.js";
import { openDatabase } from "../src/models/database.js";
import { schedule } from "../src/services/catalog.js";

function client(base) {
  let cookie;
  return async (path, { method = "GET", body, key } = {}) => {
    const result = await fetch(base + path, {
      method, headers: {
        ...(cookie && { Cookie: cookie }), ...(body && { "Content-Type": "application/json" }), ...(key && { "Idempotency-Key": key })
      }, ...(body && { body: JSON.stringify(body) })
    });
    const next = result.headers.get("set-cookie");
    if (next) cookie = next.split(";")[0];
    return { status: result.status, data: result.status === 204 ? null : await result.json() };
  };
}
const post = body => ({ method: "POST", body });
const address = { name: "Test Buyer", phone: "9123456789", street: "24B Lake Road", locality: "Ballygunge", pin: "700029" };

async function signIn(call, phone, guest = false) {
  const sent = await call("/v1/auth/challenges", post({ phone, guest }));
  assert.equal(sent.status, 201);
  assert.equal(await call("/v1/auth/challenges/verify", post({
    challengeId: sent.data.challengeId, code: sent.data.fixtureCode === "000000" ? "111111" : "000000"
  })).then(result => result.status), 400);
  const verification = await call("/v1/auth/challenges/verify", post({
    challengeId: sent.data.challengeId, code: sent.data.fixtureCode
  }));
  assert.equal(verification.status, 200);
  assert.equal(verification.data.account, !guest);
  return verification.data;
}

test("monthly schedule clamps a short month and restores the original anchor", () => {
  const dates = schedule({ cadence: "monthly", drops: 4 }, Date.parse("2026-01-30T08:00:00Z")).map(drop => drop.date);
  assert.deepEqual(dates, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("MongoDB-backed storefront and operations", async t => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  const config = settings({
    OTP_MODE: "demo", MONGODB_URI: uri,
    MONGODB_DATABASE: "arghya_test_" + randomUUID().replaceAll("-", "")
  });
  let db;
  try { db = await openDatabase(config); }
  catch (error) {
    if (uri || error.name !== "MongoServerSelectionError") throw error;
    t.skip("Set MONGODB_TEST_URI to run integration tests against a local replica set.");
    return;
  }
  const { app, reconcilePayments } = createApp(db, config);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.db.dropDatabase();
    await db.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const buyer = client(base);
  const another = client(base);
  const staff = client(base);
  let ordinaryOrder;

  await t.test("OTP, address validation, PIN and Bengali search", async () => {
    assert.equal((await buyer("/v1/orders")).status, 401);
    const session = await signIn(buyer, "9123456789");
    assert.equal(session.verified, true);
    assert.equal((await buyer("/admin/orders")).status, 403);
    assert.deepEqual((await buyer("/v1/wishlist", post({ ids: ["cotton-wicks"] }))).data.items, ["cotton-wicks"]);
    assert.deepEqual((await buyer("/v1/wishlist")).data.items, ["cotton-wicks"]);
    assert.deepEqual((await buyer("/v1/wishlist/cotton-wicks", { method: "DELETE" })).data.items, []);
    assert.equal((await buyer("/v1/serviceability", post({ pin: "700099" }))).data.reason, "paused");
    assert.equal((await buyer("/v1/serviceability", post({ pin: "711101" }))).data.eligible, false);
    assert.equal((await buyer("/v1/products?q=" + encodeURIComponent("সলতে"))).data.items[0].id, "cotton-wicks");
    assert.equal((await buyer("/v1/quotes", post({ address: { ...address, pin: "711101" }, lines: [{ id: "cotton-wicks", quantity: 1 }] }))).status, 422);
  });

  await t.test("concurrent placement consumes a quote once and payment survives a database reconnect", async () => {
    const quoted = await buyer("/v1/quotes", post({ address, saveAddress: true, lines: [{ id: "cotton-wicks", quantity: 1 }] }));
    assert.equal(quoted.status, 200);
    assert.equal(quoted.data.totalPaise, 11500);
    assert.equal((await buyer("/v1/addresses")).data.items[0].pin, "700029");
    const placement = { ...post({ quoteId: quoted.data.quoteId }), key: "same-attempt" };
    const pair = await Promise.all([buyer("/v1/orders", placement), buyer("/v1/orders", placement)]);
    assert.deepEqual(pair.map(result => result.status).sort(), [200, 201]);
    ordinaryOrder = pair[0].data.orderRef;
    assert.equal(ordinaryOrder, pair[1].data.orderRef);
    assert.equal((await db.inventory.findOne({ _id: "cotton-wicks" })).available, 23);
    assert.equal((await buyer("/v1/payments/verify", post({ orderRef: ordinaryOrder, outcome: "failed" }))).data.paymentStatus, "failed");
    assert.equal((await buyer("/v1/payments/verify", post({ orderRef: ordinaryOrder, outcome: "pending" }))).data.paymentStatus, "pending");
    await db.orders.updateOne({ _id: ordinaryOrder }, { $set: { confirmAt: new Date(Date.now() - 1000) } });
    await reconcilePayments();
    const second = await openDatabase(config);
    try {
      const stored = await second.orders.findOne({ _id: ordinaryOrder });
      assert.equal(stored.paymentStatus, "paid");
      assert.equal(stored.timeline.filter(entry => entry.milestone === "Order confirmed").length, 1);
      assert.equal((await second.inventory.findOne({ _id: "cotton-wicks" })).available, 23);
    } finally { await second.close(); }
    await signIn(another, "9234567890", true);
    assert.equal((await another("/v1/orders/" + ordinaryOrder)).status, 404);
    assert.equal((await another("/v1/addresses")).status, 401);
  });

  await t.test("inventory expiry, prepaid package, staff tracking and refund status", async () => {
    const reserved = await buyer("/v1/quotes", post({ address, lines: [{ id: "brass-pradip-pair", quantity: 1 }] }));
    assert.equal(reserved.data.subtotalPaise, 74900);
    const order = await buyer("/v1/orders", { ...post({ quoteId: reserved.data.quoteId }), key: "expired-attempt" });
    await db.orders.updateOne({ _id: order.data.orderRef }, { $set: { paymentExpiresAt: new Date(Date.now() - 1000) } });
    await reconcilePayments();
    assert.equal((await db.inventory.findOne({ _id: "brass-pradip-pair" })).available, 8);

    const plan = await buyer("/v1/quotes", post({ address, planId: "weekly-puja" }));
    assert.equal(plan.data.drops.length, 4);
    assert.equal(plan.data.deliveryPaise, 0);
    const checkout = await buyer("/v1/orders", { ...post({ quoteId: plan.data.quoteId }), key: "package-attempt" });
    const ref = checkout.data.orderRef;
    await buyer("/v1/payments/verify", post({ orderRef: ref, outcome: "confirmed" }));
    const adjusted = await buyer("/v1/orders/" + ref + "/package-address", {
      method: "PUT", body: { address: { ...address, street: "30 Lake Road" } }
    });
    assert.equal(adjusted.data.drops[0].address, undefined);
    assert.equal(adjusted.data.drops[1].address.street, "30 Lake Road");

    assert.equal((await signIn(staff, "9876543210")).admin, true);
    for (const action of ["mark_ready", "mark_in_transit", "mark_delivered"]) {
      assert.equal((await staff("/admin/orders/" + ref + "/actions", post({ action, reason: "Integration test" }))).status, 200);
    }
    assert.equal((await staff("/admin/orders/" + ref)).data.drops[0].state, "delivered");
    const returned = await buyer("/v1/returns", post({ orderRef: ordinaryOrder, reason: "wrong", photos: [] }));
    assert.equal(returned.status, 201);
    const requestRef = returned.data.requestRef;
    await staff("/admin/refunds", post({ requestRef, status: "under_review" }));
    assert.equal((await staff("/admin/refunds", post({ requestRef, status: "initiated", amountPaise: 11501 }))).status, 400);
    assert.equal((await staff("/admin/refunds", post({ requestRef, status: "initiated", amountPaise: 8500 }))).status, 200);
    assert.equal((await buyer("/v1/returns/" + requestRef)).data.refundAmountPaise, 8500);
    assert.equal((await another("/v1/returns/" + requestRef)).status, 404);
  });
});
