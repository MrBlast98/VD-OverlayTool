alter table public.license_keys enable row level security;

revoke all on table public.license_keys from anon, authenticated, public;
grant select, insert, update, delete on table public.license_keys to service_role;

drop policy if exists license_keys_deny_anon_select on public.license_keys;
drop policy if exists license_keys_deny_anon_insert on public.license_keys;
drop policy if exists license_keys_deny_anon_update on public.license_keys;
drop policy if exists license_keys_deny_anon_delete on public.license_keys;

create policy license_keys_deny_anon_select
on public.license_keys
for select
to anon
using (false);

create policy license_keys_deny_anon_insert
on public.license_keys
for insert
to anon
with check (false);

create policy license_keys_deny_anon_update
on public.license_keys
for update
to anon
using (false)
with check (false);

create policy license_keys_deny_anon_delete
on public.license_keys
for delete
to anon
using (false);

drop policy if exists license_keys_deny_authenticated_select on public.license_keys;
drop policy if exists license_keys_deny_authenticated_insert on public.license_keys;
drop policy if exists license_keys_deny_authenticated_update on public.license_keys;
drop policy if exists license_keys_deny_authenticated_delete on public.license_keys;

create policy license_keys_deny_authenticated_select
on public.license_keys
for select
to authenticated
using (false);

create policy license_keys_deny_authenticated_insert
on public.license_keys
for insert
to authenticated
with check (false);

create policy license_keys_deny_authenticated_update
on public.license_keys
for update
to authenticated
using (false)
with check (false);

create policy license_keys_deny_authenticated_delete
on public.license_keys
for delete
to authenticated
using (false);
