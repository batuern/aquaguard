# backend/ml/train.py
from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error
from xgboost import XGBRegressor

from .features import add_rolling_features, select_feature_columns

ART = Path(__file__).resolve().parent / "artifacts"
ART.mkdir(parents=True, exist_ok=True)

def train(csv_path: str, target_col: str = "stress") -> None:
    df = pd.read_csv(csv_path)

    # Beklenen: parcel_id, date, ndvi, rain, et, stress
    df = add_rolling_features(df)

    feat_cols = select_feature_columns(df)

    # NaN temizliği (rolling başlarında olur)
    df = df.dropna(subset=feat_cols + [target_col, "parcel_id"])

    X = df[feat_cols].astype(float)
    y = df[target_col].astype(float)
    groups = df["parcel_id"].astype(str)

    # Parcel bazlı leakage engellemek için GroupKFold
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros(len(df), dtype=float)

    params = dict(
        n_estimators=700,
        learning_rate=0.03,
        max_depth=5,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.0,
        random_state=42,
        objective="reg:squarederror",
        tree_method="hist",
    )

    for fold, (tr, va) in enumerate(gkf.split(X, y, groups=groups), start=1):
        model = XGBRegressor(**params)
        model.fit(X.iloc[tr], y.iloc[tr], eval_set=[(X.iloc[va], y.iloc[va])], verbose=False)
        oof[va] = model.predict(X.iloc[va])
        mae = mean_absolute_error(y.iloc[va], oof[va])
        print(f"fold {fold} MAE: {mae:.4f}")

    print("OOF MAE:", mean_absolute_error(y, oof))

    # Final model: tüm veriyle fit
    final = XGBRegressor(**params)
    final.fit(X, y, verbose=False)

    model_path = ART / "xgb_model.json"
    final.save_model(model_path.as_posix())

    schema_path = ART / "feature_schema.json"
    schema_path.write_text(json.dumps({"features": feat_cols, "target": target_col}, ensure_ascii=False, indent=2), encoding="utf-8")

    print("Saved:", model_path)
    print("Saved:", schema_path)

if __name__ == "__main__":
    # örnek: python -m backend.ml.train data/train.csv
    import sys
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python -m backend.ml.train <csv_path>")
    train(sys.argv[1])
