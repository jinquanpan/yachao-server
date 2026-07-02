import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function newToken(): string {
  return randomBytes(48).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(`${token}:${config.TOKEN_PEPPER}`).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function verifyHmac(raw: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
