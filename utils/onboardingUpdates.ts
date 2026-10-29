import type { IClient } from "../models/client.model";

// The items of a client's onboarding the team asked them to update (client.onboarding.updateAsked):
// a team comment on an item asks for it (controllers/onboardingComment.controller.ts), and it is
// done once the client changes that item's answers, replies on it, or hands the form in again —
// or the team approves it.

// The items an ask on one stands for: the website's login is answered with Hosting.
export const askedItemsOf = (item: string) => (item === "hosting" ? ["hosting", "cms"] : [item]);

// Where an item's answers sit on the client record.
const pathsOf = (item: string) => (item === "contact" ? ["contactName", "companyName", "phone", "onboarding.business", "onboarding.goals"] : [`onboarding.${item}`]);

// The answers of each item, as text, to tell afterwards whether they changed.
export const answersOfItems = (client: IClient, items: string[]) =>
  Object.fromEntries(items.map((item) => [item, JSON.stringify(pathsOf(item).map((path) => client.get(path) ?? null))]));
