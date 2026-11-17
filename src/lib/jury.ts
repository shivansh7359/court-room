export type Vote = "guilty" | "not_guilty";
export type TallyStatus = "no_jury" | "pending" | "majority_guilty" | "majority_not_guilty" | "deadlock";
export type Outcome = "guilty" | "not_guilty" | "mistrial";

/** Mirrors public.jury_tally on the server (the server is the source of truth). */
export function tallyStatus(jurors: number, guilty: number, notGuilty: number): TallyStatus {
  if (jurors === 0) return "no_jury";
  if (guilty + notGuilty < jurors) return "pending";
  if (guilty > notGuilty) return "majority_guilty";
  if (notGuilty > guilty) return "majority_not_guilty";
  return "deadlock";
}

/** Outcomes the judge may enter for a given tally (mirrors public.submit_verdict). */
export function allowedOutcomes(status: TallyStatus): Outcome[] {
  switch (status) {
    case "pending": return [];
    case "majority_guilty": return ["guilty"];
    case "majority_not_guilty": return ["not_guilty"];
    case "deadlock": return ["guilty", "not_guilty", "mistrial"];
    case "no_jury": return ["guilty", "not_guilty", "mistrial"];
  }
}

export const MAX_JURY_ROUNDS = 3;

export const ROLE_LABEL: Record<string, string> = {
  judge: "Judge", prosecutor: "Prosecutor", defense: "Defense counsel",
  witness: "Witness", juror: "Juror", observer: "Observer",
};
export const PHASE_LABEL: Record<string, string> = {
  pre_trial: "Pre-trial", hearing: "In session", deliberation: "Deliberation", closed: "Closed",
};
export const OUTCOME_LABEL: Record<string, string> = {
  guilty: "Guilty", not_guilty: "Not guilty", mistrial: "Mistrial",
};
export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Something went wrong";
}
