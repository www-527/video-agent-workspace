import type { ContentAudit, CreativeBrief, FrameOutline, InformationItem, ResearchSnapshot } from '@/types';

const AI_PHRASES = ['在这个时代', '赋能', '让我们一起', '值得注意的是', '不难发现', '总而言之', '深入探讨'];

export interface ContentAuditPolicy {
  requireHook?: boolean;
  requireEarlyValuePromise?: boolean;
  requireActionableCta?: boolean;
  requireAdjacentInformationGain?: boolean;
}

export function auditScript(
  sourceMaterial: string,
  script: string,
  informationPool: InformationItem[],
  research?: ResearchSnapshot | null,
  frames: FrameOutline[] = [],
  creativeBrief?: CreativeBrief,
  policy: ContentAuditPolicy = {},
): ContentAudit {
  const sentences = script.split(/[。！？!?\n]+/).map(item => item.trim()).filter(Boolean);
  const averageSentenceLength = sentences.length
    ? Math.round(sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length)
    : 0;
  const aiPhrases = AI_PHRASES.filter(phrase => script.includes(phrase));
  const retainedItems = informationPool.filter(item => script.includes(compact(item.content))).length;
  const retentionRate = informationPool.length ? retainedItems / informationPool.length : estimateCharacterRetention(sourceMaterial, script);
  const hasHook = sentences.length > 0 && /[？?]|为什么|如果|想象|竟然|真正|不是/.test(sentences[0]);
  const issues: string[] = [];
  if (policy.requireHook && !hasHook) issues.push('开头缺少清晰钩子');
  const valuePromise = textValue(creativeBrief?.valuePromise);
  const cta = textValue(creativeBrief?.cta);
  const hasClearValuePromise = Boolean(valuePromise)
    && sentences.slice(0, 2).join('').includes(valuePromise);
  const hasActionableCta = Boolean(cta)
    && script.includes(cta);
  if (!creativeBrief) {
    issues.push('缺少短视频创作简报（受众、收益承诺、钩子、证据与 CTA）');
  } else {
    const requiredBriefFields = [
      creativeBrief.targetAudience, creativeBrief.viewerPainPoint, creativeBrief.valuePromise,
      creativeBrief.coreMessage, creativeBrief.hook?.text, creativeBrief.proofPlan, creativeBrief.cta,
    ];
    if (requiredBriefFields.some(value => !textValue(value))) issues.push('短视频创作简报存在空字段');
    if (policy.requireEarlyValuePromise && !hasClearValuePromise) issues.push('前两拍没有清楚兑现收益承诺');
    if (policy.requireActionableCta && !hasActionableCta) issues.push('口播稿没有落实唯一 CTA');
  }
  if (averageSentenceLength > 34) issues.push('平均句长偏长，不利于自然口播');
  if (aiPhrases.length) issues.push(`包含 AI 高频表达：${aiPhrases.join('、')}`);
  if (retentionRate < 0.72) issues.push('原始信息保留率偏低');
  if (research?.status === 'failed') issues.push('联网核实失败，高风险事实需要人工检查');
  if (research?.status === 'partial') issues.push(`部分查询失败：${research.failedQueries?.join('、') || '请检查研究来源'}`);
  if (research?.riskLevel === 'high' && !(research.evidenceCards?.length)) {
    issues.push('高风险主题没有形成可用证据卡');
  }
  const unsupportedNumbers = findUnsupportedNumbers(sourceMaterial, script, research);
  if (unsupportedNumbers.length) issues.push(`这些关键数字未在原始素材或研究证据中出现：${unsupportedNumbers.join('、')}`);
  const repeatedBeatCount = findRepeatedBeatCount(frames);
  if (policy.requireAdjacentInformationGain && repeatedBeatCount) issues.push(`存在 ${repeatedBeatCount} 组相邻分镜重复表达`);
  issues.push(...findFrameQuantityConflicts(frames));
  return {
    retentionRate: Math.round(Math.max(0, Math.min(1, retentionRate)) * 100) / 100,
    hasHook,
    hasClearValuePromise,
    hasActionableCta,
    repeatedBeatCount,
    averageSentenceLength,
    aiPhrases,
    issues,
    repaired: issues.length === 0,
  };
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const object = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'action', 'value', 'label']) {
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim();
  }
  return '';
}

function findRepeatedBeatCount(frames: FrameOutline[]): number {
  let count = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = compactBeat(frames[index - 1].narration);
    const current = compactBeat(frames[index].narration);
    if (previous.length >= 12 && current.length >= 12 && (previous.startsWith(current.slice(0, 12)) || current.startsWith(previous.slice(0, 12)))) count += 1;
  }
  return count;
}

function compactBeat(value: string): string {
  return value.replace(/[\s，。！？、：；“”"'（）()]/g, '');
}

/** Flags title/body quantity conflicts before the model quality pass. */
export function findFrameQuantityConflicts(frames: FrameOutline[]): string[] {
  const issues: string[] = [];
  for (const frame of frames) {
    const title = quantitiesByUnit(frame.title);
    const body = quantitiesByUnit(`${frame.narration} ${(frame.sceneSpec?.screenText || []).join(' ')}`);
    for (const [unit, titleValues] of title) {
      const bodyValues = body.get(unit);
      if (!bodyValues?.size) continue;
      const overlaps = [...titleValues].some(value => bodyValues.has(value));
      if (!overlaps) {
        issues.push(`第 ${frame.index} 镜标题与内容的${unit}数值不一致（标题：${[...titleValues].join('/')}；内容：${[...bodyValues].join('/')}）`);
      }
    }
  }
  return issues.slice(0, 5);
}

function quantitiesByUnit(value: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const pattern = /(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Gbps|Mbps|GB|MB|TB|公里|千米|米|秒|分钟|小时|天|年|美元|万元|元|%|％|倍)/gi;
  for (const match of value.matchAll(pattern)) {
    const unit = match[2].replace('％', '%').toLowerCase();
    const values = result.get(unit) || new Set<string>();
    values.add(String(Number(match[1])));
    result.set(unit, values);
  }
  return result;
}

function findUnsupportedNumbers(sourceMaterial: string, script: string, research?: ResearchSnapshot | null): string[] {
  const evidence = [
    sourceMaterial,
    research?.summary || '',
    ...(research?.sources || []).map(source => source.content),
  ].join(' ');
  const tokens = script.match(/\d+(?:\.\d+)?(?:%|％|万亿元|亿元|万元|美元|元|万|亿|年|月|日|倍|GB|MB|公里|岁)/gi) || [];
  return Array.from(new Set(tokens.filter(token => !evidence.includes(token)))).slice(0, 5);
}

function compact(value: string): string {
  return value.replace(/[\s，。！？、：；“”"']/g, '').slice(0, 10);
}

function estimateCharacterRetention(source: string, script: string): number {
  const keywords = Array.from(new Set(source.match(/[\p{Script=Han}]{2,8}|\d+(?:\.\d+)?%?/gu) || [])).slice(0, 40);
  if (!keywords.length) return source.trim() ? 0.7 : 1;
  return keywords.filter(keyword => script.includes(keyword)).length / keywords.length;
}
