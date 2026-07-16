import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";

export function newToken(): string {
  return randomBytes(48).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(`${token}:${config.TOKEN_PEPPER}`).digest("hex");
}

const scryptAsync = promisify(scrypt);
const PASSWORD_KEY_LENGTH = 64;

/** Hash passwords with a per-password random salt. Never store a plaintext password. */
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false;
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  try {
    const actual = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
    const expectedBuffer = Buffer.from(expected, "base64url");
    return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
  } catch {
    return false;
  }
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
