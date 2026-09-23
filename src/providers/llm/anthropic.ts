import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CONSTRAINT_KINDS } from "@/domain/constraints";
import { formatDateLabel, localDate, weekdayOfDate } from "@/domain/time";
import type { InterpretationContext } from "@/domain/interpretation/schema";
import type { InterpretationProvider } from "./index";

// Flat "wire" schemas for structured output. Nested typed values travel as
// JSON strings and are decoded + validated by the domain schemas afterwards.
const wirePlan = z.object({
  title: z.string(),
  kind: z.enum(["activity", "dinner", "travel"]),
  mode: z.enum(["fixed", "criteria", "shortlist", "discovery"]),
  dimensions: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      state: z.enum(["LOCKED", "CONSTRAINED", "UNDECIDED"]),
      value_json: z.string(),
      display: z.string(),
      needs_confirmation: z.boolean(),
    }),
  ),
  shortlist: z.array(z.string()),
  clarifications: z.array(
    z.object({
      source_text: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), constraint_json: z.string() })),
    }),
  ),
});

const wireConstraints = z.object({
  constraints: z.array(
    z.object({
      kind: z.enum(CONSTRAINT_KINDS as [string, ...string[]]),
      strength: z.enum(["hard", "soft"]),
      params_json: z.string(),
      label: z.string(),
      source_text: z.string(),
    }),
  ),
  needs_clarification: z.boolean(),
  clarifications: z.array(
    z.object({
      source_text: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), constraint_json: z.string() })),
    }),
  ),
  unparsed: z.array(z.string()),
});

const SYSTEM = `You extract structure from short group-planning messages for CrowdPlan.
Your job is limited to: intent, plan dimensions, hard/soft constraints, preferences, ambiguity detection and clarification questions.
You never recommend, rank or choose options, and never invent facts (prices, hours, places).

Dimension states: LOCKED = settled value; CONSTRAINED = bounded set/range; UNDECIDED = not yet resolved.
Dimension keys: activity, place, date (non-travel), dates (travel), time, budget, cuisine, area, destination, nights, flights, lodging.
value_json is a JSON object, one of:
{"type":"text","text":...} {"type":"place","name":...} {"type":"dates","dates":["yyyy-MM-dd"]} {"type":"dateRange","start":"yyyy-MM-dd","end":"yyyy-MM-dd"}
{"type":"timeWindow","start":"HH:mm","end":"HH:mm"} {"type":"time","start":"HH:mm"} {"type":"money","max":40,"currency":"USD","basis":"per_person"}
{"type":"list","items":[...]} {"type":"nights","min":3,"max":4} {"type":"area","label":...}; use "null" for UNDECIDED.
Modes: fixed (a specific place/destination is named), criteria (constraints but no specific place), shortlist (the group names several options or asks to choose among options), discovery (asks for ideas). Never propose alternatives to a named place.
Relative dates must resolve from the provided "today"; set needs_confirmation true for relative dates or assumed am/pm.

Constraint kinds and params_json: max_budget {"amount"} hard; preferred_budget {"amount"} soft; dietary {"restriction"}; cuisine_preference {"cuisines":[...],"mode":"prefer"|"avoid"}; avoid_area {"area"};
max_travel_minutes {"minutes"}; earliest_start/latest_end/earliest_departure/latest_arrival_home {"time":"HH:mm","weekday"?}; unavailable_day/no_travel_day {"weekday"} ; day_preference {"weekday","prefer":bool};
accessibility {"need"}; nonstop_only {}; note {"text"}. Weekdays are lowercase English names.
"can't/cannot/must/need to" statements are hard; "rather/prefer/ideally" are soft.
AMBIGUITY: if a statement could map to different hard rules (e.g. "I can't go Sunday" — home before Sunday? no travel Sunday? unavailable all day?), do NOT emit a constraint for it. Set needs_clarification true and add a clarification with 3-4 options; each option's constraint_json is the rule it would create, or "null" for "Something else".
Put anything you cannot map into unparsed.`;

function decode(json: string): unknown {
  if (!json || json === "null") return null;
  return JSON.parse(json);
}

export class AnthropicInterpreter implements InterpretationProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(private model: string) {
    this.client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  }

  private context(ctx: InterpretationContext) {
    const today = localDate(ctx.now, ctx.timezone);
    return `Today is ${weekdayOfDate(today)} ${today} (${formatDateLabel(today)}), timezone ${ctx.timezone}.${ctx.kind ? ` Plan type: ${ctx.kind}.` : ""}`;
  }

  async interpretPlan(text: string, ctx: InterpretationContext) {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(wirePlan) },
      messages: [{ role: "user", content: `${this.context(ctx)}\nOrganizer wrote: """${text.slice(0, 1000)}"""\nExtract the plan.` }],
    });
    if (response.stop_reason === "refusal") throw new Error("LLM declined the request");
    const out = response.parsed_output;
    if (!out) throw new Error("LLM returned no structured output");
    return {
      title: out.title,
      kind: out.kind,
      mode: out.mode,
      shortlist: out.shortlist,
      dimensions: out.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        state: d.state,
        value: decode(d.value_json),
        display: d.display,
        needsConfirmation: d.needs_confirmation,
      })),
      clarifications: out.clarifications.map((c) => ({
        sourceText: c.source_text,
        question: c.question,
        options: c.options.map((o) => ({ label: o.label, constraint: decode(o.constraint_json) })),
      })),
    };
  }

  async interpretParticipant(text: string, ctx: InterpretationContext) {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(wireConstraints) },
      messages: [{ role: "user", content: `${this.context(ctx)}\nParticipant wrote: """${text.slice(0, 1000)}"""\nExtract their constraints and preferences.` }],
    });
    if (response.stop_reason === "refusal") throw new Error("LLM declined the request");
    const out = response.parsed_output;
    if (!out) throw new Error("LLM returned no structured output");
    return {
      constraints: out.constraints.map((c) => ({
        kind: c.kind,
        strength: c.strength,
        params: decode(c.params_json) ?? {},
        label: c.label,
        sourceText: c.source_text,
      })),
      needsClarification: out.needs_clarification,
      clarifications: out.clarifications.map((c) => ({
        sourceText: c.source_text,
        question: c.question,
        options: c.options.map((o) => ({ label: o.label, constraint: decode(o.constraint_json) })),
      })),
      unparsed: out.unparsed,
    };
  }
}
