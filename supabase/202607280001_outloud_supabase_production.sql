create extension if not exists pgcrypto;

do $$
begin
  create type public.moment_ledger_state as enum (
    'needed_full_help',
    'needed_hint',
    'answered_on_own',
    'used_new_situation',
    'confirmed_real_life'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.sessions (
  id uuid primary key,
  anonymous_identifier text not null,
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  device_json jsonb
);

create table if not exists public.person_profiles (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  relationship text not null,
  region text not null,
  default_tone text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_subscriptions (
  id uuid primary key,
  email text not null,
  verification_token_hash text,
  verified_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.moments (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete set null,
  person_profile_id uuid references public.person_profiles(id) on delete set null,
  email_subscription_id uuid references public.email_subscriptions(id) on delete set null,
  created_at timestamptz not null default now(),
  email text not null,
  original_text text not null,
  entry_mode text not null check (entry_mode in ('wanted_to_say', 'received_spanish')),
  context_json jsonb not null default '{}'::jsonb,
  self_reported_blocker text check (
    self_reported_blocker is null or self_reported_blocker in (
      'words_to_sentences',
      'freeze_under_pressure',
      'missing_words',
      'pronunciation_nerves',
      'sounds_unnatural',
      'grammar_falls_apart',
      'follow_ups_break_me',
      'not_sure'
    )
  ),
  self_reported_blockers_json jsonb,
  teaching_policy_json jsonb,
  intervention_outcomes_json jsonb,
  personal_teaching_model_json jsonb,
  first_attempt text not null,
  first_attempt_transcript_edited boolean not null default false,
  retry_attempt text not null,
  rebuild_evaluation_json jsonb,
  transfer_prompt_json jsonb,
  transfer_attempt text,
  transfer_evaluation_json jsonb,
  conversation_turns_json jsonb,
  focus_gap_json jsonb,
  attempt_voice_json jsonb,
  retry_voice_json jsonb,
  rescue_json jsonb not null,
  ledger_state public.moment_ledger_state not null default 'needed_full_help',
  retrieval_due_at timestamptz not null,
  retrieval_claimed_at timestamptz,
  retrieval_sent_at timestamptz,
  retrieval_status text check (
    retrieval_status is null or retrieval_status in (
      'claimed',
      'sent',
      'skipped_duplicate',
      'variation_failed',
      'failed',
      'not_configured'
    )
  ),
  retrieval_attempt_count integer not null default 0,
  retrieval_last_error text,
  review_opened_at timestamptz,
  deleted_at timestamptz,
  deep_link_moment_id uuid
);

create table if not exists public.moment_access_tokens (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  attempt_number integer not null check (attempt_number in (1, 2)),
  transcript text not null,
  transcript_edited boolean not null default false,
  assistance_level text,
  meaning_result text,
  created_at timestamptz not null default now(),
  unique (moment_id, attempt_number)
);

create table if not exists public.retrieval_deliveries (
  id uuid primary key,
  moment_id uuid not null references public.moments(id) on delete cascade,
  review_stage text not null,
  due_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  status text not null check (
    status in (
      'claimed',
      'sent',
      'variation_failed',
      'failed',
      'not_configured'
    )
  ),
  attempt_count integer not null default 0,
  idempotency_key text not null,
  last_error text
);

create table if not exists public.retrieval_variations (
  id uuid primary key,
  moment_id uuid not null references public.moments(id) on delete cascade,
  review_stage text not null,
  variation_json jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  result_json jsonb
);

create table if not exists public.feedback (
  id uuid primary key,
  created_at timestamptz not null default now(),
  route_path text not null,
  step text not null,
  rating text not null,
  problem text,
  expected text,
  email text,
  permission_to_include_example boolean not null default false,
  content_json jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  email_status text not null default 'not_configured',
  email_error text
);

create table if not exists public.analytics_events (
  id uuid primary key,
  created_at timestamptz not null default now(),
  session_id uuid,
  event_name text not null,
  route_path text not null,
  step text,
  device_class text,
  duration_ms integer,
  error_category text,
  model text,
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists sessions_email_idx on public.sessions (email);
create unique index if not exists email_subscriptions_email_idx on public.email_subscriptions (email);
create index if not exists email_subscriptions_verified_idx on public.email_subscriptions (verified_at, unsubscribed_at);
create index if not exists person_profiles_session_idx on public.person_profiles (session_id);
create index if not exists moments_email_created_at_idx on public.moments (email, created_at);
create index if not exists moments_retrieval_due_idx on public.moments (retrieval_due_at, retrieval_sent_at);
create index if not exists moments_session_created_at_idx on public.moments (session_id, created_at);
create unique index if not exists moment_access_tokens_hash_idx on public.moment_access_tokens (token_hash);
create index if not exists moment_access_tokens_moment_id_idx on public.moment_access_tokens (moment_id);
create index if not exists attempts_moment_idx on public.attempts (moment_id, attempt_number);
create unique index if not exists retrieval_deliveries_idempotency_idx on public.retrieval_deliveries (idempotency_key);
create index if not exists retrieval_deliveries_due_idx on public.retrieval_deliveries (due_at, status);
create index if not exists retrieval_deliveries_moment_idx on public.retrieval_deliveries (moment_id);
create index if not exists retrieval_variations_moment_stage_idx on public.retrieval_variations (moment_id, review_stage, created_at);
create index if not exists feedback_created_at_idx on public.feedback (created_at);
create index if not exists feedback_route_path_idx on public.feedback (route_path);
create index if not exists analytics_created_at_idx on public.analytics_events (created_at);
create index if not exists analytics_event_name_idx on public.analytics_events (event_name);
create index if not exists analytics_session_idx on public.analytics_events (session_id);

alter table public.sessions enable row level security;
alter table public.person_profiles enable row level security;
alter table public.email_subscriptions enable row level security;
alter table public.moments enable row level security;
alter table public.moment_access_tokens enable row level security;
alter table public.attempts enable row level security;
alter table public.retrieval_deliveries enable row level security;
alter table public.retrieval_variations enable row level security;
alter table public.feedback enable row level security;
alter table public.analytics_events enable row level security;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

create or replace function public.claim_due_moment(
  p_moment_id uuid,
  p_claimed_at timestamptz,
  p_stale_claim_cutoff timestamptz
)
returns table (id uuid)
language sql
security invoker
as $$
  update public.moments
  set
    retrieval_claimed_at = p_claimed_at,
    retrieval_status = 'claimed',
    retrieval_attempt_count = retrieval_attempt_count + 1,
    retrieval_last_error = null
  where moments.id = p_moment_id
    and moments.retrieval_sent_at is null
    and moments.deleted_at is null
    and (
      moments.retrieval_claimed_at is null
      or moments.retrieval_claimed_at <= p_stale_claim_cutoff
    )
  returning moments.id;
$$;

create or replace function public.claim_retrieval_delivery(
  p_id uuid,
  p_moment_id uuid,
  p_review_stage text,
  p_due_at timestamptz,
  p_claimed_at timestamptz,
  p_idempotency_key text,
  p_stale_claim_cutoff timestamptz
)
returns table (status text, idempotency_key text, sent_at timestamptz)
language plpgsql
security invoker
as $$
declare
  inserted_id uuid;
begin
  insert into public.retrieval_deliveries (
    id,
    moment_id,
    review_stage,
    due_at,
    claimed_at,
    sent_at,
    status,
    attempt_count,
    idempotency_key,
    last_error
  )
  values (
    p_id,
    p_moment_id,
    p_review_stage,
    p_due_at,
    p_claimed_at,
    null,
    'claimed',
    1,
    p_idempotency_key,
    null
  )
  on conflict (idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select 'claimed'::text, p_idempotency_key, null::timestamptz;
    return;
  end if;

  return query
  update public.retrieval_deliveries
  set
    claimed_at = p_claimed_at,
    status = 'claimed',
    attempt_count = attempt_count + 1,
    last_error = null
  where retrieval_deliveries.idempotency_key = p_idempotency_key
    and retrieval_deliveries.sent_at is null
    and (
      retrieval_deliveries.claimed_at is null
      or retrieval_deliveries.claimed_at <= p_stale_claim_cutoff
    )
  returning 'claimed'::text, retrieval_deliveries.idempotency_key, retrieval_deliveries.sent_at;

  if found then
    return;
  end if;

  return query
  select
    case when retrieval_deliveries.sent_at is not null then 'already_sent' else 'busy' end,
    retrieval_deliveries.idempotency_key,
    retrieval_deliveries.sent_at
  from public.retrieval_deliveries
  where retrieval_deliveries.idempotency_key = p_idempotency_key
  limit 1;
end;
$$;

grant execute on function public.claim_due_moment(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_retrieval_delivery(uuid, uuid, text, timestamptz, timestamptz, text, timestamptz) to service_role;
