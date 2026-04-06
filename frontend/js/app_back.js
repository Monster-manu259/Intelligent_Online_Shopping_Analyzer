/**
 * app.js — Navigation, state management, UI event handlers
 * Calls api.js for data, charts.js for rendering
 */

// ── State ─────────────────────────────────────────────────────────────────────
const G = { summary: null, rules: [] };

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, dur = 3500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), dur);
}

function showError(msg) {
  toast("❌ " + msg, 6000);
  console.error("[ShopIQ]", msg);
}

// ── Progress ──────────────────────────────────────────────────────────────────
function setProg(pct, label) {
  document.getElementById("progress-wrap").style.display = "block";
  document.getElementById("prog-fill").style.width = pct + "%";
  document.getElementById("prog-label").textContent = label;
}
function hideProg() {
  setTimeout(() => document.getElementById("progress-wrap").style.display = "none", 700);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navTo(name, btn) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const map = { dashboard: 0, upload: 1, overview: 2, basket: 3, segments: 4, filters: 5 };
    if (map[name] !== undefined)
      document.querySelectorAll(".nav-item")[map[name]].classList.add("active");
  }
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
}

function gotoIfData(name) {
  if (!G.summary) { toast("Upload data first"); navTo("upload", null); return; }
  navTo(name, null);
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById("upload-zone").classList.add("drag");
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById("upload-zone").classList.remove("drag");
  const f = e.dataTransfer.files[0];
  if (f) handleUpload(f);
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function handleUpload(file) {
  if (!file) return;
  setProg(10, "Uploading " + file.name + "…");
  try {
    setProg(35, "Cleaning data on server…");
    const data = await apiUpload(file);
    G.summary = data.summary;
    await loadFilterDropdowns();  
    setProg(65, "Loading overview…");
    await loadOverview();

    setProg(100, "Done ✓");
    hideProg();

    unlockCards();
    updateStatusBar();
    navTo("overview", null);
    toast("✅ Loaded " + data.summary.total_rows.toLocaleString() + " transactions");

    // Auto-run basket + RFM in background
    setTimeout(async () => {
      await runBasket();
      await loadProductDropdown();
    }, 600);

  } catch (err) {
    hideProg();
    showError(err.message);
  }
}

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const data = await apiOverview();
    renderStats(data.summary, "stats-row");
    renderStats(data.summary, "dash-stats-row");
    document.getElementById("dash-stats").style.display = "block";
    buildMonthlyChart(data.monthly);
    buildProductsChart(data.products);
    buildCountriesChart(data.countries);
    renderSampleTable(data.sample);
  } catch (err) {
    showError("Overview failed: " + err.message);
  }
}

function renderStats(s, containerId) {
  document.getElementById(containerId).innerHTML =
    statCard("📦","Transactions", s.total_rows.toLocaleString(),   s.unique_invoices.toLocaleString()+" invoices","#ede9ff") +
    statCard("👤","Customers",    s.unique_customers.toLocaleString(), s.countries+" countries","#dcfce7") +
    statCard("🏷️","Products",     s.unique_products.toLocaleString(),  "distinct SKUs","#fef3c7") +
    statCard("💰","Revenue", "£"+s.total_revenue.toLocaleString("en-GB",{maximumFractionDigits:0}), s.date_from+" – "+s.date_to,"#fee2e2");
}

function statCard(icon, label, val, sub, bg) {
  return `<div class="stat-card">
    <div class="stat-icon-wrap" style="background:${bg}">${icon}</div>
    <div class="stat-info">
      <div class="label">${label}</div>
      <div class="value">${val}</div>
      <div class="sub">${sub}</div>
    </div></div>`;
}

function renderSampleTable(rows) {
  const tb = document.querySelector("#sample-table tbody");
  tb.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${r.InvoiceNo}</b></td>
      <td>${String(r.Description).slice(0,35)}</td>
      <td>${r.Quantity}</td>
      <td>£${Number(r.UnitPrice).toFixed(2)}</td>
      <td><b>£${Number(r.TotalPrice).toFixed(2)}</b></td>
      <td>${r.CustomerID}</td>
      <td><span class="pill pill-purple">${r.Country}</span></td>
      <td style="color:var(--muted);font-size:.75rem">${String(r.InvoiceDate).slice(0,10)}</td>`;
    tb.appendChild(tr);
  });
}

// ── Sliders ───────────────────────────────────────────────────────────────────
function updSlider(id, lbl, suffix, mul) {
  const v = parseFloat(document.getElementById(id).value) * mul;
  document.getElementById(lbl).textContent = v.toFixed(1) + suffix;
}

// ── Basket ────────────────────────────────────────────────────────────────────
async function runBasket() {
  if (!G.summary) { toast("Upload data first"); return; }
  setProg(20, "Running FP-Growth on server…");
  try {
    const data = await apiBasket({
      min_support:    parseFloat(document.getElementById("sl-support").value),
      min_confidence: parseFloat(document.getElementById("sl-conf").value),
      min_lift:       parseFloat(document.getElementById("sl-lift").value),
      top_n_items:    100,
    });
    G.rules = data.rules;
    setProg(85, "Rendering rules…");
    renderBasket(data);
    await loadProductDropdown();
    document.querySelector("button[onclick=\'getRecommendations()\']") &&
      (document.querySelector("button[onclick=\'getRecommendations()\']").disabled = false);
    setProg(100, "Done"); hideProg();
    toast("✅ " + data.total_rules + " association rules found");
  } catch (err) {
    hideProg();
    document.getElementById("rules-body").innerHTML =
      `<tr><td colspan="6" style="padding:20px;color:#dc2626;text-align:center">
        ❌ ${err.message}<br>
        <small style="color:var(--muted)">Try lowering Min Support and rerun.</small>
      </td></tr>`;
    showError("Basket failed: " + err.message);
  }
}

function renderBasket(data) {
  document.getElementById("basket-kpis").innerHTML =
    statCard("🔗","Total Rules",    data.total_rules, "association rules","#ede9ff") +
    statCard("⚡","Max Lift",        data.max_lift.toFixed(2)+"×","strongest pair","#dcfce7") +
    statCard("🎯","Avg Confidence",  (data.avg_confidence*100).toFixed(1)+"%","mean","#fef3c7");

  buildBubbleChart(data.rules);

  const tb = document.getElementById("rules-body");
  tb.innerHTML = "";
  data.rules.slice(0, 100).forEach((r, i) => {
    const pc = r.lift >= 3 ? "pill-green" : r.lift >= 1.5 ? "pill-amber" : "pill-purple";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:.75rem">${i+1}</td>
      <td>${r.antecedents}</td><td>${r.consequents}</td>
      <td>${(r.support*100).toFixed(2)}%</td>
      <td>${(r.confidence*100).toFixed(1)}%</td>
      <td><span class="pill ${pc}">${r.lift.toFixed(2)}×</span></td>`;
    tb.appendChild(tr);
  });
}

// ── Recommender ───────────────────────────────────────────────────────────────
async function loadProductDropdown() {
  try {
    const data = await apiProducts();
    const sel = document.getElementById("rec-product");
    sel.innerHTML = data.products.map(p => `<option value="${p}">${p}</option>`).join("");
  } catch (err) {
    showError("Could not load products: " + err.message);
  }
}

function getRecommendations() {
  const product = document.getElementById("rec-product").value;
  const k       = parseInt(document.getElementById("rec-k").value) || 5;
  const ul      = document.getElementById("rec-list");

  if (!product || !G.rules.length) {
    ul.innerHTML = `<li style="color:var(--muted);padding:20px;font-size:.85rem">
      ⚠️ Click <b>⚡ Compute Rules</b> first, then select a product.</li>`;
    return;
  }

  // Filter locally from already-loaded rules — no API call needed
  const recs = G.rules
    .filter(r => r.antecedents.toLowerCase().includes(product.toLowerCase()))
    .slice(0, k);

  if (!recs.length) {
    ul.innerHTML = `<li style="color:#dc2626;padding:16px 20px;font-size:.85rem;
      background:#fff5f5;border-radius:10px;border:1px solid #fecaca">
      ❌ No recommendations found for "${product}". Try lowering thresholds.</li>`;
    return;
  }

  ul.innerHTML = recs.map((r, i) => `
    <li class="rec-item">
      <span class="rec-rank">${i+1}</span>
      <span class="rec-name">${r.consequents}</span>
      <span class="rec-chips">
        <span class="pill pill-purple">conf ${(r.confidence*100).toFixed(0)}%</span>
        <span class="pill pill-green">lift ${r.lift.toFixed(2)}×</span>
      </span></li>`).join("");
}

// ── RFM ───────────────────────────────────────────────────────────────────────
async function runRFM() {
  if (!G.summary) { toast("Upload data first"); return; }
  const n = parseInt(document.getElementById("n-clusters").value) || 5;
  setProg(20, "Running RFM segmentation on server…");
  try {
    const data = await apiRFM(n);
    setProg(85, "Rendering segments…");
    renderSegments(data.summary);
    setProg(100, "Done"); hideProg();
    toast("✅ " + n + " customer segments computed");
  } catch (err) {
    hideProg();
    showError("RFM failed: " + err.message);
  }
}

function renderSegments(summary) {
  document.getElementById("seg-cards").innerHTML = summary.map(s => `
    <div class="seg-card" style="border-top-color:${s.Color}">
      <div class="seg-name" style="color:${s.Color}">${s.Segment}</div>
      <div class="seg-count">${s.Customers.toLocaleString()}</div>
      <div class="seg-sub">customers</div>
      <div class="seg-meta">
        <span class="seg-chip">Recency <b>${s.Avg_Recency}d</b></span>
        <span class="seg-chip">Freq <b>${s.Avg_Frequency}</b></span>
        <span class="seg-chip">LTV <b>£${Number(s.Avg_Monetary).toLocaleString()}</b></span>
      </div></div>`).join("");

  buildSegmentDonut(summary);
  buildSegmentBar(summary);

  const tb = document.getElementById("seg-table-body");
  tb.innerHTML = "";
  [...summary].sort((a,b) => b.Total_Revenue - a.Total_Revenue).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b style="color:${s.Color}">${s.Segment}</b></td>
      <td>${s.Customers.toLocaleString()}</td>
      <td>${s.Avg_Recency}d</td>
      <td>${s.Avg_Frequency}</td>
      <td>£${Number(s.Avg_Monetary).toLocaleString()}</td>
      <td><b>£${Number(s.Total_Revenue).toLocaleString()}</b></td>`;
    tb.appendChild(tr);
  });
}

// ── Unlock cards after upload ─────────────────────────────────────────────────
function unlockCards() {
  ["overview","rec","seg"].forEach(k => {
    const btn = document.getElementById("btn-" + k);
    if (btn) {
      btn.classList.remove("feat-btn-disabled");
      btn.classList.add("feat-btn-primary");
      btn.textContent = k==="overview" ? "▶ View Sales" : k==="rec" ? "▶ Get Recommendations" : "▶ View Segments";
    }
  });
}

function updateStatusBar() {
  if (!G.summary) return;
  document.getElementById("status-dot").classList.add("live");
  document.getElementById("status-text").textContent = G.summary.total_rows.toLocaleString() + " rows";
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetAll() {
  G.summary = null;
  G.rules   = [];
  ["monthly","products","countries","bubble","seg-donut","seg-bar"].forEach(destroyChart);
  document.getElementById("status-dot").classList.remove("live");
  document.getElementById("status-text").textContent = "No Data";
  document.getElementById("dash-stats").style.display = "none";
  ["overview","rec","seg"].forEach(k => {
    const btn = document.getElementById("btn-" + k);
    if (btn) { btn.className = "feat-btn feat-btn-disabled"; btn.textContent = "▶ Upload Data First"; }
  });
  navTo("dashboard", null);
  toast("Data cleared");
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const h = await apiHealth();
    if (h.data_loaded) {
      toast("Server has existing data — loading overview…");
      await loadOverview();
      await loadProductDropdown();
      await loadFilterDropdowns();  // ADD THIS LINE
      unlockCards();
      updateStatusBar();
    }
  } catch (err) {
    showError("Backend not reachable.");
  }
});

// ── Filters ───────────────────────────────────────────────────────────────────

let selectedSegments = [];

function switchFilterTab(tab) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.filter-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('filter-' + tab).classList.add('active');
}

function toggleCustomDates() {
  const quick = document.getElementById('f-quick-date').value;
  document.getElementById('custom-dates').style.display = quick ? 'none' : 'block';
}

async function loadFilterDropdowns() {
  try {
    // Load segments
    const segData = await apiSegmentsList();
    const segDiv = document.getElementById('f-segments');
    segDiv.innerHTML = segData.segments.map(s => 
      `<label><input type="checkbox" value="${s.name}" onchange="updateSegments(this)"> ${s.name} (${s.count})</label>`
    ).join('');

    // Load countries
    const countryData = await apiCountriesList();
    const sel = document.getElementById('f-country');
    sel.innerHTML = `<option value="">All Countries</option>`;
    countryData.countries.slice(0, 20).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;            // actual filter value
    opt.textContent = `${c.name} (${c.count})`; // display text
    sel.appendChild(opt);
});
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

function updateSegments(checkbox) {
  if (checkbox.checked) {
    selectedSegments.push(checkbox.value);
  } else {
    selectedSegments = selectedSegments.filter(s => s !== checkbox.value);
  }
}

async function applyFilters() {
  if (!G.summary) { toast("Upload data first"); return; }

  const filters = {
    customer_filters: {},
    product_filters: {},
    date_filters: {}
  };

  // Customer filters
  const custId = document.getElementById('f-customer-id').value;
  const country = document.getElementById('f-country').value;
  if (custId || selectedSegments.length || country) {
    filters.customer_filters = {
      customer_id: custId || null,
      segment: selectedSegments.length ? selectedSegments : null,
      country: country || null
    };
  } else {
    delete filters.customer_filters;
  }

  // Product filters
  const prodName = document.getElementById('f-product-name').value;
  const stockCode = document.getElementById('f-stock-code').value;
  const priceMin = document.getElementById('f-price-min').value;
  const priceMax = document.getElementById('f-price-max').value;
  if (prodName || stockCode || priceMin || priceMax) {
    filters.product_filters = {
      product_name: prodName || null,
      stock_code: stockCode || null,
      price_min: priceMin ? parseFloat(priceMin) : null,
      price_max: priceMax ? parseFloat(priceMax) : null,
      sort_by: document.getElementById('f-sort').value,
      limit: parseInt(document.getElementById('f-limit').value)
    };
  } else {
    delete filters.product_filters;
  }

  // Date filters
  const quickDate = document.getElementById('f-quick-date').value;
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo = document.getElementById('f-date-to').value;
  if (quickDate || dateFrom || dateTo) {
    filters.date_filters = {
      quick_filter: quickDate || null,
      from_date: dateFrom || null,
      to_date: dateTo || null
    };
  } else {
    delete filters.date_filters;
  }

  setProg(30, "Applying filters...");
  try {
    const data = await apiFilterCombined(filters);
    console.log("Filter API result:", data);
    setProg(80, "Rendering results...");
    renderFilterResults(data);
    setProg(100, "Done"); hideProg();
    toast("✅ Found " + data.total_transactions.toLocaleString() + " transactions");
  } catch (err) {
    hideProg();
    showError("Filter failed: " + err.message);
  }
}

function renderFilterResults(data) {
  console.log('Rendering filter results:', data);
  
  const section = document.getElementById('filter-results-section');
  if (!section) {
    console.error('filter-results-section not found in DOM');
    return;
  }
  
  section.style.display = 'block';

  // Render stats cards - FIXED to show correct numbers
  const statsDiv = document.getElementById('filter-stats');
  if (statsDiv) {
    const numTransactions = data.total_transactions || 0;
    const numCustomers = data.total_customers || 0;
    const numProducts = data.total_products || 0;
    const revenue = data.total_revenue || 0;
    
    console.log('Stats:', {numTransactions, numCustomers, numProducts, revenue});
    
    statsDiv.innerHTML =
      statCard("📦", "TRANSACTIONS", numTransactions.toLocaleString(), "matching filters", "#ede9ff") +
      statCard("👤", "CUSTOMERS", numCustomers.toLocaleString(), "unique buyers", "#dcfce7") +
      statCard("🏷️", "PRODUCTS", numProducts.toLocaleString(), "unique items", "#fef3c7") +
      statCard("💰", "REVENUE", "£" + revenue.toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2}), "total value", "#fee2e2");
  }

  // Render results table
  const thead = document.getElementById('filter-thead');
  const tbody = document.getElementById('filter-tbody');

  if (!thead || !tbody) {
    console.error('filter table elements not found');
    return;
  }

  const productCount = data.top_products ? data.top_products.length : 0;
  
  thead.innerHTML = `<tr>
    <th style="width:50px;">#</th>
    <th>Product (Showing Top ${productCount})</th>
    <th>Stock Code</th>
    <th style="text-align:right;">Qty</th>
    <th style="text-align:right;">Avg Price</th>
    <th style="text-align:right;">Orders</th>
    <th style="text-align:right;">Revenue</th>
  </tr>`;

  if (!data.top_products || data.top_products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:#999;">
      No products found matching your filters. Try adjusting the criteria.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = data.top_products.map((p, i) => `<tr>
    <td style="color:#8b5cf6;font-weight:600;">${i + 1}</td>
    <td style="max-width:300px;"><b>${p.product_name || 'N/A'}</b></td>
    <td style="font-family:monospace;font-size:0.85rem;">${p.stock_code || 'N/A'}</td>
    <td style="text-align:right;font-weight:600;">${(p.total_quantity || 0).toLocaleString()}</td>
    <td style="text-align:right;">£${(p.avg_price || 0).toFixed(2)}</td>
    <td style="text-align:right;">${p.times_ordered || 0}</td>
    <td style="text-align:right;color:#059669;font-weight:700;font-size:1.05rem;">
      £${(p.total_revenue || 0).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2})}
    </td>
  </tr>`).join('');

  // Scroll to results
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}