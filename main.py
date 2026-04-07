from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
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


@app.on_event("startup")
def load_ml_model():
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
async def predict(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if model is None:
        raise HTTPException(status_code=500, detail="Model is not loaded.")

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


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8004)
