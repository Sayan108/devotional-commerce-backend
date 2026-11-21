import { HttpError, hash } from "./common.js";
import { existingImage } from "./media.js";

const invalid = message => new HttpError(400, "INVALID_PRODUCT", message);

function text(value, label, max, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw invalid(`Enter a valid ${label} (maximum ${max} characters).`);
  }
  return value.trim();
}

export function adminCatalogService(db, media = {}) {
  async function categories() {
    return (await db.collections.find({}).sort({ rank: 1, name: 1 }).toArray())
      .map(({ _id, ...category }) => category);
  }

  async function saveCategory(id, input, actor) {
    if (!/^[a-z0-9-]{1,90}$/.test(id)) throw invalid("Invalid category identifier.");
    const name = text(input.name, "category name", 120, true);
    const bengali = text(input.bengali, "Bengali category name", 120);
    const image = text(input.image, "image path", 250);
    await existingImage(image, false, media);
    const reason = text(input.reason, "change reason", 300, true);
    if (typeof input.active !== "boolean") throw invalid("Choose whether the category is active.");
    return db.transaction(async session => {
      if (!input.active && await db.products.countDocuments({ category: id, active: true }, { session, limit: 1 })) {
        throw new HttpError(409, "CATEGORY_IN_USE", "Archive active products in this category first.");
      }
      const current = await db.collections.findOne({ _id: id }, { session });
      if (current) {
        await db.collections.updateOne({ _id: id }, { $set: { name, bengali, image, thumbnail: image, active: input.active } }, { session });
      } else {
        await db.collections.insertOne({ _id: id, slug: id, name, bengali, image, thumbnail: image, active: input.active }, { session });
      }
      await db.adminAudit.insertOne({ action: current ? "category.update" : "category.create", categoryId: id, actor: hash(actor), reason, at: new Date() }, { session });
      return { slug: id };
    });
  }

  async function create(input, actor) {
    const id = text(input.id, "product identifier", 90, true);
    if (!/^[a-z0-9-]+$/.test(id)) throw invalid("Product identifier must contain lowercase letters, numbers, and hyphens.");
    const name = text(input.name, "product name", 120, true);
    const bengali = text(input.bengali, "Bengali name", 120);
    const category = text(input.category, "category", 90, true);
    const reason = text(input.reason, "change reason", 300, true);
    const image = text(input.image, "image path", 250);
    await existingImage(image, false, media);
    try {
      return await db.transaction(async session => {
        if (!await db.collections.findOne({ _id: category, active: true }, { session })) {
          throw invalid("Choose an active category.");
        }
        await db.products.insertOne({
          _id: id, id, slug: id, name, bengali, category, image, description: "", bengaliDescription: "",
          aliases: [], active: false, adminRevision: 0, createdByAdmin: true,
          variants: [{ id, packSize: null, pricePaise: null, stock: 0 }]
        }, { session });
        await db.inventory.insertOne({ _id: id, available: 0 }, { session });
        await db.adminAudit.insertOne({ action: "product.create", productId: id, actor: hash(actor), reason, at: new Date() }, { session });
        return { id };
      });
    } catch (error) {
      if (error.code === 11000) throw new HttpError(409, "DUPLICATE_PRODUCT", "That product or SKU already exists.");
      throw error;
    }
  }

  async function list() {
    const products = await db.products.find({}).sort({ rank: 1, name: 1 }).toArray();
    const inventory = await db.inventory.find({
      _id: { $in: products.flatMap(product => product.variants.map(variant => variant.id)) }
    }).toArray();
    const available = new Map(inventory.map(row => [row._id, row.available]));
    return products.map(({ _id, ...product }) => ({
      ...product, variants: product.variants.map(variant => ({
        ...variant, stock: available.get(variant.id) ?? 0
      }))
    }));
  }

  async function update(id, input, actor) {
    if (!/^[a-z0-9-]{1,90}$/.test(id)) throw invalid("Invalid product identifier.");
    const name = text(input.name, "product name", 120, true);
    const bengali = text(input.bengali, "Bengali name", 120);
    const description = text(input.description, "description", 2000);
    const bengaliDescription = text(input.bengaliDescription, "Bengali description", 2000);
    const image = text(input.image, "image path", 250);
    const packSize = input.packSize === undefined ? undefined : text(input.packSize, "pack size", 100);
    await existingImage(image, false, media);
    if (!Array.isArray(input.aliases) || input.aliases.length > 30 ||
      input.aliases.some(alias => typeof alias !== "string" || !alias.trim() || alias.trim().length > 100)) {
      throw invalid("Enter up to 30 valid search aliases.");
    }
    if (typeof input.active !== "boolean") throw invalid("Choose whether the product is active.");
    if (input.pricePaise !== null && (!Number.isSafeInteger(input.pricePaise) || input.pricePaise < 0 || input.pricePaise > 100000000)) {
      throw invalid("Enter a valid price in paise or leave it unconfirmed.");
    }
    if (!Number.isSafeInteger(input.stockDelta) || Math.abs(input.stockDelta) > 100000) throw invalid("Enter a valid stock adjustment.");
    const reason = text(input.reason, "change reason", 300, true);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw invalid("Refresh the product before saving.");

    return db.transaction(async session => {
      const current = await db.products.findOne({ _id: id }, { session });
      if (!current) throw new HttpError(404, "NOT_FOUND", "Product not found.");
      if ((current.adminRevision || 0) !== input.revision) throw new HttpError(409, "PRODUCT_CHANGED", "Product changed. Refresh before saving.");
      if (input.active) {
        const category = await db.collections.updateOne({ _id: current.category, active: true }, { $inc: { _catalogVersion: 1 } }, { session });
        if (!category.matchedCount) throw new HttpError(409, "CATEGORY_INACTIVE", "Activate the product's category before publishing.");
      }
      const variant = current.variants[0];
      if (!variant) throw new HttpError(409, "NO_VARIANT", "The product has no variant to edit.");
      const pack = packSize === undefined ? variant.packSize : packSize || null;
      if (current.createdByAdmin && input.active && (input.pricePaise === null || !image || !pack)) {
        throw invalid("Set a price, pack size, and image before publishing this product.");
      }
      const updated = await db.products.updateOne({
        _id: id, ...(input.revision ? { adminRevision: input.revision } : { $or: [{ adminRevision: { $exists: false } }, { adminRevision: 0 }] })
      }, { $set: {
        name, bengali, description, bengaliDescription, image, aliases: input.aliases.map(alias => alias.trim()),
        active: input.active, "variants.0.pricePaise": input.pricePaise, "variants.0.packSize": pack, adminRevision: input.revision + 1
      } }, { session });
      if (!updated.matchedCount) throw new HttpError(409, "PRODUCT_CHANGED", "Product changed. Refresh before saving.");
      if (input.stockDelta) {
        const stock = await db.inventory.updateOne({
          _id: variant.id, ...(input.stockDelta < 0 && { available: { $gte: -input.stockDelta } })
        }, { $inc: { available: input.stockDelta } }, { session });
        if (!stock.matchedCount) throw new HttpError(409, "STOCK_CHANGED", "Stock is unavailable or the adjustment exceeds available stock.");
      }
      await db.adminAudit.insertOne({
        action: "product.update", productId: id, variantId: variant.id, stockDelta: input.stockDelta,
        actor: hash(actor), reason, at: new Date(), revision: input.revision + 1
      }, { session });
      return { id, revision: input.revision + 1 };
    });
  }
  return { list, update, create, categories, saveCategory };
}
