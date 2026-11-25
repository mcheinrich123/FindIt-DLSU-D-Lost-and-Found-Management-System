const reportForm = document.querySelector("#report-form");
const photoInput = reportForm.querySelector("#photo");
const photoPreview = reportForm.querySelector("#photo-preview");
const reportSubmit = reportForm.querySelector('[type="submit"]');
const REPORT_MAX_BYTES = 10 * 1024 * 1024;
const reportErrors = {
  login_required: "Please log in to submit a report.",
  missing_fields: "Please fill in all the required fields.",
  invalid_type: "Choose whether you lost or found the item.",
  invalid_category: "Please choose a category.",
  invalid_date: "That date isn't valid.",
  future_date: "The date can't be in the future.",
  photo_required: "Please add a photo of the item you found.",
  bad_file_type: "The photo must be a PNG, JPG, GIF or WebP image.",
  empty_file: "The selected photo is empty. Choose another photo.",
  file_too_large: "The report including its photo must be under 10 MB. Choose a smaller photo.",
  upload_error: "The server couldn't save your photo. Check that the uploads folder is writable.",
  database_error: "The server couldn't save your report. Check that the database folder is writable.",
  network: "Couldn't reach FindIt. Check that the server is running and try again.",
};
let photoPreviewError = "";
let photoPreviewPending = false;
let photoSelection = 0;
 
function setReportType(type) {
  photoInput.required = type === "found";
  // Swap wording that differs between lost and found reports.
  reportForm.querySelectorAll("[data-lost]").forEach((el) => {
    el.textContent = el.dataset[type];
  });
 
  // Show fields that only apply to one type. Disabled fields are left out of the submission.
  reportForm.querySelectorAll("[data-show-for]").forEach((group) => {
    const hidden = group.dataset.showFor !== type;
    group.hidden = hidden;
    group.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = hidden;
    });
  });
}
 
// Category and location lists are shared with Browse and the admin (../js/item-store.js and
// ../js/data/locations.js). "Other / Not sure" shows a box to describe the place.
reportForm.querySelector("#category").insertAdjacentHTML("beforeend",
  ItemStore.categories.map((value) => `<option value="${escapeText(value)}">${escapeText(value)}</option>`).join(""));
 
// The location list depends on the campus picked first. The campus select has no name, so only
// locationId is submitted, same as before.
const campusSelect = reportForm.querySelector("#campus");
const locationSelect = reportForm.querySelector("#location");
const syncOther = Locations.watchOther(locationSelect, reportForm.querySelector("#location-other-group"));
 
function fillLocations(campus, selected = "") {
  if (!campus) {
    locationSelect.innerHTML = '<option value="">Select a campus first</option>';
    locationSelect.disabled = true;
  } else {
    locationSelect.innerHTML = '<option value="">Select a location</option>' + Locations.optionsForCampus(campus, selected);
    locationSelect.disabled = false;
    // "Other / Not sure" has only one choice, so pick it for them and show the describe box.
    if (campus === "other") locationSelect.value = Locations.OTHER;
  }
  syncOther();
}
 
campusSelect.addEventListener("change", () => fillLocations(campusSelect.value));
// After the form is reset the campus goes back to blank, so the location list has to follow.
reportForm.addEventListener("reset", () => setTimeout(() => fillLocations(campusSelect.value)));
fillLocations(campusSelect.value); // in case the browser restored the campus on reload
 
reportForm.querySelectorAll("input[name='type']").forEach((input) => {
  input.addEventListener("change", () => setReportType(input.value));
});
 
// report.html links here with ?type=lost or ?type=found.
const initialType = new URLSearchParams(window.location.search).get("type") === "found" ? "found" : "lost";
reportForm.querySelector(`input[name='type'][value='${initialType}']`).checked = true;
setReportType(initialType);
 
photoInput.addEventListener("change", () => {
  const selection = ++photoSelection;
  const [file] = photoInput.files;
  photoPreviewError = "";
  photoPreviewPending = false;
  photoPreview.replaceChildren();
  photoPreview.hidden = true;
  if (!file) return;

  if (!/\.(?:jpe?g|png|gif|webp)$/i.test(file.name)) photoPreviewError = "bad_file_type";
  else if (!file.size) photoPreviewError = "empty_file";
  else if (file.size >= REPORT_MAX_BYTES) photoPreviewError = "file_too_large";
  if (photoPreviewError) {
    alert(reportErrors[photoPreviewError]);
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  photoPreviewPending = true;
  img.alt = "Preview of the selected photo";
  img.onload = () => {
    URL.revokeObjectURL(url);
    if (selection !== photoSelection) return;
    photoPreviewPending = false;
    photoPreview.replaceChildren(img);
    photoPreview.hidden = false;
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (selection !== photoSelection) return;
    photoPreviewPending = false;
    photoPreviewError = "bad_file_type";
    alert("Couldn't read that photo. Choose a PNG, JPG, GIF or WebP image.");
  };
  img.src = url;
});

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (reportSubmit.disabled) return;
  if (photoInput.files.length && photoPreviewPending) {
    alert("Wait for the photo preview, then submit the report.");
    return;
  }
  if (photoInput.files.length && photoPreviewError) {
    alert(reportErrors[photoPreviewError]);
    return;
  }
  reportSubmit.disabled = true;
  try {
    // Disabled fields for the other report type are left out automatically.
    const response = await fetch("/api/items", { method: "POST", body: new FormData(reportForm) })
      .catch(() => { throw new Error("network"); });
    const result = await response.json().catch(() => ({}));
    if (response.status === 413) throw new Error("file_too_large");
    if (!response.ok || !result?.reference) throw new Error(result?.error || "server");
    window.location.href = `/report-submitted?ref=${encodeURIComponent(result.reference)}`;
  } catch (error) {
    alert(reportErrors[error.message] || "Couldn't submit your report. Try again.");
    reportSubmit.disabled = false;
  }
});
