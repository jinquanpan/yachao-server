import { AppError } from "../errors.js";

export function toCents(value: string | number): number {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new AppError(500, "INVALID_MONEY", `非法金额: ${text}`);
  const [integer, decimal = ""] = text.split(".");
  const cents = Number(integer) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new AppError(500, "INVALID_MONEY", "金额超出安全范围");
  return cents;
}

export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new AppError(500, "INVALID_MONEY", "金额超出安全范围");
  return `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}
