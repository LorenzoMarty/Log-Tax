# Dados enviados ao modelo de IA (inventário, #74)

Este documento descreve o que sai do Log Tax para o provedor de IA e sob qual proteção. Ele alimenta a Política de
Privacidade (#60). **Revisão jurídica pendente**: a base legal abaixo é a proposta técnica, não parecer.

## Suboperador

- **OpenAI** (API Responses), contratado como suboperador para gerar as respostas da conversa.
- Chamadas com `store: false`: o provedor não guarda o conteúdo para consulta posterior. O histórico é reenviado
  por nós a cada chamada (`src/chat/openai-llm.ts`).
- Revisar o acordo de tratamento de dados (DPA) e a retenção de abuso do provedor antes do go-live.

## O que é enviado

| Dado | Origem | Enviado? | Observação |
| --- | --- | --- | --- |
| Mensagens da pessoa e respostas da IA | conversa | sim | Passam por `redact()` antes de sair |
| Perfil da empresa (nome, regime, atividade, faturamento, funcionários, UF, compras, margem) | espaço | sim, via resultado das ferramentas | Necessário para responder |
| Perfil de pessoa física (renda, INSS, dependentes, despesas) | espaço | sim, via ferramentas | Necessário para o cálculo do IR |
| Nome do espaço e das IAs especializadas | espaço | sim | No prompt do sistema |
| CPF, CNPJ, chave de NF-e, conta e agência bancária | digitados ou lidos de documento | **mascarados** | `***.***.***-NN`, `**.***.***/****-NN`, `[chave NF-e …NNNN]`, `conta ****` |
| Conteúdo de documentos e comentários de terceiros | documentos, convidados | só dentro de `<dados_externos>`, com limite de tamanho | Ver defesa de injeção (#73) |
| Email, senha, tokens de sessão, arquivos originais | conta | **não** | Nunca entram no contexto |

## Mascaramento (`src/chat/redact.ts`)

Aplicado a tudo que sai: instruções do sistema, mensagens e resultados de ferramentas.

- CPF e CNPJ formatados: sempre mascarados, mantendo os dois últimos dígitos.
- CPF e CNPJ sem formatação: mascarados só quando os dígitos verificadores são válidos, para não confundir com valores em reais.
- Chave de acesso de NF-e (44 dígitos): reduzida aos 4 últimos.
- Conta e agência: o rótulo fica, o número some.
- Limite conhecido: nomes de pessoas e valores em reais continuam indo, porque a IA precisa deles para calcular e explicar.

## Base legal proposta (LGPD)

- Execução de contrato com a pessoa titular, para as respostas e cálculos que ela pede (art. 7º, V).
- Consentimento específico para ler documentos enviados (já coletado no upload; gestão em #72).
- Dados financeiros e fiscais não são dados sensíveis pela LGPD, mas tratados com o mesmo cuidado (minimização).
