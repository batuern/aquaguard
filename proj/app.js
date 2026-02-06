const API_BASE = "http://127.0.0.1:8000";
const API = {
  health: `${API_BASE}/health`, // ✅ eklendi
  parcels: `${API_BASE}/parcels`,
  timeseries: (id) => `${API_BASE}/timeseries?parcel_id=${encodeURIComponent(id)}`,
  predict: `${API_BASE}/predict`,
  recommend: `${API_BASE}/recommend`,
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

/** MOCK generator (fallback için) */
function generateSeries(baseNdvi, trend, volatility = 0.02) {
  const pts = [];
  for (let i = 27; i >= 0; i--) {
    const date = daysAgo(i);
    const rain = clamp(Math.round(rnd(0, 18)), 0, 30);
    const et = clamp(Number(rnd(2.5, 6.5).toFixed(1)), 0, 10);
    const ndviNoise = rnd(-volatility, volatility);
    const ndvi = clamp(baseNdvi + trend * (27 - i) + ndviNoise, 0.05, 0.92);

    let stress =
      (0.72 - ndvi) * 140 +
      clamp(6 - rain / 3, 0, 6) * 6 +
      clamp(et - 4.2, 0, 3) * 10;
    stress = clamp(Math.round(stress), 0, 100);

    pts.push({ date, ndvi: Number(ndvi.toFixed(3)), rain, et, stress });
  }
  return pts;
}

/** Fallback MOCK parcels (backend olmazsa) */
const MOCK_PARCELS = [
  {
    id: "P-4201",
    name: "Karapınar / Parsel 12",
    province: "Konya",
    district: "Karapınar",
    source: "ndvi_era5",
    geom: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [33.007, 37.662],
            [33.033, 37.662],
            [33.033, 37.676],
            [33.007, 37.676],
            [33.007, 37.662],
          ],
        ],
      },
    },
    series: generateSeries(0.58, -0.0042, 0.022),
    shap: [
      { feature: "NDVI_anomali", value: 0.38 },
      { feature: "Yağış_7g", value: 0.22 },
      { feature: "ET_7g", value: 0.18 },
      { feature: "Sıcaklık_max", value: 0.11 },
      { feature: "Toprak_nem_proxy", value: 0.09 },
    ],
  },
  {
    id: "P-5107",
    name: "Bor / Parsel 7",
    province: "Niğde",
    district: "Bor",
    source: "ndvi",
    geom: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [34.563, 37.897],
            [34.585, 37.897],
            [34.585, 37.909],
            [34.563, 37.909],
            [34.563, 37.897],
          ],
        ],
      },
    },
    series: generateSeries(0.64, -0.0022, 0.018),
    shap: [
      { feature: "NDVI_trend", value: 0.24 },
      { feature: "Yağış_14g", value: 0.19 },
      { feature: "ET_14g", value: 0.16 },
      { feature: "Sıcaklık_max", value: 0.1 },
      { feature: "Rüzgar", value: 0.07 },
    ],
  },
  {
    id: "P-3803",
    name: "İncesu / Parsel 3",
    province: "Kayseri",
    district: "İncesu",
    source: "manual",
    geom: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [35.189, 38.643],
            [35.212, 38.643],
            [35.212, 38.655],
            [35.189, 38.655],
            [35.189, 38.643],
          ],
        ],
      },
    },
    series: generateSeries(0.71, -0.0008, 0.014),
    shap: [
      { feature: "NDVI_seviye", value: 0.12 },
      { feature: "Yağış_7g", value: 0.08 },
      { feature: "ET_7g", value: 0.07 },
      { feature: "Sıcaklık_max", value: 0.05 },
      { feature: "Manuel_gözlem", value: 0.04 },
    ],
  },
  {
    id: "P-0609",
    name: "Polatlı / Parsel 9",
    province: "Ankara",
    district: "Polatlı",
    source: "ndvi_era5",
    geom: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [32.125, 39.567],
            [32.149, 39.567],
            [32.149, 39.58],
            [32.125, 39.58],
            [32.125, 39.567],
          ],
        ],
      },
    },
    series: generateSeries(0.62, -0.0016, 0.02),
    shap: [
      { feature: "Yağış_7g", value: 0.21 },
      { feature: "NDVI_anomali", value: 0.2 },
      { feature: "ET_7g", value: 0.15 },
      { feature: "Sıcaklık_max", value: 0.1 },
      { feature: "Toprak_nem_proxy", value: 0.08 },
    ],
  },
];

const state = {
  parcels: structuredClone(MOCK_PARCELS),
  filters: {
    province: "all",
    stress: "all",
    source: "all",
    from: null,
    to: null,
  },
  selectedId: null,
  rainFactor: 1,
  backendOk: false,
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
  const series = parcel.series || [];
  let filtered = series;
  if (from) filtered = filtered.filter((p) => p.date >= from);
  if (to) filtered = filtered.filter((p) => p.date <= to);
  const last = filtered.length ? filtered[filtered.length - 1] : series[series.length - 1];
  return last;
}

function displayStress(baseStress) {
  const f = state.rainFactor;
  const delta = (1 - f) * 35;
  return clamp(Math.round(baseStress + delta), 0, 100);
}

function filterParcels() {
  const { province, stress, source, from, to } = state.filters;
  return state.parcels.filter((p) => {
    if (province !== "all" && p.province !== province) return false;
    if (source !== "all" && p.source !== source) return false;
    const snap = getSnapshot(p, from, to);
    if (!snap) return false;
    const b = stressBucket(displayStress(snap.stress ?? 0));
    if (stress !== "all" && b !== stress) return false;
    return true;
  });
}

function styleForParcel(parcel) {
  const snap = getSnapshot(parcel, state.filters.from, state.filters.to);
  const bucket = stressBucket(displayStress(snap?.stress ?? 0));
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
    attribution: "&copy; OpenStreetMap",
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
  if (isLoading) elMapLoading.classList.remove("hidden");
  else elMapLoading.classList.add("hidden");
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
    const stressVal = displayStress(snap?.stress ?? 0);
    layer.bindTooltip(
      `<strong>${parcel.name}</strong><br/>Stres: ${stressVal}/100<br/>NDVI: ${snap?.ndvi ?? "—"}`,
      { sticky: true }
    );
    layerById.set(id, layer);
  });

  if (visible.length) {
    const bounds = parcelLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
  }

  setTimeout(() => setMapLoading(false), 220);
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
      const display = displayStress(snap?.stress ?? 0);
      const bucket = stressBucket(display);
      const updated = snap?.date ? fmtDate(snap.date) : "—";
      const sourceLabel =
        p.source === "ndvi_era5" ? "NDVI + ERA5" : p.source === "ndvi" ? "NDVI" : "Manuel";
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
          title: { display: true, text: "ET (proxy)" },
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
      scales: { x: { suggestedMin: 0, suggestedMax: 1 } },
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

/** Backend timeseries -> frontend series format */
function mapBackendSeries(timeseries) {
  // backend:
  // { ndvi:[{date,value}], meteo:[{date,rain_mm,temp_c}] }
  const ndviMap = new Map((timeseries.ndvi || []).map((p) => [p.date, p.value]));
  const meteo = timeseries.meteo || [];

  // ET yok; temp'ten proxy üret (0-10 bandına çek)
  function etProxy(tempC) {
    // basit demo: 0..40C -> 2..7
    return clamp(2 + (Number(tempC) || 0) * 0.12, 0, 10);
  }

  const series = meteo.map((m) => {
    const ndvi = ndviMap.get(m.date);
    const rain = Number(m.rain_mm ?? 0);
    const temp = Number(m.temp_c ?? 0);
    return {
      date: m.date,
      ndvi: Number.isFinite(ndvi) ? Number(ndvi.toFixed(3)) : 0,
      rain,
      et: Number(etProxy(temp).toFixed(1)),
      // stress: backendten direkt gelmiyor → predict'ten gelecek risk_7d panelde gösterilecek
      // harita renklendirme için geçici proxy:
      stress: clamp(Math.round((0.72 - (ndvi ?? 0.5)) * 140 + clamp(6 - rain / 3, 0, 6) * 6), 0, 100),
    };
  });

  // seri boşsa fallback
  if (!series.length) return generateSeries(0.62, -0.0016, 0.02);

  return series;
}

function updateCharts(parcel) {
  ensureCharts();
  const series = parcel.series || [];
  if (!series.length) return;

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
      label: "ET (proxy)",
      data: last14.map((p) => p.et),
      borderColor: "#0f766e",
      backgroundColor: "rgba(15,118,110,0.12)",
      tension: 0.35,
      pointRadius: 0,
      yAxisID: "y1",
    },
  ];
  chartClimate.update();

  // Açıklayıcı bar grafiği (demo)
  const ndviStart = last14[0]?.ndvi ?? last28[0]?.ndvi ?? series[0].ndvi;
  const ndviEnd = last14[last14.length - 1]?.ndvi ?? last28[last28.length - 1].ndvi;
  const ndviDrop = Math.max(0, ndviStart - ndviEnd);
  const rainSum = last14.reduce((s, x) => s + (x.rain ?? 0), 0);
  const etAvg = last14.reduce((s, x) => s + (x.et ?? 0), 0) / Math.max(1, last14.length);

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

/** Backend ile predict + recommend */
async function enrichWithMl(parcel) {
  // parcel.id (bizim internal id) backend parcel_id ile aynı değilse uyarlaman gerekir.
  // Backend /parcels şimdilik name=parcel_id dönüyor.
  // Bu entegrasyonda parcel.id = backend parcel_id varsayıyoruz.
  const parcelId = parcel.id;

  const pred = await apiPost(API.predict, { parcel_id: parcelId });
  const risk7 = Number(pred.risk_7d ?? 0);
  const ndviPred = Number(pred.ndvi_7d_pred ?? NaN);

  // Stress KPI: gerçek model risk_7d
  animateNumber(elKpiStress, `${Math.round(risk7)}/100`);

  // NDVI KPI: istersen mevcut son NDVI, istersen ndvi_7d_pred
  if (Number.isFinite(ndviPred)) {
    // burada tahmini göstermek istersen:
    // animateNumber(elKpiNdvi, `${ndviPred}`);
    // ben mevcut son NDVI'yı bırakıyorum (snap)
  }

  // Yağış senaryosu slider'ını backend'e de gönderiyoruz ki öneri gerçekten değişsin
  const rec = await apiPost(API.recommend, {
    parcel_id: parcelId,
    risk_7d: risk7,
    rain_factor: state.rainFactor || 1,
  });
  elRec.innerHTML = `<strong>${rec.window}</strong> yaklaşık <strong>${rec.amount_mm} mm</strong> sulama önerilir. <span style="opacity:.85">${rec.rationale}</span>`;

  // Why text: pred içeriğine göre daha gerçekçi yapmak istersen burada geliştirebiliriz
}

function buildWhyText(parcel, snap) {
  // Güvenli fallback: parcel/snap yoksa patlamasın
  if (!parcel || !snap) return "Analiz verisi yok.";

  // Son 14 gün üzerinden basit açıklama üret (demo)
  const recent = (parcel.series || []).slice(-14);
  const ndviStart = recent[0]?.ndvi ?? snap.ndvi ?? 0;
  const ndviEnd = snap.ndvi ?? ndviStart;
  const ndviDelta = Number((ndviEnd - ndviStart).toFixed(3));

  const rainSum = recent.reduce((s, x) => s + (Number(x.rain) || 0), 0);
  const etAvg =
    recent.reduce((s, x) => s + (Number(x.et) || 0), 0) / Math.max(1, recent.length);

  return `
    <div style="margin-bottom:0.35rem;">
      <strong>Neden bu stres?</strong>
      Model, son 7–14 gün sinyallerini birleştirerek bu parseli değerlendiriyor.
    </div>
    <ul style="margin-left:1.1rem; font-size:0.85rem;">
      <li><strong>NDVI değişimi:</strong> ${ndviDelta}</li>
      <li><strong>Toplam yağış (14g):</strong> ${rainSum.toFixed(1)} mm</li>
      <li><strong>Ortalama ET (14g):</strong> ${etAvg.toFixed(1)}</li>
    </ul>
  `;
}

// ✅ EKLENDİ: Backend yokken kullanılan öneri fonksiyonu (selectParcel içinde çağrılıyordu)
function buildRecommendation(parcel, snap) {
  if (!parcel || !snap) return "Öneri üretilemedi.";

  const recent = (parcel.series || []).slice(-7);
  const rainSum = recent.reduce((s, x) => s + (Number(x.rain) || 0), 0);
  const ndvi = Number(snap.ndvi ?? 0);

  // Basit demo kural: NDVI düşükse daha fazla su; yağış geldiyse azalt
  let amount = 0;
  if (ndvi < 0.45) amount = 25;
  else if (ndvi < 0.6) amount = 15;
  else amount = 8;

  // Son 7 gün yağışını ve yağış senaryosu slider'ını dikkate al:
  // - Gerçek yağış arttıkça sulama ihtiyacı azalsın
  // - Slider (rainFactor) < 1 ise "daha az yağış" senaryosu → daha fazla sulama
  // - Slider (rainFactor) > 1 ise "daha çok yağış" senaryosu → daha az sulama
  const adjustedBase = Math.max(0, amount - rainSum * 0.4);
  const rf = state.rainFactor || 1;
  const scenarioScale = Math.max(0.7, Math.min(1.3, 1.3 - (rf - 1) * 0.6));
  const finalAmount = Math.max(0, Math.round(adjustedBase * scenarioScale));

  return `<strong>Öneri (demo):</strong> Mevcut yağış verisi ve senaryo (%${Math.round(
    rf * 100,
  )}) dikkate alınarak, önümüzdeki 48 saatte yaklaşık <strong>${finalAmount} mm</strong> sulama planla.`;
}

/** Parcel seçimi */
async function selectParcel(id) {
  const parcel = state.parcels.find((p) => p.id === id);
  if (!parcel) return;
  state.selectedId = id;

  const snap = getSnapshot(parcel, state.filters.from, state.filters.to);
  const adjustedStress = displayStress(snap?.stress ?? 0);
  const bucket = stressBucket(adjustedStress);

  elATitle.textContent = parcel.name;
  elASub.textContent = `${parcel.province} · Kaynak: ${
    parcel.source === "ndvi_era5" ? "NDVI + ERA5" : parcel.source === "ndvi" ? "NDVI" : "Manuel"
  } · Son güncelleme: ${snap?.date ? fmtDate(snap.date) : "—"}`;

  elABadges.innerHTML = `
    <span class="pill ${bucket}">${STRESS[bucket].label} stres</span>
    <span class="pill">${parcel.id}</span>
  `;

  // NDVI / Rain / ET KPI: seriden
  animateNumber(elKpiNdvi, `${snap?.ndvi ?? 0}`);
  animateNumber(elKpiRain, `${snap?.rain ?? 0} mm`);
  animateNumber(elKpiEt, `${snap?.et ?? 0}`);

  // Panel: önce demo metin
  elWhy.innerHTML = `
    <div style="margin-bottom:0.35rem;"><strong>Model analizi</strong></div>
    <div style="font-size:.82rem;color:#6b7280;">
      Backend bağlıysa XGBoost tahmininden gelen risk skoru ve öneri gösterilir.
    </div>
  `;
  elRec.innerHTML = `Yükleniyor...`;

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

  // ML enrich (backend varsa)
  if (state.backendOk) {
    try {
      await enrichWithMl(parcel);
    } catch (e) {
      console.error(e);
      elRec.innerHTML = `<span style="color:#b91c1c;">Model çağrısı başarısız: ${String(e.message || e)}</span>`;
    }
  } else {
    // backend yoksa demo stres göster
    animateNumber(elKpiStress, `${Math.round(adjustedStress)}/100`);
    elWhy.innerHTML = buildWhyText(parcel, snap);
    elRec.innerHTML = buildRecommendation(parcel, snap);
  }

  // Enable chat buttons (parcel selected)
  document.querySelectorAll('.chat-btn').forEach((b) => {
    b.disabled = false;
  });
  const chatResp = document.getElementById('chatResponseFloat');
  if (chatResp) chatResp.textContent = 'Soru seçin: örn. "Parselin genel durumu".';
}

/** Province options */
function populateProvinceOptions() {
  const provinces = Array.from(new Set(state.parcels.map((p) => p.province))).sort();
  elProvince.innerHTML =
    `<option value="all">Tümü</option>` +
    provinces.map((x) => `<option value="${x}">${x}</option>`).join("");
}

function bindFilters() {
  document.querySelectorAll(".chip-filter[data-stress]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip-filter[data-stress]").forEach((b) => b.classList.remove("active"));
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

  // Tampon quick buttons
  document.querySelectorAll('.chip-tampon').forEach((b) => {
    b.addEventListener('click', () => {
      const prov = b.dataset.province;
      elProvince.value = prov;
      state.filters.province = prov;
      rebuildLayers();
      renderTable();
    });
  });
}

function bindForm() {
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    // Demo: yeni parsel ekleme (backend’e yazmıyoruz)
    const newId = `P-${Math.floor(rnd(1000, 9999))}`;
    const lat = rnd(37.2, 38.2);
    const lng = rnd(32.2, 33.2);
    const w = rnd(0.01, 0.03);
    const h = rnd(0.006, 0.02);

    const parcel = {
      id: newId,
      name: `Yeni Parsel (${newId})`,
      province: "Konya",
      district: "Merkez",
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
      shap: [],
    };

    state.parcels.unshift(parcel);
    populateProvinceOptions();
    rebuildLayers();
    renderTable();
    selectParcel(parcel.id);

    form.reset();
    alert(`Parsel eklendi (demo): ${newId}`);
  });
}

function bindChat() {
  const chatBtns = document.querySelectorAll('.chat-btn');
  const chatResp = document.getElementById('chatResponseFloat');
  chatBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const q = btn.dataset.q;
      if (!state.selectedId) {
        chatResp.textContent = 'Parsel seçmeden cevap verilemez.';
        return;
      }
      chatResp.textContent = 'Yanıt aranıyor...';
      try {
        const r = await apiPost(`${API_BASE}/chat`, { parcel_id: state.selectedId, question: q });
        chatResp.textContent = r.answer || 'Cevap alınamadı.';
      } catch (e) {
        console.error(e);
        chatResp.textContent = `Hata: ${e?.message || e}`;
      }
    });
  });
}

/** Backend’ten gerçek parselleri ve serileri yükle */
async function loadFromBackend() {
  // health ping
  await apiGet(API.health);

  // parcels
  const parcels = await apiGet(API.parcels);
  // parcels: [{parcel_id, name}]
  // Haritada çizmek için polygon yok -> demo polygon üretiyoruz (merkez Türkiye etrafı)
  function randomPoly() {
    const lat = rnd(36.5, 39.3);
    const lng = rnd(30.5, 35.5);
    const w = rnd(0.01, 0.03);
    const h = rnd(0.006, 0.02);
    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[lng, lat],[lng+w, lat],[lng+w, lat+h],[lng, lat+h],[lng, lat]]],
      },
    };
  }

  const enriched = [];
  for (const p of parcels) {
    const pid = p.parcel_id;
    const ts = await apiGet(API.timeseries(pid));
    const series = mapBackendSeries(ts);

    // province/district backend'te yok -> demo
    enriched.push({
      id: pid,
      name: p.name || pid,
      province: "—",
      district: "—",
      source: "ndvi_era5",
      geom: randomPoly(),
      series,
      shap: [],
    });
  }

  state.parcels = enriched;
  state.backendOk = true;
}

/** init */
async function init() {
  try {
    // Backend’i dene, yoksa mock ile devam et
    try {
      await loadFromBackend();
      console.log("Backend connected ✅");
    } catch (e) {
      console.warn("Backend not available, using MOCK ❗", e);
      state.backendOk = false;
      state.parcels = structuredClone(MOCK_PARCELS);
    }

    populateProvinceOptions();
    bindFilters();
    bindForm();
    bindChat();
    rebuildLayers();
    renderTable();

    const first = filterParcels()[0];
    if (first) await selectParcel(first.id);
  } catch (e) {
    console.error(e);
    alert(`Başlatma hatası: ${e?.message || e}`);
  }
}

document.addEventListener("DOMContentLoaded", () => void init());
