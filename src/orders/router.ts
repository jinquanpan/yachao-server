import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { jsonValue, money } from "../catalog/format.js";
import { db } from "../db.js";
import { ORDER_STATUSES, type DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { requestHash } from "../lib/crypto.js";
import { pagination, parse, requireUserId, routeParam } from "../lib/http.js";
import { toCents } from "../lib/money.js";
import { transaction } from "../lib/transaction.js";
import { applyStockChange, buildCheckout, calculateCoupon, checkoutSchema, orderNumber, type CheckoutLine } from "./service.js";

const checkoutRouter = Router();
const router = Router();
checkoutRouter.use(userAuth);
router.use(userAuth);

checkoutRouter.post("/preview", async (req, res) => {
  const input = parse(checkoutSchema, req.body);
  const connection = await db.getConnection();
  try {
    const checkout = await buildCheckout(connection, requireUserId(req), input, false);
    const [available] = await connection.query<DbRow[]>(`SELECT uc.id AS user_coupon_id, c.id AS coupon_id, c.name, c.type, c.amount, c.min_spend, c.discount, uc.expire_at
      FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.user_id = ? AND uc.status = 'unused' AND uc.expire_at > CURRENT_TIMESTAMP
        AND CURRENT_TIMESTAMP BETWEEN c.valid_from AND c.valid_to ORDER BY uc.expire_at`, [requireUserId(req)]);
    const subtotalCents = toCents(checkout.summary.subtotal);
    res.json({ data: { ...checkout, available_coupons: available.filter((row) => calculateCoupon(row, subtotalCents) > 0).map((row) => ({ ...row, user_coupon_id: String(row.user_coupon_id), coupon_id: String(row.coupon_id), amount: row.amount === null ? null : money(row.amount), min_spend: row.min_spend === null ? null : money(row.min_spend) })) } });
  } finally { connection.release(); }
});

const createOrderSchema = checkoutSchema.and(z.object({ address_id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String), remark: z.string().trim().max(255).optional() }));

router.post("/", async (req, res) => {
  const input = parse(createOrderSchema, req.body);
  const key = String(req.headers["idempotency-key"] ?? "").trim();
  if (!key || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "必须提供有效的 Idempotency-Key 请求头");
  const userId = requireUserId(req);
  const hash = requestHash(input);
  const result = await transaction(async (connection) => {
    const [insertKey] = await connection.execute<ResultSetHeader>(`INSERT IGNORE INTO idempotency_requests
      (user_id, scope, idempotency_key, request_hash, expire_at) VALUES (?, 'create-order', ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR))`, [userId, key, hash]);
    const [keys] = await connection.query<DbRow[]>("SELECT * FROM idempotency_requests WHERE user_id = ? AND scope = 'create-order' AND idempotency_key = ? FOR UPDATE", [userId, key]);
    const record = keys[0];
    if (!record) throw new AppError(500, "IDEMPOTENCY_FAILED", "幂等记录创建失败");
    if (record.request_hash !== hash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "同一 Idempotency-Key 不能用于不同请求");
    if (!insertKey.affectedRows) {
      if (record.resource_id) return { order_no: String(record.resource_id), repeated: true };
      throw new AppError(409, "REQUEST_IN_PROGRESS", "相同请求正在处理中，请稍后重试");
    }

    const checkout = await buildCheckout(connection, userId, input, true);
    if (!checkout.address) throw new AppError(400, "ADDRESS_REQUIRED", "请选择收货地址");
    const orderNo = orderNumber();
    const addressSnapshot = { consignee: checkout.address.consignee, phone: checkout.address.phone, province: checkout.address.province, city: checkout.address.city, district: checkout.address.district, detail: checkout.address.detail, tag: checkout.address.tag };
    const [orderInsert] = await connection.execute<ResultSetHeader>(`INSERT INTO orders
      (order_no, user_id, status, total, discount, pay_amount, address_snapshot, coupon_id, remark)
      VALUES (?, ?, 'pending-payment', ?, ?, ?, ?, ?, ?)`,
      [orderNo, userId, checkout.summary.subtotal, checkout.summary.discount, checkout.summary.pay_amount, JSON.stringify(addressSnapshot), checkout.coupon?.coupon_id ?? null, input.remark ?? null]);
    const orderId = String(orderInsert.insertId);
    for (const line of checkout.lines) {
      await connection.execute(`INSERT INTO order_items (order_id, product_id, sku_id, product_snapshot, sku_snapshot, price, qty)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [orderId, line.product_id, line.sku_id, JSON.stringify(line.product_snapshot), line.sku_snapshot ? JSON.stringify(line.sku_snapshot) : null, line.price, line.qty]);
      await applyStockChange(connection, line, "out", orderNo);
    }
    if (checkout.coupon) {
      const [couponUpdate] = await connection.execute<ResultSetHeader>("UPDATE user_coupons SET status = 'used', used_order_id = ? WHERE id = ? AND user_id = ? AND status = 'unused'", [orderNo, checkout.coupon.user_coupon_id, userId]);
      if (!couponUpdate.affectedRows) throw new AppError(409, "COUPON_UNAVAILABLE", "优惠券状态已变化");
    }
    await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, remark) VALUES (?, NULL, 'pending-payment', '创建订单')", [orderId]);
    const cartIds = checkout.lines.flatMap((line) => line.cart_item_id ? [line.cart_item_id] : []);
    if (cartIds.length) await connection.execute(`DELETE FROM cart_items WHERE user_id = ? AND id IN (${cartIds.map(() => "?").join(",")})`, [userId, ...cartIds]);
    await connection.execute("UPDATE idempotency_requests SET resource_id = ? WHERE id = ?", [orderNo, record.id]);
    return { order_no: orderNo, repeated: false };
  });
  const order = await orderDetail(userId, result.order_no);
  res.status(result.repeated ? 200 : 201).json({ data: order });
});

router.get("/counts", async (req, res) => {
  const [rows] = await db.query<DbRow[]>("SELECT status, COUNT(*) AS total FROM orders WHERE user_id = ? GROUP BY status", [requireUserId(req)]);
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[String(row.status)] = Number(row.total);
  res.json({ data: counts });
});

router.get("/", async (req, res) => {
  const query = parse(z.object({ status: z.enum([...ORDER_STATUSES, "all"]).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(100).optional() }), req.query);
  const { page, pageSize, offset } = pagination(query);
  const userId = requireUserId(req);
  const statusSql = query.status && query.status !== "all" ? " AND status = ?" : "";
  const values = query.status && query.status !== "all" ? [userId, query.status] : [userId];
  const [orders] = await db.query<DbRow[]>(`SELECT * FROM orders WHERE user_id = ?${statusSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...values, pageSize, offset]);
  const [counts] = await db.query<DbRow[]>(`SELECT COUNT(*) AS total FROM orders WHERE user_id = ?${statusSql}`, values);
  const ids = orders.map((order) => String(order.id));
  let items: DbRow[] = [];
  if (ids.length) [items] = await db.query<DbRow[]>(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids);
  const byOrder = new Map<string, DbRow[]>();
  for (const item of items) byOrder.set(String(item.order_id), [...(byOrder.get(String(item.order_id)) ?? []), item]);
  res.json({ data: orders.map((order) => formatOrder(order, byOrder.get(String(order.id)) ?? [])), meta: { page, pageSize, total: Number(counts[0]?.total ?? 0) } });
});

router.get("/:orderNo", async (req, res) => res.json({ data: await orderDetail(requireUserId(req), routeParam(req.params.orderNo)) }));

router.post("/:orderNo/cancel", async (req, res) => {
  const userId = requireUserId(req);
  const orderNo = routeParam(req.params.orderNo);
  const reason = parse(z.object({ reason: z.string().trim().max(255).optional() }), req.body).reason;
  await transaction(async (connection) => {
    const [orders] = await connection.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? AND user_id = ? FOR UPDATE", [orderNo, userId]);
    const order = orders[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (order.status !== "pending-payment") throw new AppError(409, "INVALID_ORDER_STATUS", "只有待付款订单可以取消");
    const [items] = await connection.query<DbRow[]>("SELECT * FROM order_items WHERE order_id = ? FOR UPDATE", [order.id]);
    for (const item of items) {
      const line: CheckoutLine = { cart_item_id: null, product_id: String(item.product_id), sku_id: item.sku_id === null ? null : String(item.sku_id), qty: Number(item.qty), price: String(item.price), stock: 0, product_snapshot: {}, sku_snapshot: null };
      await applyStockChange(connection, line, "in", orderNo);
    }
    await connection.execute("UPDATE user_coupons SET status = 'unused', used_order_id = NULL WHERE user_id = ? AND used_order_id = ? AND status = 'used'", [userId, orderNo]);
    await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
    await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, operator_id, remark) VALUES (?, 'pending-payment', 'cancelled', ?, ?)", [order.id, userId, reason ?? "用户取消订单"]);
  });
  res.json({ data: await orderDetail(userId, orderNo) });
});

router.post("/:orderNo/confirm-receipt", async (req, res) => {
  const userId = requireUserId(req);
  const orderNo = routeParam(req.params.orderNo);
  await transaction(async (connection) => {
    const [orders] = await connection.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? AND user_id = ? FOR UPDATE", [orderNo, userId]);
    const order = orders[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (order.status !== "pending-receipt") throw new AppError(409, "INVALID_ORDER_STATUS", "只有待收货订单可以确认收货");
    await connection.execute("UPDATE orders SET status = 'completed', received_at = CURRENT_TIMESTAMP WHERE id = ?", [order.id]);
    await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, operator_id, remark) VALUES (?, 'pending-receipt', 'completed', ?, '用户确认收货')", [order.id, userId]);
  });
  res.json({ data: await orderDetail(userId, orderNo) });
});

function formatOrder(order: DbRow, items: DbRow[]) {
  return { ...order, id: String(order.id), user_id: undefined, total: money(order.total), discount: money(order.discount), pay_amount: money(order.pay_amount), address_snapshot: jsonValue(order.address_snapshot, {}), items: items.map((item) => ({ ...item, id: String(item.id), order_id: undefined, product_id: String(item.product_id), sku_id: item.sku_id === null ? null : String(item.sku_id), price: money(item.price), product_snapshot: jsonValue(item.product_snapshot, {}), sku_snapshot: jsonValue(item.sku_snapshot, null) })) };
}

async function orderDetail(userId: string, orderNo: string) {
  const [orders] = await db.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? AND user_id = ?", [orderNo, userId]);
  const order = orders[0];
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
  const [[items], [logs], [payments], [refunds]] = await Promise.all([
    db.query<DbRow[]>("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", [order.id]),
    db.query<DbRow[]>("SELECT from_status, to_status, remark, created_at FROM order_status_log WHERE order_id = ? ORDER BY id", [order.id]),
    db.query<DbRow[]>("SELECT payment_no, channel, amount, status, trade_no, paid_at, created_at FROM payments WHERE order_id = ?", [order.id]),
    db.query<DbRow[]>("SELECT refund_no, amount, reason, status, processed_at, created_at FROM refunds WHERE order_id = ? ORDER BY id DESC", [order.id])
  ]);
  return { ...formatOrder(order, items), status_logs: logs, payments: payments.map((row) => ({ ...row, amount: money(row.amount) })), refunds: refunds.map((row) => ({ ...row, amount: money(row.amount) })) };
}

export { checkoutRouter, router as ordersRouter, orderDetail };
