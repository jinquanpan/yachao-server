import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { money } from "../catalog/format.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { fromCents, toCents } from "../lib/money.js";
import { parse, positiveId, requireUserId, routeParam } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";

const router = Router();
router.use(userAuth);
const idValue = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String);

function cartItem(row: DbRow) {
  const hasSku = row.sku_id !== null;
  const valid = Number(row.product_status) === 1 && row.deleted_at === null && (!hasSku || row.sku_code !== null);
  const unitPrice = money(hasSku ? row.sku_price : row.product_price);
  const stock = Number(hasSku ? row.sku_stock : row.product_stock);
  const qty = Number(row.qty);
  return {
    id: String(row.id), product_id: String(row.product_id), sku_id: row.sku_id === null ? null : String(row.sku_id),
    qty, selected: Boolean(row.selected), valid, invalid_reason: valid ? null : "商品或 SKU 已失效",
    stock, unit_price: unitPrice, line_total: fromCents(toCents(unitPrice) * qty),
    product: { name: row.name, subtitle: row.subtitle, cover_image: row.cover_image, spec: row.spec },
    sku: hasSku ? { sku_code: row.sku_code, attributes: row.attributes } : null
  };
}

const cartSelect = `SELECT ci.*, p.name, p.subtitle, p.cover_image, p.spec, p.price AS product_price,
  p.stock AS product_stock, p.status AS product_status, p.deleted_at,
  s.sku_code, s.price AS sku_price, s.stock AS sku_stock, s.attributes
  FROM cart_items ci JOIN products p ON p.id = ci.product_id
  LEFT JOIN product_skus s ON s.id = ci.sku_id`;

router.get("/", async (req, res) => {
  const [rows] = await db.query<DbRow[]>(`${cartSelect} WHERE ci.user_id = ? ORDER BY ci.created_at DESC`, [requireUserId(req)]);
  const items = rows.map(cartItem);
  const selected = items.filter((item) => item.selected && item.valid);
  res.json({ data: { items, summary: { selected_count: selected.reduce((sum, item) => sum + item.qty, 0), total: fromCents(selected.reduce((sum, item) => sum + toCents(item.line_total), 0)) } } });
});

router.post("/items", async (req, res) => {
  const input = parse(z.object({ product_id: idValue, sku_id: idValue.nullable().optional(), qty: z.coerce.number().int().min(1).max(999) }), req.body);
  const userId = requireUserId(req);
  const id = await transaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [products] = await connection.query<DbRow[]>("SELECT id, stock, status, deleted_at FROM products WHERE id = ? FOR UPDATE", [input.product_id]);
    const product = products[0];
    if (!product || Number(product.status) !== 1 || product.deleted_at !== null) throw new AppError(409, "PRODUCT_UNAVAILABLE", "商品不存在或已下架");
    let stock = Number(product.stock);
    if (input.sku_id) {
      const [skus] = await connection.query<DbRow[]>("SELECT id, stock FROM product_skus WHERE id = ? AND product_id = ? FOR UPDATE", [input.sku_id, input.product_id]);
      if (!skus[0]) throw new AppError(409, "SKU_UNAVAILABLE", "SKU 不存在");
      stock = Number(skus[0].stock);
    }
    const [existing] = await connection.query<DbRow[]>("SELECT id, qty FROM cart_items WHERE user_id = ? AND product_id = ? AND sku_id <=> ? FOR UPDATE", [userId, input.product_id, input.sku_id ?? null]);
    const nextQty = Number(existing[0]?.qty ?? 0) + input.qty;
    if (nextQty > stock) throw new AppError(409, "INSUFFICIENT_STOCK", "库存不足", { stock });
    if (existing[0]) {
      await connection.execute("UPDATE cart_items SET qty = ?, selected = 1 WHERE id = ?", [nextQty, existing[0].id]);
      return String(existing[0].id);
    }
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO cart_items (user_id, product_id, sku_id, qty, selected) VALUES (?, ?, ?, ?, 1)", [userId, input.product_id, input.sku_id ?? null, input.qty]);
    return String(insert.insertId);
  });
  const [rows] = await db.query<DbRow[]>(`${cartSelect} WHERE ci.id = ? AND ci.user_id = ?`, [id, userId]);
  res.status(201).json({ data: cartItem(rows[0] as DbRow) });
});

router.patch("/items/:id", async (req, res) => {
  const itemId = positiveId(routeParam(req.params.id));
  const input = parse(z.object({ qty: z.coerce.number().int().min(1).max(999).optional(), selected: z.boolean().optional() }).refine((value) => value.qty !== undefined || value.selected !== undefined), req.body);
  const userId = requireUserId(req);
  await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>(`${cartSelect} WHERE ci.id = ? AND ci.user_id = ? FOR UPDATE`, [itemId, userId]);
    const row = rows[0];
    if (!row) throw new AppError(404, "CART_ITEM_NOT_FOUND", "购物车条目不存在");
    if (input.qty !== undefined) {
      const item = cartItem(row);
      if (!item.valid) throw new AppError(409, "PRODUCT_UNAVAILABLE", "商品已失效");
      if (input.qty > item.stock) throw new AppError(409, "INSUFFICIENT_STOCK", "库存不足", { stock: item.stock });
    }
    const updates: string[] = [];
    const values: Array<number> = [];
    if (input.qty !== undefined) { updates.push("qty = ?"); values.push(input.qty); }
    if (input.selected !== undefined) { updates.push("selected = ?"); values.push(input.selected ? 1 : 0); }
    await connection.execute(`UPDATE cart_items SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`, [...values, itemId, userId]);
  });
  const [rows] = await db.query<DbRow[]>(`${cartSelect} WHERE ci.id = ? AND ci.user_id = ?`, [itemId, userId]);
  res.json({ data: cartItem(rows[0] as DbRow) });
});

router.delete("/items/:id", async (req, res) => {
  const [result] = await db.execute<ResultSetHeader>("DELETE FROM cart_items WHERE id = ? AND user_id = ?", [positiveId(routeParam(req.params.id)), requireUserId(req)]);
  if (!result.affectedRows) throw new AppError(404, "CART_ITEM_NOT_FOUND", "购物车条目不存在");
  res.status(204).send();
});

router.patch("/selection", async (req, res) => {
  const input = parse(z.object({ selected: z.boolean(), item_ids: z.array(idValue).min(1).max(100).optional() }), req.body);
  const userId = requireUserId(req);
  if (input.item_ids) {
    const placeholders = input.item_ids.map(() => "?").join(",");
    await db.execute(`UPDATE cart_items SET selected = ? WHERE user_id = ? AND id IN (${placeholders})`, [input.selected ? 1 : 0, userId, ...input.item_ids]);
  } else await db.execute("UPDATE cart_items SET selected = ? WHERE user_id = ?", [input.selected ? 1 : 0, userId]);
  res.json({ data: { selected: input.selected, item_ids: input.item_ids ?? null } });
});

router.delete("/items", async (req, res) => {
  const selectedOnly = String(req.query.selected ?? "false") === "true";
  await db.execute(`DELETE FROM cart_items WHERE user_id = ?${selectedOnly ? " AND selected = 1" : ""}`, [requireUserId(req)]);
  res.status(204).send();
});

export const cartRouter = router;
