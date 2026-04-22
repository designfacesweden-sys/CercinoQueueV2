/** Gate session cookie — httpOnly; value is signed on the server only. */

export const GATE_COOKIE_NAME = "cq_gate";

const MAX_TOKEN_LEN = 4096;

function base64UrlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createGateToken(sessionSecret: string, maxAgeSec: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const n = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload = JSON.stringify({ exp, n });
  const payloadB64 = base64UrlEncode(payload);
  const sig = await hmacSha256Hex(sessionSecret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyGateToken(token: string, sessionSecret: string): Promise<boolean> {
  if (!token || token.length > MAX_TOKEN_LEN) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0 || i === token.length - 1) return false;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expectedSig = await hmacSha256Hex(sessionSecret, payloadB64);
  if (!timingSafeEqualHex(sig.toLowerCase(), expectedSig.toLowerCase())) return false;

  const raw = base64UrlDecode(payloadB64);
  if (!raw) return false;
  let parsed: { exp?: number };
  try {
    parsed = JSON.parse(raw) as { exp?: number };
  } catch {
    return false;
  }
  if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return false;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}
