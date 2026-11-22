/** Notices shown after a sharing action (`?msg=<code>`). `ok` ones are green, the rest are errors. */
export const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "convite-enviado": { text: "Convite criado. Peça para a pessoa entrar no Log Tax com este email: o convite aparece na tela de espaços dela.", ok: true },
  "convite-cancelado": { text: "Convite cancelado.", ok: true },
  "documento-apagado": { text: "Documento apagado do armazenamento.", ok: true },
  "membro-removido": { text: "Acesso removido.", ok: true },
  "convite-invalido": { text: "Convite inválido. Confira o email e o papel.", ok: false },
  "recorte-vazio": { text: "Escolha pelo menos uma parte do espaço para compartilhar, ou compartilhe o espaço inteiro.", ok: false },
  "recorte-sem-pagina": { text: "Escolha pelo menos uma página do painel, ou compartilhe todas.", ok: false },
  "recorte-sem-edicao": { text: "Quem recebe só uma parte do espaço lê ou comenta; não pode editar nem administrar.", ok: false },
  "convite-proprio": { text: "Você já é dono deste espaço.", ok: false },
  "comentario-invalido": { text: "Escreva um comentário de até 2.000 caracteres.", ok: false },
  "muitas-tentativas": { text: "Muitos convites em pouco tempo. Tente de novo daqui a alguns minutos.", ok: false },
  "exclusao-nao-confirmada": { text: "Para excluir a conta, digite o seu email exatamente como aparece no topo da tela.", ok: false },
  "exclusao-falhou": { text: "Não foi possível excluir a conta agora. Nada foi perdido: tente de novo.", ok: false },
  "sem-permissao": { text: "Você não tem permissão para isso.", ok: false },
};
