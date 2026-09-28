// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { extractCompositeTextElements, extractEditableElements, extractFrameTextElements } from '@/lib/editor-command';

describe('editor selection geometry', () => {
  it('uses the containing text block as the geometry target for inline text', () => {
    const elements = extractEditableElements([
      '<h1 data-editor-id="title">',
      '  前半句 <span data-editor-id="accent">关键词</span> 后半句',
      '</h1>',
    ].join(''));
    const accent = elements.find(element => element.id === 'accent');
    expect(accent?.geometryId).toBe('title');
  });

  it('exposes a composite as one selectable root instead of separate children', () => {
    const elements = extractEditableElements([
      '<div data-editor-id="card" data-role="composite" data-editor-label="组合卡片">',
      '  <div data-editor-id="icon" data-editor-label="图标"></div>',
      '  <p data-editor-id="caption">说明</p>',
      '</div>',
    ].join(''));
    expect(elements.map(element => element.id)).toEqual(['card']);
    expect(elements[0].groupRootId).toBe('card');
    expect(elements[0].geometryId).toBe('card');
  });

  it('lists editable copy inside a composite without exposing its visual children', () => {
    const html = [
      '<div data-editor-id="card" data-role="composite" data-editor-label="建议卡片">',
      '  <div data-editor-id="icon" data-editor-label="箭头图标"></div>',
      '  <h3 data-editor-id="heading">行动建议</h3>',
      '  <p data-editor-id="description">明确当下最值得执行的决策</p>',
      '</div>',
    ].join('');
    expect(extractEditableElements(html).map(element => element.id)).toEqual(['card']);
    expect(extractCompositeTextElements(html, 'card').map(element => element.id)).toEqual(['heading', 'description']);
    expect(extractCompositeTextElements(html, 'card').every(element => element.geometryId === 'card')).toBe(true);
  });

  it('builds a complete frame text inventory, including composite children', () => {
    const html = [
      '<h1 data-editor-id="title">财务软件</h1>',
      '<div data-editor-id="finance-card" data-role="composite" data-editor-label="财务软件图标">',
      '  <div data-editor-id="finance-label">财务</div>',
      '  <div data-editor-id="finance-icon" data-editor-label="图标"></div>',
      '</div>',
    ].join('');
    const text = extractFrameTextElements(html);
    expect(text.map(element => element.id)).toEqual(['title', 'finance-label']);
    expect(text.find(element => element.id === 'finance-label')?.groupRootId).toBe('finance-card');
  });

  it('treats an image and its labelled wrapper as one media group', () => {
    const elements = extractEditableElements([
      '<figure data-editor-id="portrait" data-editor-label="人物照片">',
      '  <img data-editor-id="portrait-image" alt="人物">',
      '</figure>',
    ].join(''));
    expect(elements.map(element => element.id)).toEqual(['portrait']);
    expect(elements[0].groupRootId).toBe('portrait');
    expect(elements[0].geometryId).toBe('portrait');
  });

  it('infers a named visual container as one composite group', () => {
    const elements = extractEditableElements([
      '<div class="chat-frame" data-editor-id="chat" data-editor-label="AI聊天框">',
      '  <div data-editor-id="chat-title">AI 助手</div>',
      '  <p data-editor-id="chat-message">生成项目报告</p>',
      '</div>',
    ].join(''));
    expect(elements.map(element => element.id)).toEqual(['chat']);
    expect(elements[0].groupRootId).toBe('chat');
  });
});
