import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { EMAIL_REGEX, PHONE_REGEX } from "./user.model";

export const CLIENT_STATUSES = ["pending", "active", "on_hold", "closed"] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_NOTES_MAX_LENGTH = 500;

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
 */
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
        validator: (value: string[]) => value.length > 0,
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
