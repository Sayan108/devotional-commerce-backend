import { HttpError, clean, day, minute, token } from "./common.js";
import { checkedAddress } from "./addresses.js";
import { isPriced, schedule } from "./catalog.js";

const missingQuote = () => new HttpError(409, "QUOTE_EXPIRED", "Refresh the quote before payment.");
const notFound = () => new HttpError(404, "NOT_FOUND", "This order could not be found.");
const milestone = (name, detail) => ({ milestone: name, detail, at: new Date() });

function quoteView({ _id, phone, inventory, purgeAt, ...quote }) {
  return { ...quote, quoteId: _id };
}

function orderView({ _id, phone, inventory, confirmAt, attemptKey, ...order }, returnRef = null) {
  return { ...order, orderRef: _id, returnRef };
}

export function commerceService(db, catalog, addresses, settings) {
  async function selection(body, session) {
    const { lines, planId } = body;
    if (planId != null) {
      if (typeof planId !== "string" || (Array.isArray(lines) && lines.length)) {
        throw new HttpError(400, "SEPARATE_CHECKOUT", "Packages are checked out separately from individual items.");
      }
      const plan = await catalog.plan(planId, session);
      return {
        plan, inventory: plan.firstDrop,
        lines: [{ id: plan.id, slug: plan.slug, name: plan.name, quantity: 1, pricePaise: plan.pricePaise,
          unit: plan.drops + " " + plan.cadence + " drops", image: plan.image }]
      };
    }
    if (!Array.isArray(lines) || !lines.length || lines.length > 30) throw new HttpError(400, "EMPTY_BAG", "Add items to your bag before checking out.");
    const inventory = Object.create(null);
    for (const { id, quantity } of lines.map(line => line || {})) {
      if (typeof id !== "string" || !/^[a-z0-9-]{1,90}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "An item in your bag is no longer available.");
      if (!Number.isInteger(quantity) || quantity < 1 || (inventory[id] || 0) + quantity > 10) {
        throw new HttpError(400, "INVALID_QUANTITY", "Choose between 1 and 10 of each item.");
      }
      inventory[id] = (inventory[id] || 0) + quantity;
    }
    const options = await catalog.findVariants(Object.keys(inventory), session);
    return { inventory, lines: Object.entries(inventory).map(([id, quantity]) => {
      const found = options.get(id);
      if (!found) throw new HttpError(404, "NOT_FOUND", "An item in your bag is no longer available.");
      const { product, variant } = found;
      if (!isPriced(variant.pricePaise)) throw new HttpError(409, "PRICE_UNCONFIRMED", "This product is not yet available to order.");
      return {
        id, slug: product.slug, name: product.name, bengali: product.bengali, quantity,
        unit: variant.packSize, pricePaise: variant.pricePaise, image: product.image
      };
    }) };
  }

  async function quote(phone, account, body) {
    const address = await checkedAddress(body.address, catalog);
    const { plan, lines, inventory } = await selection(body);
    const stock = await catalog.availability(Object.keys(inventory));
    if (Object.entries(inventory).some(([id, count]) => (stock.get(id) || 0) < count)) {
      throw new HttpError(409, "OUT_OF_STOCK", "An item is unavailable at the selected quantity. Review your bag.");
    }
    const now = Date.now();
    const subtotalPaise = lines.reduce((sum, item) => sum + item.pricePaise * item.quantity, 0);
    const deliveryPaise = plan || subtotalPaise >= 50000 ? 0 : 3000;
    const record = {
      _id: "qt_" + token(), phone, inventory, address, lines, planId: plan?.id || null, drops: plan ? schedule(plan, now) : [],
      subtotalPaise, deliveryPaise, taxPaise: 0, totalPaise: subtotalPaise + deliveryPaise, currency: "INR",
      expiresAt: new Date(now + 15 * minute), promiseBy: new Date(now + day), purgeAt: new Date(now + day)
    };
    if (account && body.saveAddress === true) await addresses.put(phone, address, null, true);
    await db.quotes.insertOne(record);
    return quoteView(record);
  }

  async function getQuote(phone, id) {
    const record = await db.quotes.findOne({ _id: id, phone });
    if (!record) throw missingQuote();
    const order = await db.orders.findOne({ quoteId: id, phone }, { projection: { _id: 1 } });
    if (!order && record.expiresAt <= new Date()) throw missingQuote();
    return { ...quoteView(record), orderRef: order?._id || null };
  }

  async function changeInventory(inventory, sign, session) {
    for (const [id, quantity] of Object.entries(inventory)) {
      const result = await db.inventory.updateOne({
        _id: id, ...(sign < 0 && { available: { $gte: quantity } })
      }, { $inc: { available: sign * quantity } }, { session });
      if (!result.matchedCount) throw new HttpError(409, "OUT_OF_STOCK", "Stock changed. Review the selected items and try again.");
    }
  }

  async function place(phone, id, attemptKey) {
    if (typeof id !== "string") throw missingQuote();
    if (!attemptKey) throw new HttpError(400, "IDEMPOTENCY_REQUIRED", "A checkout attempt key is required.");
    return db.transaction(async session => {
      const existing = await db.orders.findOne({ phone, attemptKey }, { session }) ||
        await db.orders.findOne({ phone, quoteId: id }, { session });
      if (existing) {
        if (existing.quoteId !== id) throw new HttpError(409, "ATTEMPT_CONFLICT", "Start a new checkout attempt for this quote.");
        return { order: orderView(existing), created: false };
      }
      const current = await db.quotes.findOne({ _id: id, phone, expiresAt: { $gt: new Date() } }, { session });
      if (!current) throw missingQuote();
      if (!settings.demoPayments) throw new HttpError(503, "PAYMENT_UNAVAILABLE", "Online payment is temporarily unavailable.");
      await checkedAddress(current.address, catalog, session);
      const planId = current.planId;
      const checked = await selection(planId ? { planId } : { lines: current.lines }, session);
      const sourceChanged = checked.lines.some((line, index) => line.pricePaise !== current.lines[index].pricePaise);
      if (sourceChanged || JSON.stringify(checked.inventory) !== JSON.stringify(current.inventory)) {
        throw new HttpError(409, "PRICE_CHANGED", "The order changed. Review a fresh quote.");
      }

      const sequence = await db.sequences.findOneAndUpdate({ _id: "orders" }, { $inc: { value: 1 } }, {
        upsert: true, returnDocument: "after", session
      });
      await changeInventory(current.inventory, -1, session);
      const now = Date.now();
      const { _id: quoteId, purgeAt, expiresAt, ...snapshot } = current;
      const record = {
        ...snapshot, _id: "ARG-" + String(1000 + sequence.value).padStart(5, "0"), quoteId, attemptKey,
        placedAt: new Date(now), promiseBy: new Date(now + day), paymentExpiresAt: new Date(now + 15 * minute),
        paymentStatus: "awaiting", state: "pending_payment",
        timeline: [milestone("Order placed", "Awaiting payment confirmation.")]
      };
      await db.orders.insertOne(record, { session });
      return { order: orderView(record), created: true };
    });
  }

  async function completePayment(order, outcome, session, now) {
    if (order.paymentStatus === "paid" || order.paymentStatus === "expired") return order;
    const updates = {};
    let event;
    if (order.paymentStatus === "pending" && order.confirmAt && order.confirmAt <= now && order.confirmAt < order.paymentExpiresAt) {
      outcome = "confirmed";
    } else if (order.paymentExpiresAt <= now) {
      await changeInventory(order.inventory, 1, session);
      updates.paymentStatus = "expired";
      updates.state = "payment_expired";
      outcome = null;
    } else if (order.paymentStatus === "pending") return order;

    if (outcome === "confirmed") {
      Object.assign(updates, { paymentStatus: "paid", state: "paid", paidAt: now, confirmAt: null });
      event = milestone("Order confirmed", "Demo payment confirmed.");
    } else if (outcome === "pending") {
      Object.assign(updates, {
        paymentStatus: "pending", confirmAt: new Date(Math.min(now.getTime() + 12_000, order.paymentExpiresAt.getTime() - 1))
      });
    } else if (outcome === "failed" && order.paymentStatus !== "failed") {
      updates.paymentStatus = "failed";
      event = milestone("Payment attempt failed", "Payment can be retried before the hold expires.");
    }
    if (!Object.keys(updates).length) return order;
    await db.orders.updateOne({ _id: order._id }, {
      $set: updates, ...(event && { $push: { timeline: event } })
    }, { session });
    return { ...order, ...updates, timeline: event ? [...order.timeline, event] : order.timeline };
  }

  async function applyPayment(filter, outcome) {
    return db.transaction(async session => {
      const order = await db.orders.findOne(filter, { session });
      if (!order) throw notFound();
      return completePayment(order, outcome, session, new Date());
    });
  }

  async function payment(phone, ref, outcome) {
    if (!settings.demoPayments) throw new HttpError(503, "PAYMENT_UNAVAILABLE", "Online payment is temporarily unavailable.");
    if (!["confirmed", "pending", "failed"].includes(outcome)) throw new HttpError(400, "INVALID_PAYMENT", "Choose a demo payment outcome.");
    const order = await applyPayment({ _id: ref, phone }, outcome);
    return orderView(order);
  }

  const due = now => ({
    $or: [
      { paymentStatus: { $in: ["awaiting", "pending", "failed"] }, paymentExpiresAt: { $lte: now } },
      { paymentStatus: "pending", confirmAt: { $lte: now, $type: "date" } }
    ]
  });

  async function reconcileDue() {
    const rows = await db.orders.find(due(new Date()), { projection: { _id: 1 } }).limit(100).toArray();
    for (const { _id } of rows) await applyPayment({ _id }, null);
  }

  async function load(phone, ref) {
    let order = await db.orders.findOne({ _id: ref, phone });
    if (!order) throw notFound();
    const now = new Date();
    if (order.paymentExpiresAt <= now || order.confirmAt && order.confirmAt <= now) order = await applyPayment({ _id: ref, phone }, null);
    return order;
  }

  async function get(phone, ref) {
    const order = await load(phone, ref);
    const entry = await db.returns.findOne({ orderRef: ref, phone }, { projection: { _id: 1 } });
    return orderView(order, entry?._id);
  }
  async function list(phone) {
    await reconcileDue();
    const [orders, requests] = await Promise.all([
      db.orders.find({ phone }).sort({ placedAt: -1 }).toArray(),
      db.returns.find({ phone }, { projection: { orderRef: 1 } }).toArray()
    ]);
    const refs = new Map(requests.map(entry => [entry.orderRef, entry._id]));
    return orders.map(order => orderView(order, refs.get(order._id)));
  }

  async function packageAddress(phone, ref, input) {
    const address = await checkedAddress(input, catalog);
    return db.transaction(async session => {
      const order = await db.orders.findOne({ _id: ref, phone }, { session });
      if (!order) throw notFound();
      if (!order.planId || order.paymentStatus !== "paid") throw new HttpError(409, "PACKAGE_REQUIRED", "A paid package is required.");
      if (!order.drops.some(drop => drop.number > 1 && drop.state === "upcoming")) {
        throw new HttpError(409, "NO_UPCOMING_DROPS", "There are no upcoming drops to update.");
      }
      const drops = order.drops.map(drop => drop.number > 1 && drop.state === "upcoming" ? { ...drop, address } : drop);
      await db.orders.updateOne({ _id: ref }, { $set: { drops } }, { session });
      return orderView({ ...order, drops });
    });
  }

  return { quote, getQuote, place, payment, get, list, load, packageAddress, reconcileDue, changeInventory };
}
