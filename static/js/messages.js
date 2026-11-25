// Student Messages: the student's one conversation with SWAFO, through UserAPI (./user-api.js).
// Bubbles, the composer and the photo viewer are shared with the admin side (./chat-ui.js).
// messages.html?item=FI-0224 (My Reports' "Message SWAFO") starts the message with that item's number.

const ICONS = {
  office: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1"/><path d="M10 21v-4h4v4"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};

const state = {
  office: null,
  conversations: [],
  messages: [], // the open conversation's messages
  activeId: null,
  filter: "all", // "all" | "unread" | "swafo"
  query: "",
  found: null, // the server's answer for `query`: { ids, hits } (search-api.js)
};
let messageRefresh = 0;

const els = {
  app: document.getElementById("messages-app"),
  search: document.getElementById("convo-search"),
  filters: document.getElementById("convo-filters"),
  unreadTotal: document.getElementById("unread-total"),
  list: document.getElementById("convo-list"),
  head: document.getElementById("thread-head"),
  messages: document.getElementById("thread-messages"),
  info: document.getElementById("info-panel"),
  infoBackdrop: document.getElementById("info-backdrop"),
};

const esc = (value) => ChatUI.escape(value);
// Stored image paths are relative to the site folder; this page is one folder down.
const resolveSrc = (src) => (/^(data:|blob:|https?:|\/)/.test(src) ? src : `../${src}`);
const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const activeConversation = () => state.conversations.find((c) => c.id === state.activeId);
const officeTile = () => `<span class="item-tile tone-green">${icon("office")}</span>`;
const isPhoneLayout = () => window.matchMedia("(max-width: 720px)").matches;

// The student is actually looking at the open conversation (not the list on a phone, not another tab).
const threadInView = () =>
  document.visibilityState === "visible" && (!isPhoneLayout() || els.app.classList.contains("show-thread"));

/* ---------- Conversation list ---------- */

function conversationHTML(c) {
  return `
    <li>
      <button type="button" class="convo${c.unread ? " is-unread" : ""}" data-id="${esc(c.id)}" aria-current="${c.id === state.activeId}">
        ${officeTile()}
        <span class="convo-text">
          <span class="convo-name">${esc(state.office.name)}</span>
          <span class="convo-preview">${esc(c.lastMessage)}</span>
        </span>
        <span class="convo-meta">
          <span class="convo-time">${c.updatedAt ? ChatUI.listTime(c.updatedAt) : ""}</span>
          ${c.unread ? `<span class="unread-badge">${esc(c.unread)}<span class="visually-hidden"> unread</span></span>` : ""}
        </span>
      </button>
    </li>`;
}

function renderList() {
  // The server says whether the thread matches the search: the office's name and the latest
  // message (see runSearch below).
  const visible = state.conversations.filter((c) =>
    (state.filter !== "unread" || c.unread > 0) &&
    (state.filter !== "swafo" || c.startedBy === "swafo") &&
    (!state.query || state.found?.ids.has(c.id)));

  const listHadFocus = els.list.contains(document.activeElement);
  els.list.innerHTML = visible.length
    ? visible.map(conversationHTML).join("")
    : '<li class="convo-empty">No conversations found.</li>';
  if (listHadFocus) els.list.querySelector('[aria-current="true"]')?.focus();

  const unread = state.conversations.reduce((total, c) => total + c.unread, 0);
  els.unreadTotal.textContent = unread ? ` · ${unread}` : "";
}

/* ---------- Thread ---------- */

function renderThreadHead() {
  els.head.innerHTML = `
    <button type="button" class="icon-btn thread-back" id="thread-back" aria-label="Back to conversations">${icon("back")}</button>
    ${officeTile()}
    <div class="thread-title">
      <h2 id="thread-title" tabindex="-1">${esc(state.office.name)}</h2>
      <p>${esc(state.office.activity)}</p>
    </div>
    <a class="btn btn-outline btn-sm" href="/my-reports">My reports</a>
    <button type="button" class="icon-btn info-toggle" id="info-toggle" aria-label="Show conversation details"
      aria-controls="info-panel" aria-expanded="${els.app.classList.contains("show-info")}">${icon("info")}</button>`;
}

const bubbleOptions = () => ({ mine: "user", otherInitial: state.office.initial, otherName: state.office.name, resolveSrc });

const scrollToBottom = () => {
  els.messages.scrollTop = els.messages.scrollHeight;
};

function renderMessages() {
  els.messages.innerHTML = state.messages.length
    ? ChatUI.messagesHTML(state.messages, bubbleOptions())
    : `<p class="msg-system">Ask ${esc(state.office.name)} about an item you lost, found or claimed. Mention its reference number (like FI-0001) if it has one.</p>`;
  scrollToBottom();
}

function appendMessages(messages) {
  if (!messages.length) return;
  if (!state.messages.length) {
    // The first message replaces the "Ask SWAFO…" hint.
    state.messages = [...messages];
    renderMessages();
    return;
  }
  const previous = state.messages[state.messages.length - 1];
  state.messages.push(...messages);
  els.messages.insertAdjacentHTML("beforeend", ChatUI.messagesHTML(messages, { ...bubbleOptions(), previous }));
  scrollToBottom();
}

/* ---------- Info panel ---------- */

function renderInfo() {
  const { office } = state;
  const photos = state.messages.filter((m) => m.image);
  const focusedId = els.info.contains(document.activeElement) ? document.activeElement.id : null;

  els.info.innerHTML = `
    <button type="button" class="icon-btn info-close" id="info-close" aria-label="Close details">${icon("close")}</button>
    <div class="office">
      <span class="office-avatar" aria-hidden="true">${esc(office.initial)}</span>
      <h2>${esc(office.name)}</h2>
      <p>${esc(office.fullName)}</p>
    </div>
    <div class="info-actions">
      <a class="btn btn-primary" href="/my-reports">View my reports</a>
    </div>
    <section class="info-box" aria-labelledby="info-office-heading">
      <h3 id="info-office-heading">Office details</h3>
      <dl>
        <div><dt>Where:</dt><dd>${esc(office.location)}</dd></div>
        <div><dt>Pick-up:</dt><dd>${esc(office.pickupHours)}</dd></div>
        <div><dt>Email:</dt><dd>${esc(office.email)}</dd></div>
      </dl>
    </section>
    <section aria-labelledby="info-photos-heading">
      <h3 id="info-photos-heading">Shared photos</h3>
      ${photos.length
        ? `<ul class="photo-grid">${photos.map((m) => `
            <li><button type="button" class="photo-thumb" data-src="${esc(resolveSrc(m.image))}" aria-label="Open shared photo"><img src="${esc(resolveSrc(m.image))}" alt=""></button></li>`).join("")}
          </ul>`
        : '<p class="info-empty">No photos shared yet.</p>'}
    </section>`;

  if (focusedId) document.getElementById(focusedId)?.focus();
}

function setInfoOpen(open) {
  els.app.classList.toggle("show-info", open);
  const toggle = document.getElementById("info-toggle");
  toggle?.setAttribute("aria-expanded", String(open));
  if (open) document.getElementById("info-close").focus();
  else if (els.info.contains(document.activeElement)) toggle?.focus();
}

/* ---------- Opening conversations ---------- */

function markActiveRead() {
  const conversation = activeConversation();
  if (!conversation || !conversation.unread) return;
  conversation.unread = 0;
  UserAPI.markRead(conversation.id);
  renderList();
}

function openConversation(id, { showThread = false } = {}) {
  state.activeId = id;
  composer.reset();
  if (showThread) els.app.classList.add("show-thread");
  markActiveRead();
  renderList();

  return UserAPI.getMessages(id).then((messages) => {
    if (state.activeId !== id) return; // another conversation was opened in the meantime
    const conversation = activeConversation();
    state.messages = messages;
    renderThreadHead(conversation);
    renderMessages();
    renderInfo(conversation);
    if (showThread) document.getElementById("thread-title").focus();
  });
}

// Phone layout: back from the chat to the list.
function showList() {
  setInfoOpen(false);
  els.app.classList.remove("show-thread");
  els.list.querySelector('[aria-current="true"]')?.focus();
}

/* ---------- Live updates (SWAFO's replies), checked every few seconds ---------- */

function refresh() {
  const request = ++messageRefresh;
  UserAPI.getConversations().then((conversations) => {
    if (request !== messageRefresh) return;
    state.conversations = conversations;
    if (state.query) runSearch(state.query); // new messages can change what matches
    const conversation = activeConversation();
    if (!conversation) return renderList();

    return UserAPI.getMessages(conversation.id).then((messages) => {
      if (request !== messageRefresh) return;
      const serverIds = new Set(messages.map((message) => message.id));
      if (state.messages.some((message) => !serverIds.has(message.id))) {
        state.messages = messages;
        renderMessages();
        renderInfo();
      } else {
        const known = new Set(state.messages.map((message) => message.id));
        const fresh = messages.filter((message) => !known.has(message.id));
        appendMessages(fresh);
        if (fresh.some((message) => message.image)) renderInfo();
      }
      if (threadInView()) markActiveRead();
      renderList();
    });
  }).catch(() => {}); // offline for a moment: try again on the next check
}

UserAPI.onChange(refresh);
document.addEventListener("visibilitychange", () => {
  if (threadInView()) markActiveRead();
});
setInterval(renderList, 60 * 1000); // keep "2m" / "1h" labels current

/* ---------- Composer + photo viewer ---------- */

const composer = ChatUI.setupComposer({
  form: document.getElementById("composer"),
  input: document.getElementById("composer-input"),
  send: document.getElementById("send-btn"),
  attachBtn: document.getElementById("attach-btn"),
  attachInput: document.getElementById("attach-input"),
  preview: document.getElementById("attach-preview"),
  error: document.getElementById("composer-error"),
  onSend: ({ text, image }) => {
    const conversationId = state.activeId;
    return UserAPI.sendMessage(conversationId, { text, image }).then((message) => {
      messageRefresh += 1;
      const conversation = state.conversations.find((c) => c.id === conversationId);
      conversation.lastMessage = message.text || "Sent a photo";
      conversation.updatedAt = message.time;
      // Most recent conversation moves to the top of the list.
      state.conversations = [conversation, ...state.conversations.filter((c) => c !== conversation)];
      renderList();
      if (state.query) runSearch(state.query); // its latest message changed

      if (state.activeId !== conversationId) return;
      if (!state.messages.some((entry) => entry.id === message.id)) appendMessages([message]);
      if (message.image) renderInfo(conversation); // add it to Shared photos
    });
  },
});

const openLightbox = ChatUI.setupLightbox({
  dialog: document.getElementById("lightbox"),
  image: document.getElementById("lightbox-img"),
  close: document.getElementById("lightbox-close"),
});

/* ---------- Events ---------- */

// The server looks for the query with Boyer-Moore (backend/nlp.py); the list updates when it answers.
const runSearch = SearchAPI.live("messages", (found, query) => {
  Object.assign(state, { query, found });
  renderList();
});
els.search.addEventListener("input", () => runSearch(els.search.value));

els.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filters.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  renderList();
});

els.list.addEventListener("click", (event) => {
  const button = event.target.closest(".convo");
  if (button) openConversation(button.dataset.id, { showThread: isPhoneLayout() });
});

els.head.addEventListener("click", (event) => {
  if (event.target.closest("#thread-back")) showList();
  if (event.target.closest("#info-toggle")) setInfoOpen(!els.app.classList.contains("show-info"));
});

els.info.addEventListener("click", (event) => {
  if (event.target.closest("#info-close")) setInfoOpen(false);

  const thumb = event.target.closest(".photo-thumb");
  if (thumb) openLightbox(thumb.dataset.src);
});

els.infoBackdrop.addEventListener("click", () => setInfoOpen(false));

els.messages.addEventListener("click", (event) => {
  const image = event.target.closest(".bubble-image");
  if (image) openLightbox(image.dataset.src);
});

// Photos change the thread's height as they load, so stay pinned to the newest message.
els.messages.addEventListener("load", scrollToBottom, true);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || document.getElementById("lightbox").open) return;
  if (els.app.classList.contains("show-info")) setInfoOpen(false);
});

/* ---------- Start ---------- */

Promise.all([UserAPI.getOffice(), UserAPI.getConversations()]).then(([office, conversations]) => {
  state.office = office;
  state.conversations = conversations;

  // A wide screen shows the thread right away. On a phone the list comes first, so unread SWAFO
  // messages keep their badge until the student taps the conversation (unless ?item= sent them
  // here to write).
  const itemId = new URLSearchParams(window.location.search).get("item");
  const [conversation] = conversations;
  if (isPhoneLayout() && !itemId) renderList();
  else openConversation(conversation.id, { showThread: Boolean(itemId) && isPhoneLayout() });

  // messages.html?item=FI-0224: start the message with the item's number, ready to finish.
  if (itemId) {
    const input = document.getElementById("composer-input");
    input.value = `About ${itemId}: `;
    input.dispatchEvent(new Event("input"));
    input.focus();
  }
}).catch(() => {
  els.list.innerHTML = '<li class="convo-empty">Couldn\'t load your messages. Refresh to try again.</li>';
});
