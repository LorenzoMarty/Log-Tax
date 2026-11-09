# Log Tax

Demo de inteligência tributária conversacional (pt-BR). Spec: `.claude/specs/log-tax-v1/spec.md`.

```sh
npm install
npm run dev      # http://localhost:3000
npm run check    # lint + typecheck + testes (mesmo gate do CI e do pre-commit)
npm run e2e      # Playwright
```

Valores exibidos são estimativas ilustrativas; valide com um contador.

## Banco e login (Supabase local)

Requer Docker. Portas do projeto: 55321 (API), 55322 (Postgres), 55324 (Mailpit).

```sh
cp .env.example .env.local   # preencha as chaves com: npx supabase status -o env
npm run db:start             # sobe o Supabase local e aplica as migrações
npm run db:reset             # recria o banco do zero a partir das migrações
npm run test:rls             # isolamento entre usuários (precisa do db:start)
```

Magic links chegam no Mailpit em http://127.0.0.1:55324. Login com Google exige
`SUPABASE_AUTH_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_GOOGLE_SECRET` (não configurado por padrão).

## Chat com a IA

Rota `POST /api/chat` (exige login). Usa a OpenAI (Responses API, `store:false`):

```sh
# .env.local
OPENAI_API_KEY=...        # obrigatório para a IA real
OPENAI_MODEL=...          # opcional (padrão em src/chat/openai-llm.ts)
LOG_TAX_LLM=scripted      # opcional, só em desenvolvimento: IA roteirizada por palavras-chave, sem chave
```

O e2e (`npm run e2e`) roda a jornada da empresa com `LOG_TAX_LLM=scripted` contra o Supabase local.
