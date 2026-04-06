"""
main.py — ShopIQ Backend (FastAPI)
Usage:
    python main.py
    python main.py --port 8000
    python main.py --reload
"""
import argparse
import logging
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from backend.src.routes import router
except ModuleNotFoundError:
    from src.routes import router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Create FastAPI app
app = FastAPI(
    title="Intelligent Online Shopping Analyzer API",
    description="FP-Growth + RFM segmentation for Online Retail datasets with Advanced Filtering",
    version="4.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router)


@app.get("/")
def root():
    return {
        "message": "ShopIQ API v4.0.0 - Advanced Filtering",
        "docs": "/docs",
        "endpoints": {
            "dashboard": "/api/dashboard",
            "filters": {
                "top_products": "/api/filter/products/top",
                "least_products": "/api/filter/products/least",
                "customer_products": "/api/filter/customer/products",
                "product_customers": "/api/filter/product/customers",
                "segment_products": "/api/filter/segment/products",
                "combined": "/api/filter/combined"
            },
            "autocomplete": "/api/autocomplete/{field}?query=",
            "segments": "/api/segments/list",
            "countries": "/api/countries/list"
        }
    }


def main():
    parser = argparse.ArgumentParser(description="ShopIQ Backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("  ShopIQ Backend - Advanced Filtering System")
    print("="*60)
    print(f"  API  : http://{args.host}:{args.port}/api")
    print(f"  Docs : http://{args.host}:{args.port}/docs")
    print("="*60)
    print("  New Features:")
    print("  ✓ Top/Least Products Filter")
    print("  ✓ Customer Purchase Analysis")
    print("  ✓ Product-Customer Analysis")
    print("  ✓ Segment-based Product Analysis")
    print("  ✓ Combined Multi-Filter Search")
    print("  ✓ Autocomplete Suggestions")
    print("="*60)
    print("  Frontend runs separately on http://localhost:3000")
    print("  Press Ctrl+C to stop\n")

    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
        timeout_graceful_shutdown=1,
    )


if __name__ == "__main__":
    main()
