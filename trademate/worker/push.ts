/** Web Push via VAPID with empty payloads — the service worker fetches
 *  /api/push/latest to compose the notification, so no RFC8291 encryption needed. */
import type { Env } from "./context";

const VAPID_SUBJECT = "mailto:abemtadele9@gmail.com";

function b64u(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidJwt(env: Env, audience: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.VAPID_PRIVATE_JWK ?? "{}"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput),
  );
  return `${signingInput}.${b64u(sig)}`;
}

async function sendTo(env: Env, endpoint: string): Promise<void> {
  const jwt = await vapidJwt(env, new URL(endpoint).origin);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "300",
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  });
  if (res.status === 404 || res.status === 410) {
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .bind(endpoint)
      .run();
  }
}

export interface PushNote {
  title: string;
  body: string;
  url?: string;
}

/** Store the note (SW reads it back) and ping every subscribed device. */
export async function pushAll(env: Env, note: PushNote): Promise<number> {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return 0;
  await env.DB.prepare(
    "INSERT INTO briefings (key, kind, json) VALUES ('push-latest', 'push', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, created_at = datetime('now')",
  )
    .bind(JSON.stringify({ ...note, at: new Date().toISOString() }))
    .run();
  const { results } = await env.DB.prepare(
    "SELECT endpoint FROM push_subscriptions",
  ).all<{ endpoint: string }>();
  if (results.length === 0) return 0;
  await Promise.allSettled(results.map((r) => sendTo(env, r.endpoint)));
  return results.length;
}
