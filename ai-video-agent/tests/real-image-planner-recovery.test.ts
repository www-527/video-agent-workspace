import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIJson: vi.fn(),
}));

vi.mock('@/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, callAIJson: mocks.callAIJson };
});

import { extractCompletePlans, planRealImages } from '@/lib/ai/real-image-planner';
import { runWithAIKeySnapshot } from '@/lib/ai-key-context';

const gptCredential = {
  id: 'gpt', name: 'GPT', apiKey: 'sk-gpt', model: 'gpt-5.6-terra', baseURL: 'https://relay.example/v1', source: 'saved' as const,
  apiProtocol: 'auto' as const,
  gptOptimization: { enabled: true, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced' as const, creativeFreedom: 'balanced' as const, internalImageSearch: true },
};

const completePlan = {
  frameId: 'frame-1',
  useRealImage: true,
  priority: 95,
  reason: 'Strong opening anchor',
  purpose: 'Show a recognizable product',
  query: 'vintage cola bottle',
  fallbackQueries: ['classic soda bottle'],
  subject: 'cola bottle',
  composition: 'framed-focus',
  textPosition: 'right',
  imageMotion: 'slow-push-in',
  visualGroup: 'product-history',
  fidelity: 'preferred',
  fallbackPolicy: 'allow-native',
};

describe('real image planner recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts complete plans before a response truncated inside the next string', () => {
    const output = `{"plans":[${JSON.stringify(completePlan)},{"frameId":"frame-2","reason":"unfinished`;
    expect(extractCompletePlans(output)).toEqual([completePlan]);
  });

  it('builds the whole-film plan deterministically without an AI request', async () => {
    const frames = Array.from({ length: 5 }, (_, index) => ({
      id: `frame-${index + 1}`,
      index: index + 1,
      title: index === 0 ? 'Recognizable cola bottle' : `Abstract chapter ${index + 1}`,
      narration: index === 0 ? 'Show the physical product and its packaging.' : 'Explain a timeline with native graphics.',
      sceneSpec: index === 0
        ? {
          assetStrategy: 'real-image',
          visualRole: 'physical-proof',
          realImagePriority: 'required',
          assetHints: ['vintage cola bottle product'],
        }
        : { assetStrategy: 'chart', visualRole: 'explain' },
    }));

    const plans = await planRealImages(
      { title: 'Product history', totalDuration: 30, frames } as any,
      [],
      undefined,
      'balanced',
    );

    expect(mocks.callAIJson).not.toHaveBeenCalled();
    expect(plans[0]).toMatchObject({
      frameId: 'frame-1',
      useRealImage: true,
      query: 'vintage cola bottle product',
      priority: 100,
    });
    expect(plans.slice(1).every(plan => plan.useRealImage === false)).toBe(true);
  });

  it('plans one required slot per co-equal automotive scenario', async () => {
    const frame = {
      id: 'frame-7',
      index: 7,
      title: '市区、长途与操控怎么选',
      narration: '市区通勤看 CVT，长途公路看 AT，操控乐趣看 DCT。',
      sceneSpec: {
        relationship: 'compare',
        assetStrategy: 'real-image',
        visualRole: 'context',
        realImagePriority: 'required',
        assetRequest: {
          query: 'car transmission driving scenarios',
          fallbackQueries: ['modern car road driving'],
          requiredTerms: ['car'],
          optionalTerms: ['driving'],
          excludedTerms: ['illustration'],
          subjectType: 'environment',
          purpose: '对照三种驾驶场景',
          imageRequired: true,
        },
      },
    };
    const [plan] = await planRealImages({ title: '汽车科普', totalDuration: 8, frames: [frame] } as any, []);

    expect(plan.useRealImage).toBe(true);
    expect(plan.subjects).toHaveLength(3);
    expect(plan.subjects?.map(subject => subject.name)).toEqual(['city commute', 'highway travel', 'performance driving']);
    expect(plan.subjects?.every(subject => subject.required)).toBe(true);
  });

  it('does not invent a generic stock-photo query in GPT optimization mode', async () => {
    const outline = {
      title: '历史谜题', totalDuration: 8, frames: [{
        id: 'frame-history', index: 1, title: '无法确认的遗址', narration: '现有证据不足以确认具体场景。',
        sceneSpec: { assetStrategy: 'real-image', visualRole: 'context', realImagePriority: 'preferred', assetHints: [] },
      }],
    } as any;
    const plans = await runWithAIKeySnapshot(gptCredential, () => planRealImages(outline, []));
    expect(plans[0].useRealImage).toBe(false);
    expect(plans[0].query).toBe('');
  });

  it('lets GPT optimization hand a precise structured request to the internal image search', async () => {
    const outline = {
      title: '产品档案', totalDuration: 8, frames: [{
        id: 'frame-product', index: 1, title: '经典产品外观', narration: '展示可验证的产品包装。',
        sceneSpec: {
          assetStrategy: 'real-image',
          visualRole: 'physical-proof',
          realImagePriority: 'required',
          assetRequest: {
            query: 'vintage fast food packaging archive',
            fallbackQueries: ['classic restaurant product packaging'],
            requiredTerms: [],
            optionalTerms: ['vintage'],
            excludedTerms: ['illustration'],
            subjectType: 'equipment',
            purpose: '建立真实产品档案参照',
            imageRequired: true,
          },
        },
      }],
    } as any;

    const [plan] = await runWithAIKeySnapshot(gptCredential, () => planRealImages(outline, []));
    expect(plan.useRealImage).toBe(true);
    expect(plan.query).toBe('vintage fast food packaging archive');
    expect(plan.assetRequest?.requiredTerms).toEqual(['vintage', 'fast']);
  });
});
