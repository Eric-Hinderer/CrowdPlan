import "server-only";

// Interpretation provider abstraction. The LLM may only EXTRACT structure
// (intent, dimensions, constraints, preferences, ambiguity, clarification
// questions). It never ranks candidates or writes decision explanations.
// Every LLM result is validated against the same schemas as the
// deterministic parser; anything invalid falls back to the parser.
import { parseParticipantStatement, parsePlanStatement } from "@/domain/interpretation/parser";
import {
  constraintExtractionSchema,
  planExtractionSchema,
  type ConstraintExtraction,
  type InterpretationContext,
  type PlanExtraction,
} from "@/domain/interpretation/schema";
import { AnthropicInterpreter } from "./anthropic";

export interface InterpretationProvider {
  readonly name: "anthropic";
  interpretPlan(text: string, ctx: InterpretationContext): Promise<unknown>;
  interpretParticipant(text: string, ctx: InterpretationContext): Promise<unknown>;
}

export interface InterpretResult<T> {
  result: T;
  provider: "anthropic" | "deterministic";
  /** Why the LLM result was not used, if it was attempted. */
  fallbackReason?: string;
}

let cached: InterpretationProvider | null | undefined;

export function interpretationProvider(): InterpretationProvider | null {
  if (cached !== undefined) return cached;
  cached = process.env.ANTHROPIC_API_KEY ? new AnthropicInterpreter(process.env.ANTHROPIC_MODEL || "claude-opus-5") : null;
  return cached;
}

export function interpretationProviderName(): "anthropic" | "deterministic" {
  return interpretationProvider() ? "anthropic" : "deterministic";
}

export async function interpretPlan(text: string, ctx: InterpretationContext): Promise<InterpretResult<PlanExtraction>> {
  const provider = interpretationProvider();
  if (provider) {
    try {
      const raw = await provider.interpretPlan(text, ctx);
      const parsed = planExtractionSchema.safeParse(raw);
      if (parsed.success) return { result: parsed.data, provider: "anthropic" };
      return { result: parsePlanStatement(text, ctx), provider: "deterministic", fallbackReason: "LLM output failed schema validation" };
    } catch (e) {
      return { result: parsePlanStatement(text, ctx), provider: "deterministic", fallbackReason: e instanceof Error ? e.message : "LLM unavailable" };
    }
  }
  return { result: parsePlanStatement(text, ctx), provider: "deterministic" };
}

export async function interpretParticipant(text: string, ctx: InterpretationContext): Promise<InterpretResult<ConstraintExtraction>> {
  const provider = interpretationProvider();
  const fallback = parseParticipantStatement(text, ctx);
  if (provider) {
    try {
      const raw = await provider.interpretParticipant(text, ctx);
      const parsed = constraintExtractionSchema.safeParse(raw);
      if (parsed.success) {
        // Safety net: if the deterministic parser sees ambiguity the LLM missed,
        // keep the clarification rather than trusting a guessed hard rule.
        if (fallback.needsClarification && !parsed.data.needsClarification) {
          return { result: fallback, provider: "deterministic", fallbackReason: "Ambiguity detected; clarification required" };
        }
        return { result: parsed.data, provider: "anthropic" };
      }
      return { result: fallback, provider: "deterministic", fallbackReason: "LLM output failed schema validation" };
    } catch (e) {
      return { result: fallback, provider: "deterministic", fallbackReason: e instanceof Error ? e.message : "LLM unavailable" };
    }
  }
  return { result: fallback, provider: "deterministic" };
}
