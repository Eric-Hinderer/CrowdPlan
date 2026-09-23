"use client";

import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { getInviteLinkAction, rotateInviteAction } from "@/app/actions/plans";
import { AvatarStack, Button, ErrorNote, Sheet } from "@/components/ui/primitives";
import { useWorkspace } from "./context";

const MODE_LABEL = {
  fixed: "Place is set",
  criteria: "Searching within your limits",
  shortlist: "Comparing your shortlist",
  discovery: "Open to ideas",
} as const;

export function PlanHeader({ welcome }: { welcome?: boolean }) {
  const ws = useWorkspace();
  const { plan, members } = ws.bundle;
  const [inviteOpen, setInviteOpen] = useState(Boolean(welcome && ws.isOrganizer));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-5">
      {ws.flags.demo ? (
        <p className="mb-4 rounded-xl border border-brand/40 bg-brand/8 px-3.5 py-2 text-sm font-semibold text-brand">
          Demo plan — sample people, places and prices. Nothing here is live data, and changes aren&apos;t saved.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <span>{MODE_LABEL[plan.mode]}</span>
            {!ws.flags.demo ? (
              <span className="inline-flex items-center gap-1" title={ws.connection === "live" ? "Updates appear instantly" : "Reconnecting…"}>
                <span className={`size-2 rounded-full ${ws.connection === "live" ? "bg-resolved" : ws.connection === "offline" ? "bg-blocked" : "bg-warn"}`} aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{ws.connection === "live" ? "Live" : ws.connection === "offline" ? "Offline" : "Connecting"}</span>
              </span>
            ) : null}
          </p>
          <h1 className="t-title mt-1 break-words" data-testid="plan-title">
            {plan.title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <AvatarStack people={members.map((m) => ({ id: m.id, name: m.display_name, color: m.color }))} />
          {ws.isOrganizer && plan.status === "collecting" ? (
            <Button onClick={() => setInviteOpen(true)} data-testid="invite-button">
              <Share2 className="size-4" aria-hidden="true" /> Invite
            </Button>
          ) : null}
        </div>
      </div>
      {ws.isOrganizer && !ws.flags.demo ? <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} /> : null}
    </div>
  );
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || link) return;
    start(async () => {
      const r = await getInviteLinkAction(ws.bundle.plan.id);
      if (r.ok) setLink(r.data.url);
      else setError(r.error);
    });
  }, [open, link, ws.bundle.plan.id]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Invite your group">
      <div className="space-y-4">
        <p className="text-ink-2">Send this link to your group chat. Friends open it, type their name, and they&apos;re in — no account needed.</p>
        <div className="rounded-xl border border-rule bg-surface-2 p-3">
          <p className="text-xs text-ink-3">Plan code {ws.bundle.plan.share_code}</p>
          <p className="mt-1 break-all font-medium" data-testid="invite-link">
            {link ?? (pending ? "Creating link…" : "")}
          </p>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy} disabled={!link} data-testid="copy-invite">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <Button variant="secondary" disabled={!link} onClick={() => link && navigator.share({ title: ws.bundle.plan.title, text: `Help plan: ${ws.bundle.plan.title}`, url: link }).catch(() => {})}>
              <Share2 className="size-4" aria-hidden="true" /> Share
            </Button>
          ) : null}
          <Button
            variant="ghost"
            loading={pending && !!link}
            onClick={() =>
              start(async () => {
                const r = await rotateInviteAction(ws.bundle.plan.id);
                if (r.ok) setLink(r.data.url);
                else setError(r.error);
              })
            }
          >
            <RefreshCw className="size-4" aria-hidden="true" /> New link
          </Button>
        </div>
        <p className="text-xs text-ink-3">A new link turns the old one off for anyone who hasn&apos;t joined yet. People already in the plan keep access.</p>
      </div>
    </Sheet>
  );
}
