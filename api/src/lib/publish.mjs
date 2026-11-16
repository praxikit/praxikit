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
      body: JSON.stringify({ ref: "main", inputs: { submission_id: String(s.id), url: s.repo_url, name: s.final_name, kind: s.final_kind, source: s.source, why: s.final_text, decided_by: s.decided_by, note: s.final_pick ? String(s.final_note ?? "") : "", // a non-empty note means a pick
        tags: String(s.final_tags ?? ""),
        // a listing approved after reading the checks is pinned to the commit they ran on; with no commit (a direct publish, where nobody read them) the workflow requires a clean result
        expected_commit: /^[0-9a-f]{12}$/.test(String(s.scan_commit ?? "")) ? s.scan_commit : "" } }),
    });
  } catch { throw new UserError("GitHub could not be reached, so the publish job did not start."); }
  if (r.status !== 204) throw new UserError(r.status === 401 || r.status === 403 || r.status === 404 ? "GitHub refused to start the publish job. The app's token may be missing, expired or lacking the Actions permission." : "GitHub could not start the publish job.");
}

async function dispatchWorkflow(env, file, inputs) {
  if (!publishingConfigured(env)) throw new UserError("Publishing is not connected yet: the app has no token to start the job.");
  let r;
  try { r = await fetch(`${API}/repos/${env.REPO}/actions/workflows/${file}/dispatches`, { method: "POST", headers: hdr(env.GITHUB_DISPATCH_TOKEN), body: JSON.stringify({ ref: "main", inputs }) }); } catch { throw new UserError("GitHub could not be reached, so the job did not start."); }
  if (r.status !== 204) throw new UserError("GitHub refused to start the job. The app's token may be missing, expired or lacking the Actions permission.");
}
/** Changes the wording of a live listing (the workflow never touches what was reviewed). */
export const dispatchEdit = (env, e) => dispatchWorkflow(env, "edit-listing.yml", { url: e.url, name: e.name, why: e.why, tags: e.tags, note: e.note, decided_by: e.by });
/** Takes a live listing down and records it in the public log. */
export const dispatchRemove = (env, e) => dispatchWorkflow(env, "remove-listing.yml", { url: e.url, reason: e.reason, note: e.note });

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

// ---- the full checks, run before a decision

const SCAN_WORKFLOW = "scan-submission.yml";
const JOB = /^result (no-flags-found|checks-flagged|checks-failed|needs-manual-review) ([0-9a-f]{12}|none)$/;

/** Starts the read-only scan for one submission. Throws UserError if GitHub refuses. */
export async function dispatchScan(env, s) {
  if (!publishingConfigured(env)) throw new UserError("Checks are not connected yet: the app has no token to start the check job.");
  let r;
  try { r = await fetch(`${API}/repos/${env.REPO}/actions/workflows/${SCAN_WORKFLOW}/dispatches`, { method: "POST", headers: hdr(env.GITHUB_DISPATCH_TOKEN), body: JSON.stringify({ ref: "main", inputs: { submission_id: String(s.id), url: s.repo_url } }) }); }
  catch { throw new UserError("GitHub could not be reached, so the check job did not start."); }
  if (r.status !== 204) throw new UserError("GitHub could not start the check job. The app's token may be missing, expired or lacking the Actions permission.");
}

/** Latest scan run per submission number: Map(id -> { runId, status, conclusion, created, url }). */
export async function scanRuns(env) {
  const out = new Map();
  try {
    const r = await fetch(`${API}/repos/${env.REPO}/actions/workflows/${SCAN_WORKFLOW}/runs?event=workflow_dispatch&per_page=30`, { headers: hdr(env.GITHUB_DISPATCH_TOKEN) });
    if (!r.ok) return out;
    for (const run of ((await r.json()).workflow_runs ?? []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
      const m = /^scan #(\d{1,9})$/.exec(String(run.display_title ?? run.name ?? ""));
      if (m && Number.isInteger(run.id)) out.set(Number(m[1]), { runId: run.id, status: String(run.status ?? ""), conclusion: String(run.conclusion ?? ""), created: String(run.created_at ?? ""), url: `https://github.com/${env.REPO}/actions/runs/${run.id}` });
    }
  } catch { /* unreadable: the state stays "running" and is checked again next time */ }
  return out;
}

/** The result job's name carries the outcome: "result <label> <12-character commit>". */
export async function scanResult(env, runId) {
  try {
    const r = await fetch(`${API}/repos/${env.REPO}/actions/runs/${runId}/jobs?per_page=10`, { headers: hdr(env.GITHUB_DISPATCH_TOKEN) });
    if (!r.ok) return null;
    for (const j of (await r.json()).jobs ?? []) { const m = JOB.exec(String(j.name ?? "")); if (m) return { label: m[1], commit: m[2] === "none" ? "" : m[2] }; }
  } catch { /* fall through */ }
  return null;
}

/** Moves running scans forward. Returns the number of rows changed. */
export async function syncScans(env, store) {
  const rows = await store.scanning();
  if (!rows.length || !publishingConfigured(env)) return 0;
  const runs = await scanRuns(env);
  let changed = 0;
  for (const s of rows) {
    const run = runs.get(s.id);
    // only a run that started after this scan was requested counts (an older run for the same submission must not answer for it)
    const mine = run && Date.parse(run.created) >= Date.parse(s.scan_at) - 60_000;
    if (!mine) { if (Date.now() - Date.parse(s.scan_at) > 15 * 60_000) { await store.setScan(s.id, { state: "failed", at: s.scan_at }); changed++; } continue; }
    if (run.status !== "completed") continue;
    const res = run.conclusion === "success" ? await scanResult(env, run.runId) : null;
    await store.setScan(s.id, res ? { state: "done", label: res.label, commit: res.commit, runUrl: run.url, at: s.scan_at } : { state: "failed", runUrl: run.url, at: s.scan_at });
    changed++;
  }
  return changed;
}
