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

| Nível | Exemplo | Reação |
| --- | --- | --- |
| 1 | Vazamento ou acesso indevido a dados, site fora do ar | Agora, quem estiver disponível |
| 2 | Um recurso importante quebrado (chat, upload) | Mesmo dia |
| 3 | Falha parcial ou visual | Próximo ciclo |

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

- Responsável técnico: _a definir_
- Encarregado de dados (DPO): _a definir_
- Jurídico: _a definir_

## 6. Rotinas

- **Chave de cifra** (`DATA_ENCRYPTION_KEY`): ver rotação em `docs/retencao-de-dados.md`.
- **Dependências:** o Dependabot abre PRs às segundas; junte os de minor/patch quando o CI estiver verde, e trate os de major à parte.
- **Tarefas:** `select * from job_status` (com a chave de serviço) mostra o que está na fila, falhou ou foi concluído.
- **Retenção e expurgo:** diário, ver `docs/retencao-de-dados.md`.
