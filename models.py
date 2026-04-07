from sqlalchemy import Column, Integer, String, Float, DateTime
from database import Base
import datetime


class PredictionRecord(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    prediction = Column(String, index=True)
    detailed_class = Column(String)
    confidence = Column(Float)
    city = Column(String, index=True, nullable=True)
    zip_code = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
