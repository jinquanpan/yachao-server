export type FieldKind = "string" | "integer" | "bigint" | "decimal" | "datetime" | "json" | "text" | "boolean";

export interface ResourceDefinition {
  table: string;
  primaryKey: string[];
  columns: Record<string, FieldKind>;
  required: string[];
  generated: string[];
  softDelete?: boolean;
}

const fields = (entries: Array<[string, FieldKind]>): Record<string, FieldKind> => Object.fromEntries(entries);
const s = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "string"]);
const i = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "integer"]);
const b = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "bigint"]);
const d = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "decimal"]);
const dt = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "datetime"]);
const j = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "json"]);
const t = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "text"]);
const bool = (names: string[]): Array<[string, FieldKind]> => names.map((name) => [name, "boolean"]);

function resource(
  table: string,
  columns: Array<[string, FieldKind]>,
  required: string[],
  options: Partial<Pick<ResourceDefinition, "primaryKey" | "generated" | "softDelete">> = {}
): ResourceDefinition {
  return {
    table,
    primaryKey: options.primaryKey ?? ["id"],
    columns: fields(columns),
    required,
    generated: options.generated ?? ["id", "created_at", "updated_at", "deleted_at"],
    softDelete: options.softDelete
  };
}

export const resources: Record<string, ResourceDefinition> = {
  users: resource("users", [...b(["id"]), ...s(["phone", "username", "nickname", "avatar_url", "last_login_ip", "device_id", "platform", "role"]), ...i(["status"]), ...dt(["last_login_at", "created_at", "updated_at"])], ["phone"]),
  user_auths: resource("user_auths", [...b(["id", "user_id"]), ...s(["identity_type", "identifier", "credential"]), ...dt(["created_at", "updated_at"])], ["user_id", "identity_type", "identifier"]),
  user_sessions: resource("user_sessions", [...b(["id", "user_id"]), ...s(["token", "device", "platform", "ip"]), ...dt(["expire_at", "created_at"])], ["user_id", "token", "expire_at"]),
  coupons: resource("coupons", [...b(["id"]), ...s(["name", "type"]), ...d(["amount", "min_spend", "discount"]), ...dt(["valid_from", "valid_to", "created_at", "updated_at"]), ...i(["total", "issued"])], ["name", "type", "valid_from", "valid_to", "total"]),
  user_coupons: resource("user_coupons", [...b(["id", "user_id", "coupon_id"]), ...s(["status", "used_order_id"]), ...dt(["expire_at", "created_at", "updated_at"])], ["user_id", "coupon_id", "status", "expire_at"]),
  categories: resource("categories", [...i(["id", "parent_id", "sort"]), ...s(["key", "label", "icon"]), ...dt(["created_at", "updated_at"])], ["key", "label"]),
  products: resource("products", [...b(["id"]), ...s(["product_no", "name", "subtitle", "spec", "cover_image"]), ...d(["price"]), ...i(["category_id", "stock", "sales_count", "status"]), ...t(["story"]), ...dt(["created_at", "updated_at", "deleted_at"])], ["product_no", "name", "price", "category_id"], { softDelete: true }),
  tags: resource("tags", [...i(["id", "sort"]), ...s(["name", "color"])], ["name"]),
  product_tags: resource("product_tags", [...b(["product_id"]), ...i(["tag_id"]), ...dt(["created_at"])], ["product_id", "tag_id"], { primaryKey: ["product_id", "tag_id"], generated: ["created_at"] }),
  product_skus: resource("product_skus", [...b(["id", "product_id"]), ...s(["sku_code"]), ...d(["price"]), ...i(["stock"]), ...j(["attributes"]), ...dt(["created_at", "updated_at"])], ["product_id", "sku_code", "price"]),
  product_specs: resource("product_specs", [...i(["id"]), ...b(["product_id"]), ...s(["name"]), ...j(["values"])], ["product_id", "name", "values"]),
  scan_products: resource("scan_products", [...b(["id", "submitted_by", "reviewed_by"]), ...s(["barcode", "name", "cover_image", "status"]), ...d(["price"]), ...i(["category_id"]), ...dt(["created_at", "updated_at"])], ["barcode", "name", "price", "status", "submitted_by"]),
  scan_api_cache: resource("scan_api_cache", [...s(["barcode"]), ...t(["response_body"])], ["barcode", "response_body"], { primaryKey: ["barcode"], generated: [] }),
  stock_records: resource("stock_records", [...b(["id", "product_id", "operator_id"]), ...s(["change_type", "biz_type", "biz_id"]), ...i(["change_qty", "balance"]), ...dt(["created_at"])], ["product_id", "change_type", "change_qty", "balance"]),
  cart_items: resource("cart_items", [...b(["id", "user_id", "product_id", "sku_id"]), ...i(["qty"]), ...bool(["selected"]), ...dt(["created_at", "updated_at"])], ["user_id", "product_id", "qty"]),
  favorites: resource("favorites", [...b(["id", "user_id", "product_id"]), ...dt(["created_at"])], ["user_id", "product_id"]),
  addresses: resource("addresses", [...b(["id", "user_id"]), ...s(["consignee", "phone", "province", "city", "district", "detail", "tag"]), ...bool(["is_default"])], ["user_id", "consignee", "phone", "province", "city", "district", "detail"]),
  orders: resource("orders", [...b(["id", "user_id", "coupon_id", "payment_id"]), ...s(["order_no", "status", "carrier", "tracking_no", "remark"]), ...d(["total", "discount", "pay_amount"]), ...j(["address_snapshot"]), ...dt(["paid_at", "shipped_at", "received_at", "created_at", "updated_at"])], ["order_no", "user_id", "status", "total", "discount", "pay_amount", "address_snapshot"]),
  order_items: resource("order_items", [...b(["id", "order_id", "product_id", "sku_id"]), ...j(["product_snapshot", "sku_snapshot"]), ...d(["price"]), ...i(["qty"])], ["order_id", "product_id", "product_snapshot", "price", "qty"]),
  order_status_log: resource("order_status_log", [...b(["id", "order_id", "operator_id"]), ...s(["from_status", "to_status", "remark"]), ...dt(["created_at"])], ["order_id", "to_status"]),
  payments: resource("payments", [...b(["id", "order_id"]), ...s(["payment_no", "channel", "status", "trade_no"]), ...d(["amount"]), ...dt(["paid_at", "created_at", "updated_at"])], ["order_id", "payment_no", "channel", "amount", "status"]),
  refunds: resource("refunds", [...b(["id", "payment_id", "order_id"]), ...s(["refund_no", "reason", "status"]), ...d(["amount"]), ...dt(["processed_at", "created_at"])], ["payment_id", "order_id", "refund_no", "amount", "status"]),
  banners: resource("banners", [...b(["id"]), ...s(["title", "image_url", "link_url", "position"]), ...i(["sort"]), ...dt(["valid_from", "valid_to", "created_at"])], ["image_url", "position", "valid_from", "valid_to"]),
  recommend_positions: resource("recommend_positions", [...i(["id", "status"]), ...s(["code", "description"]), ...dt(["created_at"])], ["code"]),
  recommend_items: resource("recommend_items", [...b(["id", "product_id"]), ...i(["position_id", "sort"]), ...dt(["valid_from", "valid_to"])], ["position_id", "product_id", "valid_from", "valid_to"]),
  error_logs: resource("error_logs", [...b(["id", "user_id"]), ...s(["boundary", "route", "mechanism", "severity", "user_agent"]), ...t(["message", "stack"]), ...j(["context"]), ...dt(["created_at", "updated_at"])], ["severity", "message"]),
  operation_logs: resource("operation_logs", [...b(["id", "user_id"]), ...s(["action", "target", "ip", "user_agent"]), ...dt(["created_at"])], ["action"]),
  app_versions: resource("app_versions", [...i(["id"]), ...s(["platform", "version", "download_url"]), ...bool(["force_update"]), ...t(["release_notes"]), ...dt(["created_at"])], ["platform", "version", "download_url"])
};

export function getResource(name: string): ResourceDefinition | undefined {
  return resources[name.replaceAll("-", "_")];
}
