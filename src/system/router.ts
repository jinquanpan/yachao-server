import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { parse } from "../lib/http.js";
import { transaction } from "../lib/transaction.js";

const router = Router();
const versionPublishSchema = z.object({
  platform: z.enum(["android", "ios", "pc"]),
  version: z.string().trim().min(1).max(16),
  download_url: z.string().url().max(255),
  force_update: z.boolean().optional().default(false),
  release_notes: z.string().max(10_000).nullable().optional()
});

router.get("/versions/latest", async (req, res) => {
  const { platform } = parse(z.object({ platform: z.enum(["android", "ios", "pc"]) }), req.query);
  const [rows] = await db.query<DbRow[]>("SELECT id, platform, version, force_update, download_url, release_notes, created_at FROM app_versions WHERE platform = ? ORDER BY created_at DESC, id DESC LIMIT 1", [platform]);
  if (!rows[0]) throw new AppError(404, "VERSION_NOT_FOUND", "暂无该平台版本信息");
  res.json({ data: { ...rows[0], id: String(rows[0].id), force_update: Boolean(rows[0].force_update) } });
});

router.post("/versions/publish", async (req, res) => {
  const input = parse(versionPublishSchema, req.body);
  const version = await transaction(async (connection) => {
    await connection.execute("DELETE FROM app_versions WHERE platform = ?", [input.platform]);
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO app_versions (platform, version, force_update, download_url, release_notes) VALUES (?, ?, ?, ?, ?)",
      [input.platform, input.version, input.force_update ? 1 : 0, input.download_url, input.release_notes ?? null]
    );
    const [rows] = await connection.query<DbRow[]>("SELECT id, platform, version, force_update, download_url, release_notes, created_at FROM app_versions WHERE id = ?", [result.insertId]);
    const row = rows[0];
    if (!row) throw new AppError(500, "VERSION_PUBLISH_FAILED", "版本发布失败");
    return { ...row, id: String(row.id), force_update: Boolean(row.force_update) };
  });
  res.status(201).json({ data: version });
});

export const appRouter = router;
