// UserAPI: the student side's data, from Flask (app.py). Used by Messages and My Reports.
// Every method returns a Promise.

function localDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

// Each student has one conversation with SWAFO; this is its id on the Messages page.
const SWAFO_CONVERSATION = "swafo";

async function requestJSON(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "server");
  return data;
}

// Runs the callback every few seconds while the tab is visible, and as soon as it's shown again,
// so new messages and status changes show up without a reload.
function whileVisible(callback, seconds = 10) {
  setInterval(() => {
    if (document.visibilityState === "visible") callback();
  }, seconds * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") callback();
  });
}

// The student's reports and claims, shaped the way js/my-reports.js expects them.
function reportClaim(claim) {
  if (!claim?.reference) return null;
  const item = claim.item?.id
    ? ItemsAPI.fromApi(claim.item)
    : claim.itemRef && ItemsAPI.fromApi({
      id: claim.itemRef, type: "found", name: claim.itemName || "Found item", image: claim.image,
    });
  return {
    id: claim.reference, status: claim.status, submittedAt: claim.dateSubmitted || null,
    reviewedAt: claim.reviewedAt || null, item: item || null,
  };
}

async function myReportEntries() {
  const { reports, claims } = (await requestJSON("/api/my-reports")) || {};

  const mine = (reports || []).filter((report) => report?.id).map((report) => {
    const claim = reportClaim(report.linkedClaim);
    const matchItem = !claim && report.match?.item?.id ? ItemsAPI.fromApi(report.match.item) : null;
    return {
      id: report.id, type: report.type, name: report.name || "Item report", category: report.category,
      locationId: report.locationId || report.location, locationOther: report.locationOther || "",
      date: report.dateLost || report.dateFound || "",
      submittedAt: report.dateReported, status: report.status, canDelete: report.canDelete === true,
      match: matchItem ? { score: report.match.score } : null,
      item: claim?.item || matchItem, claim,
    };
  });

  const claimed = (claims || []).map(reportClaim).filter(Boolean).map((claim) => ({
    id: claim.id, type: "claim", name: claim.item?.name || "Item claim", category: claim.item?.category,
    locationId: claim.item?.locationId, locationOther: claim.item?.locationOther,
    date: localDate(claim.submittedAt), submittedAt: claim.submittedAt, item: claim.item, claim,
  }));

  return [...mine, ...claimed].sort((a, b) => b.date.localeCompare(a.date));
}

const UserAPI = {
  // The office details SWAFO set in admin Settings (js/settings-store.js).
  getOffice() {
    const { office } = SettingsStore.get();
    return Promise.resolve({
      ...office,
      initial: (office.name || "S").charAt(0).toUpperCase(),
      activity: `Office hours: ${office.pickupHours}`,
    });
  },

  // Always exactly one conversation: the student's thread with SWAFO, even before anyone wrote.
  async getConversations() {
    const messages = await requestJSON("/api/messages");
    const last = messages[messages.length - 1];
    return [{
      id: SWAFO_CONVERSATION,
      unread: messages.filter((m) => m.sender !== "user" && !m.read).length,
      lastMessage: last ? last.text || "Sent a photo" : "Ask SWAFO about a lost or found item.",
      updatedAt: last ? last.time : null,
      startedBy: messages[0]?.sender === "user" ? "user" : "swafo",
    }];
  },

  getMessages: () => requestJSON("/api/messages"),

  markRead: () => requestJSON("/api/messages/read", { method: "POST" }),

  // Rejects if the server refuses it (for example, a photo that's too big).
  sendMessage: (_conversationId, { text = "", image = null }) =>
    requestJSON("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, image }),
    }),

  onChange: (callback) => whileVisible(callback),

  // My Reports: the student's lost and found reports plus claims, newest first.
  getMyReports: () => myReportEntries(),

  async dismissMatch(lostReference, foundReference) {
    const result = await requestJSON(`/api/my-reports/${encodeURIComponent(lostReference)}/dismiss-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foundReference }),
    });
    if (result?.success !== true) throw new Error("server");
    return result;
  },

  // Only while the report is still pending; rejects with "not_pending" otherwise.
  cancelReport: (reportId) => requestJSON(`/api/my-reports/${encodeURIComponent(reportId)}`, { method: "DELETE" }),
  async deleteReports(references) {
    const result = await requestJSON("/api/my-reports", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ references }),
    });
    if (result?.success !== true || result.deletedCount !== references.length) throw new Error("server");
    return result;
  },

  // Calls back when a report or claim may have changed (SWAFO reviewed it, for example).
  onReportsChange: (callback) => whileVisible(callback, 30),
};
