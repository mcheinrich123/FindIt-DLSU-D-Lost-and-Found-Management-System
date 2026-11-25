
const STATUS = {
  pending: { label: "Pending", badge: "badge-warning" },
  matched: { label: "Possible match", badge: "badge-info" },
  review: { label: "Under review", badge: "badge-info" },
  rejected: { label: "Not approved", badge: "badge-danger" },
  ready: { label: "Ready for claim", badge: "badge-success" },
  claimed: { label: "Claimed", badge: "badge-neutral" },
  // Found reports (the student turned something in)
  ownerFound: { label: "Possible owner", badge: "badge-info" },
  returned: { label: "Returned", badge: "badge-neutral" },
};

const TYPE_LABELS = { lost: "Lost", found: "Found", claim: "Claim" };

const ICONS = {
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  bottle: '<path d="M10 2h4"/><path d="M10.5 2v3L9 8v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8l-1.5-3V2"/><path d="M9 12h6"/>',
  idCard: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  backpack: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  umbrella: '<path d="M22 12a10 10 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  shirt: '<path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.2a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.4-2.2z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

// First match wins, so "earphone" is earbuds before it can be a phone.
const ICON_WORDS = [
  ["headphones", /earbud|earphone|headphone|headset/i],
  ["idCard", /\bid\b|license|card/i],
  ["key", /key/i],
  ["wallet", /wallet|purse/i],
  ["bottle", /bottle|tumbler|flask/i],
  ["phone", /phone/i],
  ["umbrella", /umbrella/i],
  ["backpack", /backpack|bag/i],
  ["shirt", /hoodie|jacket|shirt|uniform/i],
];
const CATEGORY_ICONS = { Electronics: "phone", Bags: "backpack", Clothing: "shirt", "ID & Docs": "idCard" };

// Tile color: blue while a match waits on the student, green once it's ready to pick up.
const STAGE_TONES = { matched: "blue", ready: "green" };

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "lost", label: "Lost", test: (entry) => entry.type === "lost" },
  { key: "found", label: "Found", test: (entry) => entry.type === "found" },
  { key: "matches", label: "Matches", test: (entry) => Boolean(entry.match && entry.item) },
  { key: "claims", label: "Claims", test: (entry) => entry.type === "claim" },
];

const state = {
  entries: [],
  office: null,
  filter: "all",
  selectedId: null,
  selecting: false,
  selectedReports: new Set(),
  deleting: false,
  dismissingMatch: false,
};
let loadVersion = 0;

const els = {
  filters: document.getElementById("report-filters"),
  notice: document.getElementById("reports-notice"),
  layout: document.getElementById("reports-layout"),
  list: document.getElementById("report-list"),
  detail: document.getElementById("report-detail"),
  empty: document.getElementById("reports-empty"),
  selection: document.getElementById("report-selection"),
  selectionToggle: document.getElementById("report-selection-toggle"),
  selectionActions: document.getElementById("report-selection-actions"),
  selectionCount: document.getElementById("report-selection-count"),
  selectAll: document.getElementById("report-select-all"),
  clearSelection: document.getElementById("report-clear-selection"),
  deleteSelected: document.getElementById("report-delete-selected"),
};

const icon = (name, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function shortDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Where a report or found item is, by name (../js/data/locations.js)
const where = (thing) => thing.locationId ? Locations.label(thing.locationId, thing.locationOther) : "";
function stepTime(iso) {
  const date = iso && new Date(iso);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

const isNarrow = () => window.matchMedia("(max-width: 900px)").matches;
const selectedEntry = () => state.entries.find((entry) => entry.id === state.selectedId);
const visibleEntries = () => state.entries.filter(FILTERS.find((filter) => filter.key === state.filter).test);

// Where the report is from the student's side. A claim decision outranks the report's own status.
function stageOf(entry) {
  if (entry.type === "found") {
    return { matched: "ownerFound", ready: "ready", claimed: "returned" }[entry.status] || "pending";
  }
  if (entry.claim?.status === "approved" && entry.item?.status === "claimed") return "claimed";
  if (entry.claim) return { pending: "review", approved: "ready", released: "claimed", rejected: "rejected" }[entry.claim.status] || "pending";
  if (entry.match && entry.item) return "matched";
  return entry.status === "ready" || entry.status === "claimed" ? entry.status : "pending";
}

function iconFor({ name, category }) {
  const found = ICON_WORDS.find(([, words]) => words.test(name));
  return found ? found[0] : CATEGORY_ICONS[category] || "box";
}

// `thing` is the report, or the found item in the match card; the color always follows the report.
const tile = (thing, entry, size) =>
  `<span class="item-tile tone-${STAGE_TONES[stageOf(entry)] || "gray"}">${icon(iconFor(thing), size)}</span>`;

const badgeHTML = (stage) => `<span class="badge ${STATUS[stage].badge}">${STATUS[stage].label}</span>`;

/* ---------- Progress ---------- */

// Steps up to `reached` are done; the last of those is the current one unless it's the final
// step.
function timeline(steps, reached) {
  const finished = reached === steps.length - 1;
  return steps.map(([label, time], index) => ({
    label,
    time: index <= reached ? time : null,
    state: index < reached || (index === reached && finished) ? "done" : index === reached ? "current" : "todo",
  }));
}

function stepsFor(entry, stage) {
  const submitted = ["Report submitted", entry.submittedAt];
  if (entry.claim) {
    const { claim } = entry;
    const fromReport = entry.type === "lost" ? [submitted] : [];
    const steps = [...fromReport, ["Claim submitted", claim.submittedAt]];
    if (stage === "rejected") return timeline([...steps, ["Claim not approved", claim.reviewedAt]], steps.length);
    return timeline([
      ...steps,
      ["SWAFO reviewing", null],
      ["Approved for pickup", claim.status === "approved" ? claim.reviewedAt : null],
      ["Marked as picked up", claim.status === "released" ? claim.reviewedAt : null],
    ], fromReport.length + ({ review: 1, ready: 2, claimed: 3 }[stage] ?? 0));
  }
  if (entry.type === "found") {
    return timeline([
      submitted, ["Possible owner found", null], ["Ready for claim", null], ["Returned to owner", null],
    ], { ownerFound: 1, ready: 2, returned: 3 }[stage] ?? 0);
  }
  if (stage === "ready" || stage === "claimed") {
    return timeline([
      submitted, ["Marked ready for claim", null], ["Marked as claimed", null],
    ], stage === "ready" ? 1 : 2);
  }
  return timeline([
    submitted, ["Possible match", null], ["Verify and claim", null], ["Pickup", null],
  ], stage === "matched" ? 1 : 0);
}

const STEP_STATES = { done: "Done", current: "Current step", todo: "Not yet" };

function timelineHTML(steps) {
  return `
    <ol class="timeline">
      ${steps.map((step) => `
        <li class="is-${step.state}"${step.state === "current" ? ' aria-current="step"' : ""}>
          <span class="step-dot" aria-hidden="true">${step.state === "done" ? icon("check", 13) : ""}</span>
          <div>
            <span class="step-label"><span class="visually-hidden">${STEP_STATES[step.state]}: </span>${escapeText(step.label)}</span>
            ${stepTime(step.time) ? `<span class="step-sub"><time datetime="${escapeText(step.time)}">${stepTime(step.time)}</time></span>` : ""}
          </div>
        </li>`).join("")}
    </ol>`;
}

/* ---------- The found item and what to do next ---------- */

function matchCardHTML(entry) {
  const { item, match } = entry;
  const score = Number.isFinite(match?.score) ? Math.round(Math.max(0, Math.min(100, match.score))) : null;
  const itemName = escapeText(item.name || "Found item");
  const available = ["pending", "matched", "ready"].includes(item.status);
  const photo = typeof item.image === "string" && item.image.startsWith("/static/") ? item.image : null;
  const found = [where(item), item.locationDetails].filter(Boolean).join(", ");
  const date = shortDate(item.dateFound);
  const metadata = [item.id, found && `Found at ${found}`, date].filter(Boolean).map(escapeText).join(" &middot; ");
  const details = [item.category, item.color].filter(Boolean).map(escapeText).join(" &middot; ");
  return `
    <div class="match-card">
      <div class="match-row">
        <span class="match-thumb">
          ${tile(item, entry, 20)}
          ${photo ? `<img class="match-photo" src="${escapeText(photo)}" alt="" loading="lazy">` : ""}
        </span>
        <div>
          ${available ? `<a class="match-name" href="/item-details?id=${encodeURIComponent(item.id)}">${itemName}</a>` : `<span class="match-name">${itemName}</span>`}
          ${metadata ? `<span class="match-sub">${metadata}</span>` : ""}
          ${details ? `<span class="match-sub">${details}</span>` : ""}
        </div>
        ${score === null ? "" : `<span class="match-score"><span class="visually-hidden">Match score: </span>${score}%</span>`}
      </div>
      ${item.description ? `<p class="match-description">${escapeText(item.description)}</p>` : ""}
      ${score === null ? "" : `<span class="match-bar" aria-hidden="true"><span style="width: ${score}%"></span></span>`}
    </div>`;
}

const messageLink = (itemId) =>
  `<a class="btn btn-outline btn-block" href="/messages${itemId ? `?item=${encodeURIComponent(itemId)}` : ""}">Message SWAFO</a>`;
const cancelButton = (entry) => entry.canDelete
  ? '<button type="button" class="btn-link btn-cancel" data-action="cancel">Cancel this report</button>' : "";

function possibleMatchHTML(entry) {
  const { item } = entry;
  const claimable = item.status === "pending" || item.status === "matched";
  return `
    <h3 class="detail-label">Possible match</h3>
    ${matchCardHTML(entry)}
    <div class="detail-actions">
      ${claimable
        ? `<a class="btn btn-primary btn-block" href="/claim?id=${encodeURIComponent(item.id)}&amp;lostReport=${encodeURIComponent(entry.id)}">Verify and claim</a>`
        : messageLink(item.id)}
      <button type="button" class="btn btn-outline btn-block" data-action="not-mine">Not mine</button>
      ${cancelButton(entry)}
    </div>
    ${claimable ? "" : '<p class="detail-note">This item is currently unavailable for a new claim.</p>'}`;
}

function claimSideHTML(entry, stage) {
  const { item, claim } = entry;
  const office = state.office || {};
  const officeName = escapeText(office.name || "SWAFO office");
  const officePlace = office.location ? `, ${escapeText(office.location)}` : "";
  const pickupHours = office.pickupHours ? ` (${escapeText(office.pickupHours)})` : "";
  const text = {
    review: item?.status === "claimed" ? "SWAFO marked the item as claimed. Contact SWAFO about the status of your claim."
      : "SWAFO is checking your claim. You can message SWAFO if you have more information.",
    rejected: "SWAFO couldn't verify that this item is yours. If you have more proof, send them a message.",
    ready: `Your claim was approved. Pick it up at the ${officeName}${officePlace}${pickupHours}. Bring your school ID and claim no. ${escapeText(claim.id)}.`,
    claimed: "SWAFO marked the item as picked up.",
  }[stage] || "Message SWAFO if you need an update on this claim.";
  return `
    <h3 class="detail-label">${entry.type === "lost" ? `Linked claim ${escapeText(claim.id)}` : "Item in this claim"}</h3>
    ${item ? matchCardHTML(entry) : ""}
    <p class="detail-box${stage === "ready" ? " is-success" : ""}">${text}</p>
    <div class="detail-actions">
      ${stage === "claimed" ? "" : messageLink(item?.id)}
      ${entry.type === "lost" ? `<a class="btn btn-outline btn-block" href="/my-reports?id=${encodeURIComponent(claim.id)}">View claim</a>` : ""}
      ${cancelButton(entry)}
    </div>`;
}

function foundSideHTML(entry, stage) {
  const text = {
    pending: "Thanks for turning it in. SWAFO is looking for the owner, and you don't need to do anything else.",
    ownerFound: "SWAFO found a possible owner and will verify their claim before handing the item over.",
    ready: "SWAFO marked this item ready for claim.",
    returned: "SWAFO returned this item to its owner. Thank you for turning it in!",
  }[stage];
  return `
    <h3 class="detail-label">What happens next</h3>
    <p class="detail-box">${text}</p>
    ${stage === "returned" ? "" : `<div class="detail-actions">${messageLink(entry.id)}</div>`}`;
}

function noMatchHTML(entry) {
  return `
    <h3 class="detail-label">Possible match</h3>
    <div class="match-card match-empty">
      <p><strong>No match yet</strong></p>
      <p>SWAFO compares new found items with your report. A match will show up here.</p>
    </div>
    <div class="detail-actions">
      <a class="btn btn-outline btn-block" href="/browse">Browse found items</a>
      ${cancelButton(entry)}
    </div>`;
}

function sideHTML(entry, stage) {
  if (entry.type === "found") return foundSideHTML(entry, stage);
  if (entry.claim) return claimSideHTML(entry, stage);
  if (entry.match && entry.item) return possibleMatchHTML(entry);
  if (stage === "ready" || stage === "claimed") {
    return `<h3 class="detail-label">What happens next</h3>
      <p class="detail-box">SWAFO marked your report as ${stage === "ready" ? "ready for claim" : "claimed"}.</p>
      <div class="detail-actions">${messageLink(entry.id)}</div>`;
  }
  return noMatchHTML(entry);
}

function detailMeta(entry) {
  const what = entry.type === "claim" ? "Claim submitted" : TYPE_LABELS[entry.type];
  const place = entry.type === "claim" ? shortDate(entry.date) : where(entry);
  return [entry.id, what, place].filter(Boolean).map(escapeText).join(" &middot; ");
}

/* ---------- Rendering ---------- */

function renderFilters() {
  els.filters.innerHTML = FILTERS.map(({ key, label, test }) => `
    <button type="button" class="report-filter" data-filter="${key}" aria-pressed="${key === state.filter}">
      ${label} &middot; ${state.entries.filter(test).length}
    </button>`).join("");
}

function renderSelectionControls(visible = visibleEntries()) {
  const { selecting, selectedReports } = state;
  const busy = state.deleting || state.dismissingMatch;
  const eligible = visible.filter((entry) => entry.canDelete);
  const selectedInView = eligible.filter((entry) => selectedReports.has(entry.id)).length;
  const outside = selectedReports.size - selectedInView;
  const countText = `${selectedReports.size} selected${outside ? ` (${outside} outside this filter)` : ""}. Only pending reports without claims can be deleted.`;
  els.selection.hidden = !state.entries.some((entry) => entry.type !== "claim");
  els.selectionToggle.setAttribute("aria-expanded", String(selecting));
  els.selectionToggle.textContent = selecting ? "Done selecting" : "Select reports";
  els.selectionToggle.disabled = busy;
  els.selectionActions.hidden = !selecting;
  if (els.selectionCount.textContent !== countText) els.selectionCount.textContent = countText;
  els.selectAll.disabled = busy || !eligible.length;
  els.clearSelection.disabled = busy || !selectedReports.size;
  els.deleteSelected.disabled = busy || !selectedReports.size;
  els.list.querySelectorAll("[data-report-select]").forEach((box) => {
    box.checked = selectedReports.has(box.dataset.reportSelect);
    box.disabled = busy;
  });
  els.detail.querySelectorAll('[data-action="cancel"], [data-action="not-mine"]').forEach((button) => {
    button.disabled = busy;
  });
}

function renderList(entries) {
  els.list.classList.toggle("is-selecting", state.selecting);
  if (!entries.length) {
    els.list.innerHTML = '<li class="report-list-empty">Nothing here right now.</li>';
    return;
  }
  els.list.innerHTML = entries.map((entry) => {
    const linkedClaim = entry.type === "lost" && entry.claim?.id ? `Claim ${entry.claim.id}` : "";
    const meta = [TYPE_LABELS[entry.type], where(entry), shortDate(entry.date), entry.id, linkedClaim]
      .filter(Boolean).map(escapeText).join(" &middot; ");
    return `
      <li class="report-select-row">
        ${state.selecting && entry.canDelete ? `<input type="checkbox" class="report-select-checkbox" data-report-select="${escapeText(entry.id)}" aria-label="Select ${escapeText(entry.name)}, ${escapeText(entry.id)}">` : ""}
        <button type="button" class="report-card" data-id="${escapeText(entry.id)}"${entry.id === state.selectedId ? ' aria-current="true"' : ""}>
          ${tile(entry, entry)}
          <span>
            <span class="report-card-title">${escapeText(entry.name)}</span>
            <span class="report-card-meta">${meta}</span>
          </span>
          ${badgeHTML(stageOf(entry))}
        </button>
      </li>`;
  }).join("");
}

function renderDetail() {
  const entry = selectedEntry();
  els.detail.hidden = !entry;
  if (!entry) {
    els.detail.replaceChildren();
    return;
  }
  const stage = stageOf(entry);
  els.detail.innerHTML = `
    <header class="detail-head">
      ${tile(entry, entry, 28)}
      <div>
        <h2 id="detail-title" tabindex="-1">${escapeText(entry.name)}</h2>
        <p class="detail-meta">${detailMeta(entry)}</p>
      </div>
      ${badgeHTML(stage)}
    </header>
    <div class="detail-body">
      <div>
        <h3 class="detail-label">Progress</h3>
        ${timelineHTML(stepsFor(entry, stage))}
      </div>
      <div class="detail-side">${sideHTML(entry, stage)}</div>
    </div>`;
}

// The list and details for the current filter. Keeps the selection if it's still listed.
function renderView() {
  const visible = visibleEntries();
  if (!visible.some((entry) => entry.id === state.selectedId)) state.selectedId = visible[0]?.id ?? null;
  renderList(visible);
  renderDetail();
  renderSelectionControls(visible);
}

function render() {
  const hasEntries = state.entries.length > 0;
  els.empty.hidden = hasEntries;
  els.filters.hidden = !hasEntries;
  els.layout.hidden = !hasEntries;
  if (!hasEntries) {
    state.selecting = false;
    renderView();
    return;
  }
  renderFilters();
  renderView();
}

const focusDetail = () => document.getElementById("detail-title")?.focus({ preventScroll: true });

function setNotice(message, error = false) {
  els.notice.classList.toggle("is-error", error);
  els.notice.textContent = message;
}

// Fetches again after a change. Re-rendering replaces the buttons, so focus goes back to the
// same filter or report if it was on one.
async function load({ initial = false } = {}) {
  const version = ++loadVersion;
  const entries = await UserAPI.getMyReports();
  if (version !== loadVersion) return;
  const focusAttributes = ["data-id", "data-filter", "data-report-select", "data-action"];
  const focused = document.activeElement?.closest(focusAttributes.map((name) => `[${name}]`).join(", "));
  const attribute = focused && focusAttributes.find((name) => focused.hasAttribute(name));
  const eligible = new Set(entries.filter((entry) => entry.canDelete).map((entry) => entry.id));
  const previousCount = state.selectedReports.size;
  state.selectedReports = new Set([...state.selectedReports].filter((id) => eligible.has(id)));
  state.entries = entries;
  if (initial) state.selectedId = initialSelection();
  render();
  if (state.selectedReports.size !== previousCount && !state.deleting) {
    setNotice("Some selected reports changed. Review the current selection before deleting.", true);
  }
  if (attribute) {
    const restored = document.querySelector(`[${attribute}="${CSS.escape(focused.getAttribute(attribute))}"]`);
    const fallback = els.layout.hidden ? document.getElementById("reports-empty-title") : els.list.querySelector(".report-card");
    (restored || fallback)?.focus();
  }
}

function focusAfterDeletion() {
  if (state.selecting && !els.selectAll.disabled) els.selectAll.focus();
  else if (selectedEntry()) focusDetail();
  else if (!els.selection.hidden) els.selectionToggle.focus();
  else if (!els.empty.hidden) document.getElementById("reports-empty-title").focus();
}

async function deleteEntries(references, request, successMessage) {
  state.deleting = true;
  loadVersion++; // Ignore a poll that started before the deletion.
  setNotice("");
  renderSelectionControls();
  let moveFocus = false;
  try {
    const result = await request();
    if (result?.success !== true) throw new Error("server");
    const deleted = new Set(references);
    state.entries = state.entries.filter((entry) => !deleted.has(entry.id));
    references.forEach((id) => state.selectedReports.delete(id));
    render();
    setNotice(successMessage);
    moveFocus = true;
    await load().catch(() => {}); // The server already confirmed the deletion.
  } catch (error) {
    if (error.message === "not_pending" || error.message === "not_found") {
      try {
        await load();
        setNotice("Some reports changed. Only pending reports without claims can be deleted. Review the selection and try again.", true);
      } catch {
        setNotice("Some reports changed. Refresh this page before trying to delete again.", true);
      }
      moveFocus = true;
    } else {
      const messages = {
        invalid_selection: "Choose at least one pending report without claims.",
        login_required: "Please log in again before deleting any reports.",
        database_error: "The server couldn't save the deletion. Try again.",
      };
      setNotice(messages[error.message] || "Couldn't confirm the deletion. Check your connection and try again.", true);
    }
  } finally {
    state.deleting = false;
    renderSelectionControls();
    if (moveFocus) focusAfterDeletion();
  }
}

async function dismissSuggestion(entry) {
  const foundReference = entry.item.id;
  state.dismissingMatch = true;
  loadVersion++; // An earlier poll may still contain this suggestion.
  setNotice("");
  renderSelectionControls();
  try {
    await UserAPI.dismissMatch(entry.id, foundReference);
    try {
      await load();
      setNotice("This suggestion was dismissed.");
    } catch {
      state.entries = state.entries.map((report) => (
        report.id === entry.id && report.item?.id === foundReference && report.match
          ? { ...report, match: null, item: null } : report
      ));
      render();
      setNotice("This suggestion was dismissed. Refresh to check for other matches.");
    }
  } catch (error) {
    if (error.message === "not_found" || error.message === "report_has_claim") {
      await load().catch(() => {});
      setNotice("This suggestion or report changed. Review your latest reports before trying again.", true);
    } else {
      const message = error.message === "login_required" ? "Log in again to dismiss this suggestion."
        : "Couldn't dismiss this suggestion. Try again.";
      setNotice(message, true);
    }
  } finally {
    state.dismissingMatch = false;
    renderSelectionControls();
    if (state.selectedId) focusDetail();
    else els.filters.querySelector(`[data-filter="${state.filter}"]`)?.focus();
  }
}

/* ---------- Events ---------- */

els.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filters.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  renderView();
});

els.selectionToggle.addEventListener("click", () => {
  state.selecting = !state.selecting;
  if (!state.selecting) state.selectedReports.clear();
  renderView();
});

els.selectAll.addEventListener("click", () => {
  visibleEntries().filter((entry) => entry.canDelete).forEach((entry) => state.selectedReports.add(entry.id));
  renderSelectionControls();
});

els.clearSelection.addEventListener("click", () => {
  state.selectedReports.clear();
  renderSelectionControls();
  (els.selectAll.disabled ? els.selectionToggle : els.selectAll).focus();
});

els.deleteSelected.addEventListener("click", () => {
  const references = [...state.selectedReports];
  if (state.deleting || state.dismissingMatch || !references.length) return;
  const reports = `${references.length} ${references.length === 1 ? "report" : "reports"}`;
  if (!window.confirm(`Permanently delete ${reports}? This cannot be undone.`)) return;
  deleteEntries(references, () => UserAPI.deleteReports(references), `Deleted ${reports}.`);
});

els.list.addEventListener("change", (event) => {
  const box = event.target.closest("[data-report-select]");
  if (!box || state.deleting || state.dismissingMatch) return;
  const id = box.dataset.reportSelect;
  if (box.checked) state.selectedReports.add(id);
  else state.selectedReports.delete(id);
  renderSelectionControls();
});

els.list.addEventListener("click", (event) => {
  const card = event.target.closest(".report-card");
  if (!card) return;
  state.selectedId = card.dataset.id;
  els.list.querySelectorAll(".report-card").forEach((c) => {
    if (c === card) c.setAttribute("aria-current", "true");
    else c.removeAttribute("aria-current");
  });
  setNotice("");
  renderDetail();
  renderSelectionControls();
  // On a phone the details are above the list, so take the student back up to them.
  if (isNarrow()) {
    els.detail.scrollIntoView({ behavior: "smooth", block: "start" });
    focusDetail();
  }
});

els.detail.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const entry = selectedEntry();
  if (!action || !entry || state.deleting || state.dismissingMatch) return;
  const name = entry.name.toLowerCase();

  if (action === "not-mine") {
    if (!entry.match || !entry.item) return;
    if (!window.confirm(`Dismiss the suggestion for ${entry.item.name || "this found item"}? Your lost report stays open.`)) return;
    dismissSuggestion(entry);
  }

  if (action === "cancel") {
    if (!entry.canDelete) return;
    if (!window.confirm(`Cancel your report for the ${name}? SWAFO will stop looking for it.`)) return;
    deleteEntries([entry.id], () => UserAPI.cancelReport(entry.id), `Your ${name} report was cancelled.`);
  }
});

els.detail.addEventListener("error", (event) => {
  if (event.target.matches(".match-photo")) event.target.hidden = true;
}, true);

/* ---------- Start ---------- */

// my-reports.html?id= can name the report, the student's claim, or the found item.
function initialSelection() {
  const id = new URLSearchParams(window.location.search).get("id");
  const linked = id && (state.entries.find((entry) => entry.id === id)
    || state.entries.find((entry) => entry.claim?.id === id || entry.item?.id === id));
  return (linked || state.entries.find((entry) => entry.match && entry.item) || state.entries[0])?.id ?? null;
}

UserAPI.getOffice().then((office) => {
  state.office = office;
  return load({ initial: true });
}).catch(() => {
  setNotice("Couldn't load your reports. Check that FindIt is running and refresh the page.", true);
});

UserAPI.onReportsChange(() => {
  if (!state.deleting && !state.dismissingMatch) load().catch(() => {});
});
