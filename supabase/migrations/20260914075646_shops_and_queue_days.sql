-- Shops and Queue Days: the first slice of the schema (#4).
--
-- Access rules, from docs/specs/backend.md §3:
--   * the anon role gets nothing at all; Customer traffic goes through Next.js
--     using the service role, after the server has read the device cookie
--   * an Owner may only SELECT their own Shop's rows, and never write directly;
--     every write goes through a security definer function

create type public.joining_state as enum ('open', 'last_call');

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  -- Printed in the QR code, so it can never change. See the trigger below.
  slug text not null unique
    constraint shops_slug_format check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null
    constraint shops_name_not_blank check (length(btrim(name)) > 0),
  -- One Owner per Shop, and the account outlives nothing: Shops are deactivated,
  -- never deleted, so the Owner row must not disappear from under one.
  owner_user_id uuid not null unique references auth.users (id) on delete restrict,
  lat double precision not null
    constraint shops_lat_range check (lat between -90 and 90),
  lng double precision not null
    constraint shops_lng_range check (lng between -180 and 180),
  join_radius_m int not null default 150
    constraint shops_join_radius_m_positive check (join_radius_m > 0),
  heads_up_threshold int not null default 3
    constraint shops_heads_up_threshold_min check (heads_up_threshold >= 1),
  max_queue_size int not null default 30
    constraint shops_max_queue_size_positive check (max_queue_size > 0),
  is_active boolean not null default true,
  joining_state public.joining_state not null default 'open',
  -- Set by create_shop, and by close_shop from #11 onwards.
  current_queue_day_id uuid,
  created_at timestamptz not null default now()
);

create table public.queue_days (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_call_at timestamptz,
  -- null = the current Queue Day.
  closed_at timestamptz,
  next_number int not null default 1
    constraint queue_days_next_number_positive check (next_number >= 1)
);

create index queue_days_shop_id_idx on public.queue_days (shop_id);

-- A Shop has exactly one Queue Day open at a time.
create unique index queue_days_one_open_per_shop
  on public.queue_days (shop_id)
  where closed_at is null;

alter table public.shops
  add constraint shops_current_queue_day_id_fkey
  foreign key (current_queue_day_id) references public.queue_days (id)
  on delete restrict;

-- Renaming a slug would break every QR code already printed for the Shop.
create function public.forbid_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'slug_immutable'
      using errcode = 'check_violation',
            hint = 'The slug is printed in the QR code. Create a new Shop instead.';
  end if;
  return new;
end;
$$;

create trigger shops_slug_immutable
  before update of slug on public.shops
  for each row execute function public.forbid_slug_change();

-- Creates a Shop and opens its first Queue Day in one transaction, so a Shop can
-- never exist without a current Queue Day. Overrides left null take the column
-- defaults, which are the only place those numbers are written down.
create function public.create_shop(
  p_slug text,
  p_name text,
  p_owner_user_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_join_radius_m int default null,
  p_heads_up_threshold int default null,
  p_max_queue_size int default null
)
returns public.shops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_queue_day_id uuid;
begin
  insert into public.shops (slug, name, owner_user_id, lat, lng)
  values (p_slug, p_name, p_owner_user_id, p_lat, p_lng)
  returning * into v_shop;

  insert into public.queue_days (shop_id)
  values (v_shop.id)
  returning id into v_queue_day_id;

  update public.shops set
    current_queue_day_id = v_queue_day_id,
    join_radius_m = coalesce(p_join_radius_m, join_radius_m),
    heads_up_threshold = coalesce(p_heads_up_threshold, heads_up_threshold),
    max_queue_size = coalesce(p_max_queue_size, max_queue_size)
  where id = v_shop.id
  returning * into v_shop;

  return v_shop;
end;
$$;

alter table public.shops enable row level security;
alter table public.queue_days enable row level security;

-- Local Supabase and the cloud both auto-grant new public tables to the Data API
-- roles, so take those grants away again and hand back only what §3 allows.
revoke all on public.shops from anon, authenticated;
revoke all on public.queue_days from anon, authenticated;
revoke all on function public.create_shop(
  text, text, uuid, double precision, double precision, int, int, int
) from public, anon, authenticated;

grant select on public.shops to authenticated;
grant select on public.queue_days to authenticated;
grant execute on function public.create_shop(
  text, text, uuid, double precision, double precision, int, int, int
) to service_role;

create policy shops_owner_select on public.shops
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

create policy queue_days_owner_select on public.queue_days
  for select to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = queue_days.shop_id
        and s.owner_user_id = (select auth.uid())
    )
  );
