-- ---------------------------------------------------------------------------
-- 0006 — add 'nurse' and 'physician' to the role enum
--
-- THIS FILE DOES NOTHING ELSE, AND THAT IS THE POINT.
-- PostgreSQL refuses to use an enum value inside the same transaction that
-- added it ("unsafe use of new value of enum type"). The helper function and
-- the policies that name these roles therefore live in 0007, which must be
-- run as a separate statement after this one has committed.
--
-- Enum values can be added but never removed. Renaming one later means
-- creating a new type and migrating every column that uses it, so these two
-- words are permanent as of this migration. They were chosen deliberately:
-- 'physician' rather than 'doctor' because 'doctor' is ambiguous about
-- whether it means a medical qualification or a doctorate.
--
-- 'clinician' stays in the enum as a legacy value. Nothing new should be
-- written with it; 0007 converts the rows that already hold it. It cannot be
-- deleted, so it is documented instead.
-- ---------------------------------------------------------------------------

alter type public.user_role add value if not exists 'nurse';
alter type public.user_role add value if not exists 'physician';
