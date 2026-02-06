import joblib
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error
from xgboost import XGBRegressor

BASE = Path(__file__).resolve().parent
TRAIN = BASE / "data" / "train.csv"
OUT_MODEL = BASE / "model" / "aquaguard_model.pkl"

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

df = pd.read_csv(TRAIN)
df["date"] = pd.to_datetime(df["date"], errors="coerce")
df = df.dropna(subset=FEATURES + [TARGET, "parcel_id"])

X = df[FEATURES].astype(float)
y = df[TARGET].astype(float)
groups = df["parcel_id"].astype(str)

params = dict(
    n_estimators=900,
    learning_rate=0.03,
    max_depth=5,
    subsample=0.85,
    colsample_bytree=0.85,
    reg_lambda=1.0,
    random_state=42,
    objective="reg:squarederror",
    tree_method="hist",
)

gkf = GroupKFold(n_splits=5)
oof = np.zeros(len(df), dtype=float)

for fold, (tr, va) in enumerate(gkf.split(X, y, groups=groups), start=1):
    m = XGBRegressor(**params)
    m.fit(X.iloc[tr], y.iloc[tr], eval_set=[(X.iloc[va], y.iloc[va])], verbose=False)
    oof[va] = m.predict(X.iloc[va])
    mae = mean_absolute_error(y.iloc[va], oof[va])
    print(f"fold {fold} MAE: {mae:.4f}")

print("OOF MAE:", mean_absolute_error(y, oof))

final = XGBRegressor(**params)
final.fit(X, y, verbose=False)

OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
joblib.dump(final, OUT_MODEL)
print("Saved model:", OUT_MODEL)
