-- ============================================================================
-- Synthetic development data ("Use synthetic data during development").
--
-- Run against a LOCAL Supabase instance only:
--   supabase start
--   supabase db reset   (applies migrations, then this seed file)
--
-- Never run this against a production project — it inserts a fake auth
-- user directly into auth.users, which is only safe on a local/dev stack.
-- ============================================================================

insert into auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'demo@example.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Demo User"}',
  'authenticated',
  'authenticated',
  now(),
  now()
)
on conflict (id) do nothing;

-- profiles row is created automatically by the on_auth_user_created
-- trigger, but upsert here too in case the seed is re-run out of order.
insert into public.profiles (id, full_name)
values ('00000000-0000-0000-0000-000000000001', 'Demo User')
on conflict (id) do nothing;

insert into public.ai_outputs (user_id, prompt, response, model, status)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'Summarize our Q1 support tickets.',
    'Synthetic sample response: ticket volume rose 12% quarter over quarter, driven mostly by billing questions.',
    'synthetic-model-for-dev',
    'pending_review'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'Draft a welcome email for new signups.',
    'Synthetic sample response: "Welcome aboard! Here''s how to get started..."',
    'synthetic-model-for-dev',
    'approved'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'Suggest a refund for this customer.',
    'Synthetic sample response: recommend a full refund per policy §4.2.',
    'synthetic-model-for-dev',
    'rejected'
  )
on conflict do nothing;
