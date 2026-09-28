import type { FrameOutline, FrameSource, ProjectType, RenderMode } from '@/types';

export type ResolvedSceneContract =
  | { mode: 'html'; requiresHtml: true; allowsEmbeddedAssets: true }
  | { mode: 'image'; requiresImage: true; allowsEmbeddedAssets: false }
  | { mode: 'ui-scene'; requiresUiDocument: true; allowsEmbeddedAssets: false };

/**
 * Single source of truth for the final renderer used by generation, preview,
 * completion checks and the local Render Worker.
 */
export function resolveSceneContract(
  projectType: ProjectType,
  frame?: Pick<FrameOutline, 'sceneSpec'> | null,
): ResolvedSceneContract {
  const requested: RenderMode = projectType === 'image'
    ? 'image'
    : frame?.sceneSpec?.renderMode || 'html';

  if (requested === 'image') {
    return { mode: 'image', requiresImage: true, allowsEmbeddedAssets: false };
  }
  if (requested === 'ui-scene') {
    return { mode: 'ui-scene', requiresUiDocument: true, allowsEmbeddedAssets: false };
  }
  return { mode: 'html', requiresHtml: true, allowsEmbeddedAssets: true };
}

export function resolveFrameImagePath(source?: Pick<FrameSource, 'imagePath' | 'realImage'> | null): string | undefined {
  return source?.imagePath || source?.realImage?.localPath;
}

export function isUiSceneDocumentReady(frame?: Pick<FrameOutline, 'sceneSpec'> | null): boolean {
  const spec = frame?.sceneSpec;
  return Boolean(spec?.renderMode === 'ui-scene' && spec.uiSchemaVersion === 1 && spec.uiArchetype);
}

export function isFrameVisualComplete(
  source: FrameSource | null | undefined,
  projectType: ProjectType,
  frame?: Pick<FrameOutline, 'sceneSpec'> | null,
): boolean {
  const contract = resolveSceneContract(projectType, frame);
  if (contract.mode === 'image') return Boolean(resolveFrameImagePath(source));
  if (contract.mode === 'ui-scene') return isUiSceneDocumentReady(frame);
  return Boolean(source?.htmlCode);
}

export function isFrameComplete(
  source: FrameSource | null | undefined,
  projectType: ProjectType,
  frame?: Pick<FrameOutline, 'sceneSpec'> | null,
  options?: { requiresAudio?: boolean },
): boolean {
  const requiresAudio = options?.requiresAudio !== false;
  return isFrameVisualComplete(source, projectType, frame)
    && (!requiresAudio || Boolean(source?.audioPath));
}
