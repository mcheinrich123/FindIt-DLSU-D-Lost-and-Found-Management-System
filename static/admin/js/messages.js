// Admin Messages: SWAFO's inbox, one conversation per student, from Flask through AdminAPI. It's
// the same thread the student sees on their Messages page. admin/messages?c=<student id> opens
// (or starts) that student's conversation; the Reports page's Message button links there.
// Bubbles, the composer and the photo viewer are shared (../js/chat-ui.js).
// The top bar search filters the conversation list.

const state = {
  conversations: [],
  reports: [], // every report, for the student's reports in the info panel
  messages: [], // the open conversation's messages
  activeId: null,
  threadLoaded: false,
  filter: "all", // "all" | "unread"
  query: "",
  found: null, // the server's answer for `query`: { ids, hits } (../../js/search-api.js)
  deleting: false,
};
let threadRequest = 0;

const els = {
  card: document.getElementById("chat-card"),
  filters: document.getElementById("chat-filters"),
  unreadTotal: document.getElementById("chat-unread-total"),
  list: document.getElementById("chat-list"),
  head: document.getElementById("chat-thread-head"),
  messages: document.getElementById("thread-messages"),
  composer: document.getElementById("composer"),
  info: document.getElementById("chat-info"),
  infoBackdrop: document.getElementById("chat-info-backdrop"),
  result: document.getElementById("chat-result"),
  error: document.getElementById("chat-error"),
  searchForm: document.getElementById("topbar-search"),
  search: document.querySelector("#topbar-search input"),
};

const esc = (value) => ChatUI.escape(value);
// Stored image paths are relative to the site folder; this page is one folder down.
const resolveSrc = (src) => (/^(data:|blob:|https?:|\/)/.test(src) ? src : `../${src}`);
const activeConversation = () => state.conversations.find((c) => c.id === state.activeId);
const isPhoneLayout = () => window.matchMedia("(max-width: 720px)").matches;
const avatar = (name) => `<span class="chat-avatar" aria-hidden="true">${esc(Auth.initials(name))}</span>`;
const studentLine = (c) => [c.student.email, c.student.schoolId].filter(Boolean).map(esc).join(" · ");

// SWAFO is actually looking at the open conversation (not the list on a phone, not another tab).
const threadInView = () =>
  document.visibilityState === "visible" && (!isPhoneLayout() || els.card.classList.contains("show-thread"));

/* ---------- Conversation list ---------- */

function conversationHTML(c) {
  return `
    <li>
      <button type="button" class="chat-convo${c.unread ? " is-unread" : ""}" data-id="${esc(c.id)}" aria-current="${c.id === state.activeId}">
        ${avatar(c.student.name)}
        <span class="chat-convo-text">
          <span class="chat-convo-name">${esc(c.student.name)}</span>
          <span class="chat-convo-item">${studentLine(c)}</span>
          <span class="chat-convo-preview">${esc(c.lastMessage)}</span>
        </span>
        <span class="chat-convo-meta">
          <span class="chat-convo-time">${c.updatedAt ? ChatUI.listTime(c.updatedAt) : ""}</span>
          ${c.unread ? `<span class="chat-unread">${esc(c.unread)}<span class="visually-hidden"> unread</span></span>` : ""}
        </span>
      </button>
    </li>`;
}

function renderList() {
  // The server says which match the search: the student's name, email and school ID, and the
  // latest message (see runSearch below).
  const visible = state.conversations.filter((c) =>
    (state.filter !== "unread" || c.unread > 0) &&
    (!state.query || state.found?.ids.has(c.id)));

  const listHadFocus = els.list.contains(document.activeElement);
  els.list.innerHTML = visible.length
    ? visible.map(conversationHTML).join("")
    : '<li class="chat-empty">No conversations found.</li>';
  if (listHadFocus) els.list.querySelector('[aria-current="true"]')?.focus();

  els.unreadTotal.textContent = state.conversations.reduce((total, c) => total + c.unread, 0);
}

/* ---------- Thread ---------- */

function renderThreadHead(c) {
  els.head.innerHTML = `
    <button type="button" class="icon-btn chat-back" id="chat-back" aria-label="Back to conversations">${AdminUI.icon("chevronLeft")}</button>
    ${avatar(c.student.name)}
    <div class="chat-thread-title">
      <h2 id="chat-thread-title" tabindex="-1">${esc(c.student.name)}</h2>
      <p>${studentLine(c)}</p>
    </div>
    <button type="button" class="icon-btn chat-info-toggle" id="chat-info-toggle" aria-label="Show conversation details"
      aria-controls="chat-info" aria-expanded="${els.card.classList.contains("show-info")}">${AdminUI.icon("info")}</button>`;
}

const bubbleOptions = () => {
  const { student } = activeConversation();
  return { mine: "swafo", otherInitial: Auth.initials(student.name), otherName: student.name, resolveSrc };
};

const scrollToBottom = () => {
  els.messages.scrollTop = els.messages.scrollHeight;
};

function renderMessages() {
  els.messages.innerHTML = state.messages.length
    ? ChatUI.messagesHTML(state.messages, bubbleOptions())
    : `<p class="msg-system">No messages yet. Write to ${esc(activeConversation().student.name)} below; they'll see it on their Messages page.</p>`;
  const authored = state.messages.filter((message) => message.sender !== "system");
  els.messages.querySelectorAll(".msg-body time").forEach((time, index) => {
    const message = authored[index];
    const sender = message.sender === "swafo" ? "SWAFO" : activeConversation().student.name;
    const metadata = document.createElement("div");
    metadata.className = "chat-message-meta";
    time.replaceWith(metadata);
    metadata.append(time);
    metadata.insertAdjacentHTML("beforeend", `<button type="button" class="chat-message-delete" data-delete-message="${esc(message.id)}"
      aria-label="Delete message from ${esc(sender)} at ${esc(ChatUI.formatTime(message.time))}">Delete</button>`);
  });
  scrollToBottom();
}

function updateThread(conversation, messages) {
  state.messages = messages;
  state.threadLoaded = true;
  renderMessages();
  renderInfo(conversation);
}

/* ---------- Info panel ---------- */

// The student's own reports, newest first, each linking to it on the Reports page.
function studentReportsHTML(c) {
  const theirs = state.reports.filter((r) => r.reporter?.id === c.student.id);
  if (!theirs.length) return '<p class="chat-muted">No reports from this student.</p>';
  return `
    <dl class="info-grid">
      ${theirs.map((r) => `
        <div>
          <dt><a href="/admin/reports?q=${encodeURIComponent(r.id)}">${esc(r.id)}</a></dt>
          <dd>${esc(r.name)} ${AdminUI.typeBadge(r.type)} ${AdminUI.statusBadge(r.status)}</dd>
        </div>`).join("")}
    </dl>`;
}

function renderInfo(c) {
  const photos = state.messages.filter((m) => m.image);
  const focusedId = els.info.contains(document.activeElement) ? document.activeElement.id : null;

  els.info.innerHTML = `
    <button type="button" class="icon-btn chat-info-close" id="chat-info-close" aria-label="Close details">${AdminUI.icon("close")}</button>
    <div class="chat-student">
      ${avatar(c.student.name)}
      <h2>${esc(c.student.name)}</h2>
      <p>${esc(c.student.email)}</p>
    </div>
    <section aria-labelledby="chat-reports-heading">
      <h3 id="chat-reports-heading">Their reports</h3>
      ${studentReportsHTML(c)}
    </section>
    <section aria-labelledby="chat-photos-heading">
      <h3 id="chat-photos-heading">Shared photos</h3>
      ${photos.length
        ? `<ul class="photo-grid">${photos.map((m) => `
            <li><button type="button" class="photo-thumb" data-src="${esc(resolveSrc(m.image))}" aria-label="Open shared photo"><img src="${esc(resolveSrc(m.image))}" alt=""></button></li>`).join("")}
          </ul>`
        : '<p class="chat-muted">No photos shared yet.</p>'}
    </section>
    ${state.messages.length ? '<button type="button" class="admin-btn admin-btn-danger" id="delete-conversation">Delete conversation</button>' : ''}`;

  if (focusedId) document.getElementById(focusedId)?.focus();
}

function setInfoOpen(open) {
  els.card.classList.toggle("show-info", open);
  const toggle = document.getElementById("chat-info-toggle");
  toggle?.setAttribute("aria-expanded", String(open));
  if (open) document.getElementById("chat-info-close").focus();
  else if (els.info.contains(document.activeElement)) toggle?.focus();
}

/* ---------- Opening conversations ---------- */

function markActiveRead() {
  const conversation = activeConversation();
  if (!conversation || !conversation.unread) return;
  conversation.unread = 0;
  AdminAPI.markConversationRead(conversation.id).then(() => {
    refreshNavCounts();
    loadNotifications(); // its "sent a message" notification goes away
  });
  renderList();
}

function openConversation(id, { showThread = false } = {}) {
  const request = ++threadRequest;
  const conversation = state.conversations.find((entry) => entry.id === id);
  state.activeId = id;
  state.messages = [];
  state.threadLoaded = false;
  composer.reset();
  els.composer.hidden = false;
  renderThreadHead(conversation);
  els.messages.innerHTML = '<p class="msg-system">Loading messages…</p>';
  renderInfo(conversation);
  if (showThread) els.card.classList.add("show-thread");
  markActiveRead();
  renderList();

  return AdminAPI.getMessages(id).then((messages) => {
    if (request !== threadRequest) return;
    updateThread(conversation, messages);
    if (showThread) document.getElementById("chat-thread-title").focus();
  }).catch(() => {
    if (request === threadRequest) els.messages.textContent = "Couldn't load the messages. Open the conversation again to retry.";
  });
}

// Phone layout: back from the chat to the list.
function showList() {
  setInfoOpen(false);
  els.card.classList.remove("show-thread");
  els.list.querySelector('[aria-current="true"]')?.focus();
}

function clearThread() {
  state.activeId = null;
  state.messages = [];
  state.threadLoaded = false;
  composer.reset();
  els.composer.hidden = true;
  showList();
  els.head.replaceChildren();
  els.info.replaceChildren();
  els.messages.innerHTML = '<p class="msg-system">Select a conversation.</p>';
}

async function deleteChatRecords(button, messageId = null) {
  const conversation = activeConversation();
  if (!conversation || state.deleting) return;
  const name = conversation.student.name;
  const deletingConversation = messageId === null;
  const question = deletingConversation
    ? `Delete the conversation with ${name}? All messages and shared photos in this conversation will be permanently removed for both sides.`
    : `Delete this message in the conversation with ${name}? It will be permanently removed for both sides.`;
  if (!window.confirm(question)) return;

  state.deleting = true;
  threadRequest += 1;
  button.disabled = true;
  els.result.hidden = true;
  els.error.hidden = true;
  try {
    if (deletingConversation) {
      await AdminAPI.deleteConversation(conversation.id);
      state.conversations = state.conversations.filter((entry) => entry.id !== conversation.id);
      if (state.activeId === conversation.id) clearThread();
      renderList();
    } else {
      await AdminAPI.deleteMessage(conversation.id, messageId);
      if (state.activeId === conversation.id) {
        updateThread(conversation, state.messages.filter((message) => String(message.id) !== messageId));
      }
    }
    els.result.hidden = false;
    els.result.textContent = deletingConversation ? "Conversation deleted." : "Message deleted.";
    els.result.focus();
    refreshNavCounts().catch(() => {});
    loadNotifications().catch(() => {});
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error.message === "not_found"
      ? "These messages are no longer available."
      : (deletingConversation ? "Couldn't delete the conversation. Try again." : "Couldn't delete the message. Try again.");
  } finally {
    state.deleting = false;
    button.disabled = false;
    refresh();
  }
}

// Moves a conversation to the top after SWAFO sends something in it.
function bumpConversation(conversation, message) {
  conversation.lastMessage = message.text || "Sent a photo";
  conversation.updatedAt = message.time;
  state.conversations = [conversation, ...state.conversations.filter((c) => c !== conversation)];
  renderList();
  if (state.query) runSearch(state.query); // its latest message changed
}

/* ---------- Live updates (students' messages), checked every few seconds ---------- */

async function refresh() {
  if (state.deleting) return;
  const request = ++threadRequest;
  try {
    // Keep the open conversation listed even while it's still empty.
    const conversations = await AdminAPI.getConversations({ withStudent: state.activeId });
    if (request !== threadRequest) return;
    state.conversations = conversations;
    if (state.query) runSearch(state.query); // new messages can change what matches
    const conversation = activeConversation();
    if (!conversation) {
      if (state.activeId !== null) clearThread();
      renderList();
      return;
    }
    const messages = await AdminAPI.getMessages(conversation.id);
    if (request !== threadRequest) return;
    if (!state.threadLoaded || messages.length !== state.messages.length ||
        messages.some((message, i) => message.id !== state.messages[i].id)) {
      updateThread(conversation, messages);
    }
    if (threadInView()) markActiveRead();
    renderList();
  } catch {
    // Offline for a moment: try again on the next check.
  }
}

AdminAPI.onMessagesChange(refresh);
document.addEventListener("visibilitychange", () => {
  if (threadInView()) markActiveRead();
});
setInterval(renderList, 60 * 1000); // keep "2m" / "1h" labels current

/* ---------- Composer + photo viewer ---------- */

const composer = ChatUI.setupComposer({
  form: els.composer,
  input: document.getElementById("composer-input"),
  send: document.getElementById("send-btn"),
  attachBtn: document.getElementById("attach-btn"),
  attachInput: document.getElementById("attach-input"),
  preview: document.getElementById("attach-preview"),
  error: document.getElementById("composer-error"),
  onSend: ({ text, image }) => {
    if (state.deleting) return Promise.reject(new Error("Try again after deletion finishes."));
    const conversationId = state.activeId;
    return AdminAPI.sendMessage(conversationId, { text, image }).then((message) => {
      const conversation = state.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) return;
      bumpConversation(conversation, message);
      if (state.activeId !== conversationId) return;
      if (!state.messages.some((entry) => entry.id === message.id)) {
        threadRequest += 1;
        updateThread(conversation, [...state.messages, message]);
      }
    });
  },
});

const openLightbox = ChatUI.setupLightbox({
  dialog: document.getElementById("lightbox"),
  image: document.getElementById("lightbox-img"),
  close: document.getElementById("lightbox-close"),
});

/* ---------- Events ---------- */

// On this page the top bar search filters conversations instead of going to Reports. The server
// looks for the query with Boyer-Moore (backend/nlp.py); the list updates when it answers.
const runSearch = SearchAPI.live("conversations", (found, query) => {
  Object.assign(state, { query, found });
  renderList();
});
els.search.placeholder = "Search students or items...";
els.searchForm.addEventListener("submit", (event) => event.preventDefault());
els.search.addEventListener("input", () => runSearch(els.search.value));

els.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filters.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  renderList();
});

els.list.addEventListener("click", (event) => {
  const button = event.target.closest(".chat-convo");
  if (button) openConversation(button.dataset.id, { showThread: isPhoneLayout() });
});

els.head.addEventListener("click", (event) => {
  if (event.target.closest("#chat-back")) showList();
  if (event.target.closest("#chat-info-toggle")) setInfoOpen(!els.card.classList.contains("show-info"));
});

els.info.addEventListener("click", (event) => {
  if (event.target.closest("#chat-info-close")) setInfoOpen(false);
  const deleteButton = event.target.closest("#delete-conversation");
  if (deleteButton) deleteChatRecords(deleteButton);

  const thumb = event.target.closest(".photo-thumb");
  if (thumb) openLightbox(thumb.dataset.src);
});

els.infoBackdrop.addEventListener("click", () => setInfoOpen(false));

els.messages.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-message]");
  if (deleteButton) deleteChatRecords(deleteButton, deleteButton.dataset.deleteMessage);
  const image = event.target.closest(".bubble-image");
  if (image) openLightbox(image.dataset.src);
});

// Photos change the thread's height as they load, so stay pinned to the newest message.
els.messages.addEventListener("load", scrollToBottom, true);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || document.getElementById("lightbox").open) return;
  if (els.card.classList.contains("show-info")) setInfoOpen(false);
});

/* ---------- Start ---------- */

// admin/messages?c=7 opens student 7's conversation, starting it if nobody has written yet.
const requested = new URLSearchParams(window.location.search).get("c");

Promise.all([AdminAPI.getConversations({ withStudent: requested }), AdminAPI.getReports({ nlp: false })]).then(([conversations, reports]) => {
  state.conversations = conversations;
  state.reports = reports;

  // Otherwise open the latest one that's already read, so unread conversations keep their
  // badge until SWAFO opens them.
  const initial = conversations.find((c) => c.id === requested)
    || conversations.find((c) => !c.unread)
    || conversations[0];

  if (initial) openConversation(initial.id, { showThread: Boolean(requested) && isPhoneLayout() });
  else renderList();
}).catch(() => {
  els.list.innerHTML = '<li class="chat-empty">Couldn\'t load the conversations. Refresh to try again.</li>';
});
