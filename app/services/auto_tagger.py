from repositories.transaction_tagger import apply_rule_based_tags, tag_transactions


def auto_tagging_transactions(db):
    apply_rule_based_tags(db)
    tag_transactions(db)
