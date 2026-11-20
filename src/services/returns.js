import { HttpError, clean, token } from "./common.js";

const reasons = new Set(["damaged", "wrong", "missing", "other"]);
const transitions = {
  requested: ["under_review", "Under review", "The merchant is reviewing your request."],
  under_review: ["initiated", "Refund initiated", "The recorded refund was initiated to your original payment method."],
  initiated: ["processed", "Refund processed", "The merchant marked the refund as processed."]
};

function view({ _id, phone, photos, ...entry }) {
  return { ...entry, requestRef: _id, photoCount: photos.length };
}
const notFound = () => new HttpError(404, "NOT_FOUND", "This return could not be found.");

function validPhoto(photo) {
  if (typeof photo !== "string" || photo.length > 1_100_000) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match) return false;
  const bytes = Buffer.from(match[2].slice(0, 24), "base64");
  if (match[1] === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === "png") return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

export function returnService(db, commerce) {
  async function submit(phone, body) {
    const { orderRef, reason, photos } = body;
    if (typeof orderRef !== "string") throw new HttpError(400, "ORDER_REQUIRED", "Choose a paid order.");
    const order = await commerce.load(phone, orderRef);
    if (order.paymentStatus !== "paid") throw new HttpError(409, "ORDER_UNPAID", "Returns are available for paid orders.");
    const existing = await db.returns.findOne({ orderRef, phone });
    if (existing) return { entry: view(existing), created: false };
    if (!reasons.has(reason)) throw new HttpError(400, "RETURN_REASON", "Choose a reason for the return.");
    if (!Array.isArray(photos) || photos.length > 5 || (reason === "damaged" && !photos.length) || !photos.every(validPhoto)) {
      throw new HttpError(400, "RETURN_PHOTOS", "Add up to five JPEG, PNG or WebP photos. A damaged item needs at least one photo.");
    }
    const entry = {
      _id: "RR-" + token().slice(0, 12), phone, orderRef, reason, photos, detail: clean(body.detail, 500),
      status: "requested", refundMethod: "Original payment method", refundAmountPaise: null,
      timeline: [{ milestone: "Request received", at: new Date(), detail: "Your return request is awaiting review." }]
    };
    try { await db.returns.insertOne(entry); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const duplicate = await db.returns.findOne({ orderRef, phone });
      if (!duplicate) throw error;
      return { entry: view(duplicate), created: false };
    }
    return { entry: view(entry), created: true };
  }
  async function get(phone, ref) {
    const entry = await db.returns.findOne({ _id: ref, phone });
    if (!entry) throw notFound();
    return view(entry);
  }
  async function update({ requestRef, status, amountPaise }) {
    if (typeof requestRef !== "string") throw notFound();
    const entry = await db.returns.findOne({ _id: requestRef });
    if (!entry) throw notFound();
    const next = transitions[entry.status];
    if (!next || status !== next[0]) throw new HttpError(409, "REFUND_STATE", "This refund transition is unavailable.");
    const change = { status };
    if (status === "initiated") {
      const order = await db.orders.findOne({ _id: entry.orderRef });
      if (!Number.isInteger(amountPaise) || amountPaise < 1 || amountPaise > order.totalPaise) {
        throw new HttpError(400, "REFUND_AMOUNT", "Enter an amount within the amount paid.");
      }
      change.refundAmountPaise = amountPaise;
    }
    const saved = await db.returns.findOneAndUpdate({ _id: requestRef, status: entry.status }, {
      $set: change, $push: { timeline: { milestone: next[1], detail: next[2], at: new Date() } }
    }, { returnDocument: "after" });
    if (!saved) throw new HttpError(409, "REFUND_STATE", "This refund was updated. Refresh the request.");
    return view(saved);
  }
  async function list() {
    return (await db.returns.aggregate([
      { $addFields: { photoCount: { $size: "$photos" } } },
      { $project: { phone: 0, photos: 0 } },
      { $sort: { "timeline.0.at": -1 } }
    ]).toArray())
      .map(({ _id, ...entry }) => ({ ...entry, requestRef: _id }));
  }
  async function photo(ref, index) {
    if (!Number.isInteger(index) || index < 0 || index > 4) throw notFound();
    const entry = await db.returns.findOne({ _id: ref }, { projection: { photos: 1 } });
    const image = entry?.photos[index];
    if (!image) throw notFound();
    const comma = image.indexOf(",");
    return { type: image.slice(5, image.indexOf(";")), body: Buffer.from(image.slice(comma + 1), "base64") };
  }
  return { submit, get, update, list, photo };
}
