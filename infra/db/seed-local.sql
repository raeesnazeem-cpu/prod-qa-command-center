-- Local floci seed: the system org/user the api falls back to (SYSTEM_ORG_ID /
-- SYSTEM_USER_ID) and the "QACC Local Test 1397" project pinned to TED client 1397.
-- Never run against a real database.
insert into organizations (id, name)
values ('694e1168-373d-4a82-91e2-a1da99c0d9d5', 'QACC Local (floci)')
on conflict (id) do nothing;

insert into users (id, org_id, email, full_name, role)
values ('a392f87e-7ac3-42aa-8ef6-3dbbf9b3aa7f', '694e1168-373d-4a82-91e2-a1da99c0d9d5',
        'tedsystem@ted.internal', 'TED System', 'super_admin')
on conflict (id) do nothing;

insert into projects (org_id, name, site_url, ted_client_id)
values ('694e1168-373d-4a82-91e2-a1da99c0d9d5', 'QACC Local Test 1397', 'https://example.com', 1397)
on conflict (org_id, name) do nothing;
