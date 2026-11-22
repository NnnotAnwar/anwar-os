-- 0002_expense_notes: optional free-text note per expense ("250 coffee" -> note "coffee").
-- Nullable, so existing rows, the stats views and the SQLite importer are unaffected.
alter table bot_expenses.expenses
  add column note text check (note is null or length(note) between 1 and 200);

-- Lets the bot remember which category a repeated note belongs to.
create index expenses_user_note_idx on bot_expenses.expenses (telegram_user_id, lower(note))
  where note is not null;
