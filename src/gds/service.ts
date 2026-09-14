import { db } from "../db.js";
import { config } from "../config.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";

const GDS_API_URL = "https://bff.gds.org.cn/gds/searching-api/ProductService/ProductListByGTIN";

export type GdsProduct = {
  productFullName: string | null;
  brandcn: string | null;
  specification: string | null;
  gtin: string;
  firm_name: string | null;
  branch_name: string | null;
  gpcname: string | null;
  valid_date: string | null;
  picture_filename: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstText(item: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** Extracts the public product fields from a GDS ProductListByGTIN response. */
export function parseGdsProduct(body: string, fallbackBarcode: string): GdsProduct | null {
  try {
    const response = record(JSON.parse(body));
    const data = record(response?.Data ?? response?.data);
    const items = data?.Items ?? data?.items;
    if (!Array.isArray(items) || !items.length) return null;
    const item = record(items[0]);
    if (!item) return null;
    return {
      productFullName: firstText(item, ["productFullName", "ProductFullName", "ProductName", "productName", "Name", "name"]),
      brandcn: firstText(item, ["brandcn", "Brandcn", "BrandCN", "brand", "Brand"]),
      specification: firstText(item, ["specification", "Specification", "spec", "Spec"]),
      gtin: firstText(item, ["gtin", "GTIN", "Gtin", "Barcode", "barcode"]) ?? fallbackBarcode,
      firm_name: firstText(item, ["firm_name", "FirmName", "firmName"]),
      branch_name: firstText(item, ["branch_name", "BranchName", "branchName"]),
      gpcname: firstText(item, ["gpcname", "GpcName", "GPCName"]),
      valid_date: firstText(item, ["valid_date", "ValidDate", "validDate"]),
      picture_filename: firstText(item, ["picture_filename", "PictureFilename", "pictureFilename"])
    };
  } catch {
    return null;
  }
}

function imageExtension(sourceUrl: URL, contentType: string | null): string {
  const byPath = path.posix.extname(sourceUrl.pathname).slice(1).toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(byPath)) return byPath === "jpeg" ? "jpg" : byPath;
  const byContentType: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const mediaType = contentType?.split(";", 1)[0]?.toLowerCase() ?? "";
  const extension = byContentType[mediaType];
  if (!extension) throw new AppError(502, "GDS_IMAGE_INVALID", "GDS 商品图片格式不受支持");
  return extension;
}

/** Downloads a GDS product image once and substitutes its public local URL. */
export async function localizeGdsPicture(product: GdsProduct): Promise<GdsProduct> {
  if (!product.picture_filename) return product;
  if (!/^\d{13,14}$/.test(product.gtin)) throw new AppError(502, "GDS_IMAGE_INVALID", "GDS 商品条码格式无效");

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(product.picture_filename, config.GDS_IMAGE_BASE_URL);
  } catch {
    throw new AppError(502, "GDS_IMAGE_INVALID", "GDS 商品图片地址无效");
  }
  if (sourceUrl.origin !== new URL(config.GDS_IMAGE_BASE_URL).origin) throw new AppError(502, "GDS_IMAGE_INVALID", "GDS 商品图片地址不受信任");

  let response: Response;
  try {
    response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(502, "GDS_IMAGE_DOWNLOAD_FAILED", "GDS 商品图片下载失败");
  }
  if (!response.ok) throw new AppError(502, "GDS_IMAGE_DOWNLOAD_FAILED", `GDS 商品图片下载失败，HTTP ${response.status}`);
  const extension = imageExtension(sourceUrl, response.headers.get("content-type"));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new AppError(502, "GDS_IMAGE_INVALID", "GDS 商品图片大小无效");

  const filename = `${product.gtin}.${extension}`;
  const directory = path.resolve(config.GDS_GOODS_DIR);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
  }
  return { ...product, picture_filename: `${config.GDS_GOODS_PUBLIC_BASE_URL.replace(/\/$/, "")}/${filename}` };
}

export function normalizeGtin(barcode: string): string {
  if (!/^\d+$/.test(barcode)) throw new AppError(400, "INVALID_BARCODE", "条形码只能包含数字");
  if (barcode.length === 13) return `0${barcode}`;
  if (barcode.length === 14) return barcode;
  throw new AppError(400, "INVALID_BARCODE", "GDS 查询仅支持 13 或 14 位 GTIN");
}

async function responseBody(response: Response): Promise<string> {
  return response.text();
}

function maskedBearer(token: string): string {
  const value = token.trim();
  if (value.length <= 16) return "Bearer [REDACTED]";
  return `Bearer ${value.slice(0, 8)}...${value.slice(-6)}`;
}

function debugGds(event: string, details: Record<string, unknown>): void {
  if (config.GDS_DEBUG) console.info(`[gds] ${event}`, details);
}

/** Reads the latest valid token from MySQL on every call, then requests the GDS service. */
export async function queryGdsProduct(barcode: string): Promise<{ barcode: string; gtin: string; body: string }> {
  const gtin = normalizeGtin(barcode);
  const [rows] = await db.query<DbRow[]>(
    `SELECT access_token, current_role
       FROM gds_auth
      WHERE status = 1
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY updated_at DESC, id DESC LIMIT 1`,
    []
  );
  const auth = rows[0];
  if (!auth?.access_token) throw new AppError(503, "GDS_TOKEN_NOT_AVAILABLE", "未找到有效的 GDS Access Token");

  const url = new URL(GDS_API_URL);
  url.searchParams.set("PageSize", "30");
  url.searchParams.set("PageIndex", "1");
  url.searchParams.set("SearchItem", gtin);
  const accessToken = String(auth.access_token).trim();
  const currentRole = String(auth.current_role ?? "Mine");
  const headers = { Authorization: `Bearer ${accessToken}`, currentRole, Accept: "application/json" };
  debugGds("request", {
    method: "GET",
    url: url.toString(),
    headers: { Authorization: maskedBearer(accessToken), currentRole, Accept: "application/json" },
    body: null
  });
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    debugGds("request_failed", {
      url: url.toString(),
      error: error instanceof Error ? { name: error.name, message: error.message, cause: String(error.cause ?? "") } : String(error)
    });
    throw new AppError(502, "GDS_REQUEST_FAILED", "GDS 商品服务请求失败");
  }
  debugGds("response", { url: url.toString(), status: response.status, statusText: response.statusText });
  const data = await responseBody(response);
  if (response.status === 401) throw new AppError(502, "GDS_TOKEN_EXPIRED", "GDS Access Token 已失效");
  if (response.status === 403) throw new AppError(502, "GDS_FORBIDDEN", "当前 GDS 账号没有查询权限");
  if (!response.ok) throw new AppError(502, "GDS_HTTP_ERROR", `GDS 商品服务返回 HTTP ${response.status}`);
  return { barcode, gtin, body: data };
}
