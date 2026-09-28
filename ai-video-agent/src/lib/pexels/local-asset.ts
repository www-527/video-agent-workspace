import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';

const PEXELS_DATA_PREFIX = '/api/data/pexels/';
const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024;

export interface LocalPexelsImageInput {
  dataUrl: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  byteLength: number;
}

export async function hashLocalPexelsAsset(localPath: string): Promise<string> {
  const file = await readLocalPexelsAsset(localPath);
  return createHash('sha256').update(file).digest('hex');
}

export async function verifyLocalPexelsAsset(localPath: string, expectedHash?: string): Promise<string> {
  const hash = await hashLocalPexelsAsset(localPath);
  if (expectedHash && expectedHash !== 'missing' && hash !== expectedHash) {
    throw new Error('候选图片文件校验失败，请重新搜索图片');
  }
  return hash;
}

/** Creates a transient multimodal input from a trusted local Pexels asset. */
export async function readLocalPexelsImageInput(localPath: string): Promise<LocalPexelsImageInput> {
  const data = await readLocalPexelsAsset(localPath);
  if (!data.length || data.length > MAX_IMAGE_INPUT_BYTES) throw new Error('本地图片超过视觉输入大小限制。');
  const mimeType = mimeTypeForLocalPath(localPath);
  return {
    dataUrl: `data:${mimeType};base64,${data.toString('base64')}`,
    mimeType,
    byteLength: data.length,
  };
}

async function readLocalPexelsAsset(localPath: string): Promise<Buffer> {
  if (!localPath.startsWith(PEXELS_DATA_PREFIX)) throw new Error('候选图片不是受信任的本地素材');
  const relative = localPath.slice('/api/data/'.length);
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative)) throw new Error('候选图片路径不安全');
  const dataRoot = resolve(process.cwd(), 'data');
  const absolute = resolve(dataRoot, ...relative.split('/'));
  if (absolute !== dataRoot && !absolute.startsWith(`${dataRoot}${sep}`)) throw new Error('候选图片路径越界');
  return readFile(absolute);
}

function mimeTypeForLocalPath(localPath: string): LocalPexelsImageInput['mimeType'] {
  const extension = localPath.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  throw new Error('本地图片格式不受支持。');
}
