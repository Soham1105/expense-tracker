from datetime import date, time, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class TransactionResponse(BaseModel):
    id: UUID
    transaction_date: date
    direction: str
    amount: Decimal
    running_balance: Optional[Decimal] = None

    counterparty_identifier: Optional[str] = None
    counterparty_entity_name: Optional[str] = None
    counterparty_entity_type: Optional[str] = None
    counterparty_type: Optional[str] = None

    payment_source_name: Optional[str] = None
    payment_mode: Optional[str] = None
    statement_sources: Optional[str] = None

    transaction_time: Optional[time] = None
    narration: Optional[str] = None
    vendor_name: Optional[str] = None

    primary_flow_type: Optional[str] = None
    consumption_ownership: Optional[str] = None
    settlement_state: Optional[str] = None

    review_status: Optional[str] = None
    review_status_manual: bool = False
    no_tag_required: bool = False
    no_split_required: bool = False

    class Config:
        from_attributes = True


class TransactionUpdateRequest(BaseModel):
    vendor_name: Optional[str] = None
    narration: Optional[str] = None
    review_status: Optional[str] = None
    no_tag_required: Optional[bool] = None
    no_split_required: Optional[bool] = None
    primary_flow_type: Optional[str] = None
    counterparty_type: Optional[str] = None
    consumption_ownership: Optional[str] = None
    settlement_state: Optional[str] = None
