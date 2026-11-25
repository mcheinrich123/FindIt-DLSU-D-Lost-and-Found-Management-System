// Accounts that SWAFO can manage from the Users page.
const usersState = { accounts: [], loaded: false, deleting: false };
const usersSearch = document.querySelector("#topbar-search input");
const usersTable = document.getElementById("users-table");
const usersRows = document.getElementById("users-rows");
const usersSummary = document.getElementById("users-summary");
const usersResult = document.getElementById("users-result");
const usersError = document.getElementById("users-error");
const escapeUserField = (value) => AdminUI.escape(value);

function renderUsers() {
  if (!usersState.loaded) return;
  const query = usersSearch.value.trim().toLowerCase();
  const visible = usersState.accounts.filter((account) =>
    [account.name, account.email, account.schoolId].some((value) => String(value ?? "").toLowerCase().includes(query)));

  usersSummary.textContent = visible.length
    ? `${visible.length} ${visible.length === 1 ? "account" : "accounts"}`
    : (query ? "No matching accounts." : "No student or employee accounts yet.");
  usersTable.hidden = !visible.length;
  usersRows.innerHTML = visible.map((account) => `
    <tr>
      <td>${escapeUserField(account.name)}</td>
      <td>${escapeUserField(account.email)}</td>
      <td>${escapeUserField(account.schoolId)}</td>
      <td class="num">${escapeUserField(account.reportCount)}</td>
      <td class="num">${escapeUserField(account.claimCount)}</td>
      <td class="num">${escapeUserField(account.messageCount)}</td>
      <td><button type="button" class="admin-btn admin-btn-danger" data-delete-user="${escapeUserField(account.id)}"
        aria-label="Delete account for ${escapeUserField(account.name)}">Delete account</button></td>
    </tr>`).join("");
}

async function loadUserAccounts() {
  try {
    usersState.accounts = await AdminAPI.getUsers();
    usersState.loaded = true;
    renderUsers();
  } catch {
    usersSummary.textContent = "Couldn't load the accounts. Refresh to try again.";
  }
}

async function deleteUserAccount(button, account) {
  if (usersState.deleting) return;
  const message = `Permanently delete ${account.name} (${account.email})?\n\n` +
    "This removes the account, their reports, claims, and messages, and any claims on their reports.";
  if (!window.confirm(message)) return;

  usersState.deleting = true;
  button.disabled = true;
  usersResult.hidden = true;
  usersError.hidden = true;
  try {
    await AdminAPI.deleteUser(account.id);
    usersState.accounts = usersState.accounts.filter((entry) => entry.id !== account.id);
    renderUsers();
    usersResult.hidden = false;
    usersResult.textContent = `Account deleted for ${account.name}.`;
    usersResult.focus();
    refreshNavCounts().catch(() => {});
  } catch (error) {
    usersError.hidden = false;
    usersError.textContent = error.message === "not_found"
      ? "This account is no longer available. Refresh to update the list."
      : "Couldn't delete the account. Try again.";
  } finally {
    usersState.deleting = false;
    button.disabled = false;
  }
}

usersSearch.placeholder = "Search names, emails or school IDs…";
usersSearch.setAttribute("aria-label", "Search student and employee accounts");
document.getElementById("topbar-search").addEventListener("submit", (event) => event.preventDefault());
usersSearch.addEventListener("input", renderUsers);
usersRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-user]");
  if (!button) return;
  const account = usersState.accounts.find((entry) => String(entry.id) === button.dataset.deleteUser);
  if (account) deleteUserAccount(button, account);
});

loadUserAccounts();
