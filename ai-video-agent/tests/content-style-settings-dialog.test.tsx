// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentStyleSettingsDialog } from '@/components/content-style/content-style-settings-dialog';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const presets = [
  {
    id: 'strong-retention', name: '强留存口播', description: '留存', plannerGuidance: ['钩子'], qualityChecks: [],
    exampleStructure: ['钩子'], version: 1, source: 'builtin',
  },
  {
    id: 'knowledge-explainer', name: '知识科普', description: '科普', plannerGuidance: ['结论'], qualityChecks: [],
    exampleStructure: ['结论'], version: 1, source: 'builtin',
  },
  {
    id: 'custom-only', name: '自定义', description: '自定义', plannerGuidance: [], qualityChecks: [],
    exampleStructure: [], version: 1, source: 'builtin',
  },
];

const settings = {
  schemaVersion: 1,
  revision: 0,
  activePresetId: 'strong-retention',
  customInstruction: '全局要求',
  customPresets: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  presets,
};

const promptView = {
  defaults: {
    planner: { content: '官方大纲专家提示词', versionId: 'official-planner-v1' },
    quality: { content: '官方质量提示词', versionId: 'official-quality-v1' },
  },
  effective: {
    plannerCore: '强留存大纲专家提示词',
    qualityCore: '当前质量提示词',
    plannerPromptVersionId: 'official-planner-v1',
    qualityPromptVersionId: 'official-quality-v1',
    plannerSource: 'official',
    qualitySource: 'official',
  },
  plannerPresets: {
    'strong-retention': {
      defaultContent: '强留存大纲专家提示词',
      effectiveContent: '强留存大纲专家提示词',
      versionId: 'official-planner-v1:strong-retention:v1',
      source: 'official',
    },
    'knowledge-explainer': {
      defaultContent: '知识科普大纲专家提示词',
      effectiveContent: '知识科普大纲专家提示词',
      versionId: 'official-planner-v1:knowledge-explainer:v1',
      source: 'official',
    },
  },
  preset: presets[0],
  instructionContext: '',
  compiled: {},
  promptHashes: {},
};

describe('ContentStyleSettingsDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps the user flow focused on project preferences', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings/content-style') return Promise.resolve(jsonResponse(settings));
      if (url === '/api/settings/content-style/prompts/validate' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ level: 'valid', issues: [] }));
      }
      if (url === '/api/settings/content-style/prompts' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ settings: { ...settings, revision: 1 }, version: {} }));
      }
      if (url === '/api/settings/content-style/prompts?projectId=project-1') {
        return Promise.resolve(jsonResponse(promptView));
      }
      if (url === '/api/projects/project-1/content-style' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ contentStyle: { mode: 'override' } }));
      }
      if (url === '/api/projects/project-1/content-style') {
        return Promise.resolve(jsonResponse({ contentStyle: { mode: 'inherit' } }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ContentStyleSettingsDialog projectId="project-1" open onOpenChange={onOpenChange} />);

    const presetSelect = await screen.findByLabelText('表达方式');
    expect(screen.getByRole('heading', { name: '内容提示词' })).toBeTruthy();
    expect(screen.queryByText('Prompt 运行查看')).toBeNull();
    expect(screen.queryByText('Agent 底层设置')).toBeNull();
    expect(screen.queryByRole('option', { name: '自定义' })).toBeNull();
    expect(screen.queryByDisplayValue('当前质量提示词')).toBeNull();

    expect((screen.getByLabelText('大纲专家提示词') as HTMLTextAreaElement).value).toBe('强留存大纲专家提示词');
    fireEvent.change(presetSelect, { target: { value: 'knowledge-explainer' } });
    expect((screen.getByLabelText('大纲专家提示词') as HTMLTextAreaElement).value).toBe('知识科普大纲专家提示词');
    fireEvent.change(screen.getByLabelText('大纲专家提示词'), { target: { value: '新的大纲专家提示词' } });
    fireEvent.change(screen.getByLabelText('补充要求（可选）'), { target: { value: '避免术语' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/content-style',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/projects/project-1/content-style' && init?.method === 'PATCH'
    ))!;
    expect(JSON.parse(String(patchCall[1].body))).toEqual({
      mode: 'override',
      presetId: 'knowledge-explainer',
      customInstruction: '避免术语',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/content-style/prompts', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        agent: 'planner',
        presetId: 'knowledge-explainer',
        content: '新的大纲专家提示词',
        expectedRevision: 0,
        confirmWarnings: false,
      }),
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('内容提示词已保存');
  });

  it('resets only the editable outline expert prompt to the official default', async () => {
    const customPromptView = {
      ...promptView,
      effective: {
        ...promptView.effective,
        plannerCore: '自定义大纲专家提示词',
        plannerPromptVersionId: 'custom-planner-v2',
        plannerSource: 'custom',
      },
      plannerPresets: {
        ...promptView.plannerPresets,
        'strong-retention': {
          ...promptView.plannerPresets['strong-retention'],
          effectiveContent: '自定义大纲专家提示词',
          versionId: 'custom-planner-v2',
          source: 'custom',
        },
      },
    };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings/content-style') return Promise.resolve(jsonResponse(settings));
      if (url === '/api/settings/content-style/prompts/validate' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ level: 'valid', issues: [] }));
      }
      if (url === '/api/settings/content-style/prompts/reset' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...settings, revision: 1 }));
      }
      if (url === '/api/settings/content-style/prompts?projectId=project-1') {
        return Promise.resolve(jsonResponse(customPromptView));
      }
      if (url === '/api/projects/project-1/content-style' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ contentStyle: { mode: 'override' } }));
      }
      if (url === '/api/projects/project-1/content-style') {
        return Promise.resolve(jsonResponse({ contentStyle: { mode: 'inherit' } }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ContentStyleSettingsDialog projectId="project-1" open onOpenChange={vi.fn()} />);

    const plannerPrompt = await screen.findByLabelText('大纲专家提示词') as HTMLTextAreaElement;
    expect(plannerPrompt.value).toBe('自定义大纲专家提示词');
    fireEvent.click(screen.getByRole('button', { name: '重置为默认' }));
    expect(plannerPrompt.value).toBe('强留存大纲专家提示词');
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/content-style/prompts/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ agent: 'planner', presetId: 'strong-retention', expectedRevision: 0 }),
      }),
    ));
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
