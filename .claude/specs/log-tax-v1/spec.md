---
slug: log-tax-v1
status: ready
revision_count: 1
created: 2026-11-08
issue: —
---

# Log Tax v1 — demo de inteligência tributária conversacional

## Objetivo

Demo pt-BR em que dono de empresa/pessoa física (e seu contador) conversa com uma IA que cria e altera dashboards, alertas e agentes sobre um motor tributário mockado e separado da IA. Fonte: `PRD_ecossistema_inteligencia_tributaria_IA.md`.

## Requisitos

- [x] REQ-1: Projeto Next.js+TS estrito sobe, `npm run lint`, `typecheck`, `test` verdes e pre-commit instalado — verificado por `npm run check`
- [ ] REQ-2: `TaxEngine` (interface) com implementação mock determinística: diagnóstico, simulação, oportunidades; regras versionadas com id, jurisdição, fonte, vigência, confiança, `requiresValidation` — verificado por testes Vitest do motor (empresa seed ≈ R$ 42,8 mil/mês, 12,4%)
- [ ] REQ-3: Sem dado suficiente o motor retorna `insufficient_data`/`not_applicable`/`none_found`, nunca valor inventado — verificado por testes
- [ ] REQ-4: Dashboard = JSON de widgets (kpi, bar, line, breakdown, opportunities, deadlines, compare, checklist, text) com ordem/tamanho/tema/densidade, versionado com undo — verificado por testes do reducer + render dos widgets
- [ ] REQ-5: Auth Supabase (magic link + Google) e RLS: usuário A não lê dados do B — verificado por teste de RLS com 2 usuários
- [ ] REQ-6: Chat com Claude (Sonnet) + tool calling; 13 ferramentas escopadas por workspace/agente; destrutivas pedem confirmação — verificado por testes das ferramentas com LLM mockado
- [ ] REQ-7: Jornada completa no navegador (chat → diagnóstico → dashboard → oportunidades → simulador → alerta → criar IA) — verificado por e2e Playwright com LLM roteirizado
- [ ] REQ-8: Alertas in-app com regra (métrica, operador, limite), avaliados ao mudar dado/abrir — verificado por teste unitário + e2e
- [ ] REQ-9: Agente = config persistida (nome, objetivo, dados, ferramentas) + conversa própria; servidor recusa ferramenta/dado fora do escopo — verificado por teste
- [ ] REQ-10: Perfil PF seed (assalariado, 2 dependentes) com oportunidade simplificada × completa — verificado por testes do motor
- [ ] REQ-11: Compartilhar workspace com contador por email, papéis leitura e comentário; leitor não escreve (RLS) — verificado por teste de RLS
- [ ] REQ-12: Upload (Storage, acesso por workspace) com tipo identificado e campos básicos extraídos (mock), consentimento e apagar — verificado por teste + e2e
- [ ] REQ-13: Relatório imprimível (resumo, impostos, oportunidades, premissas, validações) — verificado por teste de render
- [ ] REQ-14: Todo resultado exibe aviso "estimativa ilustrativa, valide com contador"; nenhum texto diz "garantido" — verificado por teste de snapshot/regex nas telas e no system prompt
- [ ] REQ-15: UI mobile-first pt-BR, sem sidebar enorme, a11y básica — verificado por audit accesslint nas telas principais

## Critérios de concluído

- `npm run check` (lint, typecheck, test) verde; cobertura do motor e das ferramentas ≥ 80%.
- Jornada do REQ-7 rodada em browser real, com captura.
- Dois usuários verificados contra RLS.

## Decisões

- Next.js App Router + TS + Tailwind/shadcn + Vitest + Playwright, deploy Vercel.
- Supabase (Postgres, Auth, RLS, Storage). IA edita só JSON de widgets, nunca código/HTML.
- Modelo: Sonnet. Empresa seed: comércio, Lucro Presumido, R$ 350 mil/mês, 8 funcionários.
- Assumido: `ANTHROPIC_API_KEY` e projeto Supabase fornecidos por você via `.env.local`; até lá tudo roda com LLM mockado e Supabase local (CLI/Docker) — reversível, só config.
- Assumido: repo `LorenzoMarty/Log-Tax` privado já existente; PRs com assignee `LorenzoMarty`, sem reviewer.
- Assumido: spec versionada no repo.

## Fora de escopo

Voz, app nativo, SEFAZ/Receita/ERP, emissão de nota, inventário, patrimônio, edição por terceiros, email/push, memória longa de agente.

## Riscos

- Escopo grande para demo — mitigar entregando em ordem de tickets, jornada primeiro.
- Alíquotas reais incorretas — rotular ilustrativo (REQ-14).
- Documento real = LGPD — consentimento + apagar (REQ-12).

## Em aberto

- Supabase local (Docker) disponível? → recomendado: sim; senão projeto Supabase cloud seu.

## Log da entrevista

- grill-me (2026-11-08): Q1a demo, Q2b empresa+PF, Q3c dono+contador, Q4 stack ok, Q5a empresa fixa, Q6 avisos, Q7b login+banco; Q8–Q16 tudo ok.
