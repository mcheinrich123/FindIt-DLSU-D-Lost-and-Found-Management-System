// Items from the Flask database (app.py), turned into the shape the pages render: the same
// fields as a found item in ./item-store.js. Used by Browse, Item details and Claim, and by the
// admin's AdminAPI for Found Items and Claims.
//
// Public responses never include brand, identifyingDetails, turnedInBy or storage; those come
// back (and are filled in below) only for admins.

const ItemsAPI = (() => {
  const PLACEHOLDER_IMAGE = "/static/assets/images/item-placeholder.svg";

  function fromApi(raw) {
    return {
      id: raw.id,
      type: raw.type, // "lost" | "found"
      name: raw.name,
      category: raw.category,
      color: raw.color || "",
      description: raw.description || "",
      image: raw.image || null,
      locationId: raw.locationId || raw.location,
      locationOther: raw.locationOther || "",
      locationDetails: raw.locationDetails || "",
      dateFound: raw.dateFound || raw.dateLost, // the lost date for a lost report
      status: raw.status,
      loggedAt: raw.dateReported,
      addedByAdmin: Boolean(raw.addedByAdmin),
      brand: raw.brand || "",
      identifyingDetails: raw.identifyingDetails || "",
      turnedInBy: raw.turnedInBy || "",
      storage: raw.storage || "",
    };
  }

  async function getJSON(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
  }

  return {
    PLACEHOLDER_IMAGE,
    fromApi,

    // What the public can browse and claim: found items that aren't claimed yet, newest first.
    available: () => getJSON("/api/items").then((items) => items.map(fromApi)),

    // One item by its reference (FI-0005), or null if there's no such item or it isn't public.
    async get(id) {
      const response = await fetch(`/api/items/${encodeURIComponent(id)}`, { credentials: "same-origin" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`/api/items/${id} answered ${response.status}`);
      return fromApi(await response.json());
    },

    // Runs the callback when the student comes back to this tab, so items logged or claimed in
    // the meantime show up.
    onChange(callback) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") callback();
      });
    },
  };
})();
