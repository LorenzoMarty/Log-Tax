/** Notices shown after a sharing action (`?msg=<code>`). `ok` ones are green, the rest are errors. */
export const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "convite-enviado": { text: "Convite criado. Peça para a pessoa entrar no Log Tax com este email: o convite aparece na tela de espaços dela.", ok: true },
  "convite-cancelado": { text: "Convite cancelado.", ok: true },
  "membro-removido": { text: "Acesso removido.", ok: true },
  "convite-invalido": { text: "Convite inválido. Confira o email e o papel.", ok: false },
  "convite-proprio": { text: "Você já é dono deste espaço.", ok: false },
  "comentario-invalido": { text: "Escreva um comentário de até 2.000 caracteres.", ok: false },
  "sem-permissao": { text: "Você não tem permissão para isso.", ok: false },
};
