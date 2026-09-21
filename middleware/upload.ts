import multer from "multer";
import { ApiError } from "../utils/ApiError";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const REVIEW_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new ApiError(422, "Only JPEG, PNG, WEBP, or GIF images are allowed")
      );
    }
    cb(null, true);
  },
});

export const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!REVIEW_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new ApiError(422, "Only JPEG, PNG, WEBP, or PDF attachments are allowed")
      );
    }
    cb(null, true);
  },
});
