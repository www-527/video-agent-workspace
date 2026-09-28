import type { CanvasPresetId, RealImageAsset } from '@/types';
import type { PexelsPhoto } from './client';
import { getCanvasPreset } from '@/lib/canvas-presets';

export type ImageLayout = RealImageAsset['layout'];

export interface ScoredPexelsPhoto {
  photo: PexelsPhoto;
  score: number;
  layout: ImageLayout;
  fitMode: RealImageAsset['fitMode'];
  matchedTerms: string[];
  missingTerms: string[];
  rejectedTerms: string[];
  accepted: boolean;
  rejectionCode?: string;
  reason: string;
}

export function chooseImageLayout(photo: Pick<PexelsPhoto, 'width' | 'height'>, requested: ImageLayout = 'editorial-split') {
  const ratio = photo.width / photo.height;
  if (ratio < 1.15) return { layout: 'framed-focus' as const, fitMode: 'contain' as const };
  if (ratio >= 1.62 && ratio <= 2.05 && requested === 'full-bleed') return { layout: 'full-bleed' as const, fitMode: 'cover' as const };
  return { layout: 'editorial-split' as const, fitMode: 'cover' as const };
}

export function scorePexelsCandidates(opts: {
  photos: PexelsPhoto[];
  subject: string;
  layout?: ImageLayout;
  usedPhotoIds: Set<number>;
  previousPhotographer?: string;
  previousColor?: string;
  requirePortrait?: boolean;
  requireSubjectMatch?: boolean;
  minimumSubjectMatches?: number;
  requiredTerms?: string[];
  optionalTerms?: string[];
  excludedTerms?: string[];
  canvasPreset?: CanvasPresetId;
}): ScoredPexelsPhoto[] {
  return assessPexelsCandidates(opts)
    .filter(candidate => candidate.accepted)
    .sort((a, b) => b.score - a.score);
}

/**
 * Keeps a diagnostic record for every provider result. Ranking consumes only
 * accepted items, while the editor can explain why plausible-looking results
 * were rejected.
 */
export function assessPexelsCandidates(opts: {
  photos: PexelsPhoto[];
  subject: string;
  layout?: ImageLayout;
  usedPhotoIds: Set<number>;
  previousPhotographer?: string;
  previousColor?: string;
  requirePortrait?: boolean;
  requireSubjectMatch?: boolean;
  minimumSubjectMatches?: number;
  requiredTerms?: string[];
  optionalTerms?: string[];
  excludedTerms?: string[];
  canvasPreset?: CanvasPresetId;
}): ScoredPexelsPhoto[] {
  const canvas = getCanvasPreset(opts.canvasPreset);
  const targetRatio = canvas.design.width / canvas.design.height;
  const subjectTokens = tokenize(opts.subject);
  const requiredTerms = opts.requiredTerms?.map(normalizeTerm).filter(Boolean) || [];
  const optionalTerms = opts.optionalTerms?.map(normalizeTerm).filter(Boolean) || [];
  const excludedTerms = opts.excludedTerms?.map(normalizeTerm).filter(Boolean) || [];

  return opts.photos.flatMap<ScoredPexelsPhoto>((photo, rank): ScoredPexelsPhoto[] => {
    if (!Number.isFinite(photo.id)) return [];
    const safeHeight = Math.max(1, photo.height);
    const ratio = photo.width / safeHeight;
    const config = chooseImageLayout(photo, opts.layout);
    const alt = (photo.alt || '').trim();
    const altTokens = tokenize(alt);
    const rejectedTerms = excludedTerms.filter(term => includesTerm(alt, term));
    const matchedTerms = requiredTerms.filter(term => includesTerm(alt, term));
    const missingTerms = requiredTerms.filter(term => !matchedTerms.includes(term));
    const optionalMatches = optionalTerms.filter(term => includesTerm(alt, term));
    const matched = subjectTokens.filter(token => altTokens.includes(token)).length;
    const portraitLike = /(portrait|person|man|woman|people|headshot|face)/i.test(photo.alt || '');
    const minimumMatches = opts.minimumSubjectMatches ?? (opts.requireSubjectMatch ? subjectTokens.length : 0);
    const relevance = Math.max(0, 32 - rank * 2) + Math.min(8, matched * 4);
    const ratioScore = Math.max(0, 25 - Math.min(25, Math.abs(ratio - targetRatio) * (canvas.id === 'douyin-portrait-9-16' ? 45 : 30)));
    const resolutionAxis = canvas.id === 'douyin-portrait-9-16' ? photo.height : photo.width;
    const resolution = resolutionAxis >= 1920 ? 20 : 12;
    const duplicate = photo.photographer === opts.previousPhotographer ? -7 : 10;
    const color = colorConsistencyScore(photo.avg_color, opts.previousColor);
    const score = relevance + ratioScore + resolution + duplicate + color + Math.min(6, optionalMatches.length * 2);
    const base = { photo, score, ...config, matchedTerms, missingTerms, rejectedTerms };

    const minimumAxis = canvas.id === 'douyin-portrait-9-16' ? photo.height : photo.width;
    if (minimumAxis < 1280 || photo.height <= 0) return [{ ...base, accepted: false, rejectionCode: 'LOW_RESOLUTION', reason: `分辨率不足，${canvas.id === 'douyin-portrait-9-16' ? '竖图高度' : '横图宽度'}至少需要 1280px` }];
    if (!photo.src?.large2x && !photo.src?.large && !photo.src?.original) return [{ ...base, accepted: false, rejectionCode: 'DOWNLOAD_URL_MISSING', reason: '缺少可用的高清下载地址' }];
    if (opts.usedPhotoIds.has(photo.id)) return [{ ...base, accepted: false, rejectionCode: 'DUPLICATE_PHOTO', reason: '同一项目已使用该图片' }];
    if (canvas.id === 'douyin-portrait-9-16' ? (ratio < 0.42 || ratio > 1.35) : (ratio < 0.85 || ratio > 3.2)) return [{ ...base, accepted: false, rejectionCode: 'ASPECT_RATIO_UNSUITABLE', reason: '画幅不适合当前视频构图' }];
    if (altTokens.length < 2) return [{ ...base, accepted: false, rejectionCode: 'METADATA_INSUFFICIENT', reason: '图片描述不足，无法可靠判断内容' }];
    if (rejectedTerms.length) return [{ ...base, accepted: false, rejectionCode: 'EXCLUDED_TERM_MATCHED', reason: `命中排除词：${rejectedTerms.join('、')}` }];
    if (missingTerms.length) return [{ ...base, accepted: false, rejectionCode: 'REQUIRED_TERM_MISSING', reason: `缺少必需词：${missingTerms.join('、')}` }];
    if (opts.requirePortrait && !portraitLike) return [{ ...base, accepted: false, rejectionCode: 'PORTRAIT_EVIDENCE_MISSING', reason: '缺少人物或肖像证据' }];
    if (subjectTokens.length && matched < minimumMatches) return [{ ...base, accepted: false, rejectionCode: 'SUBJECT_MISMATCH', reason: '主体描述与检索目标不一致' }];
    if (altTokens.length && subjectTokens.length && matched === 0 && rank > 5) return [{ ...base, accepted: false, rejectionCode: 'TOPIC_EVIDENCE_WEAK', reason: '主题证据不足且来源排名靠后' }];

    const matchSummary = [...matchedTerms, ...optionalMatches.filter(term => !matchedTerms.includes(term))];
    return [{
      ...base,
      accepted: true,
      reason: matchSummary.length ? `命中：${matchSummary.join('、')}` : '通过构图与主题筛选',
    }];
  });
}

function normalizeTerm(value: string) { return value.trim().toLowerCase(); }
function includesTerm(haystack: string, term: string) {
  const tokens = tokenize(term);
  const altTokens = new Set(tokenize(haystack));
  return tokens.length > 0 && tokens.every(token => altTokens.has(token));
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]{3,}/g) || []).map(normalizeToken);
}

function normalizeToken(value: string): string {
  if (value.length > 4 && value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.length > 4 && value.endsWith('es')) return value.slice(0, -1);
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function colorConsistencyScore(current?: string, previous?: string): number {
  if (!current || !previous) return 0;
  const left = parseHexColor(current);
  const right = parseHexColor(previous);
  if (!left || !right) return current.toLowerCase() === previous.toLowerCase() ? 6 : 0;
  const distance = Math.sqrt(
    (left[0] - right[0]) ** 2
    + (left[1] - right[1]) ** 2
    + (left[2] - right[2]) ** 2,
  );
  // Similar palettes receive a small boost; very different palettes get a
  // small penalty so relevance and composition remain the primary signals.
  return Math.round(6 - (distance / Math.sqrt(3 * 255 ** 2)) * 8);
}

function parseHexColor(value: string): [number, number, number] | null {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16)) as [number, number, number];
}
