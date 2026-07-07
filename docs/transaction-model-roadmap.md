# Transaction Model Roadmap

## Purpose

This document defines the next transaction-model changes before we implement more features.

The goal is to make the product reliable for:

- past money-flow review
- present balance and budget tracking
- future planning and goal alignment
- split spending and recoveries
- investments and personal net position

This is needed because the current system mixes several meanings into a small set of fields and tags.


## Current Problems

Today the app already supports:

- simple classification
- split by item
- split by person
- custom tags
- special self-transfer handling

But the same transaction meaning is currently spread across:

- category and subcategory
- simple bucket
- transaction nature
- party type
- custom tags
- split rows and linked recoveries

That causes ambiguity such as:

- `merchant` can mean counterparty identity, but not ownership
- `family` can mean relation, ownership, or a user tag
- `investment` can be a user tag, but it is also a money-flow meaning
- `friend` can mean counterparty, split target, or open receivable
- a refund is currently a linked transaction, but there is no unified meaning model around it


## Product Goal

The product should help the user understand:

- how much money is in each account
- where spending goes
- which spending is truly theirs vs family/shared/recoverable
- whether current spending aligns with monthly limits
- whether future goals align with current behavior
- what needs review, correction, or tighter control
- what the user's broader money position looks like, including investments and open obligations


## Design Principle

One transaction should not carry all meaning in one field.

We should separate:

1. what the money was for
2. who the counterparty is
3. who actually consumed the money
4. whether the amount is final or still recoverable/payable
5. how the user wants to label or search it later


## What We Are Adding

We will introduce a structured transaction-meaning model with independent dimensions.

### 1. Counterparty Type

This answers: who is on the other side?

Suggested values:

- `merchant`
- `friend`
- `family`
- `employer`
- `bank`
- `government`
- `unknown`

### 2. Primary Flow Type

This answers: what kind of money movement is this?

Suggested values:

- `expense`
- `income`
- `transfer`
- `refund`
- `investment_buy`
- `investment_sell`
- `loan_given`
- `loan_taken`
- `repayment_in`
- `repayment_out`
- `fee`

Important rule:

- one transaction gets one primary flow type
- linked transactions may represent related effects, such as partial refunds or repayments

### 3. Consumption Ownership

This answers: who actually consumed or benefited from this money?

Suggested values:

- `self`
- `family_household`
- `shared`
- `business`
- `other`
- `not_consumption`

### 4. Settlement / Obligation State

This answers: is the amount final, recoverable, or payable?

Suggested values:

- `none`
- `owed_to_me`
- `i_owe`
- `partial`
- `settled`

### 5. Linked Financial Relationships

These are not plain tags. They are explicit links.

Examples:

- refund linked to original expense
- self-transfer debit linked to self-transfer credit
- repayment linked to open obligation
- investment sell linked to investment holding

### 6. Optional Obligation Records

Open receivables and payables should be modeled separately from the transaction row.

Suggested obligation fields:

- `direction`: `owed_to_me` or `i_owe`
- `entity_name`
- `origin_transaction_id`
- `total_amount`
- `settled_amount`
- `open_amount`
- `status`


## What We Are Removing Or Deprecating

We do not need to delete old data immediately, but we should stop treating these as core meaning fields.

### 1. Simple Bucket As Primary Meaning

Current options like:

- `merchant`
- `friend`
- `family`
- `income`
- `employer`
- `unknown`

mix identity and money movement in one place.

Plan:

- deprecate `simple bucket` as the main model
- replace it with structured fields
- keep `self transfer` as a protected special case

### 2. Tags As Financial Logic

Current user tags may include:

- `investment`
- `family`
- `friend`
- `food`
- a person's name

Plan:

- keep tags for user grouping and search
- stop using tags as the main financial-meaning engine
- structured fields should drive reports, budgets, and goals


## What Tags Should Mean

Tags should remain flexible user labels.

Examples:

- `food`
- `shopping`
- `swiggy`
- `trip`
- `medical`
- `mom`
- `rahul`
- `birthday`

Tags answer:

- how the user wants to group or remember something

Tags should not be the only source of truth for:

- whether something is an investment
- whether someone owes the user money
- whether a transaction is household spend


## What Categories Should Mean

Categories and subcategories answer:

- what the money was spent on or received for

Examples:

- groceries
- rent
- transport
- salary
- subscriptions

Categories should stay separate from:

- counterparty type
- ownership
- settlement


## How This Fits Existing Workflows

### Simple Classification

Simple mode should remain the fastest path.

User should typically set:

- display name
- category / subcategory
- optionally structured fields if needed
- optional tags

System should infer as much as possible.

### Split By Item

This is best for mixed baskets.

Each row should eventually support:

- item name
- category
- ownership
- optional settlement state
- optional linked recovery

### Split By Person

This is best for shared bills and reimbursements.

Each row should represent:

- your share
- friend share
- family share
- other share

Then obligations and repayments can be handled cleanly.

### Self Transfer

This should remain a protected special flow.

Rules:

- keep current matching behavior
- do not merge this into generic ownership or generic counterparty logic
- mark both sides as transfer between own accounts


## Safe Rules For Money Accuracy

To avoid financial mistakes:

- one transaction should have one primary flow type
- refunds should be separate linked transactions, not mixed into the original row
- obligations should be separate records, not only tags
- transfers should only mean movement between the user's own balances
- investment value should be tracked separately from liquid spendable money


## Reporting Views We Need Later

The model should support at least 3 views:

### 1. Cash Flow View

Shows all money in and out.

### 2. Consumption View

Shows real final spend split by:

- self
- family / household
- shared
- recoverable / not final

### 3. Net Position View

Shows:

- liquid money
- investments
- receivables
- payables


## Migration Strategy

We should not break current data or current user tagging.

Suggested approach:

1. keep current tags and current simple flow working
2. introduce structured fields in parallel
3. map current values into new fields where possible
4. let reports prefer structured fields first
5. treat tags as fallback labels, not primary finance logic

Examples:

- tag `investment` can suggest `primary_flow_type = investment_buy` if not yet set
- tag `family` can suggest `ownership = family_household`
- person-name tags should stay as tags unless the user explicitly marks relationship type


## What This Will Help

This model will directly help:

- monthly budget tracking
- wishlist and affordability planning
- goals vs current consumption
- family vs personal spending separation
- refund handling
- payback and receivable tracking
- future investment and net-worth pages
- better review prioritization


## Recommended Next Implementation Order

1. define and store structured transaction meaning fields
2. keep self-transfer logic intact
3. update simple, item, and person flows to write the new fields
4. keep tags as optional labels only
5. build obligation tracking
6. build richer budget and goal views on top of the new model
7. add investment summaries using separate investment flow logic


## Short Definition For The Product

Use this as the working product rule:

- categories tell us what money was for
- structured fields tell us what the transaction means
- tags tell us how the user wants to remember or group it

