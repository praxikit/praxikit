/**
 * Publishing goes through GitHub Actions: this app only asks GitHub to start the approve-submission
 * workflow, and later reads whether that run finished. The token used here (GITHUB_DISPATCH_TOKEN)
 * should be a fine-grained token with only "Actions: read and write" on the catalogue repository. It
 * cannot edit files; the workflow does that, after scanning the repository again.
 */
import { UserError } from "./repo.mjs";

const API = "https://api.github.com";
const UA = "praxikit-admin";
const WORKFLOW = "approve-submission.yml";
const hdr = (token) => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

export const publishingConfigured = (env) => !!env.GITHUB_DISPATCH_TOKEN && !String(env.GITHUB_DISPATCH_TOKEN).startsWith("REPLACE");

/** Starts the approve-submission workflow for one submission. Throws UserError if GitHub refuses. */
export async function dispatchApprove(env, s) {
  if (!publishingConfigured(env)) throw new UserError("Publishing is not connected yet: the app has no token to start the publish job.");
  let r;
  try {
    r = await fetch(`${API}/repos/${env.REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST", headers: hdr(env.GITHUB_DISPATCH_TOKEN),
      body: JSON.stringify({ ref: "main", inputs: { submission_id: String(s.id), url: s.repo_url, name: s.final_name, kind: s.final_kind, source: s.source, author: s.owner, why: s.final_text, decided_by: s.decided_by } }),
    });
  } catch { throw new UserError("GitHub could not be reached, so the publish job did not start."); }
  if (r.status !== 204) throw new UserError(r.status === 401 || r.status === 403 || r.status === 404 ? "GitHub refused to start the publish job. The app's token may be missing, expired or lacking the Actions permission." : "GitHub could not start the publish job.");
}

/** Latest approve-submission run per submission number: Map(id -> { status, conclusion, url }). Empty if unreadable. */
export async function runStates(env) {
  const out = new Map();
  if (!publishingConfigured(env)) return out;
  try {
    const r = await fetch(`${API}/repos/${env.REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`, { headers: hdr(env.GITHUB_DISPATCH_TOKEN) });
    if (!r.ok) return out;
    const runs = (await r.json()).workflow_runs ?? [];
    for (const run of runs.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
      const m = /^approve #(\d{1,9})$/.exec(String(run.display_title ?? run.name ?? ""));
      if (!m) continue;
      const url = Number.isInteger(run.id) ? `https://github.com/${env.REPO}/actions/runs/${run.id}` : "";
      out.set(Number(m[1]), { status: String(run.status ?? ""), conclusion: String(run.conclusion ?? ""), url });
    }
  } catch { /* leave the map as it is: the state stays "dispatched" and is checked again next time */ }
  return out;
}

/**
 * Moves in-flight submissions forward using the run results. `listed(key)` says whether the
 * repository is now in the live catalogue. Returns the number of rows changed.
 */
export async function syncPublishing(env, store, listed) {
  const rows = await store.inFlight();
  if (!rows.length) return 0;
  const runs = await runStates(env);
  let changed = 0;
  for (const s of rows) {
    if (s.publish_state === "dispatching") {
      // the app asked GitHub to start but never recorded that it did; give it a minute, then call it blocked
      if (Date.now() - Date.parse(s.decided_at) > 60_000) { await store.setPublish(s.id, "blocked", "The publish job was never started. Try again."); changed++; }
      continue;
    }
    const run = runs.get(s.id);
    if (!run) { if (Date.now() - Date.parse(s.decided_at) > 15 * 60_000) { await store.setPublish(s.id, "blocked", "The publish job did not start. Try again."); changed++; } continue; }
    if (run.status !== "completed") continue;
    if (run.conclusion === "success" && (await listed(s.repo_key))) { await store.setPublish(s.id, "listed", run.url); changed++; }
    else if (run.conclusion === "success") continue; // finished, but the live list has not caught up yet
    else { await store.setPublish(s.id, "blocked", `The publish job stopped, most often because the automatic scan failed. Details: ${run.url}`); changed++; }
  }
  return changed;
}
