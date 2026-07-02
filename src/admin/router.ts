import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { authenticate } from "../middleware.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { parse, positiveId, routeParam } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";

const router = Router();
router.use(authenticate);
const idValue = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String);

router.post("/products/:id/stock-adjustments", async (req, res) => {
  const productId = positiveId(routeParam(req.params.id));
  const input = parse(z.object({ change_qty: z.coerce.number().int().refine((value) => value !== 0), sku_id: idValue.optional(), reason: z.string().trim().min(1).max(64), biz_id: z.string().trim().max(64).optional(), operator_id: idValue.optional() }), req.body);
  const result = await transaction(async (connection) => {
    const table = input.sku_id ? "product_skus" : "products";
    const id = input.sku_id ?? productId;
    const [rows] = await connection.query<DbRow[]>(`SELECT id, stock${input.sku_id ? ", product_id" : ""} FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row || (input.sku_id && String(row.product_id) !== productId)) throw new AppError(404, "STOCK_TARGET_NOT_FOUND", "商品或 SKU 不存在");
    const balance = Number(row.stock) + input.change_qty;
    if (balance < 0) throw new AppError(409, "INSUFFICIENT_STOCK", "库存不能小于零", { stock: Number(row.stock) });
    await connection.execute(`UPDATE ${table} SET stock = ? WHERE id = ?`, [balance, id]);
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO stock_records (product_id, change_type, change_qty, balance, biz_type, biz_id, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [productId, input.change_qty > 0 ? "in" : "out", Math.abs(input.change_qty), balance, input.reason, input.biz_id ?? null, input.operator_id ?? null]);
    return { id: String(insert.insertId), product_id: productId, sku_id: input.sku_id ?? null, change_qty: input.change_qty, balance };
  });
  res.status(201).json({ data: result });
});

router.post("/orders/:orderNo/ship", async (req, res) => {
  const input = parse(z.object({ carrier: z.string().trim().min(1).max(32), tracking_no: z.string().trim().min(1).max(64), operator_id: idValue.optional() }), req.body);
  const orderNo = routeParam(req.params.orderNo);
  await transaction(async (connection) => {
    const [orders] = await connection.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? FOR UPDATE", [orderNo]);
    const order = orders[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (order.status !== "pending-shipment") throw new AppError(409, "INVALID_ORDER_STATUS", "只有待发货订单可以发货");
    await connection.execute("UPDATE orders SET status = 'pending-receipt', carrier = ?, tracking_no = ?, shipped_at = CURRENT_TIMESTAMP WHERE id = ?", [input.carrier, input.tracking_no, order.id]);
    await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, operator_id, remark) VALUES (?, 'pending-shipment', 'pending-receipt', ?, '订单发货')", [order.id, input.operator_id ?? null]);
  });
  res.json({ data: { order_no: orderNo, status: "pending-receipt", carrier: input.carrier, tracking_no: input.tracking_no } });
});

router.post("/scan-products/:id/approve", async (req, res) => {
  const id = positiveId(routeParam(req.params.id));
  const input = parse(z.object({ stock: z.coerce.number().int().min(0).default(0), reviewer_id: idValue.optional() }), req.body);
  const result = await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM scan_products WHERE id = ? FOR UPDATE", [id]);
    const scan = rows[0];
    if (!scan) throw new AppError(404, "SCAN_PRODUCT_NOT_FOUND", "扫码商品不存在");
    if (scan.status === "approved") {
      const [products] = await connection.query<DbRow[]>("SELECT id FROM products WHERE product_no = ?", [scan.barcode]);
      return { scan_id: id, product_id: products[0] ? String(products[0].id) : null, repeated: true };
    }
    if (scan.status !== "pending") throw new AppError(409, "INVALID_REVIEW_STATUS", "该记录不可审核通过");
    if (scan.category_id === null) throw new AppError(409, "CATEGORY_REQUIRED", "审核通过前必须设置分类");
    const [existing] = await connection.query<DbRow[]>("SELECT id FROM products WHERE product_no = ? FOR UPDATE", [scan.barcode]);
    if (existing[0]) {
      await connection.execute("UPDATE scan_products SET status = 'approved', reviewed_by = ? WHERE id = ?", [input.reviewer_id ?? null, id]);
      return { scan_id: id, product_id: String(existing[0].id), repeated: true };
    }
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO products (product_no, name, price, category_id, stock, sales_count, status, cover_image) VALUES (?, ?, ?, ?, ?, 0, 1, ?)", [scan.barcode, scan.name, scan.price, scan.category_id, input.stock, scan.cover_image]);
    await connection.execute("UPDATE scan_products SET status = 'approved', reviewed_by = ? WHERE id = ?", [input.reviewer_id ?? null, id]);
    return { scan_id: id, product_id: String(insert.insertId), repeated: false };
  });
  res.json({ data: result });
});

router.post("/scan-products/:id/reject", async (req, res) => {
  const id = positiveId(routeParam(req.params.id));
  const input = parse(z.object({ reason: z.string().trim().min(1).max(128), reviewer_id: idValue.optional() }), req.body);
  await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM scan_products WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) throw new AppError(404, "SCAN_PRODUCT_NOT_FOUND", "扫码商品不存在");
    if (rows[0].status !== "pending") throw new AppError(409, "INVALID_REVIEW_STATUS", "该记录不可拒绝");
    await connection.execute("UPDATE scan_products SET status = 'rejected', reviewed_by = ? WHERE id = ?", [input.reviewer_id ?? null, id]);
    await connection.execute("INSERT INTO operation_logs (user_id, action, target) VALUES (?, 'scan-product.reject', ?)", [input.reviewer_id ?? null, `scan_products:${id}`]);
  });
  res.json({ data: { id, status: "rejected" } });
});

export const adminRouter = router;
