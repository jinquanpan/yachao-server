import { fromCents, toCents } from "../lib/money.js";
import type { DbRow } from "../domain/types.js";

export function money(value: unknown): string {
  return fromCents(toCents(String(value ?? "0")));
}

export function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export function productSummary(row: DbRow) {
  return {
    id: String(row.id),
    product_no: row.product_no,
    name: row.name,
    subtitle: row.subtitle,
    price: money(row.price),
    cover_image: row.cover_image,
    spec: row.spec,
    stock: Number(row.stock),
    sales_count: Number(row.sales_count),
    category: row.category_id ? { id: String(row.category_id), key: row.category_key, label: row.category_label } : null,
    tags: jsonValue(row.tags, [])
  };
}

export const productSelect = `
  p.id, p.product_no, p.name, p.subtitle, p.price, p.cover_image, p.spec, p.stock, p.sales_count,
  c.id AS category_id, c.key AS category_key, c.label AS category_label,
  (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.id, 'name', t.name, 'color', t.color))
     FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id) AS tags`;
