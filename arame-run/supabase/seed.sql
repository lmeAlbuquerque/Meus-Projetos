insert into public.editions (id, year, name, status)
values
  ('26000000-0000-4000-8000-000000000026', 2026, 'Arame RUN 2026 (TESTE)', 'open'),
  ('27000000-0000-4000-8000-000000000027', 2027, 'Arame RUN 2027 (TESTE)', 'draft');

insert into public.edition_public_settings (
  edition_id, pix_instructions, whatsapp_number, announcement_url
) values (
  '26000000-0000-4000-8000-000000000026',
  'INSTRUCAO FICTICIA - NAO REALIZAR PAGAMENTO',
  '5511999999999',
  'https://chat.whatsapp.com/fake-test-link'
);

insert into public.categories (
  id, edition_id, name, distance_km, min_age, gender_rule, price_cents, capacity, shirt_options
) values
  ('26000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000026',
   'Corrida 5 km - teste', 5, 16, 'any', 5000, 500, array['P', 'M', 'G', 'GG']),
  ('26000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000026',
   'Caminhada 3 km - teste', 3, 12, 'any', 3000, 500, array['P', 'M', 'G', 'GG']),
  ('27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000027',
   'Corrida 5 km - teste', 5, 16, 'any', 4000, 300, array['P', 'M', 'G', 'GG']);

insert into public.edition_counters (edition_id, last_number)
values ('26000000-0000-4000-8000-000000000026', 2);

insert into public.registrations (
  id, edition_id, registration_number, full_name, phone_e164, birth_date,
  gender, category_id, amount_due_cents, shirt_size, lookup_token_hash
) values
  ('26000000-0000-4000-8000-000000000101', '26000000-0000-4000-8000-000000000026',
   1, 'Pessoa Ficticia Alfa', '+5511990000001', '1990-01-01', 'female',
   '26000000-0000-4000-8000-000000000001', 5000, 'M', extensions.digest('fake-token-alpha', 'sha256')),
  ('26000000-0000-4000-8000-000000000102', '26000000-0000-4000-8000-000000000026',
   2, 'Pessoa Ficticia Beta', '+5511990000002', '1988-02-02', 'male',
   '26000000-0000-4000-8000-000000000002', 3000, 'G', extensions.digest('fake-token-beta', 'sha256'));
