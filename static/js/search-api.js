/* Search runs on the server. A search box sends its query to /api/search (backend/app.py),
   which looks for it in each record's text with the Boyer-Moore algorithm (backend/nlp.py,
   section 4). The answer is the ids of the records that contain it, plus where it was found in
   the fields the page shows, so the page can mark them. Used by Browse, the student Messages
   page and the admin Reports, Found Items, Claims and Messages pages. */

const SearchAPI = (() => {
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

  // The server's answer: { ids: Set of record ids, hits: { id: { field: [[start, end], ...] } } }
  async function find(scope, query) {
    const url = `/api/search?scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Search failed (${response.status})`);
    const data = await response.json();
    return { ids: new Set(data.ids), hits: data.hits || {} };
  }

  return {
    find,

    // A live search box. Call the function this returns with the query whenever it changes (or
    // the records do). onResult(found, query) then gets the server's answer for the newest query
    // only: an older answer that arrives late is dropped. found is null for an empty query.
    live(scope, onResult) {
      let newest = 0;
      return async (query) => {
        const call = ++newest;
        const q = String(query ?? "").trim();
        let found = null;
        if (q) {
          try {
            found = await find(scope, q);
          } catch (error) {
            console.error(error);
            found = { ids: new Set(), hits: {} };
          }
        }
        if (call === newest) onResult(found, q);
      };
    },

    // `text` as HTML, with the [start, end] ranges the server found wrapped in
    // <mark class="search-hit">, so the reader sees where their search matched.
    mark(text, ranges = []) {
      const source = String(text ?? "");
      let html = "";
      let done = 0;
      for (const [start, end] of ranges) {
        const from = Math.max(start, done);
        const to = Math.min(end, source.length);
        if (from >= to) continue; // already marked, or past the end
        html += `${escape(source.slice(done, from))}<mark class="search-hit">${escape(source.slice(from, to))}</mark>`;
        done = to;
      }
      return html + escape(source.slice(done));
    },
  };
})();
