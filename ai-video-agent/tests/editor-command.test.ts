import { describe, expect, it } from 'vitest';
import { applyEditCommand, compileLocalEdit, extractEditableElements } from '@/lib/editor-command';
import { useStudioStore } from '@/stores/studio-store';

const title = { id: 'main-title', label: '主标题', tag: 'h1', type: 'text' as const, editable: ['position'] };

describe('editor command compiler', () => {
  it('gives fuzzy language a stable value', () => {
    const command = compileLocalEdit('往上移一点', 'frame-3', title);
    expect(command?.changes).toEqual({ translateY: -28 });
    expect(command?.preserve).toContain('narration');
  });

  it('uses explicit pixels when supplied', () => {
    expect(compileLocalEdit('向上移动 36px', 'frame-3', title)?.changes.translateY).toBe(-36);
  });

  it('extracts current and legacy stable ids', () => {
    const current = extractEditableElements('<h1 data-editor-id="main-title" data-editor-label="主标题">标题</h1>');
    const legacy = extractEditableElements('<h1 data-element-id="main-title" data-element-label="主标题">标题</h1>');
    expect(current[0].id).toBe('main-title');
    expect(legacy[0].id).toBe('main-title');
  });

  it('adds deterministic ids to visible legacy elements', () => {
    const html = '<main><h1>核心标题</h1><p>解释文字</p><svg aria-label="趋势图"></svg></main>';
    expect(extractEditableElements(html).map(element => element.label)).toEqual(['核心标题', '解释文字', '趋势图']);
    expect(extractEditableElements(html).map(element => element.id)).toEqual([
      'auto-h1-1', 'auto-p-2', 'auto-svg-3',
    ]);
  });

  it('recognizes directly rendered div copy as editable text', () => {
    const elements = extractEditableElements([
      '<div data-editor-id="prompt">Prompt</div>',
      '<div data-editor-id="supplement">补充信息</div>',
      '<div data-editor-id="card" data-role="composite">卡片容器</div>',
    ].join(''));
    expect(elements.find(element => element.id === 'prompt')?.type).toBe('text');
    expect(elements.find(element => element.id === 'supplement')?.type).toBe('text');
    expect(elements.find(element => element.id === 'card')?.type).toBe('visual');
  });

  it('recognizes buttons and list items as editable copy', () => {
    const elements = extractEditableElements([
      '<button data-editor-id="action">继续</button>',
      '<li data-editor-id="step">步骤一</li>',
    ].join(''));
    expect(elements.map(element => element.type)).toEqual(['text', 'text']);
  });

  it('makes class-named CSS visuals such as a plus selectable', () => {
    const html = '<div class="layout"><div class="center-plus"><i></i></div></div>';
    const elements = extractEditableElements(html);
    expect(elements.map(element => element.label)).toContain('加号图形');
    expect(elements.find(element => element.label === '加号图形')?.id).toMatch(/^auto-div-/);
  });

  it('makes legacy timeline and divider hosts selectable with useful labels', () => {
    const html = '<div class="bottle-timeline"></div><div class="section-divider"></div>';
    const elements = extractEditableElements(html);
    expect(elements.map(element => element.label)).toEqual(['时间轴横线', '分隔横线']);
    expect(elements.every(element => element.id.startsWith('auto-div-'))).toBe(true);
  });

  it('treats a CSS person as one selectable composite', () => {
    const html = '<div class="person"><div class="knowledge-icon"></div><div class="silhouette"></div></div>';
    const person = extractEditableElements(html).find(element => element.label.startsWith('人员图形'));
    expect(person?.id).toMatch(/^auto-div-/);
  });

  it('filters technical names and encoded symbol labels', () => {
    const html = [
      '<div data-editor-id="group" data-editor-label="medal-group"></div>',
      '<div data-editor-id="connector" data-editor-label="connector"></div>',
      '<span data-editor-id="symbol" data-editor-label="&#9632;">&#9632;</span>',
      '<span data-editor-id="decision">决策链路</span>',
    ].join('');
    expect(extractEditableElements(html).map(element => element.label)).toEqual(['决策链路']);
  });

  it('applies a scoped patch without rewriting content', () => {
    const command = compileLocalEdit('往上移一点', 'frame-3', title)!;
    const html = applyEditCommand('<html><head></head><body><h1 data-editor-id="main-title">原文</h1></body></html>', command);
    expect(html).toContain('[data-editor-id="main-title"]');
    expect(html).toContain('translate: 0px -28px !important');
    expect(html).not.toContain('transform: translateY');
    expect(html).toContain('原文');
  });

  it('applies direct geometry, typography and rotation values', () => {
    const html = applyEditCommand('<h1 data-editor-id="main-title">原文</h1>', {
      id: 'direct-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '直接编辑',
      changes: { left: 120, width: 360, fontSize: 48, fontFamily: 'Aptos', rotate: 12, opacity: 0.8 },
    });
    expect(html).toContain('left: 120px');
    expect(html).toContain('width: 360px');
    expect(html).toContain('font-size: 48px');
    expect(html).toContain('font-family: Aptos');
    expect(html).toContain('rotate(12deg)');
    expect(html).not.toContain('data-role="text-zone"],[data-role="visual-zone"');
  });

  it('moves an element vertically without changing its X coordinate', () => {
    const html = applyEditCommand('<div data-editor-id="main-title">原文</div>', {
      id: 'vertical-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '置底', changes: { top: 640 },
    });
    expect(html).toContain('top: 640px');
    expect(html).toContain('bottom: auto');
    expect(html).not.toContain('left:');
  });

  it('uses the entered canvas coordinates exactly and clears legacy translation', () => {
    const html = applyEditCommand('<div data-editor-id="main-title">原文</div>', {
      id: 'canvas-position-exact', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '移动到 300, 240',
      changes: { left: 300, top: 240 },
    });
    expect(html).toContain('left: 300px !important');
    expect(html).toContain('top: 240px !important');
    expect(html).toContain('position: fixed !important');
    expect(html).toContain('translate: none !important');
    expect(html).not.toContain('animation: none !important');
  });

  it('moves by a canvas delta without changing the authored positioning model', () => {
    const html = applyEditCommand('<div data-editor-id="main-title" style="transform:translateX(-50%)">原文</div>', {
      id: 'canvas-delta-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '画布移动',
      changes: { canvasDeltaX: 20, canvasDeltaY: -12 },
    });
    expect(html).toContain('translate: 20px -12px !important');
    expect(html).not.toContain('position: fixed !important');
    expect(html).not.toContain('left:');
    expect(html).not.toContain('top:');
    expect(html).not.toContain('transform: none !important');
  });

  it('accumulates consecutive canvas deltas', () => {
    const move = (id: string, canvasDeltaX: number, canvasDeltaY: number) => ({
      id, operation: 'update_element' as const, frameId: 'frame-3', elementId: 'main-title',
      scope: 'element' as const, preserve: [], source: 'direct' as const, summary: '画布移动',
      changes: { canvasDeltaX, canvasDeltaY },
    });
    const once = applyEditCommand('<div data-editor-id="main-title">原文</div>', move('delta-1', 20, -12));
    const twice = applyEditCommand(once, move('delta-2', 15, 8));
    expect(twice).toContain('translate: 35px -4px !important');
  });

  it('keeps the canvas offset when a later scale edit is applied', () => {
    const moved = applyEditCommand('<div data-editor-id="main-title">原文</div>', {
      id: 'canvas-delta-before-scale', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '画布移动', changes: { canvasDeltaX: 20 },
    });
    const scaled = applyEditCommand(moved, {
      id: 'scale-after-canvas-delta', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '缩放', changes: { scale: 1.2 },
    });
    expect(scaled).toContain('translate: 20px 0px !important');
    expect(scaled).toContain('transform: scale(1.2) !important');
  });

  it('moves the title block instead of detaching an inline highlighted phrase', () => {
    const html = '<div data-editor-id="title">前半句<span data-editor-id="accent">关键词</span>后半句</div>';
    const moved = applyEditCommand(html, {
      id: 'inline-position-safe', operation: 'update_element', frameId: 'frame-3', elementId: 'accent',
      scope: 'element', preserve: [], source: 'auto', summary: '自动移动',
      changes: { left: 160, top: 157 },
    });
    expect(moved).toContain('[data-editor-id="title"],[data-element-id="title"]');
    expect(moved).not.toContain('[data-editor-id="accent"],[data-element-id="accent"]{left:');
  });

  it('keeps a manually selected opacity when a later position edit preserves animation', () => {
    const faded = applyEditCommand('<div data-editor-id="portrait">原文</div>', {
      id: 'opacity-1', operation: 'update_element', frameId: 'frame-3', elementId: 'portrait',
      scope: 'element', preserve: [], source: 'direct', summary: '透明度', changes: { opacity: 0.6 },
    });
    const moved = applyEditCommand(faded, {
      id: 'position-1', operation: 'update_element', frameId: 'frame-3', elementId: 'portrait',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 300, top: 240 },
    });
    expect(moved).toContain('--editor-visible-opacity: 0.6 !important');
    expect(moved).toContain('opacity: 0.6 !important');
    expect(moved).not.toContain('animation: none !important');
  });

  it('keeps an animated connector running when directly repositioned', () => {
    const html = [
      '<style>.connector-line{transform:scaleX(0);animation:growLine .6s forwards}@keyframes growLine{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}</style>',
      '<div class="connector-line" data-editor-id="connector-line">线</div>',
    ].join('');
    const moved = applyEditCommand(html, {
      id: 'connector-position', operation: 'update_element', frameId: 'frame-3', elementId: 'connector-line',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 748, top: 166 },
    });
    expect(moved).toContain('left: 748px !important');
    expect(moved).toContain('top: 166px !important');
    expect(moved).not.toContain('animation: none !important');
    expect(moved).not.toContain('transform: scaleX(1) !important');
  });

  it('keeps an authored transform when only coordinates are edited', () => {
    const html = applyEditCommand('<div data-editor-id="main-title" style="transform:scale(1.25) rotate(8deg)">原文</div>', {
      id: 'keep-authored-transform', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '移动到 300, 240', changes: { left: 300, top: 240 },
    });
    expect(html).toContain('left: 300px !important');
    expect(html).not.toContain('transform: none !important');
  });

  it('composes consecutive relative moves instead of overwriting them', () => {
    const command = (id: string) => ({
      id, operation: 'update_element' as const, frameId: 'frame-3', elementId: 'main-title',
      scope: 'element' as const, preserve: [], source: 'rule' as const, summary: '上移', changes: { translateY: -20 },
    });
    const once = applyEditCommand('<h1 data-editor-id="main-title">原文</h1>', command('move-1'));
    const twice = applyEditCommand(once, command('move-2'));
    expect(twice).toContain('translate: 0px -40px !important');
  });

  it('keeps scale when a later coordinate edit is applied', () => {
    const scaled = applyEditCommand('<h1 data-editor-id="main-title">原文</h1>', {
      id: 'scale-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '缩放', changes: { scale: 1.2 },
    });
    const moved = applyEditCommand(scaled, {
      id: 'move-after-scale', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 120, top: 80 },
    });
    expect(moved).toContain('transform: scale(1.2) !important');
  });

  it('keeps centering translation during direct geometry edits', () => {
    const html = applyEditCommand('<h1 data-editor-id="main-title">原文</h1>', {
      id: 'center-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '居中', changes: { left: '50%', top: '50%', center: true },
    });
    expect(html).toContain('translate: -50% -50% !important');
    expect(html).not.toContain('transform: none !important');
  });

  it('uses the canvas viewport when a direct position edit is made', () => {
    const html = applyEditCommand('<div class="visual-zone"><div data-editor-id="nested">原文</div></div>', {
      id: 'canvas-position-1', operation: 'update_element', frameId: 'frame-3', elementId: 'nested',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 120, top: 80 },
    });
    expect(html).toContain('position: fixed !important');
    expect(html).toContain('right: auto !important');
    expect(html).not.toContain('transform: none !important');
    expect(html).not.toContain('animation: none !important');
    expect(html).not.toContain('data-role="text-zone"],[data-role="visual-zone"');
    expect(html).not.toContain('data-editor-portal=');
    expect(html).not.toContain('stage.appendChild(target)');
  });

  it('releases only the containing layout zone when positioning a nested element', () => {
    const html = applyEditCommand('<section data-role="visual-zone"><div data-editor-id="nested">原文</div></section>', {
      id: 'contained-position-1', operation: 'update_element', frameId: 'frame-3', elementId: 'nested',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 300, top: 240 },
    });
    expect(html).toContain('[data-role="visual-zone"]:has([data-editor-id="nested"],[data-element-id="nested"]){contain:none !important;transform:none !important;filter:none !important;perspective:none !important;will-change:auto !important}');
    expect(html).not.toContain('[data-role="text-zone"],[data-role="visual-zone"]{contain:none');
  });

  it('removes legacy element portal scripts when applying a new edit', () => {
    const html = applyEditCommand('<script data-editor-portal="legacy">stage.appendChild(target)</script><div data-editor-id="nested">原文</div>', {
      id: 'legacy-cleanup-1', operation: 'update_element', frameId: 'frame-3', elementId: 'nested',
      scope: 'element', preserve: [], source: 'direct', summary: '移动', changes: { left: 120, top: 80 },
    });
    expect(html).not.toContain('data-editor-portal=');
    expect(html).not.toContain('stage.appendChild(target)');
  });

  it('replaces text and duplicates an element structurally', () => {
    const base = '<div><h1 data-editor-id="main-title" data-editor-label="主标题">原文</h1></div>';
    const changed = applyEditCommand(base, {
      id: 'text-1', operation: 'update_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '修改文字', changes: { text: '新标题' },
    });
    expect(changed).toContain('新标题');
    const copied = applyEditCommand(changed, {
      id: 'copy-123456', operation: 'duplicate_element', frameId: 'frame-3', elementId: 'main-title',
      scope: 'element', preserve: [], source: 'direct', summary: '复制', changes: {},
    });
    expect(copied).toContain('main-title-copy-copy-1');
    expect(copied.match(/新标题/g)).toHaveLength(2);
  });
});

describe('per-frame edit history', () => {
  it('keeps undo stacks isolated by frame', () => {
    useStudioStore.setState({ editHistoryByFrame: {} });
    const push = useStudioStore.getState().pushEditHistory;
    const makeEntry = (frameId: string, id: string) => ({
      id,
      command: {
        id, operation: 'update_element' as const, frameId, elementId: 'title', scope: 'element' as const,
        changes: {}, preserve: [], source: 'direct' as const, summary: id,
      },
      beforeHtml: `<p>${id}-before</p>`, afterHtml: `<p>${id}-after</p>`, createdAt: new Date().toISOString(),
    });

    push(makeEntry('frame-a', 'a-1'));
    push(makeEntry('frame-b', 'b-1'));
    push(makeEntry('frame-a', 'a-2'));

    const histories = useStudioStore.getState().editHistoryByFrame;
    expect(histories['frame-a'].entries.map(entry => entry.id)).toEqual(['a-1', 'a-2']);
    expect(histories['frame-a'].index).toBe(1);
    expect(histories['frame-b'].entries.map(entry => entry.id)).toEqual(['b-1']);
    expect(histories['frame-b'].index).toBe(0);
  });
});
