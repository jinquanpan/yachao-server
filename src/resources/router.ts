import { Router, type Request } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../db.js";
import { AppError } from "../errors.js";
import { getResource, resources, type ResourceDefinition } from "./definitions.js";
import { validatePayload } from "./validation.js";

const router = Router();
const quote = (identifier: string): string => `\`${identifier}\``;

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function resolveResource(req: Request): ResourceDefinition {
  const definition = getResource(routeParam(req.params.resource));
  if (!definition) throw new AppError(404, "RESOURCE_NOT_FOUND", "资源不存在");
  return definition;
}

function primaryKeyValues(definition: ResourceDefinition, rawId: string): string[] {
  const values = rawId.split(",").map(decodeURIComponent);
  if (values.length !== definition.primaryKey.length || values.some((value) => !/^\d+$/.test(value))) {
    const example = definition.primaryKey.length > 1 ? "1,2" : "1";
    throw new AppError(400, "INVALID_ID", `资源 ID 格式错误，例如: ${example}`);
  }
  return values;
}

function primaryWhere(definition: ResourceDefinition): string {
  return definition.primaryKey.map((field) => `${quote(field)} = ?`).join(" AND ");
}

async function findOne(definition: ResourceDefinition, values: string[]): Promise<RowDataPacket> {
  const softDelete = definition.softDelete ? " AND `deleted_at` IS NULL" : "";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM ${quote(definition.table)} WHERE ${primaryWhere(definition)}${softDelete} LIMIT 1`,
    values
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "记录不存在");
  return row;
}

router.get("/", (_req, res) => {
  res.json({ data: Object.keys(resources) });
});

router.get("/:resource", async (req, res) => {
  const definition = resolveResource(req);
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
  const sort = String(req.query.sort ?? definition.primaryKey[0]);
  if (!definition.columns[sort]) throw new AppError(400, "INVALID_SORT", `不支持排序字段: ${sort}`);
  const order = String(req.query.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const reserved = new Set(["page", "pageSize", "sort", "order"]);
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (definition.softDelete) conditions.push("`deleted_at` IS NULL");
  for (const [field, value] of Object.entries(req.query)) {
    if (reserved.has(field)) continue;
    if (!definition.columns[field]) throw new AppError(400, "INVALID_FILTER", `不支持筛选字段: ${field}`);
    if (typeof value !== "string") throw new AppError(400, "INVALID_FILTER", `筛选字段格式错误: ${field}`);
    conditions.push(`${quote(field)} = ?`);
    values.push(value);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM ${quote(definition.table)}${where} ORDER BY ${quote(sort)} ${order} LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );
  const [counts] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${quote(definition.table)}${where}`,
    values
  );

  res.json({ data: rows, meta: { page, pageSize, total: Number(counts[0]?.total ?? 0) } });
});

router.get("/:resource/:id", async (req, res) => {
  const definition = resolveResource(req);
  const row = await findOne(definition, primaryKeyValues(definition, routeParam(req.params.id)));
  res.json({ data: row });
});

router.post("/:resource", async (req, res) => {
  const definition = resolveResource(req);
  const data = validatePayload(definition, req.body, "create");
  const columns = Object.keys(data);
  const placeholders = columns.map(() => "?").join(", ");
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO ${quote(definition.table)} (${columns.map(quote).join(", ")}) VALUES (${placeholders})`,
    Object.values(data)
  );
  const keyValues = definition.primaryKey.map((field) => {
    if (field === "id") return String(result.insertId);
    return String(data[field]);
  });
  const row = await findOne(definition, keyValues);
  res.status(201).json({ data: row });
});

router.patch("/:resource/:id", async (req, res) => {
  const definition = resolveResource(req);
  const keyValues = primaryKeyValues(definition, routeParam(req.params.id));
  await findOne(definition, keyValues);
  const data = validatePayload(definition, req.body, "update");
  const actionOnlyFields: Record<string, string[]> = {
    products: ["stock", "sales_count"], product_skus: ["stock"], orders: ["status", "total", "discount", "pay_amount", "payment_id"],
    payments: ["status", "trade_no", "paid_at"], refunds: ["status", "processed_at"], scan_products: ["status", "reviewed_by"],
    coupons: ["issued"], user_coupons: ["status", "used_order_id"]
  };
  const blocked = Object.keys(data).filter((field) => actionOnlyFields[definition.table]?.includes(field));
  if (blocked.length) throw new AppError(400, "ACTION_REQUIRED", `字段必须通过专用事务接口修改: ${blocked.join(", ")}`);
  const columns = Object.keys(data);
  await db.execute<ResultSetHeader>(
    `UPDATE ${quote(definition.table)} SET ${columns.map((field) => `${quote(field)} = ?`).join(", ")} WHERE ${primaryWhere(definition)}`,
    [...Object.values(data), ...keyValues]
  );
  res.json({ data: await findOne(definition, keyValues) });
});

router.delete("/:resource/:id", async (req, res) => {
  const definition = resolveResource(req);
  const keyValues = primaryKeyValues(definition, routeParam(req.params.id));
  await findOne(definition, keyValues);
  if (definition.softDelete) {
    await db.execute(`UPDATE ${quote(definition.table)} SET \`deleted_at\` = CURRENT_TIMESTAMP WHERE ${primaryWhere(definition)}`, keyValues);
  } else {
    await db.execute(`DELETE FROM ${quote(definition.table)} WHERE ${primaryWhere(definition)}`, keyValues);
  }
  res.status(204).send();
});

export const resourceRouter = router;
