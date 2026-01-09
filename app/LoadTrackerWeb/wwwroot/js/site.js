// File: wwwroot/js/loadtracker.js
(function () {
  const table = document.getElementById("loadsTable");
  if (!table) return;

  const customer = table.dataset.customer;
  const year = parseInt(table.dataset.year, 10);
  const month = parseInt(table.dataset.month, 10);
  const canEdit = table.dataset.canedit === "1";

  // Optional: allow overrides via data-* (safe defaults)
  const updateUrl = table.dataset.updateUrl || "/Loads/Update";
  const rowUrl = table.dataset.rowUrl || "/Loads/Row";
  const hubUrl = table.dataset.hubUrl || "/hubs/loadtracker";

  // Debug logs enabled if ?ltdebug=1 in URL or data-debug="1" on table
  const DEBUG =
    table.dataset.debug === "1" ||
    (window.location.search || "").toLowerCase().includes("ltdebug=1");

  const log = (...a) => DEBUG && console.log("[LT]", ...a);
  const warn = (...a) => DEBUG && console.warn("[LT]", ...a);
  const err = (...a) => console.error("[LT]", ...a);

  // Navbar buttons
  const saveBtn = document.getElementById("navSaveRowBtn");
  const cancelBtn = document.getElementById("navCancelRowBtn");
  const refreshBtn = document.getElementById("navRefreshBtn");  // fetch page + replace tbody
  const recalcBtn = document.getElementById("navRecalcBtn");    // optional: recalc only (no fetch)

  // ---------- Column toggles (per-browser localStorage) ----------
  const colToggleKey = "lt_columns";
  const toggles = document.querySelectorAll("#columnsPanel input[type=checkbox][data-col]");

  const leftGroupCols = ["probill","bol","order","po","receiver","rcity","rprov","pickup","rad","status"];
  const rightGroupCols = ["ddate","dtime","exception","ontime","delay","comments"];

  function updateGroupColspans(state) {
    const leftTh = table.querySelector("thead .group-left");
    const rightTh = table.querySelector("thead .group-right");
    if (!leftTh || !rightTh) return;

    const visible = (c) => state[c] !== false;
    const leftCount = leftGroupCols.filter(visible).length;
    const rightCount = rightGroupCols.filter(visible).length;

    leftTh.colSpan = Math.max(1, leftCount);
    rightTh.colSpan = Math.max(1, rightCount);
  }

  function applyColumnVisibility(state) {
    toggles.forEach(cb => {
      const col = cb.dataset.col;
      const show = state[col] !== false;
      cb.checked = show;

      // scope ONLY to this table
      table.querySelectorAll(`[data-col="${col}"]`).forEach(el => {
        el.style.display = show ? "" : "none";
      });
    });

    updateGroupColspans(state);
  }

  let colState = {};
  try { colState = JSON.parse(localStorage.getItem(colToggleKey) || "{}"); } catch { colState = {}; }
  applyColumnVisibility(colState);

  toggles.forEach(cb => {
    cb.addEventListener("change", () => {
      colState[cb.dataset.col] = cb.checked;
      localStorage.setItem(colToggleKey, JSON.stringify(colState));
      applyColumnVisibility(colState);
      updateStatusBox();
    });
  });

  // ---------- Column widths ----------
  const widthKey = "lt_colwidths";
  let widths = {};
  try { widths = JSON.parse(localStorage.getItem(widthKey) || "{}"); } catch { widths = {}; }

  function applyWidth(col, px) {
    table.querySelectorAll(`[data-col="${col}"]`).forEach(el => {
      el.style.width = px + "px";
      el.style.maxWidth = px + "px";
    });
  }

  Object.keys(widths).forEach(col => {
    const px = parseInt(widths[col], 10);
    if (px > 20) applyWidth(col, px);
  });

  table.querySelectorAll("thead tr.col-row th[data-col]").forEach(th => {
    const col = th.dataset.col;
    const handle = th.querySelector(".col-resizer");
    if (!handle) return;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const newW = Math.max(40, Math.round(startWidth + dx));
        applyWidth(col, newW);
      }

      function onUp() {
        const finalW = Math.round(th.getBoundingClientRect().width);
        widths[col] = finalW;
        localStorage.setItem(widthKey, JSON.stringify(widths));
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });

  // ---------- Status summary ----------
  // Primary logic:
  // - ON TIME = YES => ON-TIME
  // - ON TIME = NO  => EXCEPTION ? "Late – Other" : "Late-Carrier"
  // Fallback logic if ON TIME/EXCEPTION not parseable:
  // - use CURRENT STATUS text (ON-TIME / LATE CARRIER / LATE OTHER)
  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim().toUpperCase();
  }

  function classifyFromCurrentStatusText(text) {
    const t = norm(text);
    if (t.includes("ON") && t.includes("TIME")) return "ONTIME";
    if (t.includes("LATE") && t.includes("OTHER")) return "LATEOTHER";
    if (t.includes("LATE") && t.includes("CARRIER")) return "LATECARRIER";
    return null;
  }

  function parseYesNoFromCell(cell) {
    if (!cell) return null;

    // checkbox inside the cell?
    const cb = cell.querySelector('input[type="checkbox"]');
    if (cb) return cb.checked === true;

    // select inside the cell?
    const sel = cell.querySelector("select");
    if (sel) {
      const v = norm(sel.value);
      const t = norm(sel.options?.[sel.selectedIndex]?.text);
      const x = v || t;
      if (x === "YES" || x === "Y" || x === "TRUE" || x === "1") return true;
      if (x === "NO" || x === "N" || x === "FALSE" || x === "0") return false;
      if (x.includes("YES")) return true;
      if (x.includes("NO")) return false;
      return null;
    }

    // input text inside the cell?
    const inp = cell.querySelector('input[type="text"], input:not([type])');
    if (inp) {
      const x = norm(inp.value);
      if (x === "YES" || x === "Y" || x === "TRUE" || x === "1") return true;
      if (x === "NO" || x === "N" || x === "FALSE" || x === "0") return false;
      if (x.includes("YES")) return true;
      if (x.includes("NO")) return false;
      return null;
    }

    // plain text
    const t = norm(cell.textContent);
    if (!t) return null;
    if (t === "YES" || t === "Y" || t === "TRUE" || t === "1") return true;
    if (t === "NO" || t === "N" || t === "FALSE" || t === "0") return false;
    if (t.includes("YES")) return true;
    if (t.includes("NO")) return false;
    return null;
  }

  function updateStatusBox() {
    const box =
      document.getElementById("statusSummaryTable") ||
      document.querySelector(".status-box table");

    if (!box) {
      warn("Status box not found");
      return;
    }

    const rows = box.querySelectorAll("tr");
    if (rows.length < 4) {
      warn("Status box rows < 4, cannot update");
      return;
    }

    let onTime = 0, lateCarrier = 0, lateOther = 0, unknown = 0;

    const trs = table.querySelectorAll("tbody tr[data-rowid]");
    trs.forEach(tr => {
      const onTimeCell = tr.querySelector('td[data-col="ontime"]');
      const exCell = tr.querySelector('td[data-col="exception"]');
      const statusCell = tr.querySelector('td[data-col="status"]');

      const isOnTime = parseYesNoFromCell(onTimeCell);
      const isEx = parseYesNoFromCell(exCell);

      if (isOnTime === true) {
        onTime++;
        return;
      }

      if (isOnTime === false) {
        if (isEx === true) lateOther++;
        else lateCarrier++; // default if exception is missing/unparseable
        return;
      }

      // Fallback to CURRENT STATUS text if ON TIME is not readable
      const fallbackKind = classifyFromCurrentStatusText(statusCell ? statusCell.textContent : "");
      if (fallbackKind === "ONTIME") onTime++;
      else if (fallbackKind === "LATEOTHER") lateOther++;
      else if (fallbackKind === "LATECARRIER") lateCarrier++;
      else unknown++;
    });

    // Percent uses only the 3 tracked buckets (exclude unknown)
    const total = onTime + lateCarrier + lateOther;
    const pct = (n) => total === 0 ? 0 : Math.round((n / total) * 100);

    rows[1].children[1].textContent = String(onTime);
    rows[1].children[2].textContent = pct(onTime) + " %";

    rows[2].children[1].textContent = String(lateCarrier);
    rows[2].children[2].textContent = pct(lateCarrier) + " %";

    rows[3].children[1].textContent = String(lateOther);
    rows[3].children[2].textContent = pct(lateOther) + " %";

    log("Status updated", { onTime, lateCarrier, lateOther, total, unknown, rowCount: trs.length });

    if (DEBUG && total === 0 && trs.length > 0) {
      const sample = [];
      trs.forEach((tr, i) => {
        if (i >= 5) return;
        const ot = tr.querySelector('td[data-col="ontime"]');
        const ex = tr.querySelector('td[data-col="exception"]');
        const st = tr.querySelector('td[data-col="status"]');
        sample.push({
          ontime_text: norm(ot ? ot.textContent : ""),
          exception_text: norm(ex ? ex.textContent : ""),
          status_text: norm(st ? st.textContent : "")
        });
      });
      warn("Totals are 0 but rows exist. Sample ON TIME / EXCEPTION / STATUS:", sample);
    }
  }

  // Live recalculation when user changes ON TIME / EXCEPTION controls in the table (delegated)
  table.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;
    if (t.closest('td[data-col="exception"]') || t.closest('td[data-col="ontime"]')) {
      log("Change detected in ON TIME / EXCEPTION; recalculating status box");
      updateStatusBox();
    }
  });

  // ---------- Row selection + edit (double-click) ----------
  let selectedId = null;
  let selectedTr = null;

  let editingTr = null;
  let snapshot = null;

  function setToolbarState() {
    if (!canEdit) return;
    const isEditing = !!editingTr;
    if (saveBtn) saveBtn.disabled = !isEditing;
    if (cancelBtn) cancelBtn.disabled = !isEditing;
  }

  function selectRow(tr) {
    if (!tr) return;
    if (selectedTr && selectedTr !== tr) selectedTr.classList.remove("selected");
    selectedTr = tr;
    selectedId = tr.dataset.rowid;
    tr.classList.add("selected");
    setToolbarState();
  }

  function hasUnsavedChanges(tr, snap) {
    if (!tr || !snap) return false;

    const curEx = tr.querySelector("input.ex")?.checked === true;
    const curDelay = (tr.querySelector("textarea.delay")?.value ?? "").trim();
    const curComments = (tr.querySelector("textarea.comments")?.value ?? "").trim();

    return (
      curEx !== snap.ex ||
      curDelay !== (snap.delay ?? "").trim() ||
      curComments !== (snap.comments ?? "").trim()
    );
  }

  function takeSnapshot(tr) {
    const ex = tr.querySelector("input.ex")?.checked === true;
    const delay = tr.querySelector("textarea.delay")?.value ?? "";
    const comments = tr.querySelector("textarea.comments")?.value ?? "";

    return {
      ex,
      delay,
      comments,
      origUserDelay: (tr.dataset.origUserdelay || "").trim(),
      effectiveDelay: (tr.dataset.effectiveDelay || "").trim()
    };
  }

  function unlockRow(tr) {
    tr.classList.add("editing");
    tr.querySelectorAll("textarea.edit-lock").forEach(el => el.removeAttribute("readonly"));
  }

  function lockRow(tr) {
    tr.classList.remove("editing");
    tr.querySelectorAll("textarea.edit-lock").forEach(el => el.setAttribute("readonly", "readonly"));
  }

  function enterEdit(tr) {
    if (!tr) return;

    selectRow(tr);

    snapshot = takeSnapshot(tr);
    unlockRow(tr);
    editingTr = tr;

    setToolbarState();
    log("Enter edit", tr.dataset.rowid);
  }

  function cancelEdit() {
    if (!editingTr || !snapshot) return;

    const exEl = editingTr.querySelector("input.ex");
    if (exEl) exEl.checked = snapshot.ex;

    const dEl = editingTr.querySelector("textarea.delay");
    if (dEl) dEl.value = snapshot.delay;

    const cEl = editingTr.querySelector("textarea.comments");
    if (cEl) cEl.value = snapshot.comments;

    lockRow(editingTr);

    log("Cancel edit", editingTr.dataset.rowid);

    editingTr = null;
    snapshot = null;
    setToolbarState();

    updateStatusBox();
  }

  function getAntiForgeryToken() {
    return document.querySelector('input[name="__RequestVerificationToken"]')?.value || null;
  }

  async function readResponseTextSafe(res) {
    try {
      const t = await res.text();
      return (t || "").trim();
    } catch {
      return "";
    }
  }

  async function saveEdit() {
    if (!editingTr || !snapshot) return;

    const tr = editingTr;
    const id = parseInt(tr.dataset.rowid, 10);

    const curEx = tr.querySelector("input.ex")?.checked === true;
    const curDelay = (tr.querySelector("textarea.delay")?.value ?? "").trim();
    const curComments = (tr.querySelector("textarea.comments")?.value ?? "").trim();

    const exChanged = curEx !== snapshot.ex;
    const delayChanged = curDelay !== (snapshot.delay ?? "").trim();
    const commentsChanged = curComments !== (snapshot.comments ?? "").trim();

    // No changes => exit edit mode
    if (!exChanged && !delayChanged && !commentsChanged) {
      lockRow(tr);
      editingTr = null;
      snapshot = null;
      setToolbarState();
      log("Save clicked with no changes; exit edit", id);
      updateStatusBox();
      return;
    }

    // payload rules
    let payloadDelay = curDelay.length === 0 ? null : curDelay;
    if (snapshot.origUserDelay === "" && (payloadDelay ?? "") === snapshot.effectiveDelay) {
      payloadDelay = null;
    }
    const payloadComments = curComments.length === 0 ? null : curComments;

    const token = getAntiForgeryToken();
    const headers = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    };
    if (token) headers["RequestVerificationToken"] = token;

    log("Saving", { id, curEx, payloadDelay, payloadComments, updateUrl });

    const res = await fetch(updateUrl, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        detailLineId: id,
        exception: curEx,
        userNonCarrierDelay: payloadDelay,
        comments: payloadComments,
        year: year,
        month: month
      })
    });

    if (!res.ok) {
      const body = await readResponseTextSafe(res);
      const msg = body ? body.slice(0, 800) : "";
      alert(`Update failed (${res.status} ${res.statusText}).\n\n${msg}`);
      warn("Update failed", res.status, res.statusText, msg);
      return; // keep editing
    }

    // Exit edit mode; row will refresh via SignalR/poll
    lockRow(tr);
    editingTr = null;
    snapshot = null;
    setToolbarState();

    log("Saved OK", id);
    updateStatusBox();
  }

  function wireRowEvents() {
    if (!canEdit) return;

    table.querySelectorAll("tbody tr[data-rowid]").forEach(tr => {
      if (tr.dataset.wiredRow === "1") return;
      tr.dataset.wiredRow = "1";

      tr.addEventListener("click", () => {
        // Do NOT cancel edit on click elsewhere (Save/Cancel only)
        selectRow(tr);
      });

      tr.addEventListener("dblclick", () => {
        // Excel-like:
        // - if unsaved, confirm discard
        // - then cancel + open the other row
        if (editingTr && editingTr !== tr) {
          if (hasUnsavedChanges(editingTr, snapshot)) {
            const ok = confirm("You have unsaved changes. Discard them and edit the other row?");
            if (!ok) return;
          }
          cancelEdit();
        }

        if (editingTr === tr) return; // already editing this row
        enterEdit(tr);
      });
    });
  }

  if (canEdit) {
    saveBtn?.addEventListener("click", async () => { await saveEdit(); });
    cancelBtn?.addEventListener("click", () => { cancelEdit(); });
  }

  wireRowEvents();
  setToolbarState();
  updateStatusBox();

  // ---------- SignalR row refresh ----------
  const yyyymm = `${year}${String(month).padStart(2, "0")}`;

  if (window.signalR) {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .build();

    connection.on("rowUpdated", async (detailLineId) => {
      // Don’t replace the row being edited
      if (editingTr && String(editingTr.dataset.rowid) === String(detailLineId)) {
        log("SignalR rowUpdated ignored (currently editing)", detailLineId);
        return;
      }

      const url = `${rowUrl}?id=${encodeURIComponent(detailLineId)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
      const html = await fetch(url, { credentials: "same-origin" }).then(r => r.ok ? r.text() : null);
      if (!html) return;

      const old = table.querySelector(`tr[data-rowid="${detailLineId}"]`);
      if (!old) return;

      const tmp = document.createElement("tbody");
      tmp.innerHTML = html.trim();
      const newRow = tmp.querySelector("tr");
      if (!newRow) return;

      old.replaceWith(newRow);

      if (selectedId && String(detailLineId) === String(selectedId)) {
        selectedTr = newRow;
        newRow.classList.add("selected");
      }

      applyColumnVisibility(colState);
      Object.keys(widths).forEach(c => applyWidth(c, widths[c]));
      wireRowEvents();
      setToolbarState();
      updateStatusBox();

      log("SignalR row replaced", detailLineId);
    });

    connection.start()
      .then(() => connection.invoke("JoinGroup", customer, yyyymm))
      .then(() => log("SignalR connected", { customer, yyyymm, hubUrl }))
      .catch((e) => warn("SignalR connection error", e));
  } else {
    warn("SignalR not found on window");
  }

  // ---------- Poll refresh (for changes made by other apps/services) ----------
  let lastTbodyHtml = null;

  async function refreshTbodyFromServer(force = false) {
    // Don’t poll-refresh while user is editing
    if (editingTr) return;
    if (document.hidden) return;

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ts", String(Date.now())); // bust caches

      const html = await fetch(url.toString(), {
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch" }
      }).then(r => r.ok ? r.text() : null);

      if (!html) return;

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const newTbody = doc.querySelector("#loadsTable tbody");
      if (!newTbody) return;

      const newHtml = newTbody.innerHTML.trim();
      if (!force && lastTbodyHtml !== null && newHtml === lastTbodyHtml) return;

      lastTbodyHtml = newHtml;

      const curTbody = table.querySelector("tbody");
      if (!curTbody) return;

      const keepId = selectedId;

      curTbody.innerHTML = newHtml;

      applyColumnVisibility(colState);
      Object.keys(widths).forEach(c => applyWidth(c, widths[c]));
      wireRowEvents();

      if (keepId) {
        const tr = table.querySelector(`tbody tr[data-rowid="${keepId}"]`);
        if (tr) selectRow(tr);
      }

      updateStatusBox();
      log("Poll refresh applied", { force, keepId });
    } catch (e) {
      warn("Poll refresh error", e);
    }
  }

  refreshBtn?.addEventListener("click", async () => {
    log("Manual refresh clicked");
    await refreshTbodyFromServer(true);
    updateStatusBox();
  });

  recalcBtn?.addEventListener("click", () => {
    log("Manual recalc clicked");
    updateStatusBox();
  });

  // aggressive but reasonable: 10 seconds
  setInterval(refreshTbodyFromServer, 10000);
})();
