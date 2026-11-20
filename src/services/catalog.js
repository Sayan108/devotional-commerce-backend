import { popular } from "../models/catalog.seed.js";
import { HttpError, clean, day, indiaOffset } from "./common.js";

function publicDocument({ _id, rank, ...view }) { return view; }
const normalize = value => typeof value === "string" ? value.normalize("NFKC").toLowerCase().trim() : "";

export function schedule(plan, now = Date.now()) {
  const first = new Date(now + day + indiaOffset);
  const anchor = first.getUTCDate();
  return Array.from({ length: plan.drops }, (_, index) => {
    const date = new Date(first);
    if (plan.cadence === "weekly") date.setUTCDate(anchor + index * plan.intervalDays);
    else {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + index);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(anchor, last));
    }
    return { number: index + 1, date: date.toISOString().slice(0, 10), state: "upcoming" };
  });
}
const planView = ({ firstDrop, ...plan }) => ({ ...publicDocument(plan), dates: schedule(plan).map(drop => drop.date) });

export function catalogService(db) {
  async function availability(ids, session) {
    const rows = await db.inventory.find({ _id: { $in: ids } }, { session }).toArray();
    return new Map(rows.map(row => [row._id, row.available]));
  }
  async function displayProducts(products) {
    const stock = await availability(products.flatMap(product => product.variants.map(option => option.id)));
    return products.map(document => {
      const product = publicDocument(document);
      const variants = product.variants.map(option => ({ ...option, stock: stock.get(option.id) || 0 }));
      const first = variants[0];
      return { ...product, variants, pricePaise: first.pricePaise, stock: first.stock, packSize: first.packSize, unit: first.packSize };
    });
  }
  async function browse(input) {
    const query = normalize(clean(input.q, 100));
    const categories = normalize(input.category).split(",").filter(Boolean).map(name => name === "essentials" ? "wicks" : name);
    const documents = await db.products.find({ active: true, ...(categories.length && { category: { $in: categories } }) }).sort({ rank: 1 }).toArray();
    const matches = documents.filter(p => {
      if (input.tag && !p.tags?.includes(input.tag)) return false;
      const haystack = normalize([p.name, p.bengali, p.category, p.material, ...(p.aliases || [])].join(" "));
      return !query || query.split(/\s+/).every(word => haystack.includes(word));
    });
    const items = (await displayProducts(matches)).filter(product => product.variants.some(variant =>
      (input.inStock !== "1" || variant.stock > 0) &&
      (!input.min || variant.pricePaise >= Number(input.min) * 100) &&
      (!input.max || variant.pricePaise <= Number(input.max) * 100)
    ));
    if (input.sort === "price-asc") items.sort((a, b) => a.pricePaise - b.pricePaise);
    if (input.sort === "price-desc") items.sort((a, b) => b.pricePaise - a.pricePaise);
    if (input.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    const suggestions = query ? [...new Set(items.flatMap(p => p.aliases || []).filter(alias => normalize(alias).includes(query)))].slice(0, 4) : [];
    return { items, suggestions, nextCursor: null };
  }
  async function product(slug) {
    const item = await db.products.findOne({ slug, active: true });
    if (!item) throw new HttpError(404, "NOT_FOUND", "This product could not be found.");
    return (await displayProducts([item]))[0];
  }
  async function plan(slug, session) {
    const item = await db.plans.findOne({ _id: slug }, { session });
    if (!item) throw new HttpError(404, "NOT_FOUND", "This package could not be found.");
    return item;
  }
  async function listPlans() {
    const rows = await db.plans.find().sort({ rank: 1 }).toArray();
    return rows.map(planView);
  }
  async function listCollections() {
    const [rows, counts, planCount] = await Promise.all([
      db.collections.find().sort({ rank: 1 }).toArray(),
      db.products.aggregate([{ $match: { active: true } }, { $group: { _id: "$category", count: { $sum: 1 } } }]).toArray(),
      db.plans.countDocuments()
    ]);
    return rows.map(row => ({
      ...publicDocument(row), count: row.slug === "packages" ? planCount : counts.find(count => count._id === row.slug)?.count || 0
    }));
  }
  async function home() {
    const [groups, documents] = await Promise.all([
      listCollections(),
      db.products.find({ _id: { $in: popular }, active: true }).toArray()
    ]);
    const items = await displayProducts(documents);
    return {
      revision: "v1", published: true,
      hero: { headline: "For the morning puja", cta: "Shop essentials", poster: "/media/hero-lamp.jpg" },
      collections: groups.filter(group => group.slug !== "packages"),
      items: popular.map(id => items.find(item => item.id === id)).filter(Boolean)
    };
  }
  async function coverageFor(pin, session) {
    const entry = await db.coverage.findOne({ _id: pin }, { session });
    if (!entry) return { eligible: false, reason: "unsupported", message: "This PIN is outside the current delivery area." };
    if (entry.status !== "eligible") return { eligible: false, reason: "paused", message: "Delivery to this PIN is temporarily paused." };
    return { eligible: true, reason: "confirmed", locality: entry.locality };
  }
  async function findVariants(ids, session) {
    const found = await db.products.find({ active: true, "variants.id": { $in: ids } }, { session }).toArray();
    return new Map(found.flatMap(product => product.variants.map(variant => [variant.id, { product, variant }])));
  }
  return { home, listCollections, browse, product, getPlan: async slug => planView(await plan(slug)), plan, listPlans, coverageFor, availability, findVariants };
}
