# app/core/error_handler.py
import functools
import inspect
import logging

logger = logging.getLogger("app")


def _error_response(exc: Exception) -> dict:
    """Convert an exception to a standard error dict.
    Known AppErrors surface their message; everything else is generic."""
    from core.exceptions import AppError
    if isinstance(exc, AppError):
        return {
            "success": False,
            "error_code": exc.error_code,
            "message": str(exc.message),
        }
    import traceback
    logger.error("Internal error in safe_execute:\n%s", traceback.format_exc())
    return {
        "success": False,
        "error_code": "INTERNAL_ERROR",
        "message": "Something went wrong processing the file. Check server logs for details.",
    }


def safe_execute(func):
    if inspect.iscoroutinefunction(func):
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as exc:
                return _error_response(exc)
        return async_wrapper
    else:
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                return _error_response(exc)
        return sync_wrapper
