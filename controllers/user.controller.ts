import type { Request, Response } from "express";
import { User, type UserRole } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { uploadToSpaces, deleteFromSpaces } from "../utils/uploadToSpaces";

const CREATABLE_ROLES_BY: Record<UserRole, UserRole[]> = {
  superadmin: ["employee", "client", "o_level", "executive", "hr", "assistant_manager", "manager", "admin", "superadmin"],
  admin: ["employee", "client", "o_level", "executive", "hr", "assistant_manager", "manager"],
  assistant_manager: [],
  manager: [],
  executive: [],
  hr: [],
  employee: [],
  o_level: [],
  client: [],
};

export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const {
    fullName,
    companyName,
    designation,
    department,
    responsibilities,
    address,
    phone,
    email,
    avatar,
    password,
    role,
    status,
    muted,
  } = req.body;

  const requester = req.user!;
  const allowedRoles = CREATABLE_ROLES_BY[requester.role];

  if (!allowedRoles.includes(role)) {
    throw new ApiError(
      403,
      `You are not allowed to create a user with role "${role}"`
    );
  }

  if (email) {
    const existing = await User.findOne({ email: String(email).toLowerCase() });
    if (existing) throw new ApiError(409, "Email is already registered");
  }

  if (phone) {
    const existing = await User.findOne({ phone });
    if (existing) throw new ApiError(409, "Phone number is already registered");
  }

  const user = await User.create({
    fullName,
    companyName,
    designation,
    department,
    responsibilities,
    address,
    phone,
    email,
    avatar,
    password,
    role,
    status,
    muted,
  });

  return ApiResponse(res, 201, "Staff user created successfully", user);
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  return ApiResponse(res, 200, "Profile fetched successfully", req.user);
});

// Roles & Permissions: viewing is broader than managing — a requester always
// sees their own role tier too (peers + self), even though CREATABLE_ROLES_BY
// (used for create/update/delete below) may not let them manage that tier.
// superadmin sees manager/admin/superadmin; admin sees manager/admin.
export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const manageableRoles = CREATABLE_ROLES_BY[requester.role];
  const visibleRoles = Array.from(
    new Set([...manageableRoles, requester.role])
  );

  const staff = await User.find({ role: { $in: visibleRoles } }).sort({
    createdAt: -1,
  });

  return ApiResponse(res, 200, "Staff fetched successfully", staff);
});

export const updateStaff = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const manageableRoles = CREATABLE_ROLES_BY[requester.role];

  const target = await User.findOne({
    _id: req.params.id,
    role: { $in: manageableRoles },
  });
  if (!target) throw new ApiError(404, "Staff member not found");

  if (target.id === requester.id) {
    throw new ApiError(
      400,
      "Use your own profile settings to update your account"
    );
  }

  const {
    fullName,
    companyName,
    designation,
    department,
    responsibilities,
    address,
    email,
    phone,
    role,
    status,
    muted,
  } = req.body;

  if (role !== undefined && !manageableRoles.includes(role)) {
    throw new ApiError(
      403,
      `You are not allowed to assign the role "${role}"`
    );
  }

  if (email && email.toLowerCase() !== target.email) {
    const existing = await User.findOne({ email: String(email).toLowerCase() });
    if (existing) throw new ApiError(409, "Email is already registered");
  }

  if (phone && phone !== target.phone) {
    const existing = await User.findOne({ phone });
    if (existing) throw new ApiError(409, "Phone number is already registered");
  }

  if (fullName !== undefined) target.fullName = fullName;
  if (companyName !== undefined) target.companyName = companyName;
  if (designation !== undefined) target.designation = designation;
  if (department !== undefined) target.department = department;
  if (responsibilities !== undefined) target.responsibilities = responsibilities;
  if (address !== undefined) target.address = address;
  if (email !== undefined) target.email = email;
  if (phone !== undefined) target.phone = phone;
  if (role !== undefined) target.role = role;
  if (status !== undefined) target.status = status;
  if (muted !== undefined) target.muted = muted;

  await target.save();

  return ApiResponse(res, 200, "Staff member updated successfully", target);
});

export const deleteStaff = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const manageableRoles = CREATABLE_ROLES_BY[requester.role];

  const target = await User.findOne({
    _id: req.params.id,
    role: { $in: manageableRoles },
  });
  if (!target) throw new ApiError(404, "Staff member not found");

  if (target.id === requester.id) {
    throw new ApiError(400, "You cannot delete your own account");
  }

  const avatar = target.avatar;
  await target.deleteOne();
  if (avatar) await deleteFromSpaces(avatar);

  return ApiResponse(res, 200, "Staff member deleted successfully");
});

// General settings: any authenticated user editing their own account.
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const {
    fullName,
    email,
    phone,
    companyName,
    designation,
    department,
    responsibilities,
    address,
    theme,
  } = req.body;

  if (email && email.toLowerCase() !== requester.email) {
    const existing = await User.findOne({ email: String(email).toLowerCase() });
    if (existing) throw new ApiError(409, "Email is already registered");
  }

  if (phone && phone !== requester.phone) {
    const existing = await User.findOne({ phone });
    if (existing) throw new ApiError(409, "Phone number is already registered");
  }

  if (fullName !== undefined) requester.fullName = fullName;
  if (email !== undefined) requester.email = email;
  if (phone !== undefined) requester.phone = phone;
  if (companyName !== undefined) requester.companyName = companyName;
  if (designation !== undefined) requester.designation = designation;
  if (department !== undefined) requester.department = department;
  if (responsibilities !== undefined) requester.responsibilities = responsibilities;
  if (theme !== undefined) requester.theme = theme;
  if (address !== undefined) requester.address = address;

  await requester.save();

  return ApiResponse(res, 200, "Profile updated successfully", requester);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  const requester = await User.findById(req.user!.id).select("+password");
  if (!requester) throw new ApiError(401, "User no longer exists");

  const matches = await requester.comparePassword(currentPassword);
  if (!matches) throw new ApiError(401, "Current password is incorrect");

  requester.password = newPassword;
  await requester.save();

  return ApiResponse(res, 200, "Password updated successfully");
});

export const updateAvatar = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(422, "Avatar image file is required");

  const requester = req.user!;
  const previousAvatar = requester.avatar;

  requester.avatar = await uploadToSpaces(req.file, "avatars");
  await requester.save();

  if (previousAvatar) {
    await deleteFromSpaces(previousAvatar);
  }

  return ApiResponse(res, 200, "Avatar updated successfully", requester);
});
