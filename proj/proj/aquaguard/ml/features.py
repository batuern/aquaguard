import pandas as pd


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # --- Column mapping from Data/Pipeline naming to our standard naming ---
    rename_map = {
        "precipitation_sum": "rain_mm",
        "temperature_2m_max": "temp_c",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

    # Ensure types
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["parcel_id", "date"]).reset_index(drop=True)


    # --- NDVI anomaly (rolling z-score per parcel) ---
    mean_30 = (
        df.groupby("parcel_id")["ndvi"]
        .rolling(30, min_periods=15)
        .mean()
        .reset_index(level=0, drop=True)
    )
    std_30 = (
        df.groupby("parcel_id")["ndvi"]
        .rolling(30, min_periods=15)
        .std()
        .reset_index(level=0, drop=True)
    )

    df["ndvi_mean_30"] = mean_30
    df["ndvi_std_30"] = std_30
    df["ndvi_anomaly"] = (df["ndvi"] - df["ndvi_mean_30"]) / df["ndvi_std_30"]

    # Avoid division by zero / infinite
    df["ndvi_anomaly"] = df["ndvi_anomaly"].replace([float("inf"), float("-inf")], pd.NA)

    # --- Lag features (per parcel) ---
    for lag in [7, 14, 21]:
        df[f"ndvi_anomaly_lag_{lag}"] = df.groupby("parcel_id")["ndvi_anomaly"].shift(lag)

    # --- Weather rolling features ---
    df["rain_sum_7"] = (
        df.groupby("parcel_id")["rain_mm"]
        .rolling(7, min_periods=3)
        .sum()
        .reset_index(level=0, drop=True)
    )
    df["rain_sum_14"] = (
        df.groupby("parcel_id")["rain_mm"]
        .rolling(14, min_periods=7)
        .sum()
        .reset_index(level=0, drop=True)
    )

    df["temp_mean_7"] = (
        df.groupby("parcel_id")["temp_c"]
        .rolling(7, min_periods=3)
        .mean()
        .reset_index(level=0, drop=True)
    )
    df["temp_mean_14"] = (
        df.groupby("parcel_id")["temp_c"]
        .rolling(14, min_periods=7)
        .mean()
        .reset_index(level=0, drop=True)
    )

    return df


FEATURE_COLUMNS = [
    "ndvi_anomaly_lag_7",
    "ndvi_anomaly_lag_14",
    "ndvi_anomaly_lag_21",
    "rain_sum_7",
    "rain_sum_14",
    "temp_mean_7",
    "temp_mean_14",
]
