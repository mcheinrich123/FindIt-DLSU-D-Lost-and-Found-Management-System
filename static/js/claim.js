// Claim page: shows the found item in ?id= (from the database, ./items-api.js) next to the form,
// sends the claim to Flask (POST /api/claims, reviewed on the admin Claims page) and swaps the
// form for a confirmation.

const claimForm = document.querySelector("#claim-form");
const claimSuccess = document.querySelector("#claim-success");
const submitButton = claimForm.querySelector('[type="submit"]');
const proofInput = claimForm.querySelector("#proof");
const claimError = document.querySelector("#claim-error");
const MAX_PROOF_FILES = 5;
const CLAIM_MAX_BYTES = 10 * 1024 * 1024;

const claimParams = new URLSearchParams(window.location.search);
const claimId = claimParams.get("id");
const lostReport = claimParams.get("lostReport");
const reportLink = lostReport ? `/my-reports?id=${encodeURIComponent(lostReport)}` : null;
let claimItem = null;

const ERROR_MESSAGES = {
  login_required: "Please log in to submit a claim.",
  item_unavailable: "This item is no longer available to claim. It may be reserved or already returned.",
  report_unavailable: "This lost report is no longer open. Check its status in My Reports.",
  report_has_claim: "You already have a claim for this lost report. Track it in My Reports.",
  own_item: "You reported finding this item. You can follow its status in My Reports.",
  missing_fields: "Please describe the item and tick the box to certify that it's yours.",
  invalid_date: "That date isn't valid.",
  duplicate_claim: "You've already sent a claim for this item. You can follow it on My Reports.",
  bad_file_type: "Supporting files must be images (PNG, JPG, GIF or WebP) or PDFs.",
  empty_file: "One of your supporting files is empty. Select your files again.",
  too_many_files: "Choose at most five supporting files.",
  file_too_large: "The claim including its files must be under 10 MB. Choose smaller files.",
  upload_error: "The server couldn't save your supporting files. Check that the uploads folder is writable.",
  database_error: "The server couldn't save your claim. Check that the database folder is writable.",
  network: "Couldn't reach FindIt. Check that the server is running and try again.",
};

const BLOCKED_CLAIMS = new Set(["item_unavailable", "report_unavailable", "report_has_claim", "duplicate_claim", "own_item"]);

function setClaimError(message, { focus = false } = {}) {
  claimError.textContent = message;
  claimError.hidden = !message;
  if (message && focus) claimError.focus();
}

function isOpenFoundItem(item) {
  return item?.type === "found" && (item.status === "pending" || item.status === "matched");
}

function checkProofFiles(files) {
  if (files.length > MAX_PROOF_FILES) return "too_many_files";
  if (files.some((file) => !/\.(?:jpe?g|png|gif|webp|pdf)$/i.test(file.name))) return "bad_file_type";
  if (files.some((file) => !file.size)) return "empty_file";
  if (files.reduce((total, file) => total + file.size, 0) >= CLAIM_MAX_BYTES) return "file_too_large";
  return "";
}

function showItem(item) {
  const detailsLink = `/item-details?id=${encodeURIComponent(item.id)}`;
  document.title = `FindIt | Claim ${item.name}`;
  document.querySelector("#crumb-item").textContent = item.name;
  document.querySelector("#crumb-item").href = detailsLink;
  document.querySelector("#claim-cancel").href = reportLink || detailsLink;
  document.querySelector("#summary-heading").textContent = item.name;
  document.querySelector("#summary-ref").textContent = item.id;
  document.querySelector("#summary-found").textContent = Locations.label(item.locationId, item.locationOther);
  if (item.image) document.querySelector("#summary-img").src = item.image;

  const date = document.querySelector("#summary-date");
  date.dateTime = item.dateFound;
  date.textContent = new Date(`${item.dateFound}T00:00:00`)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function loadItem() {
  if (reportLink) document.querySelector("#claim-cancel").href = reportLink;
  if (lostReport && !claimId) {
    setClaimError(ERROR_MESSAGES.item_unavailable);
    return;
  }
  try {
    // Older general claim links select the newest available item. Linked claims need their item ID.
    const item = claimId ? await ItemsAPI.get(claimId) : (await ItemsAPI.available()).find(isOpenFoundItem);
    if (item?.type === "found") showItem(item);
    if (!isOpenFoundItem(item)) {
      setClaimError(ERROR_MESSAGES.item_unavailable);
      return;
    }
    claimItem = item;
    submitButton.disabled = false;
  } catch {
    setClaimError("Couldn't load this item. Refresh to try again.");
  }
}

claimForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!claimItem || submitButton.disabled) return;

  const proofError = checkProofFiles([...proofInput.files]);
  if (proofError) {
    setClaimError(ERROR_MESSAGES[proofError], { focus: true });
    return;
  }

  setClaimError("");
  submitButton.disabled = true;
  try {
    const form = new FormData(claimForm);
    form.set("itemId", claimItem.id);
    if (lostReport) form.set("lostReportId", lostReport);
    const response = await fetch("/api/claims", { method: "POST", credentials: "same-origin", body: form })
      .catch(() => { throw new Error("network"); });
    const result = await response.json().catch(() => ({}));
    if (response.status === 413) throw new Error("file_too_large");
    if (!response.ok || !result?.reference) throw new Error(result?.error || "server");

    document.querySelector("#track-claim").href = `/my-reports?id=${encodeURIComponent(result.reference)}`;
    claimForm.hidden = true;
    claimSuccess.hidden = false;
    claimSuccess.focus();
  } catch (error) {
    setClaimError(ERROR_MESSAGES[error.message] || "Couldn't submit your claim. Try again.", { focus: true });
    submitButton.disabled = BLOCKED_CLAIMS.has(error.message);
  }
});

loadItem();
