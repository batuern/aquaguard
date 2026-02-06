import pandas as pd

df = pd.read_parquet("backend/data/ml_ready_data.parquet")

FEATURES = [
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
TARGET = "target_ndvi_7d"

keep = ["parcel_id", "date"] + FEATURES + [TARGET]
df = df[keep].dropna().sort_values(["parcel_id", "date"]).reset_index(drop=True)

out_path = "backend/data/train.csv"
df.to_csv(out_path, index=False)
print("Wrote", out_path, "rows=", len(df), "cols=", len(df.columns))
