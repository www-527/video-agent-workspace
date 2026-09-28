import { describe, expect, it } from 'vitest';
import { filterIgnoredLayoutIssues, layoutIssueKey, layoutIssueScope } from '@/lib/layout-issues';

describe('ignored layout issues', () => {
  it('scopes ignores by project and frame and filters only the matching issue', () => {
    const first = { code: 'clipped' as const, label: '图表', detail: '被裁切', elementId: 'chart' };
    const second = { code: 'low_contrast' as const, label: '数字', detail: '对比度低', elementId: 'value' };
    expect(layoutIssueScope('project-a', 'frame-1')).not.toBe(layoutIssueScope('project-b', 'frame-1'));
    expect(filterIgnoredLayoutIssues([first, second], [layoutIssueKey(first)])).toEqual([second]);
  });
});
