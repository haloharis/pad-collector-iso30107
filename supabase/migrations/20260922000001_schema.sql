-- Schema, RLS, storage and RPC for the PAD collector (SPEC section 5).

-- ---------------------------------------------------------------- tables
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.category_groups (
  key text primary key,
  name text not null,
  sort int not null
);

create table public.final_categories (
  key text primary key,
  name text not null
);

create table public.categories (
  key text primary key,
  group_key text not null references public.category_groups (key),
  name text not null,
  summary text not null,
  final_keys text[] not null default '{}',
  availability text not null check (availability in ('everyone', 'needs_props', 'special')),
  needs jsonb not null default '[]',
  steps jsonb not null default '[]',
  dos jsonb not null default '[]',
  donts jsonb not null default '[]',
  confused_with text[] not null default '{}',
  example_video_url text,
  sort int not null,
  active boolean not null default true
);

create table public.installs (
  id uuid primary key references auth.users (id) on delete cascade,
  platform text,
  app_version text,
  device_model text,
  os_version text,
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references public.installs (id) on delete cascade,
  consent_version int not null,
  accepted_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key,
  install_id uuid not null references public.installs (id) on delete cascade,
  session_id uuid not null,
  storage_path text not null,
  sha256 text not null,
  size_bytes bigint not null check (size_bytes > 0),
  source text not null check (source in ('camera', 'gallery')),
  contributor_category text not null,
  face_is_own boolean,
  capture_meta jsonb not null default '{}',
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  final_category text references public.final_categories (key),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  reviewer_notes text
);
create index videos_install_id_idx on public.videos (install_id);
create index videos_final_category_idx on public.videos (final_category);

-- ---------------------------------------------------------------- helpers
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Only admins (or the service role) may touch reviewer fields.
create function public.guard_reviewer_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() or auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.final_category is not null or new.review_status <> 'pending' or new.reviewer_notes is not null then
      raise exception 'reviewer fields are admin-only';
    end if;
  elsif new.final_category is distinct from old.final_category
     or new.review_status is distinct from old.review_status
     or new.reviewer_notes is distinct from old.reviewer_notes then
    raise exception 'reviewer fields are admin-only';
  end if;
  return new;
end $$;

create trigger videos_guard_reviewer_fields
  before insert or update on public.videos
  for each row execute function public.guard_reviewer_fields();

-- ---------------------------------------------------------------- RLS
alter table public.admin_users enable row level security;
alter table public.category_groups enable row level security;
alter table public.final_categories enable row level security;
alter table public.categories enable row level security;
alter table public.installs enable row level security;
alter table public.consents enable row level security;
alter table public.videos enable row level security;

-- Admins: full access everywhere.
create policy admin_all on public.admin_users for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.category_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.final_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.installs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.consents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.videos for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Catalogs: readable by everyone.
create policy read_all on public.category_groups for select to anon, authenticated using (true);
create policy read_all on public.final_categories for select to anon, authenticated using (true);
create policy read_all on public.categories for select to anon, authenticated using (active);

-- Contributors: own rows only.
create policy own_insert on public.installs for insert to authenticated with check (id = auth.uid());
create policy own_select on public.installs for select to authenticated using (id = auth.uid());
create policy own_insert on public.consents for insert to authenticated with check (install_id = auth.uid());
create policy own_select on public.consents for select to authenticated using (install_id = auth.uid());

-- Videos: insert only. Reads go through my_videos; status changes through confirm_upload.
create policy own_insert on public.videos for insert to authenticated
  with check (
    install_id = auth.uid()
    and upload_status = 'pending'
    and storage_path = install_id::text || '/' || id::text || '.mp4'
    and (contributor_category = 'not_sure'
         or exists (select 1 from public.categories c where c.key = contributor_category))
  );

-- ---------------------------------------------------------------- my_videos view
-- Runs with owner rights (bypasses RLS) but only returns the caller's rows,
-- and leaves out the reviewer columns.
create view public.my_videos with (security_invoker = false) as
  select id, install_id, session_id, storage_path, sha256, size_bytes, source,
         contributor_category, face_is_own, capture_meta, upload_status,
         created_at, uploaded_at
  from public.videos
  where install_id = auth.uid();
revoke all on public.my_videos from public, anon;
grant select on public.my_videos to authenticated;

-- ---------------------------------------------------------------- confirm_upload RPC
create function public.confirm_upload(p_video_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.videos;
  obj_size bigint;
begin
  select * into v from public.videos where id = p_video_id and install_id = auth.uid();
  if not found then
    raise exception 'video not found' using errcode = 'P0002';
  end if;

  select (metadata ->> 'size')::bigint into obj_size
  from storage.objects
  where bucket_id = 'videos' and name = v.storage_path;

  if obj_size is null then
    raise exception 'object not uploaded yet' using errcode = 'P0002';
  end if;
  if obj_size <> v.size_bytes then
    raise exception 'size mismatch: expected %, found %', v.size_bytes, obj_size using errcode = '22023';
  end if;

  update public.videos set upload_status = 'uploaded', uploaded_at = now() where id = p_video_id;
end $$;
revoke execute on function public.confirm_upload(uuid) from public, anon;
grant execute on function public.confirm_upload(uuid) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('videos', 'videos', false, array['video/*'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

create policy videos_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy videos_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'videos' and public.is_admin())
  with check (bucket_id = 'videos' and public.is_admin());
