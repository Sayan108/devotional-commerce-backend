import { HttpError, hash } from "./common.js";

export function adminCoverageService(db) {
  async function save(pin, input, actor) {
    if (!/^\d{6}$/.test(pin) || typeof input.locality !== "string" ||
      !input.locality.trim() || input.locality.trim().length > 120 ||
      !["eligible", "paused"].includes(input.status) ||
      typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 300) {
      throw new HttpError(400, "INVALID_COVERAGE", "Enter a six-digit PIN, locality, status, and reason.");
    }
    return db.transaction(async session => {
      const entry = { pin, locality: input.locality.trim(), status: input.status };
      await db.coverage.updateOne({ _id: pin }, { $set: entry }, { session, upsert: true });
      await db.adminAudit.insertOne({
        action: "coverage.update", pin, status: input.status, actor: hash(actor), reason: input.reason.trim(), at: new Date()
      }, { session });
      return entry;
    });
  }
  return { save };
}
