import { z } from "zod";

export const ROLE_LABEL = { owner: "Dono", commenter: "Comentário", reader: "Leitura" } as const;
export type Role = keyof typeof ROLE_LABEL;

/** Input of the "convidar" form. The database re-checks everything; this just gives friendly errors. */
export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(["commenter", "reader"]),
});

export const commentInput = z.object({
  body: z.string().trim().min(1).max(2000),
  widgetId: z.string().trim().max(80).transform((v) => v || undefined),
});
