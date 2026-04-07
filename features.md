# Minimum Requirements for a Community Health Risk Prediction System

To transition from a single-user diagnostic tool to a community-level prediction system, the absolute minimum required features are:

1. **Geolocation Data Collection:**
   - Update `models.py` and `schemas.py` to collect a location identifier (e.g., `zip_code` or `city`) with each health prediction.

2. **Anonymized Data Aggregation:**
   - Create an endpoint in `main.py` that groups and aggregates health predictions by location, ensuring all Personally Identifiable Information (PII) is removed.

3. **Community Risk Dashboard:**
   - Update the frontend to visualize the aggregated data, such as displaying a heatmap or charts of health risks across different zip codes or regions.
