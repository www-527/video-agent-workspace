import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import mammoth from 'mammoth';
import { AssetValidationError, MAX_NORMALIZED_DOCUMENT_CHARS, type AllowedAssetMimeType } from './constants';

const MAX_CHUNK_CHARS = 4_000;
const MAX_DIGEST_CHARS = 1_200;

export interface DocumentChunk {
  index: number;
  start: number;
  end: number;
  heading?: string;
  text: string;
  hash: string;
}

export interface ExtractedDocument {
  version: 'asset-extracted-v1';
  text: string;
  chunks: DocumentChunk[];
}

export interface DocumentDigest {
  version: 'asset-digest-v1';
  title: string;
  digest: string;
  keywords: string[];
  characterCount: number;
  chunkCount: number;
}

export async function extractDocument(buffer: Buffer, mimeType: AllowedAssetMimeType, originalName: string): Promise<{
  extracted: ExtractedDocument;
  digest: DocumentDigest;
}> {
  let text: string;
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } catch (error) {
      throw new AssetValidationError('docx_parse_failed', 'DOCX 内容无法读取，请确认文件没有损坏。');
    }
  } else {
    text = decodeTextBuffer(buffer);
  }
  const normalized = normalizeDocumentText(text);
  if (!normalized) throw new AssetValidationError('empty_document', '文档中没有可读取的文字。');
  if (normalized.length > MAX_NORMALIZED_DOCUMENT_CHARS) {
    throw new AssetValidationError('document_too_long', '文档规范化后超过 500,000 字符限制。', 413);
  }
  const chunks = chunkDocument(normalized);
  const title = inferTitle(normalized, originalName);
  return {
    extracted: { version: 'asset-extracted-v1', text: normalized, chunks },
    digest: {
      version: 'asset-digest-v1',
      title,
      digest: buildDigest(chunks),
      keywords: extractKeywords(normalized),
      characterCount: normalized.length,
      chunkCount: chunks.length,
    },
  };
}

export function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return buffer.subarray(3).toString('utf8');
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return iconv.decode(buffer.subarray(2), 'utf16-le');
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return iconv.decode(buffer.subarray(2), 'utf16-be');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'gb18030');
  }
}

export function normalizeDocumentText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function chunkDocument(text: string): DocumentChunk[] {
  const sections = text.split(/(?=^(?:#{1,6}\s+|第[一二三四五六七八九十百\d]+[章节部分]\s*))/m);
  const chunks: DocumentChunk[] = [];
  let cursor = 0;
  for (const section of sections) {
    const heading = section.match(/^(?:#{1,6}\s+)?([^\n]{1,120})/)?.[1]?.trim();
    const paragraphs = section.split(/\n{2,}/).filter(Boolean);
    let current = '';
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
        pushChunk(current, heading, chunks, cursor);
        cursor += current.length;
        current = '';
      }
      if (paragraph.length > MAX_CHUNK_CHARS) {
        if (current) {
          pushChunk(current, heading, chunks, cursor);
          cursor += current.length;
          current = '';
        }
        for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
          const slice = paragraph.slice(offset, offset + MAX_CHUNK_CHARS);
          pushChunk(slice, heading, chunks, cursor);
          cursor += slice.length;
        }
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }
    if (current) {
      pushChunk(current, heading, chunks, cursor);
      cursor += current.length;
    }
  }
  return chunks;
}

export function selectRelevantDocumentChunks(chunks: DocumentChunk[], query: string, limit = 4): DocumentChunk[] {
  const terms = query.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const grams = terms.flatMap(term => /[\u4e00-\u9fff]/.test(term)
    ? Array.from({ length: Math.max(0, term.length - 1) }, (_, index) => term.slice(index, index + 2))
    : [term]);
  return chunks
    .map(chunk => {
      const haystack = `${chunk.heading ?? ''}\n${chunk.text}`.toLowerCase();
      const score = grams.reduce((total, term) => total + (haystack.includes(term) ? (chunk.heading?.includes(term) ? 3 : 1) : 0), 0);
      return { chunk, score };
    })
    .sort((left, right) => right.score - left.score || left.chunk.index - right.chunk.index)
    .slice(0, Math.max(1, limit))
    .map(item => item.chunk);
}

function pushChunk(text: string, heading: string | undefined, chunks: DocumentChunk[], start: number) {
  chunks.push({
    index: chunks.length,
    start,
    end: start + text.length,
    ...(heading ? { heading } : {}),
    text,
    hash: createHash('sha256').update(text).digest('hex'),
  });
}

function inferTitle(text: string, originalName: string): string {
  const heading = text.match(/^(?:#{1,6}\s+)?([^\n]{2,120})/)?.[1]?.trim();
  return heading || originalName.replace(/\.[^.]+$/, '');
}

function buildDigest(chunks: DocumentChunk[]): string {
  const selected: string[] = [];
  let length = 0;
  for (const chunk of chunks) {
    const candidate = chunk.text.replace(/\s+/g, ' ').trim();
    if (!candidate) continue;
    const remaining = MAX_DIGEST_CHARS - length;
    if (remaining <= 0) break;
    selected.push(candidate.slice(0, remaining));
    length += Math.min(candidate.length, remaining);
  }
  return selected.join('\n');
}

function extractKeywords(text: string): string[] {
  const candidates = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,8}/g) ?? [];
  const stop = new Set(['我们', '你们', '他们', '这个', '一个', '以及', '可以', '进行', '通过', '如果', 'the', 'and', 'with', 'that']);
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (stop.has(candidate)) continue;
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([keyword]) => keyword);
}
