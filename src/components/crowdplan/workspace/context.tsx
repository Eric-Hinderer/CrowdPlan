"use client";

import { createContext, useContext } from "react";
import type { PlanEvaluation } from "@/domain/evaluate";
import type { PlanInput } from "@/domain/types";
import type { MemberRow, PlanBundle } from "@/lib/plan-data";

export interface WorkspaceFlags {
  searchConfigured: boolean;
  interpretation: "anthropic" | "deterministic";
  emailConfigured: boolean;
  demo: boolean;
}

export interface WorkspaceValue {
  bundle: PlanBundle;
  input: PlanInput;
  evaluation: PlanEvaluation;
  me: MemberRow | null;
  isOrganizer: boolean;
  tz: string;
  memberById: Map<string, MemberRow>;
  flags: WorkspaceFlags;
  /** Refetch after a mutation (realtime also triggers this). */
  refresh: () => Promise<void>;
  /** Optimistic local update (reconciled by the next refresh). */
  patch: (fn: (b: PlanBundle) => PlanBundle) => void;
  /** Demo plans mutate local state only. */
  demoMutate?: (fn: (b: PlanBundle) => PlanBundle) => void;
  connection: "connecting" | "live" | "offline";
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace outside WorkspaceContext");
  return v;
}

export function nameOf(ws: WorkspaceValue, memberId: string | null | undefined) {
  return (memberId && ws.memberById.get(memberId)?.display_name) || "Someone";
}
