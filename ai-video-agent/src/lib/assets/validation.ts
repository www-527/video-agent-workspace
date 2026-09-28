import { extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import yauzl from 'yauzl';
import {
  ALLOWED_ASSET_TYPES,
  AssetValidationError,
  MAX_DOCUMENT_BYTES,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_IMAGE_BYTES,
  type AllowedAssetMimeType,
} from './constants';

const IMAGE_MIME_TYPES = new Set<AllowedAssetMimeType>(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_MIME_BY_EXTENSION: Record<string, AllowedAssetMimeType> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
};

export interface ValidatedAssetUpload {
  extension: string;
  mimeType: AllowedAssetMimeType;
  kind: 'image' | 'document';
}

export async function validateAssetUpload(input: {
  originalName: string;
  declaredMimeType?: string;
  buffer: Buffer;
}): Promise<ValidatedAssetUpload> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.originalName.trim())) {
    throw new AssetValidationError('url_not_allowed', '不支持 URL 或远程文件地址。', 415);
  }
  const extension = extname(input.originalName).toLowerCase();
  const allowedMime = mimeForExtension(extension);
  if (!allowedMime) {
    throw new AssetValidationError('unsupported_type', '仅支持 PNG、JPEG、WebP、DOCX、Markdown 和 TXT 文件。', 415);
  }
  const maxBytes = IMAGE_MIME_TYPES.has(allowedMime) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (!input.buffer.length) throw new AssetValidationError('empty_file', '文件内容为空。');
  if (input.buffer.length > maxBytes) {
    throw new AssetValidationError('file_too_large', IMAGE_MIME_TYPES.has(allowedMime)
      ? '图片不能超过 15 MB。'
      : '文档不能超过 20 MB。', 413);
  }

  const declared = normalizeDeclaredMime(input.declaredMimeType, extension);
  if (declared && declared !== allowedMime) {
    throw new AssetValidationError('mime_mismatch', '文件类型与扩展名不一致，请选择原始文件。', 415);
  }

  if (IMAGE_MIME_TYPES.has(allowedMime)) {
    const detected = await fileTypeFromBuffer(input.buffer);
    if (!detected || detected.mime !== allowedMime) {
      throw new AssetValidationError('signature_mismatch', '图片文件头与扩展名不一致。', 415);
    }
  } else if (allowedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    await validateDocxArchive(input.buffer);
  } else {
    const detected = await fileTypeFromBuffer(input.buffer);
    if (detected) {
      throw new AssetValidationError('signature_mismatch', '该文件不是可读取的纯文本。', 415);
    }
  }

  return {
    extension,
    mimeType: allowedMime,
    kind: IMAGE_MIME_TYPES.has(allowedMime) ? 'image' : 'document',
  };
}

export async function validateDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new AssetValidationError('invalid_docx', 'DOCX 文件已损坏或不是有效文档。'));
        return;
      }
      const limits = { totalUncompressed: 0, entryCount: 0 };
      let hasContentTypes = false;
      let hasDocument = false;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(error);
      };
      zipFile.on('entry', entry => {
        const normalized = entry.fileName.replaceAll('\\', '/').toLowerCase();
        if (normalized === '[content_types].xml') hasContentTypes = true;
        if (normalized === 'word/document.xml') hasDocument = true;
        if (normalized.includes('vbaproject.bin') || normalized.includes('/macros/')) {
          fail(new AssetValidationError('macro_document', '不支持包含宏的文档。', 415));
          return;
        }
        try {
          accumulateDocxArchiveLimits(limits, entry.uncompressedSize);
        } catch (error) {
          fail(error as Error);
          return;
        }
        zipFile.readEntry();
      });
      zipFile.once('error', () => fail(new AssetValidationError('invalid_docx', 'DOCX 文件已损坏或不是有效文档。')));
      zipFile.once('end', () => {
        if (settled) return;
        settled = true;
        if (!hasContentTypes || !hasDocument) {
          reject(new AssetValidationError('invalid_docx', '文件缺少 DOCX 必需结构。'));
          return;
        }
        resolve();
      });
      zipFile.readEntry();
    });
  });
}

export function accumulateDocxArchiveLimits(
  state: { totalUncompressed: number; entryCount: number },
  entryUncompressedSize: number,
): void {
  state.entryCount += 1;
  state.totalUncompressed += entryUncompressedSize;
  if (state.entryCount > 20_000 || state.totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new AssetValidationError('docx_expansion_limit', 'DOCX 解压后的内容超过 100 MB 限制。', 413);
  }
}

function mimeForExtension(extension: string): AllowedAssetMimeType | null {
  for (const [mimeType, extensions] of Object.entries(ALLOWED_ASSET_TYPES)) {
    if ((extensions as readonly string[]).includes(extension)) return mimeType as AllowedAssetMimeType;
  }
  return null;
}

function normalizeDeclaredMime(value: string | undefined, extension: string): AllowedAssetMimeType | null {
  const normalized = value?.split(';', 1)[0].trim().toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') return TEXT_MIME_BY_EXTENSION[extension] ?? null;
  return normalized in ALLOWED_ASSET_TYPES ? normalized as AllowedAssetMimeType : normalized as AllowedAssetMimeType;
}
