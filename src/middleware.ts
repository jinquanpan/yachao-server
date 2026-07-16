import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { config } from "./config.js";
import { findActiveSession } from "./auth/service.js";
import { AppError } from "./errors.js";

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] ?? randomUUID());
  res.setHeader("x-request-id", req.requestId);
  next();
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (config.API_TOKEN) {
    const actual = Buffer.from(token);
    const expected = Buffer.from(config.API_TOKEN);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return next();
  }
  try {
    const session = await findActiveSession(token);
    if (!session) throw new AppError(401, "UNAUTHORIZED", "未授权访问");
    if (session.role !== "super_admin") throw new AppError(403, "SUPER_ADMIN_REQUIRED", "仅超级用户可访问管理或收银平台");
    req.user = { id: session.user_id, session_id: session.id, token_hash: session.token_hash, role: session.role };
    next();
  } catch (error) {
    next(error);
  }
};

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", "接口不存在"));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details },
      requestId: req.requestId
    });
    return;
  }

  const mysqlError = error as { code?: string; sqlMessage?: string };
  if (mysqlError.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "图片不能超过 5MB" }, requestId: req.requestId });
    return;
  }
  if (mysqlError.code === "ER_DUP_ENTRY") {
    res.status(409).json({ error: { code: "DUPLICATE_ENTRY", message: "数据已存在" }, requestId: req.requestId });
    return;
  }
  if (mysqlError.code === "ER_NO_REFERENCED_ROW_2" || mysqlError.code === "ER_ROW_IS_REFERENCED_2") {
    res.status(409).json({ error: { code: "RELATION_CONFLICT", message: "关联数据不存在或仍被引用" }, requestId: req.requestId });
    return;
  }

  console.error(`[${req.requestId}]`, error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" }, requestId: req.requestId });
};
