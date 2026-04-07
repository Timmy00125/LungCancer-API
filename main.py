from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import case, func, inspect, text
import uvicorn
import os
from typing import Any
import numpy as np
from tensorflow.keras.models import load_model  # type: ignore
from tensorflow.keras.preprocessing import image  # type: ignore
from tensorflow.keras.layers import Layer  # type: ignore
from tensorflow.keras.saving import register_keras_serializable  # type: ignore
import io
from PIL import Image

import models
import schemas
from database import SessionLocal, engine

# Create the database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Lung Cancer Prediction API")

# Add CORS Middleware to allow requests from the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to restrict domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency to get the DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "LCD.h5")

model = None
IMAGE_SIZE = (256, 256)
class_labels = [
    "squamous cell carcinoma",
    "large cell carcinoma",
    "normal",
    "adenocarcinoma",
]


@register_keras_serializable(package="Custom")
class CustomScaleLayer(Layer):
    """Residual scaling layer used in the serialized Inception-ResNet model."""

    def __init__(self, scale: float = 1.0, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.scale = scale

    def call(self, inputs: list[Any]) -> Any:
        if not isinstance(inputs, (list, tuple)) or len(inputs) != 2:
            raise ValueError(
                "CustomScaleLayer expects two tensors: [base_tensor, residual_tensor]."
            )

        base_tensor, residual_tensor = inputs
        return base_tensor + self.scale * residual_tensor

    def get_config(self) -> dict[str, Any]:
        config = super().get_config()
        config.update({"scale": self.scale})
        return config


def ensure_prediction_location_columns() -> None:
    """Add nullable location columns for existing SQLite databases."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "predictions" not in table_names:
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("predictions")
    }
    missing_columns: list[tuple[str, str]] = []
    if "city" not in existing_columns:
        missing_columns.append(("city", "VARCHAR"))
    if "zip_code" not in existing_columns:
        missing_columns.append(("zip_code", "VARCHAR"))

    if not missing_columns:
        return

    with engine.begin() as connection:
        for column_name, column_type in missing_columns:
            connection.execute(
                text(f"ALTER TABLE predictions ADD COLUMN {column_name} {column_type}")
            )


def normalize_location_value(raw_value: str | None) -> str | None:
    """Normalize optional location fields by trimming whitespace."""
    if raw_value is None:
        return None

    cleaned_value = raw_value.strip()
    if cleaned_value == "":
        return None
    return cleaned_value


@app.on_event("startup")
def load_ml_model() -> None:
    ensure_prediction_location_columns()

    global model
    if os.path.exists(MODEL_PATH):
        model = load_model(
            MODEL_PATH,
            compile=False,
            custom_objects={
                "Custom>CustomScaleLayer": CustomScaleLayer,
                "CustomScaleLayer": CustomScaleLayer,
            },
        )
    else:
        print(f"Warning: Model not found at {MODEL_PATH}")


def preprocess_image(img_bytes):
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img = img.resize(IMAGE_SIZE)
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)
    img_array /= 255.0
    return img_array


@app.post("/predict", response_model=schemas.Prediction)
async def predict(
    file: UploadFile = File(...),
    city: str | None = Form(default=None),
    zip_code: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    if model is None:
        raise HTTPException(status_code=500, detail="Model is not loaded.")

    city_value = normalize_location_value(city)
    zip_code_value = normalize_location_value(zip_code)
    if city_value is None and zip_code_value is None:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one location field: city or zip_code.",
        )

    try:
        contents = await file.read()
        img_array = preprocess_image(contents)
        predictions = model.predict(img_array)

        predicted_class = np.argmax(predictions[0])
        predicted_label = class_labels[predicted_class]

        if predicted_label == "normal":
            status = "non-cancerous"
        else:
            status = "cancerous"

        confidence = float(predictions[0][predicted_class])

        # Save to database
        db_prediction = models.PredictionRecord(
            filename=file.filename,
            prediction=status,
            detailed_class=predicted_label,
            confidence=confidence,
            city=city_value,
            zip_code=zip_code_value,
        )
        db.add(db_prediction)
        db.commit()
        db.refresh(db_prediction)

        return db_prediction

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predictions", response_model=list[schemas.Prediction])
def read_predictions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    predictions = (
        db.query(models.PredictionRecord)
        .order_by(models.PredictionRecord.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return predictions


@app.get(
    "/predictions/community-risk", response_model=list[schemas.CommunityRiskSummary]
)
def read_community_risk(
    min_samples: int = 1,
    db: Session = Depends(get_db),
):
    """Return anonymized risk metrics grouped by location only."""
    clean_zip_code = func.nullif(models.PredictionRecord.zip_code, "")
    clean_city = func.nullif(models.PredictionRecord.city, "")
    location_value = func.coalesce(clean_zip_code, clean_city)
    location_type = case(
        (clean_zip_code.is_not(None), "zip_code"),
        else_="city",
    )
    cancerous_case = case(
        (models.PredictionRecord.prediction == "cancerous", 1),
        else_=0,
    )

    rows = (
        db.query(
            location_value.label("location"),
            location_type.label("location_type"),
            func.count(models.PredictionRecord.id).label("total_predictions"),
            func.sum(cancerous_case).label("cancerous_cases"),
            (func.count(models.PredictionRecord.id) - func.sum(cancerous_case)).label(
                "non_cancerous_cases"
            ),
            func.avg(cancerous_case).label("cancerous_rate"),
            func.avg(models.PredictionRecord.confidence).label("average_confidence"),
        )
        .filter(location_value.is_not(None))
        .group_by(location_value, location_type)
        .having(func.count(models.PredictionRecord.id) >= min_samples)
        .order_by(
            func.avg(cancerous_case).desc(),
            func.count(models.PredictionRecord.id).desc(),
        )
        .all()
    )

    return [
        schemas.CommunityRiskSummary(
            location=str(row.location),
            location_type=str(row.location_type),
            total_predictions=int(row.total_predictions),
            cancerous_cases=int(row.cancerous_cases or 0),
            non_cancerous_cases=int(row.non_cancerous_cases or 0),
            cancerous_rate=float(row.cancerous_rate or 0.0),
            average_confidence=float(row.average_confidence or 0.0),
        )
        for row in rows
    ]


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8004)
