# Runbook de operação (#65)

Como publicar, reverter, restaurar e reagir a um incidente. **Estado:** os ambientes de produção e staging ainda não
existem (#49 depende de contas na Vercel e no Supabase Cloud). Onde o passo depende deles, está marcado com
`[após #49]`. O resto vale desde já para o ambiente local e para o CI.

## 1. Mapa rápido

| Peça | Onde | Observação |
| --- | --- | --- |
| Aplicação | Next.js na Vercel `[após #49]` | `main` é a fonte; cada PR gera um preview |
| Banco, login e arquivos | Supabase Cloud `[após #49]` | Migrações em `supabase/migrations`, RLS em todas as tabelas |
| Tarefas em segundo plano | `/api/cron/run` (Vercel Cron, a cada 5 min) | Exige `CRON_SECRET` |
| Saúde | `GET /api/health` (200 ou 503) | O workflow `uptime.yml` chama a URL da variável `HEALTH_URL` a cada 10 min |
| Logs | JSON em stdout, com `requestId` | O `x-request-id` também volta no cabeçalho da resposta |

### Variáveis de ambiente (produção)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor),
`OPENAI_API_KEY`, `DATA_ENCRYPTION_KEY` (obrigatória: o servidor não sobe sem ela), `CRON_SECRET`,
`NEXT_PUBLIC_SITE_URL`. Opcionais: `OPENAI_MODEL`, `VIRUS_SCAN_URL`. Modelo em `.env.example`.
Nunca defina `LOG_TAX_LLM=scripted` em produção: é recusado de propósito.

## 2. Publicar

1. Abra o PR. O CI roda `check` (lint, tipos, testes e cobertura), `build`, `rls` (Supabase local) e `e2e`
   (Playwright e acessibilidade). Só faça merge com tudo verde.
2. Se o PR tem migração nova, confira antes que ela é **aditiva** (nova tabela, nova coluna com valor padrão).
   Não renomeie nem apague colunas em uma única publicação: faça em duas (primeiro o código que não usa mais, depois a remoção).
3. Faça o merge na `main`. A Vercel publica sozinha `[após #49]`.
4. Aplique as migrações no banco de produção: `npx supabase db push --linked` (com o projeto vinculado). Faça isso **antes** de
   o tráfego usar o código novo quando a migração só adiciona coisas, e **depois** quando o código novo é que remove o uso.
5. Verifique: `GET /api/health` responde 200, a página inicial abre, uma pessoa de teste consegue entrar e conversar.

## 3. Reverter (rollback)

**Código.** Na Vercel, abra *Deployments*, escolha o último deploy bom e clique em *Promote to Production* (ou
*Instant Rollback*) `[após #49]`. Leva segundos e não mexe no banco.

**Migração.** Não existe "desfazer" automático. Como as migrações são aditivas, o código anterior continua funcionando com o
banco novo. Se uma migração em si estiver errada: escreva uma migração nova que corrige (nunca edite uma já aplicada),
passe pelo CI e publique.

**Quando reverter e quando corrigir à frente.** Erro visível para pessoas e correção que não cabe em 30 minutos: reverta o
código primeiro, investigue depois.

## 4. Restaurar backup

Antes do primeiro dado real, o backup precisa estar ativo e a restauração testada `[após #49, #50]`.

1. Supabase Cloud: *Database → Backups*. Planos pagos têm backup diário e restauração a um ponto no tempo (PITR).
2. Restaure em um **projeto novo** primeiro (nunca por cima da produção), confira as tabelas `workspaces`, `documents` e `audit_log`.
3. Só então aponte a aplicação para ele (troque as variáveis do Supabase) ou copie as linhas necessárias.
4. Arquivos (`documents`) ficam no Storage e não vêm no backup do banco: confira a política de backup do Storage do plano.
5. Registre quando restaurou, de que ponto no tempo e quem decidiu.

## 5. Incidente

### Gravidade

| Nível | Exemplo | Reação | Prazo de resposta / comunicação |
| --- | --- | --- | --- |
| 1 | Vazamento ou acesso indevido a dados, site fora do ar | Agora, quem estiver disponível | `[definir]` |
| 2 | Um recurso importante quebrado (chat, upload) | Mesmo dia | `[definir]` |
| 3 | Falha parcial ou visual | Próximo ciclo | `[definir]` |

Os prazos e o canal de aviso (quem chama quem, e como) ainda não foram combinados: preencher junto com os contatos abaixo.
Não existe hoje ferramenta de alerta ou plantão configurada além do `uptime.yml` (ver seção 1) `[definir]`.

### Primeiros 30 minutos

1. **Conter.** Dados expostos: revogue o que vazou (chaves em `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `DATA_ENCRYPTION_KEY`),
   encerre sessões (Supabase *Authentication → Users → sign out*), tire a rota afetada do ar se for preciso.
2. **Entender.** Ache o erro pelo `requestId` nos logs. A trilha de auditoria (`audit_log`) e a tabela de sessões mostram quem fez o quê.
3. **Anotar.** Horário em que soube, o que foi afetado, quantas pessoas, quais tipos de dado.

### Incidente de dados pessoais (LGPD, art. 48)

1. Avalie se há risco ou dano relevante aos titulares. Se sim, a comunicação é obrigatória.
2. **ANPD:** comunicar o incidente pelo formulário da ANPD no prazo da regulamentação em vigor. O prazo atual informado é de
   **3 dias úteis** a partir do conhecimento (Resolução CD/ANPD nº 15/2024). **Confirme o prazo e o conteúdo com o jurídico**, porque
   a norma pode mudar.
3. **Titulares:** avisar as pessoas afetadas, em linguagem simples: o que aconteceu, quais dados, o que já foi feito, o que a
   pessoa deve fazer (por exemplo, trocar senhas em outros serviços) e o contato do encarregado (DPO).
4. Guarde o registro do incidente, das decisões e das comunicações.
5. Depois: causa raiz, correção, teste que teria pego o problema, e atualização deste documento.

### Contatos (preencher antes do go-live)

- Responsável técnico: `[definir]` (nome, telefone/canal)
- Encarregado de dados (DPO): `[definir]`
- Jurídico: `[definir]`
- Suporte Vercel / Supabase `[após #49]`: `[definir]` (plano e canal de suporte contratados)

### Quando um serviço de que dependemos cai

| Serviço | Sintoma | O que fazer |
| --- | --- | --- |
| **OpenAI** | O chat falha. O cliente já repete a chamada até 2 vezes (timeout, conexão, 408/409/429/5xx) antes de desistir; sem `OPENAI_API_KEY` o chat responde 503 | Confirme na página de status do provedor `[definir URL]`. O resto do app (espaços, documentos, relatório, motor de cálculo) não depende da OpenAI e segue no ar. Não troque de modelo às pressas: `OPENAI_MODEL` precisa existir na conta. Chave inválida ou estourada: ver rotação na seção 6. Gasto fora do esperado: o limite diário vem de `CHAT_DAILY_TOKENS` (API) |
| **Supabase** (banco, login, arquivos) | `GET /api/health` responde 503; login, leitura e gravação falham | Confirme na página de status do Supabase `[após #49]`. Não há réplica nem segundo provedor: a aplicação fica indisponível até a volta. Anote o horário de início e fim para o registro. Se o banco foi corrompido ou apagado, e não apenas indisponível, siga a seção 4 |
| **Vercel** `[após #49]` | Site fora do ar apesar do `health` do banco ok | Tente *Instant Rollback* (seção 3); se a plataforma é que está fora, aguarde e registre |
| **Agendador (cron)** | `job_status` mostra fila parada | `/api/cron/run` exige `Authorization: Bearer $CRON_SECRET`; confira o segredo e rode a chamada à mão |

Enquanto o incidente for nível 1 ou 2 e durar além do prazo `[definir]`, avise quem usa o produto: canal `[definir]`.

## 6. Rotação de segredos

Vale em qualquer vazamento ou suspeita. Troque no provedor, atualize a variável no ambiente (Vercel `[após #49]`, ou `.env` local),
republique e confira `GET /api/health`.

| Segredo | Como rotacionar | Efeito |
| --- | --- | --- |
| `OPENAI_API_KEY` | Crie uma chave nova no painel da OpenAI, troque a variável e revogue a antiga | Chat volta a responder com a nova |
| `SUPABASE_SERVICE_ROLE_KEY` | Painel do Supabase, *Project Settings → API*, gerar nova chave de serviço e trocar a variável | Burla o RLS: trate vazamento como nível 1 |
| `CRON_SECRET` | Gere um valor novo e defina o mesmo na aplicação e no agendador | Enquanto os dois não batem, o cron responde 401 |
| `DATA_ENCRYPTION_KEY` | Não troque a chave no lugar: siga a rotação com `DATA_ENCRYPTION_KEY_ID` em `docs/retencao-de-dados.md` | Trocar sem guardar a antiga impede abrir os valores cifrados |
| Chave anon e JWT secret do Supabase | Trocar derruba as sessões ativas; planeje o horário | Quem estava logado precisa entrar de novo |

Nunca cole segredo em issue, PR, chat ou log. Se um segredo foi para o Git, considere-o vazado mesmo depois de apagar o commit.

### Backend FastAPI `[após #291]`

Quando a API Python estiver hospedada, ela passa a ter as mesmas variáveis (prefixo `LOGTAX_`, ver `docs/backend-fastapi.md`, seção 3), e o
deploy e rollback dela seguem a seção 4 daquele documento. Hoje o Next.js ainda acessa o banco por conta própria, então os passos
deste runbook continuam valendo sozinhos. Reversão rápida do chat: esvaziar `NEXT_PUBLIC_CHAT_API` e republicar o Next.

## 7. Rotinas

- **Chave de cifra** (`DATA_ENCRYPTION_KEY`): ver rotação em `docs/retencao-de-dados.md`.
- **Dependências:** o Dependabot abre PRs às segundas; junte os de minor/patch quando o CI estiver verde, e trate os de major à parte.
- **Tarefas:** `select * from job_status` (com a chave de serviço) mostra o que está na fila, falhou ou foi concluído.
- **Retenção e expurgo:** diário, ver `docs/retencao-de-dados.md`.
