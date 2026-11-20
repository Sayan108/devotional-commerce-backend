export function settings(env = process.env) {
  const otpMode = env.OTP_MODE || "twilio";
  const host = env.HOST || "127.0.0.1";
  if (!["twilio", "demo"].includes(otpMode)) throw new Error("OTP_MODE must be twilio or demo.");
  if (otpMode === "demo" && (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("Demo OTP is restricted to local development.");
  }
  const twilio = { service: env.TWILIO_VERIFY_SERVICE_SID, key: env.TWILIO_API_KEY, secret: env.TWILIO_API_SECRET };
  if (otpMode === "twilio" && Object.values(twilio).some(value => !value)) {
    throw new Error("Set the Twilio Verify credentials or explicitly enable local demo OTP.");
  }
  const demoPayments = env.PAYMENT_MODE === "demo" || (otpMode === "demo" && !env.PAYMENT_MODE);
  if (demoPayments && (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("Demo payments are restricted to local development.");
  }
  return {
    uri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/?replicaSet=arghya",
    dbName: env.MONGODB_DATABASE || "arghya",
    port: Number(env.PORT || 4000), host, otpMode, twilio,
    demoPayments,
    secureCookies: env.NODE_ENV === "production",
    adminPhones: new Set((env.ADMIN_MOBILES || (otpMode === "demo" ? "9876543210" : "")).split(",").map(phone => phone.trim()))
  };
}
