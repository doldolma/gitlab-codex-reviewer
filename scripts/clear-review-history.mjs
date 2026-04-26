import "dotenv/config";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const DEFAULT_DATABASE_URL = "file:../.data/gitlab-codex-reviewer.sqlite";
process.env.DATABASE_URL = normalizeDatabaseUrl(DEFAULT_DATABASE_URL);

const prisma = new PrismaClient();

async function main() {
  await prisma.reviewEvent.deleteMany();
  await prisma.reviewJob.deleteMany();
  await prisma.reviewLock.deleteMany();
  await prisma.reviewRun.deleteMany();
  await prisma.commitReviewRun.deleteMany();
  await prisma.mergeRequest.deleteMany();
  await prisma.branchWatchState.deleteMany();
  await prisma.gitlabProject.updateMany({
    data: {
      workspaceError: null,
      updatedAt: new Date().toISOString()
    }
  });
  console.log("Review history cleared. Users, sessions, projects, reviewer bot, and Codex auth were kept.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function normalizeDatabaseUrl(databaseUrl) {
  const trimmed = databaseUrl.trim();
  if (!trimmed.startsWith("file:")) return trimmed;
  const pathPart = trimmed.slice("file:".length);
  if (pathPart.startsWith("/")) return `file:${pathPart}`;
  return `file:${resolve(process.cwd(), "prisma", pathPart)}`;
}
