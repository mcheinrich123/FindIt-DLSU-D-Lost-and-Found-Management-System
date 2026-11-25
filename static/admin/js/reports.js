// Reports: status tabs, category/date filters, top bar search, pagination, row checkboxes,
// and the detail panel (inline on wide screens, a slide-over below 1360px).

const PAGE_SIZE = 8;
const PLACEHOLDER_IMAGE = "/static/assets/images/item-placeholder.svg";

const STATUS_TABS = [
  { status: "all", label: "All" },
  { status: "pending", label: "Pending" },
  { status: "matched", label: "Matched" },
  { status: "ready", label: "Ready" },
  { status: "claimed", label: "Claimed" },
];

// The primary button in the detail panel moves a report to its next status.
const NEXT_ACTIONS = {
  pending: { status: "ready", label: "Mark as Ready for claim" },
  matched: { status: "ready", label: "Mark as Ready for claim" },
  ready: { status: "claimed", label: "Mark as Claimed" },
};

const state = {
  reports: [],
  status: "all",
  category: "",
  month: "", // "YYYY-MM"
  query: "",
  found: null, // the server's answer for `query`: { ids, hits } (../../js/search-api.js)
  page: 1,
  selectedId: null,
  editing: false, // the panel shows the Edit form
  checked: new Set(),
  deleting: false,
  categories: [],
};
let reportLoadVersion = 0;

const els = {
  tabs: document.getElementById("status-tabs"),
  category: document.getElementById("category-filter"),
  date: document.getElementById("date-filter"),
  searchForm: document.getElementById("topbar-search"),
  search: document.querySelector("#topbar-search input"),
  body: document.getElementById("reports-body"),
  selectAll: document.getElementById("select-all"),
  bulkActions: document.getElementById("bulk-report-actions"),
  selectionCount: document.getElementById("reports-selection-count"),
  clearSelected: document.getElementById("clear-selected-reports"),
  deleteSelected: document.getElementById("delete-selected-reports"),
  deleteFeedback: document.getElementById("reports-delete-feedback"),
  summary: document.getElementById("page-summary"),
  pagination: document.getElementById("pagination"),
  layout: document.getElementById("reports-layout"),
  panel: document.getElementById("detail-panel"),
  panelId: document.getElementById("detail-id"),
  panelBody: document.getElementById("detail-body"),
  panelClose: document.getElementById("detail-close"),
  backdrop: document.getElementById("panel-backdrop"),
};

const esc = (value) => AdminUI.escape(value);
const findReport = (id) => state.reports.find((report) => report.id === id);
const where = (report) => Locations.label(report.locationId, report.locationOther);

function matchesFilters(report, { ignoreStatus = false } = {}) {
  const query = state.query.trim().toLowerCase();
  const haystack = `${report.name} ${report.id} ${where(report)} ${report.category}`.toLowerCase();
  return (
    (ignoreStatus || state.status === "all" || report.status === state.status) &&
    (!state.category || report.category === state.category) &&
    (!state.month || report.date.startsWith(state.month)) &&
    (!query || state.found?.ids.has(report.id) || AdminUI.findsPlace(query, report.locationId, haystack))
  );
}

// A report's `field` for the table, with the search marked where the server found it
// (Boyer-Moore, backend/nlp.py)
const markSearch = (report, field, text) => SearchAPI.mark(text, state.found?.hits[report.id]?.[field]);

/* ---------- Filters ---------- */

function buildCategoryOptions(categories) {
  els.category.insertAdjacentHTML("beforeend",
    categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(""));
}

// Date options are the months that actually have reports, newest first.
function buildDateOptions() {
  const months = [...new Set(state.reports.map((r) => r.date.slice(0, 7)))].sort().reverse();
  if (!months.includes(state.month)) state.month = "";
  els.date.innerHTML = '<option value="">Any date</option>' + months.map((month) => {
    const label = AdminUI.formatDate(`${month}-01`, { month: "long", year: "numeric" });
    return `<option value="${month}">${label}</option>`;
  }).join("");
  els.date.value = state.month;
}

function buildTabs() {
  els.tabs.innerHTML = STATUS_TABS.map(({ status, label }) => `
    <button type="button" class="status-tab" data-status="${status}" aria-pressed="false">
      ${label} <span class="tab-count"></span>
    </button>`).join("");
}

// Tab counts respect the other filters (category, date, search) but not the tab itself.
function updateTabs() {
  const pool = state.reports.filter((r) => matchesFilters(r, { ignoreStatus: true }));
  els.tabs.querySelectorAll(".status-tab").forEach((tab) => {
    const { status } = tab.dataset;
    const count = status === "all" ? pool.length : pool.filter((r) => r.status === status).length;
    tab.querySelector(".tab-count").textContent = count;
    tab.setAttribute("aria-pressed", String(status === state.status));
  });
}

function applyFilters() {
  state.page = 1;
  updateTabs();
  renderTable();
}

/* ---------- Table ---------- */

function rowHTML(report) {
  const selected = report.id === state.selectedId;
  return `
    <tr data-id="${esc(report.id)}"${selected ? ' class="is-selected"' : ""}>
      <td class="check-col">
        <input type="checkbox" class="row-check" aria-label="Select ${esc(report.name)}, ${esc(report.id)}"${state.checked.has(report.id) ? " checked" : ""}>
      </td>
      <td>
        <span class="item-cell">
          ${AdminUI.itemIcon(report.category)}
          <span>
            <button type="button" class="row-link" aria-controls="detail-panel" aria-expanded="${selected}">${markSearch(report, "name", report.name)}</button>
            <span class="item-id">${markSearch(report, "id", report.id)}</span>
          </span>
        </span>
      </td>
      <td>${AdminUI.typeBadge(report.type)}</td>
      <td>${markSearch(report, "place", where(report))}</td>
      <td class="num">${AdminUI.formatDate(report.date)}</td>
      <td>${AdminUI.statusBadge(report.status)}</td>
      <td>
        <button type="button" class="row-menu" aria-label="More actions for ${esc(report.name)}">${AdminUI.icon("more", 18)}</button>
      </td>
    </tr>`;
}

// Page numbers with ellipses once there are more than 7 pages: 1 … 4 5 6 … 12
function pageList(current, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = [...new Set([1, current - 1, current, current + 1, count])]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b);
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1] > 1 ? ["…", p] : [p]));
}

function renderPagination(pageCount) {
  const { page } = state;
  const numbers = pageList(page, pageCount).map((p) => (p === "…"
    ? '<span class="page-ellipsis" aria-hidden="true">…</span>'
    : `<button type="button" class="page-btn" data-page="${p}"${p === page ? ' aria-current="page"' : ""}>${p}</button>`
  )).join("");

  els.pagination.innerHTML = `
    <button type="button" class="page-btn" data-page="${page - 1}" aria-label="Previous page"${page === 1 ? " disabled" : ""}>${AdminUI.icon("chevronLeft", 16)}</button>
    ${numbers}
    <button type="button" class="page-btn" data-page="${page + 1}" aria-label="Next page"${page === pageCount ? " disabled" : ""}>${AdminUI.icon("chevronRight", 16)}</button>`;
}

function currentPageRows() {
  const filtered = state.reports.filter((r) => matchesFilters(r));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  return { filtered, pageCount, start, rows: filtered.slice(start, start + PAGE_SIZE) };
}

function renderTable() {
  const { filtered, pageCount, start, rows } = currentPageRows();

  els.body.innerHTML = rows.length
    ? rows.map(rowHTML).join("")
    : '<tr><td colspan="7" class="table-empty">No reports match these filters.</td></tr>';

  els.summary.textContent = filtered.length
    ? `Showing ${start + 1}–${start + rows.length} of ${filtered.length}`
    : "No reports to show";

  renderPagination(pageCount);
  syncSelectAll();
}

function syncSelectAll() {
  const ids = currentPageRows().rows.map((r) => r.id);
  const checkedCount = ids.filter((id) => state.checked.has(id)).length;
  els.selectAll.checked = ids.length > 0 && checkedCount === ids.length;
  els.selectAll.indeterminate = checkedCount > 0 && checkedCount < ids.length;
  els.selectAll.disabled = state.deleting || !ids.length;
  els.body.querySelectorAll(".row-check").forEach((box) => { box.disabled = state.deleting; });
  els.bulkActions.hidden = state.checked.size === 0;
  const outside = state.checked.size - checkedCount;
  const summary = `${state.checked.size} selected${outside ? ` (${outside} outside this page)` : ""}`;
  if (els.selectionCount.textContent !== summary) els.selectionCount.textContent = summary;
  els.clearSelected.disabled = state.deleting;
  els.deleteSelected.disabled = state.deleting;
  const detailDelete = els.panelBody.querySelector("#detail-delete");
  if (detailDelete) detailDelete.disabled = state.deleting;
}

/* ---------- Detailed Panels ---------- */

// The signals behind a TF-IDF match (nlp.py), in words:
// "Text 65% similar · Same place · Same category · Same day"
function matchReasons({ signals, daysApart }) {
  const place = { 1: "Same place", 0.5: "Same campus" }[signals.location] || "Different place";
  const gap = Math.abs(daysApart);
  const when = daysApart === null ? "No dates"
    : daysApart < -1 ? "Found before it was lost"
    : gap === 0 ? "Same day"
    : `${gap} day${gap === 1 ? "" : "s"} apart`;
  return [
    `Text ${Math.round(signals.text * 100)}% similar`,
    place,
    signals.category ? "Same category" : "Different category",
    when,
  ].join(" · ");
}

// A typo NER read as a dictionary word: "walet → wallet"
const typoText = (typo) => `${typo.written} → ${typo.word}`;

// Levenshtein's part in a match: how many typos it fixed in the two reports (listed on hover;
// each report's own are in its NER box), and what the pair would score with both read exactly
// as written. Empty when neither report had a typo.
function typoLineHTML(report) {
  const other = findReport(report.match.reportId);
  const typos = [...new Set([...(report.typos || []), ...(other?.typos || [])].map(typoText))];
  if (!typos.length) return "";
  const without = report.match.scoreWithoutTypoFixes;
  const effect = without === null || without === report.match.score
    ? "same score without the fixes"
    : `${without}% without the fixes`;
  return `<span class="match-why" title="${esc(typos.join(", "))}">${typos.length} typo${typos.length === 1 ? "" : "s"} fixed · ${effect}</span>`;
}

function matchHTML(report) {
  const otherType = report.type === "lost" ? "found" : "lost";
  const typoLine = typoLineHTML(report);
  return `
    <div class="match-box">
      ${AdminUI.icon("sparkles", 20)}
      <p>
        <span class="match-label">NLP match · TF-IDF${typoLine ? " + Levenshtein" : ""}</span>
        Matches ${otherType} report
        <a href="/admin/reports?q=${encodeURIComponent(report.match.reportId)}"><strong>${esc(report.match.reportId)}</strong></a>
        <span class="match-why">${esc(matchReasons(report.match))}</span>
        ${typoLine}
      </p>
      <span class="match-score">${esc(report.match.score)}%</span>
    </div>`;
}

// An open report the matcher has nothing for yet
const NO_MATCH_HTML = `
  <div class="match-box is-empty">
    ${AdminUI.icon("sparkles", 20)}
    <p>
      <span class="match-label">NLP match · TF-IDF</span>
      No likely match yet. Every new report is compared with this one.
    </p>
  </div>`;

// What NER (nlp.py) recognized in the report's text, brand and unique details included.
const ENTITY_NAMES = { ITEM: "Item", BRAND: "Brand", COLOR: "Color", MATERIAL: "Material", LOCATION: "Place" };

function entitiesHTML({ entities, typos = [] }) {
  const rows = Object.entries(ENTITY_NAMES)
    .map(([label, name]) => [name, (entities[label] || []).map((value) => (label === "LOCATION" ? Locations.label(value) : value))])
    .filter(([, values]) => values.length);
  if (!rows.length) return "";
  // Words the dictionary didn't have that NER read as one it does, by Levenshtein distance
  const typoRow = typos.length ? `
        <div><dt>Typos fixed · Levenshtein</dt><dd class="ner-tags">${typos.map((typo) => `
          <span class="ner-tag ner-typo"><s>${esc(typo.written)}</s> <span aria-hidden="true">→</span><span class="visually-hidden">read as</span> ${esc(typo.word)}
            <small>${typo.edits} edit${typo.edits === 1 ? "" : "s"}</small></span>`).join("")}</dd></div>` : "";
  return `
    <section class="private-box ner-box" aria-label="Details found by NER">
      <p class="detail-label">${AdminUI.icon("sparkles", 14)} Found by NER</p>
      <dl>${rows.map(([name, values]) => `
        <div><dt>${name}</dt><dd class="ner-tags">${values.map((value) => `<span class="ner-tag">${esc(value)}</span>`).join("")}</dd></div>`).join("")}${typoRow}
      </dl>
    </section>`;
}

// Items logged with "Add found item" carry SWAFO-only details for checking claims.
function privateHTML(details) {
  const rows = [
    ["Brand", details.brand],
    ["Unique details", details.identifyingDetails],
    ["Turned in by", details.turnedInBy],
    ["Stored at", details.storage],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `
    <section class="private-box" aria-label="SWAFO-only details">
      <p class="detail-label">${AdminUI.icon("lock", 14)} SWAFO only</p>
      <dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
    </section>`;
}

// Edit swaps the details for a form with the same fields. The "Other" box shows once the
// location list is set up (renderPanel).
function editFormHTML(report) {
  // The current category stays an option even if it's no longer in the list.
  const options = (values, current) => [...new Set([...values, current])]
    .map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
  return `
    <form id="edit-form">
      <div class="field">
        <label for="edit-name">Item name</label>
        <input type="text" id="edit-name" name="name" value="${esc(report.name)}" required>
      </div>
      <div class="field">
        <label for="edit-category">Category</label>
        <select id="edit-category" name="category" required>${options(state.categories, report.category)}</select>
      </div>
      <div class="field">
        <label for="edit-location">Location</label>
        <select id="edit-location" name="locationId" required>${Locations.optionsHTML(report.locationId)}</select>
      </div>
      <div class="field" id="edit-location-other-field" hidden>
        <label for="edit-location-other">Describe the place</label>
        <input type="text" id="edit-location-other" name="locationOther" value="${esc(report.locationOther)}">
      </div>
      <div class="field">
        <label for="edit-date">Date</label>
        <input type="date" id="edit-date" name="date" value="${esc(report.date)}" max="${AdminUI.today()}" required>
      </div>
      <p class="form-error" id="edit-error" role="alert" hidden></p>
      <div class="detail-actions edit-actions">
        <button type="button" class="admin-btn" id="edit-cancel">Cancel</button>
        <button type="submit" class="admin-btn admin-btn-primary">Save changes</button>
      </div>
    </form>`;
}

function renderPanel() {
  const report = findReport(state.selectedId);
  if (!report) return;
  const next = NEXT_ACTIONS[report.status];
  // Message opens the conversation with whoever filed the report, starting it if needed.
  // SWAFO's own "Add found item" entries have nobody to message.
  const reporter = report.addedByAdmin ? null : report.reporter;
  const messageIcon = AdminUI.icon("messages", 16);

  els.panelId.textContent = report.id;
  els.panelBody.innerHTML = `
    <img class="detail-image" src="${esc(report.image || PLACEHOLDER_IMAGE)}" alt="${report.image ? `Photo of ${esc(report.name)}` : ""}">
    <div class="detail-title">
      <h2 id="detail-name">${esc(report.name)}</h2>
      ${AdminUI.statusBadge(report.status)}
    </div>
    ${state.editing ? editFormHTML(report) : `
    <dl class="info-grid">
      <div><dt>Type</dt><dd>${AdminUI.typeBadge(report.type)}</dd></div>
      <div><dt>Category</dt><dd>${esc(report.category)}</dd></div>
      <div><dt>Location</dt><dd>${esc(where(report))}</dd></div>
      <div><dt>Date</dt><dd>${AdminUI.formatDate(report.date, { month: "short", day: "numeric", year: "numeric" })}</dd></div>
    </dl>
    ${report.match ? matchHTML(report) : report.status !== "claimed" ? NO_MATCH_HTML : ""}
    ${report.entities ? entitiesHTML(report) : ""}
    ${report.private ? privateHTML(report.private) : ""}
    <div class="detail-actions">
      <button type="button" class="admin-btn admin-btn-primary" id="detail-advance"${next ? "" : " disabled"}>
        ${next ? next.label : "Already claimed"}
      </button>
      ${reporter
        ? `<a class="admin-btn" href="/admin/messages?c=${encodeURIComponent(reporter.id)}" title="Message ${esc(reporter.name)}">${messageIcon}Message</a>`
        : `<button type="button" class="admin-btn" disabled title="SWAFO logged this item, so there's no student to message">${messageIcon}Message</button>`}
      <button type="button" class="admin-btn" id="detail-edit">${AdminUI.icon("edit", 16)}Edit</button>
      <button type="button" class="admin-btn admin-btn-danger" id="detail-delete"${state.deleting ? " disabled" : ""}>Delete report</button>
    </div>
    <p class="form-error" id="detail-delete-error" role="alert" hidden></p>`}`;
  if (state.editing) {
    Locations.watchOther(document.getElementById("edit-location"), document.getElementById("edit-location-other-field"));
  }
}

// After a change: swap in the updated report and redraw.
function showUpdated(updated) {
  state.reports = state.reports.map((r) => (r.id === updated.id ? updated : r));
  renderPanel();
  updateTabs();
  renderTable();
  if (state.query) runSearch(state.query); // its name or place may have changed
}

function syncSelectedRow() {
  els.body.querySelectorAll("tr[data-id]").forEach((row) => {
    const selected = row.dataset.id === state.selectedId;
    row.classList.toggle("is-selected", selected);
    row.querySelector(".row-link").setAttribute("aria-expanded", String(selected));
  });
}

function setPanelOpen(open) {
  els.layout.classList.toggle("has-panel", open);
  els.panel.classList.toggle("is-open", open);
  els.backdrop.classList.toggle("is-open", open);
}

function openPanel(id) {
  state.selectedId = id;
  state.editing = false;
  renderPanel();
  syncSelectedRow();
  setPanelOpen(true);
  els.panel.focus({ preventScroll: true });
}

function closePanel() {
  const id = state.selectedId;
  state.selectedId = null;
  setPanelOpen(false);
  syncSelectedRow();
  // Return focus to the row that opened the panel, if it's still on screen.
  els.body.querySelector(`tr[data-id="${CSS.escape(id)}"] .row-link`)?.focus();
}

function applyReports(reports) {
  state.reports = reports;
  const available = new Set(reports.map((report) => report.id));
  state.checked = new Set([...state.checked].filter((id) => available.has(id)));
  if (state.selectedId) {
    if (!available.has(state.selectedId)) closePanel();
    else if (!state.editing) renderPanel();
  }
  buildDateOptions();
  updateTabs();
  renderTable();
}

async function loadReports() {
  const version = ++reportLoadVersion;
  const reports = await AdminAPI.getReports();
  if (version === reportLoadVersion) applyReports(reports);
}

function showReportDeletion(message, isError = false, detailId = null) {
  const detailError = els.panelBody.querySelector("#detail-delete-error");
  const feedback = isError && detailId && detailId === state.selectedId && detailError
    ? detailError : els.deleteFeedback;
  feedback.textContent = message;
  feedback.classList.toggle("is-error", isError);
  if (feedback === detailError) feedback.hidden = !message;
}

async function deleteReports(references, report = null) {
  if (state.deleting || !references.length) return;
  const label = report ? `${report.name} (${report.id})` : `${references.length} ${references.length === 1 ? "report" : "reports"}`;
  if (!window.confirm(`Permanently delete ${label}? This also removes any photos, linked claims, and their supporting files.`)) return;

  state.deleting = true;
  reportLoadVersion++; // Ignore a list request started before this deletion.
  showReportDeletion("");
  const detailError = els.panelBody.querySelector("#detail-delete-error");
  if (detailError) detailError.hidden = true;
  syncSelectAll();
  let deleted = false;
  try {
    await AdminAPI.deleteReports(references);
    deleted = true;
    const removed = new Set(references);
    applyReports(state.reports.filter((entry) => !removed.has(entry.id)).map((entry) => (
      entry.match && removed.has(entry.match.reportId) ? { ...entry, match: null } : entry
    )));
    showReportDeletion(`Deleted ${label}.`);
    void Promise.allSettled([loadReports(), refreshNavCounts(), loadNotifications()]);
  } catch (error) {
    if (deleted) {
      showReportDeletion(`Deleted ${label}. Refresh to update the list.`);
    } else {
      if (error.message === "not_found") await loadReports().catch(() => {});
      const errors = {
        not_found: "A selected report is no longer available. Review the list before trying again.",
        invalid_selection: "Select the reports you want to delete and try again.",
        database_error: "The server couldn't delete these reports. Try again.",
      };
      showReportDeletion(errors[error.message] || "Couldn't confirm the deletion. Check your connection and try again.", true, report?.id);
    }
  } finally {
    state.deleting = false;
    syncSelectAll();
    if (deleted) (state.selectedId ? els.panel : els.summary).focus({ preventScroll: true });
  }
}

/* ---------- Events ---------- */

els.tabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".status-tab");
  if (!tab) return;
  state.status = tab.dataset.status;
  applyFilters();
});

els.category.addEventListener("change", () => {
  state.category = els.category.value;
  applyFilters();
});

els.date.addEventListener("change", () => {
  state.month = els.date.value;
  applyFilters();
});

// The top bar search filters this table live (on other pages it submits here as ?q=). The
// server looks for the query with Boyer-Moore (backend/nlp.py); the table updates when it answers.
const runSearch = SearchAPI.live("reports", (found, query) => {
  Object.assign(state, { query, found });
  applyFilters();
});
els.searchForm.addEventListener("submit", (event) => event.preventDefault());
els.search.addEventListener("input", () => runSearch(els.search.value));

els.body.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;

  if (event.target.closest(".check-col")) {
    const box = event.target.closest(".row-check");
    if (box && !state.deleting) {
      if (box.checked) state.checked.add(row.dataset.id);
      else state.checked.delete(row.dataset.id);
      syncSelectAll();
    }
    return;
  }

  openPanel(row.dataset.id);
});

els.selectAll.addEventListener("change", () => {
  if (state.deleting) return;
  currentPageRows().rows.forEach((r) => {
    if (els.selectAll.checked) state.checked.add(r.id);
    else state.checked.delete(r.id);
  });
  renderTable();
});

els.clearSelected.addEventListener("click", () => {
  if (state.deleting) return;
  state.checked.clear();
  renderTable();
  (els.selectAll.disabled ? els.search : els.selectAll).focus();
});

els.deleteSelected.addEventListener("click", () => deleteReports([...state.checked]));

els.pagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  renderTable();
  els.pagination.querySelector('[aria-current="page"]').focus();
});

els.panelBody.addEventListener("click", (event) => {
  if (state.deleting) return;
  const report = findReport(state.selectedId);
  if (!report) return;
  if (event.target.closest("#detail-delete")) {
    deleteReports([report.id], report);
    return;
  }
  if (event.target.closest("#detail-edit, #edit-cancel")) {
    state.editing = !state.editing;
    renderPanel();
    document.getElementById(state.editing ? "edit-name" : "detail-edit").focus();
    return;
  }
  if (!event.target.closest("#detail-advance")) return;
  const next = NEXT_ACTIONS[report.status];

  AdminAPI.updateReportStatus(state.selectedId, next.status).then((updated) => {
    showUpdated(updated);
    refreshNavCounts(); // the sidebar's pending count
    document.getElementById("detail-advance").focus();
  });
});

// The browser checks the required fields before this runs.
els.panelBody.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  if (state.deleting || submit.disabled) return;
  const errorMessage = form.querySelector("#edit-error");
  const { name, category, locationId, locationOther, date } = form.elements;
  submit.disabled = true;
  errorMessage.hidden = true;
  try {
    const updated = await AdminAPI.updateReport(state.selectedId, {
      name: name.value.trim(),
      category: category.value,
      locationId: locationId.value,
      locationOther: locationId.value === Locations.OTHER ? locationOther.value.trim() : "",
      date: date.value,
    });
    if (!form.isConnected) return;
    state.editing = false;
    showUpdated(updated);
    buildDateOptions(); // the date may now be in a new month
    document.getElementById("detail-edit").focus();
  } catch (error) {
    const messages = {
      login_required: "Please log in again to edit this report.",
      missing_fields: "Please fill in all the required fields.",
      invalid_category: "Please choose a category.",
      invalid_date: "That date isn't valid.",
      future_date: "The date can't be in the future.",
      database_error: "The server couldn't save this report. Check that the database folder is writable.",
    };
    errorMessage.textContent = messages[error.message] || "Couldn't save changes. Try again.";
    errorMessage.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

els.panelClose.addEventListener("click", closePanel);
els.backdrop.addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selectedId && !event.defaultPrevented) {
    closePanel();
  }
});

/* ---------- Start ---------- */

// reports?q=FI-0003 (from a match, a notice or another page's search) starts with that search.
const initialQuery = (new URLSearchParams(window.location.search).get("q") || "").trim();
els.search.value = initialQuery;
const noMatches = { ids: new Set(), hits: {} };

const startup = [
  AdminAPI.getReports(),
  AdminAPI.getCategories(),
  initialQuery ? SearchAPI.find("reports", initialQuery).catch(() => noMatches) : null,
];
Promise.all(startup).then(([reports, categories, found]) => {
  Object.assign(state, { reports, categories, query: initialQuery, found });
  buildCategoryOptions(categories);
  buildDateOptions();
  buildTabs();
  updateTabs();
  renderTable();
});

// A new item was logged with "Add found item": reload, clear the filters so it's visible,
// and open it in the detail panel.
document.addEventListener("findit:item-added", (event) => {
  loadReports().then(() => {
    Object.assign(state, { status: "all", category: "", month: "", query: "", found: null });
    runSearch(""); // so a search still on its way can't bring the old query back
    els.category.value = "";
    els.search.value = "";
    buildDateOptions();
    applyFilters();
    if (findReport(event.detail.id)) openPanel(event.detail.id);
  }).catch(() => {});
});
