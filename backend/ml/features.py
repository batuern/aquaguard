# backend/ml/features.py
from __future__ import annotations
import pandas as pd

def add_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Beklenen kolonlar (en az):
    parcel_id, date, ndvi, rain, et, (opsiyonel: tmax)
    """
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["parcel_id", "date"])

    g = df.groupby("parcel_id", group_keys=False)

    # Rolling (7, 14) pencere
    for w in (7, 14):
        df[f"ndvi_mean_{w}"] = g["ndvi"].rolling(w, min_periods=3).mean().reset_index(level=0, drop=True)
        df[f"ndvi_std_{w}"]  = g["ndvi"].rolling(w, min_periods=3).std().reset_index(level=0, drop=True)

        df[f"rain_sum_{w}"]  = g["rain"].rolling(w, min_periods=3).sum().reset_index(level=0, drop=True)
        df[f"et_mean_{w}"]   = g["et"].rolling(w, min_periods=3).mean().reset_index(level=0, drop=True)

    # Trend (son 14 günde ndvi eğimi gibi basit proxy)
    df["ndvi_diff_7"] = g["ndvi"].diff(7)
    df["ndvi_diff_14"] = g["ndvi"].diff(14)

    # Mevsimsellik proxy (günün yılı)
    df["doy"] = df["date"].dt.dayofyear

    return df

def select_feature_columns(df: pd.DataFrame) -> list[str]:
    cols = [
        "ndvi",
        "rain",
        "et",
        "doy",
        "ndvi_mean_7", "ndvi_std_7", "rain_sum_7", "et_mean_7", "ndvi_diff_7",
        "ndvi_mean_14","ndvi_std_14","rain_sum_14","et_mean_14","ndvi_diff_14",
    ]
    # tmax varsa ekle
    if "tmax" in df.columns:
        cols.insert(3, "tmax")
    return cols


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalizes column names from frontend/raw CSVs and builds model features.

    Accepts dataframes with variants of column names (e.g. `rain_mm`,
    `et0_fao_evapotranspiration`) and returns a dataframe with rolling
    features and original metadata (`date`, `parcel_id`).
    """
    df = df.copy()

    # normalize common column name variants
    if "rain_mm" in df.columns and "rain" not in df.columns:
        df["rain"] = df["rain_mm"]
    if "et0_fao_evapotranspiration" in df.columns and "et" not in df.columns:
        df["et"] = df["et0_fao_evapotranspiration"]
    if "temperature_2m_max" in df.columns and "tmax" not in df.columns:
        df["tmax"] = df["temperature_2m_max"]

    # Ensure date is datetime
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])

    # Build rolling features (will keep parcel_id and date)
    df_feat = add_rolling_features(df)

    # Keep original identifiers + generated features
    return df_feat
