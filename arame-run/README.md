# Arame RUN

Aplicacao web para inscricoes e administracao da corrida. O projeto usa HTML,
CSS e JavaScript sem etapa de compilacao, Supabase PostgreSQL/Auth e Edge
Functions. Nenhuma chave secreta deve ser colocada no navegador.

## 1. Requisitos e execucao local

1. Node.js LTS e necessario para o servidor local e os testes JavaScript. Docker
   e Supabase CLI nao sao necessarios para esses testes; ambos sao necessarios
   para executar o stack Supabase completo localmente. PostgreSQL nativo pode
   executar SQL generico, mas nao reproduz Auth/RLS/Edge Functions Supabase nem
   os testes pgTAP deste projeto. Para instalar Node, se necessario:
   `winget install --id OpenJS.NodeJS.LTS --exact`. Para o stack Supabase local,
   instale Docker Desktop e o Supabase CLI pelo guia oficial do Supabase.
   Reinicie o VS Code se `node` ou `npm` ainda nao estiverem no PATH.
2. Abra o terminal na pasta `arame-run` e execute `npm run dev`.
3. Abra `http://localhost:4173`. Sem um projeto Supabase configurado, as
   operacoes que dependem do banco ficam indisponiveis.
4. Para rodar os testes JavaScript, execute `npm test`. Sem Supabase local, os
   testes de integracao sao marcados como ignorados, nao como aprovados.

O servidor estatico local usa somente APIs nativas do Node.js. Ele nao executa
logica privilegiada; as operacoes publicas seguras rodam nas Edge Functions e
as permissões administrativas sao aplicadas pelo PostgreSQL/RLS.

## 2. Criar projeto e aplicar o banco pelo painel Supabase

Estas instrucoes criam um projeto remoto, mas nao publicam o site nem implantam
funcoes. Use um projeto novo, vazio e de teste; nao aplique estas migrations em
um banco que ja tenha dados. Nao rode `seed.sql` no projeto remoto.

1. Entre em `supabase.com`, crie uma conta se necessario e selecione **New
   project**. Escolha sua organizacao, um nome de teste (por exemplo,
   `arame-run-teste`), uma senha forte para o banco e uma regiao proxima. Na
   opcao de plano, escolha **Free**; nao adicione forma de pagamento nem ative
   upgrade. Confira na tela os limites e a politica atuais: projetos gratuitos
   podem pausar por inatividade e nao oferecem a mesma disponibilidade,
   backups/retencao ou suporte de um plano pago. Nao use para um evento real
   antes de avaliar esses riscos e testar a restauracao.
2. Quando o projeto estiver pronto, abra **Project Settings > API Keys** (ou
   **Connect**). Copie a **Project URL** e uma chave **Publishable** (`sb_publishable_...`)
   ou a chave anon legada (`role: anon`). Nunca escolha nem compartilhe a chave
   **Secret** (`sb_secret_...`) ou `service_role` para o navegador.
3. Na pasta `arame-run`, copie `.env.example` para `.env`. Preencha apenas
   `SUPABASE_URL` e `SUPABASE_ANON_KEY` com os valores copiados. Alternativamente,
   rode `.\scripts\configure.ps1` no PowerShell e informe esses dois valores;
   o script atualiza `.env` sem sobrescrever as outras variaveis locais.
   Reinicie `npm run dev`. O endpoint local `/config.js` le essas duas
   variaveis e nao envia ao navegador nenhuma outra variavel de `.env`.
4. No painel Supabase, abra **SQL Editor > New query**. Num projeto vazio,
   execute em consultas separadas e nesta ordem os arquivos
   `202610150001_core.sql`, `202610150002_admin_operations.sql`,
   `202610150003_admin_and_abuse_controls.sql`,
   `202610150004_developer_roles_themes_gender.sql` e
   `202610150005_private_registration_links.sql` e
   `202610150006_registration_admin_refinements.sql`. Se as cinco primeiras ja
   foram executadas, execute somente a sexta; nao repita migrations antigas.
   A quarta migration converte o perfil principal ja existente em DEV e impede
   a selecao de inscricoes com genero diferente de masculino/feminino. Se
   existirem inscricoes com outros valores de genero, a migration para sem
   alterar esses registros; revise-os antes de tentar novamente. Se qualquer
   consulta falhar, pare e guarde o erro. Nao execute parcialmente uma migration
   novamente sem revisar o estado. Nao rode
   `supabase/seed.sql` nem `supabase/tests/database/security.test.sql` na nuvem:
   o seed e ficticio, mas os testes sao feitos para ambiente local descartavel.
5. Nenhum projeto ou banco sera alterado pelo repositorio ate voce executar
   essas acoes no painel. A aplicacao local ainda nao tera inscricoes/edicoes
   apenas por salvar `.env`; veja os proximos passos de teste abaixo.

## 3. Proximos passos para testar uma inscricao ficticia e aprova-la

Depois que as migrations terminarem sem erro:

1. A conta criada em **Authentication > Users** e associada ao perfil
   `primary` pelo bootstrap anterior deve virar `developer` quando a migration
   004 for aplicada. Esse perfil e oculto dos administradores da corrida via
   RLS, tem acesso global e e o unico que pode atribuir o principal. Nao repita
   o `INSERT` inicial.
2. Entre no painel local como DEV. Em **Administradores**, convide a cliente
   pelo e-mail. O sistema cria inicialmente um perfil secundario; o link do
   Auth permite que a propria cliente defina a senha. Depois que aceitar o
   convite, o DEV seleciona **Definir como principal**. A principal anterior
   passa a secundaria, e ambas as alteracoes ficam auditadas.
3. A cliente entra com a senha definida no convite e convida os ajudantes como
   secundarios somente leitura. O cadastro nao aceita senhas fornecidas pelo
   administrador nem envia senhas em texto por e-mail.
4. Convites precisam que o envio de e-mail do Supabase Auth esteja disponivel.
   Se o limite/configuracao de SMTP do projeto nao enviar convites de forma
   confiavel, configure SMTP antes de convidar usuarios.
5. Para cadastro publico, tambem e necessario implantar as cinco Edge
   Functions (`public-registration`, `registration-lookup`, `admin-invite`,
   `rotate-registration-link` e `registration-private-links`) e configurar os
   secrets delas no Supabase.
   Migrations e `.env` do frontend, sozinhos, nao implantam essas funcoes. Elas
   precisam de `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN=http://localhost:4173` e um
   `RATE_LIMIT_SECRET` aleatorio de pelo menos 32 caracteres. Cadastre esses
   valores somente em **Edge Functions > Secrets**; nunca envie a chave `service_role` para o navegador
   ou para uma conversa. O deploy pode ser feito com Supabase CLI; nao e
   necessario Docker para implantar em projeto remoto. Revise o destino antes
   de qualquer deploy.
6. Os links privados sao armazenados criptografados no banco; a chave de
   criptografia e derivada no servidor da chave `SUPABASE_SERVICE_ROLE_KEY`,
   que nunca vai para o navegador. DEV e principal veem e copiam os links no
   painel. Secundarios veem apenas um indicador mascarado, sem receber o
   codigo privado. Para inscricoes anteriores a migration 005, o token original
   nao pode ser recuperado; use **Gerar novo link** somente quando quiser
   invalidar o link antigo e substitui-lo.
7. Depois do deploy, acesse `http://localhost:4173/admin.html`, entre com a
   conta principal e crie uma edicao de teste e uma categoria com vagas. Abra
   `http://localhost:4173`, preencha o formulario com dados inteiramente
   ficticios e conclua a inscricao. Guarde o numero/link ficticio mostrado.
8. No painel, localize essa inscricao, confira categoria e valor e use
   **Confirmar pagamento** para testar a aprovacao manual. Isso altera o banco
   remoto de teste. Nao faca Pix real; pagamento confirmado no sistema e apenas
   um registro manual, nao uma transacao financeira.
9. Para testar apenas login e painel antes de implantar as Edge Functions, voce
   pode criar a edicao e categoria pelo painel. O formulario publico, consulta
   privada, convites e rotacao de links nao estarao funcionais ate as funcoes
   necessarias estarem implantadas e configuradas.

O papel DEV continua tecnicamente poderoso e deve permanecer apenas com quem
mantem o sistema. Ele nao aparece na lista de contas da cliente. A propriedade
da organizacao/projeto Supabase e independente do papel da aplicacao; quem
controla a organizacao Supabase pode acessar tecnicamente o banco. Nao ha envio
automatico de avisos. Nao envie ao assistente URL com credenciais, chaves,
senhas, tokens ou dados pessoais.

Nenhum projeto externo e criado ou modificado automaticamente por este
repositorio. A conta Supabase, a autenticacao e a aprovacao de qualquer
alteracao remota dependem de voce.

## 3. Banco, dados de teste e seguranca

- `supabase/migrations/` contem o esquema versionado, restricoes, funcoes,
  trilha de auditoria e politicas RLS. A migration
  `202610150004_developer_roles_themes_gender.sql` implementa DEV oculto,
  transferencia auditada da administradora principal, temas compartilhados e
  somente os generos feminino/masculino.
- A migration `202610150005_private_registration_links.sql` salva os links de
  consulta cifrados e restringe a leitura integral a DEV e principal. Links de
  inscricoes anteriores precisam ser renovados manualmente para substituir o
  token que o banco guarda apenas como hash.
- A migration `202610150006_registration_admin_refinements.sql` adiciona a
  busca e ordenacao administrativa compacta, a configuracao de camisas por
  edicao e a duplicacao dessas preferencias sem dados pessoais.
- `supabase/seed.sql` contem apenas dados ficticios de desenvolvimento. Nao
  rode seeds em um projeto que contenha dados reais.
- `supabase/tests/database/` contem testes pgTAP de esquema e autorizacao.
- `tests/integration/` contem testes de concorrencia, rate limit, links e
  autorizacao contra Supabase local; sao opt-in e recusam hosts externos.
- Rode `supabase start` e `supabase status -o env`. Copie URL, chave anon e
  chave service-role local para o `.env` ignorado pelo Git; mantenha service
  role somente nesse arquivo local. O servidor expoe somente URL e chave anon.
- Rode `supabase db reset` e `supabase test db`. `db reset` apaga e recria
  somente o banco local e carrega o seed ficticio. Para as Edge Functions
  locais, rode `supabase functions serve --env-file .env`.
- Copie `.env.example` para `.env` e preencha somente as chaves locais
  `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` com a saida
  de `supabase status -o env` (renomeie `API_URL`, `ANON_KEY` e
  `SERVICE_ROLE_KEY`). Gere `RATE_LIMIT_SECRET` com o comando acima e execute
  `.\scripts\configure.ps1` com a URL local e anon key.
- Execute `.\scripts\prepare-integration.ps1`. O script recusa qualquer URL que
  nao seja localhost/127.0.0.1, cria/renova apenas duas contas ficticias
  identificadas com `example.invalid`, grava perfis de teste e salva tokens
  temporarios no `.env` ignorado pelo Git. Repita apos `supabase db reset` ou
  quando os tokens expirarem.
- Rode `npm run test:integration` enquanto as funcoes iniciadas por
  `supabase functions serve --env-file .env` estiverem ativas. Os testes criam
  participantes ficticios; nunca use tokens ou dados reais. O script recusa
  hosts externos.
- Nunca use `service_role` em frontend. Chaves anon/publicaveis dependem das
  politicas RLS; mantenha as migrations revisadas.

## 4. Teste de carga, backup e publicacao

Antes do evento:

1. Teste em projeto separado com dados ficticios e com a quantidade de
   inscricoes simultaneas esperada, monitorando limites e respostas 429/5xx.
2. `npm run test:integration` deve terminar sem falhas e criar numeros distintos
   para inscricoes concorrentes. Defina `ARAME_RUN_TEST_EDITION_ID` para uma
   edicao de teste com vagas disponiveis. Esse teste cria registros ficticios.
3. Configure backups conforme o plano disponivel e faca uma restauracao
   comprovada em projeto separado; backup nao verificado nao e garantia.
4. Revise RLS, chaves, contas administrativas, configuracao de Auth, URLs e
   logs. Tokens de consulta nunca devem ser registrados.
5. Compare limites, suspensao por inatividade, disponibilidade e suporte dos
   planos gratuitos atuais. Um plano gratuito nao garante capacidade nem
   continuidade durante um evento; nao publique para uso real sem validar a
   carga e decidir conscientemente sobre esses riscos.

## Estado e limitacoes

O frontend agora tem identidade visual Arame RUN em vidro/translucido,
modulos de administracao separados, selecao de tema compartilhado e somente
opcoes masculino/feminino no cadastro. A migration 004 prepara o papel DEV
oculto dos administradores da corrida e permite que somente DEV escolha a
administradora principal. O convite cria acesso secundario e a pessoa convidada
define a propria senha pelo link de Auth. A UI e a migration foram preparadas,
mas precisam ser aplicadas e testadas no projeto Supabase do usuario; SMTP,
Edge Functions remotas, pgTAP/RLS, testes de integracao, backup, restauracao e
carga ainda nao foram validados. A integracao deste projeto com uma conta ou
publicacao remota nao foi realizada pelo agente, e a aplicacao nao esta pronta
para producao.

No painel, a lista de inscricoes tem busca por nome, numero ou categoria,
filtros de pagamento/status e ordenacao pelos cabecalhos; em telas estreitas,
a tabela rola horizontalmente para preservar as colunas. A tela Comunicacao
mantem somente a edicao e o WhatsApp oficial. As instrucoes Pix ficam na
configuracao da edicao, e as categorias podem ser selecionadas para edicao sem
uma tabela separada. As cores e os formularios foram conferidos em viewport
movel de 390 px; isso valida o layout basico, mas nao substitui testes em
aparelhos, navegadores e condicoes de rede reais.
