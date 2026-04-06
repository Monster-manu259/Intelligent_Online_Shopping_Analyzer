/**
 * api.js — All HTTP calls to the FastAPI backend (http://127.0.0.1:8000)
 */

const API_BASE = "http://127.0.0.1:8000";

/**
 * Core fetch wrapper.
 * Throws an Error with the backend detail message on non-2xx responses.
 */
async function apiFetch(path, options = {}) {
  try {
    const res  = await fetch(API_BASE + path, options);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(
        "Cannot reach backend. Is the server running? "
      );
    }
    throw err;
  }
}

/** GET /api/health */
async function apiHealth() {
  return apiFetch("/api/health");
}

/** POST /api/upload — multipart form */
async function apiUpload(file) {
  const form = new FormData();
  form.append("file", file);
  return apiFetch("/api/upload", { method: "POST", body: form });
}

/** GET /api/overview */
async function apiOverview() {
  return apiFetch("/api/overview");
}

/** POST /api/basket */
async function apiBasket(params) {
  return apiFetch("/api/basket", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
}

/** GET /api/products */
async function apiProducts() {
  return apiFetch("/api/products");
}

/** GET /api/recommend */
async function apiRecommend(product, topK = 5) {
  return apiFetch(
    `/api/recommend?product=${encodeURIComponent(product)}&top_k=${topK}`
  );
}

/** POST /api/rfm */
async function apiRFM(nClusters = 5) {
  return apiFetch("/api/rfm", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ n_clusters: nClusters }),
  });
}

/** POST /api/filter/combined */
async function apiFilterCombined(filters) {
  return apiFetch("/api/filter/combined", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters),
  });
}

/** GET /api/segments/list */
async function apiSegmentsList() {
  return apiFetch("/api/segments/list");
}

/** GET /api/countries/list */
async function apiCountriesList() {
  return apiFetch("/api/countries/list");
}
