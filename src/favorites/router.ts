import { Router } from "express";
import { userAuth } from "../auth/middleware.js";
import { productSelect, productSummary } from "../catalog/format.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { pagination, positiveId, requireUserId, routeParam } from "../lib/http.js";

const router = Router();
router.use(userAuth);

router.get("/", async (req, res) => {
  const { page, pageSize, offset } = pagination(req.query);
  const userId = requireUserId(req);
  const [rows] = await db.query<DbRow[]>(`SELECT ${productSelect}, f.created_at AS favorite_at
    FROM favorites f JOIN products p ON p.id = f.product_id JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = ? AND p.status = 1 AND p.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT ? OFFSET ?`, [userId, pageSize, offset]);
  const [counts] = await db.query<DbRow[]>("SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?", [userId]);
  res.json({ data: rows.map((row) => ({ ...productSummary(row), favorite_at: row.favorite_at })), meta: { page, pageSize, total: Number(counts[0]?.total ?? 0) } });
});

router.put("/:productId", async (req, res) => {
  const productId = positiveId(routeParam(req.params.productId), "productId");
  const [products] = await db.query<DbRow[]>("SELECT id FROM products WHERE id = ? AND status = 1 AND deleted_at IS NULL", [productId]);
  if (!products[0]) throw new AppError(404, "PRODUCT_NOT_FOUND", "商品不存在或已下架");
  await db.execute("INSERT IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)", [requireUserId(req), productId]);
  res.json({ data: { product_id: productId, is_favorite: true } });
});

router.delete("/:productId", async (req, res) => {
  const productId = positiveId(routeParam(req.params.productId), "productId");
  await db.execute("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", [requireUserId(req), productId]);
  res.json({ data: { product_id: productId, is_favorite: false } });
});

export const favoritesRouter = router;
