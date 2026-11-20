import { setDefaultResultOrder } from "node:dns";
import { MongoClient } from "mongodb";
import { catalogRevision, products, collections, coverage } from "./catalog.seed.js";

setDefaultResultOrder("ipv4first");

export async function openDatabase({ uri, dbName }) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    family: 4,
    autoSelectFamily: false
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Arghya requires a MongoDB replica set for checkout transactions.");

    const tables = Object.fromEntries([
      "products", "plans", "collections", "coverage", "inventory", "sessions", "otpLimits",
      "customers", "quotes", "orders", "returns", "webhookInbox", "sequences", "catalogMigrations"
    ].map(name => [name, db.collection(name)]));
    const { sessions, otpLimits, quotes, orders, returns } = tables;
    await Promise.all([
      sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      otpLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      tables.products.createIndex({ slug: 1 }, { unique: true }),
      tables.products.createIndex({ "variants.id": 1 }, { unique: true }),
      tables.products.createIndex({ active: 1, category: 1, rank: 1 }),
      quotes.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
      orders.createIndex({ phone: 1, placedAt: -1 }),
      orders.createIndex({ quoteId: 1 }, { unique: true }),
      orders.createIndex({ phone: 1, attemptKey: 1 }, { unique: true }),
      orders.createIndex({ paymentStatus: 1, paymentExpiresAt: 1 }),
      orders.createIndex({ paymentStatus: 1, confirmAt: 1 }),
      returns.createIndex({ orderRef: 1 }, { unique: true })
    ]);

    const transaction = operation => client.withSession(session => session.withTransaction(() => operation(session)));
    await Promise.all([
      transaction(session => replaceCatalog(tables, session)),
      insertSeeds(tables.coverage, Object.values(coverage).map(entry => ({ _id: entry.pin, ...entry })))
    ]);

    return { ...tables, db, transaction, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}

function insertSeeds(table, entries, session) {
  return table.bulkWrite(entries.map(({ _id, ...seed }) => ({
    updateOne: { filter: { _id }, update: { $setOnInsert: seed }, upsert: true }
  })), { session });
}

async function replaceCatalog(tables, session) {
  const archivedAt = new Date();
  const migration = await tables.catalogMigrations.updateOne(
    { _id: catalogRevision }, { $setOnInsert: { appliedAt: archivedAt } }, { upsert: true, session }
  );
  if (!migration.upsertedCount) return;

  const archive = { $set: { active: false, archivedAt } };
  await tables.products.updateMany({ active: { $ne: false }, _id: { $nin: products.map(product => product.id) } }, archive, { session });
  await tables.collections.updateMany({ active: { $ne: false }, _id: { $nin: collections.map(category => category.slug) } }, archive, { session });
  await tables.plans.updateMany({ active: { $ne: false } }, archive, { session });

  await insertSeeds(tables.products, products.map((product, rank) => ({ _id: product.id, ...product, rank })), session);
  await insertSeeds(tables.collections, collections.map((category, rank) => ({ _id: category.slug, ...category, rank })), session);
  // Previous stock records support reconciliation of orders already placed.
  await insertSeeds(tables.inventory, products.flatMap(product => product.variants.map(variant => ({
    _id: variant.id, available: variant.stock
  }))), session);
}
