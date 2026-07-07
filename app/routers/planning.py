from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from repositories.planning_repo import (
    create_planned_expense,
    create_wishlist_item,
    delete_planned_expense,
    delete_wishlist_item,
    update_planned_expense,
    update_wishlist_item_full,
    update_wishlist_status,
    get_planning_summary,
    get_budget_month_view,
    get_planned_for_month,
    get_month_close_preview,
    close_budget_month,
    link_account_to_source,
    upsert_monthly_budget,
    upsert_account_profile,
)
from repositories.networth_repo import (
    calculate_current_net_worth,
    save_net_worth_snapshot,
    get_net_worth_history,
    get_net_worth_goals,
    save_net_worth_goal,
    delete_net_worth_goal,
)


planning_router = APIRouter(prefix="/planning", tags=["planning"])


class AccountProfileRequest(BaseModel):
    id: Optional[str] = None
    account_name: str
    account_type: str = "bank"
    asset_class: Optional[str] = None      # 'asset' or 'liability'
    account_subtype: Optional[str] = None  # e.g. 'savings', 'credit_card', 'personal_loan'
    currency: str = "INR"
    institution_name: Optional[str] = None
    source_name: Optional[str] = None
    current_balance: float = 0
    balance_as_of: Optional[date] = None
    is_bank_linked: bool = False
    link_status: Optional[str] = None
    notes: Optional[str] = None


class NetWorthGoalRequest(BaseModel):
    id: Optional[str] = None
    title: str
    target_amount: float = Field(..., gt=0)
    target_date: Optional[date] = None
    notes: Optional[str] = None


class AccountSourceLinkRequest(BaseModel):
    source_name: str


class PlannedExpenseRequest(BaseModel):
    title: str
    amount: float = Field(..., ge=0)
    due_date: date
    frequency: str = "one_time"
    category: Optional[str] = None
    account_id: Optional[str] = None
    status: str = "planned"
    priority: str = "normal"
    notes: Optional[str] = None


class PlannedExpenseUpdateRequest(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = Field(None, ge=0)
    due_date: Optional[date] = None
    frequency: Optional[str] = None
    category: Optional[str] = None
    account_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None


class WishlistItemRequest(BaseModel):
    item_name: str
    expected_amount: float = Field(0, ge=0)
    target_date: Optional[date] = None
    priority: str = "nice_to_have"
    status: str = "wishlist"
    notes: Optional[str] = None


class MonthlyBudgetRequest(BaseModel):
    month_start: Optional[date] = None
    budget_amount: float = Field(0, ge=0)
    expected_income: float = Field(0, ge=0)
    notes: Optional[str] = None


class StartNewMonthRequest(BaseModel):
    target_month_start: Optional[date] = None


class CloseMonthRequest(BaseModel):
    month_start: Optional[date] = None
    force: bool = False
    notes: Optional[str] = None


@planning_router.get("/summary")
def planning_summary(db: Session = Depends(get_db)):
    return {"success": True, "data": get_planning_summary(db)}


@planning_router.get("/month-view")
def budget_month_view(month_start: date, db: Session = Depends(get_db)):
    return {"success": True, "data": get_budget_month_view(db, month_start)}


@planning_router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)):
    from repositories.planning_repo import list_account_profiles
    return {"success": True, "data": list_account_profiles(db)}


@planning_router.delete("/accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    from sqlalchemy import text
    result = db.execute(
        text("UPDATE public.account_profiles SET is_active = FALSE WHERE id = CAST(:id AS uuid) AND is_active = TRUE"),
        {"id": account_id},
    )
    db.commit()
    if result.rowcount == 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Account not found.")
    return {"success": True, "deleted_id": account_id}


@planning_router.post("/accounts")
def save_account(payload: AccountProfileRequest, db: Session = Depends(get_db)):
    return {
        "success": True,
        "message": "Account saved successfully.",
        "data": upsert_account_profile(payload.model_dump(), db),
    }


@planning_router.post("/accounts/{account_id}/link_source")
def link_source(
    account_id: str,
    payload: AccountSourceLinkRequest,
    db: Session = Depends(get_db),
):
    linked = link_account_to_source(account_id, payload.source_name, db)
    if not linked:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Account was not found.",
        }
    return {
        "success": True,
        "message": "Account source linked successfully.",
        "data": linked,
    }


@planning_router.post("/planned_expenses")
def save_planned_expense(
    payload: PlannedExpenseRequest,
    db: Session = Depends(get_db),
):
    return {
        "success": True,
        "message": "Planned expense saved successfully.",
        "data": create_planned_expense(payload.model_dump(), db),
    }


@planning_router.put("/planned_expenses/{item_id}")
def edit_planned_expense(item_id: str, payload: PlannedExpenseUpdateRequest, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    data = update_planned_expense(item_id, payload.model_dump(exclude_unset=True), db)
    if not data:
        raise HTTPException(status_code=404, detail="Planned expense not found.")
    return {"success": True, "message": "Updated.", "data": data}


@planning_router.delete("/planned_expenses/{item_id}")
def remove_planned_expense(item_id: str, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    if not delete_planned_expense(item_id, db):
        raise HTTPException(status_code=404, detail="Planned expense not found.")
    return {"success": True, "deleted_id": item_id}


@planning_router.get("/planned-for-month")
def planned_for_month(month_start: Optional[str] = None, db: Session = Depends(get_db)):
    from repositories.planning_repo import _resolve_active_month
    ms = month_start or _resolve_active_month(db).replace(day=1).isoformat()
    return {"success": True, "data": get_planned_for_month(db, ms)}


@planning_router.post("/wishlist")
def save_wishlist_item(payload: WishlistItemRequest, db: Session = Depends(get_db)):
    return {
        "success": True,
        "message": "Wishlist item saved successfully.",
        "data": create_wishlist_item(payload.model_dump(), db),
    }


@planning_router.put("/wishlist/{item_id}")
def edit_wishlist_item(item_id: str, payload: WishlistItemRequest, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    data = update_wishlist_item_full(item_id, payload.model_dump(exclude_unset=True), db)
    if not data:
        raise HTTPException(status_code=404, detail="Wishlist item not found.")
    return {"success": True, "message": "Updated.", "data": data}


@planning_router.delete("/wishlist/{item_id}")
def remove_wishlist_item(item_id: str, db: Session = Depends(get_db)):
    delete_wishlist_item(item_id, db)
    return {"success": True, "message": "Item removed from wishlist."}


@planning_router.patch("/wishlist/{item_id}/status")
def patch_wishlist_item_status(item_id: str, body: dict = Body(...), db: Session = Depends(get_db)):
    update_wishlist_status(item_id, body.get("status", "wishlist"), db)
    return {"success": True, "message": "Status updated."}


@planning_router.post("/monthly_budget")
def save_monthly_budget(payload: MonthlyBudgetRequest, db: Session = Depends(get_db)):
    return {
        "success": True,
        "message": "Monthly budget saved successfully.",
        "data": upsert_monthly_budget(payload.model_dump(), db),
    }


@planning_router.post("/start-new-month")
def start_new_month(payload: StartNewMonthRequest | None = None, db: Session = Depends(get_db)):
    from repositories.planning_repo import start_new_budget_month
    data = start_new_budget_month(
        db,
        payload.target_month_start if payload else None,
    )
    return {
        "success": True,
        "message": "New budget month started.",
        "data": data,
    }


@planning_router.get("/month-close-preview")
def month_close_preview(month_start: Optional[date] = None, db: Session = Depends(get_db)):
    return {"success": True, "data": get_month_close_preview(db, month_start)}


@planning_router.post("/close-month")
def close_month(payload: CloseMonthRequest | None = None, db: Session = Depends(get_db)):
    result = close_budget_month(
        db,
        payload.month_start if payload else None,
        force=bool(payload.force) if payload else False,
        notes=payload.notes if payload else None,
    )
    if not result.get("success"):
        return result
    return {
        "success": True,
        "message": "Budget month closed.",
        "data": result["data"],
    }


# ---------------------------------------------------------------------------
# Net Worth endpoints
# ---------------------------------------------------------------------------

@planning_router.get("/net-worth")
def get_net_worth(db: Session = Depends(get_db)):
    return {"success": True, "data": calculate_current_net_worth(db)}


@planning_router.post("/net-worth/snapshot")
def take_snapshot(notes: Optional[str] = None, db: Session = Depends(get_db)):
    data = save_net_worth_snapshot(db, notes=notes)
    return {"success": True, "message": "Net worth snapshot saved.", "data": data}


@planning_router.get("/net-worth/history")
def net_worth_history(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 24,
    db: Session = Depends(get_db),
):
    return {"success": True, "data": get_net_worth_history(db, from_date=from_date, to_date=to_date, limit=limit)}


@planning_router.get("/net-worth/goals")
def list_goals(db: Session = Depends(get_db)):
    return {"success": True, "data": get_net_worth_goals(db)}


@planning_router.post("/net-worth/goals")
def create_goal(payload: NetWorthGoalRequest, db: Session = Depends(get_db)):
    return {
        "success": True,
        "message": "Goal saved successfully.",
        "data": save_net_worth_goal(payload.model_dump(), db),
    }


@planning_router.delete("/net-worth/goals/{goal_id}")
def remove_goal(goal_id: str, db: Session = Depends(get_db)):
    deleted = delete_net_worth_goal(goal_id, db)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Goal not found.")
    return {"success": True, "deleted_id": goal_id}


# ---------------------------------------------------------------------------
# Recurring / subscription detector
# ---------------------------------------------------------------------------

@planning_router.get("/recurring-suggestions")
def recurring_suggestions(db: Session = Depends(get_db)):
    """
    Scan the last 6 months of outbound transactions, group by vendor,
    detect repeating patterns, and return suggested recurring expenses.
    Excludes vendors already saved as planned_expenses.
    """
    from sqlalchemy import text
    from datetime import datetime, timedelta
    import statistics

    cutoff = (datetime.today() - timedelta(days=180)).date()

    # Fetch outbound transactions with a vendor name, last 6 months
    rows = db.execute(text("""
        SELECT
            COALESCE(NULLIF(TRIM(vendor_name), ''), NULLIF(TRIM(counterparty_identifier), '')) AS vendor,
            amount,
            transaction_date
        FROM public.transactions
        WHERE direction = 'withdrawal'
          AND transaction_date >= :cutoff
          AND COALESCE(NULLIF(TRIM(vendor_name), ''), NULLIF(TRIM(counterparty_identifier), '')) IS NOT NULL
        ORDER BY vendor, transaction_date
    """), {"cutoff": str(cutoff)}).fetchall()

    # Get already-saved planned expense titles to exclude
    existing = db.execute(text("""
        SELECT LOWER(TRIM(title)) FROM public.planned_expenses WHERE status != 'cancelled'
    """)).fetchall()
    existing_titles = {r[0] for r in existing}

    # Group by vendor
    from collections import defaultdict
    vendor_txns = defaultdict(list)
    for r in rows:
        vendor_txns[r.vendor].append({"amount": float(r.amount), "date": r.transaction_date})

    suggestions = []
    for vendor, txns in vendor_txns.items():
        if len(txns) < 2:
            continue
        if vendor.lower() in existing_titles:
            continue

        txns_sorted = sorted(txns, key=lambda x: x["date"])
        dates = [t["date"] for t in txns_sorted]
        amounts = [t["amount"] for t in txns_sorted]

        # Calculate gaps between consecutive transactions (days)
        gaps = [(dates[i+1] - dates[i]).days for i in range(len(dates) - 1)]
        avg_gap = sum(gaps) / len(gaps)
        gap_std = statistics.stdev(gaps) if len(gaps) > 1 else 0

        # Classify frequency
        if 6 <= avg_gap <= 8 and gap_std < 3:
            frequency = "weekly"
            confidence = "high" if len(txns) >= 4 else "medium"
        elif 25 <= avg_gap <= 35 and gap_std < 6:
            frequency = "monthly"
            confidence = "high" if len(txns) >= 3 else "medium"
        elif 85 <= avg_gap <= 100 and gap_std < 10:
            frequency = "quarterly"
            confidence = "medium"
        elif 340 <= avg_gap <= 390:
            frequency = "yearly"
            confidence = "medium" if len(txns) >= 2 else "low"
        else:
            continue  # No clear pattern

        # Use median amount (robust to outliers)
        median_amount = sorted(amounts)[len(amounts) // 2]

        # Estimate next expected date
        last_date = dates[-1]
        gap_days = {"weekly": 7, "monthly": 30, "quarterly": 91, "yearly": 365}[frequency]
        from datetime import timedelta as td
        next_date = last_date + td(days=gap_days)

        # Amount consistency check — flag if amounts vary significantly
        amount_cv = (statistics.stdev(amounts) / median_amount) if len(amounts) > 1 and median_amount > 0 else 0
        amount_consistent = amount_cv < 0.15  # <15% variation = consistent

        suggestions.append({
            "vendor": vendor,
            "amount": round(median_amount, 2),
            "frequency": frequency,
            "confidence": confidence,
            "occurrences": len(txns),
            "last_seen": str(last_date),
            "next_expected": str(next_date),
            "amount_consistent": amount_consistent,
            "sample_amounts": sorted(set(round(a, 0) for a in amounts))[:4],
        })

    # Sort: high confidence first, then by occurrences desc
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    suggestions.sort(key=lambda x: (confidence_order[x["confidence"]], -x["occurrences"]))

    return {"success": True, "data": suggestions}


# ---------------------------------------------------------------------------
# Category budget endpoints
# ---------------------------------------------------------------------------

class CategoryBudgetRequest(BaseModel):
    month_start: date
    tag_name: str
    parent_name: Optional[str] = None
    budget_amount: float = Field(..., ge=0)


class SharedJoyBudgetRequest(BaseModel):
    month_start: Optional[date] = None
    goal_amount: float = Field(0, ge=0)
    reward_note: Optional[str] = None


@planning_router.get("/period-stats")
def get_period_stats(period: str = "this_month", db: Session = Depends(get_db)):
    from repositories.planning_repo import get_aggregate_period_stats
    return {"success": True, "data": get_aggregate_period_stats(db, period)}


@planning_router.get("/tags")
def list_tags(tag_type: Optional[str] = None, used_only: bool = False, db: Session = Depends(get_db)):
    from sqlalchemy import text
    # Primary source: user-defined categories/subcategories (hierarchical manager)
    # Fallback: system_tags for tags applied directly on transactions (not in manager)
    rows = db.execute(text("""
        SELECT id::text AS id, name, 'CATEGORY' AS tag_type, NULL AS parent_id
        FROM public.categories
        WHERE is_active = TRUE
          AND name NOT LIKE 'TestCategory_%%'

        UNION

        SELECT id, name, tag_type, parent_id FROM (
            SELECT DISTINCT ON (LOWER(s.name))
                s.id::text AS id, s.name, 'SUBCATEGORY' AS tag_type, s.category_id::text AS parent_id
            FROM public.subcategories s
            WHERE s.is_active = TRUE
            ORDER BY LOWER(s.name), s.created_at ASC
        ) sub_deduped

        UNION

        SELECT st.id::text AS id, st.name, st.tag_type, NULL AS parent_id
        FROM public.system_tags st
        WHERE st.is_active = TRUE
          AND st.name NOT LIKE 'TestCategory_%%'
          AND NOT EXISTS (
              SELECT 1 FROM public.categories c WHERE LOWER(c.name) = LOWER(st.name) AND c.is_active = TRUE
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.subcategories sc WHERE LOWER(sc.name) = LOWER(st.name) AND sc.is_active = TRUE
          )
          AND (
              NOT :used_only
              OR EXISTS (SELECT 1 FROM public.transaction_tags tt WHERE tt.tag_id = st.id)
          )

        ORDER BY name ASC
    """), {"used_only": used_only}).mappings().all()
    return {"success": True, "data": [dict(r) for r in rows]}


@planning_router.get("/category-budgets")
def list_category_budgets(
    month_start: Optional[str] = None,
    include_inactive_history: bool = False,
    db: Session = Depends(get_db),
):
    from repositories.planning_repo import get_category_budgets, _resolve_active_month
    ms = month_start or _resolve_active_month(db).replace(day=1).isoformat()
    return {
        "success": True,
        "data": get_category_budgets(
            db,
            ms,
            include_inactive_history=include_inactive_history,
        ),
    }


@planning_router.get("/category-budgets/history")
def budget_history(months: int = 3, db: Session = Depends(get_db)):
    """Return budget vs actual for the last N months."""
    from repositories.planning_repo import get_category_budgets, _resolve_active_month
    from dateutil.relativedelta import relativedelta
    active = _resolve_active_month(db).replace(day=1)
    result = []
    for i in range(months - 1, -1, -1):
        ms = (active - relativedelta(months=i)).isoformat()
        data = get_category_budgets(db, ms, include_unbudgeted=True, include_inactive_history=True)
        result.append({"month_start": ms, "items": data["items"], "total_allocated": data["total_allocated"]})
    return {"success": True, "data": result}


@planning_router.post("/category-budgets")
def save_category_budget(payload: CategoryBudgetRequest, db: Session = Depends(get_db)):
    from repositories.planning_repo import upsert_category_budget
    result = upsert_category_budget(db, payload.model_dump())
    return result


@planning_router.delete("/category-budgets/{budget_id}")
def remove_category_budget(budget_id: str, db: Session = Depends(get_db)):
    from repositories.planning_repo import delete_category_budget
    deleted = delete_category_budget(db, budget_id)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Category budget not found.")
    return {"success": True, "deleted_id": budget_id}


# ---------------------------------------------------------------------------
# Shared Joy budget endpoints
# ---------------------------------------------------------------------------

@planning_router.get("/shared-joy-budget")
def get_shared_joy_budget_endpoint(month_start: Optional[str] = None, db: Session = Depends(get_db)):
    from repositories.planning_repo import get_shared_joy_monthly_summary, _resolve_active_month
    ms = month_start or _resolve_active_month(db).replace(day=1).isoformat()
    return {"success": True, "data": get_shared_joy_monthly_summary(db, ms)}


@planning_router.get("/shared-joy-year")
def get_shared_joy_year_endpoint(year: Optional[int] = None, db: Session = Depends(get_db)):
    from repositories.planning_repo import get_shared_joy_yearly_summary
    from datetime import date as _date
    yr = int(year) if year else _date.today().year
    return {"success": True, "data": get_shared_joy_yearly_summary(db, yr)}


@planning_router.post("/shared-joy-budget")
def save_shared_joy_budget(payload: SharedJoyBudgetRequest, db: Session = Depends(get_db)):
    from repositories.planning_repo import upsert_shared_joy_budget, get_shared_joy_monthly_summary, _resolve_active_month
    result = upsert_shared_joy_budget(db, payload.model_dump())
    ms = result.get("month_start")
    ms_str = ms.isoformat() if hasattr(ms, "isoformat") else str(ms)
    return {"success": True, "message": "Shared Joy goal saved.", "data": get_shared_joy_monthly_summary(db, ms_str)}
