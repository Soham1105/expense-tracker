class AppError(Exception):
    error_code = "APP_ERROR"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

class ValidationError(AppError):
    error_code = "VALIDATION_ERROR"

class ParsingError(AppError):
    error_code = "PARSING_ERROR"

class FileProcessingError(AppError):
    error_code = "FILE_PROCESSING_ERROR"
