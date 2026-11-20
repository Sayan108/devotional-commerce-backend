import { HttpError, clean, iso } from "../services/common.js";

export function storefrontController({ auth, catalog, addresses, commerce, returns, db, settings }) {
  return {
    health: (_req, res) => res.json({ status: "ok", otpMode: settings.otpMode, demoPayments: settings.demoPayments, time: iso() }),
    session: async (req, res) => res.json(await auth.view(await auth.get(req))),
    otp: async (req, res) => res.status(201).json(await auth.send(req, res)),
    verify: async (req, res) => res.json(await auth.verify(req, res)),
    logout: async (req, res) => res.json(await auth.logout(req, res)),
    wishlist: async (req, res) => {
      const profile = await db.customers.findOne({ _id: req.buyer.phone }, { projection: { saved: 1 } });
      res.json({ items: profile?.saved || [] });
    },
    saveWishlist: async (req, res) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || id.length > 90)) {
        throw new HttpError(400, "INVALID_WISHLIST", "Choose up to 100 items to save.");
      }
      const products = await db.products.find({ _id: { $in: ids }, active: true }, { projection: { _id: 1 } }).toArray();
      const profile = await db.customers.findOneAndUpdate({ _id: req.buyer.phone }, {
        $addToSet: { saved: { $each: products.map(product => product._id) } },
        $setOnInsert: { name: "", addresses: [] }
      }, { upsert: true, returnDocument: "after" });
      res.json({ items: profile.saved || [] });
    },
    removeWishlist: async (req, res) => {
      const profile = await db.customers.findOneAndUpdate({ _id: req.buyer.phone }, {
        $pull: { saved: req.params.id }
      }, { returnDocument: "after" });
      res.json({ items: profile?.saved || [] });
    },
    home: async (_req, res) => res.json(await catalog.home()),
    collections: async (_req, res) => res.json({ items: await catalog.listCollections() }),
    products: async (req, res) => res.json(await catalog.browse(req.query)),
    product: async (req, res) => res.json(await catalog.product(req.params.slug)),
    plans: async (_req, res) => res.json({ items: await catalog.listPlans() }),
    plan: async (req, res) => res.json(await catalog.getPlan(req.params.slug)),
    serviceability: async (req, res) => {
      const pin = clean(req.body?.pin);
      if (!/^\d{6}$/.test(pin)) throw new HttpError(400, "INVALID_PIN", "Enter a six-digit PIN.", { pin: "Enter a six-digit PIN." });
      return res.json({ ...await catalog.coverageFor(pin), checkedAt: iso() });
    },
    addresses: async (req, res) => res.json({ items: await addresses.list(req.buyer.phone) }),
    addAddress: async (req, res) => res.status(201).json(await addresses.put(req.buyer.phone, req.body || {})),
    editAddress: async (req, res) => res.json(await addresses.put(req.buyer.phone, req.body || {}, req.params.id)),
    removeAddress: async (req, res) => {
      await addresses.remove(req.buyer.phone, req.params.id);
      res.status(204).end();
    },
    quote: async (req, res) => res.json(await commerce.quote(req.buyer.phone, req.buyer.account, req.body || {})),
    getQuote: async (req, res) => res.json(await commerce.getQuote(req.buyer.phone, req.params.id)),
    place: async (req, res) => {
      const { order, created } = await commerce.place(req.buyer.phone, req.body?.quoteId, clean(req.get("Idempotency-Key")));
      res.status(created ? 201 : 200).json(order);
    },
    pay: async (req, res) => {
      const { orderRef, outcome } = req.body || {};
      if (typeof orderRef !== "string") throw new HttpError(400, "ORDER_REQUIRED", "An order reference is required.");
      return res.json(await commerce.payment(req.buyer.phone, orderRef, outcome));
    },
    orders: async (req, res) => res.json({ items: await commerce.list(req.buyer.phone) }),
    order: async (req, res) => res.json(await commerce.get(req.buyer.phone, req.params.ref)),
    packageAddress: async (req, res) => res.json(await commerce.packageAddress(req.buyer.phone, req.params.ref, req.body?.address)),
    requestReturn: async (req, res) => {
      const { entry, created } = await returns.submit(req.buyer.phone, req.body || {});
      return res.status(created ? 201 : 200).json(entry);
    },
    returnStatus: async (req, res) => res.json(await returns.get(req.buyer.phone, req.params.ref)),
    paymentWebhook: async (req, res) => {
      if (!settings.demoPayments) throw new HttpError(404, "NOT_FOUND", "Payment events are unavailable.");
      const id = clean(req.body?.eventId || req.body?.payload?.payment?.entity?.id);
      if (!id) throw new HttpError(400, "EVENT_ID", "A demo event ID is required.");
      const result = await db.webhookInbox.updateOne({ _id: id }, { $setOnInsert: { receivedAt: new Date() } }, { upsert: true });
      res.json({ received: true, duplicate: !result.upsertedCount });
    }
  };
}
