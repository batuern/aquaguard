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
    if not isinstance(feature_cols, (list, tuple)):
        raise TypeError("feature_columns.joblib içeriği list/tuple olmalı.")
    return model, list(feature_cols)


def _min_history_hint() -> int:
    # ndvi anomaly needs min_periods=15, plus lag_21 => ~36
    return 36


def _debug_report(df_feat: pd.DataFrame, feature_cols: list) -> dict:
    """
    Return a compact debug report about missingness and validity.
    """
    report = {}

    # Basic stats
    report["n_rows"] = int(len(df_feat))
    report["date_min"] = str(pd.to_datetime(df_feat["date"]).min().date()) if "date" in df_feat.columns and len(df_feat) else None
    report["date_max"] = str(pd.to_datetime(df_feat["date"]).max().date()) if "date" in df_feat.columns and len(df_feat) else None

    # Feature NA counts on the LAST row (the one we ideally want)
    last = df_feat.sort_values("date").iloc[-1:]
    na_last = last[feature_cols].isna().sum().to_dict()
    report["na_counts_on_last_row"] = {k: int(v) for k, v in na_last.items() if v > 0}

    # Overall NA counts (which feature is generally problematic)
    na_total = df_feat[feature_cols].isna().sum().sort_values(ascending=False)
    report["na_counts_total"] = {k: int(v) for k, v in na_total.items() if v > 0}

    # How many fully valid rows exist
    df_valid = df_feat.dropna(subset=feature_cols)
    report["n_valid_rows"] = int(len(df_valid))
    if len(df_valid):
        report["first_valid_date"] = str(pd.to_datetime(df_valid["date"]).min().date())
        report["last_valid_date"] = str(pd.to_datetime(df_valid["date"]).max().date())

    # Quick sanity: ndvi_std_30 zeros (could cause NA anomalies)
    if "ndvi_std_30" in df_feat.columns:
        zeros = (df_feat["ndvi_std_30"] == 0).sum(skipna=True)
        report["ndvi_std_30_zero_count"] = int(zeros)

    return report


def predict_7d_from_timeseries(df_timeseries: pd.DataFrame, debug: bool = False) -> dict:
    """
    Input: A single parcel's time series dataframe with columns:
      date, parcel_id, ndvi, rain_mm, temp_c

    We generate features and pick the latest row where ALL model features exist (non-NA),
    consistent with train.py (dropna).
    """
    model, feature_cols = load_artifacts()

    df_feat = build_features(df_timeseries).sort_values("date").reset_index(drop=True)

    dbg = _debug_report(df_feat, feature_cols) if debug else None

    # Consistent with training: drop rows where any feature is NA
    df_valid = df_feat.dropna(subset=feature_cols)

    if df_valid.empty:
        available_days = int(df_feat.shape[0])
        msg = (
            "Tahmin için yeterli feature üretilemedi (NA kaldı). Daha uzun geçmiş veri gerekiyor.\n"
            f"- Mevcut gün sayısı: {available_days}\n"
            f"- Güvenli minimum öneri: ~{_min_history_hint()} gün\n"
            "Not: NDVI çok sabitse std=0 olabilir ve ndvi_anomaly NA çıkabilir."
        )

        # Debug açıksa hatanın yanına raporu ekle (UI/log için)
        if debug:
            return {
                "ok": False,
                "error": msg,
                "debug": dbg,
            }

        raise ValueError(msg)

    last = df_valid.iloc[-1:]
    X = last[feature_cols]

    pred_anom = float(model.predict(X)[0])
    risk = anomaly_to_risk(pred_anom)

    top_factors = []
    if hasattr(model, "feature_importances_"):
        importances = dict(zip(feature_cols, model.feature_importances_))
        top_factors = sorted(importances, key=importances.get, reverse=True)[:3]

    used_features = {c: float(X.iloc[0][c]) for c in feature_cols}
    used_date = pd.to_datetime(last.iloc[0]["date"]).date().isoformat()

    out = {
        "ok": True,
        "used_date": used_date,
        "predicted_anomaly_7d": pred_anom,
        "risk_score": risk,
        "top_factors": top_factors,
        "used_features": used_features,
    }

    if debug:
        out["debug"] = dbg

    return out
