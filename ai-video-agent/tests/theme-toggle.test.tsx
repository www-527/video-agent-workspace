// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { ThemeMenuItem } from '@/components/theme-toggle';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('ThemeToggle', () => {
  it('switches to the light appearance and persists the selection', () => {
    render(<DropdownMenu open><DropdownMenuContent><ThemeMenuItem /></DropdownMenuContent></DropdownMenu>);

    const toggle = screen.getByRole('switch', { name: '切换至日间模式' });
    expect(toggle.getAttribute('data-state')).toBe('unchecked');

    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem('ai-video:appearance:v1')).toBe('light');
    expect(screen.getByRole('switch', { name: '切换至夜间模式' }).getAttribute('data-state')).toBe('checked');
  });

  it('restores the saved light appearance when it mounts', () => {
    window.localStorage.setItem('ai-video:appearance:v1', 'light');

    render(<DropdownMenu open><DropdownMenuContent><ThemeMenuItem /></DropdownMenuContent></DropdownMenu>);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('switch', { name: '切换至夜间模式' }).getAttribute('data-state')).toBe('checked');
  });

  it('keeps the complete appearance row selectable from the menu', () => {
    render(<DropdownMenu open><DropdownMenuContent><ThemeMenuItem /></DropdownMenuContent></DropdownMenu>);

    fireEvent.click(screen.getByRole('menuitem', { name: '外观：夜间模式' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('switch', { name: '切换至夜间模式' }).getAttribute('data-state')).toBe('checked');
  });
});
