alter table public.license_keys
  add column if not exists used boolean not null default false;

alter table public.license_keys
  add column if not exists used_at timestamptz;

alter table public.license_keys
  add column if not exists activated_device_id text;

alter table public.license_keys
  add column if not exists activated_at timestamptz;