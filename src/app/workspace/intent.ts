/** Which kind of space a question from the home screen belongs to. Keywords only, no model call. */
const PERSONAL = /imposto de renda|\birpf?\b|\bdirpf\b|declara[çc][ãa]o (anual|de ajuste)|pessoa f[íi]sica|restitui[çc][ãa]o|dependentes?|carn[êe]-?le[ãa]o|meu sal[áa]rio|minha aposentadoria/i;

export type SpaceKind = "empresa" | "pessoal";

/** Example: "quero fazer meu imposto de renda" -> "pessoal"; "quero entender meus impostos" -> "empresa". */
export const spaceKindFor = (message: string): SpaceKind => (PERSONAL.test(message) ? "pessoal" : "empresa");

export const HOME_QUESTION_MAX = 1000;
