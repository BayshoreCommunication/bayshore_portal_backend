import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { EMAIL_REGEX, PHONE_REGEX } from "./user.model";

export const CLIENT_STATUSES = ["pending", "active", "on_hold", "closed"] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_NOTES_MAX_LENGTH = 500;

// The pages of the client portal a client can be given or refused, each by the key of its
// entry in the portal's menu. Settings isn't among them: a client always reaches their own
// account.
export const CLIENT_PORTAL_MENUS = ["dashboard", "onboarding", "reports", "content", "leads", "projects", "services", "calendar", "messages", "payments", "notifications"] as const;
export type ClientPortalMenu = (typeof CLIENT_PORTAL_MENUS)[number];

// ── Onboarding ───────────────────────────────────────────────────────────────

// What a client tells us on the onboarding form (client-portal: component/client-onboarding):
// their website, domain and hosting, email, logo, the Google and social accounts they have,
// and their photos and videos. Every answer is optional — the form lets anything be skipped —
// so a missing field means "not answered", which is different from "no".

export const ONBOARDING_STATUSES = ["in_progress", "submitted"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

// "Do you have one?" Some questions also offer "Not sure".
export const ONBOARDING_YES_NO = ["yes", "no"] as const;
export const ONBOARDING_HAS = ["yes", "no", "unsure"] as const;
export type OnboardingYesNo = (typeof ONBOARDING_YES_NO)[number];
export type OnboardingHas = (typeof ONBOARDING_HAS)[number];

// "Do you need a new website?" — "unsure" leaves it for us to recommend after a review.
export const ONBOARDING_WEBSITE_NEEDS = ["new", "redesign", "no", "unsure"] as const;
export type OnboardingWebsiteNeed = (typeof ONBOARDING_WEBSITE_NEEDS)[number];

// How access to an account is given: by inviting our access email, or by sharing the login
// through a secure link (never typed into the form).
export const ONBOARDING_ACCESS_METHODS = ["invite", "secure"] as const;
export type OnboardingAccessMethod = (typeof ONBOARDING_ACCESS_METHODS)[number];

// Photos and videos: upload what they have, have us make them, or not needed.
export const ONBOARDING_MEDIA_MODES = ["upload", "create", "none"] as const;
export type OnboardingMediaMode = (typeof ONBOARDING_MEDIA_MODES)[number];

// The steps a client goes through right after making their own account (client-portal:
// component/clientstart) ask about the business itself and its goals, which the form above
// doesn't. Their answers sit beside its sections, under `business`, `goals` and `kickoffCall`.

// How the main contact would like to be reached.
export const ONBOARDING_REACH_BY = ["email", "phone", "text"] as const;
export type OnboardingReachBy = (typeof ONBOARDING_REACH_BY)[number];

// How soon they would like to reach their goals.
export const ONBOARDING_GOAL_TIMEFRAMES = ["3_months", "6_months", "12_months", "unsure"] as const;
export type OnboardingGoalTimeframe = (typeof ONBOARDING_GOAL_TIMEFRAMES)[number];

// What they plan to spend on marketing each month, ads and agency fees together (US dollars).
export const ONBOARDING_BUDGETS = ["under_1000", "1000_3000", "3000_5000", "5000_10000", "over_10000", "unsure"] as const;
export type OnboardingBudget = (typeof ONBOARDING_BUDGETS)[number];

// Where their leads come from today.
export const ONBOARDING_LEAD_SOURCES = ["referrals", "google_search", "google_maps", "paid_ads", "social_media", "other"] as const;
export type OnboardingLeadSource = (typeof ONBOARDING_LEAD_SOURCES)[number];

// The most items a typed list (services offered, areas served) may hold.
export const ONBOARDING_MAX_LIST_ITEMS = 50;

// The kinds of photos and videos, as they are named on the record (onboarding.media) — and
// what a client may upload for each: the photos take images, the videos take videos.
export const ONBOARDING_MEDIA_KINDS = ["professionalPhotos", "businessPhotos", "videos"] as const;
export type OnboardingMediaKind = (typeof ONBOARDING_MEDIA_KINDS)[number];

const ONBOARDING_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ONBOARDING_PHOTO_MAX_SIZE = 10 * 1024 * 1024;

export const ONBOARDING_MEDIA_MIME_TYPES: Record<OnboardingMediaKind, string[]> = {
  professionalPhotos: ONBOARDING_PHOTO_TYPES,
  businessPhotos: ONBOARDING_PHOTO_TYPES,
  videos: ["video/mp4", "video/quicktime", "video/webm"],
};
export const ONBOARDING_MEDIA_MAX_FILE_SIZE: Record<OnboardingMediaKind, number> = {
  professionalPhotos: ONBOARDING_PHOTO_MAX_SIZE,
  businessPhotos: ONBOARDING_PHOTO_MAX_SIZE,
  videos: 200 * 1024 * 1024,
};
// How many files a kind can hold, and how many one upload can bring (they are held in memory
// until they go to Spaces).
export const ONBOARDING_MEDIA_MAX_FILES = 40;
export const ONBOARDING_UPLOAD_MAX_FILES = 10;

export const ONBOARDING_TEXT_MAX_LENGTH = 300;
export const ONBOARDING_LONG_TEXT_MAX_LENGTH = 2000;
export const ONBOARDING_MAX_COMPETITORS = 5;

// A file uploaded with the form (a logo, photos, videos), stored in DigitalOcean Spaces.
export interface IOnboardingFile {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

// A platform we need to get into (domain registrar, host, website builder): which one, and
// whether access has been given by following its steps — or help is needed with them.
interface IOnboardingPlatform {
  platform?: string;
  accessGiven?: boolean;
  needsHelp?: boolean;
}

// A Google or social account.
export interface IOnboardingAccount {
  has?: OnboardingHas;
  // Its link, name or ID, when they have one.
  link?: string;
  access?: OnboardingAccessMethod;
  accessGiven?: boolean;
  needsHelp?: boolean;
  // They don't have one: should we create it?
  wantsCreated?: boolean;
  // The account's own login, when that is how we get in: the username or email it is signed
  // in with, and its password. The password is sealed (utils/secretBox.ts) — never as typed.
  loginUsername?: string;
  loginPassword?: string;
}

// One kind of photos or videos.
export interface IOnboardingMedia {
  mode?: OnboardingMediaMode;
  files: IOnboardingFile[];
  // A shared folder (Google Drive, Dropbox, WeTransfer) instead of, or with, the files.
  link?: string;
  // What they need created, when they asked for that.
  notes?: string;
}

// A number as it is in a typical month today, and as they would like it to be.
export interface IOnboardingTarget {
  current?: number;
  goal?: number;
}

export interface IClientOnboarding {
  status: OnboardingStatus;
  submittedAt?: Date;

  // About the business. Its name is the client's own `companyName`.
  business?: {
    // What they do, who their clients are, and what makes them different.
    description?: string;
    // The work they do for their own clients — not the BayShore services they buy, which are
    // the client's `serviceTypes`.
    services: string[];
    // The cities, counties or regions their clients come from.
    areas: string[];
    // Who we should talk to about the account. With `isAccountOwner` it is the person who
    // signed up — the client's own contactName, email and phone, repeated here as they
    // confirmed them; without it, someone else, named here.
    contact?: {
      isAccountOwner?: boolean;
      name?: string;
      email?: string;
      phone?: string;
      reachBy?: OnboardingReachBy;
    };
  };

  // Where the business is now and where it wants to be. Money is in US dollars.
  goals?: {
    // Each per month.
    revenue?: IOnboardingTarget;
    leads?: IOnboardingTarget;
    newClients?: IOnboardingTarget;
    timeframe?: OnboardingGoalTimeframe;
    budget?: OnboardingBudget;
    // What one lead costs them today, and what one new client is worth to them.
    costPerLead?: number;
    clientValue?: number;
    leadSources: OnboardingLeadSource[];
  };

  // Whether they say they booked the kickoff call. It is booked on a Google Calendar
  // appointment schedule, which doesn't tell us — so this is the client's own word.
  kickoffCall?: {
    booked?: boolean;
  };

  website?: {
    url?: string;
    // "I don't have a website yet"
    hasNone?: boolean;
    need?: OnboardingWebsiteNeed;
    // How they want the new or redesigned site.
    description?: string;
    // Competitor or example sites they like, and what they like about each.
    competitors: { url?: string; note?: string }[];
    pages: string[];
    features: string[];
  };

  domain?: IOnboardingPlatform & {
    has?: OnboardingHas;
    name?: string;
    // They don't have one: should we register it, and which names would they like?
    wantsCreated?: boolean;
    wishlist?: string;
  };

  hosting?: IOnboardingPlatform & {
    has?: OnboardingHas;
    wantsCreated?: boolean;
  };

  // The website's own login (WordPress, Wix…). `developer` is who built or maintains a custom site.
  cms?: IOnboardingPlatform & {
    developer?: string;
  };

  // A business email on their own domain.
  email?: {
    has?: OnboardingYesNo;
    provider?: string;
    // They don't have one: should we set up Google Workspace — how many accounts, which addresses?
    wantsCreated?: boolean;
    accounts?: number;
    addresses?: string;
  };

  logo?: {
    has?: OnboardingYesNo;
    // A shared folder (Google Drive, Dropbox…) holding the logo and brand files.
    link?: string;
    files: IOnboardingFile[];
    // They don't have one: should we design it, and in what style?
    wantsCreated?: boolean;
    style?: string;
  };

  google?: {
    businessProfile?: IOnboardingAccount;
    analytics?: IOnboardingAccount;
    searchConsole?: IOnboardingAccount;
    tagManager?: IOnboardingAccount;
    ads?: IOnboardingAccount;
  };

  social?: {
    facebook?: IOnboardingAccount;
    instagram?: IOnboardingAccount;
    youtube?: IOnboardingAccount;
    linkedin?: IOnboardingAccount;
    tiktok?: IOnboardingAccount;
    x?: IOnboardingAccount;
    // The ad account behind Facebook and Instagram ads. (Google Ads is `google.ads`.)
    metaAds?: IOnboardingAccount;
  };

  media?: {
    professionalPhotos?: IOnboardingMedia;
    businessPhotos?: IOnboardingMedia;
    videos?: IOnboardingMedia;
  };
}

// ── What the team records ────────────────────────────────────────────────────

// What the team fills in about a client when adding or editing them (company-portal:
// component/clients/ClientForm) — beside the contact details, which sit on the client itself.
// The choices (an industry, a billing cycle…) are the form's own lists, so they are kept as the
// text that was picked; dates are kept as the form holds them, yyyy-mm-dd.

export const CLIENT_CONTRACT_SIGNED = ["yes", "sent", "no"] as const;
export type ClientContractSigned = (typeof CLIENT_CONTRACT_SIGNED)[number];

// One service the client has agreed to, as it was set up for them.
export interface IClientServicePlan {
  name: string;
  // The quantities and prices, each under its label on the form.
  fields: { label: string; value: number }[];
  // What they come to each month.
  monthly: number;
  // What the service covers for this client.
  included: string[];
  // Rates to quote if the client asks for more later. Not billed now.
  addons: { label: string; price: number }[];
}

export interface IClientDetails {
  communication?: {
    methods: string[];
    bestTime?: string;
    timeZone?: string;
  };
  business?: {
    industry?: string;
    businessType?: string;
    website?: string;
    googleBusinessProfile?: string;
    serviceArea?: string;
    targetAudience?: string;
    competitors?: string;
    social?: { facebook?: string; instagram?: string; linkedin?: string; tiktok?: string; youtube?: string; x?: string };
    hasLogo?: boolean;
    // They have no logo: whether we design one, and on what terms.
    logoDesign?: { add?: boolean; price?: number; concepts?: number; style?: string };
    otherDetails?: string;
  };
  services: IClientServicePlan[];
  // What the client already has and what they need, and — for what we are taking over — the
  // steps of the transfer that are done.
  transfer?: {
    has: string[];
    needs: string[];
    websiteDone: string[];
    socialDone: string[];
  };
  contract?: {
    // In months. Missing for a custom length, where only the end date says.
    termMonths?: number;
    endDate?: string;
    renewal?: string;
    cancellationNotice?: string;
    renewalReminder?: string;
    signed?: ClientContractSigned;
    dateSigned?: string;
    dateSent?: string;
  };
  billing?: {
    paymentOnFile?: boolean;
    method?: string;
    cycle?: string;
    day?: string;
    setupFee?: string;
  };
  reportDelivery?: string;
}

export interface IClient extends Document {
  contactName: string;
  companyName: string;
  email: string;
  phone?: string;
  address?: string;
  serviceTypes: string[];
  startDate: Date;
  status: ClientStatus;
  notes?: string;
  // What the team recorded about them. Missing for a client added before the form asked.
  details?: IClientDetails;
  // The portal pages this client is shown, chosen by the team. Missing means all of them —
  // as it is for every client from before this could be chosen, and for one who signed up.
  portalMenus?: ClientPortalMenu[];
  // When they agreed to the Terms and Privacy Policy, making their own account. Missing for a
  // client the team added.
  termsAcceptedAt?: Date;
  // What the client answered on the onboarding form. Missing until they start it.
  onboarding?: IClientOnboarding;
  // The SHA-256 of the key handed to whoever started onboarding without an account — it lets
  // them come back to their own answers (routes/onboarding.route.ts). Never sent anywhere.
  onboardingKeyHash?: string;
  user?: mongoose.Types.ObjectId;
  accountManager?: mongoose.Types.ObjectId;
  team: mongoose.Types.ObjectId[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Client:
 *       type: object
 *       description: A client company. People from the client sign in through User accounts (role "client") that point back here.
 *       properties:
 *         _id:
 *           type: string
 *         contactName:
 *           type: string
 *           description: Main contact person at the client
 *           example: Sarah Carter
 *         companyName:
 *           type: string
 *           example: Carter Injury Law
 *         email:
 *           type: string
 *           example: client@company.com
 *         phone:
 *           type: string
 *           example: "+19876543210"
 *         address:
 *           type: string
 *           example: Tampa, FL
 *         serviceTypes:
 *           type: array
 *           description: One or more services the client has signed up for
 *           items:
 *             type: string
 *           example: [SEO, Social Media]
 *         startDate:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [pending, active, on_hold, closed]
 *           example: active
 *         notes:
 *           type: string
 *           maxLength: 500
 *           description: Internal notes. Never shown in the client portal.
 *         onboarding:
 *           $ref: '#/components/schemas/ClientOnboarding'
 *         user:
 *           type: string
 *           description: User id of the login account created together with this client. Its name, email, phone and address follow this record.
 *         accountManager:
 *           type: string
 *           description: User id of the staff member who owns this client
 *         team:
 *           type: array
 *           description: User ids of the staff assigned to this client
 *           items:
 *             type: string
 *         createdBy:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     OnboardingFile:
 *       type: object
 *       properties:
 *         url: { type: string, description: DigitalOcean Spaces URL }
 *         name: { type: string }
 *         size: { type: number, description: Bytes }
 *         mimeType: { type: string }
 *     OnboardingAccount:
 *       type: object
 *       description: A Google or social account, as answered on the onboarding form
 *       properties:
 *         has: { type: string, enum: [yes, no, unsure] }
 *         link: { type: string, description: "Its link, name or ID" }
 *         access: { type: string, enum: [invite, secure], description: Invite our access email, or share the login through a secure link }
 *         accessGiven: { type: boolean }
 *         needsHelp: { type: boolean }
 *         wantsCreated: { type: boolean, description: "They don't have one: create it for them" }
 *     OnboardingMedia:
 *       type: object
 *       properties:
 *         mode: { type: string, enum: [upload, create, none] }
 *         files: { type: array, items: { $ref: '#/components/schemas/OnboardingFile' } }
 *         link: { type: string, description: A shared folder link }
 *         notes: { type: string, description: What they need created }
 *     ClientOnboarding:
 *       type: object
 *       description: >
 *         What the client answered on the onboarding form. Every answer is optional — a missing
 *         field means "not answered".
 *       properties:
 *         status: { type: string, enum: [in_progress, submitted] }
 *         submittedAt: { type: string, format: date-time }
 *         website:
 *           type: object
 *           properties:
 *             url: { type: string }
 *             hasNone: { type: boolean, description: "I don't have a website yet" }
 *             need: { type: string, enum: [new, redesign, "no"] }
 *             description: { type: string, maxLength: 2000 }
 *             competitors:
 *               type: array
 *               maxItems: 5
 *               items:
 *                 type: object
 *                 properties:
 *                   url: { type: string }
 *                   note: { type: string, description: What they like about it }
 *             pages: { type: array, items: { type: string }, example: [Home, About, Services, Contact] }
 *             features: { type: array, items: { type: string }, example: [Contact form, Online booking] }
 *         domain:
 *           type: object
 *           properties:
 *             has: { type: string, enum: [yes, no, unsure] }
 *             name: { type: string, example: yourbusiness.com }
 *             platform: { type: string, description: Where it is registered, example: GoDaddy }
 *             accessGiven: { type: boolean }
 *             needsHelp: { type: boolean }
 *             wantsCreated: { type: boolean, description: Register one for them }
 *             wishlist: { type: string, description: "Names they'd like, in order of preference" }
 *         hosting:
 *           type: object
 *           properties:
 *             has: { type: string, enum: [yes, no, unsure] }
 *             platform: { type: string, example: SiteGround }
 *             accessGiven: { type: boolean }
 *             needsHelp: { type: boolean }
 *             wantsCreated: { type: boolean, description: Set hosting up for them }
 *         cms:
 *           type: object
 *           description: The website's own login
 *           properties:
 *             platform: { type: string, example: WordPress }
 *             developer: { type: string, description: Who built or maintains a custom site }
 *             accessGiven: { type: boolean }
 *             needsHelp: { type: boolean }
 *         email:
 *           type: object
 *           description: A business email on their own domain
 *           properties:
 *             has: { type: string, enum: [yes, "no"] }
 *             provider: { type: string, example: Google Workspace (Gmail) }
 *             wantsCreated: { type: boolean, description: Set up Google Workspace for them }
 *             accounts: { type: integer, minimum: 1 }
 *             addresses: { type: string, example: "info@, david@, intake@" }
 *         logo:
 *           type: object
 *           properties:
 *             has: { type: string, enum: [yes, "no"] }
 *             link: { type: string, description: A shared folder holding the logo and brand files }
 *             files: { type: array, items: { $ref: '#/components/schemas/OnboardingFile' } }
 *             wantsCreated: { type: boolean, description: Design one for them }
 *             style: { type: string, maxLength: 2000 }
 *         google:
 *           type: object
 *           properties:
 *             businessProfile: { $ref: '#/components/schemas/OnboardingAccount' }
 *             analytics: { $ref: '#/components/schemas/OnboardingAccount' }
 *             searchConsole: { $ref: '#/components/schemas/OnboardingAccount' }
 *             tagManager: { $ref: '#/components/schemas/OnboardingAccount' }
 *             ads: { $ref: '#/components/schemas/OnboardingAccount' }
 *         social:
 *           type: object
 *           properties:
 *             facebook: { $ref: '#/components/schemas/OnboardingAccount' }
 *             instagram: { $ref: '#/components/schemas/OnboardingAccount' }
 *             youtube: { $ref: '#/components/schemas/OnboardingAccount' }
 *             linkedin: { $ref: '#/components/schemas/OnboardingAccount' }
 *             tiktok: { $ref: '#/components/schemas/OnboardingAccount' }
 *             x: { $ref: '#/components/schemas/OnboardingAccount' }
 *         media:
 *           type: object
 *           properties:
 *             professionalPhotos: { $ref: '#/components/schemas/OnboardingMedia' }
 *             businessPhotos: { $ref: '#/components/schemas/OnboardingMedia' }
 *             videos: { $ref: '#/components/schemas/OnboardingMedia' }
 */

// Short answers (a name, a link, a platform) and long ones (a description).
const shortText = { type: String, trim: true, maxlength: [ONBOARDING_TEXT_MAX_LENGTH, `Cannot exceed ${ONBOARDING_TEXT_MAX_LENGTH} characters`] as [number, string] };
const longText = { type: String, trim: true, maxlength: [ONBOARDING_LONG_TEXT_MAX_LENGTH, `Cannot exceed ${ONBOARDING_LONG_TEXT_MAX_LENGTH} characters`] as [number, string] };

// A list typed one item at a time: the services a business offers, the areas it serves.
const textList = {
  type: [shortText],
  default: [],
  validate: {
    validator: (list: unknown[]) => list.length <= ONBOARDING_MAX_LIST_ITEMS,
    message: `Add at most ${ONBOARDING_MAX_LIST_ITEMS}`,
  },
};

// A count or an amount of money: never below zero.
const amount = { type: Number, min: [0, "Use 0 or more"] as [number, string] };

const onboardingTargetSchema = new Schema<IOnboardingTarget>({ current: amount, goal: amount }, { _id: false });

const onboardingFileSchema = new Schema<IOnboardingFile>(
  {
    url: { type: String, required: [true, "File URL is required"], trim: true },
    name: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    mimeType: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

// What every platform we need access to carries.
const platformFields = {
  platform: shortText,
  accessGiven: { type: Boolean },
  needsHelp: { type: Boolean },
};

const onboardingAccountSchema = new Schema<IOnboardingAccount>(
  {
    has: { type: String, enum: ONBOARDING_HAS },
    link: shortText,
    access: { type: String, enum: ONBOARDING_ACCESS_METHODS },
    accessGiven: { type: Boolean },
    needsHelp: { type: Boolean },
    wantsCreated: { type: Boolean },
    loginUsername: shortText,
    loginPassword: { type: String },
  },
  { _id: false }
);

const onboardingMediaSchema = new Schema<IOnboardingMedia>(
  {
    mode: { type: String, enum: ONBOARDING_MEDIA_MODES },
    files: { type: [onboardingFileSchema], default: [] },
    link: shortText,
    notes: shortText,
  },
  { _id: false }
);

const onboardingSchema = new Schema<IClientOnboarding>(
  {
    status: { type: String, enum: ONBOARDING_STATUSES, default: "in_progress" },
    submittedAt: { type: Date },

    business: {
      type: new Schema(
        {
          description: longText,
          services: textList,
          areas: textList,
          contact: {
            type: new Schema(
              {
                isAccountOwner: { type: Boolean },
                name: shortText,
                email: { type: String, trim: true, lowercase: true, match: [EMAIL_REGEX, "Please enter a valid email address"] },
                phone: { type: String, trim: true, match: [PHONE_REGEX, "Please enter a valid phone number"] },
                reachBy: { type: String, enum: ONBOARDING_REACH_BY },
              },
              { _id: false }
            ),
          },
        },
        { _id: false }
      ),
    },

    goals: {
      type: new Schema(
        {
          revenue: { type: onboardingTargetSchema },
          leads: { type: onboardingTargetSchema },
          newClients: { type: onboardingTargetSchema },
          timeframe: { type: String, enum: ONBOARDING_GOAL_TIMEFRAMES },
          budget: { type: String, enum: ONBOARDING_BUDGETS },
          costPerLead: amount,
          clientValue: amount,
          leadSources: { type: [{ type: String, enum: ONBOARDING_LEAD_SOURCES }], default: [] },
        },
        { _id: false }
      ),
    },

    kickoffCall: {
      type: new Schema({ booked: { type: Boolean } }, { _id: false }),
    },

    website: {
      type: new Schema(
        {
          url: shortText,
          hasNone: { type: Boolean },
          need: { type: String, enum: ONBOARDING_WEBSITE_NEEDS },
          description: longText,
          competitors: {
            type: [new Schema({ url: shortText, note: shortText }, { _id: false })],
            default: [],
            validate: {
              validator: (list: unknown[]) => list.length <= ONBOARDING_MAX_COMPETITORS,
              message: `Add at most ${ONBOARDING_MAX_COMPETITORS} example websites`,
            },
          },
          pages: { type: [{ type: String, trim: true }], default: [] },
          features: { type: [{ type: String, trim: true }], default: [] },
        },
        { _id: false }
      ),
    },

    domain: {
      type: new Schema(
        {
          has: { type: String, enum: ONBOARDING_HAS },
          name: shortText,
          ...platformFields,
          wantsCreated: { type: Boolean },
          wishlist: shortText,
        },
        { _id: false }
      ),
    },

    hosting: {
      type: new Schema({ has: { type: String, enum: ONBOARDING_HAS }, ...platformFields, wantsCreated: { type: Boolean } }, { _id: false }),
    },

    cms: {
      type: new Schema({ ...platformFields, developer: shortText }, { _id: false }),
    },

    email: {
      type: new Schema(
        {
          has: { type: String, enum: ONBOARDING_YES_NO },
          provider: shortText,
          wantsCreated: { type: Boolean },
          accounts: { type: Number, min: [1, "At least one email account"], validate: { validator: Number.isInteger, message: "Must be a whole number" } },
          addresses: shortText,
        },
        { _id: false }
      ),
    },

    logo: {
      type: new Schema(
        {
          has: { type: String, enum: ONBOARDING_YES_NO },
          link: shortText,
          files: { type: [onboardingFileSchema], default: [] },
          wantsCreated: { type: Boolean },
          style: longText,
        },
        { _id: false }
      ),
    },

    google: {
      type: new Schema(
        {
          businessProfile: { type: onboardingAccountSchema },
          analytics: { type: onboardingAccountSchema },
          searchConsole: { type: onboardingAccountSchema },
          tagManager: { type: onboardingAccountSchema },
          ads: { type: onboardingAccountSchema },
        },
        { _id: false }
      ),
    },

    social: {
      type: new Schema(
        {
          facebook: { type: onboardingAccountSchema },
          instagram: { type: onboardingAccountSchema },
          youtube: { type: onboardingAccountSchema },
          linkedin: { type: onboardingAccountSchema },
          tiktok: { type: onboardingAccountSchema },
          x: { type: onboardingAccountSchema },
          metaAds: { type: onboardingAccountSchema },
        },
        { _id: false }
      ),
    },

    media: {
      type: new Schema(
        {
          professionalPhotos: { type: onboardingMediaSchema },
          businessPhotos: { type: onboardingMediaSchema },
          videos: { type: onboardingMediaSchema },
        },
        { _id: false }
      ),
    },
  },
  { _id: false }
);

const amountField = { type: Number, min: [0, "Use 0 or more"] as [number, string] };
// A date as the form holds it.
const dayField = { type: String, trim: true, match: [/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31"] as [RegExp, string] };
const shortList = { type: [shortText], default: [] };

const clientServicePlanSchema = new Schema<IClientServicePlan>(
  {
    name: { ...shortText, required: [true, "A service needs its name"] },
    fields: { type: [new Schema({ label: shortText, value: amountField }, { _id: false })], default: [] },
    monthly: { ...amountField, default: 0 },
    included: shortList,
    addons: { type: [new Schema({ label: shortText, price: amountField }, { _id: false })], default: [] },
  },
  { _id: false }
);

const clientDetailsSchema = new Schema<IClientDetails>(
  {
    communication: {
      type: new Schema({ methods: shortList, bestTime: shortText, timeZone: shortText }, { _id: false }),
    },
    business: {
      type: new Schema(
        {
          industry: shortText,
          businessType: shortText,
          website: shortText,
          googleBusinessProfile: shortText,
          serviceArea: shortText,
          targetAudience: shortText,
          competitors: longText,
          social: {
            type: new Schema({ facebook: shortText, instagram: shortText, linkedin: shortText, tiktok: shortText, youtube: shortText, x: shortText }, { _id: false }),
          },
          hasLogo: { type: Boolean },
          logoDesign: {
            type: new Schema({ add: { type: Boolean }, price: amountField, concepts: amountField, style: shortText }, { _id: false }),
          },
          otherDetails: longText,
        },
        { _id: false }
      ),
    },
    services: { type: [clientServicePlanSchema], default: [] },
    transfer: {
      type: new Schema({ has: shortList, needs: shortList, websiteDone: shortList, socialDone: shortList }, { _id: false }),
    },
    contract: {
      type: new Schema(
        {
          termMonths: amountField,
          endDate: dayField,
          renewal: shortText,
          cancellationNotice: shortText,
          renewalReminder: shortText,
          signed: { type: String, enum: CLIENT_CONTRACT_SIGNED },
          dateSigned: dayField,
          dateSent: dayField,
        },
        { _id: false }
      ),
    },
    billing: {
      type: new Schema({ paymentOnFile: { type: Boolean }, method: shortText, cycle: shortText, day: shortText, setupFee: shortText }, { _id: false }),
    },
    reportDelivery: shortText,
  },
  { _id: false }
);

const clientSchema = new Schema<IClient>(
  {
    contactName: {
      type: String,
      required: [true, "Client name is required"],
      trim: true,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email address is required"],
      trim: true,
      lowercase: true,
      unique: true,
      match: [EMAIL_REGEX, "Please enter a valid email address"],
    },
    phone: {
      type: String,
      trim: true,
      match: [PHONE_REGEX, "Please enter a valid phone number"],
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    serviceTypes: {
      type: [{ type: String, trim: true }],
      validate: {
        // A client who came in through the onboarding form has none to begin with: the team
        // picks them once they have taken the client on. So does any client still pending, and
        // one who made their own account (auth.controller.ts → clientSignup) — nobody on the
        // team created that record, so there is no `createdBy`.
        validator: function (this: IClient, value: string[]) {
          return value.length > 0 || this?.status === "pending" || Boolean(this?.onboarding) || !this?.createdBy;
        },
        message: "Select at least one service type",
      },
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    status: {
      type: String,
      enum: CLIENT_STATUSES,
      default: "active",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [CLIENT_NOTES_MAX_LENGTH, `Notes cannot exceed ${CLIENT_NOTES_MAX_LENGTH} characters`],
    },
    details: { type: clientDetailsSchema },
    // No default: an absent list is not an empty one (see IClient).
    portalMenus: { type: [{ type: String, enum: CLIENT_PORTAL_MENUS }], default: undefined },
    termsAcceptedAt: { type: Date },
    // Not set until the client starts the onboarding form.
    onboarding: { type: onboardingSchema },
    onboardingKeyHash: { type: String, select: false },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    accountManager: { type: Schema.Types.ObjectId, ref: "User" },
    team: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

clientSchema.index({ status: 1, createdAt: -1 });
clientSchema.index({ accountManager: 1 });
clientSchema.index({ team: 1 });
clientSchema.index({ companyName: 1 });

// A client's own changes carry its id as the "client" of the entry, so the
// audit history of one client (its record, its logins, its reports) lines up.
clientSchema.plugin(auditPlugin, {
  resource: "Client",
  clientField: "_id",
  actionByField: { status: "status_changed" },
});

export const Client = mongoose.model<IClient>("Client", clientSchema);
