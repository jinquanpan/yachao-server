import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";

const server = createServer(createApp());
server.listen(config.PORT, () => {
  console.log(`Yachao Server API: http://localhost:${config.PORT}${config.API_PREFIX}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
