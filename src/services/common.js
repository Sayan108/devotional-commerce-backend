import crypto from "node:crypto";

export const minute = 60_000;
export const day = 24 * 60 * minute;
export const indiaOffset = 330 * minute;
export const iso = (time = Date.now()) => new Date(time).toISOString();
export const token = () => crypto.randomBytes(24).toString("base64url");
export const hash = value => crypto.createHash("sha256").update(value).digest("hex");
export const clean = (value, limit = 120) => typeof value === "string" ? value.trim().slice(0, limit) : "";
export const phoneNumber = value => typeof value === "string" ? value.replace(/[\s-]/g, "").replace(/^\+91/, "") : "";
export const validPhone = value => /^[6-9]\d{9}$/.test(value);

export class HttpError extends Error {
  constructor(status, code, message, fieldErrors) {
    super(message);
    Object.assign(this, { status, code, fieldErrors });
  }
}
