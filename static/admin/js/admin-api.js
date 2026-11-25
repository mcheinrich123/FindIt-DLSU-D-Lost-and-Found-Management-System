// AdminAPI: the data for every SWAFO page, from Flask (app.py). Every method returns a Promise.
// Office details and which notifications the bell shows are still kept in this browser
// (../js/settings-store.js), and so is which notifications SWAFO has read.

const DAY_MS = 24 * 60 * 60 * 1000;

// A TF-IDF match this strong (0-100) puts a "Possible match found" notice in the bell.
const MATCH_NOTICE_SCORE = 70;
const MATCH_NOTICE_LIMIT = 10;

async function adminJSON(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "server");
  return data;
}

const jsonBody = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function deleteAdminRecords(url, body, expectedCount) {
  const result = await adminJSON(url, body ? jsonBody("DELETE", body) : { method: "DELETE" });
  if (result?.success !== true || (expectedCount !== undefined && result.deletedCount !== expectedCount)) {
    throw new Error("server");
  }
  return result;
}

const sameDay = (iso, day) => Boolean(iso) && new Date(iso).toDateString() === day.toDateString();

/* ---------- Shapes the pages expect ---------- */

// A lost or found report. `private` holds the SWAFO-only fields the Reports panel shows.
const reportFromApi = (i) => ({
  id: i.id,
  type: i.type,
  name: i.name,
  category: i.category,
  locationId: i.locationId || i.location,
  locationOther: i.locationOther || "",
  date: i.dateFound || i.dateLost,
  status: i.status,
  image: i.image,
  reportedAt: i.dateReported,
  addedByAdmin: Boolean(i.addedByAdmin),
  reporter: i.reporter || null, // { id, name, email, schoolId, phone }
  // NLP (backend/algorithms/), unless fetched with { nlp: false }:
  // entities: what NER found, { ITEM: [...], BRAND, COLOR, MATERIAL, LOCATION: [location ids] }
  // typos: words NER read as dictionary words by Levenshtein distance, [{ written, word, edits }]
  // match: the best TF-IDF match among open reports of the other type, or null.
  //   signals are 0-1: text (cosine similarity), location, category, date
  //   scoreWithoutTypoFixes: the same pair's score with both reports read as written
  entities: i.entities || null,
  typos: i.typos || [],
  match: i.match
    ? {
      reportId: i.match.id, score: i.match.score, signals: i.match.signals, daysApart: i.match.daysApart,
      scoreWithoutTypoFixes: i.match.scoreWithoutTypoFixes ?? null,
    }
    : null,
  private: {
    brand: i.brand,
    identifyingDetails: i.identifyingDetails,
    turnedInBy: i.turnedInBy,
    storage: i.storage,
  },
});

// A claim, with its item's SWAFO-only fields so the Claims page can check the claimant's answers.
// The server's "pending" is "under_review" here; "released" (picked up) shows as "approved" with
// its item "claimed".
const claimFromApi = (c) => ({
  id: c.reference,
  itemId: c.itemRef,
  claimant: { name: c.claimant.name, schoolId: c.claimant.schoolId, email: c.claimant.email, phone: c.claimant.phone || "" },
  status: { pending: "under_review", released: "approved" }[c.status] || c.status,
  brand: c.brand || "",
  // Whether that brand is the item's: the server allows typos (Levenshtein) and brand names
  // ("iPhone" is Apple). See brand_matches() in backend/algorithms/levenshtein_distance.py.
  brandMatches: Boolean(c.brandMatches),
  identifiers: c.identifiers || "",
  lostLocation: c.lostLocation || "",
  lostDate: c.lostDate || "",
  proofFiles: c.proofFiles || [],
  submittedAt: c.dateSubmitted,
  reviewedAt: c.reviewedAt,
  item: c.item ? ItemsAPI.fromApi(c.item) : null,
});

// "CL-0007" -> 7, the id the claim endpoints take
const claimNumber = (id) => Number(String(id).replace(/\D/g, ""));

// One conversation per student; its id is the student's account id.
const conversationFromApi = (c) => ({
  id: String(c.studentId),
  student: { id: c.studentId, name: c.name, email: c.email, schoolId: c.schoolId || "" },
  unread: c.unread,
  messageCount: c.messageCount,
  lastMessage: c.lastMessage ? c.lastMessage.text || "Sent a photo" : "No messages yet",
  updatedAt: c.lastMessage ? c.lastMessage.time : null,
});

/* ---------- Dashboard, counted from the real reports and claims ---------- */

function buildDashboard(reports, claims) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  // A recovery is a claim whose item was handed over; its reviewedAt is then the pick-up time.
  const recoveries = claims.filter((c) => c.status === "approved" && c.item?.status === "claimed");
  const recoveredOn = (day) => recoveries.filter((c) => sameDay(c.reviewedAt, day)).length;
  const reportedOn = (day) => reports.filter((r) => sameDay(r.reportedAt, day)).length;

  const recoveredToday = recoveredOn(today);
  const change = recoveredToday - recoveredOn(yesterday);
  const lost = reports.filter((r) => r.type === "lost");
  const lostToday = lost.filter((r) => sameDay(r.reportedAt, today));
  const toReview = claims.filter((c) => c.status === "under_review");
  const found = reports.filter((r) => r.type === "found");
  const returned = found.filter((r) => r.status === "claimed").length;
  const neutral = (text) => ({ text, direction: "none", sentiment: "neutral" });

  const stats = [
    {
      value: String(recoveredToday), label: "Items recovered today", icon: "checkCircle",
      trend: change === 0 ? neutral("Same as yesterday") : {
        text: `${change > 0 ? "+" : ""}${change} vs yesterday`,
        direction: change > 0 ? "up" : "down",
        sentiment: change > 0 ? "positive" : "negative",
      },
    },
    {
      value: String(lost.filter((r) => r.status === "pending").length), label: "Pending lost reports", icon: "search",
      trend: neutral(`${lostToday.length} new today`),
    },
    {
      id: "claims", value: String(toReview.length), label: "Claims to review", icon: "claims",
      trend: neutral(`${toReview.filter((c) => sameDay(c.submittedAt, today)).length} new today`),
    },
    {
      value: found.length ? `${Math.round((returned / found.length) * 100)}%` : "–", label: "Found items returned", icon: "trendingUp",
      trend: neutral(`${returned} of ${found.length}`),
    },
  ];

  // The last 7 days, ending today
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i));

  return {
    stats,
    weeklyReports: {
      labels: days.map((day) => day.toLocaleDateString("en-US", { weekday: "short" })),
      reported: days.map(reportedOn),
      recovered: days.map(recoveredOn),
    },
    itemsByCategory: ItemStore.categories.map((category) => ({
      category,
      count: reports.filter((r) => r.category === category).length,
    })),
    lostToday: lostToday
      .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
      .map((r) => ({
        name: r.name,
        category: r.category,
        locationId: r.locationId,
        locationOther: r.locationOther,
        reportedBy: r.reporter?.name || "",
        status: r.status,
        time: new Date(r.reportedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      })),
  };
}

/* ---------- Bell: which notifications SWAFO has read, kept in this browser ---------- */

const NOTIFICATIONS_READ_KEY = "findit.notifications.read.v1";

function readNotificationIds() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATIONS_READ_KEY)) || [];
  } catch {
    return [];
  }
}

function writeNotificationIds(ids) {
  try {
    localStorage.setItem(NOTIFICATIONS_READ_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: read state lasts until the page reloads
  }
}

/* ---------- Live updates ---------- */

// Checks the server every `seconds` while the tab is visible (and as soon as it's shown again),
// and calls the listeners only when `signature()` comes back different, so pages don't redraw
// for nothing.
function watchForChanges(signature, seconds) {
  const listeners = new Set();
  let last = null;
  const check = async () => {
    if (!listeners.size || document.visibilityState !== "visible") return;
    try {
      const current = await signature();
      if (last !== null && current !== last) listeners.forEach((callback) => callback());
      last = current;
    } catch {
      // offline for a moment: check again next time
    }
  };
  setInterval(check, seconds * 1000);
  document.addEventListener("visibilitychange", check);
  return (callback) => {
    listeners.add(callback);
    check(); // the first check only records where things stand
  };
}

const onMessagesSignal = watchForChanges(async () =>
  JSON.stringify((await AdminAPI.getConversations()).map((c) => [c.id, c.updatedAt, c.unread, c.messageCount])), 10);

const onClaimsSignal = watchForChanges(async () =>
  JSON.stringify((await AdminAPI.getClaims()).map((c) => [c.id, c.status, c.item?.status])), 15);

/* ---------- AdminAPI ---------- */

let currentUser = null;

const AdminAPI = {
  // The logged-in admin. greetingName is their first name ("Amor, Clarence J." is last name first).
  getCurrentUser() {
    currentUser ||= adminJSON("/api/auth/me").then((user) => {
      const given = user.name.includes(",") ? user.name.split(",")[1] : user.name;
      return {
        name: user.name,
        email: user.email,
        initials: Auth.initials(user.name),
        greetingName: given.trim().split(/\s+/)[0] || user.name,
      };
    });
    return currentUser;
  },

  // Sidebar badges: Reports = pending reports, Claims = claims under review,
  // Messages = unread student messages.
  async getNavCounts() {
    const [reports, claims, conversations] = await Promise.all([
      AdminAPI.getReports({ nlp: false }), AdminAPI.getClaims(), AdminAPI.getConversations(),
    ]);
    return {
      reports: reports.filter((r) => r.status === "pending").length,
      claims: claims.filter((c) => c.status === "under_review").length,
      messages: conversations.reduce((total, c) => total + c.unread, 0),
    };
  },

  // The one category list for the whole site (../js/item-store.js)
  getCategories: () => Promise.resolve(ItemStore.categories),

  async getDashboard() {
    const [reports, claims] = await Promise.all([AdminAPI.getReports({ nlp: false }), AdminAPI.getClaims()]);
    return buildDashboard(reports, claims);
  },

  // Every lost and found report in the database, newest first. nlp: false skips the NER entities
  // and TF-IDF matches, for pages that only count or list reports.
  async getReports({ nlp = true } = {}) {
    return (await adminJSON(`/api/admin/items${nlp ? "" : "?nlp=0"}`)).map(reportFromApi);
  },

  deleteReports: (references) => deleteAdminRecords("/api/admin/items", { references }, references.length),

  // Every likely match for one report, best first: { id, score, signals, daysApart, item }.
  getMatches: (id) => adminJSON(`/api/admin/items/${encodeURIComponent(id)}/matches`),

  // NER on any text: { entities: [{ label, value, text, start, end }], summary }.
  findEntities: (text) => adminJSON("/api/admin/nlp/entities", jsonBody("POST", { text })),

  async updateReportStatus(id, status) {
    await AdminAPI._patchItem(id, { status });
    return (await AdminAPI.getReports()).find((r) => r.id === id);
  },

  // Edit in the Reports panel. fields: name, category, locationId, locationOther, date
  async updateReport(id, fields) {
    await AdminAPI._patchItem(id, fields);
    return (await AdminAPI.getReports()).find((r) => r.id === id);
  },

  _patchItem: (id, body) => adminJSON(`/api/admin/items/${encodeURIComponent(id)}`, jsonBody("PATCH", body)),

  // "Add found item": Flask saves it and makes its FI- number, and it's listed on Browse.
  async addFoundItem(fields) {
    const form = new FormData();
    form.set("type", "found");
    form.set("itemName", fields.name);
    form.set("category", fields.category);
    form.set("color", fields.color);
    form.set("description", fields.description);
    form.set("locationId", fields.locationId);
    form.set("locationOther", fields.locationOther);
    form.set("locationDetails", fields.locationDetails);
    form.set("date", fields.dateFound);
    form.set("brand", fields.brand);
    form.set("turnedInBy", fields.turnedInBy);
    form.set("storage", fields.storage);
    form.set("identifyingDetails", fields.identifyingDetails);
    form.set("itemNow", "swafo");
    if (fields.image) {
      // the drawer keeps the shrunken photo as a data: URL; turn it back into a file
      const blob = await (await fetch(fields.image)).blob();
      form.set("photo", blob, `photo.${blob.type.split("/")[1] || "jpg"}`);
    }
    const data = await adminJSON("/api/items", { method: "POST", body: form });
    return { id: data.reference, name: fields.name };
  },

  // The bell, newest first: unread student messages, plus claims and new student reports from
  // the last day. read: whether SWAFO opened it in this browser.
  async getNotifications() {
    const [conversations, claims, reports] = await Promise.all([
      AdminAPI.getConversations(), AdminAPI.getClaims(), AdminAPI.getReports(),
    ]);
    const read = readNotificationIds();
    const dayAgo = Date.now() - DAY_MS;
    const recent = (iso) => Boolean(iso) && new Date(iso).getTime() > dayAgo;

    const messageNotes = conversations.filter((c) => c.unread).map((c) => ({
      // A new message changes updatedAt, so it shows up as unread again.
      id: `msg-${c.id}-${c.updatedAt}`,
      type: "message",
      title: `${c.student.name} sent a message`,
      body: c.lastMessage,
      time: c.updatedAt,
      href: `/admin/messages?c=${encodeURIComponent(c.id)}`,
    }));
    const claimNotes = claims.filter((c) => c.status === "under_review" && recent(c.submittedAt)).map((c) => ({
      id: `claim-${c.id}`,
      type: "claim",
      title: "New claim to review",
      body: `${c.claimant.name} claimed the ${c.item ? c.item.name : "item"} (${c.itemId}).`,
      time: c.submittedAt,
      href: `/admin/claims?id=${encodeURIComponent(c.id)}`,
    }));
    // SWAFO's own "Add found item" entries aren't news to SWAFO.
    const reportNotes = reports.filter((r) => !r.addedByAdmin && recent(r.reportedAt)).map((r) => ({
      id: `report-${r.id}`,
      type: "report",
      title: `New ${r.type} report`,
      body: `${r.reporter?.name || "A student"} reported ${r.type === "lost" ? "losing" : "finding"} a ${r.name.toLowerCase()} at ${Locations.label(r.locationId, r.locationOther)} (${r.id}).`,
      time: r.reportedAt,
      href: `/admin/reports?q=${encodeURIComponent(r.id)}`,
    }));
    // Strong TF-IDF matches for a lost report, once either side was reported in the last day.
    // Only the strongest few, so a busy day doesn't bury the other notices.
    const byId = new Map(reports.map((r) => [r.id, r]));
    const matchNotes = reports
      .filter((r) => r.type === "lost" && r.match && r.match.score >= MATCH_NOTICE_SCORE)
      .filter((r) => recent(r.reportedAt) || recent(byId.get(r.match.reportId)?.reportedAt))
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, MATCH_NOTICE_LIMIT)
      .map((r) => {
        const found = byId.get(r.match.reportId);
        const time = [r.reportedAt, found?.reportedAt].sort().pop();
        return {
          id: `match-${r.id}-${r.match.reportId}`,
          type: "match",
          title: "Possible match found",
          body: `Lost ${r.name} (${r.id}) matches found ${found ? found.name : "item"} (${r.match.reportId}), ${r.match.score}%.`,
          time,
          href: `/admin/reports?q=${encodeURIComponent(r.id)}`,
        };
      });

    const wanted = SettingsStore.get().notifications; // turned on/off in Settings
    return [...messageNotes, ...claimNotes, ...reportNotes, ...matchNotes]
      .filter((note) => wanted[note.type] !== false)
      .sort((a, b) => (a.time < b.time ? 1 : -1))
      .map((note) => ({ ...note, read: read.includes(note.id) }));
  },

  markNotificationsRead(ids) {
    writeNotificationIds([...new Set([...readNotificationIds(), ...ids])]);
    return Promise.resolve();
  },

  // Found Items page: every found item, including the SWAFO-only fields.
  async getItems() {
    return (await adminJSON("/api/admin/items?type=found&nlp=0")).map(ItemsAPI.fromApi);
  },

  async updateItemStatus(id, status) {
    return ItemsAPI.fromApi(await AdminAPI._patchItem(id, { status }));
  },

  // Settings page (../js/settings-store.js). saveSettings rejects if storage is blocked.
  getSettings: () => Promise.resolve(SettingsStore.get()),
  saveSettings: (settings) => Promise.resolve().then(() => SettingsStore.save(settings)),

  // Claims page: every claim with its item, newest first.
  async getClaims() {
    return (await adminJSON("/api/admin/claims")).map(claimFromApi);
  },

  deleteClaim: (id) => deleteAdminRecords("/api/admin/claims", { claimIds: [claimNumber(id)] }, 1),

  // decision: "approved" | "rejected". Approving also makes the item Ready for claim (on the server).
  reviewClaim: async (id, decision) =>
    claimFromApi(await adminJSON(`/api/admin/claims/${claimNumber(id)}`, jsonBody("PATCH", { status: decision }))),

  // The approved claimant collected the item at the office: the item becomes Claimed.
  markClaimPickedUp: async (id) =>
    claimFromApi(await adminJSON(`/api/admin/claims/${claimNumber(id)}`, jsonBody("PATCH", { status: "released" }))),

  // Calls back when a claim is sent or changes.
  onClaimsChange: (callback) => onClaimsSignal(callback),

  // Messages: one conversation per student, newest first, with SWAFO's unread count as `unread`.
  // withStudent: a student id to list even if nobody has written yet (to start the conversation).
  async getConversations({ withStudent } = {}) {
    const query = withStudent ? `?with=${encodeURIComponent(withStudent)}` : "";
    return (await adminJSON(`/api/admin/conversations${query}`)).map(conversationFromApi);
  },

  getMessages: (conversationId) => adminJSON(`/api/admin/conversations/${encodeURIComponent(conversationId)}`),

  deleteConversation: (studentId) => deleteAdminRecords(`/api/admin/conversations/${encodeURIComponent(studentId)}`),
  deleteMessage: (studentId, messageId) => deleteAdminRecords(`/api/admin/conversations/${encodeURIComponent(studentId)}/messages/${encodeURIComponent(messageId)}`, undefined, 1),

  markConversationRead: (conversationId) =>
    adminJSON(`/api/admin/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" }),

  // Rejects if the server refuses it (for example, a photo that's too big).
  sendMessage: (conversationId, { text = "", image = null }) =>
    adminJSON(`/api/admin/conversations/${encodeURIComponent(conversationId)}`, jsonBody("POST", { text, image })),

  // Calls back when a student sends something or a conversation is read.
  onMessagesChange: (callback) => onMessagesSignal(callback),

  getUsers: () => adminJSON("/api/admin/users"),
  deleteUser: (id) => deleteAdminRecords(`/api/admin/users/${encodeURIComponent(id)}`),
};
