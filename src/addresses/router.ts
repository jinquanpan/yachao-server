import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { parse, positiveId, requireUserId, routeParam } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";

const router = Router();
router.use(userAuth);
const publicAddress = (row: DbRow) => ({ ...row, id: String(row.id), user_id: undefined, is_default: Boolean(row.is_default) });
const addressFields = {
  consignee: z.string().trim().min(1).max(32), phone: z.string().regex(/^1\d{10}$/),
  province: z.string().trim().min(1).max(32), city: z.string().trim().min(1).max(32), district: z.string().trim().min(1).max(32),
  detail: z.string().trim().min(1).max(255), tag: z.string().trim().max(16).nullable().optional(), is_default: z.boolean().optional()
};

router.get("/", async (req, res) => {
  const [rows] = await db.query<DbRow[]>("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC", [requireUserId(req)]);
  res.json({ data: rows.map(publicAddress) });
});

router.post("/", async (req, res) => {
  const input = parse(z.object(addressFields), req.body);
  const userId = requireUserId(req);
  const id = await transaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [counts] = await connection.query<DbRow[]>("SELECT COUNT(*) AS total FROM addresses WHERE user_id = ?", [userId]);
    const makeDefault = Number(counts[0]?.total ?? 0) === 0 || input.is_default === true;
    if (makeDefault) await connection.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [userId]);
    const columns = ["user_id", "consignee", "phone", "province", "city", "district", "detail", "tag", "is_default"];
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO addresses (${columns.join(",")}) VALUES (?,?,?,?,?,?,?,?,?)`, [userId, input.consignee, input.phone, input.province, input.city, input.district, input.detail, input.tag ?? null, makeDefault ? 1 : 0]);
    return String(result.insertId);
  });
  const [rows] = await db.query<DbRow[]>("SELECT * FROM addresses WHERE id = ?", [id]);
  res.status(201).json({ data: publicAddress(rows[0] as DbRow) });
});

router.patch("/:id", async (req, res) => {
  const input = parse(z.object(addressFields).partial().refine((value) => Object.keys(value).length > 0), req.body);
  const id = positiveId(routeParam(req.params.id));
  const userId = requireUserId(req);
  await transaction(async (connection) => {
    const [rows] = await connection.query<DbRow[]>("SELECT * FROM addresses WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    if (!rows[0]) throw new AppError(404, "ADDRESS_NOT_FOUND", "地址不存在");
    if (input.is_default === true) await connection.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [userId]);
    const entries = Object.entries(input).map(([key, value]) => [key, key === "is_default" ? (value ? 1 : 0) : value] as const);
    await connection.execute(`UPDATE addresses SET ${entries.map(([key]) => `\`${key}\` = ?`).join(",")} WHERE id = ? AND user_id = ?`, [...entries.map(([, value]) => value), id, userId]);
  });
  const [rows] = await db.query<DbRow[]>("SELECT * FROM addresses WHERE id = ? AND user_id = ?", [id, userId]);
  res.json({ data: publicAddress(rows[0] as DbRow) });
});

router.put("/:id/default", async (req, res) => {
  const id = positiveId(routeParam(req.params.id));
  const userId = requireUserId(req);
  await transaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [rows] = await connection.query<DbRow[]>("SELECT id FROM addresses WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    if (!rows[0]) throw new AppError(404, "ADDRESS_NOT_FOUND", "地址不存在");
    await connection.execute("UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?", [id, userId]);
  });
  res.json({ data: { id, is_default: true } });
});

router.delete("/:id", async (req, res) => {
  const id = positiveId(routeParam(req.params.id));
  const userId = requireUserId(req);
  await transaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [rows] = await connection.query<DbRow[]>("SELECT is_default FROM addresses WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    if (!rows[0]) throw new AppError(404, "ADDRESS_NOT_FOUND", "地址不存在");
    await connection.execute("DELETE FROM addresses WHERE id = ? AND user_id = ?", [id, userId]);
    if (Boolean(rows[0].is_default)) {
      const [next] = await connection.query<DbRow[]>("SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [userId]);
      if (next[0]) await connection.execute("UPDATE addresses SET is_default = 1 WHERE id = ?", [next[0].id]);
    }
  });
  res.status(204).send();
});

export const addressesRouter = router;
