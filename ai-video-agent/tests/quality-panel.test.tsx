// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QualityPanel } from '@/components/studio/quality-panel';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

const project: ProjectDetail = {
  uuid: 'project-1', title: 'Quality panel', type: 'html', canvasPreset: 'landscape-16-9', styleId: null,
  createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z', hasOutline: true,
  outline: {
    title: 'Outline', totalDuration: 3,
    frames: [{ id: 'frame-1', index: 1, title: 'Broken frame', narration: 'Narration' }],
  },
  videoSource: { frames: [{ id: 'frame-1', htmlCode: '<main>broken</main>' }] },
};

describe('QualityPanel', () => {
  beforeEach(() => {
    useStudioStore.setState({
      selectedFrameId: 'frame-1',
      layoutAudits: {
        'frame-1': {
          frameId: 'frame-1', auditedAt: Date.now(),
          issues: [{ code: 'clipped', severity: 'critical', label: '图表', detail: '被裁切', elementId: 'chart' }],
        },
      },
      qualityRuns: {}, qualityRepairRequests: {}, qualityRepairStops: {}, selectedElementIds: [], ignoredLayoutIssueKeys: {}, permanentlyIgnoredLayoutIssueKeys: {},
    });
  });

  it('opens the frame picker and requests repairs for the selected frames', () => {
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '重新修复' }));
    expect(screen.getByRole('dialog', { name: '选择要修复的分镜' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /选择分镜 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '修复所选' }));
    expect(useStudioStore.getState().qualityRepairRequests['frame-1']).toBe(1);
  });

  it('toggles frame selection and keeps the preview synchronized with the last clicked frame', () => {
    const multiFrameProject: ProjectDetail = {
      ...project,
      outline: {
        ...project.outline!,
        frames: [
          project.outline!.frames[0],
          { id: 'frame-2', index: 2, title: 'Second frame', narration: 'Second narration' },
        ],
      },
      videoSource: {
        frames: [
          project.videoSource!.frames[0],
          { id: 'frame-2', htmlCode: '<main>second</main>' },
        ],
      },
    };
    render(<QualityPanel project={multiFrameProject} onProjectChange={() => undefined} frameConcurrency={3} />);

    fireEvent.click(screen.getByRole('button', { name: '重新修复' }));
    expect(screen.getByText('3 路并发')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择分镜 1，当前分镜' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('current-repair-frame-hint').textContent).toBe('当前');
    fireEvent.click(screen.getByRole('button', { name: '选择分镜 2' }));
    expect(useStudioStore.getState().selectedFrameId).toBe('frame-2');
    expect(screen.getByRole('button', { name: '选择分镜 2，当前分镜，已选择' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '选择分镜 2，当前分镜，已选择' }));
    expect(screen.getByRole('button', { name: '选择分镜 2，当前分镜' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('does not render the removed GPT quality report summary', () => {
    const projectWithReport: ProjectDetail = {
      ...project,
      videoSource: {
        ...project.videoSource!,
        gptQualityReport: {
          generatedAt: '2026-08-10T00:00:00.000Z',
          modelScope: 'gpt-only',
          scores: { technical: 88, semantic: 92, visualRichness: 85, rhythm: 90, assets: null, creative: 89, overall: 89 },
          stats: { frameCount: 1, auditedFrameCount: 1, auditStatus: 'complete', layoutFamilyCount: 0, realImageCount: 0 },
          issues: [{ code: 'repeat', category: 'visualRichness', severity: 'major', frameIds: ['frame-1'], message: '重复构图' }],
        },
      },
    };

    render(<QualityPanel project={projectWithReport} onProjectChange={() => undefined} />);

    expect(screen.queryByTestId('gpt-quality-summary')).toBeNull();
    expect(document.querySelector('.quality-report-score')).toBeNull();
    expect(document.querySelector('.quality-frame-navigation')).toBeTruthy();
  });

  it('treats a completed empty runtime audit as newer than a stored failure', () => {
    const staleProject: ProjectDetail = {
      ...project,
      videoSource: {
        frames: [{
          id: 'frame-1',
          htmlCode: '<main>broken</main>',
          qualityReport: {
            frameId: 'frame-1', status: 'needs_review', scoreBefore: 60, scoreAfter: 60, iterations: 1,
            issues: [{ code: 'clipped', severity: 'critical', label: '旧裁切', detail: '旧报告', elementId: 'chart' }],
            appliedFixes: [], auditedAt: 1, auditVersion: 'old', htmlHash: 'old',
          },
        }],
      },
    };
    useStudioStore.setState({
      layoutAudits: { 'frame-1': { frameId: 'frame-1', auditedAt: Date.now(), issues: [] } },
    });

    render(<QualityPanel project={staleProject} onProjectChange={() => undefined} />);

    expect(screen.getByText('当前分镜没有待处理问题')).toBeTruthy();
    expect(screen.queryByText('旧裁切')).toBeNull();
    expect(screen.getByRole('button', { name: '强制导出视频' })).toBeTruthy();
  });

  it('shows a safe animation-script recommendation for invisible visuals', () => {
    useStudioStore.setState({
      layoutAudits: {
        'frame-1': {
          frameId: 'frame-1',
          auditedAt: Date.now(),
          issues: [{
            code: 'invisible',
            severity: 'critical',
            label: '核心画面未显示',
            detail: '视觉区包含元素，但在动画最终检查点仍全部透明或不可见。',
            elementId: 'visual-content',
          }],
        },
      },
    });
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);

    expect(screen.getByText('核心画面未显示')).toBeTruthy();
    expect(screen.getByText('建议：修复动画启动脚本，或重新生成当前分镜。')).toBeTruthy();
  });

  it('only creates the repair activity ring after a repair is requested', () => {
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);

    const repairActions = screen.getByTestId('quality-repair-actions');
    expect(repairActions.className).toContain('flex');
    expect(repairActions.className).toContain('w-[7.625rem]');
    expect(repairActions.className).not.toContain('w-40');
    expect(repairActions.firstElementChild?.textContent).toContain('重新修复');
    expect(repairActions.firstElementChild?.querySelector('svg')).toBeNull();
    expect(screen.getByTestId('quality-header-actions').className).toContain('flex-col');
    expect(screen.getByTestId('quality-header-actions').className).toContain('items-end');
    expect(screen.getByTestId('quality-repair-actions').className).toContain('w-[7.625rem]');
    expect(screen.queryByTestId('repair-activity-control')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新修复' }));
    fireEvent.click(screen.getByRole('button', { name: /选择分镜 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '修复所选' }));
    expect(screen.getByRole('button', { name: '重新修复' })).toHaveProperty('disabled', true);
    expect(screen.getByTestId('repair-activity-control').className).toContain('repair-activity-control');
    expect(screen.getByTestId('repair-activity-control').className).toContain('border-input');
    expect(screen.getByTestId('repair-activity-control').className).toContain('bg-background');
    expect(screen.getByTestId('repair-activity-spinner').className).toContain('repair-activity-spinner');
  });

  for (const status of ['auditing', 'optimizing', 'saving'] as const) {
    it(`shows the repair activity ring while ${status}`, () => {
      useStudioStore.setState({
        qualityRuns: {
          'frame-1': { frameId: 'frame-1', status, message: '正在修复当前画面', updatedAt: Date.now() },
        },
      });
      render(<QualityPanel project={project} onProjectChange={() => undefined} />);

      expect(screen.getByRole('button', { name: '重新修复' })).toHaveProperty('disabled', true);
      expect(screen.getByTestId('repair-activity-spinner')).toBeTruthy();
    });
  }

  it('removes the repair activity ring after the repair finishes and keeps stop repair in its details dialog while active', () => {
    vi.useFakeTimers();
    try {
    useStudioStore.setState({
      qualityRuns: {
        'frame-1': { frameId: 'frame-1', status: 'optimizing', message: '正在重新检查并修复当前画面', updatedAt: Date.now() },
      },
    });
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '查看修复详情' }));
    expect(screen.getByTestId('repair-details-popover')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('repair-details-popover')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看修复详情' }));
    act(() => fireEvent.click(screen.getByRole('button', { name: '停止修复' })));
    expect(useStudioStore.getState().qualityRepairStops['frame-1']).toBe(true);

    act(() => {
      useStudioStore.setState({
        qualityRuns: {
          'frame-1': { frameId: 'frame-1', status: 'passed', message: '画面已通过自检', updatedAt: Date.now() },
        },
        qualityRepairRequests: {},
      });
    });
      expect(screen.getByTestId('repair-activity-control').className).toContain('repair-activity-return');
      act(() => vi.advanceTimersByTime(900));
      expect(screen.queryByTestId('repair-activity-control')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an individual issue for the current HTML version', async () => {
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);
    expect(screen.getByRole('button', { name: '分镜 1，严重问题 1 个' })).toBeTruthy();
    expect(screen.getByTestId('quality-issue-list').textContent).toContain('01');
    expect(screen.getByRole('button', { name: '定位' }).querySelector('svg')).toBeNull();
    expect(screen.getByTestId('quality-issue-actions').textContent).toContain('永久忽略');
    fireEvent.click(screen.getByRole('button', { name: '忽略本次' }));
    await waitFor(() => {
      expect(screen.queryByText('被裁切')).toBeNull();
      expect(screen.queryByRole('button', { name: '分镜 1，严重问题 1 个' })).toBeNull();
      expect(screen.getByRole('button', { name: '分镜 1' })).toBeTruthy();
    });
  });

  it('permanently ignores an individual issue for the current project frame', async () => {
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '永久忽略' }));

    await waitFor(() => {
      expect(screen.queryByText('被裁切')).toBeNull();
      expect(useStudioStore.getState().permanentlyIgnoredLayoutIssueKeys['project-1::frame-1']).toEqual(['clipped::chart::']);
      expect(window.localStorage.getItem('ai-video-agent-permanent-layout-issue-ignores')).toContain('project-1::frame-1');
    });
  });

  it('requests a forced export immediately', () => {
    render(<QualityPanel project={project} onProjectChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '强制导出视频' }));
    expect(useStudioStore.getState().forceExportRequest).toBe(1);
  });
});
