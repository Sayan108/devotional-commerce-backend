export function settings(env = process.env) {
  const otpMode = env.OTP_MODE || "twilio";
  const host = env.RENDER ? "0.0.0.0" : (env.HOST || "127.0.0.1");
  if (!["twilio", "demo"].includes(otpMode)) throw new Error("OTP_MODE must be twilio or demo.");
  const twilio = { service: env.TWILIO_VERIFY_SERVICE_SID, key: env.TWILIO_API_KEY, secret: env.TWILIO_API_SECRET };
  if (otpMode === "twilio" && Object.values(twilio).some(value => !value)) {
    throw new Error("Set the Twilio Verify credentials or set OTP_MODE=demo.");
  }
  const demoPayments = env.PAYMENT_MODE === "demo" || (otpMode === "demo" && !env.PAYMENT_MODE);
  return {
    uri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/?replicaSet=arghya",
    dbName: env.MONGODB_DATABASE || "arghya",
    port: Number(env.PORT || 4000), host, otpMode, twilio,
    demoPayments,
    secureCookies: env.NODE_ENV === "production",
    adminPhones: new Set((env.ADMIN_MOBILES || (otpMode === "demo" ? "9876543210" : "")).split(",").map(phone => phone.trim()))
  };
}
