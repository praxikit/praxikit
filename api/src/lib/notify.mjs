/**
 * A push message to the owner's phone when something waits for review. It goes through ntfy.sh to a topic that only the owner knows
 * (the Worker secret NTFY_TOPIC): anyone who learns the topic could read the messages, so they never carry private text. They say
 * what kind of thing is waiting and where to look, and use only public data (a repository name, a GitHub username).
 * If no topic is set, or ntfy is down, nothing happens and the request that caused it carries on.
 */
const TOPIC = /^[A-Za-z0-9_-]{16,64}$/;

/** Header and body text must be plain ASCII here; anything else becomes "?", and control characters are dropped. */
const ascii = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[^\x20-\x7e]/g, "?").replace(/\s+/g, " ").trim();

let ctxRef = null;
/** Called once per request by the Worker, so a slow push can finish after the page has been sent. */
export const rememberContext = (ctx) => { ctxRef = ctx ?? null; };

export function notifyOwner(env, { title, message, path = "/admin" }) {
  const topic = String(env.NTFY_TOPIC ?? "");
  if (!TOPIC.test(topic)) return Promise.resolve(false);
  const send = (async () => {
    try {
      const res = await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: ascii(title).slice(0, 80), Tags: "bell", Click: `${String(env.BASE_URL).replace(/\/+$/, "")}${path.startsWith("/") ? path : "/admin"}` },
        body: ascii(message).slice(0, 300),
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch { return false; }
  })();
  if (ctxRef?.waitUntil) { ctxRef.waitUntil(send); return Promise.resolve(true); }
  return send;
}
