import { describe, expect, it } from 'vitest';
import { classifyVisualAsset } from '@/lib/ai/visual-asset-policy';
import { enforcePlanConstraints } from '@/lib/ai/real-image-planner';

describe('visual asset fidelity policy', () => {
  it('requires authentic assets when product shape carries the explanation', () => {
    const frame = {
      id: 'bottle', index: 1,
      title: '弧线瓶：黑暗中摸到的设计',
      narration: '经典瓶身的灵感来自可可豆荚。',
      htmlPrompt: '对照可可豆荚外形与经典弧线瓶轮廓。',
      sceneSpec: { assetStrategy: 'css-svg', visualRole: 'explain' },
    } as any;
    const policy = classifyVisualAsset(frame);
    const [plan] = enforcePlanConstraints([frame], [{ frameId: frame.id, useRealImage: false }], 'fast');

    expect(policy).toMatchObject({ assetClass: 'product', fidelity: 'required', fallbackPolicy: 'allow-native' });
    expect(plan.useRealImage).toBe(true);
    expect(plan.fallbackPolicy).toBe('allow-native');
    expect(plan.subjects?.map(subject => subject.kind)).toEqual(['natural-object', 'product']);
  });

  it('requires the actual building when architecture appearance is the subject', () => {
    const policy = classifyVisualAsset({
      title: '流水别墅的悬挑设计',
      narration: '建筑与瀑布结合。',
      htmlPrompt: '展示建筑外观与悬挑结构。',
      sceneSpec: { assetStrategy: 'css-svg' } as any,
    });
    expect(policy).toMatchObject({ assetClass: 'architecture', fidelity: 'required', fallbackPolicy: 'allow-native' });
  });

  it('requires a portrait for an identity-bearing person frame', () => {
    const policy = classifyVisualAsset({
      title: '发明者约翰·彭伯顿',
      narration: '介绍可口可乐的发明者。',
      htmlPrompt: '约翰·彭伯顿肖像。',
      sceneSpec: { assetStrategy: 'real-image' } as any,
    });
    expect(policy).toMatchObject({ assetClass: 'named-person', fidelity: 'required', fallbackPolicy: 'allow-native' });
  });

  it('classifies Santa as the visual person instead of an incidental cola product', () => {
    const frame = {
      id: 'santa', index: 6,
      title: '圣诞老人变红了',
      narration: '可口可乐在营销中强化了红衣圣诞老人的形象。',
      htmlPrompt: '主角：绿色圣诞老人轮廓转变为红色圣诞老人；关系：颜色转变。',
      sceneSpec: { assetStrategy: 'real-image', focalElement: '圣诞老人', visualIntent: '展示颜色转变' },
    } as any;
    const policy = classifyVisualAsset(frame);
    const [plan] = enforcePlanConstraints([frame], [], 'asset-priority');

    expect(policy).toMatchObject({ assetClass: 'generic-person', fallbackPolicy: 'allow-native' });
    expect(plan.query).toBe('santa claus red suit portrait');
    expect(plan.fallbackPolicy).toBe('allow-native');
  });

  it('keeps abstract data and process frames native', () => {
    const policy = classifyVisualAsset({
      title: '营收增长对比图',
      narration: '比较两个季度的增长率。',
      htmlPrompt: '用条形图展示数据。',
      sceneSpec: { assetStrategy: 'chart' } as any,
    });
    expect(policy).toMatchObject({ assetClass: 'native-visual', fidelity: 'native', fallbackPolicy: 'allow-native' });
  });
});
