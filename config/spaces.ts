import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

export const spacesClient = new S3Client({
  endpoint: env.doSpaces.endpoint,
  region: env.doSpaces.region,
  credentials: {
    accessKeyId: env.doSpaces.key,
    secretAccessKey: env.doSpaces.secret,
  },
});
