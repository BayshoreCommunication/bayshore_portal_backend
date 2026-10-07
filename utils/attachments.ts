import { MEDIA_MAX_FILE_SIZE, mediaOfMimeType, type IContentFile } from "../models/content.model";
import { ApiError } from "./ApiError";
import { deleteFromSpaces, uploadToSpaces } from "./uploadToSpaces";

// Files people attach to what they write — a comment on a piece, a message in a conversation.
// Any supported media, each within its own size cap.

export const removeFiles = (urls: (string | undefined)[]) => Promise.all(urls.map((url) => deleteFromSpaces(url).catch(() => undefined)));

// Checks every file first, then sends them to DigitalOcean Spaces under `folder`. If one
// upload fails, the ones already sent are removed.
export const uploadAttachments = async (files: Express.Multer.File[], folder: string): Promise<IContentFile[]> => {
  const checked = files.map((file) => {
    const media = mediaOfMimeType(file.mimetype);
    if (!media) throw new ApiError(422, `"${file.originalname}" isn't a supported file type`);
    if (file.size > MEDIA_MAX_FILE_SIZE[media]) {
      throw new ApiError(422, `"${file.originalname}" is too large (max ${MEDIA_MAX_FILE_SIZE[media] / (1024 * 1024)}MB for ${media})`);
    }
    return { file, media };
  });

  const uploaded: IContentFile[] = [];
  try {
    for (const { file, media } of checked) {
      const url = await uploadToSpaces(file, folder);
      uploaded.push({ url, name: file.originalname, size: file.size, mimeType: file.mimetype, media });
    }
    return uploaded;
  } catch (error) {
    await removeFiles(uploaded.map((file) => file.url));
    throw error;
  }
};
