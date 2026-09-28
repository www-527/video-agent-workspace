import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MAX_DOCX_UNCOMPRESSED_BYTES } from '@/lib/assets/constants';
import {
  chunkDocument,
  decodeTextBuffer,
  extractDocument,
  normalizeDocumentText,
  selectRelevantDocumentChunks,
} from '@/lib/assets/document';
import { accumulateDocxArchiveLimits, validateAssetUpload } from '@/lib/assets/validation';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('project asset validation and parsing', () => {
  it('accepts a real PNG and rejects forged, GIF, PDF, URL, and binary-text inputs', async () => {
    await expect(validateAssetUpload({
      originalName: 'product.png',
      declaredMimeType: 'image/png',
      buffer: PNG_1X1,
    })).resolves.toMatchObject({ mimeType: 'image/png', kind: 'image', extension: '.png' });

    await expect(validateAssetUpload({
      originalName: 'forged.png',
      declaredMimeType: 'image/png',
      buffer: Buffer.from('%PDF-1.7\nnot an image'),
    })).rejects.toMatchObject({ code: 'signature_mismatch', status: 415 });

    await expect(validateAssetUpload({
      originalName: 'animation.gif',
      declaredMimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    })).rejects.toMatchObject({ code: 'unsupported_type', status: 415 });

    await expect(validateAssetUpload({
      originalName: 'brief.pdf',
      declaredMimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    })).rejects.toMatchObject({ code: 'unsupported_type', status: 415 });

    await expect(validateAssetUpload({
      originalName: 'https://example.com/product.png',
      declaredMimeType: 'image/png',
      buffer: PNG_1X1,
    })).rejects.toMatchObject({ code: 'url_not_allowed', status: 415 });

    await expect(validateAssetUpload({
      originalName: 'notes.txt',
      declaredMimeType: 'text/plain',
      buffer: PNG_1X1,
    })).rejects.toMatchObject({ code: 'signature_mismatch', status: 415 });
  });

  it('enforces the DOCX expansion limit before extraction', () => {
    const state = { totalUncompressed: 1, entryCount: 1 };
    expect(() => accumulateDocxArchiveLimits(state, MAX_DOCX_UNCOMPRESSED_BYTES)).toThrow('超过 100 MB');
  });

  it('decodes fallback Chinese text, removes controls, chunks it, and ranks relevant sections', () => {
    const decoded = decodeTextBuffer(iconv.encode('产品发布\n\n核心卖点是轻量化', 'gb18030'));
    expect(decoded).toContain('核心卖点');
    const normalized = normalizeDocumentText(`产品发布\u0000\r\n\r\n${decoded}`);
    expect(normalized).not.toContain('\u0000');
    const chunks = chunkDocument(`${normalized}\n\n## 使用场景\n适合户外拍摄和旅行记录。`);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(chunk => chunk.hash.length === 64)).toBe(true);
    expect(selectRelevantDocumentChunks(chunks, '户外旅行', 1)[0]?.text).toContain('户外');
  });

  it('accepts and extracts a minimal non-macro DOCX', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>新品发布核心卖点</w:t></w:r></w:p></w:body>
      </w:document>`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(validateAssetUpload({
      originalName: 'brief.docx',
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    })).resolves.toMatchObject({ kind: 'document' });
    const parsed = await extractDocument(
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'brief.docx',
    );
    expect(parsed.extracted.text).toContain('新品发布核心卖点');
    expect(parsed.digest).toMatchObject({ version: 'asset-digest-v1', characterCount: 8, chunkCount: 1 });
  });
});
