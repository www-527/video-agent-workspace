import { describe, expect, it } from 'vitest';
import {
  FRAME_HTML_SYSTEM,
  FREE_FRAME_HTML_SYSTEM,
  STRUCTURED_LAYOUT_CONSTRAINTS,
  HtmlValidationError,
  applyRealImageGallery,
  buildFreeFrameHtmlPrompt,
  buildFreeFrameHtmlSystem,
  buildHtmlAttemptPrompt,
  bindRealImageSlots,
  enforceLayoutSafety,
  extractHtmlDocument,
  findUnappliedRealImages,
  formatCurrentVisualPrompt,
  removeRealImageAssets,
  replaceRealImageSlot,
  sanitizeFreeHtml,
  validateGeneratedHtml,
  validateFreeGeneratedHtml,
  validateRealImageUsage,
} from '@/lib/ai/html';
import {
  HTML_NATIVE_VISUAL_GUIDANCE,
  HTML_INTENT_OUTPUT_GUIDANCE,
  HTML_RENDER_QUALITY_GUIDANCE,
} from '@/lib/prompts/html-native-visual';

const validHtml = (extra = '') => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Frame</title>
  <style>
    body { margin: 0; width: 1280px; height: 720px; font-family: Arial, sans-serif; color: #101010; background: #f7f4ee; }
    main { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    [data-role="text-zone"] { position: absolute; left: 72px; top: 72px; width: 480px; z-index: 3; }
    [data-role="visual-zone"] { position: absolute; right: 72px; top: 80px; width: 520px; height: 520px; z-index: 1; }
  </style>
</head>
<body>
    <main data-layout="split">
    <section data-role="text-zone"><h1>Clear title</h1><p>Readable supporting text with enough length for validation.</p></section>
    <section data-role="visual-zone"><div data-role="visual-content"><div>Structured visual subject with motion-ready geometry.</div></div></section>
  </main>
  ${extra}
</body>
</html>`;

describe('HTML generation visual prompt', () => {
  it('translates image-generation metaphors into restrained HTML-native diagrams', () => {
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('保留含义，不要求字面复刻物体');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('1 个视觉主角、1-4 个辅助元素');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('不得要求复刻 ChatGPT 等品牌 Logo');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('传统组织');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('矩形、圆、线和短标签');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('默认不制作人物剪影');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('浏览器窗口、App 界面、聊天记录、社交媒体动态');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('超过预算');
    expect(HTML_NATIVE_VISUAL_GUIDANCE).toContain('禁止继续用 CSS/SVG 零件硬拼');
  });

  it('keeps editable HTML animation prompts natural, compact, and directly translatable', () => {
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('1 个视觉主角');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('45-160 个汉字');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('画面或布局');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('不要使用“主角：…；关系：…；屏幕文字：…”');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('一镜不得混用多种结构');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('人物剪影、人物动作或表演');
    expect(HTML_INTENT_OUTPUT_GUIDANCE).toContain('浏览器、App、聊天和社交媒体 UI');
  });

  it('constrains layout, tokens, complexity, motion, and final-frame quality', () => {
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('先选一种构图，不得混搭');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('把 themeTokens 映射为 :root CSS 变量');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('DOM 元素尽量不超过 30 个');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('全镜只设计 2-3 个时间阶段');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('最终静止帧');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('data-role="composite"');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('有语义的组合遮挡');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('实心分块饼图');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('data-chart-spec');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('不要手写柱高、折线路径、扇形路径');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('半圆仪表盘、环形图');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('78% = 280.8°');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('禁止把它画成半圆仪表盘');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('语义节点放进一个 Grid 或 Flex 容器');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('最多 8 个基础部件、2 类基础形状、1 层局部叠放');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('定位和动画必须分工');
    expect(HTML_RENDER_QUALITY_GUIDANCE).toContain('left/top:50% + translate(-50%,-50%)');
  });

  it('describes the same adaptive stack limits enforced by the renderer', () => {
    expect(FRAME_HTML_SYSTEM + STRUCTURED_LAYOUT_CONSTRAINTS).toContain('protected adaptive handoff');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('y=240..304');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('24px gutter');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('data-role="connector"');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('own grid/flex row');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('Never arrange semantic nodes with unrelated absolute/fixed coordinates');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('at most 8 primitive parts');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('always have padding:0 and margin:0');
    expect(STRUCTURED_LAYOUT_CONSTRAINTS).toContain('Never lower opacity on a container that contains readable text');
  });

  it('puts the user-edited prompt in the highest-priority AI section', () => {
    const editedPrompt = '改为全屏红色时间轴，只显示三个关键年份';
    const section = formatCurrentVisualPrompt(editedPrompt);

    expect(section).toContain('最高内容优先级，必须保留核心语义');
    expect(section).toContain(editedPrompt);
    expect(section).toContain('与下面的旧结构化信息冲突');
    expect(section).toContain('不得字面照画');
  });

  it('asks for raw HTML instead of JSON', () => {
    expect(FRAME_HTML_SYSTEM).toContain('只输出完整 HTML 文档');
    expect(FRAME_HTML_SYSTEM).toContain('不要 JSON');
    expect(FRAME_HTML_SYSTEM).toContain('不要输出思考过程');
    expect(FRAME_HTML_SYSTEM).not.toContain('输出严格 JSON');
    expect(FRAME_HTML_SYSTEM).toContain('每镜最多 2 个');
    expect(FRAME_HTML_SYSTEM).toContain('data-role="micro-label"');
  });

  it('keeps GPT-free HTML creative while retaining only runtime safety', () => {
    const freeHtml = `<!DOCTYPE html><html><head><style>body{margin:0;background:#111}canvas{width:100vw;height:100vh}</style></head><body><canvas id="scene"></canvas><div aria-hidden="true">A deliberately free HTML composition with enough independent structure to pass the minimal runtime document threshold.</div><script>document.querySelector('#scene').getContext('2d');</script></body></html>`;
    expect(() => validateFreeGeneratedHtml(freeHtml)).not.toThrow();
    expect(() => validateFreeGeneratedHtml(freeHtml.replace('</body>', '<img src="https://example.com/x.png"></body>'))).toThrow(/external/);
    expect(() => validateFreeGeneratedHtml(freeHtml.replace('</body>', '<script>Math.random()</script></body>'))).toThrow(/deterministic/);
    expect(() => validateFreeGeneratedHtml(freeHtml.replace('</body>', '<style>.x{animation:pulse 1s infinite}</style></body>'))).toThrow(/infinite/);
    expect(FREE_FRAME_HTML_SYSTEM).not.toContain('allowedLayouts');
    expect(FREE_FRAME_HTML_SYSTEM).not.toContain('maxSemanticObjects');
    expect(FREE_FRAME_HTML_SYSTEM).not.toContain('data-role="focal"');
    expect(FREE_FRAME_HTML_SYSTEM).not.toContain('text-zone');
    expect(FREE_FRAME_HTML_SYSTEM).not.toContain('visual-zone');
    expect(FREE_FRAME_HTML_SYSTEM).toContain('每镜最多 2 个');
    expect(FREE_FRAME_HTML_SYSTEM).toContain('data-role="micro-label"');
    expect(sanitizeFreeHtml(freeHtml)).toContain('data-editor-id="gpt-free-scene"');
  });

  it('adds adaptive density guidance only to portrait free-frame generation', () => {
    const portraitSystem = buildFreeFrameHtmlSystem('douyin-portrait-9-16');
    const landscapeSystem = buildFreeFrameHtmlSystem('landscape-16-9');
    expect(portraitSystem).toContain('竖屏自适应密度建议');
    expect(portraitSystem).toContain('审美倾向，不是固定模板');
    expect(portraitSystem).toContain('只有在叙事上有明确理由时');
    expect(landscapeSystem).toBe(FREE_FRAME_HTML_SYSTEM);
    expect(landscapeSystem).not.toContain('竖屏自适应密度建议');
  });

  it('keeps only concise whole-film constraints when regenerating a GPT-free frame', () => {
    const prompt = buildFreeFrameHtmlPrompt({
      globalScript: '先看见增长，再理解代价。',
      directorPlan: { narrativeMode: 'growth-pressure' } as any,
      creativeBrief: { audience: 'operators' },
      visualAnchor: { approvedFrameIds: ['frame-1'] } as any,
      frame: {
        id: 'frame-1',
        index: 0,
        title: '增长的代价',
        narration: '数字翻倍时，系统压力也开始显形。',
        htmlPrompt: '让增长与压力形成一次尺度反转',
        sceneSpec: {
          visualIntent: '用尺度变化表现反转',
          relationship: 'cause',
          focus: '增长带来的系统压力',
          revealStrategy: 'contrast',
          focalElement: '从 1 万跃迁至 10 万的数字',
          composition: 'turn',
          actionSemantics: '数字扩张后被压力轮廓包围',
          assetStrategy: 'css-svg',
          informationPool: ['用户数从 1 万增长到 10 万', '延迟从 80ms 上升到 260ms'],
          screenText: ['1 万 → 10 万', '80ms → 260ms'],
          assetHints: [],
          durationHint: 8,
          prohibitedPatterns: ['模板化卡片墙'],
        },
      },
      visualBible: {
        version: 'gpt-visual-bible-v1',
        themeId: 'pressure-growth',
        tokens: {
          colors: {
            background: '#07111f',
            surface: '#10243d',
            foreground: '#f4f8ff',
            muted: '#8fa7c2',
            accent: '#ff7a59',
            accentSecondary: '#68d5ff',
          },
          typography: {
            display: 'system-ui',
            body: 'system-ui',
            mono: 'monospace',
            titleSize: '64px',
            bodySize: '24px',
          },
          spacing: { safeArea: '64px', gap: '24px' },
          shape: { radius: '16px', borderWidth: '1px' },
          motion: { duration: '800ms', easing: 'ease-out', stagger: '100ms' },
          signature: 'pressure-growth-v1',
        },
        visualLanguage: '编辑式数据电影语言',
        motifs: ['脉冲环', '刻度跃迁'],
        rhythm: '先克制，再骤然放大',
        prohibitedProblems: ['模板化卡片墙'],
      },
      contentAnchor: {
        topic: '一款 AI 学习助手，如何从一个想法做到 10 万用户？',
        coreMessage: '从真实痛点出发、快速验证并持续复盘，才会形成增长。',
      },
      firstFrameVisualAnchor: {
        frameId: 'frame-1',
        summary: '增长的代价：用尺度反转表现增长与压力。',
      },
      sourceMaterial: '背景材料。\n\n用户数从 1 万增长到 10 万，但延迟从 80ms 上升到 260ms。\n\n无关段落。',
    });

    expect(prompt).toContain('脉冲环');
    expect(prompt).toContain('【叙事锚点】');
    expect(prompt).not.toContain('全片口播');
    expect(prompt).not.toContain('先看见增长，再理解代价。');
    expect(prompt).toContain('pressure-growth');
    expect(prompt).not.toContain('operators');
    expect(prompt).not.toContain('approvedFrameIds');
    expect(prompt).toContain('首镜画面锚点');
    expect(prompt).toContain('从真实痛点出发、快速验证并持续复盘，才会形成增长。');
    expect(prompt).toContain('用户数从 1 万增长到 10 万');
    expect(prompt).toContain('原始素材相关片段');
    expect(prompt).toContain('延迟从 80ms 上升到 260ms');
    expect(prompt).not.toContain('背景材料。');
    expect(prompt).not.toContain('无关段落。');
    expect(prompt).not.toContain('allowedLayouts');
    expect(prompt).not.toContain('maxSemanticObjects');
  });

  it('keeps neighboring and source-material context bounded while retaining whole-film grounding', () => {
    const longGlobalScript = Array.from({ length: 250 }, (_, index) => `[#${index + 1}] 这段完整口播必须注入单镜 Prompt。`).join('\n');
    const sourceMaterial = `${'无关背景资料。\n\n'.repeat(300)}当前镜头证据：风机每分钟减少 20% 的停机时间。\n\n${'无关补充。\n\n'.repeat(300)}`;
    const prompt = buildFreeFrameHtmlPrompt({
      globalScript: longGlobalScript,
      frame: {
        id: 'frame-2', index: 2, title: '停机时间下降', narration: '风机每分钟减少 20% 的停机时间。',
        sceneSpec: { informationPool: ['减少 20% 的停机时间'], durationHint: 8 },
      } as any,
      visualBible: {
        version: 'gpt-visual-bible-v1', themeId: 'wind', visualLanguage: 'industrial editorial', motifs: ['旋转刻度'], rhythm: 'steady', prohibitedProblems: ['模板化卡片墙'],
        tokens: {
          colors: { background: '#07111f', surface: '#10243d', foreground: '#f4f8ff', muted: '#8fa7c2', accent: '#ff7a59', accentSecondary: '#68d5ff' },
          typography: { display: 'system-ui', body: 'system-ui', mono: 'monospace', titleSize: '64px', bodySize: '24px' },
          spacing: { safeArea: '64px', gap: '24px' }, shape: { radius: '16px', borderWidth: '1px' }, motion: { duration: '800ms', easing: 'ease-out', stagger: '100ms' }, signature: 'wind-v1',
        },
      },
      sourceMaterial,
      creativeBrief: { objective: 'explain downtime' },
      directorPlan: { chapterArc: 'diagnosis-to-outcome' } as any,
      visualAnchor: { approvedFrameIds: ['frame-1'] } as any,
      neighboringScenes: [
        { index: 0, title: '远处镜头', visualIntent: '不应出现' },
        { index: 1, title: '前镜', visualIntent: '建立风机基线' },
        { index: 3, title: '后镜', visualIntent: '展示累计收益' },
        { index: 4, title: '更远镜头', visualIntent: '不应出现' },
      ],
    });

    expect(prompt).toContain('【设计令】');
    expect(prompt).toContain('颜色：背景 #07111f');
    expect(prompt).toContain('动作：800ms / ease-out / 100ms');
    expect(prompt).toContain('前镜：{"title":"前镜","visualIntent":"建立风机基线"}');
    expect(prompt).toContain('后镜：{"title":"后镜","visualIntent":"展示累计收益"}');
    expect(prompt).not.toContain(longGlobalScript.slice(0, 80));
    expect(prompt).not.toContain('远处镜头');
    expect(prompt).not.toContain('更远镜头');
    expect(prompt).not.toContain('explain downtime');
    expect(prompt).not.toContain('diagnosis-to-outcome');
    expect(prompt).not.toContain('approvedFrameIds');
    expect(prompt.length).toBeLessThan(2_500);
  });

  it('keeps only the numeric film position instead of repeating a short film script in every frame', () => {
    const prompt = buildFreeFrameHtmlPrompt({
      globalScript: '[#1] Hook: establish the tension\n[#2] Proof: show the mechanism\n[#3] Conclusion: give the decision rule',
      frame: {
        id: 'frame-3', index: 3, title: 'Conclusion', narration: 'Use the rule to decide.',
        sceneSpec: { informationPool: ['The task fails without the mechanism'], durationHint: 6 },
      } as any,
      visualBible: {
        version: 'gpt-visual-bible-v1', themeId: 'test', visualLanguage: 'editorial', motifs: [], rhythm: 'clear', prohibitedProblems: [],
        tokens: {
          colors: { background: '#000000', surface: '#111111', foreground: '#ffffff', muted: '#999999', accent: '#ff0000', accentSecondary: '#00ff00' },
          typography: { display: 'serif', body: 'sans-serif', mono: 'monospace', titleSize: '64px', bodySize: '24px' },
          spacing: { safeArea: '64px', gap: '24px' }, shape: { radius: '0px', borderWidth: '1px' }, motion: { duration: '500ms', easing: 'ease', stagger: '100ms' }, signature: 'editorial',
        },
      },
      contentAnchor: { topic: 'Test film', coreMessage: 'A coherent conclusion needs the prior proof.' },
    });

    expect(prompt).toContain('【全片位置】');
    expect(prompt).toContain('当前为第 3/3 镜');
    expect(prompt).not.toContain('[#1] Hook: establish the tension');
    expect(prompt).not.toContain('[#2] Proof: show the mechanism');
    expect(prompt).not.toContain('[#3] Conclusion: give the decision rule');
    expect(prompt.length).toBeLessThan(1_800);
  });

  it('switches retries to compact HTML mode after an output-limit failure', () => {
    const prompt = buildHtmlAttemptPrompt({
      baseUserPrompt: 'base prompt',
      attempt: 2,
      lastError: new HtmlValidationError([
        'AI HTML output was empty because the model hit the output limit (finish_reason=length).',
      ]),
      lastRaw: '',
      lastFinishReason: 'length',
      compactMode: true,
    });

    expect(prompt).toContain('紧凑 HTML 模式');
    expect(prompt).toContain('7000-10000');
    expect(prompt).toContain('不要思考过程');
    expect(prompt).toContain('不要复用冗长实现');
  });

  it('accepts a complete raw HTML document', () => {
    expect(() => validateGeneratedHtml(validHtml())).not.toThrow();
  });

  it('rejects a load listener removed synchronously before it can run', () => {
    const html = validHtml(`
      <script>
        function startAnimation() {}
        if (document.readyState === 'complete') startAnimation();
        else window.addEventListener('load', startAnimation);
        window.removeEventListener('load', startAnimation);
      </script>
    `);
    expect(() => validateGeneratedHtml(html)).toThrow(/Animation lifecycle removes the load listener before it can run/);
  });

  it('allows one-shot load listeners and removals inside cleanup callbacks', () => {
    const once = validHtml(`<script>
      function startAnimation() {}
      window.addEventListener('load', startAnimation, { once: true });
    </script>`);
    const cleanup = validHtml(`<script>
      function startAnimation() {}
      window.addEventListener('load', startAnimation);
      function cleanup() { window.removeEventListener('load', startAnimation); }
      window.addEventListener('beforeunload', cleanup, { once: true });
    </script>`);
    expect(() => validateGeneratedHtml(once)).not.toThrow();
    expect(() => validateGeneratedHtml(cleanup)).not.toThrow();
  });

  it('allows normal DOMContentLoaded and already-complete startup branches', () => {
    const html = validHtml(`<script>
      function startAnimation() {}
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAnimation, { once: true });
      } else {
        startAnimation();
      }
    </script>`);
    expect(() => validateGeneratedHtml(html)).not.toThrow();
  });

  it('requires supplied Pexels images to be local and inside the visual zone', () => {
    const local = '/api/data/pexels/project/frame-1-42.jpg';
    const html = validHtml().replace('Structured visual subject with motion-ready geometry.', `<img src="${local}" alt="office worker">`);
    expect(() => validateRealImageUsage(html, { localPath: local, alt: 'office worker' })).not.toThrow();
    expect(() => validateRealImageUsage(validHtml(), { localPath: local, alt: 'office worker' })).toThrow(/supplied local real image/);
  });

  it('reports supplied images that are absent from the final HTML', () => {
    const local = '/api/data/pexels/project/frame-1-42.jpg';
    expect(findUnappliedRealImages(validHtml(), [{ localPath: local, alt: 'office worker' }]))
      .toEqual([{ localPath: local, alt: 'office worker' }]);
    const applied = validHtml().replace('Structured visual subject with motion-ready geometry.', `<img src="${local}" alt="office worker">`);
    expect(findUnappliedRealImages(applied, [{ localPath: local, alt: 'office worker' }])).toEqual([]);
  });

  it('binds supplied images to stable slots and replaces only the selected slot', () => {
    const first = '/api/data/pexels/project/frame-1-42.jpg';
    const second = '/api/data/pexels/project/frame-1-43.jpg';
    const next = '/api/data/pexels/project/frame-1-99.jpg';
    const html = validHtml().replace(
      'Structured visual subject with motion-ready geometry.',
      `<img class="hero" src='${first}' alt='first'><img class="hero-reflection" src='${first}' alt='first'><img src="${second}" alt="second">`,
    );
    const slotted = bindRealImageSlots(html, [{ localPath: first }, { localPath: second }]);
    expect(slotted).toContain('data-asset-slot="real-image-1"');
    expect(slotted).toContain('data-asset-slot="real-image-2"');

    const replaced = replaceRealImageSlot(slotted, 0, first, { localPath: next, alt: 'replacement image' });
    expect(replaced).toContain(`src="${next}"`);
    expect(replaced).toContain('alt="replacement image"');
    expect(replaced).toContain(second);
    expect(replaced).not.toContain(first);
    expect(replaced.match(new RegExp(next, 'g'))).toHaveLength(2);
  });

  it('activates orphaned multi-subject candidates as a bounded equal-weight gallery', () => {
    const assets = [1, 2, 3].map(index => ({
      provider: 'pexels' as const,
      photoId: index,
      localPath: `/api/data/pexels/project/frame-7-${index}.jpg`,
      query: `driving subject ${index}`,
      alt: `Driving subject ${index}`,
      width: 1920,
      height: 1080,
      photographer: 'Tester',
      photographerUrl: 'https://example.com/tester',
      pexelsUrl: `https://example.com/photo/${index}`,
      fitMode: 'cover' as const,
      position: 'center' as const,
      layout: 'editorial-split' as const,
      scaleFrom: 1,
      scaleTo: 1.04,
      downloadedAt: new Date(0).toISOString(),
    }));
    const gallery = applyRealImageGallery(validHtml(), assets);

    expect(gallery).toContain('data-ai-gallery-count="3"');
    expect(gallery).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(gallery.match(/data-asset-slot="real-image-/g)).toHaveLength(3);
    expect(gallery).toContain(assets[0].localPath);
    expect(gallery).toContain(assets[2].localPath);
    expect(() => validateGeneratedHtml(gallery)).not.toThrow();
    assets.forEach(asset => expect(() => validateRealImageUsage(gallery, asset)).not.toThrow());
  });

  it('cancels an applied gallery and reveals the preserved native visual', () => {
    const asset = {
      provider: 'pexels' as const,
      photoId: 1,
      localPath: '/api/data/pexels/project/frame-7-1.jpg',
      query: 'modern wifi router',
      alt: 'Modern WiFi router',
      width: 1920,
      height: 1080,
      photographer: 'Tester',
      photographerUrl: 'https://example.com/tester',
      pexelsUrl: 'https://example.com/photo/1',
      fitMode: 'cover' as const,
      position: 'center' as const,
      layout: 'editorial-split' as const,
      scaleFrom: 1,
      scaleTo: 1.04,
      downloadedAt: new Date(0).toISOString(),
    };
    const restored = removeRealImageAssets(applyRealImageGallery(validHtml(), [asset]), [asset]);

    expect(restored).toContain('Structured visual subject with motion-ready geometry.');
    expect(restored).not.toContain(asset.localPath);
    expect(restored).not.toContain('data-ai-real-image-gallery="true"');
    expect(restored).not.toContain('data-asset-slot="real-image-1"');
    expect(() => validateGeneratedHtml(restored)).not.toThrow();
  });

  it('uses a bounded typographic fallback when cancelling a model-authored image slot', () => {
    const path = '/api/data/pexels/project/frame-1-42.jpg';
    const slotted = bindRealImageSlots(
      validHtml().replace('Structured visual subject with motion-ready geometry.', `<img src="${path}" alt="WiFi 7 router product">`),
      [{ localPath: path }],
    );
    const restored = removeRealImageAssets(slotted, [{ alt: 'WiFi 7 router product' }]);

    expect(restored).not.toContain(path);
    expect(restored).toContain('data-ai-real-image-fallback="true"');
    expect(restored).toContain('WiFi 7 router product');
    expect(() => validateGeneratedHtml(restored)).not.toThrow();
  });

  it('allows lightweight semantic overlays inside a real-image visual zone', () => {
    const local = '/api/data/pexels/project/frame-1-42.jpg';
    const html = validHtml().replace('Structured visual subject with motion-ready geometry.', `<img src="${local}" alt="office worker"><span>K</span>`);
    expect(() => validateRealImageUsage(html, { localPath: local, alt: 'office worker' })).not.toThrow();
  });

  it('rejects scenes without a protected split or stack layout', () => {
    expect(() => validateGeneratedHtml(validHtml().replace(' data-layout="split"', ''))).toThrow(/data-layout/);
  });

  it('rejects scenes without a fit-safe visual content wrapper', () => {
    expect(() => validateGeneratedHtml(validHtml().replace(' data-role="visual-content"', ''))).toThrow(/visual-content/);
  });

  it('injects fixed zone geometry without a runtime auto-fit transform', () => {
    const guarded = enforceLayoutSafety(validHtml());
    expect(guarded).toContain('data-ai-layout-guard');
    expect(guarded).toContain('left:568px!important');
    expect(guarded).toContain('height:544px!important');
    expect(guarded).toContain('overflow:hidden!important');
    expect(guarded).toContain('transform:none!important');
    expect(guarded).toContain('--ai-stack-visual-top:304px');
    expect(guarded).toContain('height:calc(600px - var(--ai-stack-visual-top))!important');
    expect(guarded).not.toContain('data-ai-fit-guard');
    expect(guarded).not.toContain('--ai-fit-scale');
    expect(enforceLayoutSafety(guarded)).toBe(guarded);
  });

  it('extracts HTML from a markdown code fence', () => {
    expect(extractHtmlDocument(`\`\`\`html\n${validHtml()}\n\`\`\``)).toBe(validHtml());
  });

  it('fails when the closing html tag is missing', () => {
    expect(() => extractHtmlDocument(validHtml().replace('</html>', ''))).toThrow(/missing <\/html>/);
  });

  it('rejects external CDN resources', () => {
    expect(() => validateGeneratedHtml(validHtml('<script src="https://cdn.example.com/lib.js"></script>'))).toThrow(/external http/);
  });

  it('rejects emoji', () => {
    expect(() => validateGeneratedHtml(validHtml('<span>✅</span>'))).toThrow(/emoji/);
  });

  it('does not scan unrelated text for forbidden map wording', () => {
    const html = validHtml('<aside>编辑说明：禁止地图，改用数字排版。</aside>');
    expect(() => validateGeneratedHtml(html)).not.toThrow();
  });

  it('rejects map classes and content inside the visual region', () => {
    const html = validHtml().replace(
      'Structured visual subject with motion-ready geometry.',
      '<div class="map-outline">中国地图轮廓</div>',
    );
    expect(() => validateGeneratedHtml(html)).toThrow(/maps or geographic silhouettes/);
  });

  it('rejects JSON-wrapped HTML as the generation format', () => {
    expect(() => extractHtmlDocument(JSON.stringify({ html: validHtml() }))).toThrow(/not a JSON object/);
  });
});
