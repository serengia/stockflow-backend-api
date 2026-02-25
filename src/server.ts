import http from "http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();
const server = http.createServer(app.callback());

const PORT = env.port;

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 API server listening on port ${PORT}`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("Error during server shutdown", err);
      process.exit(1);
      return;
    }

    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

