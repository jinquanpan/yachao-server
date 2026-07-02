import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { money } from "../catalog/format.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { parse, positiveId, requireUserId, routeParam } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";

const router = Router();
router.use(userAuth);

function formatCoupon(row: DbRow) {
  return { ...row, id: String(row.id), coupon_id: row.coupon_id === undefined ? undefined : String(row.coupon_id), amount: row.amount === null ? null : money(row.amount), min_spend: row.min_spend === null ? null : money(row.min_spend), discount: row.discount === null ? null : String(row.discount) };
}

router.get("/available", async (req, res) => {
  const [rows] = await db.query<DbRow[]>(`SELECT c.* FROM coupons c
    WHERE CURRENT_TIMESTAMP BETWEEN c.valid_from AND c.valid_to AND c.issued < c.total
      AND NOT EXISTS (SELECT 1 FROM user_coupons uc WHERE uc.user_id = ? AND uc.coupon_id = c.id)
    ORDER BY c.valid_to, c.id`, [requireUserId(req)]);
  res.json({ data: rows.map(formatCoupon) });
});

router.post("/:id/claim", async (req, res) => {
  const couponId = positiveId(routeParam(req.params.id));
  const userId = requireUserId(req);
  const id = await transaction(async (connection) => {
    const [existing] = await connection.query<DbRow[]>("SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ? FOR UPDATE", [userId, couponId]);
    if (existing[0]) return String(existing[0].id);
    const [coupons] = await connection.query<DbRow[]>("SELECT * FROM coupons WHERE id = ? FOR UPDATE", [couponId]);
    const coupon = coupons[0];
    if (!coupon) throw new AppError(404, "COUPON_NOT_FOUND", "优惠券不存在");
    const now = Date.now();
    if (new Date(String(coupon.valid_from)).getTime() > now || new Date(String(coupon.valid_to)).getTime() <= now) throw new AppError(409, "COUPON_EXPIRED", "优惠券不在领取期");
    if (Number(coupon.issued) >= Number(coupon.total)) throw new AppError(409, "COUPON_SOLD_OUT", "优惠券已领完");
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO user_coupons (user_id, coupon_id, status, expire_at) VALUES (?, ?, 'unused', ?)", [userId, couponId, coupon.valid_to]);
    await connection.execute("UPDATE coupons SET issued = issued + 1 WHERE id = ?", [couponId]);
    return String(insert.insertId);
  });
  const [rows] = await db.query<DbRow[]>(`SELECT uc.id, uc.coupon_id, uc.status, uc.expire_at, uc.created_at, c.name, c.type, c.amount, c.min_spend, c.discount
    FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.id = ?`, [id]);
  res.json({ data: formatCoupon(rows[0] as DbRow) });
});

export const couponsRouter = router;

export const meCouponsRouter = Router();
meCouponsRouter.use(userAuth);
meCouponsRouter.get("/", async (req, res) => {
  const input = parse(z.object({ status: z.enum(["unused", "used", "expired"]).optional() }), req.query);
  const userId = requireUserId(req);
  await db.execute("UPDATE user_coupons SET status = 'expired' WHERE user_id = ? AND status = 'unused' AND expire_at <= CURRENT_TIMESTAMP", [userId]);
  const [rows] = await db.query<DbRow[]>(`SELECT uc.id, uc.coupon_id, uc.status, uc.used_order_id, uc.expire_at, uc.created_at,
    c.name, c.type, c.amount, c.min_spend, c.discount FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
    WHERE uc.user_id = ?${input.status ? " AND uc.status = ?" : ""} ORDER BY uc.created_at DESC`, input.status ? [userId, input.status] : [userId]);
  res.json({ data: rows.map(formatCoupon) });
});
