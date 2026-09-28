// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button motion feedback', () => {
  it('applies the shared motion class to every button variant', () => {
    render(<Button variant="outline">保存</Button>);

    expect(screen.getByRole('button', { name: '保存' }).className).toContain('ui-button-motion');
  });
});
