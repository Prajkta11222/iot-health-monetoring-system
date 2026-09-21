import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from ml-service root (one level up from app/)
_env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(_env_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .schemas import PredictionRequest, PredictionResponse, VitalPredictionRequest, VitalPredictionResponse, now_utc
from .predictor import ECGPredictor, VitalPredictor

app = FastAPI(title='Smart Health Monitoring ML Services', version='1.0')

# CORS — allow the Node.js backend (and other allowed origins) to call this service
_allowed_origins = os.getenv('ALLOWED_ORIGINS', '*')
_origins = ['*'] if _allowed_origins == '*' else [o.strip() for o in _allowed_origins.split(',')]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)
ecg_predictor: ECGPredictor | None = None
vital_predictor: VitalPredictor | None = None

# Backward compatibility alias
predictor = None

@app.on_event('startup')
def load_models_once() -> None:
    global ecg_predictor, vital_predictor, predictor
    try:
        ecg_predictor = ECGPredictor()
        predictor = ecg_predictor
    except FileNotFoundError:
        ecg_predictor = None
        predictor = None
    try:
        vital_predictor = VitalPredictor()
    except FileNotFoundError:
        vital_predictor = None

@app.get('/health')
def health() -> dict[str, str | bool]:
    return {
        'status': 'ok' if (ecg_predictor or vital_predictor) else 'model_unavailable',
        'ecg_model': ecg_predictor is not None,
        'vital_model': vital_predictor is not None
    }

@app.post('/predict', response_model=PredictionResponse)
def predict(request: PredictionRequest) -> PredictionResponse:
    if ecg_predictor is None:
        raise HTTPException(status_code=503, detail='ECG model artifact is unavailable')
    if request.ecgSignalQuality != 'GOOD' or request.ecgLeadOff:
        raise HTTPException(status_code=422, detail='ECG signal must be GOOD with leads connected')
    try:
        label, probability = ecg_predictor.predict(request.ecg)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return PredictionResponse(riskLabel=label, riskProbability=probability, modelVersion='1.0', signalQuality=request.ecgSignalQuality, predictionTimestamp=now_utc())

@app.post('/predict/vital', response_model=VitalPredictionResponse)
def predict_vital(request: VitalPredictionRequest) -> VitalPredictionResponse:
    if vital_predictor is None:
        raise HTTPException(status_code=503, detail='Vital Risk model artifact is unavailable')
    try:
        label, probability = vital_predictor.predict(request.heartRate, request.spo2, request.temperature)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return VitalPredictionResponse(riskLabel=label, riskProbability=probability, modelVersion='1.0', predictionTimestamp=now_utc())