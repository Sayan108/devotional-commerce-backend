import { HttpError, hash } from "./common.js";
import { existingImage } from "./media.js";
import { collections, popular } from "../models/catalog.seed.js";

const defaults = {
  headline: "For the morning puja", headlineBn: "সকালের পুজোর জন্য",
  cta: "Shop essentials", ctaBn: "প্রয়োজনীয় জিনিস দেখুন",
  alt: "Lit brass lamp beside a red hibiscus and red-bordered cotton cloth", altBn: "জ্বলা পিতলের প্রদীপ, লাল জবা আর লাল পাড়ের কাপড়",
  poster: "/media/hero-lamp.jpg", ctaPath: "/shop",
  featuredIds: popular, categoryIds: collections.map(category => category.slug),
  sections: ["categories", "featured", "kits"],
  kitTitle: "Puja Kits & Combos", kitTitleBn: "পুজোর সম্পূর্ণ প্যাকেজ",
  kitBlurb: "Find kits for home pujas, festivals and ceremonies.", kitBlurbBn: "বাড়ির পুজো, উৎসব ও অনুষ্ঠানের কিট খুঁজুন।",
  kitCta: "Browse puja kits", kitCtaBn: "পুজোর কিট দেখুন", kitPath: "/collections/puja-kits-combos"
};
const conflict = () => new HttpError(409, "HOME_CHANGED", "Homepage changed. Refresh before continuing.");

function content(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "INVALID_HOME", "Enter homepage content.");
  }
  input = { ...defaults, ...input };
  const result = {};
  for (const [key, limit] of Object.entries({ headline: 120, headlineBn: 120, cta: 80, ctaBn: 80, alt: 250, altBn: 250, poster: 250, ctaPath: 200,
    kitTitle: 120, kitTitleBn: 120, kitBlurb: 300, kitBlurbBn: 300, kitCta: 80, kitCtaBn: 80, kitPath: 200 })) {
    if (typeof input?.[key] !== "string" || !input[key].trim() || input[key].trim().length > limit) {
      throw new HttpError(400, "INVALID_HOME", `Enter a valid ${key}.`);
    }
    result[key] = input[key].trim();
  }
  if (!/^\/(shop|categories|collections\/[a-z0-9-]+)$/.test(result.ctaPath)) {
    throw new HttpError(400, "INVALID_HOME", "Choose a storefront shop, category, or collection path.");
  }
  if (!/^\/(shop|categories|collections\/[a-z0-9-]+)$/.test(result.kitPath)) {
    throw new HttpError(400, "INVALID_HOME", "Choose a valid kit destination.");
  }
  for (const key of ["featuredIds", "categoryIds"]) {
    const ids = input[key];
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[a-z0-9-]{1,90}$/.test(id)) ||
        new Set(ids).size !== ids.length) {
      throw new HttpError(400, "INVALID_HOME", `Enter unique valid ${key}.`);
    }
    result[key] = ids;
  }
  if (!Array.isArray(input.sections) || input.sections.length > 3 ||
      input.sections.some(section => !["categories", "featured", "kits"].includes(section)) ||
      new Set(input.sections).size !== input.sections.length) {
    throw new HttpError(400, "INVALID_HOME", "Choose unique homepage sections.");
  }
  result.sections = input.sections;
  return result;
}

export function homepageService(db, media = {}) {
  async function read() {
    const [state, history] = await Promise.all([
      db.homeContent.findOne({ _id: "homepage" }),
      db.homeRevisions.find({}).sort({ revision: -1 }).limit(20).toArray()
    ]);
    return {
      draft: { ...defaults, ...state?.draft }, published: state?.published || null,
      version: state?.version || 0, revision: state?.revision || 0,
      history: history.map(({ _id, ...entry }) => entry)
    };
  }
  async function save(input, actor) {
    const draft = content(input.draft);
    await existingImage(draft.poster, true, media);
    if (!Number.isSafeInteger(input.version) || input.version < 0) throw conflict();
    await db.transaction(async session => {
      const current = await db.homeContent.findOne({ _id: "homepage" }, { session });
      if ((current?.version || 0) !== input.version) throw conflict();
      if (current) {
        const result = await db.homeContent.updateOne({ _id: "homepage", version: input.version }, {
          $set: { draft }, $inc: { version: 1 }
        }, { session });
        if (!result.matchedCount) throw conflict();
      } else {
        try {
          await db.homeContent.insertOne({ _id: "homepage", draft, version: 1, revision: 0, published: null }, { session });
        } catch (error) {
          if (error.code === 11000) throw conflict();
          throw error;
        }
      }
      await db.adminAudit.insertOne({ action: "homepage.save", actor: hash(actor), at: new Date() }, { session });
    });
    return read();
  }
  async function publish(input, actor) {
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw conflict();
    await db.transaction(async session => {
      const current = await db.homeContent.findOne({ _id: "homepage", version: input.version }, { session });
      if (!current) throw conflict();
      let next = current.draft;
      if (input.restoreRevision !== undefined) {
        if (!Number.isSafeInteger(input.restoreRevision) || input.restoreRevision < 1) {
          throw new HttpError(400, "INVALID_REVISION", "Choose a valid revision.");
        }
        const previous = await db.homeRevisions.findOne({ revision: input.restoreRevision }, { session });
        if (!previous) throw new HttpError(404, "NOT_FOUND", "Homepage revision not found.");
        next = previous.content;
      }
      next = content(next);
      await existingImage(next.poster, true, media);
      const products = await db.products.countDocuments({ _id: { $in: next.featuredIds }, active: true }, { session });
      const categories = await db.collections.countDocuments({ _id: { $in: next.categoryIds }, active: true }, { session });
      if (products !== next.featuredIds.length || categories !== next.categoryIds.length) {
        throw new HttpError(400, "INVALID_HOME", "Featured products and categories must be active.");
      }
      const revision = current.revision + 1;
      const at = new Date();
      const updated = await db.homeContent.updateOne({ _id: "homepage", version: input.version }, {
        $set: { published: next, draft: next, revision }, $inc: { version: 1 }
      }, { session });
      if (!updated.matchedCount) throw conflict();
      await db.homeRevisions.insertOne({ revision, content: next, at }, { session });
      await db.adminAudit.insertOne({ action: input.restoreRevision ? "homepage.rollback" : "homepage.publish", revision, actor: hash(actor), at }, { session });
    });
    return read();
  }
  return { read, save, publish };
}
