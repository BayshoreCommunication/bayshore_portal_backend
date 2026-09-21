// People type numbers the way they read them: "+1 813-706-5778", "(813) 706 5778".
// Store and compare them without the formatting, so the same number always
// looks the same and passes PHONE_REGEX (an optional "+" then 7–15 digits).
export const normalizePhone = (value: unknown) =>
  typeof value === "string" ? value.replace(/[\s\-().]/g, "") : value;
