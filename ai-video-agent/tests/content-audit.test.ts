import { describe, expect, it } from 'vitest';
import { auditScript } from '@/lib/ai/content-audit';

describe('auditScript', () => {
  it('识别 AI 高频表达和长句', () => {
    const result = auditScript('增长 42%', '在这个时代，值得注意的是这是一段非常非常长而且没有明显停顿也没有自然口语节奏的表达，增长 42%。', [
      { type: 'data', content: '增长 42%' },
    ]);
    expect(result.aiPhrases).toContain('在这个时代');
    expect(result.repaired).toBe(false);
  });

  it('标记没有证据支持的关键数字', () => {
    const result = auditScript('介绍市场变化', '市场规模已经达到 999亿元。', [], {
      provider: 'tavily', queriedAt: '2026-07-03T00:00:00.000Z', queries: ['市场规模'],
      summary: '公开资料只确认市场仍在增长', sources: [], status: 'completed', riskLevel: 'high',
      evidenceCards: [{ id: 'E1', question: '市场规模', finding: '市场仍在增长', sourceIds: ['S1'], confidence: 'low' }],
    });
    expect(result.issues.join(' ')).toContain('999亿元');
  });

  it('联网失败时给出人工核实提示', () => {
    const result = auditScript('最新价格', '目前价格有变化。', [], {
      provider: 'tavily', queriedAt: '2026-07-03T00:00:00.000Z', queries: ['最新价格'],
      summary: '', sources: [], status: 'failed', riskLevel: 'high', failedQueries: ['最新价格'],
    });
    expect(result.issues).toContain('联网核实失败，高风险事实需要人工检查');
    expect(result.issues).toContain('高风险主题没有形成可用证据卡');
  });

  it('标记同一分镜标题与旁白中的同单位数字冲突', () => {
    const result = auditScript('WiFi 频谱', '6 GHz 频段提供 1200 MHz 连续带宽。', [], null, [{
      id: 'frame-1',
      index: 1,
      title: '1600 MHz 纯净高速公路',
      narration: '6 GHz 频段提供 1200 MHz 连续带宽。',
    }]);

    expect(result.issues.join(' ')).toContain('标题与内容的mhz数值不一致');
    expect(result.issues.join(' ')).toContain('1600');
    expect(result.issues.join(' ')).toContain('1200');
  });
});
