import os
from pathlib import Path
import joblib
import numpy as np
import pandas as pd


class ECGPredictor:
    def __init__(self) -> None:
        candidates = [
            Path(os.getenv('MODEL_PATH', '')),
            Path('ecg_risk_model.pkl'),
            Path('models/ecg_risk_model.pkl'),
            Path('trained_model/ecg_risk_model.pkl'),
            Path(__file__).resolve().parent.parent.parent / 'ecg_risk_model.pkl',
            Path(__file__).resolve().parent.parent / 'ecg_risk_model.pkl',
            Path(__file__).resolve().parent / 'ecg_risk_model.pkl'
        ]
        path = None
        for candidate in candidates:
            if str(candidate).strip() and candidate.is_file():
                path = candidate
                break
        if not path:
            raise FileNotFoundError('ECG Model artifact missing')
        self.model = joblib.load(path)

    def predict(self, ecg: list[float]) -> tuple[str, float | None]:
        if len(ecg) != 187:
            raise ValueError('ECG input must contain exactly 187 samples')
        features = np.asarray(ecg, dtype=np.float32)
        if not np.isfinite(features).all():
            raise ValueError('ECG input contains non-finite samples')
        features = features.reshape(1, -1)
        prediction = self.model.predict(features)[0]
        probability = None
        if hasattr(self.model, 'predict_proba'):
            probabilities = self.model.predict_proba(features)[0]
            class_index = list(self.model.classes_).index(1)
            probability = float(probabilities[class_index])
        return ('LOW' if int(prediction) == 0 else 'HIGH'), probability


class VitalPredictor:
    def __init__(self) -> None:
        candidates = [
            Path(os.getenv('VITAL_MODEL_PATH', '')),
            Path('vital_risk_model.pkl'),
            Path('models/vital_risk_model.pkl'),
            Path('trained_model/vital_risk_model.pkl'),
            Path(__file__).resolve().parent.parent.parent / 'vital_risk_model.pkl',
            Path(__file__).resolve().parent.parent / 'vital_risk_model.pkl',
            Path(__file__).resolve().parent / 'vital_risk_model.pkl'
        ]
        path = None
        for candidate in candidates:
            if str(candidate).strip() and candidate.is_file():
                path = candidate
                break
        if not path:
            raise FileNotFoundError('Vital Risk Model artifact missing')
        self.model = joblib.load(path)
        # Compatibility patch for SimpleImputer across scikit-learn versions
        for _name, step in getattr(self.model, 'steps', []):
            if type(step).__name__ == 'SimpleImputer':
                if not hasattr(step, '_fit_dtype') and hasattr(step, '_fill_dtype'):
                    step._fit_dtype = step._fill_dtype
                elif not hasattr(step, '_fill_dtype') and hasattr(step, '_fit_dtype'):
                    step._fill_dtype = step._fit_dtype
                if not hasattr(step, '_fit_dtype') and hasattr(step, 'statistics_'):
                    step._fit_dtype = step.statistics_.dtype

    def predict(self, heart_rate: float, spo2: float, temperature: float) -> tuple[str, float | None]:
        df = pd.DataFrame([{
            'Heart Rate (bpm)': float(heart_rate),
            'SpO2 Level (%)': float(spo2),
            'Body Temperature (°C)': float(temperature)
        }])
        prediction = self.model.predict(df)[0]
        probability = None
        if hasattr(self.model, 'predict_proba'):
            probabilities = self.model.predict_proba(df)[0]
            classes_list = list(self.model.classes_)
            if 'HIGH' in classes_list:
                high_idx = classes_list.index('HIGH')
                probability = float(probabilities[high_idx])
            else:
                probability = float(np.max(probabilities))
        return str(prediction), probability


# Backward compatibility alias
Predictor = ECGPredictor