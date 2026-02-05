/* AquaGuard AI - Interactive App (Leaflet + Chart.js) - Backend Integrated */

const API = {
  parcels: "/parcels",
  timeseries: (parcelId) => `/timeseries?parcel_id=${encodeURIComponent(parcelId)}`,
  predict: "/predict",
  recommend: "/recommend",
};

async function apiGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST ${url} -> ${r.status} ${t}`);
  }
  return r.json();
}

const STRESS = {
  low: { label: "Düşük", color: "#16a34a", fill: "rgba(22,163,74,0.22)" },
  medium: { label: "Orta", color: "#eab308", fill: "rgba(234,179,8,0.22)" },
  high: { label: "Yüksek", color: "#f97316", fill: "rgba(249,115,22,0.22)" },
};

function stressBucket(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

const state = {
  parcels: [], // backend'den dolacak: [{id, name}]
  filters: {
    province: "all", // UI'da duruyor ama backend bu alanları döndürmüyor (şimdilik)
    stress: "all",   // UI'da duruyor ama risk bilgisi toplu gelmiyor (şimdilik)
    source: "all",   // UI'da duruyor ama backend bu alanları döndürmüyor (şimdilik)
    from: null,
    to: null,
  },
  selectedId: null,
  rainFactor: 1,
};

// DOM
const elProvince = document.getElementById("filterProvince");
const elFrom = document.getElementById("filterFrom");
const elTo = document.getElementById("filterTo");
const elSource = document.getElementById("filterSource");
const elApply = document.getElementById("applyFilters");
const elTable = document.getElementById("parcelTableBody");
const elMapLoading = document.getElementById("mapLoading");
const elRainSim = document.getElementById("rainSim");
const elRainSimLabel = document.getElementById("rainSimLabel");

const elATitle = document.getElementById("analysisTitle");
const elASub = document.getElementById("analysisSub");
const elABadges = document.getElementById("analysisBadges");
const elKpiStress = document.getElementById("kpiStress");
const elKpiNdvi = document.getElementById("kpiNdvi");
const elKpiRain = document.getElementById("kpiRain");
const elKpiEt = document.getElementById("kpiEt");
const elWhy = document.getElementById("analysisWhy");
const elRec = document.getElementById("recBody");

const form = document.getElementById("parcelForm");

// Map
let map;

// Charts
let chartNdvi;
let chartClimate;
let chartShap;

function setMapLoading(isLoading) {
  if (!elMapLoading) return;
  if (isLoading) elMapLoading.classList.remove("hidden");
  else elMapLoading.classList.add("hidden");
}

function ensureMap() {
  if (map) return;
  map = L.map("leafletMap", { zoomControl: true }).setView([38.5, 34.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

/**
 * Backend /parcels sadece id veriyor -> filtreleri şimdilik uygulamıyoruz.
 * UI bozulmasın diye fonksiyon duruyor.
 */
function filterParcels() {
  return state.parcels;
}

function populateProvinceOptions() {
  // Backend bu alanı döndürmüyor -> sadece "Tümü"
  if (!elProvince) return;
  elProvince.innerHTML = `<option value="all">Tümü</option>`;
}

function ensureCharts() {
  if (chartNdvi) return;

  const ctx1 = document.getElementById("chartNdvi");
  const ctx2 = document.getElementById("chartClimate");
  const ctx3 = document.getElementById("chartShap");

  chartNdvi = new Chart(ctx1, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 0, suggestedMax: 1 } },
    },
  });

  chartClimate = new Chart(ctx2, {
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { title: { display: true, text: "Yağış (mm)" } },
        y1: {
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Sıcaklık (°C)" },
        },
      },
    },
  });

  chartShap = new Chart(ctx3, {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      animation: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { suggestedMin: 0, suggestedMax: 0.5 } },
    },
  });
}

function animateNumber(el, targetStr) {
  const target = Number(targetStr.toString().replace(/[^\d.-]/g, ""));
  if (Number.isNaN(target)) {
    el.textContent = targetStr;
    return;
  }
  const start = Number(el.textContent.toString().replace(/[^\d.-]/g, "")) || 0;
  const diff = target - start;
  const duration = 420;
  const startTime = performance.now();

  function frame(now) {
    const t = clamp((now - startTime) / duration, 0, 1);
    const current = start + diff * t;

    el.textContent = targetStr.includes("mm")
      ? `${current.toFixed(1)} mm`
      : targetStr.includes("/100")
        ? `${Math.round(current)}/100`
        : current.toFixed(3);

    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderTable() {
  const visible = filterParcels();
  if (!visible.length) {
    elTable.innerHTML =
      '<div class="map-table-row"><span>Sonuç yok</span><span>—</span><span>—</span><span>—</span></div>';
    return;
  }

  elTable.innerHTML = visible
    .map((p) => {
      return `
        <div class="map-table-row" data-id="${p.id}" role="button" tabindex="0">
          <span>${p.name || p.id}</span>
          <span>—</span>
          <span>—</span>
          <span>—</span>
        </div>
      `;
    })
    .join("");

  elTable.querySelectorAll(".map-table-row[data-id]").forEach((row) => {
    row.addEventListener("click", () => selectParcel(row.dataset.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") selectParcel(row.dataset.id);
    });
  });
}

/**
 * Backend ile çalışan selectParcel:
 * - GET /timeseries
 * - POST /predict
 * - POST /recommend
 */
async function selectParcel(id) {
  const parcel = state.parcels.find((p) => p.id === id);
  if (!parcel) return;
  state.selectedId = id;

  // UI initial
  elATitle.textContent = parcel.name || parcel.id;
  elASub.textContent = `Parsel ID: ${parcel.id}`;
  elABadges.innerHTML = `<span class="pill">${parcel.id}</span>`;

  elKpiStress.textContent = "—";
  elKpiNdvi.textContent = "—";
  elKpiRain.textContent = "—";
  elKpiEt.textContent = "—";
  elWhy.textContent = "Veriler yükleniyor...";
  elRec.textContent = "Yükleniyor...";

  ensureCharts();

  try {
    // 1) timeseries
    const ts = await apiGet(API.timeseries(id));

    const ndviArr = ts.ndvi || [];
    const meteoArr = ts.meteo || [];

    const lastNdvi = ndviArr.length ? ndviArr[ndviArr.length - 1].value : null;
    const lastMeteo = meteoArr.length ? meteoArr[meteoArr.length - 1] : null;

    if (lastNdvi != null) animateNumber(elKpiNdvi, `${Number(lastNdvi).toFixed(3)}`);
    if (lastMeteo) {
      animateNumber(elKpiRain, `${Number(lastMeteo.rain_mm).toFixed(1)} mm`);
      animateNumber(elKpiEt, `—`); // backend ET döndürmüyor
      elASub.textContent = `Parsel ID: ${parcel.id} · Son güncelleme: ${fmtDate(lastMeteo.date)}`;
    }

    // NDVI chart
    chartNdvi.data.labels = ndviArr.map((p) => fmtDate(p.date));
    chartNdvi.data.datasets = [
      {
        label: "NDVI",
        data: ndviArr.map((p) => p.value),
        borderColor: "#16a34a",
        backgroundColor: "rgba(22,163,74,0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 0,
      },
    ];
    chartNdvi.update();

    // Climate chart: rain + temp (ET yok)
    const last14 = meteoArr.slice(-14);
    chartClimate.data.labels = last14.map((p) => fmtDate(p.date));
    chartClimate.data.datasets = [
      {
        type: "bar",
        label: "Yağış (mm)",
        data: last14.map((p) => p.rain_mm),
        backgroundColor: "rgba(14,165,233,0.35)",
        borderColor: "rgba(14,165,233,0.9)",
        borderWidth: 1,
        yAxisID: "y",
      },
      {
        type: "line",
        label: "Sıcaklık (°C)",
        data: last14.map((p) => p.temp_c),
        borderColor: "#f97316",
        backgroundColor: "rgba(249,115,22,0.12)",
        tension: 0.35,
        pointRadius: 0,
        yAxisID: "y1",
      },
    ];
    chartClimate.update();

    // 2) predict
    const pred = await apiPost(API.predict, { parcel_id: id });
    const risk7 = typeof pred.risk_7d === "number" ? pred.risk_7d : null;

    if (risk7 != null) {
      const bucket = stressBucket(risk7);
      animateNumber(elKpiStress, `${Math.round(risk7)}/100`);
      elABadges.innerHTML = `
        <span class="pill ${bucket}">${STRESS[bucket].label} stres</span>
        <span class="pill">${parcel.id}</span>
      `;
    }

    // why text from top_factors
    const factors = pred.top_factors || [];
    elWhy.innerHTML = `
      <div><strong>Model açıklaması (MVP):</strong></div>
      <div style="margin-top:.35rem; font-size:.9rem; opacity:.9">
        ${factors.length ? factors.map((x) => `• ${x}`).join("<br/>") : "Faktör bulunamadı."}
      </div>
    `;

    // shap demo chart from factors
    chartShap.data.labels = factors.slice(0, 5);
    chartShap.data.datasets = [
      {
        label: "Etki (demo)",
        data: factors.slice(0, 5).map((_, i) => 0.35 - i * 0.05),
        backgroundColor: "rgba(34,197,94,0.35)",
        borderColor: "rgba(34,197,94,0.9)",
        borderWidth: 1,
      },
    ];
    chartShap.update();

    // 3) recommend
    if (risk7 != null) {
      const rec = await apiPost(API.recommend, { parcel_id: id, risk_7d: risk7 });
      elRec.innerHTML = `
        <strong>${rec.window}</strong> yaklaşık <strong>${rec.amount_mm} mm</strong><br/>
        <span style="opacity:.85">${rec.rationale}</span>
      `;
    } else {
      elRec.textContent = "Öneri üretilemedi.";
    }

    // Panel visible
    const panel = document.querySelector(".analysis-panel");
    if (panel && !panel.classList.contains("is-visible")) {
      requestAnimationFrame(() => panel.classList.add("is-visible"));
    }
  } catch (e) {
    elWhy.textContent = `Hata: ${e.message}`;
    elRec.textContent = "—";
  }
}

function bindFilters() {
  // Chip filters (UI duruyor)
  document.querySelectorAll(".chip-filter[data-stress]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip-filter[data-stress]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filters.stress = btn.dataset.stress;
    });
  });

  if (elApply) {
    elApply.addEventListener("click", () => {
      state.filters.province = elProvince?.value || "all";
      state.filters.source = elSource?.value || "all";
      state.filters.from = elFrom?.value || null;
      state.filters.to = elTo?.value || null;

      // Geo/stress toplu hesap yok -> tabloyu sadece yeniden render ediyoruz
      renderTable();
      if (state.selectedId) selectParcel(state.selectedId);
    });
  }

  if (elRainSim && elRainSimLabel) {
    elRainSim.addEventListener("input", () => {
      const val = Number(elRainSim.value || "100");
      state.rainFactor = val / 100;
      elRainSimLabel.textContent = `%${val} yağış senaryosu (demo)`;
      // backend risk hesaplıyor; rain sim şu an sadece UI label (istersen backend'e parametre geçeriz)
    });
  }
}

function bindForm() {
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // Bu form hackathon UI demo; backend'de create endpoint yok.
    alert("Bu form demo amaçlı. Parsel ekleme backend endpoint'i henüz yok.");
    form.reset();
  });
}

async function init() {
  ensureMap();
  setMapLoading(true);

  populateProvinceOptions();
  bindFilters();
  bindForm();
  ensureCharts();

  // Backend parcels
  const list = await apiGet(API.parcels); // [{parcel_id,name}]
  state.parcels = (list || []).map((x) => ({
    id: x.parcel_id,
    name: x.name || x.parcel_id,
  }));

  renderTable();

  const first = state.parcels[0];
  if (first) await selectParcel(first.id);

  setMapLoading(false);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => {
    setMapLoading(false);
    alert(`Init error: ${e.message}`);
  });
});
