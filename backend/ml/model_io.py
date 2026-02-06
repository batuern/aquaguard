# backend/ml/model_io.py
from __future__ import annotations
import json
from pathlib import Path
from xgboost import XGBRegressor

ART = Path(__file__).resolve().parent / "artifacts"

class ModelBundle:
    def __init__(self):
        self.model = None
        self.features = None

    def load(self):
        schema = json.loads((ART / "feature_schema.json").read_text(encoding="utf-8"))
        self.features = schema["features"]
        m = XGBRegressor()
        m.load_model((ART / "xgb_model.json").as_posix())
        self.model = m
        return self

    def predict_one(self, feature_dict: dict) -> float:
        # feature_dict: features listesiyle birebir aynı key’leri içermeli
        import pandas as pd
        X = pd.DataFrame([{k: float(feature_dict.get(k)) for k in self.features}])
        return float(self.model.predict(X)[0])
