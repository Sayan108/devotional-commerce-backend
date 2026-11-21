import { HttpError, hash, token } from "./common.js";

const notFound = () => new HttpError(404, "NOT_FOUND", "Customer or support case not found.");
const mask = phone => "+91 •••••• " + phone.slice(-4);
const validRef = ref => typeof ref === "string" && /^ARG-\d+$/.test(ref);
const caseView = ({ _id, phone, ...entry }) => ({ ...entry, caseRef: _id });

function requiredText(value, limit, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) {
    throw new HttpError(400, "INVALID_SUPPORT", `Enter ${label} (maximum ${limit} characters).`);
  }
  return value.trim();
}

export function supportService(db) {
  const cases = db.supportCases;
  const audit = db.adminAudit;
  async function customers() {
    const rows = await db.orders.aggregate([
      { $sort: { placedAt: -1 } },
      { $group: { _id: "$phone", latestOrder: { $first: "$_id" }, latestAt: { $first: "$placedAt" }, orderCount: { $sum: 1 } } },
      { $sort: { latestAt: -1 } }, { $limit: 100 }
    ]).toArray();
    return rows.map(({ _id, ...row }) => ({ ...row, buyerMasked: mask(_id) }));
  }
  async function customer(ref) {
    if (!validRef(ref)) throw notFound();
    const order = await db.orders.findOne({ _id: ref }, { projection: { phone: 1 } });
    if (!order) throw notFound();
    const [orders, entries] = await Promise.all([
      db.orders.find({ phone: order.phone }, { projection: { state: 1, totalPaise: 1, placedAt: 1 } }).sort({ placedAt: -1 }).limit(100).toArray(),
      cases.find({ phone: order.phone }).sort({ updatedAt: -1 }).limit(100).toArray()
    ]);
    return { buyerMasked: mask(order.phone), orders: orders.map(({ _id, ...row }) => ({ ...row, orderRef: _id })), cases: entries.map(caseView) };
  }
  async function create(ref, body, actor) {
    if (!validRef(ref)) throw notFound();
    const subject = requiredText(body.subject, 120, "a subject");
    const note = requiredText(body.note, 2000, "a note");
    return db.transaction(async session => {
      const order = await db.orders.findOne({ _id: ref }, { projection: { phone: 1 }, session });
      if (!order) throw notFound();
      const now = new Date();
      const entry = { _id: "CASE-" + token().slice(0, 16), phone: order.phone, orderRef: ref, subject, status: "open",
        notes: [{ text: note, at: now }], createdAt: now, updatedAt: now };
      await cases.insertOne(entry, { session });
      await audit.insertOne({ action: "support.create", caseRef: entry._id, actor: hash(actor), at: now }, { session });
      return caseView(entry);
    });
  }
  async function update(ref, body, actor) {
    if (typeof ref !== "string" || !/^CASE-[A-Za-z0-9_-]{16}$/.test(ref)) throw notFound();
    const note = requiredText(body.note, 2000, "a note");
    if (!["open", "closed"].includes(body.status)) throw new HttpError(400, "INVALID_SUPPORT", "Choose open or closed.");
    return db.transaction(async session => {
      const now = new Date();
      const entry = await cases.findOneAndUpdate({ _id: ref, $expr: { $lt: [{ $size: "$notes" }, 200] } }, {
        $set: { status: body.status, updatedAt: now }, $push: { notes: { text: note, at: now } }
      }, { session, returnDocument: "after" });
      if (!entry) {
        if (await cases.findOne({ _id: ref }, { projection: { _id: 1 }, session })) {
          throw new HttpError(409, "CASE_FULL", "This case has reached 200 notes. Create another case to continue.");
        }
        throw notFound();
      }
      await audit.insertOne({ action: "support.update", caseRef: ref, actor: hash(actor), at: now }, { session });
      return caseView(entry);
    });
  }
  return { customers, customer, create, update };
}
