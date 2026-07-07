import uuid
from sqlalchemy import (
    Column, Text, Date, Numeric, Boolean, BigInteger, Integer,
    ForeignKey, DateTime
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from models.base import Base

class SystemTag(Base):
    __tablename__ = "system_tags"
    __table_args__ = {"schema": "public"}

    id = Column(BigInteger, primary_key=True)
    tag_type = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    normalized = Column(Text, nullable=False)
    parent_id = Column(BigInteger, ForeignKey("public.system_tags.id"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    parent = relationship("SystemTag", remote_side=[id])


class TransactionTag(Base):
    __tablename__ = "transaction_tags"
    __table_args__ = {"schema": "public"}

    transaction_id = Column(UUID(as_uuid=True), ForeignKey("public.transactions.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(BigInteger, ForeignKey("public.system_tags.id", ondelete="RESTRICT"), primary_key=True)

    applied_by = Column(Text, nullable=True)  # AUTO/MANUAL
    applied_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)


class TransactionTagSuggestion(Base):
    __tablename__ = "transaction_tag_suggestions"
    __table_args__ = {"schema": "public"}

    id = Column(BigInteger, primary_key=True)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("public.transactions.id", ondelete="CASCADE"), nullable=False)
    tag_id = Column(BigInteger, ForeignKey("public.system_tags.id", ondelete="RESTRICT"), nullable=False)

    confidence = Column(Numeric(4, 3), nullable=False)
    confidence_source = Column(Text, nullable=False)  # HEURISTIC/HISTORY/USER_CONFIRMED
    reason = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="PENDING")  # PENDING/ACCEPTED/REJECTED

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class TagRule(Base):
    __tablename__ = "tag_rules"
    __table_args__ = {"schema": "public"}

    id = Column(BigInteger, primary_key=True)

    scope_key = Column(Text, nullable=False)  # payment_source_name for now
    tag_id = Column(BigInteger, ForeignKey("public.system_tags.id", ondelete="RESTRICT"), nullable=False)

    match_field = Column(Text, nullable=False)  # counterparty_identifier/narration/payment_mode
    match_type = Column(Text, nullable=False)   # EXACT/CONTAINS/REGEX
    match_value = Column(Text, nullable=False)

    confidence_source = Column(Text, nullable=False)
    base_confidence = Column(Numeric(4, 3), nullable=False)

    priority = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
