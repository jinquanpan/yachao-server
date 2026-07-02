import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { money } from "../catalog/format.js";
import { config } from "../config.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { requestHash, verifyHmac } from "../lib/crypto.js";
import { parse, requireUserId, routeParam } from "../lib/http.js";
import { fromCents, toCents } from "../lib/money.js";
import { transaction } from "../lib/transaction.js";

const orderPayments = Router();
const payments = Router();
const callbacks = Router();
const callbackLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
payments.use(userAuth);

const paymentNo = () => `PAY${Date.now()}${randomBytes(3).toString("hex").toUpperCase()}`;
const refundNo = () => `REF${Date.now()}${randomBytes(3).toString("hex").toUpperCase()}`;

function formatPayment(row: DbRow) { return { ...row, id: row.id === undefined ? undefined : String(row.id), order_id: undefined, amount: money(row.amount) }; }

orderPayments.post("/:orderNo/payments", userAuth, async (req, res) => {
  const input = parse(z.object({ channel: z.enum(["wechat", "alipay", "apple"]) }), req.body);
  const userId = requireUserId(req);
  const orderNo = routeParam(req.params.orderNo);
  const result = await transaction(async (connection) => {
    const [orders] = await connection.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? AND user_id = ? FOR UPDATE", [orderNo, userId]);
    const order = orders[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (order.status !== "pending-payment") throw new AppError(409, "INVALID_ORDER_STATUS", "订单当前不可支付");
    const [existing] = await connection.query<DbRow[]>("SELECT * FROM payments WHERE order_id = ? FOR UPDATE", [order.id]);
    if (existing[0]) return existing[0];
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO payments (order_id, payment_no, channel, amount, status) VALUES (?, ?, ?, ?, 'pending')", [order.id, paymentNo(), input.channel, order.pay_amount]);
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM payments WHERE id = ?", [insert.insertId]);
    await connection.execute("UPDATE orders SET payment_id = ? WHERE id = ?", [insert.insertId, order.id]);
    return rows[0] as DbRow;
  });
  res.status(201).json({ data: formatPayment(result) });
});

payments.get("/:paymentNo", async (req, res) => {
  const [rows] = await db.query<DbRow[]>(`SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.payment_no = ? AND o.user_id = ?`, [routeParam(req.params.paymentNo), requireUserId(req)]);
  if (!rows[0]) throw new AppError(404, "PAYMENT_NOT_FOUND", "支付单不存在");
  res.json({ data: formatPayment(rows[0]) });
});

function signedBody(req: Request, secret: string | undefined): Buffer {
  if (!secret) throw new AppError(503, "CALLBACK_NOT_CONFIGURED", "回调密钥尚未配置");
  const raw = req.rawBody;
  const signature = String(req.headers["x-signature"] ?? "");
  if (!raw || !signature || !verifyHmac(raw, signature, secret)) throw new AppError(401, "INVALID_SIGNATURE", "回调签名无效");
  return raw;
}

callbacks.post("/payments/callback/:channel", callbackLimit, async (req, res) => {
  signedBody(req, config.PAYMENT_CALLBACK_SECRET);
  const channel = parse(z.enum(["wechat", "alipay", "apple"]), routeParam(req.params.channel));
  const input = parse(z.object({ payment_no: z.string().max(32), trade_no: z.string().max(64), status: z.enum(["paid", "failed"]), paid_at: z.string().datetime().optional() }), req.body);
  await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT p.*, o.status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_no = ? AND p.channel = ? FOR UPDATE", [input.payment_no, channel]);
    const payment = rows[0];
    if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "支付单不存在");
    if (payment.status === "paid") {
      if (payment.trade_no !== input.trade_no) throw new AppError(409, "PAYMENT_CALLBACK_CONFLICT", "支付回调交易号冲突");
      return;
    }
    await connection.execute("UPDATE payments SET status = ?, trade_no = ?, paid_at = ? WHERE id = ?", [input.status, input.trade_no, input.status === "paid" ? new Date(input.paid_at ?? Date.now()) : null, payment.id]);
    if (input.status === "paid") {
      if (payment.order_status !== "pending-payment") throw new AppError(409, "INVALID_ORDER_STATUS", "订单状态与支付回调冲突");
      await connection.execute("UPDATE orders SET status = 'pending-shipment', paid_at = CURRENT_TIMESTAMP, payment_id = ? WHERE id = ?", [payment.id, payment.order_id]);
      await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, remark) VALUES (?, 'pending-payment', 'pending-shipment', '支付成功')", [payment.order_id]);
    }
  });
  res.json({ data: { received: true } });
});

orderPayments.post("/:orderNo/refunds", userAuth, async (req, res) => {
  const input = parse(z.object({ amount: z.union([z.string(), z.number()]).transform(String).refine((value) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0, "退款金额格式错误"), reason: z.string().trim().max(255).optional() }), req.body);
  const key = String(req.headers["idempotency-key"] ?? "").trim();
  if (!key || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "必须提供有效的 Idempotency-Key 请求头");
  const userId = requireUserId(req);
  const orderNo = routeParam(req.params.orderNo);
  const hash = requestHash(input);
  const result = await transaction(async (connection) => {
    const [idempotency] = await connection.execute<ResultSetHeader>(`INSERT IGNORE INTO idempotency_requests
      (user_id, scope, idempotency_key, request_hash, expire_at) VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR))`, [userId, `refund:${orderNo}`, key, hash]);
    const [keys] = await connection.query<DbRow[]>("SELECT * FROM idempotency_requests WHERE user_id = ? AND scope = ? AND idempotency_key = ? FOR UPDATE", [userId, `refund:${orderNo}`, key]);
    const record = keys[0] as DbRow;
    if (record.request_hash !== hash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于不同请求");
    if (!idempotency.affectedRows && record.resource_id) {
      const [existing] = await connection.query<DbRow[]>("SELECT * FROM refunds WHERE refund_no = ?", [record.resource_id]);
      return existing[0] as DbRow;
    }
    const [orders] = await connection.query<DbRow[]>("SELECT * FROM orders WHERE order_no = ? AND user_id = ? FOR UPDATE", [orderNo, userId]);
    const order = orders[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (!["pending-shipment", "pending-receipt", "completed", "after-sale"].includes(String(order.status))) throw new AppError(409, "INVALID_ORDER_STATUS", "订单当前不可申请退款");
    const [pays] = await connection.query<DbRow[]>("SELECT * FROM payments WHERE order_id = ? AND status = 'paid' FOR UPDATE", [order.id]);
    const payment = pays[0];
    if (!payment) throw new AppError(409, "PAYMENT_NOT_PAID", "订单没有成功支付记录");
    const [totals] = await connection.query<DbRow[]>("SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE order_id = ? AND status IN ('pending','processed')", [order.id]);
    const requestedCents = toCents(input.amount);
    const remainingCents = toCents(String(payment.amount)) - toCents(String(totals[0]?.total ?? "0"));
    if (requestedCents > remainingCents) throw new AppError(409, "INVALID_REFUND_AMOUNT", "退款金额超过可退金额", { remaining: fromCents(remainingCents) });
    const no = refundNo();
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO refunds (payment_id, order_id, refund_no, amount, reason, status) VALUES (?, ?, ?, ?, ?, 'pending')", [payment.id, order.id, no, fromCents(requestedCents), input.reason ?? null]);
    if (order.status !== "after-sale") {
      await connection.execute("UPDATE orders SET status = 'after-sale' WHERE id = ?", [order.id]);
      await connection.execute("INSERT INTO order_status_log (order_id, from_status, to_status, operator_id, remark) VALUES (?, ?, 'after-sale', ?, '发起退款')", [order.id, order.status, userId]);
    }
    await connection.execute("UPDATE idempotency_requests SET resource_id = ? WHERE id = ?", [no, record.id]);
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM refunds WHERE id = ?", [insert.insertId]);
    return rows[0] as DbRow;
  });
  res.status(201).json({ data: { ...result, id: String(result.id), amount: money(result.amount), order_id: undefined, payment_id: undefined } });
});

orderPayments.get("/:orderNo/refunds", userAuth, async (req, res) => {
  const [rows] = await db.query<DbRow[]>(`SELECT r.* FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = ? AND o.user_id = ? ORDER BY r.id DESC`, [routeParam(req.params.orderNo), requireUserId(req)]);
  res.json({ data: rows.map((row) => ({ ...row, id: String(row.id), amount: money(row.amount), order_id: undefined, payment_id: undefined })) });
});

callbacks.post("/refunds/callback/:channel", callbackLimit, async (req, res) => {
  signedBody(req, config.REFUND_CALLBACK_SECRET);
  parse(z.enum(["wechat", "alipay", "apple"]), routeParam(req.params.channel));
  const input = parse(z.object({ refund_no: z.string().max(32), status: z.enum(["processed", "failed"]), processed_at: z.string().datetime().optional() }), req.body);
  await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM refunds WHERE refund_no = ? FOR UPDATE", [input.refund_no]);
    const refund = rows[0];
    if (!refund) throw new AppError(404, "REFUND_NOT_FOUND", "退款单不存在");
    if (["processed", "failed"].includes(String(refund.status))) {
      if (refund.status !== input.status) throw new AppError(409, "REFUND_CALLBACK_CONFLICT", "退款回调状态冲突");
      return;
    }
    await connection.execute("UPDATE refunds SET status = ?, processed_at = ? WHERE id = ?", [input.status, input.status === "processed" ? new Date(input.processed_at ?? Date.now()) : null, refund.id]);
  });
  res.json({ data: { received: true } });
});

export { orderPayments, payments, callbacks as paymentCallbacks };
