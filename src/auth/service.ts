import type { PoolConnection } from "mysql2/promise";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { newToken, tokenHash } from "../lib/crypto.js";
import type { DbRow } from "../domain/types.js";

export interface IssuedSession {
  token: string;
  expires_at: string;
}

export async function issueSession(connection: PoolConnection, userId: string, metadata: { device?: string; platform?: string; ip?: string }): Promise<IssuedSession> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
  await connection.execute(
    "INSERT INTO user_sessions (user_id, token, device, platform, ip, expire_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, tokenHash(token), metadata.device ?? null, metadata.platform ?? null, metadata.ip ?? null, expiresAt]
  );
  return { token, expires_at: expiresAt.toISOString() };
}

export async function findActiveSession(rawToken: string): Promise<{ id: string; user_id: string; token_hash: string; role: "user" | "super_admin" } | null> {
  if (!rawToken) return null;
  const { db } = await import("../db.js");
  const hash = tokenHash(rawToken);
  const [rows] = await db.query<DbRow[]>(
    `SELECT s.id, s.user_id, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expire_at > CURRENT_TIMESTAMP AND u.status = 1
      LIMIT 1`,
    [hash]
  );
  const row = rows[0];
  return row ? { id: String(row.id), user_id: String(row.user_id), token_hash: hash, role: row.role === "super_admin" ? "super_admin" : "user" } : null;
}

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AppError(401, "UNAUTHORIZED", "缺少用户会话 Token");
  return match[1];
}
