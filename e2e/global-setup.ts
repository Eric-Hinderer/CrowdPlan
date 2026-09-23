import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

export default async function globalSetup() {
  const runId = process.env.E2E_RUN_ID || `e2e-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
  process.env.E2E_RUN_ID = runId;
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/run-id.txt", runId);
  console.log(`[e2e] run id ${runId} against ${process.env.E2E_BASE_URL || "http://localhost:3000"}`);
}
