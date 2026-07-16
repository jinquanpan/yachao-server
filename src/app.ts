import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { addressesRouter } from "./addresses/router.js";
import { adminRouter } from "./admin/router.js";
import { authRouter } from "./auth/router.js";
import { cartRouter } from "./cart/router.js";
import { catalogRouter } from "./catalog/router.js";
import { config } from "./config.js";
import { couponsRouter, meCouponsRouter } from "./coupons/router.js";
import { db } from "./db.js";
import { favoritesRouter } from "./favorites/router.js";
import { authenticate, errorHandler, notFound, requestContext } from "./middleware.js";
import { checkoutRouter, ordersRouter } from "./orders/router.js";
import { orderPayments, paymentCallbacks, payments } from "./payments/router.js";
import { resourceRouter } from "./resources/router.js";
import { scanRouter, uploadsRouter } from "./scan/router.js";
import { appRouter } from "./system/router.js";
import { meRouter } from "./users/router.js";

function corsOrigin() {
  if (config.CORS_ORIGIN.trim() === "*") return "*";
  return config.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean);
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: corsOrigin() }));
  app.use(express.json({ limit: "1mb", verify: (req, _res, buffer) => { (req as express.Request).rawBody = Buffer.from(buffer); } }));
  app.use(requestContext);
  app.use("/uploads", express.static(path.resolve(config.UPLOAD_DIR), { fallthrough: false, maxAge: "7d" }));

  app.get(`${config.API_PREFIX}/health`, async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });
  });

  const sensitiveLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  app.use(`${config.API_PREFIX}/auth`, sensitiveLimit, authRouter);
  app.use(`${config.API_PREFIX}/me/coupons`, sensitiveLimit, meCouponsRouter);
  app.use(`${config.API_PREFIX}/me`, meRouter);
  app.use(config.API_PREFIX, catalogRouter);
  app.use(`${config.API_PREFIX}/cart`, cartRouter);
  app.use(`${config.API_PREFIX}/favorites`, favoritesRouter);
  app.use(`${config.API_PREFIX}/addresses`, addressesRouter);
  app.use(`${config.API_PREFIX}/checkout`, sensitiveLimit, checkoutRouter);
  app.use(`${config.API_PREFIX}/orders`, sensitiveLimit, orderPayments);
  app.use(`${config.API_PREFIX}/orders`, ordersRouter);
  app.use(`${config.API_PREFIX}/payments`, payments);
  app.use(config.API_PREFIX, paymentCallbacks);
  app.use(`${config.API_PREFIX}/coupons`, sensitiveLimit, couponsRouter);
  app.use(`${config.API_PREFIX}/scan`, sensitiveLimit, scanRouter);
  app.use(`${config.API_PREFIX}/uploads`, sensitiveLimit, uploadsRouter);
  app.use(`${config.API_PREFIX}/app`, appRouter);
  app.use(`${config.API_PREFIX}/admin`, adminRouter);
  app.use(`${config.API_PREFIX}/resources`, authenticate, resourceRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
