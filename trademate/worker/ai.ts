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

// Preferred names, not hard requirements: each provider's live model list is consulted and any
// candidate that 404s is skipped, so a rename upstream degrades to the next model instead of
// killing the chain (gemini-3.6-flash-lite never existed; Groq retired llama-3.3 / llama-4-scout).
const GEMINI_MODEL = "gemini-3.6-flash";
// Lite has its own (larger) free-tier quota bucket — text goes there first, vision prefers flash.
const GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"];
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
const GROQ_TEXT_PREFERENCE = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "moonshotai/kimi-k2-instruct"];
const GROQ_VISION_PATTERN = /qwen.*(3\.6|vl)|llama-4|scout|maverick/i;
// GitHub Models free tier — OpenAI-compatible, tight daily rate limits, fine as last resort.
const GITHUB_MODEL = "openai/gpt-4.1";

const MODEL_LIST_TTL_MS = 60 * 60 * 1000;
const modelLists = new Map<string, { at: number; models: string[] }>();

/** Test hook: forget discovered model lists. */
export function resetModelCache(): void {
  modelLists.clear();
}

async function rememberedList(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const hit = modelLists.get(key);
  if (hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) return hit.models;
  try {
    const models = await load();
    if (models.length) modelLists.set(key, { at: Date.now(), models });
    return models;
  } catch {
    return hit?.models ?? [];
  }
}

const GEMINI_FLASH = /^gemini-(\d+)(?:\.(\d+))?-flash(-lite)?$/;

function geminiVersion(name: string): number {
  const match = GEMINI_FLASH.exec(name);
  return match ? Number(match[1]) + Number(match[2] ?? 0) / 100 : 0;
}

/** Flash-family models the key can actually call, ordered: pinned first, then lite/full preference, newest first. */
export async function geminiCandidates(key: string, hasImages: boolean): Promise<string[]> {
  const listed = await rememberedList(`gemini:${key.slice(-6)}`, async () => {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((name) => GEMINI_FLASH.test(name));
  });
  const pool = listed.length ? listed : GEMINI_FALLBACK;
  const lite = pool.filter((name) => name.endsWith("-lite")).sort((a, b) => geminiVersion(b) - geminiVersion(a));
  const full = pool.filter((name) => !name.endsWith("-lite")).sort((a, b) => geminiVersion(b) - geminiVersion(a));
  const pin = (names: string[], pinned: string) => (names.includes(pinned) ? [pinned, ...names.filter((n) => n !== pinned)] : names);
  const ordered = hasImages
    ? [...pin(full, GEMINI_MODEL), ...pin(lite, GEMINI_LITE_MODEL)]
    : [...pin(lite, GEMINI_LITE_MODEL), ...pin(full, GEMINI_MODEL)];
  return ordered.slice(0, 4);
}

/** Groq chat models the key can call, pinned first, then the preference list, then anything vision-shaped for images. */
export async function groqCandidates(key: string, hasImages: boolean): Promise<string[]> {
  const listed = await rememberedList(`groq:${key.slice(-6)}`, async () => {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { id: string; active?: boolean }[] };
    return (data.data ?? [])
      .filter((m) => m.active !== false && !/whisper|tts|guard|embed|allam|orpheus|playai/i.test(m.id))
      .map((m) => m.id);
  });
  if (!listed.length) return [hasImages ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL];
  if (hasImages) {
    const vision = listed.filter((id) => GROQ_VISION_PATTERN.test(id));
    return [GROQ_VISION_MODEL, ...vision.filter((id) => id !== GROQ_VISION_MODEL)].filter((id) => listed.includes(id) || id === GROQ_VISION_MODEL).slice(0, 3);
  }
  const preferred = GROQ_TEXT_PREFERENCE.filter((id) => listed.includes(id));
  const rest = listed.filter((id) => !preferred.includes(id));
  return [...preferred, ...rest].slice(0, 3);
}

export async function callAI(env: AIEnv, messages: AIMessage[], opts: AIOptions = {}): Promise<string> {
  const errors: string[] = [];
  const hasImages = messages.some((m) => m.images && m.images.length > 0);
  if (env.GEMINI_API_KEY) {
    for (const model of await geminiCandidates(env.GEMINI_API_KEY, hasImages)) {
      try {
        return await callGemini(env.GEMINI_API_KEY, messages, opts, model);
      } catch (e) {
        errors.push(`gemini/${model}: ${String(e).slice(0, 160)}`);
        if (/HTTP 404/.test(String(e))) modelLists.delete(`gemini:${env.GEMINI_API_KEY.slice(-6)}`);
      }
    }
  } else errors.push("gemini: no key configured");
  if (env.GROQ_API_KEY) {
    for (const model of await groqCandidates(env.GROQ_API_KEY, hasImages)) {
      try {
        return await callGroq(env.GROQ_API_KEY, messages, opts, model);
      } catch (e) {
        errors.push(`groq/${model}: ${String(e).slice(0, 200)}`);
        if (/HTTP 404|decommissioned|does not exist/i.test(String(e))) modelLists.delete(`groq:${env.GROQ_API_KEY.slice(-6)}`);
      }
    }
  } else errors.push("groq: no key configured");
  if (env.GITHUB_MODELS_TOKEN) {
    try {
      return await callGithubModels(env.GITHUB_MODELS_TOKEN, messages, opts);
    } catch (e) {
      errors.push(`github/${GITHUB_MODEL}: ${String(e).slice(0, 200)}`);
    }
  } else errors.push("github: no token configured");
  throw new Error(`every AI provider failed — ${errors.join(" | ")}`);
}

/** Which provider answers right now, for the /ai/health diagnostic. */
export async function probeAI(env: AIEnv): Promise<{ ok: boolean; answered_by?: string; gemini: string[]; groq: string[]; github: boolean; error?: string }> {
  const gemini = env.GEMINI_API_KEY ? await geminiCandidates(env.GEMINI_API_KEY, false) : [];
  const groq = env.GROQ_API_KEY ? await groqCandidates(env.GROQ_API_KEY, false) : [];
  const attempts: { label: string; run: () => Promise<string> }[] = [];
  const ping: AIMessage[] = [{ role: "user", text: "Reply with the single word OK." }];
  for (const model of gemini) attempts.push({ label: `gemini/${model}`, run: () => callGemini(env.GEMINI_API_KEY!, ping, { maxTokens: 8 }, model) });
  for (const model of groq) attempts.push({ label: `groq/${model}`, run: () => callGroq(env.GROQ_API_KEY!, ping, { maxTokens: 8 }, model) });
  if (env.GITHUB_MODELS_TOKEN) attempts.push({ label: `github/${GITHUB_MODEL}`, run: () => callGithubModels(env.GITHUB_MODELS_TOKEN!, ping, { maxTokens: 8 }) });
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      await attempt.run();
      return { ok: true, answered_by: attempt.label, gemini, groq, github: Boolean(env.GITHUB_MODELS_TOKEN) };
    } catch (e) {
      failures.push(`${attempt.label}: ${String(e).slice(0, 120)}`);
    }
  }
  return { ok: false, gemini, groq, github: Boolean(env.GITHUB_MODELS_TOKEN), error: failures.join(" | ") || "no provider configured" };
}

async function callGemini(
  key: string,
  messages: AIMessage[],
  opts: AIOptions,
  model: string = GEMINI_MODEL,
): Promise<string> {
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
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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

async function callGroq(key: string, messages: AIMessage[], opts: AIOptions, model: string): Promise<string> {
  const body = {
    model,
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
- Enforce HIS CURRENT CONTRACT exactly as given in the context — the numbers there are live from his profile and override anything from earlier conversations. Judge "today" ONLY from the TODAY section of the context; never count older trades against today. If a plan violates a rule, refuse to bless it, name the exact rule, and offer the compliant alternative. If today was clean, say so plainly — a rule-compliant day is a WIN regardless of P&L.
- His body data is signal: if his recent entries show body 4-5 or urge 4-5, or his message sounds urgent/angry/desperate, address the state BEFORE the setup. High urge = no trade, per his own contract.
- Market regime is currently CHOPPY: zones get tested multiple times before the real move; first-touch entries without confirmation are lower quality. Factor this into every setup opinion.
- If he shows signs of revenge trading, overtrading, or FOMO (check his recent trades), address it directly before anything else.`;
