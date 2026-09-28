import type { EditCommand, EditableElement } from '@/types';
import { resolveCanvasPositionTargetId, stripLegacyAutoFitGuard } from '@/lib/layout-safety';

export const EDIT_SEMANTICS = {
  littleY: 28,
  littleX: 51,
  slightlyScale: 1.1,
  obviousScale: 1.25,
  fasterDuration: 0.8,
} as const;

const TEXT_ELEMENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em',
  'button', 'li', 'blockquote', 'text', 'tspan',
]);

function isEditableTextTag(tag: string): boolean {
  return TEXT_ELEMENT_TAGS.has(tag.toLowerCase());
}

/**
 * A selectable element is text when it represents an independently editable
 * visible copy unit. Do not rely solely on the tag: generated scenes often
 * use styled divs for labels, captions, and callouts.
 */
export function isEditableTextElement(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (isEditorInfrastructure(htmlElement) || isExplicitlyHidden(htmlElement)) return false;
  const tag = element.tagName.toLowerCase();
  if (isEditableTextTag(tag)) return true;

  const role = htmlElement.dataset.role || '';
  if (role === 'composite' || role === 'decoration') return false;
  const directText = directVisibleText(element).trim();
  if (!directText) return false;

  // A wrapper around separately addressable children is a layout container,
  // not its own copy field. A direct text node, however, is safe to edit.
  return !Array.from(element.children).some(child =>
    child.hasAttribute('data-editor-id') || child.hasAttribute('data-element-id'));
}

export function extractEditableElements(html: string): EditableElement[] {
  html = ensureEditableElementIds(html);
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const results: EditableElement[] = [];
    document.querySelectorAll<HTMLElement>('[data-editor-id]').forEach(element => {
      if (results.length >= 80 || isEditorInfrastructure(element)) return;
      const parentGroup = findDomGroupRoot(element);
      if (parentGroup && parentGroup !== element) return;
      const id = element.dataset.editorId;
      if (!id) return;
      const tag = element.tagName.toLowerCase();
      const label = getFriendlyLabel(
        element.dataset.editorLabel || element.getAttribute('aria-label') || element.getAttribute('alt') || '',
        directVisibleText(element) || element.textContent || '',
        tag,
        attributesToText(element),
        results.length + 1,
      );
      if (!label) return;
      const type = isEditableTextElement(element) ? 'text' : 'visual';
      results.push({ id, geometryId: element.dataset.editorGeometryId || id,
        groupRootId: parentGroup?.dataset.editorId, label, tag, type, editable: type === 'text'
        ? ['position', 'size', 'color', 'opacity', 'animation']
        : ['position', 'size', 'opacity', 'animation'] });
    });
    return results;
  }
  const results: EditableElement[] = [];
  const pattern = /<([a-z][\w-]*)([^>]*\bdata-editor-id\s*=\s*(["'])([^"']+)\3[^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < 80) {
    const id = match[4];
    const attrs = match[2];
    const tag = match[1].toLowerCase();
    const rawLabel = attrs.match(/data-editor-label\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const visibleText = decodeHtmlText(match[5].replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' '));
    const label = getFriendlyLabel(rawLabel, visibleText, tag, attrs, results.length + 1);
    if (!label) continue;
    const isComposite = /\bdata-role\s*=\s*["'](?:composite|decoration)["']/i.test(attrs);
    const hasNestedEditableChild = /<[^>]+\bdata-(?:editor|element)-id\s*=/i.test(match[5]);
    const type = (isEditableTextTag(tag) || (!isComposite && !hasNestedEditableChild && visibleText.trim())) ? 'text' : 'visual';
    results.push({ id, label, tag, type, editable: type === 'text'
      ? ['position', 'size', 'color', 'opacity', 'animation']
      : ['position', 'size', 'opacity', 'animation'] });
  }
  return results;
}

/**
 * Returns independently editable copy inside a composite. The primary element
 * list hides composite children to stay compact; the inspector uses this for
 * its card-content picker.
 */
export function extractCompositeTextElements(html: string, compositeId: string): EditableElement[] {
  html = ensureEditableElementIds(html);
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const composite = Array.from(document.querySelectorAll<HTMLElement>('[data-editor-id]'))
    .find(element => element.dataset.editorId === compositeId);
  if (!composite || (composite.dataset.role !== 'composite' && !composite.dataset.editorGroup)) return [];

  const results: EditableElement[] = [];
  composite.querySelectorAll<HTMLElement>('[data-editor-id]').forEach(element => {
    if (results.length >= 40 || element === composite || !isEditableTextElement(element)) return;
    const id = element.dataset.editorId;
    if (!id || results.some(item => item.id === id)) return;
    const tag = element.tagName.toLowerCase();
    const label = getFriendlyLabel(
      element.dataset.editorLabel || element.getAttribute('aria-label') || '',
      directVisibleText(element) || element.textContent || '',
      tag,
      attributesToText(element),
      results.length + 1,
    );
    if (!label) return;
    results.push({ id, geometryId: composite.dataset.editorId, groupRootId: composite.dataset.editorId,
      label, tag, type: 'text', editable: ['position', 'size', 'color', 'opacity', 'animation'] });
  });
  return results;
}

/** List every independently editable text unit in a frame, including text
 * nested in cards and other composite components. */
export function extractFrameTextElements(html: string): EditableElement[] {
  html = ensureEditableElementIds(html);
  if (typeof DOMParser === 'undefined') return extractEditableElements(html).filter(element => element.type === 'text');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const results: EditableElement[] = [];
  document.querySelectorAll<HTMLElement>('[data-editor-id]').forEach(element => {
    if (results.length >= 120 || !isEditableTextElement(element)) return;
    const id = element.dataset.editorId;
    if (!id || results.some(item => item.id === id)) return;
    const tag = element.tagName.toLowerCase();
    const label = getFriendlyLabel(
      element.dataset.editorLabel || element.getAttribute('aria-label') || '',
      directVisibleText(element) || element.textContent || '',
      tag,
      attributesToText(element),
      results.length + 1,
    );
    if (!label) return;
    const groupRoot = findDomGroupRoot(element);
    const geometry = resolveDomGeometryTarget(element);
    results.push({
      id,
      geometryId: geometry.dataset.editorId || id,
      groupRootId: groupRoot?.dataset.editorId,
      label,
      tag,
      type: 'text',
      editable: ['position', 'size', 'color', 'opacity', 'animation'],
    });
  });
  return results;
}

/** Add deterministic IDs to visible semantic elements in legacy frames. */
export function ensureEditableElementIds(html: string): string {
  let normalized = html
    .replace(/data-element-id/gi, 'data-editor-id')
    .replace(/data-element-label/gi, 'data-editor-label');
  if (typeof DOMParser !== 'undefined') {
    const hasDocument = /<html\b/i.test(normalized);
    const document = new DOMParser().parseFromString(normalized, 'text/html');
    let index = 0;
    let graphicIndex = 0;
    document.body.querySelectorAll<HTMLElement>('*').forEach(element => {
      if (isEditorInfrastructure(element) || isExplicitlyHidden(element)) return;
      const tag = element.tagName.toLowerCase();
      const directText = directVisibleText(element);
      const role = element.dataset.role || '';
      const semantic = /^(h1|h2|h3|h4|h5|h6|p|span|strong|em|button|li|blockquote|text|tspan|img|svg)$/.test(tag);
      const visualGroup = role === 'composite' || role === 'decoration';
      const cssVisual = isCssVisualElement(element);
      const described = Boolean(element.dataset.editorLabel || element.getAttribute('aria-label') || element.getAttribute('alt'));
      if (!element.dataset.editorId && !semantic && !directText && !visualGroup && !cssVisual && !described) return;
      index += 1;
      if (!element.dataset.editorId) element.dataset.editorId = `auto-${tag}-${index}`;
      if (role === 'composite') element.dataset.editorGroup = element.dataset.editorGroup || 'composite';
      else if (isPersonComposite(element)) element.dataset.editorGroup = element.dataset.editorGroup || 'person';
      if (!element.dataset.editorLabel) {
        const authored = element.getAttribute('aria-label') || element.getAttribute('alt') || '';
        if (authored) element.dataset.editorLabel = authored;
        else if (directText) element.dataset.editorLabel = directText.slice(0, 32);
        else if (visualGroup || cssVisual || tag === 'svg' || tag === 'img') {
          graphicIndex += 1;
          element.dataset.editorLabel = getCssVisualLabel(element, graphicIndex, role);
        }
      }
    });
    document.body.querySelectorAll<HTMLElement>('img[data-editor-id]').forEach(image => {
      const parent = image.parentElement;
      if (parent?.dataset.editorId && parent.dataset.editorLabel) parent.dataset.editorGroup ||= 'media';
    });
    document.body.querySelectorAll<HTMLElement>('[data-editor-id]').forEach(element => {
      if (element.dataset.editorGroup || !isLikelyCompositeContainer(element)) return;
      const editableChildren = element.querySelectorAll('[data-editor-id],[data-element-id]');
      if (editableChildren.length >= 2) element.dataset.editorGroup = 'composite';
    });
    document.body.querySelectorAll<HTMLElement>('[data-editor-id]').forEach(element => {
      const geometry = resolveDomGeometryTarget(element);
      if (geometry?.dataset.editorId && geometry !== element) element.dataset.editorGeometryId = geometry.dataset.editorId;
      else delete element.dataset.editorGeometryId;
    });
    const serialized = hasDocument ? document.documentElement.outerHTML : document.body.innerHTML;
    return /<!doctype/i.test(normalized) && hasDocument ? `<!DOCTYPE html>${serialized}` : serialized;
  }
  let index = 0;
  const editableTags = /<(h1|h2|h3|h4|p|span|strong|em|button|li|blockquote|img|svg|div)\b([^>]*)>/gi;
  normalized = normalized.replace(editableTags, (full, tag: string, attrs: string) => {
    if (/\bdata-editor-id\s*=/i.test(attrs)) return full;
    if (/\b(?:aria-hidden\s*=\s*["']true|hidden)\b/i.test(attrs)) return full;
    if (tag.toLowerCase() === 'div' && !isLegacyCssVisualAttribute(attrs)) return full;
    index += 1;
    const person = /(?:class|id)\s*=\s*["'][^"']*\bperson\b[^"']*["']/i.test(attrs);
    const visualName = tag.toLowerCase() === 'div' ? ` data-editor-label="${legacyCssVisualLabel(attrs, index, person)}"` : '';
    const group = person ? ' data-editor-group="person"' : '';
    return `<${tag} data-editor-id="auto-${tag.toLowerCase()}-${index}"${visualName}${group}${attrs}>`;
  });
  return normalized;
}

const DOM_INLINE_TEXT_TAGS = new Set(['a', 'b', 'code', 'em', 'i', 'mark', 'small', 'span', 'strong', 'sub', 'sup', 'u']);
const DOM_GEOMETRY_CONTAINER_TAGS = new Set([
  'article', 'aside', 'blockquote', 'div', 'figcaption', 'figure', 'footer', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'li', 'p', 'section', 'td', 'th',
]);

function resolveDomGeometryTarget(element: HTMLElement): HTMLElement {
  const group = findDomGroupRoot(element);
  if (group?.dataset.editorId) return group;
  if (DOM_INLINE_TEXT_TAGS.has(element.tagName.toLowerCase())) {
    let ancestor = element.parentElement;
    while (ancestor) {
      const tag = ancestor.tagName.toLowerCase();
      const role = ancestor.dataset.role || '';
      if (ancestor.dataset.editorId && DOM_GEOMETRY_CONTAINER_TAGS.has(tag)
        && !/^(?:text-zone|visual-zone|visual-content)$/.test(role)) return ancestor;
      ancestor = ancestor.parentElement;
    }
  }
  return element;
}

function findDomGroupRoot(element: HTMLElement): HTMLElement | null {
  let root: HTMLElement | null = null;
  let current: HTMLElement | null = element;
  while (current) {
    if (current.dataset.editorGroup || current.dataset.role === 'composite') root = current;
    current = current.parentElement;
  }
  return root;
}

export function compileLocalEdit(input: string, frameId: string, element: EditableElement): EditCommand | null {
  const text = input.trim().toLowerCase();
  const changes: EditCommand['changes'] = {};
  let operation: EditCommand['operation'] = 'update_element';
  if (/删除|移除/.test(text)) operation = 'delete_element';
  else if (/隐藏/.test(text)) operation = 'hide_element';
  else {
    const explicit = Number(text.match(/(-?\d+(?:\.\d+)?)\s*(?:px|像素)/)?.[1]);
    if (/上移|往上|向上/.test(text)) changes.translateY = -(Number.isFinite(explicit) ? Math.abs(explicit) : EDIT_SEMANTICS.littleY);
    if (/下移|往下|向下/.test(text)) changes.translateY = Number.isFinite(explicit) ? Math.abs(explicit) : EDIT_SEMANTICS.littleY;
    if (/左移|往左|向左/.test(text)) changes.translateX = -(Number.isFinite(explicit) ? Math.abs(explicit) : EDIT_SEMANTICS.littleX);
    if (/右移|往右|向右/.test(text)) changes.translateX = Number.isFinite(explicit) ? Math.abs(explicit) : EDIT_SEMANTICS.littleX;
    if (/居中/.test(text)) { changes.left = '50%'; changes.top = '50%'; changes.center = true; }
    if (/明显.*放大|放大.*明显/.test(text)) changes.scale = EDIT_SEMANTICS.obviousScale;
    else if (/稍微.*放大|放大一点|放大/.test(text)) changes.scale = EDIT_SEMANTICS.slightlyScale;
    if (/稍微.*缩小|缩小一点|缩小/.test(text)) changes.scale = 0.9;
    if (/快一点|加速/.test(text)) changes.durationScale = EDIT_SEMANTICS.fasterDuration;
    if (/慢一点|减速|调慢/.test(text)) changes.durationScale = 1.2;
    const color = text.match(/#[0-9a-f]{3,8}\b/i)?.[0];
    if (color) changes.color = color;
  }
  if (operation === 'update_element' && !Object.keys(changes).length) return null;
  const summary = summarizeCommand(element.label, operation, changes);
  return { id: crypto.randomUUID(), operation, frameId, elementId: element.id, scope: 'element', changes,
    preserve: ['content', 'narration', 'duration', 'otherElements'], source: 'rule', summary };
}

export function applyEditCommand(html: string, command: EditCommand): string {
  html = stripLegacyAutoFitGuard(html);
  // Versions before the stable canvas-coordinate implementation could inject a
  // portal script that reparented the selected node. Remove such legacy scripts
  // as soon as the frame is edited again, so previously saved drafts recover.
  html = html.replace(/<script\b[^>]*\bdata-editor-portal=["'][^"']+["'][^>]*>[\s\S]*?<\/script>/gi, '');
  html = ensureEditableElementIds(html);
  if ((command.operation === 'duplicate_element' || command.changes.text !== undefined) && typeof DOMParser !== 'undefined') {
    const hasDocument = /<html\b/i.test(html);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-editor-id],[data-element-id]'))
      .find(element => element.dataset.editorId === command.elementId || element.dataset.elementId === command.elementId);
    if (target) {
      if (command.changes.text !== undefined) target.textContent = String(command.changes.text);
      if (command.operation === 'duplicate_element') {
        const clone = target.cloneNode(true) as HTMLElement;
        clone.dataset.editorId = `${command.elementId}-copy-${command.id.slice(0, 6)}`;
        clone.dataset.editorLabel = `${target.dataset.editorLabel || target.textContent?.trim().slice(0, 20) || '元素'} 副本`;
        clone.style.transform = `${clone.style.transform || ''} translate(24px, 24px)`.trim();
        target.after(clone);
      }
    }
    const serialized = hasDocument ? document.documentElement.outerHTML : document.body.innerHTML;
    html = /<!doctype/i.test(html) && hasDocument ? `<!DOCTYPE html>${serialized}` : serialized;
  } else if (command.operation === 'duplicate_element' || command.changes.text !== undefined) {
    const id = escapeRegExp(command.elementId);
    const elementPattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*(?:data-editor-id|data-element-id)=["']${id}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`, 'i');
    html = html.replace(elementPattern, (whole, open: string, tag: string, content: string, close: string) => {
      const updated = command.changes.text !== undefined ? `${open}${escapeHtml(String(command.changes.text))}${close}` : whole;
      if (command.operation !== 'duplicate_element') return updated;
      const copyId = `${command.elementId}-copy-${command.id.slice(0, 6)}`;
      const clone = updated
        .replace(new RegExp(`((?:data-editor-id|data-element-id)=["'])${id}(["'])`, 'i'), `$1${copyId}$2`)
        .replace(/data-editor-label=["']([^"']*)["']/i, (_, label) => `data-editor-label="${label} 副本"`);
      return `${updated}${clone}`;
    });
  }
  const c = command.changes;
  const usesCanvasPosition = (command.source === 'direct' || command.source === 'auto')
    && (c.left !== undefined || c.top !== undefined);
  const positionTargetId = usesCanvasPosition
    ? resolveCanvasPositionTargetId(html, command.elementId)
    : command.elementId;
  // Moving a word out of its sentence is never a valid layout repair. If the
  // inline word has no editable block parent, leave the HTML untouched.
  if (usesCanvasPosition && !positionTargetId) return html;

  const effectiveElementId = positionTargetId || command.elementId;
  const escapedId = cssEscape(effectiveElementId);
  const selector = `[data-editor-id="${escapedId}"],[data-element-id="${escapedId}"]`;
  const declarations: string[] = [];
  const previousTransform = readEditorTransform(html, selector);
  const transform = updateEditorTransform(previousTransform, c);
  const previousCanvasOffset = readEditorCanvasOffset(html, selector);
  const canvasOffset = updateEditorCanvasOffset(previousCanvasOffset, c);
  // A coordinate edit must not wipe an element's authored scale or rotation.
  // Only emit transform when the editor itself has a transform to preserve.
  if (transform) declarations.push(`transform: ${serializeEditorTransform(transform)} !important`);
  if (canvasOffset) declarations.push(`translate: ${serializeEditorCanvasOffset(canvasOffset)} !important`);
  for (const [key, css] of [['left','left'],['top','top'],['width','width'],['height','height'],['color','color'],['opacity','opacity'],['fontSize','font-size'],['fontFamily','font-family'],['fontWeight','font-weight'],['textAlign','text-align']] as const) {
    if (c[key] !== undefined) {
      const needsPixels = typeof c[key] === 'number' && ['left', 'top', 'width', 'height', 'fontSize'].includes(key);
      declarations.push(`${css}: ${needsPixels ? `${c[key]}px` : c[key]} !important`);
    }
  }
  // Keep an explicitly edited opacity available to later position edits.
  if (c.opacity !== undefined) declarations.push(`--editor-visible-opacity: ${c.opacity} !important`);
  // Generated layouts may anchor elements with `bottom`. Once the editor uses
  // `top`, retaining both constraints can pin or stretch the element instead
  // of moving it to the requested vertical position.
  if (c.top !== undefined) declarations.push('bottom: auto !important');
  // Direct position controls use the canvas (not the selected element's
  // positioned parent) as their reference. Fixed positioning is relative to
  // the 1280×720 iframe viewport, so a visual nested in an overflow-hidden
  // zone can be moved back into view instead of being clipped by that zone.
  if ((command.source === 'direct' || command.source === 'auto') && (c.left !== undefined || c.top !== undefined)) {
    declarations.push('position: fixed !important');
    declarations.push('right: auto !important');
    if (!canvasOffset) declarations.push('translate: none !important');
    // Coordinates belong to the canvas, but authored animation remains in
    // charge of transforms and opacity. Moving a balance beam (or any other
    // animated element) must not silently turn it into a static final frame.
  }
  if (typeof c.durationScale === 'number') declarations.push(`animation-duration: calc(var(--editor-base-duration, 1s) * ${c.durationScale}) !important`);
  if (command.operation === 'delete_element') declarations.push('display: none !important');
  if (command.operation === 'hide_element') declarations.push('visibility: hidden !important');
  if (command.operation === 'show_element') declarations.push('display: revert !important; visibility: visible !important');
  if (command.operation === 'lock_element') declarations.push('pointer-events: none !important');
  if (command.operation === 'unlock_element') declarations.push('pointer-events: auto !important');
  if (command.operation === 'bring_front') declarations.push('position: relative !important; z-index: 2147483000 !important');
  if (command.operation === 'send_back') declarations.push('position: relative !important; z-index: -1 !important');
  if (command.operation === 'duplicate_element') return html;
  // Generated frames may include an auto-fit guard that scales the whole visual
  // zone when any child moves beyond its original bounds. That is helpful during
  // generation, but makes a manual Y edit shrink unrelated elements. Once a
  // user directly edits a frame, preserve the 1280×720 coordinate system.
  // A transformed, filtered or contained zone becomes the containing block
  // for fixed descendants. Direct X/Y values are canvas coordinates, so
  // release only the zone holding the element; otherwise the hit target moves
  // but its pixels are offset into (and clipped by) the visual zone.
  const releaseContainingZone = (command.source === 'direct' || command.source === 'auto') && (c.left !== undefined || c.top !== undefined)
    ? `[data-role="text-zone"]:has(${selector}),[data-role="visual-zone"]:has(${selector}){contain:none !important;transform:none !important;filter:none !important;perspective:none !important;will-change:auto !important}`
    : '';
  const patch = `<style data-editor-patch="${command.id}">${selector}{${declarations.join(';')}}${releaseContainingZone}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${patch}</head>`) : `${patch}${html}`;
}

type EditorTransform = { scale: number; rotate: number };
type EditorCanvasOffset = { center: boolean; x: number; y: number };

/** Read the last editor-owned transform, so draft operations compose instead of overwrite. */
function readEditorTransform(html: string, selector: string): EditorTransform | null {
  const stylePattern = /<style\b[^>]*\bdata-editor-patch=["'][^"']+["'][^>]*>([\s\S]*?)<\/style>/gi;
  const normalizedSelector = selector.replace(/data-element-id/g, 'data-editor-id');
  const selectorPattern = normalizedSelector === selector
    ? escapeRegExp(selector)
    : `(?:${escapeRegExp(selector)}|${escapeRegExp(normalizedSelector)})`;
  const rulePattern = new RegExp(`${selectorPattern}\\{([^}]*)\\}`, 'g');
  let style: RegExpExecArray | null;
  let result: EditorTransform | null = null;
  while ((style = stylePattern.exec(html))) {
    rulePattern.lastIndex = 0;
    let rule: RegExpExecArray | null;
    while ((rule = rulePattern.exec(style[1]))) {
      const raw = rule[1].match(/(?:^|;)\s*transform\s*:\s*([^;!}]+)(?:\s*!important)?/i)?.[1]?.trim();
      if (!raw) continue;
      result = raw === 'none' ? null : parseEditorTransform(raw);
    }
  }
  return result;
}

function parseEditorTransform(value: string): EditorTransform {
  const scale = Number(value.match(/scale\(\s*(-?[\d.]+)\s*\)/i)?.[1] ?? 1);
  const rotate = Number(value.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/i)?.[1] ?? 0);
  return { scale, rotate };
}

function updateEditorTransform(previous: EditorTransform | null, changes: EditCommand['changes']): EditorTransform | null {
  const hasChange = typeof changes.scale === 'number' || typeof changes.rotate === 'number';
  if (!hasChange) return previous;
  const next = previous ?? { scale: 1, rotate: 0 };
  if (typeof changes.scale === 'number') next.scale = changes.scale;
  if (typeof changes.rotate === 'number') next.rotate = changes.rotate;
  return next;
}

function serializeEditorTransform(transform: EditorTransform): string {
  const parts: string[] = [];
  if (transform.scale !== 1) parts.push(`scale(${transform.scale})`);
  if (transform.rotate) parts.push(`rotate(${transform.rotate}deg)`);
  return parts.join(' ') || 'none';
}

function readEditorCanvasOffset(html: string, selector: string): EditorCanvasOffset | null {
  const stylePattern = /<style\b[^>]*\bdata-editor-patch=["'][^"']+["'][^>]*>([\s\S]*?)<\/style>/gi;
  const normalizedSelector = selector.replace(/data-element-id/g, 'data-editor-id');
  const selectorPattern = normalizedSelector === selector
    ? escapeRegExp(selector)
    : `(?:${escapeRegExp(selector)}|${escapeRegExp(normalizedSelector)})`;
  const rulePattern = new RegExp(`${selectorPattern}\\{([^}]*)\\}`, 'g');
  let style: RegExpExecArray | null;
  let result: EditorCanvasOffset | null = null;
  while ((style = stylePattern.exec(html))) {
    rulePattern.lastIndex = 0;
    let rule: RegExpExecArray | null;
    while ((rule = rulePattern.exec(style[1]))) {
      const raw = rule[1].match(/(?:^|;)\s*translate\s*:\s*([^;!}]+)(?:\s*!important)?/i)?.[1]?.trim();
      if (!raw || raw === 'none') continue;
      const values = raw.match(/-?[\d.]+px/g)?.map(value => Number.parseFloat(value)) || [];
      result = { center: /-50%/.test(raw), x: values[0] || 0, y: values[1] || 0 };
    }
  }
  return result;
}

function updateEditorCanvasOffset(previous: EditorCanvasOffset | null, changes: EditCommand['changes']): EditorCanvasOffset | null {
  const dx = (typeof changes.canvasDeltaX === 'number' ? changes.canvasDeltaX : 0)
    + (typeof changes.translateX === 'number' ? changes.translateX : 0);
  const dy = (typeof changes.canvasDeltaY === 'number' ? changes.canvasDeltaY : 0)
    + (typeof changes.translateY === 'number' ? changes.translateY : 0);
  const hasChange = changes.center === true || typeof changes.translateX === 'number' || typeof changes.translateY === 'number'
    || typeof changes.canvasDeltaX === 'number' || typeof changes.canvasDeltaY === 'number';
  if (!hasChange) return previous;
  if (changes.center === true) return { center: true, x: 0, y: 0 };
  return { center: previous?.center === true, x: (previous?.x || 0) + dx, y: (previous?.y || 0) + dy };
}

function serializeEditorCanvasOffset(offset: EditorCanvasOffset): string {
  if (!offset.center) return `${offset.x}px ${offset.y}px`;
  const centeredValue = (value: number) => value === 0
    ? '-50%'
    : `calc(-50% ${value > 0 ? '+' : '-'} ${Math.abs(value)}px)`;
  const x = centeredValue(offset.x);
  const y = centeredValue(offset.y);
  return `${x} ${y}`;
}

function summarizeCommand(label: string, operation: EditCommand['operation'], changes: EditCommand['changes']) {
  if (operation === 'delete_element') return `删除 ${label}`;
  if (operation === 'hide_element') return `隐藏 ${label}`;
  if (operation === 'show_element') return `显示 ${label}`;
  if (operation === 'lock_element') return `锁定 ${label}`;
  if (operation === 'unlock_element') return `解锁 ${label}`;
  if (operation === 'duplicate_element') return `复制 ${label}`;
  if (operation === 'bring_front') return `${label} 置顶`;
  if (operation === 'send_back') return `${label} 置底`;
  const bits = Object.entries(changes).map(([key, value]) => `${key} → ${value}`);
  return `${label}：${bits.join('，')}`;
}

function cssEscape(value: string) { return value.replace(/["\\]/g, '\\$&'); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function decodeHtmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

function getFriendlyLabel(raw: string, visibleText: string, tag: string, attrs: string, order: number): string | null {
  const label = decodeHtmlText(raw);
  const technical = /^(?:connector|medal-group|group|container|wrapper|visual(?:-content|-zone)?|text-zone|decoration|shape|line|path|node|item(?:-\d+)?)$/i;
  const understandable = (value: string) => /[\u3400-\u9fff]|[a-z]{2,}/i.test(value) && !technical.test(value);
  if (understandable(label)) return label.slice(0, 24);
  if (understandable(visibleText)) return visibleText.slice(0, 24);
  if (tag === 'img') return attrs.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1]?.slice(0, 24) || `图片 ${order}`;
  if (tag === 'svg') return attrs.match(/\baria-label\s*=\s*["']([^"']+)["']/i)?.[1]?.slice(0, 24) || `视觉图形 ${order}`;
  return null;
}

function directVisibleText(element: Element): string {
  return decodeHtmlText(Array.from(element.childNodes)
    .filter(node => node.nodeType === 3)
    .map(node => node.textContent || '')
    .join(' '));
}

function isExplicitlyHidden(element: HTMLElement): boolean {
  const style = element.getAttribute('style') || '';
  return element.hidden
    || element.getAttribute('aria-hidden') === 'true'
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style);
}

function isEditorInfrastructure(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (/^(?:script|style|link|meta|title|html|head|body|main)$/.test(tag)) return true;
  const role = element.getAttribute('data-role') || '';
  return /^(?:text-zone|visual-zone|visual-content)$/.test(role);
}

function isCssVisualElement(element: HTMLElement): boolean {
  if (element.tagName.toLowerCase() !== 'div') return false;
  const signature = `${element.id} ${element.className}`;
  return /(?:^|[\s_-])(?:plus|add|cross|connector|shape|icon|circle|line|timeline|time-line|divider|separator|rule|axis|baseline|stroke|border|bar|node|graphic|diagram|mark|person|silhouette|avatar|human|figure)(?:$|[\s_-])/i.test(signature);
}

function isLegacyCssVisualAttribute(attrs: string): boolean {
  return /\b(?:class|id)\s*=\s*["'][^"']*(?:plus|add|cross|connector|shape|icon|circle|line|timeline|time-line|divider|separator|rule|axis|baseline|stroke|border|bar|node|graphic|diagram|mark|person|silhouette|avatar|human|figure)[^"']*["']/i.test(attrs);
}

function legacyCssVisualLabel(attrs: string, index: number, person: boolean): string {
  if (/(?:timeline|time-line|axis|baseline)/i.test(attrs)) return '时间轴横线';
  if (/(?:line|divider|separator|rule|stroke|border|bar)/i.test(attrs)) return '分隔横线';
  if (/(?:plus|add|cross)/i.test(attrs)) return '加号图形';
  if (person) return `人员图形 ${index}`;
  return `视觉图形 ${index}`;
}

function isPersonComposite(element: HTMLElement): boolean {
  return /(?:^|[\s_-])person(?:$|[\s_-])/i.test(`${element.id} ${element.className}`);
}

function isLikelyCompositeContainer(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const role = element.dataset.role || '';
  if (/^(?:main|section|article|body)$/.test(tag) || /^(?:text-zone|visual-zone|visual-content)$/.test(role)) return false;
  const signature = `${element.id} ${element.className} ${element.dataset.editorLabel || ''}`;
  return /(?:^|[\s_-])(?:card|chat|device|diagram|flow|frame|graph|group|mockup|network|panel|phone|screen|system|timeline|window)(?:$|[\s_-])/i.test(signature)
    || /(?:聊天框|组合|流程图|关系图|时间线|设备|面板|窗口)/.test(signature);
}

function getCssVisualLabel(element: HTMLElement, order: number, role: string): string {
  const signature = `${element.id} ${element.className}`;
  if (isPersonComposite(element)) return `人员图形 ${order}`;
  if (/(?:^|[\s_-])(?:silhouette|avatar|human|figure)(?:$|[\s_-])/i.test(signature)) return `人形轮廓 ${order}`;
  if (/(?:^|[\s_-])(?:plus|add|cross)(?:$|[\s_-])/i.test(signature)) return '加号图形';
  if (/(?:^|[\s_-])(?:timeline|time-line|axis|baseline)(?:$|[\s_-])/i.test(signature)) return '时间轴横线';
  if (/(?:^|[\s_-])(?:line|divider|separator|rule|stroke|border|bar)(?:$|[\s_-])/i.test(signature)) return '分隔横线';
  if (/(?:^|[\s_-])connector(?:$|[\s_-])/i.test(signature)) return `连接图形 ${order}`;
  if (role === 'decoration') return `装饰图形 ${order}`;
  return `视觉图形 ${order}`;
}

function attributesToText(element: Element): string {
  return Array.from(element.attributes).map(attribute => `${attribute.name}="${attribute.value}"`).join(' ');
}
