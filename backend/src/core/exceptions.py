"""
exceptions.py — Custom exception classes for ShopIQ
Each exception carries a clear, actionable message.
"""
class ShopIQBaseException(Exception):
    """Base class for all ShopIQ exceptions."""
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


#Data Layer
class InvalidFileTypeError(ShopIQBaseException):
    """Raised when uploaded file is not a CSV."""
    def __init__(self, filename: str):
        super().__init__(f"Invalid file type '{filename}'. Only .csv files are accepted.")


class EmptyFileError(ShopIQBaseException):
    """Raised when uploaded file has 0 bytes."""
    def __init__(self, filename: str = ""):
        super().__init__(f"Uploaded file '{filename}' is empty (0 bytes). Please upload a valid CSV.")


class CSVNotFoundError(ShopIQBaseException):
    """Raised when saved CSV path cannot be found."""
    def __init__(self, path: str):
        super().__init__(f"CSV file not found at path: '{path}'. Ensure the file was uploaded correctly.")


class MissingColumnsError(ShopIQBaseException):
    """Raised when required columns are absent in the CSV."""
    def __init__(self, missing: list, found: list):
        self.missing = missing
        self.found = found
        super().__init__(
            f"CSV is missing required columns: {sorted(missing)}. "
            f"Columns found: {sorted(found)}"
        )


class EncodingError(ShopIQBaseException):
    """Raised when CSV cannot be decoded with given encoding."""
    def __init__(self, encoding: str, detail: str):
        super().__init__(f"Cannot read file with encoding='{encoding}'. Try 'utf-8' or 'latin-1'. Detail: {detail}")


class ParseError(ShopIQBaseException):
    """Raised when CSV structure is malformed."""
    def __init__(self, detail: str):
        super().__init__(f"CSV parse error — ensure valid comma-separated format. Detail: {detail}")


class AllRowsRemovedError(ShopIQBaseException):
    """Raised when all rows are filtered out during cleaning."""
    def __init__(self, original_count: int):
        super().__init__(
            f"All {original_count} rows were removed during cleaning. "
            "Common causes: every row had null CustomerID, was a cancellation "
            "(InvoiceNo starts with C), or had Quantity/UnitPrice <= 0. "
            "Please check your dataset format."
        )


# ── Analytics Layer ───────────────────────────────────────────────────────────
class NoDataLoadedError(ShopIQBaseException):
    """Raised when an analysis endpoint is called before uploading data."""
    def __init__(self):
        super().__init__(
            "No data loaded. Please upload a CSV file first via POST /api/upload."
        )


class InvalidParameterError(ShopIQBaseException):
    """Raised when analysis parameters are out of valid range."""
    def __init__(self, param: str, value: float, min_val: float, max_val: float):
        super().__init__(
            f"Parameter '{param}' has invalid value {value}. "
            f"Valid range is [{min_val}, {max_val}]."
        )


class NoFrequentItemsetsError(ShopIQBaseException):
    """Raised when FP-Growth finds no frequent itemsets."""
    def __init__(self, support: float):
        super().__init__(
            f"No frequent itemsets found with min_support={support}. "
            "Try lowering min_support (e.g. 0.01) or use a larger dataset."
        )


class NoRulesFoundError(ShopIQBaseException):
    """Raised when itemsets exist but no rules pass thresholds."""
    def __init__(self, confidence: float, lift: float):
        super().__init__(
            f"No rules passed confidence={confidence} and lift={lift}. "
            "Try lowering these thresholds."
        )


class RulesNotComputedError(ShopIQBaseException):
    """Raised when recommendations are requested before running basket."""
    def __init__(self):
        super().__init__(
            "Association rules not computed yet. "
            "Run POST /api/basket before requesting recommendations."
        )


class ProductNotFoundError(ShopIQBaseException):
    """Raised when no rules exist for the requested product."""
    def __init__(self, product: str):
        super().__init__(
            f"No recommendations found for product: '{product}'. "
            "Try lowering basket thresholds or verify the product name."
        )


class InsufficientCustomersError(ShopIQBaseException):
    """Raised when fewer customers exist than requested clusters."""
    def __init__(self, n_customers: int, n_clusters: int):
        super().__init__(
            f"Only {n_customers} unique customers found but n_clusters={n_clusters}. "
            "Reduce the number of clusters or use a larger dataset."
        )


class ClusteringError(ShopIQBaseException):
    """Raised when KMeans clustering fails."""
    def __init__(self, detail: str):
        super().__init__(f"KMeans clustering failed: {detail}")


class FPGrowthError(ShopIQBaseException):
    """Raised when FP-Growth algorithm itself fails."""
    def __init__(self, detail: str):
        super().__init__(f"FP-Growth algorithm failed: {detail}")