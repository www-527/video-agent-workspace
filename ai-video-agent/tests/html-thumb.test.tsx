// @vitest-environment happy-dom

import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HtmlThumb } from '@/components/studio/html-thumb';

describe('HtmlThumb', () => {
  it('uses a static end-state shell so storyboard cards do not show an empty animation start frame', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(
      <HtmlThumb
        htmlCode="<html><body><script>document.body.dataset.ready = '1';</script><div>frame</div></body></html>"
        scale={0.1}
        frameDuration={12}
      />,
    );

    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('srcdoc')).toContain('ai-thumb-stage');
    expect(iframe?.getAttribute('srcdoc')).toContain('animation-delay: -9999s !important');
    expect(iframe?.getAttribute('srcdoc')).not.toContain("document.body.dataset.ready = '1'");
    vi.unstubAllGlobals();
  });
});
