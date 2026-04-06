/**
 * charts.js — All Chart.js chart creation and destruction
 */

const _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function _lightScale() {
  return {
    grid:  { color: "rgba(0,0,0,.05)" },
    ticks: { color: "#7a6fa0" },
  };
}

function _baseOpts(yLabel = "", xLabel = "") {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ..._lightScale(), ...(xLabel ? { title: { display: true, text: xLabel, color: "#7a6fa0" } } : {}) },
      y: { ..._lightScale(), ...(yLabel ? { title: { display: true, text: yLabel, color: "#7a6fa0" } } : {}) },
    },
  };
}

/** Monthly revenue area chart */
function buildMonthlyChart(rows) {
  destroyChart("monthly");
  _charts.monthly = new Chart(document.getElementById("chart-monthly"), {
    type: "line",
    data: {
      labels: rows.map(r => r.month),
      datasets: [{
        label: "Revenue £", data: rows.map(r => r.revenue),
        borderColor: "#6d28d9", backgroundColor: "rgba(109,40,217,.08)",
        fill: true, tension: .4, pointRadius: 3, pointBackgroundColor: "#6d28d9",
      }],
    },
    options: _baseOpts("Revenue (£)"),
  });
}

/** Top 10 products horizontal bar */
function buildProductsChart(rows) {
  destroyChart("products");
  _charts.products = new Chart(document.getElementById("chart-products"), {
    type: "bar",
    data: {
      labels: rows.map(r => r.name.length > 30 ? r.name.slice(0, 30) + "…" : r.name),
      datasets: [{
        label: "Revenue £", data: rows.map(r => r.revenue),
        backgroundColor: rows.map((_, i) => `hsla(${250 + i * 5},70%,${60 - i * 2}%,0.85)`),
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: { ..._baseOpts(), ...{ indexAxis: "y", plugins: { legend: { display: false } } } },
  });
}

/** Top countries doughnut */
function buildCountriesChart(rows) {
  destroyChart("countries");
  _charts.countries = new Chart(document.getElementById("chart-countries"), {
    type: "doughnut",
    data: {
      labels: rows.map(r => r.country),
      datasets: [{
        data: rows.map(r => r.revenue),
        backgroundColor: ["#6d28d9","#7c3aed","#8b5cf6","#a78bfa","#c4b5fd","#4f46e5","#4338ca","#3730a3"],
        borderWidth: 2, borderColor: "#fff",
      }],
    },
    options: {
      plugins: { legend: { position: "right", labels: { color: "#7a6fa0", font: { size: 11 }, boxWidth: 12 } } },
      responsive: true, maintainAspectRatio: true,
    },
  });
}

/** Basket bubble chart */
function buildBubbleChart(rules) {
  destroyChart("bubble");
  const top30 = rules.slice(0, 30);
  _charts.bubble = new Chart(document.getElementById("chart-bubble"), {
    type: "bubble",
    data: {
      datasets: [{
        label: "Rules",
        data: top30.map(r => ({ x: r.support, y: r.confidence, r: Math.min(r.lift * 5, 28) })),
        backgroundColor: "rgba(109,40,217,.45)", borderColor: "#6d28d9", borderWidth: 1,
      }],
    },
    options: {
      ..._baseOpts("Confidence", "Support"),
      ...{
        scales: {
          x: { ..._lightScale(), title: { display: true, text: "Support",    color: "#7a6fa0" } },
          y: { ..._lightScale(), title: { display: true, text: "Confidence", color: "#7a6fa0" } },
        },
      },
    },
  });
}

/** Segment doughnut */
function buildSegmentDonut(summary) {
  destroyChart("seg-donut");
  _charts["seg-donut"] = new Chart(document.getElementById("chart-seg-donut"), {
    type: "doughnut",
    data: {
      labels: summary.map(s => s.Segment),
      datasets: [{ data: summary.map(s => s.Customers), backgroundColor: summary.map(s => s.Color), borderWidth: 2, borderColor: "#fff" }],
    },
    options: {
      plugins: { legend: { position: "right", labels: { color: "#7a6fa0", font: { size: 11 }, boxWidth: 12 } } },
      responsive: true, maintainAspectRatio: true,
    },
  });
}

/** Segment bar chart */
function buildSegmentBar(summary) {
  destroyChart("seg-bar");
  _charts["seg-bar"] = new Chart(document.getElementById("chart-seg-bar"), {
    type: "bar",
    data: {
      labels: summary.map(s => s.Segment),
      datasets: [{
        label: "Avg £", data: summary.map(s => s.Avg_Monetary),
        backgroundColor: summary.map(s => s.Color), borderRadius: 6, borderSkipped: false,
      }],
    },
    options: { ..._baseOpts("Avg Monetary £"), ...{ plugins: { legend: { display: false } } } },
  });
}
