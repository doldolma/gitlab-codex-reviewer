import { APP_NAME } from "../lib/branding";
import { prisma } from "../lib/prisma";
import { codexAppServer, config, reviewWorker } from "../lib/services";
import { ReviewScheduler } from "./scheduler";

const scheduler = new ReviewScheduler(config, reviewWorker);
scheduler.start();

console.log(`${APP_NAME} worker started; polling every ${config.pollIntervalSeconds}s; review concurrency ${config.reviewConcurrency}.`);

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; stopping worker.`);
  scheduler.stop();
  await codexAppServer.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
