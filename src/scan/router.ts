import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { userAuth } from "../auth/middleware.js";
import { money } from "../catalog/format.js";
import { config } from "../config.js";
import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";
import { normalizeGtin, parseGdsProduct, queryGdsProduct } from "../gds/service.js";
import { pagination, parse, requireUserId, routeParam } from "../lib/http.js";

const scan = Router();
const uploads = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

scan.get("/gds/products/:barcode", async (req, res) => {
  const barcode = parse(z.string().trim().regex(/^\d{13,14}$/), routeParam(req.params.barcode));
  const gtin = normalizeGtin(barcode);
  // New records use the canonical 14-digit GTIN. Keep the raw value as a fallback for existing cache rows.
  const [cached] = await db.query<DbRow[]>(
    "SELECT barcode, response_body FROM scan_api_cache WHERE barcode IN (?, ?) ORDER BY barcode = ? DESC LIMIT 1",
    [gtin, barcode, gtin]
  );
  if (cached[0]) return res.json({ data: parseGdsProduct(String(cached[0].response_body), gtin) });
  const result = await queryGdsProduct(barcode);
  await db.execute(
    "INSERT INTO scan_api_cache (barcode, response_body) VALUES (?, ?) ON DUPLICATE KEY UPDATE response_body = VALUES(response_body)",
    [result.gtin, result.body]
  );
  res.json({ data: parseGdsProduct(result.body, result.gtin) });
});

scan.get("/barcodes/:barcode", async (req, res) => {
  const barcode = parse(z.string().trim().regex(/^\d{6,64}$/), routeParam(req.params.barcode));
  const cachedBarcode = /^\d{13,14}$/.test(barcode) ? normalizeGtin(barcode) : barcode;
  const [[official], [submitted], [cached]] = await Promise.all([
    db.query<DbRow[]>("SELECT id, product_no AS barcode, name, price, category_id, cover_image FROM products WHERE product_no = ? AND status = 1 AND deleted_at IS NULL LIMIT 1", [barcode]),
    db.query<DbRow[]>("SELECT id, barcode, name, price, category_id, cover_image FROM scan_products WHERE barcode = ? AND status = 'approved' ORDER BY id DESC LIMIT 1", [barcode]),
    db.query<DbRow[]>(
      "SELECT barcode, response_body FROM scan_api_cache WHERE barcode IN (?, ?) ORDER BY barcode = ? DESC LIMIT 1",
      [cachedBarcode, barcode, cachedBarcode]
    )
  ]);
  if (official[0]) return res.json({ data: { ...official[0], id: String(official[0].id), price: money(official[0].price), source: "products" } });
  if (submitted[0]) return res.json({ data: { ...submitted[0], id: String(submitted[0].id), price: money(submitted[0].price), source: "scan_products" } });
  if (cached[0]) {
    return res.json({ data: { barcode, body: String(cached[0].response_body), source: "cache", cached: true } });
  }
  throw new AppError(404, "BARCODE_NOT_FOUND", "未找到条码信息，第三方条码服务尚未配置");
});

scan.post("/products", userAuth, async (req, res) => {
  const input = parse(z.object({ barcode: z.string().trim().regex(/^\d{6,64}$/), name: z.string().trim().min(1).max(128), price: z.union([z.string(), z.number()]).transform(String), category_id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String).optional(), cover_image: z.string().url().max(255).optional() }), req.body);
  if (!/^\d+(\.\d{1,2})?$/.test(input.price) || Number(input.price) < 0) throw new AppError(400, "INVALID_PRICE", "价格格式错误");
  const [insert] = await db.execute<ResultSetHeader>("INSERT INTO scan_products (barcode, name, price, category_id, cover_image, status, submitted_by) VALUES (?, ?, ?, ?, ?, 'pending', ?)", [input.barcode, input.name, money(input.price), input.category_id ?? null, input.cover_image ?? null, requireUserId(req)]);
  const [rows] = await db.query<DbRow[]>("SELECT id, barcode, name, price, category_id, cover_image, status, created_at FROM scan_products WHERE id = ?", [insert.insertId]);
  res.status(201).json({ data: { ...rows[0], id: String(rows[0]?.id), price: money(rows[0]?.price) } });
});

scan.get("/products/mine", userAuth, async (req, res) => {
  const { page, pageSize, offset } = pagination(req.query);
  const userId = requireUserId(req);
  const [rows] = await db.query<DbRow[]>("SELECT id, barcode, name, price, category_id, cover_image, status, created_at, updated_at FROM scan_products WHERE submitted_by = ? ORDER BY id DESC LIMIT ? OFFSET ?", [userId, pageSize, offset]);
  const [counts] = await db.query<DbRow[]>("SELECT COUNT(*) AS total FROM scan_products WHERE submitted_by = ?", [userId]);
  res.json({ data: rows.map((row) => ({ ...row, id: String(row.id), price: money(row.price) })), meta: { page, pageSize, total: Number(counts[0]?.total ?? 0) } });
});

uploads.post("/images", userAuth, upload.single("image"), async (req, res) => {
  if (!req.file) throw new AppError(400, "IMAGE_REQUIRED", "请选择图片文件");
  const detected = await fileTypeFromBuffer(req.file.buffer);
  if (!detected || !allowed.has(detected.mime) || detected.mime !== req.file.mimetype) throw new AppError(400, "INVALID_IMAGE", "仅支持真实的 JPEG、PNG 或 WebP 图片");
  const date = new Date().toISOString().slice(0, 10);
  const relativeDir = path.join(date);
  const absoluteDir = path.resolve(config.UPLOAD_DIR, relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const filename = `${randomBytes(16).toString("hex")}.${detected.ext}`;
  await writeFile(path.join(absoluteDir, filename), req.file.buffer, { flag: "wx" });
  const relativeUrl = `/uploads/${relativeDir.replaceAll("\\", "/")}/${filename}`;
  res.status(201).json({ data: { url: `${config.PUBLIC_BASE_URL}${relativeUrl}`, path: relativeUrl, mime: detected.mime, size: req.file.size } });
});

export { scan as scanRouter, uploads as uploadsRouter };
