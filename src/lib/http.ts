import type { RequestHandler } from "express";
import type { output, ZodTypeAny } from "zod";
import { AppError } from "../errors.js";

export function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function positiveId(value: unknown, field = "id"): string {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text) || text === "0") throw new AppError(400, "INVALID_ID", `${field} 必须是正整数`);
  return text;
}

export function pagination(query: Record<string, unknown>): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "20"), 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function parse<T extends ZodTypeAny>(schema: T, input: unknown): output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "请求参数错误", result.error.flatten());
  }
  return result.data;
}

export function requireUserId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "请先登录");
  return req.user.id;
}
