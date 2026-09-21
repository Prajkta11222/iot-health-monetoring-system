from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field

class PredictionRequest(BaseModel):
    ecg: list[float] = Field(min_length=1)
    ecgSignalQuality: str = 'GOOD'
    ecgLeadOff: bool = False

class PredictionResponse(BaseModel):
    riskLabel: str
    riskProbability: Optional[float] = None
    modelVersion: str
    signalQuality: str
    predictionTimestamp: datetime

class VitalPredictionRequest(BaseModel):
    heartRate: float = Field(gt=0, lt=300)
    spo2: float = Field(gt=0, le=100)
    temperature: float = Field(gt=20, lt=50)

class VitalPredictionResponse(BaseModel):
    riskLabel: str
    riskProbability: Optional[float] = None
    modelVersion: str = '1.0'
    predictionTimestamp: datetime

def now_utc() -> datetime:
    return datetime.now(timezone.utc)