import { db } from "../db.js";
import type { DbRow } from "../domain/types.js";
import { AppError } from "../errors.js";

const GDS_API_URL = "https://bff.gds.org.cn/gds/searching-api/ProductService/ProductListByGTIN";

function normalizeGtin(barcode: string): string {
  if (!/^\d+$/.test(barcode)) throw new AppError(400, "INVALID_BARCODE", "条形码只能包含数字");
  if (barcode.length === 13) return `0${barcode}`;
  if (barcode.length === 14) return barcode;
  throw new AppError(400, "INVALID_BARCODE", "GDS 查询仅支持 13 或 14 位 GTIN");
}

async function responseBody(response: Response): Promise<string> {
  return response.text();
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
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${String(auth.access_token).trim()}`, currentRole: String(auth.current_role ?? "Mine"), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AppError(502, "GDS_REQUEST_FAILED", "GDS 商品服务请求失败");
  }
  const data = await responseBody(response);
  if (response.status === 401) throw new AppError(502, "GDS_TOKEN_EXPIRED", "GDS Access Token 已失效");
  if (response.status === 403) throw new AppError(502, "GDS_FORBIDDEN", "当前 GDS 账号没有查询权限");
  if (!response.ok) throw new AppError(502, "GDS_HTTP_ERROR", `GDS 商品服务返回 HTTP ${response.status}`);
  return { barcode, gtin, body: data };
}
