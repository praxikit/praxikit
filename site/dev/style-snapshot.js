/* A development aid, not shipped: a fingerprint of how a set of pages is styled.
 *
 * Paste the whole file into the browser console (or a preview's eval) of a page served from the same origin as the site, e.g. the output of
 * `node site/build.mjs && node api/dev-render.mjs` served from site/dist. It loads each page at each width in a hidden iframe, reads 30
 * computed properties of every element, and returns a short hash per section (header, each child of main, footer). Run it before and after a
 * stylesheet change: the hashes must be identical unless the change was meant to move something, and a differing section says where to look.
 *   window.styleSnapshot(["/", "/kits/"], [1360, 390]).then(console.log)
 */
window.styleSnapshot = async function (paths, widths) {
  const PROPS = ["display", "position", "color", "backgroundColor", "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "marginTop", "marginRight", "marginBottom", "marginLeft", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderTopColor", "borderTopStyle", "borderBottomWidth", "borderRadius", "width", "height", "boxShadow", "opacity", "zIndex", "gridTemplateColumns", "flexDirection", "gap", "textAlign", "overflowX", "transform", "textDecorationLine"];
  const hash = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
  const out = {};
  for (const w of widths) for (const p of paths) {
    const f = document.createElement("iframe");
    f.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:900px;border:0`;
    document.body.appendChild(f);
    await new Promise((res) => { f.onload = res; f.src = p; });
    try { await f.contentWindow.document.fonts.ready; } catch (e) { /* no fonts api */ }
    await new Promise((r) => setTimeout(r, 120));
    const d = f.contentDocument, win = f.contentWindow, sections = {};
    const roots = [...d.querySelectorAll("body > header, body > main > *, main > *, body > footer, body > .keys")].filter((e, i, a) => a.indexOf(e) === i);
    roots.forEach((s, i) => {
      let acc = "";
      [s, ...s.querySelectorAll("*")].forEach((e) => { const c = win.getComputedStyle(e); acc += e.tagName + PROPS.map((k) => c[k]).join("|") + ";"; });
      sections[i + ":" + String(s.className || s.tagName).split(" ")[0].slice(0, 20)] = hash(acc) + "/" + acc.length;
    });
    out[w + " " + p] = sections;
    f.remove();
  }
  return JSON.stringify(out);
};

/* The page sets this tool was used with: the site (served from site/dist) and the signed-in app pages written by api/dev-render.mjs.
 *   await window.snapSave("site", [1360, 390])     take the baseline (kept in this origin's localStorage)
 *   await window.snapPart("site", [1360, 390])     compare with it: returns the sections that differ (none = no visual change)
 */
window.snapPages = {
  site: ["/", "/kits/", "/l/microsoft-playwright-mcp/", "/l/crystaldba-postgres-mcp/", "/k/keel/", "/tags/database/", "/policy/", "/submit/", "/search/?q=mcp", "/about/", "/removals/"],
  app: ["signin", "admin", "submission-flagged", "submission-unscannable", "admin-listings", "admin-notes", "admin-requests", "submit", "profile", "settings", "collection", "contributors", "requests"].map((n) => "/_app/" + n + ".html"),
};
window.snapSave = async (kind, widths) => { localStorage.setItem("snap:" + kind, await window.styleSnapshot(window.snapPages[kind], widths)); return "saved " + kind; };
window.snapPart = async (kind, widths) => {
  const now = JSON.parse(await window.styleSnapshot(window.snapPages[kind], widths)), base = JSON.parse(localStorage.getItem("snap:" + kind) || "{}"), diffs = [];
  for (const k of Object.keys(now)) for (const s of Object.keys(base[k] || {})) if (base[k][s] !== now[k][s]) diffs.push(k + " :: " + s);
  return JSON.stringify({ kind, compared: Object.keys(now).length, differing: diffs.length, diffs: diffs.slice(0, 40) });
};
