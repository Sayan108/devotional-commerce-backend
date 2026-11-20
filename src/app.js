import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { access, handleError } from "./middleware/http.js";
import { storefrontController } from "./controllers/storefront.js";
import { operationsController } from "./controllers/operations.js";
import { storefrontRoutes, operationsRoutes } from "./routes/index.js";
import { authService } from "./services/auth.js";
import { catalogService } from "./services/catalog.js";
import { addressService } from "./services/addresses.js";
import { commerceService } from "./services/commerce.js";
import { returnService } from "./services/returns.js";
import { operationsService } from "./services/operations.js";
import { HttpError } from "./services/common.js";

const mediaDirectory = fileURLToPath(new URL("../public/media/", import.meta.url));

export function createApp(db, settings) {
  const auth = authService(db, settings);
  const catalog = catalogService(db);
  const addresses = addressService(db, catalog);
  const commerce = commerceService(db, catalog, addresses, settings);
  const returns = returnService(db, commerce);
  const operations = operationsService(db, commerce);
  const gate = access(auth, settings);

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      if (!settings.allowedOrigins.has(origin) && origin !== `${req.protocol}://${req.get("host")}`) {
        return next(new HttpError(403, "ORIGIN_DENIED", "This origin is not allowed."));
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("X-Request-ID", crypto.randomUUID());
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/v1/") || req.path.startsWith("/admin/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
    }
    next();
  });

  const json = express.json({ limit: "64kb" });
  app.use((req, res, next) => {
    const upload = req.method === "POST" && /^\/v1\/returns\/?$/i.test(req.path);
    return upload ? next() : json(req, res, next);
  });
  app.use("/media", express.static(mediaDirectory, { maxAge: "1d" }));
  app.use("/v1", storefrontRoutes(storefrontController({ auth, catalog, addresses, commerce, returns, db, settings }), gate));
  app.use("/admin", operationsRoutes(operationsController({ operations, catalog, db, returns }), gate));
  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Page not found.")));
  app.use(handleError);
  return { app, reconcilePayments: commerce.reconcileDue };
}
