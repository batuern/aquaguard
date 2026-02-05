import os
import joblib
import pandas as pd

from features import build_features


MODEL_PATH = "model_7d.joblib"
FEATURES_PATH = "feature_columns.joblib"


def anomaly_to_risk(anomaly: float) -> int:
    # hackathon mapping (simple, explainable)
    return int(min(100, abs(anomaly) * 30))


def load_artifacts():
    if not os.path.exists(MODEL_PATH) or not os.path.exists(FEATURES_PATH):
        raise FileNotFoundError(
            "Model dosyaları bulunamadı. Önce train.py çalıştır:\n"
            "python train.py"
        )
    model = joblib.load(MODEL_PATH)
    feature_cols = joblib.load(FEATURES_PATH)
    return model, feature_cols


def predict_7d_from_timeseries(df_timeseries: pd.DataFrame) -> dict:
    """
    Input: A single parcel's time series dataframe with columns:
      date, parcel_id, ndvi, rain_mm, temp_c

    We take the latest row after feature generation and predict 7d anomaly.
    """
    model, feature_cols = load_artifacts()

    df_feat = build_features(df_timeseries)

    # En son satırdan feature al
    last = df_feat.sort_values("date").iloc[-1:]
    X = last[feature_cols]

    if X.isna().any().any():
        raise ValueError("Son satırda feature'lar NA çıktı. Daha uzun geçmiş veri gerekiyor (>= ~30 gün).")

    pred_anom = float(model.predict(X)[0])
    risk = anomaly_to_risk(pred_anom)

    # Explainability: top factors by feature importance
    importances = dict(zip(feature_cols, model.feature_importances_))
    top_factors = sorted(importances, key=importances.get, reverse=True)[:3]

    return {
        "predicted_anomaly_7d": pred_anom,
        "risk_score": risk,
        "top_factors": top_factors,
        "used_features": {c: float(X.iloc[0][c]) for c in feature_cols},
    }
