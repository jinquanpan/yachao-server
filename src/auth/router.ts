import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { tokenHash } from "../lib/crypto.js";
import { parse, requireUserId } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";
import { userAuth } from "./middleware.js";
import { bearerToken, issueSession } from "./service.js";

const router = Router();
const loginMetadata = z.object({
  device: z.string().trim().max(64).optional(),
  platform: z.enum(["android", "ios", "pc"]).optional()
});

const phoneLoginSchema = loginMetadata.extend({
  phone: z.string().regex(/^1\d{10}$/, "手机号格式错误"),
  code: z.string().min(4).max(12)
});

const oauthLoginSchema = loginMetadata.extend({
  identity_type: z.enum(["wechat", "apple"]),
  identifier: z.string().trim().min(1).max(128),
  credential: z.string().max(255).optional(),
  phone: z.string().regex(/^1\d{10}$/).optional()
});

function publicUser(row: DbRow) {
  return { id: String(row.id), phone: row.phone, nickname: row.nickname, avatar_url: row.avatar_url, platform: row.platform };
}

router.post("/phone/login", async (req, res) => {
  const input = parse(phoneLoginSchema, req.body);
  if (config.NODE_ENV === "production") throw new AppError(503, "SMS_PROVIDER_NOT_CONFIGURED", "短信验证码服务尚未配置");
  if (input.code !== config.DEV_LOGIN_CODE) throw new AppError(401, "INVALID_VERIFICATION_CODE", "验证码错误");

  const result = await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM users WHERE phone = ? FOR UPDATE", [input.phone]);
    let user = rows[0];
    if (!user) {
      const [insert] = await connection.execute<ResultSetHeader>(
        "INSERT INTO users (phone, status, last_login_at, last_login_ip, platform) VALUES (?, 1, CURRENT_TIMESTAMP, ?, ?)",
        [input.phone, req.ip ?? null, input.platform ?? null]
      );
      const [created] = await connection.query<DbRow[]>("SELECT * FROM users WHERE id = ?", [insert.insertId]);
      user = created[0];
    } else {
      if (Number(user.status) !== 1) throw new AppError(403, "USER_DISABLED", "用户已被禁用");
      await connection.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?, platform = ? WHERE id = ?", [req.ip ?? null, input.platform ?? user.platform ?? null, user.id]);
    }
    if (!user) throw new AppError(500, "USER_CREATE_FAILED", "用户创建失败");
    const session = await issueSession(connection, String(user.id), { device: input.device, platform: input.platform, ip: req.ip });
    return { user: publicUser(user), session };
  });
  res.json({ data: result });
});

router.post("/oauth/login", async (req, res) => {
  const input = parse(oauthLoginSchema, req.body);
  if (config.NODE_ENV === "production" || !config.OAUTH_DEV_MODE) {
    throw new AppError(503, "OAUTH_PROVIDER_NOT_CONFIGURED", "OAuth 验证适配器尚未配置");
  }

  const result = await transaction(async (connection) => {
    const [authRows] = await connection.query<DbRow[]>(
      "SELECT * FROM user_auths WHERE identity_type = ? AND identifier = ? FOR UPDATE",
      [input.identity_type, input.identifier]
    );
    let userId = authRows[0] ? String(authRows[0].user_id) : "";
    if (!userId) {
      if (!input.phone) throw new AppError(400, "PHONE_REQUIRED", "首次第三方登录需要绑定手机号");
      const [users] = await connection.query<DbRow[]>("SELECT * FROM users WHERE phone = ? FOR UPDATE", [input.phone]);
      if (users[0]) userId = String(users[0].id);
      else {
        const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO users (phone, status, platform) VALUES (?, 1, ?)", [input.phone, input.platform ?? null]);
        userId = String(insert.insertId);
      }
      await connection.execute(
        "INSERT INTO user_auths (user_id, identity_type, identifier, credential) VALUES (?, ?, ?, ?)",
        [userId, input.identity_type, input.identifier, input.credential ? tokenHash(input.credential) : null]
      );
    }
    const [users] = await connection.query<DbRow[]>("SELECT * FROM users WHERE id = ?", [userId]);
    const user = users[0];
    if (!user || Number(user.status) !== 1) throw new AppError(403, "USER_DISABLED", "用户不可用");
    await connection.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?, platform = ? WHERE id = ?", [req.ip ?? null, input.platform ?? user.platform ?? null, userId]);
    return { user: publicUser(user), session: await issueSession(connection, userId, { device: input.device, platform: input.platform, ip: req.ip }) };
  });
  res.json({ data: result });
});

router.post("/refresh", async (req, res) => {
  const rawToken = parse(z.object({ token: z.string().min(20) }), req.body).token;
  const result = await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>(
      `SELECT s.*, u.status FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expire_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [tokenHash(rawToken)]
    );
    const session = rows[0];
    if (!session || Number(session.status) !== 1) throw new AppError(401, "SESSION_EXPIRED", "会话已失效");
    await connection.execute("DELETE FROM user_sessions WHERE id = ?", [session.id]);
    return issueSession(connection, String(session.user_id), { device: String(session.device ?? "") || undefined, platform: String(session.platform ?? "") || undefined, ip: req.ip });
  });
  res.json({ data: result });
});

router.post("/logout", userAuth, async (req, res) => {
  bearerToken(req.headers.authorization);
  await db.execute("DELETE FROM user_sessions WHERE id = ? AND user_id = ?", [req.user!.session_id, requireUserId(req)]);
  res.status(204).send();
});

export const authRouter = router;
