import mysql from "mysql2/promise";
import { config } from "./config.js";

export const db = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: config.DB_CONNECTION_LIMIT,
  waitForConnections: true,
  enableKeepAlive: true,
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
  timezone: "+08:00"
});

export async function closeDatabase(): Promise<void> {
  await db.end();
}
