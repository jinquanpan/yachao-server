import { db } from "../db.js";
import { config } from "../config.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";

const GDS_API_URL = "https://bff.gds.org.cn/gds/searching-api/ProductService/ProductListByGTIN";

export type GdsProduct = { name: string | null; barcode: string; description: string | null };

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
      name: firstText(item, ["ProductName", "productName", "Name", "name"]),
      barcode: firstText(item, ["GTIN", "gtin", "Gtin", "Barcode", "barcode"]) ?? fallbackBarcode,
      description: firstText(item, ["ProductDescription", "productDescription", "Description", "description", "TradeItemDescription", "tradeItemDescription"])
    };
  } catch {
    return null;
  }
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
