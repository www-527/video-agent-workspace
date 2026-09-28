import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { buildRenderBridgeRuntime, classifyHtmlCompatibility, injectRenderBridge } from '@/lib/render/render-bridge';

describe('RenderBridge v1', () => {
  it('classifies controlled, repaired and realtime-fallback scenes', () => {
    expect(classifyHtmlCompatibility('<div>static</div>').compatibility).toBe('offline-compatible');
    expect(classifyHtmlCompatibility('<script>setTimeout(run, 10)</script>').compatibility).toBe('offline-repaired');
    expect(classifyHtmlCompatibility('<canvas></canvas><script>new Worker("clock.js")</script>').compatibility).toBe('realtime-fallback');
  });

  it('injects the protocol before authored head content and hides editor layers', () => {
    const html = injectRenderBridge('<html><head><script>window.authored=true</script></head><body><div data-editor-selected></div></body></html>');
    expect(html.indexOf('data-render-bridge="v1"')).toBeLessThan(html.indexOf('window.authored=true'));
    expect(html).toContain('[data-editor-selected]');
    expect(html).toContain('__renderBridge');
  });

  it('provides an app base URL for any remaining relative resources', () => {
    const html = injectRenderBridge(
      '<html><head></head><body><img src="/api/data/pexels/project/frame.jpg" alt="test"></body></html>',
      { baseUrl: 'http://127.0.0.1:3000/' },
    );
    expect(html).toContain('<base href="http://127.0.0.1:3000/">');
    expect(html).toContain('src="/api/data/pexels/project/frame.jpg"');
    expect(html).not.toContain('file:///');
  });

  it('uses the same visual stability runtime as the interactive preview', () => {
    const html = injectRenderBridge(
      '<html><head></head><body><main data-layout="stack"></main></body></html>',
      { canvasPreset: 'douyin-portrait-9-16' },
    );
    expect(html).toContain('data-ai-visual-stability');
    expect(html).toContain('function preserveAnimatedPositioningTransforms()');
    expect(html).toContain('function applyAdaptiveStackLayout()');
    expect(html).toContain('while (size > 56');
  });

  it('treats a completed-but-broken image as a render resource failure', () => {
    const runtime = buildRenderBridgeRuntime();
    expect(runtime).toContain('图片加载失败: ');
    expect(runtime).toContain('!image.naturalWidth || !image.naturalHeight');
    expect(runtime).not.toContain('image.decode ? image.decode().catch(function () {})');
  });

  it('drives managed timers deterministically at 0%, 50% and 100%', async () => {
    const window = new Window({ url: 'http://render.local/' });
    window.document.body.innerHTML = '<div id="state">0</div>';
    window.eval(buildRenderBridgeRuntime());
    window.eval(`
      setTimeout(function(){ document.getElementById('state').textContent = '50'; }, 500);
      setTimeout(function(){ document.getElementById('state').textContent = '100'; }, 1000);
    `);
    await new Promise(resolve => setTimeout(resolve, 0));
    const bridge = (window as unknown as { __renderBridge: { setTime(ms: number): Promise<void> } }).__renderBridge;
    await bridge.setTime(0);
    expect(window.document.getElementById('state')?.textContent).toBe('0');
    await bridge.setTime(500);
    expect(window.document.getElementById('state')?.textContent).toBe('50');
    await bridge.setTime(1000);
    expect(window.document.getElementById('state')?.textContent).toBe('100');
  });

  it('uses the same fixed random sequence in independent documents', () => {
    const first = new Window();
    const second = new Window();
    first.eval(buildRenderBridgeRuntime());
    second.eval(buildRenderBridgeRuntime());
    expect(first.Math.random()).toBe(second.Math.random());
    expect(first.Math.random()).toBe(second.Math.random());
  });
});
