import datetime
from pydantic import BaseModel


class PredictionCreate(BaseModel):
    city: str | None = None
    zip_code: str | None = None
    filename: str
    prediction: str
    detailed_class: str
    confidence: float


class Prediction(BaseModel):
    id: int
    city: str | None = None
    zip_code: str | None = None
    filename: str
    prediction: str
    detailed_class: str
    confidence: float
    created_at: datetime.datetime

    class Config:
        from_attributes = True


class CommunityRiskSummary(BaseModel):
    location: str
    location_type: str
    total_predictions: int
    cancerous_cases: int
    non_cancerous_cases: int
    cancerous_rate: float
    average_confidence: float
