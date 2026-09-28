export const CODEX_TEST_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_CODEX_TEST_IMAGES_PER_MESSAGE = 10;
export const MAX_CODEX_TEST_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_CODEX_TEST_REQUEST_IMAGE_BYTES = 60 * 1024 * 1024;

export type CodexTestImageMimeType = typeof CODEX_TEST_IMAGE_MIME_TYPES[number];

export interface CodexTestImageInput {
  dataUrl: string;
  mimeType: CodexTestImageMimeType;
  byteSize: number;
  /** Caller-provided display name; never sent as part of the image payload. */
  label?: string;
}

export interface CodexTestInputMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: CodexTestImageInput[];
}

export interface CodexTestImageDiagnostic {
  type: 'input_image';
  mimeType: CodexTestImageMimeType;
  byteSize: number;
  dataUrlBytes: number;
}

const dataUrlPattern = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/;

export function isCodexTestImageMimeType(value: string): value is CodexTestImageMimeType {
  return (CODEX_TEST_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function validateCodexTestImageMetadata(images: ReadonlyArray<Pick<CodexTestImageInput, 'mimeType' | 'byteSize'>>): void {
  if (images.length > MAX_CODEX_TEST_IMAGES_PER_MESSAGE) throw new Error(`单条消息最多上传 ${MAX_CODEX_TEST_IMAGES_PER_MESSAGE} 张图片。`);
  for (const image of images) {
    if (!isCodexTestImageMimeType(image.mimeType)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。');
    if (!Number.isSafeInteger(image.byteSize) || image.byteSize < 1) throw new Error('图片数据无效。');
    if (image.byteSize > MAX_CODEX_TEST_IMAGE_BYTES) throw new Error('单张图片不能超过 15 MB。');
  }
}

export function validateCodexTestRequestImages(messages: ReadonlyArray<CodexTestInputMessage>): void {
  let totalBytes = 0;
  for (const message of messages) {
    if (message.role === 'assistant' && message.images?.length) throw new Error('助手消息不能包含图片。');
    validateCodexTestImageMetadata(message.images ?? []);
    for (const image of message.images ?? []) totalBytes += image.byteSize;
  }
  if (totalBytes > MAX_CODEX_TEST_REQUEST_IMAGE_BYTES) throw new Error('当前对话图片总量不能超过 60 MB。');
}

export function parseCodexTestImageDataUrl(dataUrl: string): CodexTestImageInput {
  const match = dataUrlPattern.exec(dataUrl);
  if (!match?.[1] || match[2] === undefined || match[2].length === 0 || match[2].length % 4 !== 0) {
    throw new Error('图片 data URL 无效。');
  }
  const mimeType = match[1] as CodexTestImageMimeType;
  let byteSize = 0;
  try {
    const decoded = atob(match[2]);
    byteSize = decoded.length;
    if (btoa(decoded) !== match[2]) throw new Error('invalid base64');
  } catch {
    throw new Error('图片 Base64 数据无效。');
  }
  const image = { dataUrl, mimeType, byteSize };
  validateCodexTestImageMetadata([image]);
  return image;
}

export function summarizeCodexTestImage(image: CodexTestImageInput): CodexTestImageDiagnostic {
  return {
    type: 'input_image',
    mimeType: image.mimeType,
    byteSize: image.byteSize,
    dataUrlBytes: new TextEncoder().encode(image.dataUrl).byteLength,
  };
}
