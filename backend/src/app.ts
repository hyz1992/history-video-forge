import { env } from "./config/env";
import { createDbClient } from "./db/client";

export function buildApp() {
  return {
    env,
    db: createDbClient(),
    healthcheck() {
      return {
        status: "ok",
        nodeEnv: env.nodeEnv,
      };
    },
  };
}
