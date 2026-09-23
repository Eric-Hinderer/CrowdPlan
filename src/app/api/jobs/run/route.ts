import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverDbConfigured } from "@/server/db";
import { runScheduledJobs } from "@/server/jobs";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const expected = process.env.CROWDPLAN_JOB_SECRET ?? "";
  const provided = req.headers.get("x-job-secret") ?? (req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Scheduled entry point (pg_cron → pg_net, or Vercel Cron). Idempotent and bounded. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!serverDbConfigured()) return NextResponse.json({ error: "server database not configured" }, { status: 503 });
  const started = Date.now();
  const report = await runScheduledJobs();
  console.log("[jobs]", JSON.stringify({ ...report, ms: Date.now() - started }));
  return NextResponse.json({ ok: true, ms: Date.now() - started, ...report });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
