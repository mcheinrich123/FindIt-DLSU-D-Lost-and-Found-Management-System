const ACCOUNT_KEY = "findit.account-settings.v1";
const DEFAULT_NOTIFICATIONS = { match: true, message: true, status: true, email: false };

function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) || {};
  } catch {
    return {};
  }
}

// Throws if storage is blocked or full (a big photo); the callers turn that into an error toast.
function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
}

if (new URLSearchParams(window.location.search).has("reset-demo")) {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // storage blocked, nothing to reset
  }
}

const AccountAPI = {
    async getAccount() {
    const session = await Auth.getSession();
    const saved = readAccounts()[session.email] || {};
    return {
      name: session.name,
      email: session.email,
      phone: session.phone || "",
      photo: session.photo || null,
      notifications: { ...DEFAULT_NOTIFICATIONS, ...saved.notifications },
    };
  },

  async saveProfile({ name, phone, photo }) {
    let response;
    try {
      response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, phone, photo }),
      });
    } catch {
      throw new Error("Couldn't reach the server.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const errors = {
        login_required: "Please log in again to save your profile.",
        bad_image: "Couldn't save that profile photo. Choose another image.",
        file_too_large: "Your profile photo is too large. Choose a smaller image.",
        database_error: "The server couldn't save your profile. Check that the database folder is writable.",
      };
      const code = response.status === 413 ? "file_too_large" : data?.error;
      throw new Error(errors[code] || "Couldn't save your profile. Try again.");
    }
  },

  async changePassword(currentPassword, newPassword) {
  let response;
  try {
    response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  } catch {
    throw new Error("network");
  }
  if (response.status === 403) return { error: "wrong-password" }; // shows "That's not your current password."
  if (!response.ok) throw new Error("Couldn't update your password. Try again.");
  return {};
},

  async saveNotifications(notifications) {
    const { email } = await Auth.getSession();
    const accounts = readAccounts();
    accounts[email] = { ...accounts[email], notifications };
    writeAccounts(accounts);
  },

  async deleteAccount() {
    const { email } = await Auth.getSession();
    const accounts = readAccounts();
    delete accounts[email];
    writeAccounts(accounts);
    await Auth.logout();
  },
};

const CHECK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>';
const STORAGE_ERROR = "Couldn't save. Browser storage may be full or blocked.";

const toastRegion = document.getElementById("toast-region");

function showToast(message, { error = false } = {}) {
  const toast = document.createElement("p");
  toast.className = error ? "toast toast-error" : "toast";
  toast.innerHTML = `${error ? "" : CHECK_ICON}<span>${escapeText(message)}</span>`;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Shows a message under a field (or clears it with ""), and marks the field invalid.
function setError(field, message) {
  const error = document.getElementById(`${field.id}-error`);
  error.textContent = message;
  error.hidden = !message;
  if (message) field.setAttribute("aria-invalid", "true");
  else field.removeAttribute("aria-invalid");
}

// checks: Map of field -> (value) => error message, or "" when it's fine. Shows every error and
// focuses the first bad field. Returns true when everything passes.
function validate(checks) {
  let firstInvalid = null;
  checks.forEach((check, field) => {
    const message = check(field.value);
    setError(field, message);
    if (message && !firstInvalid) firstInvalid = field;
  });
  firstInvalid?.focus();
  return !firstInvalid;
}

// Errors appear on submit; while typing they only clear once the field is fixed.
function clearErrorsWhileTyping(form, checks) {
  form.addEventListener("input", () => {
    checks.forEach((check, field) => {
      if (field.getAttribute("aria-invalid") === "true") setError(field, check(field.value));
    });
  });
}

function submitButtonOf(form) {
  return form.querySelector('[type="submit"]');
}

const navLinks = document.querySelectorAll(".settings-nav a");
const sections = document.querySelectorAll(".settings-section");

function showSection(id, { focus = false } = {}) {
  const section = [...sections].find((s) => s.id === id) || sections[0];
  sections.forEach((s) => s.classList.toggle("is-active", s === section));
  navLinks.forEach((link) => {
    if (link.hash === `#${section.id}`) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  if (focus) section.querySelector("h2").focus();
}

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    history.replaceState(null, "", link.hash);
    showSection(link.hash.slice(1), { focus: true });
  });
});

// settings.html#account (or #notifications, ...) opens that section
window.addEventListener("hashchange", () => showSection(window.location.hash.slice(1)));
showSection(window.location.hash.slice(1));

/* ---------- Profile ---------- */

const profileForm = document.getElementById("profile-form");
const nameInput = document.getElementById("full-name");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photo-preview");
const photoPick = document.getElementById("photo-pick");
const photoRemove = document.getElementById("photo-remove");
const photoError = document.getElementById("photo-error");

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
let photo = null; // what the preview shows; saved with "Save changes"
let profilePhotoSelection = 0;
let profilePhotoPending = false;

// 7 to 15 digits, with optional +, spaces, dashes and brackets: 0917 123 4567, +63 917 123 4567, (046) 481-1900
const isPhoneNumber = (value) => /^\+?[\d\s()-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ""));

const profileChecks = new Map([
  [nameInput, (value) => (value.trim().length < 2 ? "Enter your full name." : "")],
  [phoneInput, (value) => (value.trim() && !isPhoneNumber(value.trim()) ? "Enter a valid contact number, like 0917 123 4567." : "")],
]);

function renderPhoto() {
  if (photo) {
    const img = document.createElement("img");
    img.src = photo;
    img.alt = "Your profile photo";
    photoPreview.replaceChildren(img);
  } else {
    const name = nameInput.value.trim();
    photoPreview.innerHTML = `<span aria-hidden="true">${name ? escapeText(Auth.initials(name)) : ""}</span>`;
  }
  photoPick.textContent = photo ? "Change photo" : "Upload photo";
  photoRemove.hidden = !photo;
}

function showPhotoError(message) {
  photoError.textContent = message;
  photoError.hidden = !message;
}

photoPick.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", () => {
  const selection = ++profilePhotoSelection;
  const file = photoInput.files[0];
  photoInput.value = ""; // so choosing the same file again still counts as a change
  profilePhotoPending = false;
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    showPhotoError("Choose an image file (JPG, PNG, or WebP).");
    return;
  }
  if (!file.size) {
    showPhotoError("That photo is empty. Choose another one.");
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    showPhotoError("That photo is over 5 MB. Choose a smaller one.");
    return;
  }
  showPhotoError("");
  profilePhotoPending = true;
  Photos.shrink(file, 320)
    .then((src) => {
      if (selection !== profilePhotoSelection) return;
      photo = src;
      showPhotoError("");
      renderPhoto();
    })
    .catch(() => {
      if (selection === profilePhotoSelection) showPhotoError("Couldn't read that image. Try another one.");
    })
    .finally(() => {
      if (selection === profilePhotoSelection) profilePhotoPending = false;
    });
});

photoRemove.addEventListener("click", () => {
  profilePhotoSelection++;
  profilePhotoPending = false;
  photo = null;
  showPhotoError("");
  renderPhoto();
  photoPick.focus(); // the Remove button just disappeared
});

// Without a photo the preview shows the initials, so keep them in step with the name.
nameInput.addEventListener("input", () => {
  if (!photo) renderPhoto();
});

function refreshNavbarName(name, photo) {
  const avatar = document.getElementById("account-btn");
  const accountName = document.querySelector(".account-head strong");
  if (avatar) {
    if (photo) {
      const img = document.createElement("img");
      img.src = photo;
      img.alt = "";
      img.className = "avatar-img";
      avatar.replaceChildren(img);
    } else {
      avatar.textContent = Auth.initials(name);
    }
  }
  if (accountName) accountName.textContent = name;
}

clearErrorsWhileTyping(profileForm, profileChecks);

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const button = submitButtonOf(profileForm);
  if (button.disabled) return;
  if (profilePhotoPending) {
    showPhotoError("Wait for the photo preview, then save your profile.");
    return;
  }
  if (!validate(profileChecks)) return;

  const name = nameInput.value.trim();
  const savedPhoto = photo;
  button.disabled = true;
  AccountAPI.saveProfile({ name, phone: phoneInput.value.trim(), photo: savedPhoto })
    .then(() => {
      refreshNavbarName(name, savedPhoto);
      showToast("Profile saved.");
    })
    .catch((error) => showToast(
      // DOMException = localStorage failure (full or blocked); anything else carries its own message
      error instanceof DOMException ? STORAGE_ERROR : error.message,
      { error: true }
    ))
    .finally(() => {
      button.disabled = false;
    });
});

/* ---------- Account: change password ---------- */

const passwordForm = document.getElementById("password-form");
const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const confirmPasswordInput = document.getElementById("confirm-password");

const passwordChecks = new Map([
  [currentPasswordInput, (value) => (value ? "" : "Enter your current password.")],
  [newPasswordInput, (value) => {
    if (!value) return "Enter a new password.";
    if (value.length < 8) return "Use at least 8 characters.";
    if (value === currentPasswordInput.value) return "Choose a password that's different from your current one.";
    return "";
  }],
  [confirmPasswordInput, (value) => {
    if (!value) return "Type your new password again.";
    return value === newPasswordInput.value ? "" : "Passwords don't match.";
  }],
]);

clearErrorsWhileTyping(passwordForm, passwordChecks);

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validate(passwordChecks)) return;

  const button = submitButtonOf(passwordForm);
  button.disabled = true;
  AccountAPI.changePassword(currentPasswordInput.value, newPasswordInput.value)
    .then(({ error }) => {
      if (error) {
        setError(currentPasswordInput, "That's not your current password.");
        currentPasswordInput.focus();
        return;
      }
      passwordForm.reset();
      showToast("Password updated.");
    })
    .catch((error) => showToast(
      error.message === "network" ? "Couldn't reach the server." : error.message,
      { error: true }
    ))
    .finally(() => {
      button.disabled = false;
    });
});

/* ---------- Notifications ---------- */

const notificationSwitches = document.getElementById("notification-switches");
const switches = notificationSwitches.querySelectorAll(".switch");

// Saves as soon as a switch changes (like the admin Settings page); puts it back if that fails.
notificationSwitches.addEventListener("change", (event) => {
  const changed = event.target;
  const notifications = Object.fromEntries([...switches].map((s) => [s.name, s.checked]));
  AccountAPI.saveNotifications(notifications)
    .then(() => showToast("Notification settings saved."))
    .catch(() => {
      changed.checked = !changed.checked;
      showToast(STORAGE_ERROR, { error: true });
    });
});

/* ---------- Danger zone: delete account ---------- */

const deleteDialog = document.getElementById("delete-dialog");
const deleteOpen = document.getElementById("delete-open");
const deleteConfirm = document.getElementById("delete-confirm");
const deleteError = document.getElementById("delete-error");

// showModal() keeps focus inside the dialog, and Escape closes it.
deleteOpen.addEventListener("click", () => {
  deleteError.hidden = true;
  deleteDialog.showModal();
});

document.getElementById("delete-cancel").addEventListener("click", () => deleteDialog.close());

// A click on the dark backdrop (outside .modal-body) closes it too.
deleteDialog.addEventListener("click", (event) => {
  if (event.target === deleteDialog) deleteDialog.close();
});

deleteDialog.addEventListener("close", () => deleteOpen.focus());

deleteConfirm.addEventListener("click", () => {
  deleteConfirm.disabled = true;
  AccountAPI.deleteAccount()
    .then(() => window.location.replace("index.html"))
    .catch(() => {
      deleteError.textContent = "Couldn't delete your account. Try again.";
      deleteError.hidden = false;
      deleteConfirm.disabled = false;
    });
});

/* ---------- Load ---------- */

// No session means settings.html is already on its way to the login page.
Auth.getSession().then((session) => {
  if (!session || !session.role) return;
  return AccountAPI.getAccount().then((account) => {
    nameInput.value = account.name;
    emailInput.value = account.email;
    phoneInput.value = account.phone;
    document.getElementById("password-username").setAttribute("value", account.email); // survives form.reset()
    photo = account.photo;
    renderPhoto();
    switches.forEach((s) => {
      s.checked = Boolean(account.notifications[s.name]);
    });
  });
}).catch(() => showToast("Couldn't load your account.", { error: true }));
