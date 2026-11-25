
// FindIt authentication: connects the frontend to the Flask backend.
// The server checks passwords and stores the login session in a signed cookie.
// Never put real account passwords or mock accounts in this file.

const AUTH_API = "/api/auth";

// Words that start a surname, so "Juan Dela Cruz" -> "JD"
// and "Ana De los Santos" -> "AD".
const SURNAME_PREFIXES = [
  "de", "del", "dela", "delos", "los", "la", "las",
  "san", "santa", "sta", "da", "di", "van", "von"
];

async function authRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${AUTH_API}${endpoint}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return { error: data?.error || "server", status: response.status };
    }

    return { data };
  } catch (error) {
    // Usually means Flask is not running or cannot be reached.
    return { error: "network" };
  }
}

const Auth = {
  // Returns { session } on success, or { error } on failure.
  async login(email, password, { role, remember = false } = {}) {
    const result = await authRequest("/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(email || "").trim().toLowerCase(),
        password: password || "",
        role,
        remember
      })
    });

    if (result.error) return { error: result.error };
    return { session: result.data?.session || null };
  },

  // Ask Flask whether this browser still has a valid login session.
  // This is asynchronous: use `await Auth.getSession()`.
  async getSession() {
    const result = await authRequest("/me", {
      method: "GET",
      headers: {}
    });

    if (result.error) return null;
    return result.data || null;
  },

  // Clear the login session on the Flask server.
  async logout() {
    await authRequest("/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  // Update the signed-in user's name through Flask.
  // Accepts either { name: "..." } or { fullName: "..." }.
  async updateSession(changes = {}) {
    const fullName = String(changes.fullName ?? changes.name ?? "").trim();
    if (!fullName) return { error: "missing_fields" };

    const result = await authRequest("/profile", {
      method: "PATCH",
      body: JSON.stringify({ fullName })
    });

    if (result.error) return { error: result.error };
    return { session: result.data?.session || null };
  },

  // Avatar initials for a person's name.
  initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";

    let surname = parts.length - 1;
    while (
      surname > 1 &&
      SURNAME_PREFIXES.includes(parts[surname - 1].toLowerCase())
    ) {
      surname -= 1;
    }

    return (
      parts[0][0] +
      (parts.length > 1 ? parts[surname][0] : "")
    ).toUpperCase();
  },

  // Frontend convenience only. Flask must also protect private pages and APIs.
  async requireRole(role, loginPage = "/login") {
    const user = await this.getSession();

    if (!user || user.role !== role) {
      window.location.replace(loginPage);
      return null;
    }

    return user;
  }
};
