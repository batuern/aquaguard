import joblib
import numpy as np
import pandas as pd

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Optional, List, Dict, Any

app = FastAPI(title="AquaGuard AI Backend (XGBoost MVP)")

# Hackathon: rahat CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # prod'da kısıtla
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Paths ---
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

CSV_PATH = DATA_DIR / "parcels_timeseries.csv"         # frontend timeseries için
ML_PARQUET_PATH = DATA_DIR / "ml_ready_data.parquet"   # feature-ready dataset
MODEL_PATH = BASE_DIR / "model" / "aquaguard_model.pkl"

# --- Caches ---
_df_cache: Optional[pd.DataFrame] = None
_ml_df_cache: Optional[pd.DataFrame] = None
_model_cache = None

# Modelin beklediği feature set
FEATURES: List[str] = [
    "temperature_2m_max",
    "precipitation_sum",
    "et0_fao_evapotranspiration",
    "ndvi",
    "ndvi_lag_1",
    "rain_lag_1",
    "rain_sum_7d",
    "temp_mean_7d",
    "evap_sum_7d",
]


def clamp(x: float, lo: float, hi: float) -> float:
    """Basit sınırlandırma fonksiyonu."""
    return max(lo, min(hi, x))


def normalize_tr(text: str) -> str:
    """
    Türkçe karakterleri ASCII eşdeğerine indirger.
    Chatbot içinde anahtar kelime eşleştirmesini daha sağlam yapmamıza yardımcı olur.
    """
    mapping = str.maketrans("ığüşöçĞÜŞİÖÇ", "igusocGUSIOC")
    return (text or "").translate(mapping)

def load_model():
    global _model_cache
    if _model_cache is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model dosyası bulunamadı: {MODEL_PATH}")
        _model_cache = joblib.load(MODEL_PATH)
    return _model_cache

def load_ml_df() -> pd.DataFrame:
    global _ml_df_cache
    if _ml_df_cache is None:
        if not ML_PARQUET_PATH.exists():
            raise FileNotFoundError(f"ml_ready_data.parquet bulunamadı: {ML_PARQUET_PATH}")

        df = pd.read_parquet(ML_PARQUET_PATH)

        # basic validation
        required = {"parcel_id", "date"} | set(FEATURES)
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"ml_ready_data.parquet eksik kolonlar: {sorted(missing)}")

        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values(["parcel_id", "date"]).reset_index(drop=True)
        _ml_df_cache = df
    return _ml_df_cache

def load_df() -> pd.DataFrame:
    """CSV'yi oku, kolonları normalize et, cache'le."""
    global _df_cache
    if _df_cache is None:
        if not CSV_PATH.exists():
            raise FileNotFoundError(f"CSV bulunamadı: {CSV_PATH}")

        df = pd.read_csv(CSV_PATH)

        if "date" not in df.columns:
            raise ValueError("CSV içinde 'date' kolonu yok.")

        df["date"] = pd.to_datetime(df["date"])

        # Frontend sadeleştirme
        rename_map = {
            "precipitation_sum": "rain_mm",
            "temperature_2m_max": "temp_c",
        }
        df = df.rename(columns=rename_map)

        required = {"parcel_id", "ndvi", "rain_mm", "temp_c", "date"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"CSV eksik kolonlar: {missing}")

        df = df.sort_values(["parcel_id", "date"]).reset_index(drop=True)
        _df_cache = df

    return _df_cache

# --- API ---
@app.get("/health")
def health():
    ok = True
    details = {}

    # CSV check
    details["csv_exists"] = CSV_PATH.exists()
    details["parquet_exists"] = ML_PARQUET_PATH.exists()
    details["model_exists"] = MODEL_PATH.exists()

    # try load minimally
    try:
        if details["model_exists"]:
            _ = load_model()
            details["model_loaded"] = True
        else:
            details["model_loaded"] = False
            ok = False
    except Exception as e:
        details["model_loaded"] = False
        details["model_error"] = str(e)
        ok = False

    return {"status": "ok" if ok else "degraded", "details": details}

@app.get("/parcels")
def get_parcels():
    df = load_df()
    parcel_ids = sorted(df["parcel_id"].unique().tolist())
    return [{"parcel_id": pid, "name": pid} for pid in parcel_ids]

@app.get("/timeseries")
def get_timeseries(parcel_id: str):
    df = load_df()
    sub = df[df["parcel_id"] == parcel_id].copy()

    if sub.empty:
        return {"parcel_id": parcel_id, "ndvi": [], "meteo": []}

    ndvi_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in zip(sub["date"], sub["ndvi"])
    ]

    meteo_series = [
        {"date": d.strftime("%Y-%m-%d"), "rain_mm": float(r), "temp_c": float(t)}
        for d, r, t in zip(sub["date"], sub["rain_mm"], sub["temp_c"])
    ]

    return {"parcel_id": parcel_id, "ndvi": ndvi_series, "meteo": meteo_series}

@app.post("/predict")
def predict(payload: Dict[str, Any]):
    """
    XGBoost/Sklearn model ile NDVI_7d tahmin eder,
    sonra risk skoruna çevirir.
    """
    parcel_id = payload.get("parcel_id")
    if not parcel_id:
        raise HTTPException(status_code=400, detail="parcel_id required")

    # Default: “sistem çalışıyor ama ML yoksa” gibi durumlar için açıklayıcı fallback
    try:
        df = load_ml_df()
        sub = df[df["parcel_id"] == parcel_id]

        if sub.empty:
            return {
                "mode": "fallback_no_parcel",
                "parcel_id": parcel_id,
                "ndvi_7d_pred": None,
                "risk_7d": 50.0,
                "risk_14d": 58.0,
                "top_factors": ["no_ml_data_for_parcel"],
            }

        row = sub.iloc[-1]

        # feature order fix
        x = np.array([[float(row[f]) for f in FEATURES]], dtype=float)

        model = load_model()
        pred = model.predict(x)

        # sklearn/xgb predict bazen array döner
        ndvi_7d_pred = float(pred[0])

        # NDVI -> risk (0-100)
        risk_7d = clamp((1.0 - ndvi_7d_pred) * 100.0, 0.0, 100.0)

        # Basit 14g heuristiği (istersen gerçek 14g modeli de eğitirsin)
        risk_14d = clamp(risk_7d + 8.0, 0.0, 100.0)

        return {
            "mode": "ml",
            "parcel_id": parcel_id,
            "ndvi_7d_pred": round(ndvi_7d_pred, 4),
            "risk_7d": round(risk_7d, 1),
            "risk_14d": round(risk_14d, 1),
            "top_factors": ["rain_sum_7d", "temp_mean_7d", "evap_sum_7d"],
        }

    except Exception as e:
        # Demo asla çökmesin ama sebebi bilinsin
        return {
            "mode": "fallback_error",
            "parcel_id": parcel_id,
            "ndvi_7d_pred": None,
            "risk_7d": 78.0,
            "risk_14d": 86.0,
            "top_factors": ["model_fallback"],
            "error": str(e),
        }

@app.post("/recommend")
def recommend(payload: Dict[str, Any]):
    """
    Basit kural tabanlı sulama önerisi.

    Girdi:
      - parcel_id: str
      - risk_7d: 0–100 arası stres skoru (opsiyonel, yoksa predict ile hesaplanır)
      - rain_factor: frontend yağış senaryosu slider'ı (0.6–1.2 arası beklenir).

    Yorum:
      - rain_factor < 1  -> yağış normalden düşük senaryo -> daha fazla sulama
      - rain_factor > 1  -> yağış normalden yüksek senaryo -> daha az sulama
    """
    parcel_id = payload.get("parcel_id", "UNKNOWN")

    # Kullanıcı slider'dan gönderiyor (ör: 0.6–1.2). Güvenli aralığa sıkıştır.
    try:
        rain_factor = float(payload.get("rain_factor", 1.0))
    except (TypeError, ValueError):
        rain_factor = 1.0
    rain_factor = clamp(rain_factor, 0.5, 1.5)

    # If caller didn't provide a risk, compute it via the predict endpoint logic
    provided_risk = payload.get("risk_7d", None)
    if provided_risk is None:
        pred = predict({"parcel_id": parcel_id})
        try:
            risk_7d = float(pred.get("risk_7d") or 0)
        except Exception:
            risk_7d = 0.0
    else:
        risk_7d = float(provided_risk or 0)

    # Temel öneri miktarları (yağıştan bağımsız çıplak değerler)
    if risk_7d < 40:
        base_amount = 0
        window = "izlemede kal"
        base_rationale = "NDVI stabil, kısa vadede ciddi su stresi beklenmiyor."
    elif risk_7d < 60:
        base_amount = 10
        window = "5–7 gün içinde"
        base_rationale = "Orta seviye stres sinyali: yağış azalmaya başladı ve sıcaklık yükseliyor."
    else:
        base_amount = 18
        window = "3 gün içinde"
        base_rationale = "Yüksek su stresi riski: düşük yağış, yüksek sıcaklık ve NDVI düşüş trendi."

    # Yağış senaryosuna göre dinamik düzeltme:
    # - 0.6x yağış senaryosunda miktarı ~%30 artır
    # - 1.2x yağış senaryosunda miktarı ~%30 azalt
    # lineer ölçek: factor=1.0 -> 1.0x, 0.6 -> ~1.3x, 1.2 -> ~0.7x
    adjust = clamp(1.3 - 0.3 * (rain_factor - 1.0) * (10 / 3), 0.7, 1.3)
    amount = int(round(base_amount * adjust))

    rationale = (
        f"{base_rationale} "
        f"Yağış senaryosu ({rain_factor:.2f}x) dikkate alınarak sulama miktarı ayarlandı."
    )

    return {
        "parcel_id": parcel_id,
        "window": window,
        "amount_mm": amount,
        "rationale": rationale,
        "risk_7d": risk_7d,
        "rain_factor": rain_factor,
    }


@app.post("/chat")
def chat(payload: Dict[str, Any]):
    """
    Basit kural tabanlı chatbot.
    Beklenen payload: { parcel_id: str, question: str, from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }

    Sadece `parcel_id` verilirse cevap verir; aksi halde hata döner.
    Desteklenen konular (anahtar kelimeye göre eşleştirme, çiftçi dili):
      1) genel durum / durum / nasıl / ne alemde
      2) son yağış / yağış / yağmur
      3) öneri / sulama / ne kadar / ne zaman su
      4) ndvi trend / trend / yeşerme / sararma
    """
    parcel_id = payload.get("parcel_id")
    question_raw = payload.get("question") or ""
    question = question_raw.lower()
    norm_q = normalize_tr(question)
    if not parcel_id:
        # Parsel seçimi zorunlu: frontend de engelliyor ama doğrudan API çağrılarını da koru
        raise HTTPException(status_code=400, detail="parcel_id is required for chat queries")

    # Try to get timeseries from /timeseries equivalent
    try:
        df = load_df()
        sub = df[df["parcel_id"] == parcel_id].sort_values("date")
    except Exception:
        sub = pd.DataFrame()

    # Helper summaries
    def last_n_days(n):
        if sub.empty:
            return None
        cutoff = pd.to_datetime(sub["date"]).max() - pd.Timedelta(days=n)
        return sub[pd.to_datetime(sub["date"]) >= cutoff]

    def last_record():
        if sub.empty:
            return None
        r = sub.sort_values("date").iloc[-1]
        return r

    # Routing by keyword (Türkçe karakter normalizasyonlu, daha samimi çiftçi dili)
    # 1) Genel durum: "genel", "durum", "nasıl", "ne alemde" vb.
    if any(k in norm_q for k in ["genel", "durum", "nasil", "ne alemde", "ne durumda"]):
        try:
            pred = predict({"parcel_id": parcel_id})
            risk = float(pred.get("risk_7d") or 0)
            mode = pred.get("mode") or "ml"
            kova = "düşük" if risk < 40 else "orta" if risk < 70 else "yüksek"
            return {
                "answer": (
                    f"Bak şimdi, {parcel_id} parselinde önümüzdeki 1 hafta için su stresi {kova} seviyede "
                    f"(skor ~{risk:.0f}/100, mod: {mode}). "
                    "Yani tarlayı tamamen rahat bırakma ama panik de yapma; gözü üzerinde olsun, havayı ve bitkiyi birlikte okuyalım."
                )
            }
        except Exception:
            lr = last_record()
            if lr is None:
                return {
                        "answer": (
                            "Bu parsel için elimde geçmiş veri pek yok gibi. "
                            "Yeni uydu ve istasyon verileri geldikçe sana daha net, içime sinen bir yorum yaparım."
                        )
                }
            ndvi = float(lr.get("ndvi", 0))
            return {
                "answer": (
                    f"Son uyduya göre parselin yeşilliği (NDVI) {ndvi:.3f} civarında gözüküyor. "
                    "Kısaca söylemek gerekirse, bitki fena durumda değil ama ara ara tarlaya çıkıp gözle kontrol etmek her zaman en sağlıklısı."
                )
            }

    # 2) Son yağış: "yagis", "yagmur", "yağış"
    if any(k in norm_q for k in ["yagis", "yagmur", "yasur"]):  # 'yağış' normalizasyonu da 'yagis'
        lr = last_record()
        if lr is None:
            return {
                "answer": (
                    "Bu parsel için son yağış kaydı bende görünmüyor. "
                    "Yakındaki istasyon ya da kendi yağmur ölçerin varsa ona da bir göz atmanı tavsiye ederim."
                )
            }
        rain = float(lr.get("rain_mm") if "rain_mm" in lr.index else lr.get("rain", 0))
        date = pd.to_datetime(lr.get("date")).date().isoformat()
        if rain == 0:
            yagis_cumle = "o gün neredeyse hiç yağmur almamış."
        elif rain < 5:
            yagis_cumle = "şöyle hafif bir çiseleme geçmiş."
        elif rain < 15:
            yagis_cumle = "orta karar, idare eder bir yağmur görmüş."
        else:
            yagis_cumle = "gayet güzel, yüz güldüren bir yağmur yemiş."
        return {
                "answer": (
                    f"En son {date} tarihinde ölçüm var; o gün toplam yağış yaklaşık {rain:.1f} mm. "
                    f"Kısaca söyleyeyim, parsel {yagis_cumle}"
                )
        }

    # 3) Sulama / ne kadar su: "oneri", "sulama", "ne kadar", "ne zaman su"
    if any(k in norm_q for k in ["oneri", "sulama", "ne kadar", "ne zaman su", "kac mm"]):
        try:
            pred = predict({"parcel_id": parcel_id})
            rec = recommend({"parcel_id": parcel_id, "risk_7d": pred.get("risk_7d")})
            window = rec.get("window")
            mm = rec.get("amount_mm")
            return {
                "answer": (
                    f"Bu parsel için akıllı model şunu diyor: {window} "
                    f"içinde yaklaşık {mm} mm civarı su vermen iyi olur. "
                    "Yani toprağı bataklığa çevirmeden, kökü rahatlatacak kadar bir sulama düşün; gözün de bitkinin üzerinde olsun."
                )
            }
        except Exception:
            return {
                "answer": (
                    "Şu anda modelden net bir rakam çıkaramadım ama şöyle söyleyeyim: "
                    "eğer yapraklar sarkmaya, renk açılmaya başladıysa bitki senden haber bekliyordur; "
                    "hafif bir can suyu vermek iyi gelebilir."
                )
            }

    # 4) NDVI / yeşerme / sararma trendi
    if any(k in norm_q for k in ["ndvi", "trend", "yeserme", "sararma"]):
        recent = last_n_days(14)
        if recent is None or recent.empty:
            return {
                "answer": (
                    "Son 2 haftaya ait uydu verisi biraz zayıf kalmış. "
                    "Yeni görüntüler geldikçe ‘yeşeriyor mu, sararıyor mu’ sorusuna çok daha gönül rahatlığıyla cevap veririm."
                )
            }
        recent = recent.sort_values("date")
        start = float(recent.iloc[0]["ndvi"]) if "ndvi" in recent.columns else 0
        end = float(recent.iloc[-1]["ndvi"]) if "ndvi" in recent.columns else 0
        delta = end - start
        if delta > 0.02:
            yorum = "bitki son günlerde kendine geliyor, yeşil oranı artıyor gibi duruyor."
        elif delta < -0.02:
            yorum = "yapraklarda hafif bir geri çekilme ve sararma var, bitki biraz strese girmiş olabilir."
        else:
            yorum = "bitki çizgisini koruyor; ne çok şahlanmış, ne de kendini tamamen bırakmış."
        return {
                "answer": (
                    f"Son 14 günde uyduya göre yeşilliğin (NDVI) değişimi yaklaşık {delta:.3f}. "
                    f"Kısaca çiftçi diliyle söylersek: {yorum}"
                )
        }

    # default: anlaşılamayan soru
    return {
        "answer": (
            "Bu soruyu tam yakalayamadım dostum. Haritadaki 4 hazır butondan birini tıklayıp "
            "‘genel durum’, ‘son yağış’, ‘sulama önerisi’ veya ‘NDVI trendi’ diye sorarsan sana daha net yardımcı olurum."
        )
    }
