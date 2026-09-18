import assert from "node:assert/strict";
import test from "node:test";
import { callAI, geminiCandidates, groqCandidates, resetModelCache } from "../worker/ai";

const geminiList = {
  models: [
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] },
  ],
};
const groqList = { data: [
  { id: "llama-3.1-8b-instant", active: true }, { id: "openai/gpt-oss-20b", active: true },
  { id: "whisper-large-v3", active: true }, { id: "openai/gpt-oss-120b", active: false }, { id: "meta-llama/llama-4-scout-17b", active: true },
] };

function stubFetch(handler: (url: string, body: string) => Response | null) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const out = handler(url, typeof init?.body === "string" ? init.body : "");
    if (out) return out;
    return new Response("unexpected call " + url, { status: 599 });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test("Gemini candidates come from the live model list: lite first for text, pinned flash first for vision, nothing that is not a flash chat model", async () => {
  resetModelCache();
  const restore = stubFetch((url) => (url.includes("/v1beta/models?") ? Response.json(geminiList) : null));
  try {
    assert.deepEqual(await geminiCandidates("k-text", false), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"]);
    assert.deepEqual(await geminiCandidates("k-text", true), ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  } finally { restore(); }
});

test("Groq candidates skip inactive and non-chat models and keep the preference order", async () => {
  resetModelCache();
  const restore = stubFetch((url) => (url.includes("/openai/v1/models") ? Response.json(groqList) : null));
  try {
    assert.deepEqual(await groqCandidates("g-key", false), ["openai/gpt-oss-20b", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b"]);
    assert.deepEqual(await groqCandidates("g-key", true), ["qwen/qwen3.6-27b", "meta-llama/llama-4-scout-17b"]);
  } finally { restore(); }
});

test("the chain walks past a renamed Gemini model and a retired Groq model, and reports every failure when all die", async () => {
  resetModelCache();
  const calls: string[] = [];
  const restore = stubFetch((url, body) => {
    if (url.includes("/v1beta/models?")) return Response.json(geminiList);
    if (url.includes(":generateContent")) {
      const model = /models\/([^:]+):/.exec(url)![1];
      calls.push(`gemini/${model}`);
      if (model === "gemini-3.5-flash-lite") return new Response(JSON.stringify({ error: { code: 404, message: "not found" } }), { status: 404 });
      if (model === "gemini-3.1-flash-lite") return new Response("quota", { status: 429 });
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `hello from ${model}` }] } }] });
    }
    if (url.includes("/openai/v1/models")) return Response.json(groqList);
    if (url.includes("/chat/completions")) {
      const model = (JSON.parse(body) as { model: string }).model;
      calls.push(`groq/${model}`);
      if (model === "openai/gpt-oss-20b") return new Response("model decommissioned", { status: 404 });
      return Response.json({ choices: [{ message: { content: `groq ${model}` } }] });
    }
    return null;
  });
  try {
    const reply = await callAI({ GEMINI_API_KEY: "k1", GROQ_API_KEY: "g1" }, [{ role: "user", text: "hi" }]);
    assert.equal(reply, "hello from gemini-3.6-flash");
    assert.deepEqual(calls, ["gemini/gemini-3.5-flash-lite", "gemini/gemini-3.1-flash-lite", "gemini/gemini-3.6-flash"]);
    calls.length = 0;
    const viaGroq = await callAI({ GROQ_API_KEY: "g1" }, [{ role: "user", text: "hi" }]);
    assert.equal(viaGroq, "groq llama-3.1-8b-instant");
    assert.deepEqual(calls, ["groq/openai/gpt-oss-20b", "groq/llama-3.1-8b-instant"]);
  } finally { restore(); }

  resetModelCache();
  const restoreDead = stubFetch((url) => {
    if (url.includes("/v1beta/models?") || url.includes("/openai/v1/models")) return new Response("down", { status: 503 });
    return new Response("boom", { status: 500 });
  });
  try {
    await assert.rejects(
      () => callAI({ GEMINI_API_KEY: "k2" }, [{ role: "user", text: "hi" }]),
      (error: Error) => /every AI provider failed/.test(error.message) && /gemini\/gemini-3\.5-flash-lite: .*HTTP 500/.test(error.message) && /groq: no key configured/.test(error.message) && /github: no token configured/.test(error.message),
    );
  } finally { restoreDead(); }
});
