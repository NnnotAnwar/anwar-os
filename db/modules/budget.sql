-- Budget: subscriptions. Apply after the migration that adds
-- budget_recurring.subscription (boolean, default false). The column is
-- covered by budget_recurring's existing policies and grants (0019).
--
-- One-time backfill: recurring expenses filed under a category called
-- "Subscriptions" (the default one, or a subcategory of it) are subscriptions.
-- Runs as the migrator, so it reaches every owner's rows.
update public.budget_recurring r
set subscription = true
from public.budget_categories c
left join public.budget_categories parent on parent.id = c.parent_id
where c.id = r.category_id
  and r.amount_minor < 0
  and (lower(c.name) = 'subscriptions' or lower(parent.name) = 'subscriptions');
