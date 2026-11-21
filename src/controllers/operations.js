import { uploadImage } from "../services/media.js";

export function operationsController({ operations, catalog, db, returns, adminCatalog, support, homepage, adminCoverage, adminPlans, settings }) {
  return {
    products: async (_req, res) => res.json({ items: await adminCatalog.list() }),
    createProduct: async (req, res) => res.status(201).json(await adminCatalog.create(req.body || {}, req.buyer.phone)),
    updateProduct: async (req, res) => res.json(await adminCatalog.update(req.params.id, req.body || {}, req.buyer.phone)),
    categories: async (_req, res) => res.json({ items: await adminCatalog.categories() }),
    saveCategory: async (req, res) => res.json(await adminCatalog.saveCategory(req.params.id, req.body || {}, req.buyer.phone)),
    customers: async (_req, res) => res.json({ items: await support.customers() }),
    customer: async (req, res) => res.json(await support.customer(req.params.ref)),
    createCase: async (req, res) => res.status(201).json(await support.create(req.params.ref, req.body || {}, req.buyer.phone)),
    updateCase: async (req, res) => res.json(await support.update(req.params.ref, req.body || {}, req.buyer.phone)),
    homepage: async (_req, res) => res.json(await homepage.read()),
    saveHomepage: async (req, res) => res.json(await homepage.save(req.body || {}, req.buyer.phone)),
    publishHomepage: async (req, res) => res.json(await homepage.publish(req.body || {}, req.buyer.phone)),
    saveCoverage: async (req, res) => res.json(await adminCoverage.save(req.params.pin, req.body || {}, req.buyer.phone)),
    packageDrafts: async (_req, res) => res.json({ items: await adminPlans.list() }),
    savePackageDraft: async (req, res) => res.json(await adminPlans.save(req.body || {}, req.buyer.phone)),
    publishPackage: async (req, res) => res.json(await adminPlans.publish(req.params.id, req.body || {}, req.buyer.phone)),
    uploadMedia: async (req, res) => res.status(201).json(await uploadImage(req.body, req.get("content-type"), settings.cloudinary)),
    metrics: async (_req, res) => res.json(await operations.metrics()),
    orders: async (_req, res) => res.json({ items: await operations.list(), nextCursor: null }),
    order: async (req, res) => res.json(await operations.detail(req.params.id)),
    orderAction: async (req, res) => res.json(await operations.action(req.params.id, req.body || {})),
    dropAction: async (req, res) => res.json(await operations.drop(req.params.id, Number(req.params.number), req.body || {})),
    refund: async (req, res) => res.json(await returns.update(req.body || {})),
    returns: async (_req, res) => res.json({ items: await returns.list() }),
    returnPhoto: async (req, res) => {
      const image = await returns.photo(req.params.ref, Number(req.params.index));
      res.type(image.type).send(image.body);
    },
    plans: async (_req, res) => res.json({ items: await catalog.listPlans() }),
    coverage: async (_req, res) => res.json({
      items: await db.coverage.find({}, { projection: { _id: 0 } }).sort({ pin: 1 }).toArray()
    })
  };
}
