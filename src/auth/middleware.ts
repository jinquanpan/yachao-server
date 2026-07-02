import type { RequestHandler } from "express";
import { AppError } from "../errors.js";
import { bearerToken, findActiveSession } from "./service.js";

export const userAuth: RequestHandler = async (req, _res, next) => {
  try {
    const session = await findActiveSession(bearerToken(req.headers.authorization));
    if (!session) throw new AppError(401, "SESSION_EXPIRED", "会话已失效，请重新登录");
    req.user = { id: session.user_id, session_id: session.id, token_hash: session.token_hash };
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalUserAuth: RequestHandler = async (req, _res, next) => {
  const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return next();
  try {
    const session = await findActiveSession(match[1]);
    if (session) req.user = { id: session.user_id, session_id: session.id, token_hash: session.token_hash };
    next();
  } catch (error) {
    next(error);
  }
};
