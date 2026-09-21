import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import path from "path";
import { spacesClient } from "../config/spaces";
import { env } from "../config/env";

export const uploadToSpaces = async (
  file: Express.Multer.File,
  subfolder = ""
): Promise<string> => {
  const ext = path.extname(file.originalname);
  const key = [env.doSpaces.folder, subfolder, `${randomUUID()}${ext}`]
    .filter(Boolean)
    .join("/");

  await spacesClient.send(
    new PutObjectCommand({
      Bucket: env.doSpaces.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read",
    })
  );

  return `${env.doSpaces.cdnUrl}/${key}`;
};

export const deleteFromSpaces = async (fileUrl?: string): Promise<void> => {
  if (!fileUrl || !fileUrl.startsWith(env.doSpaces.cdnUrl)) return;

  const key = fileUrl.replace(`${env.doSpaces.cdnUrl}/`, "");

  await spacesClient.send(
    new DeleteObjectCommand({
      Bucket: env.doSpaces.bucket,
      Key: key,
    })
  );
};
