/**
 * Signed, expiring session tokens and cookie helpers. No dependencies: Web Crypto only, so the
 * same code runs on Cloudflare Workers and in Node's tests.
 *
 * A token is base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload)). It is stateless: the
 * server stores nothing, and a token is only as good as its signature and its expiry.
 */
const enc = new TextEncoder();

export const b64u = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
export const fromB64u = (s) => Uint8Array.from(atob(String(s).replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const key = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signToken(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

/** Returns the payload, or null for anything that is not a valid, unexpired token we signed. */
export async function verifyToken(token, secret, now = Date.now()) {
  try {
    const [body, sig, extra] = String(token ?? "").split(".");
    if (!body || !sig || extra !== undefined) return null;
    // subtle.verify compares in constant time
    if (!(await crypto.subtle.verify("HMAC", await key(secret), fromB64u(sig), enc.encode(body)))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!payload || typeof payload !== "object" || typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch { return null; }
}

/** A random, unguessable value (OAuth state). */
export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

/** Constant-time string comparison (both are hashed first, so length does not leak either). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(String(a))), crypto.subtle.digest("SHA-256", enc.encode(String(b)))]);
  const ax = new Uint8Array(x), by = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < ax.length; i++) d |= ax[i] ^ by[i];
  return d === 0 && String(a).length === String(b).length;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

/** Cookies are always HttpOnly, Secure and SameSite=Lax unless a caller says otherwise. */
export function cookie(name, value, { maxAge, path = "/", sameSite = "Lax" } = {}) {
  return [`${name}=${value}`, `Path=${path}`, "HttpOnly", "Secure", `SameSite=${sameSite}`, ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`])].join("; ");
}
