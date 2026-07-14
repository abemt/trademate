import { api } from "./api";

export type PushState = "unsupported" | "denied" | "ready" | "subscribed";

function urlB64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    return "denied";
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return "unsupported"; // dev mode — SW only exists in the built app
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "ready";
  } catch {
    return "unsupported";
  }
}

export async function subscribePush(): Promise<boolean> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const { key } = await api<{ key: string | null }>("/push/key");
  if (!key) return false;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(key).buffer as ArrayBuffer,
  });
  await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return true;
}

export async function sendTestPush(): Promise<void> {
  await api("/push/test", { method: "POST" });
}
