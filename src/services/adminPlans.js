import { HttpError, hash } from "./common.js";
import { existingImage } from "./media.js";

const invalid = message => new HttpError(400, "INVALID_PACKAGE", message);
const conflict = () => new HttpError(409, "PACKAGE_CHANGED", "Package draft changed. Refresh and try again.");

function validate(input) {
  const { id, name, cadence, drops, pricePaise, image, inventory, reason } = input;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,90}$/.test(id)) throw invalid("Enter a valid package ID.");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) throw invalid("Enter a package name.");
  if (!["weekly", "monthly"].includes(cadence)) throw invalid("Choose weekly or monthly cadence.");
  if (!Number.isInteger(drops) || drops < 1 || drops > 24) throw invalid("Choose between 1 and 24 deliveries.");
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 1 || pricePaise > 100000000) throw invalid("Enter a valid package price.");
  if (typeof image !== "string") throw invalid("Enter an image path.");
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 300) throw invalid("Enter a reason.");
  if (!Array.isArray(inventory) || !inventory.length || inventory.length > 30 ||
      inventory.some(row => !row || typeof row.id !== "string" || !/^[a-z0-9-]{1,90}$/.test(row.id) ||
        !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10) ||
      new Set(inventory.map(row => row.id)).size !== inventory.length) {
    throw invalid("Enter unique SKUs with quantities from 1 to 10.");
  }
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw conflict();
  return { id, name: name.trim(), cadence, drops, pricePaise, image: image.trim(), inventory, reason: reason.trim(), version: input.version };
}

export function adminPlansService(db, media = {}) {
  async function list() {
    const [plans, drafts] = await Promise.all([db.plans.find({}).sort({ name: 1 }).toArray(), db.planDrafts.find({}).toArray()]);
    const draftMap = new Map(drafts.map(draft => [draft._id, draft]));
    const ids = new Set([...plans.map(plan => plan._id), ...drafts.map(draft => draft._id)]);
    return [...ids].map(id => {
      const plan = plans.find(row => row._id === id);
      const draft = draftMap.get(id);
      return {
        id, active: plan?.active !== false && Boolean(plan), publishedRevision: plan?.adminRevision || 0,
        version: draft?.version || 0,
        draft: draft?.content || (plan ? {
          name: plan.name, cadence: plan.cadence, drops: plan.drops, pricePaise: plan.pricePaise, image: plan.image || "",
          inventory: Object.entries(plan.firstDrop || {}).map(([sku, quantity]) => ({ id: sku, quantity }))
        } : null)
      };
    });
  }
  async function save(input, actor) {
    const data = validate(input);
    await existingImage(data.image, true, media);
    const { id, reason, version, ...draft } = data;
    try {
      await db.transaction(async session => {
        const current = await db.planDrafts.findOne({ _id: id }, { session });
        if ((current?.version || 0) !== version) throw conflict();
        if (current) {
          const result = await db.planDrafts.updateOne({ _id: id, version }, { $set: { content: draft }, $inc: { version: 1 } }, { session });
          if (!result.matchedCount) throw conflict();
        } else {
          await db.planDrafts.insertOne({ _id: id, version: 1, content: draft }, { session });
        }
        await db.adminAudit.insertOne({ action: "package.draft", planId: id, actor: hash(actor), reason, at: new Date() }, { session });
      });
    } catch (error) {
      if (error.code === 11000) throw conflict();
      throw error;
    }
    return { id, version: version + 1 };
  }
  async function publish(id, input, actor) {
    if (!/^[a-z0-9-]{1,90}$/.test(id) || !Number.isSafeInteger(input.version) || input.version < 1 ||
        typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 300) throw invalid("Choose a saved draft and provide a reason.");
    return db.transaction(async session => {
      const saved = await db.planDrafts.findOne({ _id: id, version: input.version }, { session });
      if (!saved) throw conflict();
      const data = validate({ id, ...saved.content, version: input.version, reason: input.reason });
      await existingImage(data.image, true, media);
      const skuIds = data.inventory.map(row => row.id);
      const products = await db.products.find({ active: true, "variants.id": { $in: skuIds } }, { session }).toArray();
      const byId = new Map(products.flatMap(product => product.variants.map(variant => [variant.id, { product, variant }])));
      const items = data.inventory.map(({ id: sku, quantity }) => {
        const found = byId.get(sku);
        if (!found) throw invalid(`SKU ${sku} is not active.`);
        return { name: found.product.name, unit: `${quantity} × ${found.variant.packSize || "item"}`, image: found.product.image, icon: "box" };
      });
      const firstDrop = Object.fromEntries(data.inventory.map(row => [row.id, row.quantity]));
      const previous = await db.plans.findOne({ _id: id }, { session });
      const revision = (previous?.adminRevision || 0) + 1;
      const plan = {
        id, slug: id, name: data.name, cadence: data.cadence, drops: data.drops, intervalDays: 7,
        pricePaise: data.pricePaise, image: data.image, firstDrop, items,
        contents: items.map(item => `${item.name} (${item.unit})`).join(", "),
        duration: `${data.drops} ${data.cadence} deliveries`, active: true, adminRevision: revision
      };
      await db.plans.updateOne({ _id: id }, { $set: plan }, { upsert: true, session });
      await db.planRevisions.insertOne({ planId: id, revision, plan, at: new Date() }, { session });
      const updated = await db.planDrafts.updateOne({ _id: id, version: input.version }, { $inc: { version: 1 } }, { session });
      if (!updated.matchedCount) throw conflict();
      await db.adminAudit.insertOne({ action: "package.publish", planId: id, revision, actor: hash(actor), reason: input.reason.trim(), at: new Date() }, { session });
      return { id, revision };
    });
  }
  return { list, save, publish };
}
