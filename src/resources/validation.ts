import { AppError } from "../errors.js";
import type { FieldKind, ResourceDefinition } from "./definitions.js";

export type SqlValue = string | number | Date | null;

function normalizeValue(kind: FieldKind, value: unknown, field: string): SqlValue {
  if (value === null) return null;

  if (kind === "json") {
    if (typeof value !== "object") throw new AppError(400, "INVALID_FIELD", `${field} 必须是 JSON 对象或数组`);
    return JSON.stringify(value);
  }

  if (kind === "boolean") {
    if (value === true || value === 1 || value === "1") return 1;
    if (value === false || value === 0 || value === "0") return 0;
    throw new AppError(400, "INVALID_FIELD", `${field} 必须是布尔值`);
  }

  if (kind === "integer") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed)) throw new AppError(400, "INVALID_FIELD", `${field} 必须是整数`);
    return parsed;
  }

  if (kind === "bigint") {
    const text = String(value);
    if (!/^\d+$/.test(text)) throw new AppError(400, "INVALID_FIELD", `${field} 必须是非负整数 ID`);
    return text;
  }

  if (kind === "decimal") {
    const text = String(value);
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new AppError(400, "INVALID_FIELD", `${field} 必须是最多两位小数的数值`);
    return text;
  }

  if (kind === "datetime") {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new AppError(400, "INVALID_FIELD", `${field} 必须是合法的日期时间字符串`);
    }
    return new Date(value);
  }

  if (typeof value !== "string") throw new AppError(400, "INVALID_FIELD", `${field} 必须是字符串`);
  return value;
}

export function validatePayload(
  definition: ResourceDefinition,
  payload: unknown,
  mode: "create" | "update"
): Record<string, SqlValue> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError(400, "INVALID_BODY", "请求体必须是 JSON 对象");
  }

  const input = payload as Record<string, unknown>;
  const result: Record<string, SqlValue> = {};

  for (const [field, value] of Object.entries(input)) {
    const kind = definition.columns[field];
    if (!kind) throw new AppError(400, "UNKNOWN_FIELD", `不支持字段: ${field}`);
    if (definition.generated.includes(field)) throw new AppError(400, "READ_ONLY_FIELD", `字段不可写: ${field}`);
    if (mode === "update" && definition.primaryKey.includes(field)) throw new AppError(400, "READ_ONLY_FIELD", `主键不可修改: ${field}`);
    result[field] = normalizeValue(kind, value, field);
  }

  if (mode === "create") {
    const missing = definition.required.filter((field) => input[field] === undefined || input[field] === null);
    if (missing.length) throw new AppError(400, "MISSING_FIELDS", `缺少必填字段: ${missing.join(", ")}`);
  }

  if (!Object.keys(result).length) throw new AppError(400, "EMPTY_BODY", "没有可写入的字段");
  return result;
}
