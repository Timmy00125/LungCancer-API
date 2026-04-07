import datetime
from pydantic import BaseModel


class PredictionCreate(BaseModel):
    filename: str
    prediction: str
    detailed_class: str
    confidence: float


class Prediction(BaseModel):
    id: int
    filename: str
    prediction: str
    detailed_class: str
    confidence: float
    created_at: datetime.datetime

    class Config:
        from_attributes = True
