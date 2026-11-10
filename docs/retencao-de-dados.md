# Retenção e proteção de dados (#78)

Política técnica aplicada pelo código. Os prazos são propostas e precisam de validação jurídica (#60).

## Cifra de identificadores

- Campos `cpf` e `cnpj` (e, quando existirem, tokens de integração e certificados) são cifrados na aplicação com
  AES-256-GCM antes de ir ao banco (`src/lib/crypto.ts`). Um dump do banco mostra `enc:k1:...`, nunca o número.
- A chave vem de `DATA_ENCRYPTION_KEY` (32 bytes em base64). Em produção o servidor **não sobe** sem ela.
- Rotação: gere a nova chave, defina `DATA_ENCRYPTION_KEY_ID=k2` e guarde a antiga como `DATA_ENCRYPTION_KEY_K1`.
  Valores antigos continuam abrindo; novos usam a chave nova. Rotação em massa dos valores antigos fica para quando houver volume.
- Hoje o único campo cifrado é o CNPJ do emitente lido de notas fiscais (`documents.extracted`). Os próximos
  identificadores (perfil fiscal #82, certificado A1 #168, integrações #167) devem usar `encryptField`.

## Retenção

| Dado | Prazo | Como |
| --- | --- | --- |
| Documentos enviados | 5 anos após o envio (prazo de decadência tributária), ou antes, se a pessoa apagar | Tarefa diária `retention.purge`: apaga arquivo e registro |
| Conversas (histórico e mensagens) | 12 meses sem atividade | A tarefa esvazia o texto; espaço, painel e dados continuam |
| Registros de tarefas concluídas | 30 dias | A tarefa apaga |
| Contadores de limite de uso | 1 dia | Tarefa horária `housekeeping.purge_rate_limits` |
| Trilha de auditoria | Sem expurgo automático | Registro legal; excluída só com o espaço ou a conta de forma documentada |
| Conta excluída pela pessoa | Imediato | `deleteAccount` (#71) |

A tarefa roda pelo cron da plataforma (`/api/cron/run`, #57) e é idempotente: uma segunda execução não encontra mais nada para apagar.
