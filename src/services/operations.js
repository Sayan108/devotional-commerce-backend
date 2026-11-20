import { HttpError, clean, minute, token } from "./common.js";

const transitions = new Map([
  ["mark_ready", ["paid", "ready", "Packed"]],
  ["fallback_handoff", ["ready", "in_transit", "Rider assigned"]],
  ["mark_in_transit", ["ready", "in_transit", "Rider assigned"]],
  ["mark_delivered", ["in_transit", "delivered", "Delivered"]]
]);

export function operationsService(db, commerce) {
  async function list() {
    await commerce.reconcileDue();
    return (await db.orders.find().sort({ placedAt: -1 }).limit(100).toArray())
      .map(({ _id, state, promiseBy, totalPaise, lines, phone }) => ({
        orderRef: _id, state, promiseBy, totalPaise, lines, buyerMasked: "+91 •••••• " + phone.slice(-4)
      }));
  }
  async function metrics() {
    await commerce.reconcileDue();
    const now = Date.now();
    const [summary] = await db.orders.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: {
        _id: null,
        revenuePaise: { $sum: "$totalPaise" },
        paidUnassigned: { $sum: { $cond: [{ $eq: ["$state", "paid"] }, 1, 0] } },
        packing: { $sum: { $cond: [{ $eq: ["$state", "ready"] }, 1, 0] } },
        dueSoon: { $sum: { $cond: [{ $and: [
          { $ne: ["$state", "delivered"] }, { $gte: ["$promiseBy", new Date(now)] }, { $lt: ["$promiseBy", new Date(now + 4 * 60 * minute)] }
        ] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$state", "delivered"] }, { $lt: ["$promiseBy", new Date(now)] }] }, 1, 0] } }
      } }
    ]).toArray();
    if (!summary) return { revenuePaise: 0, paidUnassigned: 0, packing: 0, dueSoon: 0, overdue: 0 };
    const { _id, ...view } = summary;
    return view;
  }

  async function detail(id) {
    const order = await db.orders.findOne({ _id: id });
    if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found.");
    const { state, promiseBy, totalPaise, lines, phone, drops } = order;
    return {
      orderRef: id, state, promiseBy, totalPaise, lines, buyerMasked: "+91 •••••• " + phone.slice(-4),
      drops: drops.map(({ number, date, state }) => ({ number, date, state }))
    };
  }

  async function action(id, { action, reason }) {
    const transition = transitions.get(action);
    if (!transition || !clean(reason)) throw new HttpError(400, "INVALID_ACTION", "An action and reason are required.");
    const [from, to, milestone] = transition;
    const result = await db.transaction(async session => {
      const row = await db.orders.findOne({ _id: id }, { session });
      if (!row) throw new HttpError(404, "NOT_FOUND", "Order not found.");
      if (row.paymentStatus !== "paid" || ![from, to].includes(row.state)) {
        throw new HttpError(409, "ORDER_STATE", "This action is unavailable at the current stage.");
      }
      if (row.state === from) {
        const updates = { state: to };
        if (row.drops.length && ["in_transit", "delivered"].includes(to)) updates["drops.0.state"] = to;
        await db.orders.updateOne({ _id: id }, {
          $set: updates,
          $push: { timeline: { milestone, at: new Date(), detail: "The merchant updated your delivery." } }
        }, { session });
      }
      return { orderRef: id, state: to };
    });
    return { order: result, auditRef: "audit_" + token() };
  }

  async function drop(id, number, { state, reason }) {
    if (!["in_transit", "delivered"].includes(state) || number < 2 || !clean(reason)) {
      throw new HttpError(400, "INVALID_DROP_ACTION", "Choose a drop, status, and reason.");
    }
    return db.transaction(async session => {
      const order = await db.orders.findOne({ _id: id, paymentStatus: "paid", planId: { $type: "string" } }, { session });
      const drop = order?.drops.find(entry => entry.number === number);
      if (!drop) throw new HttpError(404, "NOT_FOUND", "Package drop not found.");
      if (drop.state === state) return drop;
      const from = state === "in_transit" ? "upcoming" : "in_transit";
      if (drop.state !== from || order.drops[number - 2].state !== "delivered") {
        throw new HttpError(409, "DROP_STATE", "Complete the previous drop and follow the delivery sequence.");
      }
      if (state === "in_transit") await commerce.changeInventory(order.inventory, -1, session);
      const field = "drops." + (number - 1) + ".state";
      await db.orders.updateOne({ _id: id }, { $set: { [field]: state } }, { session });
      return { ...drop, state };
    });
  }
  return { list, metrics, detail, action, drop };
}
