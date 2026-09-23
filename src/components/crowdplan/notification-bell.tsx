"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { relativeTime } from "./stamps";

interface Note {
  id: string;
  plan_id: string | null;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

export function NotificationBell({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data } = await supabase
      .from("notifications")
      .select("id, plan_id, title, body, created_at, read_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotes((data ?? []) as Note[]);
  }, [userId]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const initial = setTimeout(() => void load(), 0);
    const channel = supabase
      .channel(`notes-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => {
      clearTimeout(initial);
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = notes.filter((n) => !n.read_at).length;

  async function markAllRead() {
    const ids = notes.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    setNotes((ns) => ns.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await getBrowserSupabase().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  }

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        className="relative grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void markAllRead();
        }}
      >
        <Bell className="size-4.5" aria-hidden="true" />
        {unread ? (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-blocked px-1 text-[0.65rem] font-bold text-white">{unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-rule bg-surface shadow-xl">
          <p className="border-b border-rule px-4 py-2.5 text-sm font-semibold">Notifications</p>
          {notes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-3">Nothing yet. You&apos;ll hear here when your group responds.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="border-b border-rule/60 last:border-0">
                  <Link href={n.plan_id ? `/plan/${n.plan_id}` : "/"} className="block px-4 py-3 hover:bg-surface-2" onClick={() => setOpen(false)}>
                    <p className="text-sm font-semibold">{n.title}</p>
                    {n.body ? <p className="text-sm text-ink-2">{n.body}</p> : null}
                    <p className="mt-0.5 text-xs text-ink-3">{relativeTime(n.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
