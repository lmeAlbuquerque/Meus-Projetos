begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(104);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('26000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated',
   'primary-test@example.invalid', 'not-a-real-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('26000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated',
   'secondary-test@example.invalid', 'not-a-real-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('26000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated',
   'developer-test@example.invalid', 'not-a-real-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.registrations (
  edition_id, registration_number, full_name, phone_e164, birth_date, gender,
  category_id, amount_due_cents, shirt_size, lookup_token_hash
) values (
  '27000000-0000-4000-8000-000000000027', 1, 'Pessoa Ficticia Alfa',
  '+5511990000001', '1990-01-01', 'female',
  '27000000-0000-4000-8000-000000000001', 4000, 'M',
  extensions.digest('fake-token-other-edition', 'sha256')
);

insert into public.registrations (
  id, edition_id, registration_number, full_name, phone_e164, birth_date,
  gender, category_id, amount_due_cents, shirt_size, lookup_token_hash
) values (
  '26000000-0000-4000-8000-000000000103',
  '26000000-0000-4000-8000-000000000026', 3,
  'Pessoa Ficticia Gama', '+5511990000003', '1991-03-03',
  'male', '26000000-0000-4000-8000-000000000001', 5000, 'P',
  extensions.digest('fake-token-gamma', 'sha256')
);

insert into public.admin_profiles (user_id, role, email) values
  ('26000000-0000-4000-8000-000000000201', 'primary', 'primary-test@example.invalid'),
  ('26000000-0000-4000-8000-000000000202', 'read_only', 'secondary-test@example.invalid'),
  ('26000000-0000-4000-8000-000000000203', 'developer', 'developer-test@example.invalid')
on conflict (user_id) do update set role = excluded.role;

select has_table('public', 'editions', 'editions table exists');
select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'registrations', 'registrations table exists');
select has_table('public', 'payment_audit', 'payment audit table exists');
select has_table('public', 'admin_role_audit', 'administrator role changes are audited');
select has_table('public', 'app_theme_settings', 'shared theme settings exist');
select has_table('public', 'registration_private_links', 'encrypted private registration links are stored');
select has_table('public', 'deleted_edition_years',
  'permanently deleted edition years remain blocked from reuse');
select has_table('public', 'category_catalog',
  'categories are maintained in a general catalog');
select has_column('public', 'categories', 'catalog_category_id',
  'edition categories link to their general catalog definition');
select has_column('public', 'edition_public_settings', 'distribute_shirt',
  'shirt distribution is configured per edition');
select has_column('public', 'edition_public_settings', 'shirt_options',
  'shirt sizes are configured per edition');
select has_function('public', 'admin_registration_page',
  ARRAY['uuid', 'text', 'text', 'text', 'text', 'boolean', 'integer', 'integer'],
  'administrative registration search and sorting are available');
select has_function('public', 'set_edition_shirt_options',
  ARRAY['uuid', 'boolean', 'text[]'],
  'shirt distribution is changed through a guarded operation');
select has_function('public', 'delete_edition_and_registrations',
  ARRAY['uuid', 'text'],
  'permanent edition deletion is performed by a guarded RPC');
select has_function('public', 'admin_registration_activity',
  ARRAY['uuid', 'text'],
  'registration activity is returned through an aggregated RPC');
select has_function('public', 'sync_edition_categories',
  ARRAY['uuid', 'uuid[]'],
  'editions select their categories through a guarded RPC');
select has_function('public', 'create_edition_with_categories',
  ARRAY['integer', 'text', 'uuid[]'],
  'new editions and selected categories are created atomically');
select has_function('public', 'update_edition_with_categories',
  ARRAY['uuid', 'integer', 'text', 'text', 'uuid[]'],
  'edition details and selected categories are updated atomically');
select hasnt_function('public', 'clone_edition',
  ARRAY['uuid', 'integer', 'text'],
  'edition cloning is no longer available');
select has_function('public', 'update_category_catalog',
  ARRAY['uuid', 'text', 'numeric', 'integer', 'integer', 'text'],
  'general category definitions are edited through a guarded RPC');
select has_function('public', 'delete_category_catalog',
  ARRAY['uuid'],
  'general categories are deleted through a guarded RPC');
select ok((select relrowsecurity from pg_class where oid = 'public.registrations'::regclass),
  'registrations has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.payment_audit'::regclass),
  'payment audit has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.registration_private_links'::regclass),
  'private registration links have RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.registration_private_links', 'SELECT'),
  'admins cannot read encrypted private links directly');
select ok(not has_function_privilege('anon',
  'public.create_registration_with_private_link(uuid,uuid,text,text,date,text,text,text,text)', 'EXECUTE'),
  'anonymous clients cannot execute the encrypted registration RPC');
select ok(has_function_privilege('service_role',
  'public.create_registration_with_private_link(uuid,uuid,text,text,date,text,text,text,text)', 'EXECUTE'),
  'server role can create a registration and its private link atomically');
select ok(not has_function_privilege('anon',
  'public.admin_registration_page(uuid,text,text,text,text,boolean,integer,integer)', 'EXECUTE'),
  'anonymous users cannot query administrative registrations');
select ok(has_function_privilege('authenticated',
  'public.admin_registration_page(uuid,text,text,text,text,boolean,integer,integer)', 'EXECUTE'),
  'authenticated admins can use the filtered registration list');
select ok(not has_function_privilege('anon',
  'public.admin_registration_activity(uuid,text)', 'EXECUTE'),
  'anonymous users cannot query registration activity');
select ok(has_function_privilege('authenticated',
  'public.admin_registration_activity(uuid,text)', 'EXECUTE'),
  'authenticated admins can query aggregated registration activity');
select ok(not has_function_privilege('anon',
  'public.sync_edition_categories(uuid,uuid[])', 'EXECUTE'),
  'anonymous users cannot change categories assigned to an edition');
select ok(has_function_privilege('authenticated',
  'public.sync_edition_categories(uuid,uuid[])', 'EXECUTE'),
  'authenticated administrators can assign catalog categories to editions');
select ok(not has_function_privilege('anon',
  'public.create_edition_with_categories(integer,text,uuid[])', 'EXECUTE'),
  'anonymous users cannot create editions with categories');
select ok(has_function_privilege('authenticated',
  'public.create_edition_with_categories(integer,text,uuid[])', 'EXECUTE'),
  'authenticated administrators can create editions with categories');
select ok(not has_function_privilege('anon',
  'public.update_edition_with_categories(uuid,integer,text,text,uuid[])', 'EXECUTE'),
  'anonymous users cannot change edition details or categories');
select ok(has_function_privilege('authenticated',
  'public.update_edition_with_categories(uuid,integer,text,text,uuid[])', 'EXECUTE'),
  'authenticated administrators can change edition details and categories');
select ok(not has_function_privilege('anon',
  'public.update_category_catalog(uuid,text,numeric,integer,integer,text)', 'EXECUTE'),
  'anonymous users cannot edit general category definitions');
select ok(has_function_privilege('authenticated',
  'public.update_category_catalog(uuid,text,numeric,integer,integer,text)', 'EXECUTE'),
  'authenticated administrators can edit general category definitions');
select ok(not has_function_privilege('anon',
  'public.delete_category_catalog(uuid)', 'EXECUTE'),
  'anonymous users cannot delete general categories');
select ok(has_function_privilege('authenticated',
  'public.delete_category_catalog(uuid)', 'EXECUTE'),
  'authenticated administrators can request guarded general category deletion');
select ok(not has_function_privilege('anon',
  'public.delete_edition_and_registrations(uuid,text)', 'EXECUTE'),
  'anonymous clients cannot delete editions');
select ok(has_function_privilege('authenticated',
  'public.delete_edition_and_registrations(uuid,text)', 'EXECUTE'),
  'authenticated admins can request guarded edition deletion');
select ok(not has_table_privilege('authenticated', 'public.deleted_edition_years', 'SELECT'),
  'admins cannot read the retired-edition ledger directly');
select ok(not has_function_privilege('anon',
  'public.create_registration(uuid,uuid,text,text,date,text,text,text)', 'EXECUTE'),
  'anonymous clients cannot execute registration RPC directly');
select ok(has_function_privilege('service_role',
  'public.create_registration(uuid,uuid,text,text,date,text,text,text)', 'EXECUTE'),
  'server role can execute registration RPC');
select ok(not has_function_privilege('authenticated',
  'public.rotate_registration_lookup_token(uuid,text)', 'EXECUTE'),
  'admins cannot rotate links without storing the encrypted token');
select ok(not has_function_privilege('anon',
  'public.confirm_registration_payment(uuid,public.payment_status,text)', 'EXECUTE'),
  'anonymous clients cannot confirm payment');
select ok(not has_function_privilege('authenticated',
  'public.lookup_registration(text)', 'EXECUTE'),
  'authenticated users cannot use token lookup RPC directly');
select ok(not has_function_privilege('anon',
  'public.consume_public_rate_limit(text,integer)', 'EXECUTE'),
  'anonymous users cannot directly consume rate-limit counters');
select ok(has_function_privilege('service_role',
  'public.consume_public_rate_limit(text,integer)', 'EXECUTE'),
  'only the server role may consume public rate-limit counters');
select ok(has_table_privilege('authenticated', 'public.registrations', 'SELECT'),
  'authenticated access is mediated by registration RLS');
select ok(not has_table_privilege('anon', 'public.registrations', 'SELECT'),
  'anonymous clients have no registration table access');
select ok(not has_table_privilege('authenticated', 'public.category_catalog', 'UPDATE'),
  'catalog definitions cannot bypass the guarded update RPC');
select ok(not has_table_privilege('authenticated', 'public.category_catalog', 'DELETE'),
  'catalog definitions cannot bypass the guarded delete RPC');
select is((select count(*)::integer from public.registrations where gender not in ('female', 'male')),
  0, 'stored registration gender choices are limited to female and male');

select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.admin_profiles where role = 'developer'),
  0, 'client principal cannot see the hidden developer account');
reset role;
select is((select count(*)::integer from public.registrations
  where edition_id = '27000000-0000-4000-8000-000000000027'),
  1, 'registration records are scoped to their own edition');
select throws_ok(
  $$insert into public.registrations (
    edition_id, registration_number, full_name, phone_e164, birth_date, gender,
    category_id, amount_due_cents, shirt_size, lookup_token_hash
  ) values (
    '26000000-0000-4000-8000-000000000026', 1, 'Pessoa Ficticia Gama',
    '+5511990000003', '1991-03-03', 'male',
    '26000000-0000-4000-8000-000000000001', 5000, 'P',
    extensions.digest('fake-token-duplicate-number', 'sha256')
  )$$,
  '23505', 'a registration number cannot repeat within an edition'
);

select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000202', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.confirm_registration_payment(
    '26000000-0000-4000-8000-000000000101', 'confirmed', 'teste'
  )$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot confirm a payment'
);
select throws_ok(
  $$update public.registrations set payment_status = 'confirmed'
    where id = '26000000-0000-4000-8000-000000000101'$$,
  '42501', 'permission denied for table registrations',
  'secondary administrator cannot directly write payment status'
);
select throws_ok(
  $$select * from public.admin_export_page(
    '26000000-0000-4000-8000-000000000026', 10, 0
  )$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot use export function'
);
select throws_ok(
  $$select public.create_edition(2029, 'Arame RUN 2029 (TESTE)')$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot create editions'
);
select throws_ok(
  $$select public.delete_edition_and_registrations(
    '26000000-0000-4000-8000-000000000026', 'Arame RUN 2026 (TESTE)'
  )$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot delete an edition'
);
select throws_ok(
  $$select public.create_edition_with_categories(
    2030, 'Arame RUN 2030 (TESTE)', ARRAY[]::uuid[]
  )$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot create an edition with categories'
);
select throws_ok(
  $$select public.rotate_registration_lookup_token_with_ciphertext(
    '26000000-0000-4000-8000-000000000101', repeat('a', 64),
    'v1:' || repeat('a', 24) || ':' || repeat('b', 160)
  )$$,
  '42501', 'Primary administrator required',
  'secondary administrator cannot access encrypted private links'
);
select throws_ok(
  $$select public.set_primary_admin('26000000-0000-4000-8000-000000000202')$$,
  '42501', 'Developer access required',
  'secondary administrators cannot choose the principal'
);
update public.edition_public_settings set pix_instructions = 'tentativa secundaria'
where edition_id = '26000000-0000-4000-8000-000000000026';
reset role;
select is((select pix_instructions from public.edition_public_settings
  where edition_id = '26000000-0000-4000-8000-000000000026'),
  'INSTRUCAO FICTICIA - NAO REALIZAR PAGAMENTO',
  'secondary administrator cannot change edition settings');

select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.admin_registration_page(
  '26000000-0000-4000-8000-000000000026', '3', null, null,
  'registration_number', true, 50, 0
)), 1, 'registration search matches a partial registration number');
select lives_ok(
  $$select public.confirm_registration_payment(
    '26000000-0000-4000-8000-000000000101', 'confirmed', 'Pix ficticio conferido'
  )$$,
  'primary administrator can confirm a payment'
);
select throws_ok(
  $$select public.confirm_registration_payment(
    '26000000-0000-4000-8000-000000000101', 'pending', ''
  )$$,
  '22023', 'Correction reason is required',
  'payment corrections require an audit reason'
);
select lives_ok(
  $$select public.confirm_registration_payment(
    '26000000-0000-4000-8000-000000000101', 'refunded', 'Correcao ficticia para teste'
  )$$,
  'primary can correct a payment with an audit reason'
);
select throws_ok(
  $$update public.registrations set status = 'cancelled'
    where id = '26000000-0000-4000-8000-000000000102'$$,
  '42501', 'permission denied for table registrations',
  'primary must cancel through the capacity-safe RPC'
);
select lives_ok(
  $$select * from public.admin_export_page(
    '26000000-0000-4000-8000-000000000026', 10, 0
  )$$,
  'primary administrator can use paginated export'
);
select lives_ok(
  $$select public.rotate_registration_lookup_token_with_ciphertext(
    '26000000-0000-4000-8000-000000000101', repeat('c', 64),
    'v1:' || repeat('a', 24) || ':' || repeat('b', 160)
  )$$,
  'primary administrator can renew and securely store a private link'
);
select is((select count(*)::integer from public.lookup_registration(
  encode(extensions.digest('fake-token-alpha', 'sha256'), 'hex')
)), 0, 'the previous private link is invalidated');
select lives_ok(
  $$select public.create_edition_with_categories(
    2028, 'Arame RUN 2028 (TESTE)',
    ARRAY(
      SELECT catalog_category_id
      FROM public.categories
      WHERE edition_id = '26000000-0000-4000-8000-000000000026'
      ORDER BY catalog_category_id
    )
  )$$,
  'primary can create an edition with selected catalog categories'
);
select lives_ok(
  $$select public.update_edition_with_categories(
    (select id from public.editions where year = 2028),
    2028,
    'Arame RUN 2028 (TESTE)',
    'open',
    ARRAY[
      (
        SELECT catalog_category_id
        FROM public.categories
        WHERE edition_id = '26000000-0000-4000-8000-000000000026'
        ORDER BY catalog_category_id
        LIMIT 1
      )
    ]
  )$$,
  'primary can update edition details and category selection atomically'
);
select throws_ok(
  $$update public.categories set capacity = 1
    where id = '26000000-0000-4000-8000-000000000001'$$,
  '22023', 'Capacity cannot be lower than active registrations',
  'category limit cannot be reduced below occupied places'
);
select throws_ok(
  $$update public.categories set gender_rule = 'female'
    where id = '26000000-0000-4000-8000-000000000001'$$,
  '22023', 'Category rules conflict with active registrations',
  'category rules cannot invalidate existing active registrations'
);
reset role;
select is((select count(*)::integer from public.editions where year = 2028),
  1, 'new edition is created as a separate year');
select is((select count(*)::integer from public.categories c
  join public.editions e on e.id = c.edition_id where e.year = 2028),
  (select count(*)::integer from public.categories
    where edition_id = '26000000-0000-4000-8000-000000000026'),
  'new edition receives only the categories selected from the catalog');
select is((select count(*)::integer from public.categories c
  join public.editions e on e.id = c.edition_id where e.year = 2028 and c.is_active),
  1, 'updating an edition keeps only its selected category active');
select is((select status from public.editions where year = 2028),
  'open', 'edition status is saved with its category selection');
select is((select count(*)::integer from public.registrations r
  join public.editions e on e.id = r.edition_id where e.year = 2028),
  0, 'new editions do not copy participants');
select is((select last_number::integer from public.edition_counters c
  join public.editions e on e.id = c.edition_id where e.year = 2028),
  0, 'new editions start an independent number sequence');
insert into public.registrations (
  edition_id, registration_number, full_name, phone_e164, birth_date,
  gender, category_id, amount_due_cents, shirt_size, payment_status,
  payment_confirmed_at, lookup_token_hash
)
select e.id, 1, 'Teste Ficticio Para Exclusao', '+5511990000099',
  '1990-01-01', 'female', c.id, 5000, '', 'confirmed', now(),
  extensions.digest('fake-token-for-deletion-test', 'sha256')
from public.editions e
join public.categories c on c.edition_id = e.id
where e.year = 2028 and c.is_active
order by c.name
limit 1;
insert into public.payment_audit (
  registration_id, previous_status, new_status, changed_by, note
)
select id, 'pending', 'confirmed', '26000000-0000-4000-8000-000000000201',
  'auditoria ficticia para teste de exclusao'
from public.registrations where full_name = 'Teste Ficticio Para Exclusao';
insert into public.registration_private_links (registration_id, token_ciphertext)
select id, 'v1:' || repeat('a', 24) || ':' || repeat('b', 160)
from public.registrations where full_name = 'Teste Ficticio Para Exclusao';
update public.edition_counters
set last_number = 1
where edition_id = (select id from public.editions where year = 2028);
update public.editions set status = 'open' where year = 2028;
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.delete_edition_and_registrations(
    (select id from public.editions where year = 2028), 'Arame RUN 2028 (TESTE)'
  )$$,
  '22023', 'Close the edition before permanent deletion',
  'open editions cannot be permanently deleted'
);
reset role;
update public.editions set status = 'closed' where year = 2028;
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select is(public.delete_edition_and_registrations(
  (select id from public.editions where year = 2028), 'Arame RUN 2028 (TESTE)'
), 1, 'primary can permanently delete a closed edition and its registration');
reset role;
select is((select count(*)::integer from public.editions where year = 2028),
  0, 'permanent deletion removes the edition');
select is((select count(*)::integer from public.registrations
  where full_name = 'Teste Ficticio Para Exclusao'),
  0, 'permanent deletion removes its registrations');
select is((select count(*)::integer from public.payment_audit
  where note = 'auditoria ficticia para teste de exclusao'),
  0, 'permanent deletion removes payment audit history');
select is((select count(*)::integer from public.registration_private_links
  where token_ciphertext = 'v1:' || repeat('a', 24) || ':' || repeat('b', 160)),
  0, 'permanent deletion removes private registration links');
select is((select count(*)::integer from public.deleted_edition_years where year = 2028),
  1, 'permanent deletion retains a minimal year tombstone');
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_edition(2028, 'Arame RUN 2028 recriada')$$,
  '22023', 'Edition year was permanently retired',
  'a deleted edition year cannot be recreated and reuse registration numbers'
);
reset role;
select is((select payment_status::text from public.registrations
  where id = '26000000-0000-4000-8000-000000000101'),
  'refunded', 'primary correction updates the payment status');
select is((select count(*)::integer from public.payment_audit
  where registration_id = '26000000-0000-4000-8000-000000000101'
    and changed_by = '26000000-0000-4000-8000-000000000201'),
  2, 'confirmation and correction are preserved in the audit log');

select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000203', true);
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-4000-8000-000000000203","role":"authenticated"}', true);
set local role authenticated;
select ok(public.is_developer(), 'DEV profile is recognized');
select ok(public.is_admin_manager(), 'DEV has global administrator permissions');
select ok(not public.is_primary_admin(), 'DEV is not the event principal');
select lives_ok(
  $$select public.set_primary_admin('26000000-0000-4000-8000-000000000202')$$,
  'only DEV can assign the event principal'
);
reset role;
select is((select role from public.admin_profiles
  where user_id = '26000000-0000-4000-8000-000000000202'),
  'primary', 'DEV-promoted administrator becomes principal');
select is((select role from public.admin_profiles
  where user_id = '26000000-0000-4000-8000-000000000201'),
  'read_only', 'previous principal becomes secondary after transfer');
select is((select count(*)::integer from public.admin_role_audit),
  2, 'principal transfer writes both role changes to audit');

select * from finish();
rollback;
