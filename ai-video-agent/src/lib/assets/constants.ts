export const ALLOWED_ASSET_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
} as const;

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BATCH_BYTES = 100 * 1024 * 1024;
export const MAX_NORMALIZED_DOCUMENT_CHARS = 500_000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export type AllowedAssetMimeType = keyof typeof ALLOWED_ASSET_TYPES;

export class AssetValidationError extends Error {
  readonly status: number;

  constructor(readonly code: string, message: string, status = 400) {
    super(message);
    this.name = 'AssetValidationError';
    this.status = status;
  }
}
