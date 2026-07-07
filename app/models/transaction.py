import uuid
from sqlalchemy import (
    Column, Date, Numeric, Boolean, Text, Time, DateTime
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from models.base import Base


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = {"schema": "public"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_date = Column(Date, nullable=False)
    direction = Column(Text, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    running_balance = Column(Numeric(14, 2), nullable=True)

    counterparty_identifier = Column(Text, nullable=True)
    counterparty_entity_name = Column(Text, nullable=True)
    counterparty_entity_type = Column(Text, nullable=True)
    counterparty_type = Column(Text, nullable=True)

    payment_source_name = Column(Text, nullable=True)
    payment_mode = Column(Text, nullable=True)
    statement_sources = Column(Text, nullable=True)

    transaction_time = Column(Time, nullable=True)
    narration = Column(Text, nullable=True)
    vendor_name = Column(Text, nullable=True)

    primary_flow_type = Column(Text, nullable=True)
    consumption_ownership = Column(Text, nullable=True)
    settlement_state = Column(Text, nullable=True)

    review_status = Column(Text, nullable=True)
    review_status_manual = Column(Boolean, nullable=False, default=False)
    no_tag_required = Column(Boolean, nullable=False, default=False)
    no_split_required = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
