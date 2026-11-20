import express from "express";
import { asyncHandler as wrap } from "../middleware/http.js";

export function storefrontRoutes(c, g) {
  const router = express.Router();
  router.get("/health", wrap(c.health));
  router.get("/auth/session", wrap(c.session));
  router.post("/auth/challenges", wrap(c.otp));
  router.post("/auth/challenges/verify", wrap(c.verify));
  router.post("/auth/logout", wrap(c.logout));
  router.get("/wishlist", g.buyer, g.account, wrap(c.wishlist));
  router.post("/wishlist", g.buyer, g.account, wrap(c.saveWishlist));
  router.delete("/wishlist/:id", g.buyer, g.account, wrap(c.removeWishlist));
  router.get("/home", wrap(c.home));
  router.get("/collections", wrap(c.collections));
  router.get("/products", wrap(c.products));
  router.get("/products/:slug", wrap(c.product));
  router.get("/plans", wrap(c.plans));
  router.get("/plans/:slug", wrap(c.plan));
  router.post("/serviceability", wrap(c.serviceability));
  router.get("/addresses", g.buyer, g.account, wrap(c.addresses));
  router.post("/addresses", g.buyer, g.account, wrap(c.addAddress));
  router.put("/addresses/:id", g.buyer, g.account, wrap(c.editAddress));
  router.delete("/addresses/:id", g.buyer, g.account, wrap(c.removeAddress));
  router.post("/quotes", g.buyer, wrap(c.quote));
  router.get("/quotes/:id", g.buyer, wrap(c.getQuote));
  router.post("/orders", g.buyer, wrap(c.place));
  router.get("/orders", g.buyer, wrap(c.orders));
  router.get("/orders/:ref", g.buyer, wrap(c.order));
  router.put("/orders/:ref/package-address", g.buyer, wrap(c.packageAddress));
  router.post("/payments/verify", g.buyer, wrap(c.pay));
  router.post("/returns", g.buyer, express.json({ limit: "6mb" }), wrap(c.requestReturn));
  router.get("/returns/:ref", g.buyer, wrap(c.returnStatus));
  router.post("/webhooks/razorpay", wrap(c.paymentWebhook));
  return router;
}

export function operationsRoutes(c, g) {
  const router = express.Router();
  router.use(g.buyer, g.staff);
  router.get("/metrics", wrap(c.metrics));
  router.get("/orders", wrap(c.orders));
  router.get("/orders/:id", wrap(c.order));
  router.post("/orders/:id/actions", wrap(c.orderAction));
  router.post("/orders/:id/drops/:number/actions", wrap(c.dropAction));
  router.post("/refunds", wrap(c.refund));
  router.get("/returns", wrap(c.returns));
  router.get("/returns/:ref/photos/:index", wrap(c.returnPhoto));
  router.get("/plans", wrap(c.plans));
  router.get("/coverage", wrap(c.coverage));
  return router;
}
