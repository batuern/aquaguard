/* AquaGuard AI - Demo Interactive App (Leaflet + Chart.js)
   - Mock parsel verisi
   - Filtre state'i
   - Harita + tablo senkronu
   - "Neden yüksek stres?" AI açıklama paneli ve grafikler (mock SHAP)
*/
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

function rnd(min, max) {
  return Math.random() * (max - min) + min;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function generateSeries(baseNdvi, trend, volatility = 0.02) {
  // 28 günlük seri üret
  const pts = [];
  for (let i = 27; i >= 0; i--) {
    const date = daysAgo(i);
    const rain = clamp(Math.round(rnd(0, 18)), 0, 30);
    const et = clamp(Number((rnd(2.5, 6.5)).toFixed(1)), 0, 10);
    const ndviNoise = rnd(-volatility, volatility);
    const ndvi = clamp(baseNdvi + trend * (27 - i) + ndviNoise, 0.05, 0.92);

    // Mock stres: NDVI düşerse artar; yağış az + ET yüksekse artar
    let stress =
      (0.72 - ndvi) * 140 +
      clamp(6 - rain / 3, 0, 6) * 6 +
      clamp(et - 4.2, 0, 3) * 10;
    stress = clamp(Math.round(stress), 0, 100);

    pts.push({ date, ndvi: Number(ndvi.toFixed(3)), rain, et, stress });
  }
  return pts;
}

// Basit GeoJSON poligonlar (demo amaçlı dikdörtgen parseller)

const state = {
  parcels: [], // backend'den dolacak
  filters: {
    province: "all",
    stress: "all",
    source: "all",
    from: null,
    to: null,
  },
  selectedId: null,
  rainFactor: 1, // 1 = mevcut, <1 az yağış, >1 çok yağış
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
let parcelLayer;
const layerById = new Map();

// Charts
let chartNdvi;
let chartClimate;
let chartShap;

function getSnapshot(parcel, from, to) {
  const series = parcel.series;
  let filtered = series;
  if (from) filtered = filtered.filter((p) => p.date >= from);
  if (to) filtered = filtered.filter((p) => p.date <= to);
  const last = filtered.length ? filtered[filtered.length - 1] : series[series.length - 1];
  return last;
}

function displayStress(baseStress) {
  const f = state.rainFactor;
  // Yağış azalınca stres artsın, artınca azalsın
  const delta = (1 - f) * 35;
  return clamp(Math.round(baseStress + delta), 0, 100);
}

function filterParcels() {
  const { province, stress, source, from, to } = state.filters;
  return state.parcels.filter((p) => {
    if (province !== "all" && p.province !== province) return false;
    if (source !== "all" && p.source !== source) return false;
    const snap = getSnapshot(p, from, to);
    const b = stressBucket(displayStress(snap.stress));
    if (stress !== "all" && b !== stress) return false;
    return true;
  });
}

function styleForParcel(parcel) {
  const snap = getSnapshot(parcel, state.filters.from, state.filters.to);
  const bucket = stressBucket(displayStress(snap.stress));
  return {
    color: STRESS[bucket].color,
    weight: state.selectedId === parcel.id ? 3 : 2,
    fillColor: STRESS[bucket].color,
    fillOpacity: 0.22,
  };
}

function ensureMap() {
  if (map) return;
  map = L.map("leafletMap", { zoomControl: true }).setView([37.87, 32.48], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  parcelLayer = L.geoJSON([], {
    style: () => ({ color: "#16a34a", weight: 2, fillOpacity: 0.22 }),
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id;
      if (id) layerById.set(id, layer);
      layer.on("click", () => selectParcel(id));
    },
  }).addTo(map);
}

function setMapLoading(isLoading) {
  if (!elMapLoading) return;
  if (isLoading) {
    elMapLoading.classList.remove("hidden");
  } else {
    elMapLoading.classList.add("hidden");
  }
}

function rebuildLayers() {
  ensureMap();
  setMapLoading(true);
  layerById.clear();
  parcelLayer.clearLayers();

  const visible = filterParcels();
  const features = visible.map((p) => ({
    ...p.geom,
    properties: {
      id: p.id,
      name: p.name,
      province: p.province,
      district: p.district,
    },
  }));

  parcelLayer.addData(features);
  parcelLayer.eachLayer((layer) => {
    const id = layer.feature?.properties?.id;
    const parcel = state.parcels.find((x) => x.id === id);
    if (!parcel) return;
    layer.setStyle(styleForParcel(parcel));
    const snap = getSnapshot(parcel, state.filters.from, state.filters.to);
    layer.bindTooltip(
      `<strong>${parcel.name}</strong><br/>Stres: ${displayStress(snap.stress)}/100<br/>NDVI: ${snap.ndvi}`,
      { sticky: true }
    );
    layerById.set(id, layer);
  });

  if (visible.length) {
    const bounds = parcelLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
  }

  setTimeout(() => setMapLoading(false), 260);
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
      const snap = getSnapshot(p, state.filters.from, state.filters.to);
      const display = displayStress(snap.stress);
      const bucket = stressBucket(display);
      const sourceLabel =
        p.source === "ndvi_era5" ? "NDVI + ERA5" : p.source === "ndvi" ? "NDVI" : "Manuel";
      const updated = fmtDate(snap.date);
      return `
        <div class="map-table-row" data-id="${p.id}" role="button" tabindex="0">
          <span>${p.name}</span>
          <span><span class="dot-sm ${bucket}"></span> ${STRESS[bucket].label} (${display})</span>
          <span>${updated}</span>
          <span>${sourceLabel}</span>
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

function updateLayerStyles() {
  parcelLayer?.eachLayer((layer) => {
    const id = layer.feature?.properties?.id;
    const parcel = state.parcels.find((x) => x.id === id);
    if (!parcel) return;
    layer.setStyle(styleForParcel(parcel));
  });
}

function buildWhyText(parcel, snap) {
  const recent = parcel.series.slice(-14);
  const ndviStart = recent[0]?.ndvi ?? snap.ndvi;
  const ndviDelta = Number((snap.ndvi - ndviStart).toFixed(3));
  const rainSum = recent.reduce((s, x) => s + x.rain, 0);
  const etAvg = recent.reduce((s, x) => s + x.et, 0) / Math.max(1, recent.length);

  const ndviDrop = Math.max(0, ndviStart - snap.ndvi); // düşüş pozitif
  const ndviScore = clamp(ndviDrop / 0.3, 0, 1);
  const rainDef = Math.max(0, 40 - rainSum);
  const rainScore = clamp(rainDef / 40, 0, 1);
  const etExc = Math.max(0, etAvg - 4);
  const etScore = clamp(etExc / 4, 0, 1);

  return `
    <div style="margin-bottom:0.35rem;">
      <strong>Neden ${stressBucket(displayStress(snap.stress)) === "high" ? "yüksek" : "bu seviyede"} stres?</strong>
      Model, son 7–14 gün sinyallerini birleştirerek bu parseli riskli görüyor.
    </div>
    <div style="margin:0.2rem 0 0.1rem;font-size:0.78rem;color:#6b7280;">Başlıca faktörler:</div>
    <ul style="margin-left:1.1rem; font-size:0.8rem;">
      <li><strong>NDVI düşüşü</strong> (${ndviDelta}): 
        <span style="display:inline-block;width:90px;height:6px;border-radius:999px;background:rgba(22,163,74,0.12);overflow:hidden;vertical-align:middle;">
          <span style="display:block;height:100%;width:${Math.round(
            ndviScore * 100
          )}%;background:linear-gradient(to right,#22c55e,#16a34a);"></span>
        </span>
      </li>
      <li><strong>Yağış eksikliği</strong> (${rainSum.toFixed(1)} mm / 14g):
        <span style="display:inline-block;width:90px;height:6px;border-radius:999px;background:rgba(14,165,233,0.12);overflow:hidden;vertical-align:middle;">
          <span style="display:block;height:100%;width:${Math.round(
            rainScore * 100
          )}%;background:linear-gradient(to right,#0ea5e9,#0369a1);"></span>
        </span>
      </li>
      <li><strong>ET artışı</strong> (${etAvg.toFixed(1)}): 
        <span style="display:inline-block;width:90px;height:6px;border-radius:999px;background:rgba(15,118,110,0.12);overflow:hidden;vertical-align:middle;">
          <span style="display:block;height:100%;width:${Math.round(
            etScore * 100
          )}%;background:linear-gradient(to right,#0f766e,#0d9488);"></span>
        </span>
      </li>
    </ul>
    <div style="margin-top:0.35rem;">
      Son 14 gün: NDVI değişimi <strong>${ndviDelta}</strong>, toplam yağış <strong>${rainSum} mm</strong>,
      ortalama ET <strong>${etAvg.toFixed(1)}</strong>.
    </div>
  `;
}

function buildRecommendation(parcel, snap) {
  // Demo öneri: stres yükseldikçe mm artar
  const mm = clamp(Math.round(8 + snap.stress * 0.22), 8, 30);
  const window =
    snap.stress >= 70
      ? "24–48 saat içinde"
      : snap.stress >= 40
        ? "2–4 gün içinde"
        : "planlı sulama penceresinde";
  const note =
    parcel.source === "manual"
      ? "Manuel gözlem eklendiği için öneri belirsizliği daha yüksek olabilir."
      : "Öneri NDVI + iklim sinyallerine göre hesaplanan demo çıktıdır.";
  return `<strong>${window}</strong> yaklaşık <strong>${mm} mm</strong> sulama önerilir. <span style="opacity:.85">${note}</span>`;
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
          title: { display: true, text: "ET" },
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

function updateCharts(parcel) {
  ensureCharts();
  const series = parcel.series;
  const last28 = series.slice(-28);

  // NDVI
  chartNdvi.data.labels = last28.map((p) => fmtDate(p.date));
  chartNdvi.data.datasets = [
    {
      label: "NDVI",
      data: last28.map((p) => p.ndvi),
      borderColor: "#16a34a",
      backgroundColor: "rgba(22,163,74,0.12)",
      fill: true,
      tension: 0.35,
      pointRadius: 0,
    },
  ];
  chartNdvi.update();

  // Climate (last 14)
  const last14 = series.slice(-14);
  chartClimate.data.labels = last14.map((p) => fmtDate(p.date));
  chartClimate.data.datasets = [
    {
      type: "bar",
      label: "Yağış (mm)",
      data: last14.map((p) => p.rain),
      backgroundColor: "rgba(14,165,233,0.35)",
      borderColor: "rgba(14,165,233,0.9)",
      borderWidth: 1,
      yAxisID: "y",
    },
    {
      type: "line",
      label: "ET",
      data: last14.map((p) => p.et),
      borderColor: "#0f766e",
      backgroundColor: "rgba(15,118,110,0.12)",
      tension: 0.35,
      pointRadius: 0,
      yAxisID: "y1",
    },
  ];
  chartClimate.update();

  // Açıklayıcı bar grafiği: NDVI düşüşü, yağış eksikliği, ET artışı
  const ndviStart = last14[0]?.ndvi ?? last28[0]?.ndvi ?? series[0].ndvi;
  const ndviEnd = last14[last14.length - 1]?.ndvi ?? last28[last28.length - 1].ndvi;
  const ndviDrop = Math.max(0, ndviStart - ndviEnd);
  const rainSum = last14.reduce((s, x) => s + x.rain, 0);
  const etAvg = last14.reduce((s, x) => s + x.et, 0) / Math.max(1, last14.length);

  const ndviScore = clamp(ndviDrop / 0.3, 0, 1);
  const rainScore = clamp(Math.max(0, 40 - rainSum) / 40, 0, 1);
  const etScore = clamp(Math.max(0, etAvg - 4) / 4, 0, 1);

  chartShap.data.labels = ["NDVI düşüşü", "Yağış eksikliği", "ET artışı"];
  chartShap.data.datasets = [
    {
      label: "Bağıl etki (demo)",
      data: [ndviScore, rainScore, etScore],
      backgroundColor: "rgba(34,197,94,0.35)",
      borderColor: "rgba(34,197,94,0.9)",
      borderWidth: 1,
    },
  ];
  chartShap.update();
}

function selectParcel(id) {
  const parcel = state.parcels.find((p) => p.id === id);
  if (!parcel) return;
  state.selectedId = id;

  // UI
  const snap = getSnapshot(parcel, state.filters.from, state.filters.to);
  const adjustedStress = displayStress(snap.stress);
  const bucket = stressBucket(adjustedStress);

  elATitle.textContent = parcel.name;
  elASub.textContent = `${parcel.province} · Kaynak: ${
    parcel.source === "ndvi_era5" ? "NDVI + ERA5" : parcel.source === "ndvi" ? "NDVI" : "Manuel"
  } · Son güncelleme: ${fmtDate(snap.date)}`;

  elABadges.innerHTML = `
    <span class="pill ${bucket}">${STRESS[bucket].label} stres</span>
    <span class="pill">${parcel.id}</span>
  `;

  animateNumber(elKpiStress, `${adjustedStress}/100`);
  animateNumber(elKpiNdvi, `${snap.ndvi}`);
  animateNumber(elKpiRain, `${snap.rain} mm`);
  animateNumber(elKpiEt, `${snap.et}`);
  elWhy.innerHTML = buildWhyText(parcel, snap);
  elRec.innerHTML = buildRecommendation(parcel, snap);

  updateCharts(parcel);
  updateLayerStyles();

  const panel = document.querySelector(".analysis-panel");
  if (panel && !panel.classList.contains("is-visible")) {
    requestAnimationFrame(() => panel.classList.add("is-visible"));
  }

  // Map focus
  const layer = layerById.get(id);
  if (layer) {
    try {
      map.fitBounds(layer.getBounds().pad(0.4));
      layer.openTooltip();
    } catch {}
  }
}

function populateProvinceOptions() {
  const provinces = Array.from(new Set(state.parcels.map((p) => p.province))).sort();
  elProvince.innerHTML = `<option value="all">Tümü</option>` + provinces.map((x) => `<option value="${x}">${x}</option>`).join("");
}

function bindFilters() {
  // Chip filters
  document.querySelectorAll(".chip-filter[data-stress]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".chip-filter[data-stress]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filters.stress = btn.dataset.stress;
    });
  });

  elApply.addEventListener("click", () => {
    state.filters.province = elProvince.value;
    state.filters.source = elSource.value;
    state.filters.from = elFrom.value || null;
    state.filters.to = elTo.value || null;
    rebuildLayers();
    renderTable();
  });

  if (elRainSim && elRainSimLabel) {
    elRainSim.addEventListener("input", () => {
      const val = Number(elRainSim.value || "100");
      state.rainFactor = val / 100;
      elRainSimLabel.textContent = `%${val} yağış senaryosu (demo)`;
      rebuildLayers();
      renderTable();
      if (state.selectedId) selectParcel(state.selectedId);
    });
  }
}

function bindForm() {
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const inName = (fd.get("fullName") || "").toString().trim() || "Demo Kullanıcı";
    const inEmail = (fd.get("email") || "").toString().trim();
    const inIl = (fd.get("province") || "").toString().trim() || "Konya";
    const inIlce = (fd.get("district") || "").toString().trim() || "Merkez";
    void inEmail;

    const newId = `P-${Math.floor(rnd(1000, 9999))}`;
    const lat = rnd(37.2, 38.2);
    const lng = rnd(32.2, 33.2);
    const w = rnd(0.01, 0.03);
    const h = rnd(0.006, 0.02);

    const parcel = {
      id: newId,
      name: `${inIlce} / Parsel (Yeni)`,
      province: inIl,
      district: inIlce,
      source: "ndvi_era5",
      geom: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng, lat],
              [lng + w, lat],
              [lng + w, lat + h],
              [lng, lat + h],
              [lng, lat],
            ],
          ],
        },
      },
      series: generateSeries(rnd(0.56, 0.7), rnd(-0.004, -0.001), 0.02),
      shap: [
        { feature: "NDVI_anomali", value: rnd(0.15, 0.35) },
        { feature: "Yağış_7g", value: rnd(0.12, 0.28) },
        { feature: "ET_7g", value: rnd(0.1, 0.22) },
        { feature: "Sıcaklık_max", value: rnd(0.06, 0.14) },
        { feature: "Toprak_nem_proxy", value: rnd(0.04, 0.12) },
      ],
    };

    state.parcels.unshift(parcel);
    populateProvinceOptions();
    rebuildLayers();
    renderTable();
    selectParcel(parcel.id);

    // Formu temizle
    form.reset();
    // Basit kullanıcı geri bildirimi
    alert(`Parsel eklendi (demo): ${newId}`);
    void inName;
  });
}

function init() {
  populateProvinceOptions();
  bindFilters();
  bindForm();
  rebuildLayers();
  renderTable();

  // Varsayılan seçim
  const first = filterParcels()[0];
  if (first) selectParcel(first.id);
}

document.addEventListener("DOMContentLoaded", init);


