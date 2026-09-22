import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { config } from "./config";

let client: OpenAI | null = null;

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env at the project root.");
  }
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

/** gpt-5 / o-series models take `reasoning_effort` and reject `temperature`. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-9])/i.test(model);
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * gpt-5 / gpt-5-mini accept "minimal" but not "none"; gpt-5.4 and later accept
 * "none" but not "minimal". Map between them so .env can name either family.
 */
export function normalizeReasoning(model: string, effort: ReasoningEffort): ReasoningEffort {
  const m = /^gpt-5\.(\d+)/i.exec(model);
  const newFamily = m ? Number(m[1]) >= 4 : false;
  if (newFamily && effort === "minimal") return "none";
  if (!newFamily && effort === "none") return "minimal";
  if (!newFamily && effort === "xhigh") return "high";
  return effort;
}

export interface JsonCompletionOptions<T> {
  model?: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  reasoning?: ReasoningEffort;
  maxTokens?: number;
  validate?: (raw: unknown) => T;
}

/**
 * Structured-output chat completion. Retries once when the model returns
 * something that is not valid JSON for the schema.
 */
export async function jsonCompletion<T>(opts: JsonCompletionOptions<T>): Promise<T> {
  const openai = getOpenAI();
  const model = opts.model ?? config.models.extract;

  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
    max_completion_tokens: opts.maxTokens ?? 4000,
  };
  if (isReasoningModel(model)) {
    params.reasoning_effort = normalizeReasoning(model, opts.reasoning ?? "minimal");
    params.verbosity = "low";
  } else {
    params.temperature = 0.2;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await openai.chat.completions.create(params);
      const choice = res.choices[0];
      const refusal = choice?.message?.refusal;
      if (refusal) throw new Error(`Model refused: ${refusal}`);
      const content = choice?.message?.content;
      if (!content) throw new Error(`Empty completion (finish_reason=${choice?.finish_reason ?? "?"})`);
      const parsed = JSON.parse(content) as unknown;
      return opts.validate ? opts.validate(parsed) : (parsed as T);
    } catch (err) {
      lastError = err;
      if (attempt === 0) continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
