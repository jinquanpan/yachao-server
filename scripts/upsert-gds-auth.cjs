#!/usr/bin/env node
require("dotenv").config();

const mysql = require("mysql2/promise");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function expiresAtFromJwt(token) {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8");
    const { exp } = JSON.parse(json);
    return typeof exp === "number" ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

async function main() {
  const account = required("GDS_ACCOUNT");
  const accessToken = required("GDS_ACCESS_TOKEN");
  const currentRole = process.env.GDS_CURRENT_ROLE?.trim() || "Mine";
  const configuredExpiry = process.env.GDS_TOKEN_EXPIRES_AT?.trim();
  const expiresAt = configuredExpiry ? new Date(configuredExpiry) : expiresAtFromJwt(accessToken);

  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("GDS_TOKEN_EXPIRES_AT 必须是有效的日期时间");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME")
  });

  try {
    await connection.execute(
      `INSERT INTO gds_auth (account, access_token, current_role, expires_at, status)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         current_role = VALUES(current_role),
         expires_at = VALUES(expires_at),
         status = 1`,
      [account, accessToken, currentRole, expiresAt ?? null]
    );
    console.log(`GDS 凭证已写入账号 ${account}（过期时间：${expiresAt?.toISOString() ?? "未设置"}）。`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`写入 GDS 凭证失败：${error.message}`);
  process.exitCode = 1;
});
