import { env as defaults } from "../env.js";

const pick = (env, key) => env[key] == null || env[key] === "" ? defaults[key] : env[key];

export function settings(env = process.env) {
  const otpMode = pick(env, "OTP_MODE") || "twilio";
  const host = env.RENDER ? "0.0.0.0" : (pick(env, "HOST") || "127.0.0.1");
  if (!["twilio", "demo"].includes(otpMode)) throw new Error("OTP_MODE must be twilio or demo.");
  const twilio = { service: env.TWILIO_VERIFY_SERVICE_SID, key: env.TWILIO_API_KEY, secret: env.TWILIO_API_SECRET };
  if (otpMode === "twilio" && Object.values(twilio).some(value => !value)) {
    throw new Error("Set the Twilio Verify credentials or set OTP_MODE=demo.");
  }
  const demoPayments = pick(env, "PAYMENT_MODE") === "demo" || (otpMode === "demo" && !pick(env, "PAYMENT_MODE"));
  return {
    uri: pick(env, "MONGODB_URI") || "mongodb://127.0.0.1:27017/?replicaSet=arghya",
    dbName: pick(env, "MONGODB_DATABASE") || "arghya",
    port: Number(pick(env, "PORT") || 4000), host, otpMode, twilio,
    demoPayments,
    secureCookies: env.NODE_ENV === "production",
    adminPhones: new Set((pick(env, "ADMIN_MOBILES") || (otpMode === "demo" ? "9876543210" : "")).split(",").map(phone => phone.trim()))
  };
}
