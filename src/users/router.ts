import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { parse, requireUserId } from "../lib/http.js";
import { userAuth } from "../auth/middleware.js";

const router = Router();
router.use(userAuth);

router.get("/", async (req, res) => {
  const userId = requireUserId(req);
  const [[users], [favoriteCounts], [couponCounts], [orderCounts]] = await Promise.all([
    db.query<DbRow[]>("SELECT id, phone, username, nickname, avatar_url, platform, created_at FROM users WHERE id = ?", [userId]),
    db.query<DbRow[]>("SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?", [userId]),
    db.query<DbRow[]>("SELECT COUNT(*) AS total FROM user_coupons WHERE user_id = ? AND status = 'unused' AND expire_at > CURRENT_TIMESTAMP", [userId]),
    db.query<DbRow[]>("SELECT status, COUNT(*) AS total FROM orders WHERE user_id = ? GROUP BY status", [userId])
  ]);
  const orders = Object.fromEntries(orderCounts.map((row) => [String(row.status), Number(row.total)]));
  res.json({ data: { ...users[0], id: userId, stats: { favorites: Number(favoriteCounts[0]?.total ?? 0), available_coupons: Number(couponCounts[0]?.total ?? 0), orders } } });
});

router.patch("/", async (req, res) => {
  const input = parse(z.object({ nickname: z.string().trim().min(1).max(64).nullable().optional(), avatar_url: z.string().url().max(255).nullable().optional() }).refine((value) => Object.keys(value).length > 0), req.body);
  const entries = Object.entries(input);
  await db.execute(`UPDATE users SET ${entries.map(([field]) => `\`${field}\` = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), requireUserId(req)]);
  const [rows] = await db.query<DbRow[]>("SELECT id, phone, username, nickname, avatar_url, platform, created_at FROM users WHERE id = ?", [requireUserId(req)]);
  res.json({ data: rows[0] });
});

export const meRouter = router;
