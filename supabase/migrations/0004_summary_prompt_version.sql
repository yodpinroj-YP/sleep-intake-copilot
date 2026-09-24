-- ---------------------------------------------------------------------------
-- 0004 — record which prompt produced each AI summary
--
-- `clinician_summaries.model` already says which model wrote a summary, but a
-- model name alone does not reproduce a result: the same model under different
-- instructions writes a different summary. Once a clinician has approved a
-- draft, that draft is part of the record, and "which instructions produced
-- this?" is a question that has to be answerable months later — when the
-- prompt has been revised twice and nobody remembers what version 1 said.
--
-- Nullable, because every summary written before this column existed has no
-- honest answer. Leaving those rows NULL is correct; back-filling them with a
-- guess would be inventing an audit trail.
--
-- Additive and reversible: no existing column is touched, and nothing that
-- reads this table today needs to change.
-- ---------------------------------------------------------------------------

alter table public.clinician_summaries
  add column if not exists prompt_version text;
