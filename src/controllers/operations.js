export function operationsController({ operations, catalog, db, returns }) {
  return {
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
