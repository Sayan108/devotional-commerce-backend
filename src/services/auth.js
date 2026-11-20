import { HttpError, day, hash, iso, minute, phoneNumber, token, validPhone } from "./common.js";

const cookieName = "arghya_session";
const sessionId = req => req.headers.cookie?.match(/(?:^|;\s*)arghya_session=([A-Za-z0-9_-]+)/)?.[1];

export function authService(db, settings) {
  const cookieOptions = { httpOnly: true, sameSite: settings.secureCookies ? "none" : "lax", secure: settings.secureCookies, path: "/" };
  const get = req => {
    const id = sessionId(req);
    return id ? db.sessions.findOne({ _id: hash(id), expiresAt: { $gt: new Date() } }) : null;
  };
  const create = async (res, data = {}) => {
    const id = token();
    const entry = { _id: hash(id), expiresAt: new Date(Date.now() + (data.phone ? 30 * day : 10 * minute)), ...data };
    await db.sessions.insertOne(entry);
    res.cookie(cookieName, id, { ...cookieOptions, maxAge: entry.expiresAt.getTime() - Date.now() });
    return entry;
  };
  const view = async buyer => {
    if (!buyer?.phone) return { verified: false, account: false };
    const profile = buyer.account && await db.customers.findOne({ _id: buyer.phone }, { projection: { name: 1 } });
    return {
      verified: true, account: buyer.account, phone: buyer.phone, name: profile?.name || "",
      admin: buyer.account && settings.adminPhones.has(buyer.phone)
    };
  };
  const limit = async (identity, window, allowed) => {
    const period = Math.floor(Date.now() / window);
    const _id = hash(identity + ":" + period);
    const count = await db.otpLimits.findOneAndUpdate({ _id }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((period + 1) * window) }
    }, { upsert: true, returnDocument: "after" });
    if (count.count > allowed) throw new HttpError(429, "OTP_LIMIT", "Too many verification requests. Try again later.");
  };

  async function send(req, res) {
    const phone = phoneNumber(req.body?.phone);
    if (!validPhone(phone)) throw new HttpError(400, "INVALID_MOBILE", "Enter a valid 10-digit Indian mobile number.");
    const buyer = await get(req) || await create(res);
    const now = Date.now();
    const account = req.body?.guest !== true;
    const id = token();
    const challenge = { id, phone, account, attempts: 0, retryAt: now + 30_000, expires: now + 5 * minute };
    const locked = await db.sessions.updateOne({
      _id: buyer._id, $or: [{ "challenge.retryAt": { $lte: now } }, { challenge: { $exists: false } }]
    }, { $set: { challenge } });
    if (!locked.modifiedCount) throw new HttpError(429, "RESEND_WAIT", "Wait 30 seconds before requesting another code.");
    try {
      await limit("phone:" + phone, 60 * minute, 5);
      await limit("ip:" + req.ip, 60 * minute, 30);
      let fixtureCode;
      if (settings.otpMode === "demo") {
        fixtureCode = "123456";
        await db.sessions.updateOne({ _id: buyer._id, "challenge.id": id }, { $set: { "challenge.digest": hash(id + fixtureCode) } });
      } else {
        const sent = await verifyCall(settings.twilio, "Verifications", { To: "+91" + phone, Channel: "sms" });
        await db.sessions.updateOne({ _id: buyer._id, "challenge.id": id }, { $set: { "challenge.providerId": sent.sid } });
      }
      return { challengeId: id, phone, retryAt: iso(challenge.retryAt), ...(fixtureCode && { fixtureCode }) };
    } catch (error) {
      await db.sessions.updateOne({ _id: buyer._id, "challenge.id": id }, { $unset: { challenge: "" } });
      throw error;
    }
  }

  async function verify(req, res) {
    const id = req.body?.challengeId;
    const code = req.body?.code;
    const sessionKey = sessionId(req);
    if (!sessionKey || typeof id !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new HttpError(400, "INVALID_CODE", "Enter the six-digit verification code.");
    }
    const buyer = await db.sessions.findOneAndUpdate({
      _id: hash(sessionKey), expiresAt: { $gt: new Date() },
      "challenge.id": id, "challenge.expires": { $gt: Date.now() }, "challenge.attempts": { $lt: 5 }
    }, { $inc: { "challenge.attempts": 1 } }, { returnDocument: "after" });
    if (!buyer) throw new HttpError(400, "CODE_EXPIRED", "The code expired or ran out of attempts. Request a new code.");
    const challenge = buyer.challenge;
    const approved = settings.otpMode === "demo" ?
      challenge.digest === hash(id + code) :
      challenge.providerId && (await verifyCall(settings.twilio, "VerificationCheck", { VerificationSid: challenge.providerId, Code: code }, true)).status === "approved";
    if (!approved) throw new HttpError(400, "INCORRECT_CODE", "That code does not match.");
    const used = await db.sessions.deleteOne({ _id: buyer._id, "challenge.id": id });
    if (!used.deletedCount) throw new HttpError(400, "CODE_EXPIRED", "That code has already been used.");
    return view(await create(res, {
      phone: challenge.phone,
      account: challenge.account || Boolean(buyer.account && buyer.phone === challenge.phone)
    }));
  }

  async function logout(req, res) {
    const id = sessionId(req);
    if (id) await db.sessions.deleteOne({ _id: hash(id) });
    res.clearCookie(cookieName, cookieOptions);
    return view(null);
  }
  return { get, view, send, verify, logout };
}

async function verifyCall(config, resource, payload, checking = false) {
  let response;
  try {
    response = await fetch("https://verify.twilio.com/v2/Services/" + encodeURIComponent(config.service) + "/" + resource, {
      method: "POST", headers: {
        Authorization: "Basic " + Buffer.from(config.key + ":" + config.secret).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(payload), signal: AbortSignal.timeout(9000)
    });
  } catch {
    throw new HttpError(503, "SMS_UNAVAILABLE", "SMS verification is temporarily unavailable.");
  }
  if (checking && (response.status === 400 || response.status === 404)) return { status: "invalid" };
  if (response.status === 429) throw new HttpError(429, "OTP_LIMIT", "Too many verification requests. Try again later.");
  if (!response.ok) throw new HttpError(503, "SMS_UNAVAILABLE", "SMS verification is temporarily unavailable.");
  return response.json();
}
