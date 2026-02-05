import os
import joblib
import pandas as pd
from lightgbm import LGBMRegressor

from features import build_features, FEATURE_COLUMNS


DATA_PATH = os.path.join("data", "parcels_timeseries.csv")
MODEL_PATH = "model_7d.joblib"
FEATURES_PATH = "feature_columns.joblib"


def main():
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(
            f"CSV bulunamadı: {DATA_PATH}\n"
            "Dosyayı şuraya koy: aquaguard/ml/data/parcels_timeseries.csv"
        )

    df = pd.read_csv(DATA_PATH)
    df = build_features(df)

    # Target: 7 gün sonraki ndvi_anomaly
    df["target_7d"] = df.groupby("parcel_id")["ndvi_anomaly"].shift(-7)

    # Model dataframe
    df_model = df.dropna(subset=FEATURE_COLUMNS + ["target_7d"]).reset_index(drop=True)

    if len(df_model) < 200:
        print(f"⚠️ Uyarı: Eğitim verisi az görünüyor (n={len(df_model)}). Yine de devam ediyorum.")

    X = df_model[FEATURE_COLUMNS]
    y = df_model["target_7d"]

    # Time-aware split (shuffle yok)
    split_idx = int(len(df_model) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    model = LGBMRegressor(
        n_estimators=400,
        learning_rate=0.05,
        max_depth=6,
        random_state=42,
        subsample=0.9,
        colsample_bytree=0.9
    )

    model.fit(X_train, y_train)

    # Basit değerlendirme
    preds = model.predict(X_test)
    rmse = ((preds - y_test) ** 2).mean() ** 0.5
    print(f"✅ Train done. Test RMSE: {rmse:.4f}")

    joblib.dump(model, MODEL_PATH)
    joblib.dump(FEATURE_COLUMNS, FEATURES_PATH)
    print(f"✅ Saved: {MODEL_PATH}, {FEATURES_PATH}")


if __name__ == "__main__":
    main()
