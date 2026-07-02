import { Router } from "express";
import { z } from "zod";
import { optionalUserAuth } from "../auth/middleware.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { pagination, parse, positiveId, routeParam } from "../lib/http.js";
import { jsonValue, money, productSelect, productSummary } from "./format.js";

const router = Router();

async function categoryRows(): Promise<DbRow[]> {
  const [rows] = await db.query<DbRow[]>("SELECT id, `key`, label, parent_id, icon, sort FROM categories ORDER BY sort ASC, id ASC");
  return rows;
}

function categoryTree(rows: DbRow[]) {
  const nodes = new Map<string, Record<string, unknown>>();
  for (const row of rows) nodes.set(String(row.id), { ...row, id: String(row.id), parent_id: row.parent_id === null ? null : String(row.parent_id), children: [] });
  const roots: Record<string, unknown>[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parent_id as string | null;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) (parent.children as Record<string, unknown>[]).push(node);
    else roots.push(node);
  }
  return roots;
}

router.get("/categories", async (_req, res) => {
  res.json({ data: categoryTree(await categoryRows()) });
});

router.get("/products", async (req, res) => {
  const query = parse(z.object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
    category: z.string().trim().max(32).optional(),
    keyword: z.string().trim().max(64).optional(),
    tag: z.string().trim().max(32).optional(),
    sort: z.enum(["newest", "sales", "price_asc", "price_desc"]).default("newest")
  }), req.query);
  const { page, pageSize, offset } = pagination(query);
  const conditions = ["p.status = 1", "p.deleted_at IS NULL"];
  const values: Array<string | number> = [];
  if (query.category) {
    conditions.push("(c.key = ? OR CAST(c.id AS CHAR) = ?)");
    values.push(query.category, query.category);
  }
  if (query.keyword) {
    conditions.push("(p.name LIKE ? OR p.subtitle LIKE ? OR p.product_no = ?)");
    values.push(`%${query.keyword}%`, `%${query.keyword}%`, query.keyword);
  }
  if (query.tag) {
    conditions.push("EXISTS (SELECT 1 FROM product_tags fpt JOIN tags ft ON ft.id = fpt.tag_id WHERE fpt.product_id = p.id AND (ft.name = ? OR CAST(ft.id AS CHAR) = ?))");
    values.push(query.tag, query.tag);
  }
  const orderBy = { newest: "p.created_at DESC", sales: "p.sales_count DESC, p.id DESC", price_asc: "p.price ASC", price_desc: "p.price DESC" }[query.sort];
  const where = conditions.join(" AND ");
  const [rows] = await db.query<DbRow[]>(`SELECT ${productSelect} FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...values, pageSize, offset]);
  const [counts] = await db.query<DbRow[]>(`SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where}`, values);
  res.json({ data: rows.map(productSummary), meta: { page, pageSize, total: Number(counts[0]?.total ?? 0) } });
});

router.get("/products/:id", optionalUserAuth, async (req, res) => {
  const id = positiveId(routeParam(req.params.id));
  const [rows] = await db.query<DbRow[]>(`SELECT ${productSelect}, p.story, p.status FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.status = 1 AND p.deleted_at IS NULL`, [id]);
  const product = rows[0];
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "商品不存在或已下架");
  const [[skus], [specs], [favorites]] = await Promise.all([
    db.query<DbRow[]>("SELECT id, sku_code, price, stock, attributes FROM product_skus WHERE product_id = ? ORDER BY id", [id]),
    db.query<DbRow[]>("SELECT id, name, `values` FROM product_specs WHERE product_id = ? ORDER BY id", [id]),
    req.user ? db.query<DbRow[]>("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ? LIMIT 1", [req.user.id, id]) : Promise.resolve<[DbRow[], unknown]>([[], []])
  ]);
  res.json({ data: {
    ...productSummary(product),
    story: product.story,
    is_favorite: favorites.length > 0,
    skus: skus.map((row) => ({ ...row, id: String(row.id), price: money(row.price), stock: Number(row.stock), attributes: jsonValue(row.attributes, {}) })),
    specs: specs.map((row) => ({ ...row, id: String(row.id), values: jsonValue(row.values, []) }))
  } });
});

router.get("/home", async (_req, res) => {
  const nowCondition = "CURRENT_TIMESTAMP BETWEEN valid_from AND valid_to";
  const [[banners], categories, [items]] = await Promise.all([
    db.query<DbRow[]>(`SELECT id, title, image_url, link_url, position, sort FROM banners WHERE ${nowCondition} ORDER BY sort ASC, id DESC`),
    categoryRows(),
    db.query<DbRow[]>(`SELECT rp.id AS position_id, rp.code, rp.description, ri.sort AS recommend_sort, ${productSelect}
      FROM recommend_positions rp
      JOIN recommend_items ri ON ri.position_id = rp.id AND CURRENT_TIMESTAMP BETWEEN ri.valid_from AND ri.valid_to
      JOIN products p ON p.id = ri.product_id AND p.status = 1 AND p.deleted_at IS NULL
      JOIN categories c ON c.id = p.category_id
      WHERE rp.status = 1 ORDER BY rp.id, ri.sort, ri.id`)
  ]);
  const grouped = new Map<string, { id: string; code: unknown; description: unknown; products: unknown[] }>();
  for (const row of items) {
    const id = String(row.position_id);
    const group: { id: string; code: unknown; description: unknown; products: unknown[] } = grouped.get(id) ?? { id, code: row.code, description: row.description, products: [] };
    group.products.push(productSummary(row));
    grouped.set(id, group);
  }
  res.json({ data: { banners: banners.map((row) => ({ ...row, id: String(row.id) })), categories: categoryTree(categories), recommendations: [...grouped.values()] } });
});

export const catalogRouter = router;
