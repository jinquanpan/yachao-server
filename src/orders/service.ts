import { randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { fromCents, toCents } from "../lib/money.js";

export const idValue = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String);
const directItem = z.object({ product_id: idValue, sku_id: idValue.nullable().optional(), qty: z.coerce.number().int().min(1).max(999) });
export const checkoutSchema = z.object({
  cart_item_ids: z.array(idValue).min(1).max(100).optional(),
  item: directItem.optional(),
  address_id: idValue.optional(),
  user_coupon_id: idValue.optional()
}).refine((value) => Boolean(value.cart_item_ids) !== Boolean(value.item), { message: "cart_item_ids 和 item 必须且只能提供一个" });

export interface CheckoutLine {
  cart_item_id: string | null;
  product_id: string;
  sku_id: string | null;
  qty: number;
  price: string;
  stock: number;
  product_snapshot: Record<string, unknown>;
  sku_snapshot: Record<string, unknown> | null;
}

interface CouponResult { user_coupon_id: string; coupon_id: string; name: unknown; type: string; discount: string; }

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function calculateCoupon(row: DbRow, subtotalCents: number): number {
  const minSpend = row.min_spend === null ? 0 : toCents(String(row.min_spend));
  if (subtotalCents < minSpend) return 0;
  if (row.type === "fullcut") return Math.min(subtotalCents, row.amount === null ? 0 : toCents(String(row.amount)));
  if (row.type === "discount") {
    const ratePercent = row.discount === null ? 0 : toCents(String(row.discount));
    if (ratePercent <= 0 || ratePercent > 100) return 0;
    return subtotalCents - Math.floor(subtotalCents * ratePercent / 100);
  }
  return 0;
}

async function loadCoupon(connection: PoolConnection, userId: string, userCouponId: string, subtotalCents: number, lock: boolean): Promise<CouponResult> {
  const [rows] = await connection.query<DbRow[]>(`SELECT uc.id AS user_coupon_id, uc.status AS user_coupon_status, uc.expire_at,
    c.id AS coupon_id, c.name, c.type, c.amount, c.min_spend, c.discount, c.valid_from, c.valid_to
    FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
    WHERE uc.id = ? AND uc.user_id = ?${lock ? " FOR UPDATE" : ""}`, [userCouponId, userId]);
  const row = rows[0];
  const now = Date.now();
  if (!row) throw new AppError(404, "COUPON_NOT_FOUND", "优惠券不存在");
  if (row.user_coupon_status !== "unused") throw new AppError(409, "COUPON_UNAVAILABLE", "优惠券已使用或已过期");
  if (asDate(row.expire_at).getTime() <= now || asDate(row.valid_from).getTime() > now || asDate(row.valid_to).getTime() <= now) throw new AppError(409, "COUPON_EXPIRED", "优惠券不在有效期");
  const discountCents = calculateCoupon(row, subtotalCents);
  if (discountCents <= 0) throw new AppError(409, "COUPON_NOT_APPLICABLE", "未达到优惠券使用条件");
  return { user_coupon_id: String(row.user_coupon_id), coupon_id: String(row.coupon_id), name: row.name, type: String(row.type), discount: fromCents(discountCents) };
}

export async function buildCheckout(connection: PoolConnection, userId: string, input: z.infer<typeof checkoutSchema>, lock: boolean) {
  let source: Array<{ cart_item_id: string | null; product_id: string; sku_id: string | null; qty: number }>;
  if (input.cart_item_ids) {
    const ids = [...new Set(input.cart_item_ids)];
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await connection.query<DbRow[]>(`SELECT id, product_id, sku_id, qty FROM cart_items WHERE user_id = ? AND id IN (${placeholders})${lock ? " FOR UPDATE" : ""}`, [userId, ...ids]);
    if (rows.length !== ids.length) throw new AppError(404, "CART_ITEM_NOT_FOUND", "部分购物车条目不存在或不属于当前用户");
    source = rows.map((row) => ({ cart_item_id: String(row.id), product_id: String(row.product_id), sku_id: row.sku_id === null ? null : String(row.sku_id), qty: Number(row.qty) }));
  } else {
    const item = input.item as z.infer<typeof directItem>;
    source = [{ cart_item_id: null, product_id: item.product_id, sku_id: item.sku_id ?? null, qty: item.qty }];
  }

  const lines: CheckoutLine[] = [];
  for (const sourceItem of source) {
    const [rows] = await connection.query<DbRow[]>(`SELECT p.id, p.product_no, p.name, p.subtitle, p.price AS product_price, p.cover_image, p.spec,
      p.stock AS product_stock, p.status, p.deleted_at, s.id AS sku_id, s.sku_code, s.price AS sku_price, s.stock AS sku_stock, s.attributes
      FROM products p LEFT JOIN product_skus s ON s.id = ? AND s.product_id = p.id WHERE p.id = ?${lock ? " FOR UPDATE" : ""}`,
      [sourceItem.sku_id, sourceItem.product_id]);
    const row = rows[0];
    if (!row || Number(row.status) !== 1 || row.deleted_at !== null) throw new AppError(409, "PRODUCT_UNAVAILABLE", "商品不存在或已下架", { product_id: sourceItem.product_id });
    if (sourceItem.sku_id && row.sku_id === null) throw new AppError(409, "SKU_UNAVAILABLE", "SKU 不存在", { sku_id: sourceItem.sku_id });
    const stock = Number(sourceItem.sku_id ? row.sku_stock : row.product_stock);
    if (sourceItem.qty > stock) throw new AppError(409, "INSUFFICIENT_STOCK", "库存不足", { product_id: sourceItem.product_id, sku_id: sourceItem.sku_id, stock });
    const price = fromCents(toCents(String(sourceItem.sku_id ? row.sku_price : row.product_price)));
    lines.push({
      ...sourceItem, price, stock,
      product_snapshot: { id: String(row.id), product_no: row.product_no, name: row.name, subtitle: row.subtitle, cover_image: row.cover_image, spec: row.spec },
      sku_snapshot: sourceItem.sku_id ? { id: String(row.sku_id), sku_code: row.sku_code, attributes: row.attributes } : null
    });
  }
  const subtotalCents = lines.reduce((sum, line) => sum + toCents(line.price) * line.qty, 0);
  let address: DbRow | null = null;
  if (input.address_id) {
    const [rows] = await connection.query<DbRow[]>(`SELECT * FROM addresses WHERE id = ? AND user_id = ?${lock ? " FOR UPDATE" : ""}`, [input.address_id, userId]);
    address = rows[0] ?? null;
    if (!address) throw new AppError(404, "ADDRESS_NOT_FOUND", "收货地址不存在");
  }
  const coupon = input.user_coupon_id ? await loadCoupon(connection, userId, input.user_coupon_id, subtotalCents, lock) : null;
  const discountCents = coupon ? toCents(coupon.discount) : 0;
  return { lines, address, coupon, summary: { subtotal: fromCents(subtotalCents), shipping_fee: "0.00", discount: fromCents(discountCents), pay_amount: fromCents(subtotalCents - discountCents) } };
}

export function orderNumber(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  return `SH${timestamp}${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function applyStockChange(connection: PoolConnection, line: CheckoutLine, direction: "out" | "in", orderNo: string, operatorId: string | null = null): Promise<void> {
  const delta = direction === "out" ? -line.qty : line.qty;
  const table = line.sku_id ? "product_skus" : "products";
  const id = line.sku_id ?? line.product_id;
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE ${table} SET stock = stock + ? WHERE id = ?${direction === "out" ? " AND stock >= ?" : ""}`,
    direction === "out" ? [delta, id, line.qty] : [delta, id]
  );
  if (!result.affectedRows) throw new AppError(409, "INSUFFICIENT_STOCK", "库存不足", { product_id: line.product_id, sku_id: line.sku_id });
  const [balances] = await connection.query<DbRow[]>(`SELECT stock FROM ${table} WHERE id = ?`, [id]);
  await connection.execute(
    "INSERT INTO stock_records (product_id, change_type, change_qty, balance, biz_type, biz_id, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [line.product_id, direction, line.qty, Number(balances[0]?.stock), line.sku_id ? "order_sku" : "order_product", orderNo, operatorId]
  );
}
