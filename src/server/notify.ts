import "server-only";

import { appOrigin } from "./invite";
import { serverDb, serverDbConfigured } from "./db";

export interface NotifyInput {
  planId: string;
  userIds: string[];
  kind: string;
  title: string;
  body?: string;
  /** Unique per logical event and recipient; duplicates are silently ignored. */
  dedupeKey: (userId: string) => string;
  email?: boolean;
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/** In-app notifications always; email via Resend only when configured and the recipient has an account email. */
export async function notify(input: NotifyInput): Promise<number> {
  if (!serverDbConfigured() || input.userIds.length === 0) return 0;
  const sql = serverDb();
  const rows = input.userIds.map((u) => ({
    plan_id: input.planId,
    recipient_user_id: u,
    kind: input.kind,
    title: input.title.slice(0, 200),
    body: input.body?.slice(0, 1000) ?? null,
    dedupe_key: input.dedupeKey(u).slice(0, 200),
    email_status: input.email && emailConfigured() ? "pending" : "none",
  }));
  const inserted = await sql`
    insert into public.notifications ${sql(rows, "plan_id", "recipient_user_id", "kind", "title", "body", "dedupe_key", "email_status")}
    on conflict (dedupe_key) do nothing
    returning id, recipient_user_id, email_status`;
  if (input.email && emailConfigured()) {
    for (const n of inserted) {
      if (n.email_status !== "pending") continue;
      const status = await sendEmail(n.recipient_user_id, input.title, input.body ?? "", `${appOrigin()}/plan/${input.planId}`);
      await sql`update public.notifications set email_status = ${status} where id = ${n.id}`;
    }
  }
  return inserted.length;
}

async function sendEmail(userId: string, subject: string, body: string, link: string): Promise<"sent" | "skipped" | "failed"> {
  const sql = serverDb();
  const rows = await sql`select email from public.profiles where id = ${userId} and email is not null and email not like '%@guests.crowdplan.invalid'`;
  const to = rows[0]?.email as string | undefined;
  if (!to) return "skipped";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [to],
        subject,
        text: `${body}\n\nOpen the plan: ${link}\n\nYou're receiving this because you're part of a CrowdPlan plan.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** Notify the organizer once when every member has responded. */
export async function checkEveryoneResponded(planId: string) {
  if (!serverDbConfigured()) return;
  const sql = serverDb();
  const rows = await sql`
    select p.owner_id, p.title, p.status, count(m.*) as total, count(m.responded_at) as responded
    from public.plans p join public.plan_members m on m.plan_id = p.id
    where p.id = ${planId} group by p.id`;
  const r = rows[0];
  if (!r || r.status !== "collecting" || Number(r.total) < 2 || Number(r.total) !== Number(r.responded)) return;
  await notify({
    planId,
    userIds: [r.owner_id],
    kind: "everyone_responded",
    title: `Everyone responded to ${r.title}`,
    body: `All ${r.total} people have shared their availability and constraints.`,
    dedupeKey: (u) => `everyone_responded:${planId}:${r.total}:${u}`,
    email: true,
  });
}

/** Email notifications that database functions already created in-app (e.g. finalization). */
export async function emailExisting(planId: string, kind: string) {
  if (!serverDbConfigured() || !emailConfigured()) return;
  const sql = serverDb();
  const rows = await sql`
    update public.notifications set email_status = 'pending'
    where plan_id = ${planId} and kind = ${kind} and email_status = 'none'
    returning id, recipient_user_id, title, body`;
  for (const n of rows) {
    const status = await sendEmail(n.recipient_user_id, n.title, n.body ?? "", `${appOrigin()}/plan/${planId}`);
    await sql`update public.notifications set email_status = ${status} where id = ${n.id}`;
  }
}
