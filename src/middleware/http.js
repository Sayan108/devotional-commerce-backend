import { HttpError } from "../services/common.js";

export const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function access(auth, settings) {
  const buyer = asyncHandler(async (req, _res, next) => {
    req.buyer = await auth.get(req);
    if (!req.buyer?.phone) throw new HttpError(401, "VERIFY_MOBILE", "Verify your mobile number to continue.");
    next();
  });
  const account = (req, _res, next) => {
    if (!req.buyer.account) return next(new HttpError(401, "SIGN_IN", "Sign in to manage your account."));
    next();
  };
  const staff = (req, _res, next) => {
    if (!req.buyer.account || !settings.adminPhones.has(req.buyer.phone)) {
      return next(new HttpError(403, "STAFF_ONLY", "Staff access is required."));
    }
    next();
  };
  return { buyer, account, staff };
}

export function handleError(err, _req, res, next) {
  if (res.headersSent) return next(err);
  let error = err;
  if (err.type === "entity.too.large") error = new HttpError(413, "TOO_LARGE", "Choose smaller photos.");
  if (err.type === "entity.parse.failed") error = new HttpError(400, "INVALID_JSON", "The request body must contain valid JSON.");
  if (!(error instanceof HttpError)) {
    console.error("Request failed", res.get("X-Request-ID"), error.name, error.code || "");
    error = new HttpError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
  res.status(error.status).json({
    code: error.code, message: error.message, requestId: res.get("X-Request-ID"),
    ...(error.fieldErrors && { fieldErrors: error.fieldErrors })
  });
}
