import { callAIJson } from './client';
import { INTENT_SYSTEM_PROMPT, buildIntentUserPrompt } from '@/lib/prompts/intent';
import { prisma } from '@/lib/db';
import type { IntentResult, Outline, ProjectDetail } from '@/types';

// Intent routing gates every conversational action. Allow several bounded
// attempts so a brief relay conflict does not turn a valid user request into
// the generic "unknown" route.
const INTENT_MAX_RETRIES = 3;

export async function analyzeIntent(
  projectId: string,
  userInput: string,
  abortSignal?: AbortSignal,
): Promise<IntentResult> {
  const project = await prisma.project.findUnique({
    where: { uuid: projectId },
    select: { outline: true, type: true },
  });
  if (!project) throw new Error('项目不存在');

  const outline = project.outline as unknown as Outline | null;
  const frameTitles = outline?.frames.map(f => f.title) ?? [];
  const localStructureIntent = classifyLocalFrameStructureIntent(userInput);
  if (outline && localStructureIntent) return localStructureIntent;
  const localTuneIntent = classifyLocalFrameTuneIntent(userInput);
  if (outline && localTuneIntent) return localTuneIntent;

  const result = await callAIJson<IntentResult>({
    stage: '意图识别',
    system: INTENT_SYSTEM_PROMPT,
    user: buildIntentUserPrompt({
      userInput,
      hasOutline: !!outline,
      frameCount: frameTitles.length,
      frameTitles,
    }),
    temperature: 0.3,
    maxRetries: INTENT_MAX_RETRIES,
    abortSignal,
  });

  // 校验
  if (!result || !result.action) {
    throw new Error('AI 返回格式错误：缺少 action 字段');
  }
  return result;
}

export function classifyLocalFrameStructureIntent(userInput: string): IntentResult | null {
  const text = userInput.trim();
  const firstFrame = text.match(/第\s*(\d+)\s*[镜幕]/);

  if (/(拆分|拆成|拆为|拆开|分成|分为)/.test(text) && firstFrame) {
    const countMatch = text.match(/(?:拆分|拆成|拆为|拆开|分成|分为)\s*(\d+|两|三|四)\s*(?:个)?(?:分镜|镜|段|份)/);
    const countText = countMatch?.[1];
    const parts = countText === '三' ? 3 : countText === '四' ? 4 : Math.max(2, Math.min(4, Number(countText) || 2));
    return {
      action: 'split_frame',
      reason: '用户希望把一个已有分镜拆成多个连续分镜。',
      params: {
        frameIndex: Number(firstFrame[1]),
        parts,
        modification: text,
      },
    };
  }

  if (/(合并|合成|并成|并为)/.test(text)) {
    const frameIndexes = parseMergeFrameIndexes(text);
    if (frameIndexes.length >= 2) {
      return {
        action: 'merge_frames',
        reason: '用户希望把多个已有分镜合并成一个分镜。',
        params: { frameIndexes, modification: text },
      };
    }
  }

  return null;
}

function parseMergeFrameIndexes(text: string): number[] {
  const compact = text.match(/第\s*(\d+)\s*[、,，]\s*(\d+)\s*[镜幕]/);
  if (compact) return uniqueSorted([Number(compact[1]), Number(compact[2])]);

  const pair = text.match(/第\s*(\d+)\s*[镜幕]?\s*(和|与|及|到|至|-|~)\s*第?\s*(\d+)\s*[镜幕]/);
  if (pair) {
    const start = Number(pair[1]);
    const end = Number(pair[3]);
    if (pair[2] === '到' || pair[2] === '至' || pair[2] === '-' || pair[2] === '~') {
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      return Array.from({ length: high - low + 1 }, (_, index) => low + index);
    }
    return uniqueSorted([start, end]);
  }

  const explicit = Array.from(text.matchAll(/第\s*(\d+)\s*[镜幕]/g), match => Number(match[1]));
  if (explicit.length >= 2) return uniqueSorted(explicit);

  if (firstIndex(text) && /(后一镜|下一镜)/.test(text)) {
    const start = firstIndex(text)!;
    return [start, start + 1];
  }
  return [];
}

function firstIndex(text: string) {
  const match = text.match(/第\s*(\d+)\s*[镜幕]/);
  return match ? Number(match[1]) : undefined;
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

export function classifyLocalFrameTuneIntent(userInput: string): IntentResult | null {
  const text = userInput.trim();
  const frameMatch = text.match(/第\s*(\d+)\s*[镜幕]/);
  if (!frameMatch) return null;

  const remainder = text.replace(frameMatch[0], '').trim();
  const deletionRequest = /(删除|删掉|删了|移除|去掉|拿掉)/.test(remainder)
    && remainder.replace(/(删除|删掉|删了|移除|去掉|拿掉|画面里|画面中|的)/g, '').trim().length > 0;
  const majorChangePattern = /(旁白|标题|叙事|主题|内容|事实|大改|重写|重新生成|换成|改成|照片墙|人物|讲|新增)/;
  if (majorChangePattern.test(text)) return null;

  const tunePattern = /(位置|上移|下移|左移|右移|往上|往下|往左|往右|靠左|靠右|居中|对齐|间距|留白|缩小|放大|太大|太小|透明|层级|遮挡|挡住|字幕.*移|速度|快一点|慢一点|钟摆|钟表)/;
  if (!deletionRequest && !tunePattern.test(text)) return null;

  return {
    action: 'tune_frame',
    reason: deletionRequest
      ? '用户在删除已生成 HTML 分镜中的一个局部元素。'
      : '用户在调整已生成分镜的局部画面参数。',
    params: {
      frameIndex: Number(frameMatch[1]),
      modification: text,
    },
  };
}
