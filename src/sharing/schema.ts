import { z } from "zod";

export const ROLE_LABEL = { owner: "Dono", admin: "Administração", editor: "Edição", commenter: "Comentário", reader: "Leitura" } as const;
export type Role = keyof typeof ROLE_LABEL;

/** Input of the "convidar" form. The database re-checks everything; this just gives friendly errors. */
export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(["admin", "editor", "commenter", "reader"]),
});

/** Role of an existing member: never "owner" (that is only reached by transferring the space). */
export const roleInput = z.object({ role: z.enum(["admin", "editor", "commenter", "reader"]) });
export const transferInput = z.object({ newOwnerId: z.uuid() });

export const commentInput = z.object({
  body: z.string().trim().min(1).max(2000),
  widgetId: z.string().trim().max(80).transform((v) => v || undefined),
});
