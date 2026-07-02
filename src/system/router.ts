import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { parse } from "../lib/http.js";

const router = Router();
router.get("/versions/latest", async (req, res) => {
  const { platform } = parse(z.object({ platform: z.enum(["android", "ios", "pc"]) }), req.query);
  const [rows] = await db.query<DbRow[]>("SELECT id, platform, version, force_update, download_url, release_notes, created_at FROM app_versions WHERE platform = ? ORDER BY created_at DESC, id DESC LIMIT 1", [platform]);
  if (!rows[0]) throw new AppError(404, "VERSION_NOT_FOUND", "暂无该平台版本信息");
  res.json({ data: { ...rows[0], id: String(rows[0].id), force_update: Boolean(rows[0].force_update) } });
});

export const appRouter = router;
