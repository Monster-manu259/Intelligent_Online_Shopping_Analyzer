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
  
  // Load filter dropdowns when navigating to filters page
  if (name === "filters" && G.summary) {
    loadFilterDropdowns();
  }
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

    setProg(65, "Loading overview…");
    await loadOverview();
    await loadFilterDropdowns();

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
      await loadFilterDropdowns();
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
    document.querySelector("button[onclick='getRecommendations()']") &&
      (document.querySelector("button[onclick='getRecommendations()']").disabled = false);
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
    await loadFilterDropdowns(); // Load segments after RFM completes
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

// ══════════════════════════════════════════════════════════════════════════════
// ADVANCED FILTERS
// ══════════════════════════════════════════════════════════════════════════════

let selectedSegments = [];
let lastFilterCustomers = [];

function switchFilterTab(tab) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.filter-panel').forEach(p => p.classList.remove('active'));
  
  document.querySelectorAll('.filter-tab').forEach(t => {
    if (t.textContent.toLowerCase().includes(tab)) {
      t.classList.add('active');
    }
  });
  
  const panel = document.getElementById('filter-' + tab);
  if (panel) panel.classList.add('active');
}

function toggleCustomDates() {
  const quick = document.getElementById('f-quick-date')?.value;
  const customDiv = document.getElementById('custom-dates');
  if (customDiv) {
    customDiv.style.display = quick ? 'none' : 'block';
  }
}

async function loadFilterDropdowns() {
  try {
    if (!G.summary) {
      console.log('No data loaded yet');
      return;
    }

    // Load segments
    try {
      const segData = await apiSegmentsList();
      const segDiv = document.getElementById('f-segments');
      if (segDiv) {
        if (segData.segments && segData.segments.length > 0) {
          segDiv.innerHTML = segData.segments.map(s => 
            `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px;">
              <input type="checkbox" value="${s.name}" onchange="updateSegments(this)" style="width:16px;height:16px;">
              ${s.name} (${s.count})
            </label>`
          ).join('');
        } else {
          segDiv.innerHTML = '<div style="padding:12px;color:#999;font-size:0.85rem;">Run RFM segmentation first to see customer segments</div>';
        }
      }
    } catch (err) {
      console.log('Segments not loaded (run RFM first)');
      const segDiv = document.getElementById('f-segments');
      if (segDiv) {
        segDiv.innerHTML = '<div style="padding:12px;color:#999;font-size:0.85rem;">Run RFM segmentation first to see customer segments</div>';
      }
    }

    // Load countries
    try {
      const countryData = await apiCountriesList();
      const sel = document.getElementById('f-country');
      if (sel && countryData.countries) {
        sel.innerHTML = '<option value="">All Countries</option>';
        countryData.countries.slice(0, 30).forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.name;
          opt.textContent = `${c.name} (${c.count})`;
          sel.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('Failed to load countries:', err);
    }
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

function handleCustomLimit(select) {
  const customInput = document.getElementById('f-custom-limit');
  if (select.value === 'custom') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = '';
  }
}

function updateSegments(checkbox) {
  if (checkbox.checked) {
    if (!selectedSegments.includes(checkbox.value)) {
      selectedSegments.push(checkbox.value);
    }
  } else {
    selectedSegments = selectedSegments.filter(s => s !== checkbox.value);
  }
}

async function applyFilters() {
  if (!G.summary) { 
    toast("Upload data first"); 
    return; 
  }

  const filters = {};

  // Customer filters
  const custId = document.getElementById('f-customer-id')?.value.trim();
  const country = document.getElementById('f-country')?.value;
  
  if (custId || selectedSegments.length > 0 || country) {
    filters.customer_filters = {};
    if (custId) filters.customer_filters.customer_id = custId;
    if (selectedSegments.length > 0) filters.customer_filters.segment = selectedSegments;
    if (country) filters.customer_filters.country = country;
  }

  // Product filters
  const prodName = document.getElementById('f-product-name')?.value.trim();
  const stockCode = document.getElementById('f-stock-code')?.value.trim();
  const priceMin = document.getElementById('f-price-min')?.value;
  const priceMax = document.getElementById('f-price-max')?.value;

  // Always send product_filters so sorting/limit work even without text filters
  const sortBy = document.getElementById('f-sort')?.value || 'quantity';
  const orderDirection = document.getElementById('f-order')?.value || 'desc';
  const limitSelect = document.getElementById('f-limit')?.value || '10';
  const customLimit = document.getElementById('f-custom-limit')?.value;
  
  // Combine column and order for backend
  const combinedSort = `${sortBy}_${orderDirection}`;
  
  // Handle custom limit - ensure valid number and reasonable max
  let finalLimit = 10;
  if (limitSelect === 'custom') {
    if (customLimit && !isNaN(customLimit) && parseInt(customLimit) > 0) {
      // Cap at reasonable maximum to prevent performance issues
      finalLimit = Math.min(parseInt(customLimit), 1000);
    } else {
      // If custom is invalid, use default
      finalLimit = 10;
    }
  } else {
    finalLimit = parseInt(limitSelect) || 10;
  }
  
  filters.product_filters = {
    sort_by: combinedSort,
    limit: finalLimit
  };
  if (prodName) filters.product_filters.product_name = prodName;
  if (stockCode) filters.product_filters.stock_code = stockCode;
  if (priceMin) filters.product_filters.price_min = parseFloat(priceMin);
  if (priceMax) filters.product_filters.price_max = parseFloat(priceMax);

  // Date filters
  const quickDate = document.getElementById('f-quick-date')?.value;
  const dateFrom = document.getElementById('f-date-from')?.value;
  const dateTo = document.getElementById('f-date-to')?.value;
  
  if (quickDate || dateFrom || dateTo) {
    filters.date_filters = {};
    if (quickDate) filters.date_filters.quick_filter = quickDate;
    if (dateFrom) filters.date_filters.from_date = dateFrom;
    if (dateTo) filters.date_filters.to_date = dateTo;
  }

  if (Object.keys(filters).length === 0) {
    toast("Select at least one filter");
    return;
  }

  setProg(30, "Applying filters...");
  
  try {
    const data = await apiFilterCombined(filters);
    
    setProg(80, "Rendering results...");
    renderFilterResults(data);
    
    setProg(100, "Done"); 
    hideProg();
    
    toast("✅ Found " + (data.total_transactions || 0).toLocaleString() + " transactions");
    
  } catch (err) {
    hideProg();
    console.error('Filter error:', err);
    showError("Filter failed: " + err.message);
  }
}

function renderFilterResults(data) {
  const section = document.getElementById('filter-results-section');
  if (!section) {
    console.error('filter-results-section not found');
    return;
  }
  
  section.style.display = 'block';

  // Render stats - USE CORRECT VALUES
  const statsDiv = document.getElementById('filter-stats');
  if (statsDiv) {
    const numTrans = data.total_transactions || 0;
    const numCust = data.total_customers || 0;
    const numProd = data.total_products || 0;
    const revenue = data.total_revenue || 0;
    
    console.log('Rendering stats:', {numTrans, numCust, numProd, revenue});
    
    statsDiv.innerHTML =
      statCard("📦", "TRANSACTIONS", numTrans.toLocaleString(), "matching filters", "#ede9ff") +
      statCard("👤", "CUSTOMERS", numCust.toLocaleString(), "unique buyers", "#dcfce7") +
      statCard("🏷️", "PRODUCTS", numProd.toLocaleString(), "unique items", "#fef3c7") +
      statCard("💰", "REVENUE", "£" + revenue.toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2}), "total value", "#fee2e2");
  }

  // Render table
  const thead = document.getElementById('filter-thead');
  const tbody = document.getElementById('filter-tbody');

  if (!thead || !tbody) {
    console.error('filter table elements not found');
    return;
  }

  const activePanelId = document.querySelector('.filter-panel.active')?.id || 'filter-customer';
  const activeTab = activePanelId.replace('filter-', '');
  const dlBtn = document.getElementById('btn-download-customers');
  if (dlBtn) dlBtn.style.display = 'none';

  // If user is on Customer tab, show customer list behind segments/country/customer ID
  if (activeTab === 'customer' && Array.isArray(data.top_customers)) {
    lastFilterCustomers = data.top_customers;
    if (dlBtn && lastFilterCustomers.length > 0) dlBtn.style.display = 'inline-flex';
    const custCount = data.top_customers.length;
    thead.innerHTML = `<tr>
      <th>#</th>
      <th>Customer (Top ${custCount} of ${data.total_customers || 0})</th>
      <th>Segment</th>
      <th>Country</th>
      <th style="text-align:right;">Invoices</th>
      <th style="text-align:right;">Products</th>
      <th style="text-align:right;">Quantity</th>
      <th style="text-align:right;">Revenue</th>
    </tr>`;

    if (custCount === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:#999;">
        No customers found matching your filters.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.top_customers.map((c, i) => `<tr>
      <td style="color:#8b5cf6;font-weight:600;">${i + 1}</td>
      <td><b>${c.customer_id ?? 'N/A'}</b></td>
      <td>${c.segment ? `<span class="pill pill-purple">${c.segment}</span>` : `<span style="color:var(--muted)">—</span>`}</td>
      <td>${c.country ? `<span class="pill pill-purple">${c.country}</span>` : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="text-align:right;">${(c.transactions || 0).toLocaleString()}</td>
      <td style="text-align:right;">${(c.unique_products || 0).toLocaleString()}</td>
      <td style="text-align:right;font-weight:600;">${(c.total_quantity || 0).toLocaleString()}</td>
      <td style="text-align:right;color:#059669;font-weight:700;">
        £${(c.total_revenue || 0).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2})}
      </td>
    </tr>`).join('');
    return;
  }

  // Not customer table
  lastFilterCustomers = [];

  // Default: product results table
  const productCount = data.top_products ? data.top_products.length : 0;

  thead.innerHTML = `<tr>
    <th>#</th>
    <th>Product (Top ${productCount} of ${data.total_products || 0})</th>
    <th>Stock Code</th>
    <th style="text-align:right;">Quantity</th>
    <th style="text-align:right;">Avg Price</th>
    <th style="text-align:right;">Orders</th>
    <th style="text-align:right;">Revenue</th>
  </tr>`;

  if (!data.top_products || data.top_products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:#999;">
      No products found matching your filters.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = data.top_products.map((p, i) => `<tr>
    <td style="color:#8b5cf6;font-weight:600;">${i + 1}</td>
    <td><b>${p.product_name || 'N/A'}</b></td>
    <td style="font-family:monospace;font-size:0.85rem;">${p.stock_code || 'N/A'}</td>
    <td style="text-align:right;font-weight:600;">${(p.total_quantity || 0).toLocaleString()}</td>
    <td style="text-align:right;">£${(p.avg_price || 0).toFixed(2)}</td>
    <td style="text-align:right;">${p.times_ordered || 0}</td>
    <td style="text-align:right;color:#059669;font-weight:700;">
      £${(p.total_revenue || 0).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2})}
    </td>
  </tr>`).join('');
}

function downloadCustomersCSV() {
  if (!Array.isArray(lastFilterCustomers) || lastFilterCustomers.length === 0) {
    toast("No customer rows to download");
    return;
  }

  const headers = [
    "customer_id",
    "segment",
    "country",
    "transactions",
    "unique_products",
    "total_quantity",
    "total_revenue",
  ];

  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    const needsQuotes = /[",\n]/.test(s);
    const safe = s.replace(/"/g, '""');
    return needsQuotes ? `"${safe}"` : safe;
  };

  const rows = [
    headers.join(","),
    ...lastFilterCustomers.map((c) =>
      headers.map((h) => esc(c[h])).join(",")
    ),
  ].join("\n");

  const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetFilters() {
  const inputs = ['f-customer-id', 'f-product-name', 'f-stock-code', 'f-price-min', 'f-price-max', 'f-date-from', 'f-date-to'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const selects = ['f-country', 'f-quick-date'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const sortEl = document.getElementById('f-sort');
  if (sortEl) sortEl.value = 'quantity';
  
  const limitEl = document.getElementById('f-limit');
  if (limitEl) limitEl.value = '10';
  
  const customLimitEl = document.getElementById('f-custom-limit');
  if (customLimitEl) {
    customLimitEl.value = '';
    customLimitEl.style.display = 'none';
  }
  
  document.querySelectorAll('#f-segments input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
  });
  selectedSegments = [];
  
  const resultsSection = document.getElementById('filter-results-section');
  if (resultsSection) {
    resultsSection.style.display = 'none';
  }

  // Ensure custom date inputs are visible again after clearing quick filter
  toggleCustomDates();
  toast("Filters reset");
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const h = await apiHealth();
    if (h.data_loaded) {
      toast("Server has existing data — loading overview…");
      await loadOverview();
      await loadProductDropdown();
      await loadFilterDropdowns();
      unlockCards();
      updateStatusBar();
    }
  } catch (err) {
    showError("Backend not reachable.");
  }
});