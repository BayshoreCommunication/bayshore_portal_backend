import multer from "multer";
import type { RequestHandler } from "express";
import { ApiError } from "../utils/ApiError";
import { CONTENT_COMMENT_MAX_ATTACHMENTS, CONTENT_REQUEST_MAX_FILES, MEDIA_MAX_FILE_SIZE, MEDIA_MIME_TYPES } from "../models/content.model";
import { PROJECT_FILE_MIME_TYPES, PROJECT_MAX_FILES, PROJECT_MAX_FILE_SIZE } from "../models/project.model";
import { CONTENT_BATCH_MAX_PIECES } from "../validators/content.validator";

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

// Images, videos and documents for content (uploaded to DigitalOcean Spaces). The
// multer size limit is only the ceiling for the largest kind of file (video); the
// controller checks each file against the exact cap for its media and against what
// the piece's content type accepts.
const CONTENT_ALLOWED_MIME_TYPES = Object.values(MEDIA_MIME_TYPES).flat();

const contentFileFilter: multer.Options["fileFilter"] = (req, file, cb) => {
  if (!CONTENT_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new ApiError(422, `Unsupported file type (${file.originalname}) — images, MP4/MOV/WEBM video, or PDF/Word/text documents only`)
    );
  }
  cb(null, true);
};

// Multer's own errors ("Too many files", "File too large"), reworded for content —
// the shared error handler's wording is written for the 5MB image uploads above.
const withContentErrors =
  (handler: RequestHandler, maxFiles: number): RequestHandler =>
  (req, res, next) =>
    handler(req, res, (err?: unknown) => {
      if (!(err instanceof multer.MulterError)) return next(err);
      const messages: Partial<Record<multer.ErrorCode, string>> = {
        LIMIT_FILE_COUNT: `Too many files — at most ${maxFiles} in one upload`,
        LIMIT_FILE_SIZE: `A file is too large — videos up to ${MEDIA_MAX_FILE_SIZE.video / (1024 * 1024)}MB, documents ${
          MEDIA_MAX_FILE_SIZE.doc / (1024 * 1024)
        }MB, images ${MEDIA_MAX_FILE_SIZE.image / (1024 * 1024)}MB`,
        LIMIT_UNEXPECTED_FILE: `Unexpected file field "${err.field}" — send files as "files"`,
      };
      next(new ApiError(422, messages[err.code] ?? err.message));
    });

// One piece: up to CONTENT_REQUEST_MAX_FILES at a time under `files` (older callers may still
// send one `file`), and its video's cover image under `thumbnail`.
export const contentUpload = withContentErrors(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEDIA_MAX_FILE_SIZE.video, files: CONTENT_REQUEST_MAX_FILES + 1 },
    fileFilter: contentFileFilter,
  }).fields([
    { name: "files", maxCount: CONTENT_REQUEST_MAX_FILES },
    { name: "file", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  CONTENT_REQUEST_MAX_FILES
);

// Several pieces in one request: each piece's files arrive under `files[<piece index>]`,
// and its video's cover image under `thumbnails[<piece index>]`. Everything is held in memory
// until it goes to Spaces, so the total is capped — a longer list comes over several requests.
export const CONTENT_BATCH_MAX_FILES = CONTENT_REQUEST_MAX_FILES;

export const contentBatchUpload = withContentErrors(
  multer({
    storage: multer.memoryStorage(),
    // …plus one thumbnail for each piece.
    limits: { fileSize: MEDIA_MAX_FILE_SIZE.video, files: CONTENT_BATCH_MAX_FILES + CONTENT_BATCH_MAX_PIECES },
    fileFilter: contentFileFilter,
  }).any(),
  CONTENT_BATCH_MAX_FILES
);

// Files attached to a comment, under `files`.
export const commentUpload = withContentErrors(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEDIA_MAX_FILE_SIZE.video, files: CONTENT_COMMENT_MAX_ATTACHMENTS },
    fileFilter: contentFileFilter,
  }).fields([{ name: "files", maxCount: CONTENT_COMMENT_MAX_ATTACHMENTS }]),
  CONTENT_COMMENT_MAX_ATTACHMENTS
);

// Files attached to a project, under `files`. Briefs, spreadsheets, artwork — see
// PROJECT_FILE_MIME_TYPES for what's accepted and why it isn't "anything".
const projectFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROJECT_MAX_FILE_SIZE, files: PROJECT_MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (!PROJECT_FILE_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new ApiError(422, `Unsupported file type (${file.originalname}) — images, PDF, Word, Excel, PowerPoint, text, ZIP or MP4/MOV/WEBM video only`)
      );
    }
    cb(null, true);
  },
}).fields([{ name: "files", maxCount: PROJECT_MAX_FILES }]);

// Multer's own errors, reworded for projects.
export const projectUpload: RequestHandler = (req, res, next) =>
  projectFiles(req, res, (err?: unknown) => {
    if (!(err instanceof multer.MulterError)) return next(err);
    const messages: Partial<Record<multer.ErrorCode, string>> = {
      LIMIT_FILE_COUNT: `Too many files — a project can have at most ${PROJECT_MAX_FILES}`,
      LIMIT_FILE_SIZE: `A file is too large — up to ${PROJECT_MAX_FILE_SIZE / (1024 * 1024)}MB each`,
      LIMIT_UNEXPECTED_FILE: `Unexpected file field "${err.field}" — send files as "files"`,
    };
    next(new ApiError(422, messages[err.code] ?? err.message));
  });
