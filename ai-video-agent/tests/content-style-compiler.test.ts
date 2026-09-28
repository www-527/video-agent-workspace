import { describe, expect, it } from 'vitest';
import { compileAgentSystemPrompt, formatContentStyleUserContext } from '@/lib/content-style/compiler';
import { buildDefaultPlannerPrompt, BUILTIN_CONTENT_STYLE_PRESETS } from '@/lib/content-style/presets';
import type { ResolvedContentStyle } from '@/lib/content-style/types';

function resolved(presetId: string): ResolvedContentStyle {
  const preset = BUILTIN_CONTENT_STYLE_PRESETS.find(item => item.id === presetId)!;
  return {
    preset,
    globalInstruction: '避免行业黑话',
    projectInstruction: '面向第一次接触主题的观众',
    plannerCorePrompt: buildDefaultPlannerPrompt(preset),
    qualityCorePrompt: '检查视频内容质量。',
    plannerPromptVersionId: 'planner-v1',
    qualityPromptVersionId: 'quality-v1',
    settingsRevision: 1,
  };
}

describe('content style prompt compiler', () => {
  it('keeps the fixed contract separate from editable core content', () => {
    const prompt = compileAgentSystemPrompt({ agent: 'planner', fixedContract: 'STRICT JSON CONTRACT', resolved: resolved('knowledge-explainer') });
    expect(prompt.layers[0]).toMatchObject({ id: 'fixed-contract', editable: false });
    expect(prompt.layers[1]).toMatchObject({ id: 'agent-core', editable: true });
    expect(prompt.layers).toHaveLength(2);
    expect(prompt.system).toContain('STRICT JSON CONTRACT');
    expect(prompt.system).toContain('先给出核心结论');
  });

  it('compiles visibly different rules for different presets', () => {
    const retention = compileAgentSystemPrompt({ agent: 'planner', fixedContract: 'contract', resolved: resolved('strong-retention') });
    const story = compileAgentSystemPrompt({ agent: 'planner', fixedContract: 'contract', resolved: resolved('story-narrative') });
    expect(retention.system).toContain('前 3 秒');
    expect(story.system).toContain('阻碍必须逐步升级');
    expect(story.system).not.toContain('前 3 秒建立明确钩子');
  });

  it('places global and project requirements in the user context', () => {
    const context = formatContentStyleUserContext(resolved('knowledge-explainer'));
    expect(context).toContain('避免行业黑话');
    expect(context).toContain('面向第一次接触主题的观众');
  });
});
