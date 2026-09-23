import { readFileSync } from "node:fs";
import { adminCall } from "./helpers";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  const runId = readFileSync("test-results/run-id.txt", "utf8").trim();
  try {
    const out = await adminCall({ action: "cleanup", testRunId: runId });
    console.log(`[e2e] cleanup ${runId}:`, JSON.stringify(out));
  } catch (e) {
    console.error("[e2e] cleanup failed", e);
  }
}
