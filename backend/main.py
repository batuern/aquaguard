import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import pandas as pd

app = FastAPI(title="AquaGuard AI Backend (MVP)")

# Frontend rahatça çağırabilsin (hackathon için)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "data"
CSV_PATH = DATA_DIR / "parcels_timeseries.csv"

ML_PARQUET_PATH = DATA_DIR / "ml_ready_data.parquet"
MODEL_PATH = Path(__file__).parent / "model" / "aquaguard_model.pkl"

_model_cache = None
_ml_df_cache = None

FEATURES = [
    'temperature_2m_max', 'precipitation_sum', 'et0_fao_evapotranspiration',
    'ndvi', 'ndvi_lag_1', 'rain_lag_1', 'rain_sum_7d', 'temp_mean_7d', 'evap_sum_7d'
]

def load_model():
    global _model_cache
    if _model_cache is None:
        _model_cache = joblib.load(MODEL_PATH)
    return _model_cache

def load_ml_df():
    global _ml_df_cache
    if _ml_df_cache is None:
        if not ML_PARQUET_PATH.exists():
            raise FileNotFoundError(f"ml_ready_data.parquet bulunamadı: {ML_PARQUET_PATH}")
        df = pd.read_parquet(ML_PARQUET_PATH)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values(["parcel_id", "date"]).reset_index(drop=True)
        _ml_df_cache = df
    return _ml_df_cache


_df_cache = None  # CSV'yi her istekte tekrar okumamak için

def load_df() -> pd.DataFrame:
    """CSV'yi oku, kolonları normalize et, cache'le."""
    global _df_cache
    if _df_cache is None:
        if not CSV_PATH.exists():
            raise FileNotFoundError(f"CSV bulunamadı: {CSV_PATH}")

        df = pd.read_csv(CSV_PATH)

        # date sütunu şart
        if "date" not in df.columns:
            raise ValueError("CSV içinde 'date' kolonu yok.")

        df["date"] = pd.to_datetime(df["date"])

        # Kolon isimlerini frontend için sadeleştir
        rename_map = {
            "precipitation_sum": "rain_mm",
            "temperature_2m_max": "temp_c",
        }
        df = df.rename(columns=rename_map)

        # Gerekli kolonlar var mı?
        required = {"parcel_id", "ndvi", "rain_mm", "temp_c", "date"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"CSV eksik kolonlar: {missing}")

        # Sıralama (grafik düzgün çizilsin)
        df = df.sort_values(["parcel_id", "date"]).reset_index(drop=True)
        _df_cache = df

    return _df_cache

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/parcels")
def get_parcels():
    """
    CSV'deki parcel_id'lerin listesini döndürür.
    Frontend buradan seçim listesi/map için veri alır.
    """
    df = load_df()
    parcel_ids = sorted(df["parcel_id"].unique().tolist())
    return [{"parcel_id": pid, "name": pid} for pid in parcel_ids]

@app.get("/timeseries")
def get_timeseries(parcel_id: str):
    """
    Seçilen parselin NDVI + meteo serisini döndürür.
    """
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
def predict(payload: dict):
    parcel_id = payload.get("parcel_id")
    if not parcel_id:
        return {"error": "parcel_id required"}

    try:
        df = load_ml_df()
        sub = df[df["parcel_id"] == parcel_id]
        if sub.empty:
            return {
                "parcel_id": parcel_id,
                "risk_7d": 50,
                "risk_14d": 55,
                "top_factors": ["no_ml_data_for_parcel"]
            }

        # En güncel satır = en güncel feature set
        row = sub.iloc[-1]

        # Modelin beklediği feature sırasıyla X oluştur
        X = np.array([[float(row[f]) for f in FEATURES]], dtype=float)

        model = load_model()
        ndvi_7d_pred = float(model.predict(X)[0])

        # NDVI tahmini -> risk skoru (MVP dönüşümü)
        risk_7d = max(0.0, min(100.0, (1.0 - ndvi_7d_pred) * 100.0))
        risk_14d = min(100.0, risk_7d + 8.0)

        return {
            "parcel_id": parcel_id,
            "ndvi_7d_pred": round(ndvi_7d_pred, 4),
            "risk_7d": round(risk_7d, 1),
            "risk_14d": round(risk_14d, 1),
            "top_factors": ["rain_sum_7d", "temp_mean_7d", "evap_sum_7d"]
        }

    except Exception:
        # Model/parquet patlarsa demo çökmesin
        return {
            "parcel_id": parcel_id,
            "risk_7d": 78,
            "risk_14d": 86,
            "top_factors": ["model_fallback"]
        }


@app.post("/recommend")
def recommend(payload: dict):
    """
    Basit kural tabanlı öneri. Hackathon için yeterli.
    """
    parcel_id = payload.get("parcel_id", "UNKNOWN")
    risk_7d = payload.get("risk_7d", 0)

    if risk_7d < 40:
        return {
            "parcel_id": parcel_id,
            "window": "izlemede kal",
            "amount_mm": 0,
            "rationale": "NDVI stabil, kısa vadede ciddi su stresi beklenmiyor."
        }

    elif risk_7d < 60:
        return {
            "parcel_id": parcel_id,
            "window": "5–7 gün içinde",
            "amount_mm": 10,
            "rationale": "Orta seviye stres sinyali: yağış azalmaya başladı ve sıcaklık yükseliyor."
        }

    else:
        return {
            "parcel_id": parcel_id,
            "window": "3 gün içinde",
            "amount_mm": 18,
            "rationale": "Yüksek su stresi riski: düşük yağış, yüksek sıcaklık ve NDVI düşüş trendi."
        }