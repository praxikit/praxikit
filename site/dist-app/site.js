
(function () {
  var root = document.documentElement;
  // links printed by older Keel versions pointed at the home page; the checker now lives on the Updates page
  if (document.body.hasAttribute("data-home") && location.search.indexOf("kit=") > -1) { location.replace("updates/" + location.search + "#updates"); return; }
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var code = b.parentElement.querySelector("code");
      copyText(code ? code.textContent : "", function (ok) {
        b.textContent = ok ? "Copied" : "Press Ctrl+C";
        b.classList.toggle("done", ok);
        setTimeout(function () { b.textContent = "Copy"; b.classList.remove("done"); }, 1600);
      });
    });
  });
  document.querySelectorAll("[data-tabs]").forEach(function (box) {
    var tabs = [].slice.call(box.querySelectorAll("[role=tab]")), panels = [].slice.call(box.querySelectorAll("[role=tabpanel]"));
    function show(i) {
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      panels.forEach(function (p, j) { p.hidden = i !== j; });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { show(i); });
      t.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
        if (n < 0) return; n = (n + tabs.length) % tabs.length; show(n); tabs[n].focus(); e.preventDefault();
      });
    });
    box.querySelector("[role=tablist]").hidden = false;
    show(0);
  });
  document.querySelectorAll("[data-checker]").forEach(function (box) {
    var data; try { data = JSON.parse(box.getAttribute("data-checker")); } catch (e) { return; }
    var kitSel = box.querySelector("[data-ck-kit]"), verSel = box.querySelector("[data-ck-ver]"), out = box.querySelector("[data-ck-out]"), upd = box.querySelector("[data-ck-update]");
    var paste = box.querySelector("[data-ck-paste]"), pasteMsg = box.querySelector("[data-ck-pastemsg]");
    function kitName() { return kitSel ? kitSel.value : box.getAttribute("data-kit"); }
    function kit() { return data[kitName()]; }
    function line(parent, tag, text, cls) { var e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; parent.appendChild(e); return e; }
    function fill() {
      var k = kit(); verSel.textContent = "";
      line(verSel, "option", "Choose your version").value = "";
      if (!k) return;
      k.versions.forEach(function (v) { line(verSel, "option", "v" + v.v + (v.date ? " (" + v.date + ")" : "")).value = v.v; });
      line(verSel, "option", "Older, or I don't know").value = "older";
      render();
    }
    function render() {
      out.textContent = ""; upd.hidden = true;
      var k = kit(); if (!k || !verSel.value) { out.hidden = true; return; }
      out.hidden = false;
      var idx = verSel.value === "older" ? k.versions.length : k.versions.findIndex(function (v) { return v.v === verSel.value; });
      if (idx === 0) { line(out, "p", "Up to date: v" + k.versions[0].v + " is the latest.", "ck-ok"); return; }
      line(out, "p", "v" + k.versions[0].v + " is available" + (idx < k.versions.length ? ", you have v" + verSel.value + ". " + idx + (idx === 1 ? " release" : " releases") + " since:" : ". Everything since the first release:"), "ck-new");
      k.versions.slice(0, idx).forEach(function (v) {
        line(out, "h4", "v" + v.v + (v.date ? "  " + v.date : ""));
        var ul = document.createElement("ul"); v.notes.forEach(function (n) { line(ul, "li", n); }); out.appendChild(ul);
      });
      upd.hidden = false;
    }
    // "claude plugin list" prints "<name>@<marketplace>" then "Version: x.y.z"; find it without a regular expression
    function versionIn(text, name) {
      var at = text.indexOf(name + "@"); if (at < 0) return "";
      var vi = text.indexOf("Version:", at); if (vi < 0) return "";
      var rest = text.slice(vi + 8).trim(), v = "";
      for (var i = 0; i < rest.length; i++) { var c = rest.charAt(i); if ((c >= "0" && c <= "9") || c === ".") v += c; else break; }
      return v;
    }
    function fromPaste() {
      var text = paste.value; pasteMsg.textContent = "";
      if (!text.trim()) return;
      var names = Object.keys(data), hit = "", ver = "";
      // "claude plugin list --json" prints an array of { id: "name@marketplace", version, ... }
      try {
        var arr = JSON.parse(text);
        if (Array.isArray(arr)) arr.forEach(function (it) {
          if (hit || !it || typeof it.id !== "string" || typeof it.version !== "string") return;
          var nm = it.id.split("@")[0];
          if (data[nm]) { hit = nm; ver = it.version; }
        });
      } catch (e) {}
      for (var i = 0; !hit && i < names.length; i++) { var v = versionIn(text, names[i]); if (v) { hit = names[i]; ver = v; } }
      if (!hit) { pasteMsg.textContent = "Could not find a Praxikit kit in that text."; return; }
      if (kitSel) kitSel.value = hit;
      fill();
      var known = data[hit].versions.some(function (x) { return x.v === ver; });
      verSel.value = known ? ver : "older";
      pasteMsg.textContent = known ? "Found " + hit + " v" + ver + "." : "Found " + hit + " v" + ver + ", which is not in this changelog, so showing everything.";
      render();
    }
    if (kitSel) kitSel.addEventListener("change", fill);
    verSel.addEventListener("change", render);
    if (paste) paste.addEventListener("input", fromPaste);
    fill();
    // a link such as ?kit=keel&v=0.5.0 (printed by /keel:status) fills the form
    try {
      var qs = new URLSearchParams(location.search), qk = qs.get("kit"), qv = qs.get("v");
      if (qk && data[qk] && (!box.getAttribute("data-kit") || box.getAttribute("data-kit") === qk)) {
        if (kitSel) kitSel.value = qk;
        fill();
        verSel.value = qv && data[qk].versions.some(function (x) { return x.v === qv; }) ? qv : "older";
        render();
      }
    } catch (e) {}
  });
  // ---- account: only where the site and the app share one address; the page works the same without it
  var appOrigin = document.body.getAttribute("data-app") || "";
  var slot = document.getElementById("acct");
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function link(href, text) { var a = el("a", "", text); a.href = href; return a; }
  if (slot && appOrigin && location.origin === appOrigin) {
    fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (!me || typeof me.login !== "string") return;
      var nav = document.querySelector("header nav"), admin = me.role === "admin";
      if (admin && nav) { var a = link("/admin", "Admin"); a.className = "admin-tab"; if (location.pathname.indexOf("/admin") === 0) a.setAttribute("aria-current", "page"); nav.insertBefore(a, nav.firstChild); }
      var d = el("details", "menu"), sum = el("summary");
      if (Number.isInteger(me.id)) { var img = el("img"); img.src = "https://avatars.githubusercontent.com/u/" + me.id + "?s=64"; img.alt = ""; img.width = 28; img.height = 28; sum.appendChild(img); }
      sum.appendChild(el("span", "", me.login)); sum.setAttribute("aria-label", "Account menu for " + me.login);
      var list = el("div", "menu-list");
      list.appendChild(link("/profile", "Profile")); list.appendChild(link("/collection", "My collection")); list.appendChild(link("/settings", "Settings"));
      if (admin) list.appendChild(link("/admin", "Admin"));
      var f = el("form"); f.method = "post"; f.action = "/auth/logout"; var b = el("button", "", "Sign out"); b.type = "submit"; f.appendChild(b); list.appendChild(f);
      d.appendChild(sum); d.appendChild(list);
      slot.textContent = ""; slot.appendChild(d);
      document.addEventListener("click", function (e) { if (!d.contains(e.target)) d.removeAttribute("open"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") d.removeAttribute("open"); });
    }).catch(function () {});
  }

  var tgl = document.getElementById("theme");
  if (tgl) tgl.addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    tgl.setAttribute("aria-pressed", String(next === "dark"));
    try { localStorage.setItem("praxikit-theme", next); } catch (e) {}
  });
  var q = document.getElementById("q"), grid = document.getElementById("kits");
  if (q && grid) {
    var cards = [].slice.call(grid.querySelectorAll("[data-card]"));
    var chips = [].slice.call(document.querySelectorAll("[data-chip]"));
    var count = document.getElementById("count"), none = document.getElementById("none");
    var active = "all";
    function apply() {
      var term = q.value.trim().toLowerCase(), shown = 0;
      cards.forEach(function (c) {
        var okChip = active === "all" || (" " + c.getAttribute("data-groups") + " ").indexOf(" " + active + " ") > -1;
        var okText = !term || c.getAttribute("data-text").indexOf(term) > -1;
        var on = okChip && okText; c.hidden = !on; if (on) shown++;
      });
      count.textContent = shown + (shown === 1 ? " kit" : " kits");
      none.hidden = shown !== 0;
    }
    q.addEventListener("input", apply);
    chips.forEach(function (ch) {
      ch.addEventListener("click", function () {
        active = ch.getAttribute("data-chip");
        chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o === ch)); });
        apply();
      });
    });
    var clear = document.getElementById("clear");
    if (clear) clear.addEventListener("click", function () { q.value = ""; active = "all"; chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-chip") === "all")); }); apply(); q.focus(); });
    apply();
  }

  // ---- site search: a prebuilt index, matched in the browser. Results are built with textContent only.
  var root = document.body.getAttribute("data-root") || "./";
  /*search-start*/
  function searchIndex(index, query) {
    var words = String(query || "").toLowerCase().split(" ").filter(function (w) { return w.length > 0; });
    if (!words.length) return [];
    var out = [];
    index.forEach(function (e) {
      var title = String(e.t || "").toLowerCase(), tags = String(e.g || "").toLowerCase(), desc = String(e.d || "").toLowerCase(), score = 0, ok = true;
      words.forEach(function (w) {
        var s = 0;
        if (title.indexOf(w) === 0) s += 6; else if (title.indexOf(w) > -1) s += 4;
        if (tags.split(" ").indexOf(w) > -1) s += 4; else if (tags.indexOf(w) > -1) s += 2;
        if (desc.indexOf(w) > -1) s += 1;
        if (!s) ok = false;
        score += s;
      });
      if (ok) out.push({ e: e, score: score + (e.k === "pick" ? 1 : 0) });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.e.t).localeCompare(String(b.e.t)); });
    return out.map(function (x) { return x.e; });
  }
  /*search-end*/
  var KIND_NAME = { kit: "Praxikit kit", skill: "Skill or command", pick: "My pick", listed: "Listed", tag: "Tag", page: "Page" };
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch(root + "search-index.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return indexPromise;
  }
  function hrefOf(e) {
    var u = String(e.u || "");
    if (u.indexOf("https://github.com/") === 0) return u;
    if (u.indexOf("://") > -1 || u.charAt(0) === "/") return "";
    return root + u;
  }
  function renderResults(list, into, limit) {
    into.textContent = "";
    list.slice(0, limit).forEach(function (e) {
      var href = hrefOf(e); if (!href) return;
      var li = document.createElement("li"), a = document.createElement("a"), kind = document.createElement("span"), d = document.createElement("span");
      a.href = href; a.textContent = e.t; if (e.ext) a.rel = "noopener noreferrer";
      kind.className = "r-kind"; kind.textContent = KIND_NAME[e.k] || "";
      d.className = "r-desc"; d.textContent = e.d || "";
      li.appendChild(a); li.appendChild(kind); li.appendChild(d); into.appendChild(li);
    });
  }
  var box = document.getElementById("site-q");
  if (box) {
    var sug = document.createElement("ul"); sug.className = "suggest"; sug.hidden = true; sug.setAttribute("aria-label", "Search suggestions");
    box.parentNode.appendChild(sug);
    box.addEventListener("input", function () {
      var term = box.value.trim();
      if (term.length < 2) { sug.hidden = true; return; }
      loadIndex().then(function (idx) {
        if (box.value.trim() !== term) return;
        var found = searchIndex(idx, term);
        renderResults(found, sug, 6);
        sug.hidden = !sug.childNodes.length;
      });
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { sug.hidden = true; box.blur(); } });
    document.addEventListener("click", function (e) { if (!box.parentNode.contains(e.target)) sug.hidden = true; });
    document.addEventListener("keydown", function (e) {
      var t = e.target && e.target.tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA" && t !== "SELECT") { e.preventDefault(); box.focus(); }
    });
  }
  var results = document.getElementById("results");
  if (results) {
    var qs = new URLSearchParams(location.search), term0 = (qs.get("q") || "").slice(0, 100), field = document.getElementById("search-q"), status = document.getElementById("search-status");
    if (field) field.value = term0;
    function run(term) {
      if (!term.trim()) { results.textContent = ""; status.textContent = "Type to search kits, picks, skills, tags and pages."; return; }
      loadIndex().then(function (idx) {
        var found = searchIndex(idx, term);
        renderResults(found, results, 50);
        status.textContent = found.length ? found.length + (found.length === 1 ? " result" : " results") + " for " + term : "Nothing matches " + term + ". Try fewer words, or browse the tags.";
      });
    }
    if (field) field.addEventListener("input", function () { run(field.value); });
    run(term0);
  }
})();
