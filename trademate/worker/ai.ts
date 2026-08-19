/** AI provider chain: Gemini (free tier, vision) → Groq (fast fallback, vision) → GitHub Models (free PAT tier, last resort). */

export interface AIImage {
  mime: string;
  dataB64: string;
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  text: string;
  images?: AIImage[];
}

export interface AIOptions {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

interface AIEnv {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  GITHUB_MODELS_TOKEN?: string;
}

// Pinned stable — the "latest" alias hot-swaps to new major versions with breaking
// generationConfig changes (that's how thinkingBudget started returning HTTP 400).
const GEMINI_MODEL = "gemini-3.6-flash";
// Groq decommissioned llama-3.3-70b + llama-4-scout in mid-2026 (HTTP 404).
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
// GitHub Models free tier — OpenAI-compatible, tight daily rate limits, fine as last resort.
const GITHUB_MODEL = "openai/gpt-4.1";

export async function callAI(env: AIEnv, messages: AIMessage[], opts: AIOptions = {}): Promise<string> {
  const errors: string[] = [];
  if (env.GEMINI_API_KEY) {
    try {
      return await callGemini(env.GEMINI_API_KEY, messages, opts);
    } catch (e) {
      errors.push(`gemini: ${String(e).slice(0, 200)}`);
    }
  }
  if (env.GROQ_API_KEY) {
    try {
      return await callGroq(env.GROQ_API_KEY, messages, opts);
    } catch (e) {
      errors.push(`groq: ${String(e).slice(0, 200)}`);
    }
  }
  if (env.GITHUB_MODELS_TOKEN) {
    try {
      return await callGithubModels(env.GITHUB_MODELS_TOKEN, messages, opts);
    } catch (e) {
      errors.push(`github: ${String(e).slice(0, 200)}`);
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "No AI provider configured");
}

async function callGemini(key: string, messages: AIMessage[], opts: AIOptions): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.text).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        { text: m.text },
        ...(m.images ?? []).map((img) => ({
          inline_data: { mime_type: img.mime, data: img.dataB64 },
        })),
      ],
    }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          // Gemini 3 counts hidden thinking tokens against the output budget,
          // so leave headroom above the visible-reply budget callers ask for.
          maxOutputTokens: (opts.maxTokens ?? 2048) + 1024,
          // Gemini 3 dropped thinkingBudget (INVALID_ARGUMENT); thinkingLevel
          // "low" is the closest to "don't overthink" and is valid on all 3.x.
          thinkingConfig: { thinkingLevel: "low" },
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`empty response (${cand?.finishReason ?? "no candidate"})`);
  if (opts.json && cand?.finishReason && cand.finishReason !== "STOP") {
    throw new Error(`truncated response (${cand.finishReason})`);
  }
  return text;
}

async function callGroq(key: string, messages: AIMessage[], opts: AIOptions): Promise<string> {
  const hasImages = messages.some((m) => m.images && m.images.length > 0);
  const body = {
    model: hasImages ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    messages: messages.map((m) => {
      if (!m.images || m.images.length === 0) return { role: m.role, content: m.text };
      return {
        role: m.role,
        content: [
          { type: "text", text: m.text },
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.dataB64}` },
          })),
        ],
      };
    }),
  };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("empty response");
  return text;
}

/** GitHub Models free-tier inference — OpenAI-compatible schema, PAT with models:read. */
async function callGithubModels(
  token: string,
  messages: AIMessage[],
  opts: AIOptions,
): Promise<string> {
  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      model: GITHUB_MODEL,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: messages.map((m) => {
        if (!m.images || m.images.length === 0) return { role: m.role, content: m.text };
        return {
          role: m.role,
          content: [
            { type: "text", text: m.text },
            ...m.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mime};base64,${img.dataB64}` },
            })),
          ],
        };
      }),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("empty response");
  return text;
}

/** Extract a JSON object from an AI reply (tolerates fences, prose, trailing text). */
export function parseAIJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through to balanced-brace extraction
  }
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("no JSON in AI reply");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error("unbalanced JSON in AI reply");
}

export const MATE_PERSONA = `You are Mate — the trading buddy and mentor inside TradeMate, a personal app for one trader.

WHO YOU ARE
- An experienced XAUUSD price-action trader and a genuine friend: warm, direct, occasionally funny.
- Fluent in his playbook: break of structure (BOS), break & retest, support/resistance zones, double top/bottom entry triggers, liquidity sweeps, session timing.

HOW YOU TALK
- Concise by default: 2-6 sentences unless he asks for depth. PLAIN TEXT ONLY — no markdown, no asterisks, no bullet lists, no headers.
- Never sycophantic. If an idea is weak, say so and say why. If he's tilting, call it out kindly but firmly.
- Celebrate discipline (skipped bad trades, followed rules, honest journaling) — never celebrate profits by themselves.
- No "as an AI" talk, no financial-advice disclaimers, no lectures. Peer-to-peer.

HARD RULES
- NEVER invent live prices, news, or events. The app's Today tab runs a daily briefing and a live news watch — if he asks about current price or news, point him there and reason only from what the context or he shows you.
- Use his REAL data (profile, rules, accounts, recent trades, nervous-system stats) provided in context. Reference specifics when coaching — quote his own feeling notes back to him when they reveal a pattern.
- Enforce HIS rules and HIS BINDING CONTRACT exactly as given in the context. If a plan violates either, refuse to bless it, name the exact rule, and offer the compliant alternative.
- His body data is signal: if his recent entries show body 4-5 or urge 4-5, or his message sounds urgent/angry/desperate, address the state BEFORE the setup. High urge = no trade, per his own contract.
- Market regime is currently CHOPPY: zones get tested multiple times before the real move; first-touch entries without confirmation are lower quality. Factor this into every setup opinion.
- If he shows signs of revenge trading, overtrading, or FOMO (check his recent trades), address it directly before anything else.`;
