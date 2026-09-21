import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { auditPlugin } from "../plugins/auditPlugin";

export const USER_ROLES = [
  "employee",
  "client",
  "o_level",
  "executive",
  "hr",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["pending", "active", "inactive", "blocked"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

// Only "active" users may sign in / use the API; this is the error shown for the rest.
export const USER_THEMES = ["dark", "light"] as const;

export type UserTheme = (typeof USER_THEMES)[number];

export const STATUS_BLOCK_MESSAGES: Record<Exclude<UserStatus, "active">, string> = {
  pending: "Your account is pending approval",
  inactive: "Your account is inactive. Please contact support",
  blocked: "Your account has been blocked. Please contact support",
};

export interface IUser extends Document {
  fullName: string;
  client?: mongoose.Types.ObjectId;
  companyName?: string;
  designation?: string;
  department?: string;
  responsibilities?: string;
  address?: string;
  phone?: string;
  email?: string;
  avatar?: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  muted: boolean;
  theme: UserTheme;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_REGEX = /^[+]?[0-9]{7,15}$/;

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: 656f1c2e8f1b2c0012a34567
 *         fullName:
 *           type: string
 *           example: John Doe
 *         client:
 *           type: string
 *           description: Client this login belongs to (users with role "client")
 *         companyName:
 *           type: string
 *           description: Company the user belongs to (mainly for clients)
 *           example: Bayshore Ltd.
 *         designation:
 *           type: string
 *           description: Job title (mainly for employees/managers)
 *           example: Software Engineer
 *         department:
 *           type: string
 *           example: Engineering
 *         responsibilities:
 *           type: string
 *           description: What this person is responsible for
 *           example: Frontend development, code review
 *         address:
 *           type: string
 *           example: House 12, Road 4, Uttara, Dhaka
 *         phone:
 *           type: string
 *           example: "+8801234567890"
 *         email:
 *           type: string
 *           example: john@example.com
 *         avatar:
 *           type: string
 *           example: https://example.com/avatars/john.jpg
 *         role:
 *           type: string
 *           enum: [employee, client, o_level, executive, hr, assistant_manager, manager, admin, superadmin]
 *           example: employee
 *         status:
 *           type: string
 *           enum: [pending, active, inactive, blocked]
 *           description: Only active users can sign in
 *           example: active
 *         muted:
 *           type: boolean
 *           description: Muted by an admin; can be toggled independently of status
 *           example: false
 *         theme:
 *           type: string
 *           enum: [dark, light]
 *           description: The user's preferred UI theme
 *           example: dark
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */
const userSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      index: true,
    },
    companyName: {
      type: String,
      trim: true,
      default: "",
    },
    designation: {
      type: String,
      trim: true,
      default: "",
    },
    department: {
      type: String,
      trim: true,
      default: "",
    },
    responsibilities: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      match: [PHONE_REGEX, "Please enter a valid phone number"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      match: [EMAIL_REGEX, "Please enter a valid email address"],
    },
    avatar: {
      type: String,
      trim: true,
      default: "",
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: "employee",
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
    },
    muted: {
      type: Boolean,
      default: false,
    },
    theme: {
      type: String,
      enum: USER_THEMES,
      default: "dark",
    },
    lastLoginAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, status: 1 });

userSchema.pre("validate", function (next) {
  if (!this.email && !this.phone) {
    this.invalidate("email", "Either email or phone is required");
  }
  next();
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { password, ...rest } = ret as typeof ret & { password?: string };
    return rest;
  },
});

userSchema.plugin(auditPlugin, {
  resource: "User",
  clientField: "client",
  actionByField: {
    password: "password_changed",
    role: "role_changed",
    status: "status_changed",
  },
});

export const User = mongoose.model<IUser>("User", userSchema);
