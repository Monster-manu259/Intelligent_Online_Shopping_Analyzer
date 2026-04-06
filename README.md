# Intelligent Online Shopping Analyzer

A simple full-stack project for analyzing online retail transactions.

- Backend: FastAPI (data upload, cleaning, overview, recommendations, RFM segmentation, filters)
- Frontend: HTML/CSS/JavaScript dashboard
- Data: CSV input (sample file included: `sample_data.csv`)

## Usage

- Upload your online retail CSV and explore sales, recommendations, and customer segments.
- Use the insights to support business decisions like product bundling, targeted marketing, and customer retention strategies.

## 1) Setup Backend

From the project root:

```bash
cd backend
pip install -r requirements.txt
```

## 2) Run Backend API

```bash
cd backend
python main.py --reload
```

Default URLs:

- API: http://127.0.0.1:8000/api
- Docs: http://127.0.0.1:8000/docs

## 3) Open Frontend

Open this file in your browser:

- `frontend/index.html`

The frontend is configured to call:

- http://127.0.0.1:8000



## Notes

- Keep the backend running while using the frontend.
- If the frontend cannot reach the API, verify backend is running on port 8000.

