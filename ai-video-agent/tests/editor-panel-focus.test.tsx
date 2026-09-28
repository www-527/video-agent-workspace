// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPanel } from '@/components/studio/editor-panel';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

const project: ProjectDetail = {
  uuid: 'project-1', title: 'Editor focus', type: 'html', canvasPreset: 'landscape-16-9', styleId: null,
  createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z', hasOutline: true,
  outline: { title: 'Outline', totalDuration: 3, frames: [{ id: 'frame-1', index: 1, title: 'Frame', narration: 'Narration' }] },
  videoSource: {
    frames: [{
      id: 'frame-1',
      htmlCode: '<main><h1 data-editor-id="title" data-editor-label="标题">标题</h1><div data-editor-id="card" data-editor-label="数据卡片">卡片</div></main>',
    }],
  },
};

describe('EditorPanel canvas focus', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollIntoView.mockReset();
    useStudioStore.setState({
      selectedFrameId: 'frame-1', selectedElement: null, selectedElementIds: [], elementPanelFocus: null,
      editHistoryByFrame: {}, editorDirty: false, tunePreview: null,
    });
  });

  it('opens the properties context and centers the item selected on the canvas', async () => {
    render(<EditorPanel project={project} onProjectChange={() => undefined} />);

    act(() => {
      useStudioStore.getState().setSelectedElement({ id: 'card', label: '数据卡片', tag: 'div', type: 'visual', editable: [] });
      useStudioStore.getState().setSelectedElementIds(['card']);
      useStudioStore.getState().requestElementPanelFocus('frame-1', 'card');
    });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' }));
    expect(screen.getByRole('button', { name: /选择元素 2/ }).className).toContain('border-teal-500');
    expect(useStudioStore.getState().elementPanelFocus).toBeNull();
  });

  it('keeps destructive editing to one staged delete action and exposes only undo', async () => {
    render(<EditorPanel project={project} onProjectChange={() => undefined} />);

    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '重做' })).toBeNull();
    expect(screen.queryByText('常用操作')).toBeNull();
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();

    act(() => {
      useStudioStore.getState().setSelectedElement({ id: 'title', label: '标题', tag: 'h1', type: 'text', editable: [] });
      useStudioStore.getState().setSelectedElementIds(['title']);
    });

    const deleteButton = await screen.findByRole('button', { name: '删除元素' });
    fireEvent.click(deleteButton);
    expect(screen.getByText('删除 标题')).toBeTruthy();
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
