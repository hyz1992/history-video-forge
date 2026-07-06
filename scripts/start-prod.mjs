process.env.NODE_ENV = "production";

import("../backend/dist/backend/src/server.js").then((mod) => {
  return mod.startServer();
}).then(({ host, port }) => {
  console.log(JSON.stringify({
    status: "backend-server-ready",
    host,
    port,
  }));
}).catch((error) => {
  const message = error instanceof Error ? error.message : "server_start_failed";
  console.error(JSON.stringify({
    status: "backend-server-failed",
    message,
  }));
  process.exitCode = 1;
});
