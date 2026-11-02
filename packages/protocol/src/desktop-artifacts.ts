import { z } from 'zod';
import { artifactExtractionRequestSchema, artifactTextLimit } from './artifacts.js';

const base = {
  contractVersion: z.literal(1),
  selection: artifactExtractionRequestSchema,
  openAfterSave: z.boolean(),
};
export const artifactSaveRequestSchema = z.discriminatedUnion('representation', [
  z.object({ ...base, representation: z.literal('original') }).strict(),
  z
    .object({
      ...base,
      representation: z.literal('draft'),
      draft: z
        .string()
        .max(artifactTextLimit)
        .refine(
          (text) =>
            new TextDecoder().decode(new TextEncoder().encode(text)) === text &&
            !text.includes('\0') &&
            new TextEncoder().encode(text).byteLength <= artifactTextLimit,
        ),
    })
    .strict(),
]);
export type ArtifactSaveRequest = z.infer<typeof artifactSaveRequestSchema>;
export type ArtifactSaveResult = {
  status: 'saved' | 'saved_opened' | 'saved_open_failed' | 'cancelled' | 'failed' | 'write_failed';
};
export interface DesktopArtifacts {
  readonly contractVersion: 1;
  saveMarkdown(request: ArtifactSaveRequest): Promise<ArtifactSaveResult>;
}
