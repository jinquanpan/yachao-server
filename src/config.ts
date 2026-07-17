import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.string().startsWith("/").default("/api/v1"),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1).default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().min(1).default("yacao_store"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGIN: z.string().default("*"),
  API_TOKEN: z.string().optional().transform((value) => value || undefined),
  TOKEN_PEPPER: z.string().default("change-this-in-production"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DEV_LOGIN_CODE: z.string().min(4).max(12).default("123456"),
  OAUTH_DEV_MODE: z.string().default("false").transform((value) => value === "true"),
  GDS_DEBUG: z.string().default("false").transform((value) => value === "true"),
  WX_APP_ID: z.string().optional().transform((value) => value || undefined),
  WX_APP_SECRET: z.string().optional().transform((value) => value || undefined),
  PAYMENT_CALLBACK_SECRET: z.string().optional().transform((value) => value || undefined),
  REFUND_CALLBACK_SECRET: z.string().optional().transform((value) => value || undefined),
  UPLOAD_DIR: z.string().default("uploads"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000")
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  throw new Error(`环境变量配置错误: ${result.error.message}`);
}

export const config = result.data;

if (config.NODE_ENV === "production" && config.TOKEN_PEPPER === "change-this-in-production") {
  throw new Error("生产环境必须配置 TOKEN_PEPPER");
}
if (config.NODE_ENV === "production" && !config.API_TOKEN) {
  throw new Error("生产环境必须配置 API_TOKEN");
}
