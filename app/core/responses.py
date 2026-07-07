def failure_response(
    message: str,
    error_code: str = "INTERNAL_ERROR",
    details: dict | None = None
):
    return {
        "success": False,
        "error": {
            "code": error_code,
            "message": message,
            "details": details or {}
        }
    }
