from typing import Optional
from pydantic import BaseModel


class SystemTagResponse(BaseModel):
    id: int
    tag_type: str
    name: str
    normalized: str
    parent_id: Optional[int] = None
    is_active: bool

    class Config:
        from_attributes = True


class TransactionTagResponse(BaseModel):
    transaction_id: str
    tag_id: int
    applied_by: Optional[str] = None
    tag_name: Optional[str] = None
    tag_type: Optional[str] = None

    class Config:
        from_attributes = True
