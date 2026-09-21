// One 5-point stance scale, as i18n keys.
//
// Seven components each carried their own private copy of this map in English
// (STANCE_LABELS / STANCE_LABEL / STANCE_SHORT / stanceLabelShort), so the
// scale had to be translated seven times and could drift seven ways. It is
// keys, not display text, so a module-level constant is safe: nothing here is
// resolved until a component calls t().
export const STANCE_LABEL_KEYS: Record<number, string> = {
  [-2]: "stance.stronglyDisagree",
  [-1]: "stance.disagree",
  [0]:  "stance.neutral",
  [1]:  "stance.agree",
  [2]:  "stance.stronglyAgree",
};
