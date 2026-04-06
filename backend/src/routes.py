"""
routes.py — All API route handlers + exception-to-HTTP mapping
Imports custom exceptions and maps them to correct HTTP status codes.
"""
import tempfile
import traceback
import logging
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, HTTPException, Query
from pydantic import BaseModel

from .core.exceptions import (
    ShopIQBaseException,
    InvalidFileTypeError, EmptyFileError, CSVNotFoundError,
    MissingColumnsError, EncodingError, ParseError, AllRowsRemovedError,
    NoDataLoadedError, InvalidParameterError,
    NoFrequentItemsetsError, NoRulesFoundError,
    RulesNotComputedError, ProductNotFoundError,
    InsufficientCustomersError, ClusteringError, FPGrowthError,
)
from .models.models import (
    ProductFilters,
    CombinedFilters,
    CustomerProductAnalysis,
    ProductCustomerAnalysis
)
from .models.filters import DataFilter
from .models.data_cleaning import load_and_clean, get_summary
from .models.market_basket import run_fpgrowth, get_recommendations
from .models.rfm_segmentation import segment_customers, segment_summary

log = logging.getLogger("shopiq.routes")

router = APIRouter()

# ── In-memory session ─────────────────────────────────────────────────────────
SESSION: dict = {"df": None, "rules": None, "rfm": None}

# ── Exception → HTTP status map ───────────────────────────────────────────────
EXCEPTION_STATUS_MAP = {
    InvalidFileTypeError:       400,
    EmptyFileError:             400,
    CSVNotFoundError:           400,
    MissingColumnsError:        400,
    EncodingError:              400,
    ParseError:                 400,
    AllRowsRemovedError:        422,
    NoDataLoadedError:          400,
    InvalidParameterError:      400,
    NoFrequentItemsetsError:    404,
    NoRulesFoundError:          404,
    RulesNotComputedError:      400,
    ProductNotFoundError:       404,
    InsufficientCustomersError: 400,
    ClusteringError:            500,
    FPGrowthError:              500,
}


def handle(exc: ShopIQBaseException) -> HTTPException:
    """Map a ShopIQ exception to an HTTPException with correct status code."""
    status = EXCEPTION_STATUS_MAP.get(type(exc), 500)
    log.error(f"[{type(exc).__name__}] {exc.message}")
    log.debug(traceback.format_exc())
    return HTTPException(status_code=status, detail=exc.message)


# ── Health ────────────────────────────────────────────────────────────────────
@router.get("/api/health", tags=["System"])
def health():
    """Check server status and whether data is loaded."""
    return {"status": "ok", "data_loaded": SESSION["df"] is not None}


# ── Upload ────────────────────────────────────────────────────────────────────
@router.post("/api/upload", tags=["Data"])
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload and clean a CSV file.
    Stores cleaned DataFrame in session for subsequent endpoints.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file received.")

    if not file.filename.lower().endswith(".csv"):
        raise handle(InvalidFileTypeError(
            f"Invalid file type '{file.filename}'. Only .csv files are accepted."
        ))

    try:
        raw_bytes = await file.read()
        if len(raw_bytes) == 0:
            raise EmptyFileError("Uploaded file is empty (0 bytes).")

        tmp_path = Path(tempfile.gettempdir()) / file.filename
        tmp_path.write_bytes(raw_bytes)

        df = load_and_clean(str(tmp_path))
        SESSION["df"]    = df
        SESSION["rules"] = None
        SESSION["rfm"]   = None

        summary = get_summary(df)
        log.info(f"Loaded {summary['total_rows']:,} rows from {file.filename}")
        return {"success": True, "summary": summary}

    except ShopIQBaseException as exc:
        raise handle(exc)
    except HTTPException:
        raise
    except Exception as exc:
        log.error(f"Unexpected upload error: {exc}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}")


# ── Overview ──────────────────────────────────────────────────────────────────
@router.get("/api/overview", tags=["Analytics"])
def get_overview():
    """Return monthly revenue, top products, top countries and sample rows."""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    try:
        df = SESSION["df"]

        monthly = (
            df.set_index("InvoiceDate")["TotalPrice"]
            .resample("ME").sum().reset_index()
        )
        monthly_data = [
            {"month": str(r.InvoiceDate.date())[:7], "revenue": round(float(r.TotalPrice), 2)}
            for _, r in monthly.iterrows()
        ]

        top_products = df.groupby("Description")["TotalPrice"].sum().nlargest(10).reset_index()
        products_data = [
            {"name": row.Description, "revenue": round(float(row.TotalPrice), 2)}
            for _, row in top_products.iterrows()
        ]

        top_countries = df.groupby("Country")["TotalPrice"].sum().nlargest(10).reset_index()
        countries_data = [
            {"country": row.Country, "revenue": round(float(row.TotalPrice), 2)}
            for _, row in top_countries.iterrows()
        ]

        sample = df.head(50).copy()
        sample["InvoiceDate"] = sample["InvoiceDate"].astype(str)
        sample_data = sample[
            ["InvoiceNo","Description","Quantity","UnitPrice",
             "TotalPrice","CustomerID","Country","InvoiceDate"]
        ].to_dict("records")

        return {
            "monthly":   monthly_data,
            "products":  products_data,
            "countries": countries_data,
            "sample":    sample_data,
            "summary":   get_summary(df),
        }
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Overview error: {exc}")
        raise HTTPException(status_code=500, detail=f"Overview aggregation failed: {exc}")


# ── Intelligent Shopping Online Analyzer
class BasketRequest(BaseModel):
    min_support:    float = 0.05
    min_confidence: float = 0.30
    min_lift:       float = 1.0
    top_n_items:    int   = 50


@router.post("/api/basket", tags=["Analytics"])
def compute_basket(req: BasketRequest):
    """Run FP-Growth and return association rules sorted by lift."""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())

    df = SESSION["df"]
    n_invoices = df["InvoiceNo"].nunique()

    # Auto-raise support for large datasets to keep response under 30s
    # Auto-adjust support based on dataset size
    auto_support = req.min_support
    if n_invoices > 100_000:
        auto_support = max(req.min_support, 0.1)
    elif n_invoices > 50_000:
        auto_support = max(req.min_support, 0.07)
    elif n_invoices < 100:
        auto_support = min(req.min_support, 0.1)  # lower for small data

    log.info(f"FP-Growth: invoices={n_invoices} support={auto_support} confidence={req.min_confidence} lift={req.min_lift}")

    try:
        # For small datasets use all items, for large cap at 50
        auto_top_n = req.top_n_items if n_invoices >= 500 else n_invoices
        rules = run_fpgrowth(
            df,
            min_support=auto_support,
            min_confidence=req.min_confidence,
            min_lift=req.min_lift,
            top_n_items=auto_top_n,
        )
        SESSION["rules"] = rules
        return {
            "total_rules":    len(rules),
            "max_lift":       round(float(rules["lift"].max()), 4),
            "avg_confidence": round(float(rules["confidence"].mean()), 4),
            "rules":          rules.to_dict("records"),
        }
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Basket error: {exc}")
        raise HTTPException(status_code=500, detail=f"Unexpected basket error: {exc}")


# ── Recommendations ───────────────────────────────────────────────────────────
@router.get("/api/recommend", tags=["Analytics"])
def recommend(
    product: str = Query(..., description="Product name"),
    top_k:   int = Query(5,   description="Number of recommendations"),
):
    """Return product recommendations based on association rules."""
    if SESSION["rules"] is None:
        raise handle(RulesNotComputedError())
    try:
        recs = get_recommendations(SESSION["rules"], product, top_k)
        return {"product": product, "recommendations": recs}
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Recommend error: {exc}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}")


@router.get("/api/products", tags=["Analytics"])
def list_products():
    """Return all unique product names for the recommender dropdown."""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    products = sorted(SESSION["df"]["Description"].unique().tolist())
    return {"products": products}


# ── RFM Segmentation ──────────────────────────────────────────────────────────
class RFMRequest(BaseModel):
    n_clusters: int = 5

@router.post("/api/rfm", tags=["Analytics"])
def compute_rfm_endpoint(req: RFMRequest):
    """Run RFM + K-Means segmentation and return segment summary."""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())

    log.info(f"RFM: n_clusters={req.n_clusters}")

    try:
        rfm     = segment_customers(SESSION["df"], n_clusters=req.n_clusters)
        summary = segment_summary(rfm)
        # Store RFM indexed by CustomerID (required by segment/customer filters)
        if "CustomerID" in rfm.columns:
            SESSION["rfm"] = rfm.set_index("CustomerID", drop=False)
        else:
            SESSION["rfm"] = rfm
        return {
            "summary": summary.to_dict("records"),
            "scatter": rfm.sample(min(2000, len(rfm)))[
                ["CustomerID","Recency","Frequency","Monetary","Segment"]
            ].to_dict("records"),
        }
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"RFM error: {exc}")
        raise HTTPException(status_code=500, detail=f"Unexpected RFM error: {exc}")

# ── Advanced Filtering ────────────────────────────────────────────────────────

@router.post("/api/filter/products/top", tags=["Filters"])
def get_top_products(filters: ProductFilters):
    """Get most bought products globally"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        # Apply any additional filters first
        filtered_df = SESSION["df"].copy()
        if filters.product_name or filters.stock_code or filters.price_min or filters.price_max:
            filtered_df = data_filter.apply_product_filters(filters)
        # Get top products with sorting
        temp_filter = DataFilter(filtered_df, SESSION.get("rfm"))
        products = temp_filter.get_top_products(
            limit=filters.limit,
            sort_by=filters.sort_by or "quantity",
            order=filters.order or "desc"
        )
        return {
            "products": products,
            "total_count": len(products)
        }
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Top products filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/filter/products/least", tags=["Filters"])
def get_least_products(filters: ProductFilters):
    """Get least bought products globally"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        products = data_filter.get_least_products(limit=filters.limit)
        
        return {
            "products": products,
            "total_count": len(products),
            "warning": "Consider removing or bundling these low-performing products"
        }
    
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Least products filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/filter/customer/products", tags=["Filters"])
def get_customer_products(analysis: CustomerProductAnalysis):
    """Get products a specific customer buys most/least"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        result = data_filter.get_customer_top_products(analysis)
        
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        
        return result
    
    except HTTPException:
        raise
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Customer products filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/filter/product/customers", tags=["Filters"])
def get_product_customers(analysis: ProductCustomerAnalysis):
    """Get customers who buy a specific product most"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        result = data_filter.get_product_top_customers(analysis)
        
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        
        return result
    
    except HTTPException:
        raise
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Product customers filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/filter/segment/products", tags=["Filters"])
def get_segment_products(segment: str, limit: int = 10):
    """Get products that a specific segment buys most"""
    if SESSION["df"] is None or SESSION.get("rfm") is None:
        raise handle(NoDataLoadedError())
    
    # Get valid segments from actual data
    if SESSION.get("rfm") is not None:
        valid_segments = SESSION["rfm"]['Segment'].unique().tolist()
    else:
        valid_segments = []
    if segment not in valid_segments:
        raise HTTPException(status_code=400, detail=f"Invalid segment. Must be one of: {valid_segments}")
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION["rfm"])
        products = data_filter.get_segment_top_products(segment, limit)
        
        return {
            "segment": segment,
            "products": products,
            "total_count": len(products)
        }
    
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Segment products filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/filter/combined", tags=["Filters"])
def apply_combined_filters(filters: CombinedFilters):
    """Apply multiple filters and return filtered transactions + summary"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        filtered_df = data_filter.apply_combined_filters(filters)
        
        if filtered_df.empty:
            return {
                "message": "No results found for the given filters",
                "total_transactions": 0,
                "total_customers": 0,
                "total_revenue": 0,
                "top_products": []
            }
        
        # Calculate summary stats
        total_revenue = (filtered_df['Quantity'] * filtered_df['UnitPrice']).sum()
        unique_customers = filtered_df['CustomerID'].nunique()
        unique_products = filtered_df['StockCode'].nunique()
        
        # Get top products from filtered data
        temp_filter = DataFilter(filtered_df, SESSION.get("rfm"))

        # Use user's limit and sort preference if provided, otherwise fall back to sensible defaults
        limit = 50  # default to show more results
        sort_by = "quantity_desc"  # default sort
        order = "desc"

        if filters.product_filters:
            if filters.product_filters.limit:
                limit = filters.product_filters.limit
            if filters.product_filters.sort_by:
                sort_by = filters.product_filters.sort_by
            if getattr(filters.product_filters, "order", None):
                order = filters.product_filters.order  # API supports both combined and separate order

        top_products = temp_filter.get_top_products(
            limit=limit,
            sort_by=sort_by,
            order=order,
        )

        # Build customer list (to show "numbers behind users" for segments/country/customer filters)
        top_customers = []
        try:
            cust_stats = filtered_df.groupby("CustomerID").agg(
                transactions=("InvoiceNo", "nunique"),
                total_quantity=("Quantity", "sum"),
                unique_products=("StockCode", "nunique"),
            )
            # Compute revenue from filtered_df reliably
            revenue_by_customer = (filtered_df["Quantity"] * filtered_df["UnitPrice"]).groupby(filtered_df["CustomerID"]).sum()
            cust_stats["total_revenue"] = revenue_by_customer

            # Best-effort country for customer (most frequent)
            try:
                country_mode = (
                    filtered_df.groupby("CustomerID")["Country"]
                    .agg(lambda x: x.mode().iloc[0] if not x.mode().empty else x.iloc[0])
                )
                cust_stats["country"] = country_mode
            except Exception:
                cust_stats["country"] = None

            cust_stats = cust_stats.reset_index().rename(columns={"CustomerID": "customer_id"})

            # Attach segment if RFM exists
            if SESSION.get("rfm") is not None and "Segment" in SESSION["rfm"].columns:
                seg_map = SESSION["rfm"][["Segment"]].rename(columns={"Segment": "segment"})
                cust_stats = cust_stats.merge(seg_map, left_on="customer_id", right_index=True, how="left")

            # Sort customers by revenue, take a reasonable cap
            cust_stats = cust_stats.sort_values("total_revenue", ascending=False).head(200)
            top_customers = cust_stats.to_dict("records")
        except Exception as exc:
            log.warning(f"Could not build top_customers list: {exc}")
        
        return {
            "total_transactions": len(filtered_df),
            "total_customers": int(unique_customers),
            "total_products": int(unique_products),
            "total_revenue": float(total_revenue),
            "top_products": top_products,
            "top_customers": top_customers,
            "date_range": {
                "from": filtered_df['InvoiceDate'].min().isoformat(),
                "to": filtered_df['InvoiceDate'].max().isoformat()
            }
        }
    
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Combined filter error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/autocomplete/{field}", tags=["Filters"])
def get_autocomplete(field: str, query: str, limit: int = 10):
    """Get autocomplete suggestions for search fields"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    if field not in ["product", "customer", "country"]:
        raise HTTPException(status_code=400, detail="Field must be 'product', 'customer', or 'country'")
    
    try:
        data_filter = DataFilter(SESSION["df"], SESSION.get("rfm"))
        suggestions = data_filter.get_autocomplete_suggestions(query, field, limit)
        
        return {
            "field": field,
            "query": query,
            "suggestions": suggestions
        }
    
    except ShopIQBaseException as exc:
        raise handle(exc)
    except Exception as exc:
        log.error(f"Autocomplete error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/segments/list", tags=["Filters"])
def get_segments():
    """Get list of all segments with counts"""
    if SESSION.get("rfm") is None:
        # Return empty if RFM not computed yet
        return {"segments": []}
    
    try:
        segment_counts = SESSION["rfm"]['Segment'].value_counts().to_dict()
        
        return {
            "segments": [
                {"name": seg, "count": int(count)}
                for seg, count in segment_counts.items()
            ]
        }
    except Exception as exc:
        log.error(f"Segments list error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/countries/list", tags=["Filters"])
def get_countries():
    """Get list of all countries"""
    if SESSION["df"] is None:
        raise handle(NoDataLoadedError())
    
    try:
        countries = SESSION["df"]['Country'].value_counts().to_dict()
        
        return {
            "countries": [
                {"name": country, "count": int(count)}
                for country, count in countries.items()
            ]
        }
    except Exception as exc:
        log.error(f"Countries list error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
