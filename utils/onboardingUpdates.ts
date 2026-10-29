import type { IClient } from "../models/client.model";

// The items of a client's onboarding the team asked them to update (client.onboarding.updateAsked):
// a team comment on an item asks for it, and one on a step asks for the step ("step:social") —
// approved or not (controllers/onboardingComment.controller.ts). It is done once the client
// changes those answers, comments on that step, or hands the form in again — or the team approves
// the item (or one of the step's).

// The items an ask on one stands for: the website's login is answered with Hosting.
export const askedItemsOf = (item: string) => (item === "hosting" ? ["hosting", "cms"] : [item]);

const CONTACT_PATHS = ["contactName", "companyName", "phone", "onboarding.business", "onboarding.goals"];

// Where each step's answers sit on the client record, by the step's id on the form.
const STEP_PATHS: Record<string, string[]> = {
  contact: CONTACT_PATHS,
  web: ["onboarding.website"],
  domain: ["onboarding.domain", "onboarding.hosting", "onboarding.cms"],
  email: ["onboarding.email"],
  logo: ["onboarding.logo"],
  google: ["onboarding.google"],
  social: ["onboarding.social"],
  media: ["onboarding.media"],
};

// The step of the form an item is on ("social.facebook" → "social", "hosting" → "domain").
const STEP_OF_SECTION: Record<string, string> = { contact: "contact", website: "web", domain: "domain", hosting: "domain", cms: "domain", email: "email", logo: "logo" };
export const stepOfItem = (item: string) => {
  const section = item.split(".")[0];
  return STEP_OF_SECTION[section] ?? section;
};

// Where an item's (or a step's) answers sit on the client record.
const pathsOf = (item: string) =>
  item.startsWith("step:") ? (STEP_PATHS[item.slice("step:".length)] ?? []) : item === "contact" ? CONTACT_PATHS : [`onboarding.${item}`];

// The answers of each item, as text, to tell afterwards whether they changed.
export const answersOfItems = (client: IClient, items: string[]) =>
  Object.fromEntries(items.map((item) => [item, JSON.stringify(pathsOf(item).map((path) => client.get(path) ?? null))]));
