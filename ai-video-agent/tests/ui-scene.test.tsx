import { describe, expect, it } from 'vitest';
import { renderUISceneHtml } from '@/lib/render/ui-scene-html';

describe('fixed UI scene renderer', () => {
  it('renders demo labeling and deterministic interaction targets from JSON only', () => {
    const html = renderUISceneHtml({
      archetype: 'ai-approval',
      data: { title: '异常订单审批', suggestion: '暂缓执行并复核渠道。' },
      interactions: [
        { atMs: 400, action: 'generate-suggestion', target: 'ai-suggestion' },
        { atMs: 1_200, action: 'confirm-execution', target: 'confirm-execution' },
      ],
      isDemoData: true,
    });
    expect(html).toContain('演示数据');
    expect(html).toContain('异常订单审批');
    expect(html).toContain('data-ui-id="ai-suggestion"');
    expect(html).toContain('renderbridge:time');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('injects the same conservative safe-area style into portrait offline HTML', () => {
    const html = renderUISceneHtml({
      archetype: 'overview',
      data: { title: '竖屏经营总览' },
      interactions: [],
      isDemoData: true,
    }, 'douyin-portrait-9-16');

    expect(html).toContain('width=720');
    expect(html).toContain('data-canvas-preset="douyin-portrait-9-16"');
    expect(html).toContain('padding:80px 112px 240px 48px');
    expect(html).toContain('--ui-safe-top:80px');
    expect(html).toContain('--ui-safe-right:112px');
  });
});
