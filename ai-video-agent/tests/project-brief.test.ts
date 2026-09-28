import { describe, expect, it } from 'vitest';
import {
  compileProjectBriefForOutline,
  confirmProjectBrief,
  resolveProjectBrief,
} from '@/lib/brief/resolver';
import type { AssetSummary } from '@/types';

describe('ProjectBrief resolver', () => {
  it('asks one high-impact question at a time and never exceeds two rounds', () => {
    const first = resolveProjectBrief({ content: '帮我做一个介绍黑洞的视频' });
    expect(first.status).toBe('needs_clarification');
    expect(first.brief.unresolvedQuestions).toHaveLength(1);
    expect(first.brief.unresolvedQuestions[0].id).toBe('brief-duration');
    expect(first.brief.clarificationCount).toBe(1);

    const second = resolveProjectBrief({ content: '约 60 秒', existingBrief: first.brief });
    expect(second.status).toBe('needs_clarification');
    expect(second.brief.unresolvedQuestions).toHaveLength(1);
    expect(second.brief.unresolvedQuestions[0].id).toBe('brief-platform');
    expect(second.brief.clarificationCount).toBe(2);

    const final = resolveProjectBrief({ content: '我不确定', existingBrief: second.brief });
    expect(final.status).toBe('ready');
    expect(final.brief.unresolvedQuestions).toEqual([]);
    expect(final.brief.clarificationCount).toBe(2);
    expect(final.brief.assumptions.some(item => item.field === 'platform')).toBe(true);
  });

  it('honors “让 AI 决定” without asking the same question again', () => {
    const first = resolveProjectBrief({ content: '做一条产品介绍视频' });
    const second = resolveProjectBrief({ content: '让 AI 决定', existingBrief: first.brief });
    expect(second.brief.unresolvedQuestions[0]?.id).not.toBe('brief-duration');
    expect(second.brief.coreMessage).toBe(first.brief.coreMessage);
    expect(second.brief.assumptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'durationSeconds', value: '60' }),
    ]));
  });

  it('uses attachment digests to avoid redundant questions and classifies their use', () => {
    const assets: AssetSummary[] = [
      asset('doc-1', 'document', 'content', '抖音发布，成片 60 秒，面向新手用户'),
      asset('logo-1', 'image', 'brand', '品牌 Logo'),
    ];
    const result = resolveProjectBrief({ content: '根据资料做产品视频', assets });
    expect(result.status).toBe('ready');
    expect(result.brief.platform).toBe('douyin');
    expect(result.brief.durationSeconds).toBe(60);
    expect(result.brief.mustUseAssetIds).toEqual(['logo-1']);
    expect(result.brief.optionalAssetIds).toContain('doc-1');
  });

  it('compiles a confirmed brief into the existing outline input without exposing internal protocol terms', () => {
    const resolved = resolveProjectBrief({ content: '做一条 30 秒抖音科普视频，介绍黑洞' });
    const confirmed = confirmProjectBrief(resolved.brief, new Date('2026-08-10T00:00:00.000Z'));
    const prompt = compileProjectBriefForOutline({
      brief: confirmed,
      originalRequest: '介绍黑洞',
      assets: [asset('doc-1', 'document', 'content', '黑洞是强引力天体')],
    });
    expect(confirmed.confirmedAt).toBe('2026-08-10T00:00:00.000Z');
    expect(prompt).toContain('目标时长：30 秒');
    expect(prompt).toContain('黑洞是强引力天体');
    expect(prompt).not.toContain('SceneSpec');
    expect(prompt).not.toContain('Responses');
  });
});

function asset(
  id: string,
  kind: AssetSummary['kind'],
  inferredUsage: NonNullable<AssetSummary['inferredUsage']>,
  digest: string,
): AssetSummary {
  return {
    id,
    kind,
    mimeType: kind === 'image' ? 'image/png' : 'text/plain',
    originalName: `${id}.${kind === 'image' ? 'png' : 'txt'}`,
    byteLength: 10,
    status: 'ready',
    inferredUsage,
    summary: { digest },
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
}
