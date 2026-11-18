/* A development aid, not shipped: checks how pages are laid out at several widths.
 *
 * Paste it into the console (or a preview's eval) of a page served from the same origin as the site, then:
 *   await window.layoutAudit(["/", "/kits/"], [1360, 768, 390])    -> JSON: a list of findings per page and width
 * It loads each page in a hidden iframe and reports, for the visible page:
 *   overflow     the page scrolls sideways, or an element reaches past the right edge (unless it sits inside its own scroller)
 *   gutter       text or controls closer than 12px to the left or right edge
 *   tight        two controls on the same row with less than 8px between them
 *   small        a button, field or icon control smaller than 32px in either direction (44px is the aim on touch)
 *   clipped      text cut off by its box (not a deliberate line clamp)
 *   tiny         text under 12.5px
 * Empty lists are what you want. Each finding names the element by tag and classes and says by how much.
 */
window.layoutAudit = async function (paths, widths) {
  const out = {};
  const label = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + (e.id ? "#" + e.id : "")).slice(0, 44) + (e.textContent && e.children.length < 2 ? ' "' + e.textContent.trim().slice(0, 18) + '"' : "");
  for (const w of widths) for (const p of paths) {
    const f = document.createElement("iframe");
    f.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:900px;border:0`;
    document.body.appendChild(f);
    await new Promise((res) => { f.onload = res; f.src = p; });
    try { await f.contentWindow.document.fonts.ready; } catch (e) { /* no fonts api */ }
    await new Promise((r) => setTimeout(r, 150));
    const d = f.contentDocument, win = f.contentWindow, vw = d.documentElement.clientWidth, found = [];
    const add = (kind, e, note) => { if (found.length < 40) found.push(kind + ": " + label(e) + (note ? " (" + note + ")" : "")); };
    if (d.documentElement.scrollWidth > vw + 1) found.push("overflow: the page scrolls sideways by " + (d.documentElement.scrollWidth - vw) + "px");
    const visible = [...d.body.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(), c = win.getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none" && !e.closest("[hidden]") && !e.closest(".keys") && !e.closest(".vh"); });
    const inScroller = (e) => { for (let a = e.parentElement; a && a !== d.body; a = a.parentElement) { const o = win.getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    for (const e of visible) {
      const r = e.getBoundingClientRect(), c = win.getComputedStyle(e);
      if (!inScroller(e) && r.right > vw + 1 && !e.matches("svg *, .cover *, .stack *, .stack")) add("overflow", e, "ends " + Math.round(r.right - vw) + "px past the edge");
      const text = e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const control = e.matches("button, input, select, textarea, summary, .btn, .icon-act, .save-btn, .chip-link, .tag, a.cover");
      if ((text || control) && !e.closest("header.top, footer") && !inScroller(e) && !e.matches(".cover, .cover *, .stack *, .shelf *, .vh") && (r.left < 12 || r.right > vw - 12) && r.width < vw - 24) add("gutter", e, Math.round(r.left) + "px from the left, " + Math.round(vw - r.right) + "px from the right");
      const lab = e.matches("input[type=checkbox], input[type=radio]") ? e.closest("label") : null, labelOk = lab && lab.getBoundingClientRect().height >= 32; // a checkbox is hit through its label
      if (control && !labelOk && !e.matches(".tag, a.cover, .skip") && (r.height < 32 || r.width < 32) && c.display !== "inline") add("small", e, Math.round(r.width) + "×" + Math.round(r.height) + "px");
      if (text && parseFloat(c.fontSize) < 12.5 && !e.closest("svg")) add("tiny", e, c.fontSize);
      if (text && (c.overflowX === "hidden" || c.overflow === "hidden") && e.scrollWidth > e.clientWidth + 1 && !c.webkitLineClamp && !/ellipsis/.test(c.textOverflow) && c.display !== "inline") add("clipped", e, e.scrollWidth - e.clientWidth + "px cut off");
    }
    // controls on one row that touch
    const ctrls = visible.filter((e) => e.matches("button, a.btn, .btn, input:not([type=hidden]), select, .save-btn, .icon-act") && !e.closest(".cover, .keys"));
    for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
      const a = ctrls[i].getBoundingClientRect(), b = ctrls[j].getBoundingClientRect();
      if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
      const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.5;
      const gap = Math.max(b.left - a.right, a.left - b.right);
      if (sameRow && gap >= -1 && gap < 6 && !ctrls[i].matches(".seg button, .seg *, .card-tools *") && ctrls[i].parentElement === ctrls[j].parentElement) add("tight", ctrls[j], "only " + Math.round(gap) + "px from " + label(ctrls[i]));
    }
    out[w + " " + p] = [...new Set(found)];
    f.remove();
  }
  return JSON.stringify(out);
};
