/**
 * 共享类型定义：项目、视频大纲、分镜、消息等
 */

import type { ContentStyleTrace, ProjectContentStyleConfig } from '@/lib/content-style/types';

export type ProjectType = 'image' | 'html';
export type CanvasPresetId = 'landscape-16-9' | 'douyin-portrait-9-16';

export type SceneRelationship =
  | 'hook'
  | 'compare'
  | 'process'
  | 'hierarchy'
  | 'metric'
  | 'timeline'
  | 'quote'
  | 'cause'
  | 'spatial'
  | 'summary';

export type RevealStrategy = 'single' | 'sequence' | 'progressive' | 'contrast';
export type CompositionGrammar = 'establish' | 'expand' | 'conflict' | 'turn' | 'resolve';
export type AssetStrategy = 'real-image' | 'icon' | 'chart' | 'typography' | 'css-svg';
export type VisualRole = 'context' | 'human-proof' | 'physical-proof' | 'explain' | 'emphasis' | 'transition';
export type RealImagePriority = 'required' | 'preferred' | 'optional' | 'never';
export type SmartImageMode = 'fast' | 'balanced' | 'asset-priority';
export type SmartImageFrameStatus =
  | 'not-planned'
  | 'planned'
  | 'searching'
  | 'candidate-ready'
  | 'downloading'
  | 'accepted'
  | 'needs-review'
  | 'rendering-with-image'
  | 'rendering-native'
  | 'completed'
  | 'timed-out'
  | 'rejected'
  | 'unavailable';

export type RenderMode = 'html' | 'image' | 'ui-scene';
export type ProjectWorkflow = 'gpt-free';

export type BriefStatus = 'empty' | 'collecting' | 'needs_clarification' | 'ready' | 'confirmed';
export type ProjectAssetKind = 'image' | 'document';
export type ProjectAssetStatus = 'uploaded' | 'processing' | 'ready' | 'failed' | 'deleted';
export type ProjectAssetUsage = 'content' | 'visual' | 'brand' | 'reference';

export interface BriefQuestion {
  id: string;
  question: string;
  choices: Array<{ id: string; label: string; effect: string }>;
}

export interface ProjectBrief {
  version: 'project-brief-v1';
  goal: string;
  targetAudience: string;
  platform: 'douyin' | 'video-account' | 'bilibili' | 'youtube' | 'general';
  durationSeconds: number;
  tone: string;
  coreMessage: string;
  desiredOutcome: string;
  callToAction?: string;
  mustUseAssetIds: string[];
  optionalAssetIds: string[];
  excludedAssetIds: string[];
  assumptions: Array<{ field: string; value: string; reason: string }>;
  unresolvedQuestions: BriefQuestion[];
  clarificationCount: number;
  confirmedAt?: string;
}

export interface AssetSummary {
  id: string;
  kind: ProjectAssetKind;
  mimeType: string;
  originalName: string;
  byteLength: number;
  status: ProjectAssetStatus;
  inferredUsage?: ProjectAssetUsage;
  usage?: 'must' | 'optional' | 'reference' | 'excluded';
  summary?: {
    title?: string;
    digest?: string;
    keywords?: string[];
    characterCount?: number;
    chunkCount?: number;
    width?: number;
    height?: number;
  };
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionRequest {
  projectId: string;
  clientRequestId: string;
  content: string;
  attachmentIds: string[];
  context: {
    scopeHint?: 'auto' | 'project' | 'frame' | 'element';
    selectedFrameId?: string;
    selectedElementIds?: string[];
    playbackTimeMs?: number;
    playbackRevision?: number;
  };
  sourceMessageId?: string;
  rewriteDraft?: unknown;
}

export interface PlaybackContext {
  frameId: string | null;
  currentTimeMs: number;
  durationMs: number;
  playbackRevision: number;
}

export interface ChatContextSnapshot {
  version: 'chat-context-v1';
  projectId: string;
  projectUpdatedAt: string;
  projectStateHash: string;
  resolvedScope: 'project' | 'frame' | 'element';
  selectedFrameId?: string;
  selectedElementIds?: string[];
  playbackTimeMs?: number;
  frameSummary?: {
    title: string;
    narration: string;
    durationSeconds: number;
    renderMode: string;
  };
  elementSummary?: Array<{ id: string; label: string; type: string }>;
  evidence?: Array<{ frameId: string; progress: number; imageHash: string; capturedAt: string }>;
}

export interface DirectorDiagnosis {
  version: 'director-diagnosis-v1';
  scope: { type: 'project' | 'frame' | 'element'; frameIds: string[] };
  summary: string;
  issues: Array<{
    id: string;
    category: 'content' | 'rhythm' | 'visual' | 'readability' | 'asset' | 'audio';
    severity: 'minor' | 'important' | 'blocking';
    userFacingExplanation: string;
    evidenceFrameIds: string[];
    technicalEvidence?: Record<string, unknown>;
  }>;
  options: Array<{
    id: string;
    label: string;
    description: string;
    intensity: 'light' | 'recommended' | 'redesign';
    expectedImpact: string;
  }>;
  recommendedOptionId: string;
  baseStateHash: string;
}

export type ChangeSetOperation =
  | { type: 'update_frame_text'; frameId: string; title?: string; narration?: string }
  | { type: 'add_frame'; afterFrameId?: string; draft: FrameOutline }
  | { type: 'delete_frame'; frameId: string }
  | { type: 'split_frame'; frameId: string; frames: FrameOutline[] }
  | { type: 'merge_frames'; frameIds: string[]; frame: FrameOutline }
  | { type: 'regenerate_visual'; frameId: string; reason: string }
  | { type: 'regenerate_audio'; frameId: string; reason: string }
  | { type: 'replace_asset'; frameId: string; assetId: string }
  | { type: 'tune_element'; frameId: string; command: EditCommand }
  | { type: 'update_project_style'; styleId: string };

export interface ChangeImpact {
  affectedFrameIds: string[];
  outlineChanged: boolean;
  visualRegenerationCount: number;
  audioRegenerationCount: number;
  assetReplacementCount: number;
  preservedFrameCount: number;
  estimatedStageCount: number;
  warnings: string[];
}

export interface ChangeSetSummary {
  id: string;
  status: 'proposed' | 'applying' | 'applied' | 'reverted' | 'stale' | 'failed';
  baseStateHash: string;
  resultStateHash?: string;
  scope: { type: 'project' | 'frame' | 'element'; frameIds: string[] };
  operations: ChangeSetOperation[];
  impact: ChangeImpact;
  summary: { title: string; description: string };
  checkpointId?: string;
  sourceMessageId?: string;
}

export type AssetVerificationLevel = 'file-valid' | 'metadata-matched' | 'vision-confirmed' | 'human-confirmed';

export interface AssetRequirement {
  attempt: 'never' | 'optional' | 'required';
  failurePolicy: 'allow-native' | 'needs-review' | 'block';
}

export interface AssetVisionReview {
  decision: 'pass' | 'uncertain' | 'reject';
  subjectMatched: boolean;
  requiredObjectsPresent: string[];
  missingObjects: string[];
  excludedObjectsPresent: string[];
  compositionUsable: boolean;
  confidence: number;
  reason: string;
}
export type UIArchetype = 'overview' | 'master-detail' | 'workflow' | 'ai-approval';
export type VisualType = 'diagram' | 'photo' | 'ui' | 'typography' | 'chart';

export interface UIInteractionStep {
  atMs: number;
  action:
    | 'highlight-anomaly'
    | 'open-detail'
    | 'filter'
    | 'expand-reason'
    | 'generate-suggestion'
    | 'confirm-execution';
  target: string;
  payload?: Record<string, unknown>;
}

export interface SceneSpec {
  relationship: SceneRelationship;
  focus: string;
  revealStrategy: RevealStrategy;
  focalElement: string;
  composition: CompositionGrammar;
  actionSemantics: string;
  assetStrategy: AssetStrategy;
  informationPool: string[];
  visualIntent: string;
  screenText: string[];
  assetHints: string[];
  durationHint: number;
  prohibitedPatterns: string[];
  visualRole?: VisualRole;
  realImagePriority?: RealImagePriority;
  imagePurpose?: string;
  /** Director-authored contract for deterministic stock-photo retrieval. */
  assetRequest?: AssetRequest;
  /** GPT-only structured action; the program executes it and keeps network access internal. */
  searchAction?: InternalImageSearchAction;
  /** One entry per co-equal concrete subject that must appear in the frame. */
  assetSubjects?: ImageSubjectPlan[];
  /** Normalized attempt/failure semantics; absent on legacy outlines. */
  assetRequirement?: AssetRequirement;
  /** Missing means the legacy project-level html/image mode. */
  renderMode?: RenderMode;
  /** ui-scene is data-only and is rendered by the built-in component library. */
  uiArchetype?: UIArchetype;
  uiData?: Record<string, unknown>;
  interactionSequence?: UIInteractionStep[];
  uiSchemaVersion?: 1;
  compositionTag?: string;
  visualType?: VisualType;
  isDemoData?: boolean;
}

export interface AssetRequest {
  query: string;
  fallbackQueries: string[];
  requiredTerms: string[];
  optionalTerms: string[];
  excludedTerms: string[];
  subjectType: 'person' | 'equipment' | 'place' | 'environment';
  purpose: string;
  imageRequired: boolean;
}

export interface InternalImageSearchAction {
  tool: 'search_visual_assets';
  purpose: string;
  query: string;
  requiredTerms: string[];
  avoidTerms: string[];
  orientation?: 'landscape' | 'portrait' | 'square';
  subjectType?: AssetRequest['subjectType'];
  sourcePriority?: string[];
  required: boolean;
  maxResults: number;
}

export interface DirectorPlan {
  coreMessage: string;
  audience: string;
  tone: string;
  pacing: string;
  visualGrammar: string;
  layoutFamilies?: string[];
  imagePlan?: string;
  uiScenePlan?: string;
  keyScenes?: string[];
  quietScenes?: string[];
  transitionRhythm?: string;
  styleRecommendation?: string;
}

export interface InformationItem {
  type: 'data' | 'case' | 'quote' | 'entity' | 'fact';
  content: string;
  source?: string;
}

export interface ScriptBeat {
  id: string;
  chapterId: string;
  order: number;
  narration: string;
  purpose: string;
  frameId?: string;
}

export interface ScriptChapter {
  id: string;
  title: string;
  purpose: string;
  beatIds: string[];
}

export interface ContentAudit {
  retentionRate: number;
  hasHook: boolean;
  hasClearValuePromise?: boolean;
  hasActionableCta?: boolean;
  repeatedBeatCount?: number;
  averageSentenceLength: number;
  aiPhrases: string[];
  issues: string[];
  repaired: boolean;
}

/** Short-video editorial intent, preserved with the generated outline. */
export interface CreativeBrief {
  targetAudience: string;
  viewerPainPoint: string;
  valuePromise: string;
  coreMessage: string;
  hook: {
    type: 'pain_point' | 'counterintuitive' | 'result' | 'suspense' | 'question';
    text: string;
  };
  proofPlan: string;
  cta: string;
}

export interface VisualAnchor {
  themeId: string;
  colors: string[];
  fontFamilies: string[];
  titleTreatment: string;
  numberTreatment: string;
  labelTreatment: string;
  whitespaceRatio: number;
  motionTempo: 'restrained' | 'balanced' | 'energetic';
  prohibitedPatterns: string[];
  approvedFrameIds: string[];
}

/** A project-wide, immutable visual system shared by every generated scene. */
export interface VisualContract {
  version: 'visual-contract-v1';
  themeId: string;
  tokens: ThemeTokens;
  allowedLayouts: Array<'split' | 'stack'>;
  visualLanguage: string;
  componentFamilies: Array<'focal' | 'comparison' | 'process' | 'hierarchy' | 'data' | 'conclusion'>;
  prohibitedPatterns: string[];
  maxSemanticObjects: number;
}

/** Artistic continuity for GPT-free scenes. It deliberately contains no layout or DOM schema. */
export interface GPTVisualBible {
  version: 'gpt-visual-bible-v1';
  themeId: string;
  tokens: ThemeTokens;
  visualLanguage: string;
  motifs: string[];
  rhythm: string;
  prohibitedProblems: string[];
}

export interface CollaborationState {
  mode: 'guided';
  planApproved: boolean;
  planApprovedAt?: string;
  approvedFrameIds: string[];
}

export interface ResearchSource {
  title: string;
  url: string;
  content: string;
  score?: number;
  qualityScore?: number;
  authority?: 'official' | 'research' | 'media' | 'general';
}

export type ResearchRiskLevel = 'low' | 'medium' | 'high';

export interface ResearchEvidenceCard {
  id: string;
  question: string;
  finding: string;
  sourceIds: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface ResearchSnapshot {
  provider: 'tavily';
  queriedAt: string;
  queries: string[];
  summary: string;
  sources: ResearchSource[];
  riskLevel?: ResearchRiskLevel;
  reason?: string;
  status?: 'completed' | 'partial' | 'failed';
  evidenceCards?: ResearchEvidenceCard[];
  failedQueries?: string[];
}

export type IntentAction =
  | 'generate_outline'
  | 'regenerate_outline'
  | 'add_frame'
  | 'delete_frame'
  | 'split_frame'
  | 'merge_frames'
  | 'regenerate_frame'
  | 'tune_frame'
  | 'generate_frames'
  | 'regenerate_audio'
  | 'change_style'
  | 'export_video'
  | 'set_tts_provider'
  | 'unknown';

export interface IntentResult {
  action: IntentAction;
  reason: string;
  params: Record<string, unknown>;
}

export interface FrameOutline {
  id: string;
  index: number;
  title: string;
  narration: string;
  imagePrompt?: string;   // image 模式
  htmlPrompt?: string;    // html 模式
  sceneSpec?: SceneSpec;  // html 模式：自动编导层的结构化场景意图
  [key: string]: unknown;
}

export interface Outline {
  title: string;
  totalDuration: number;   // 估算总时长（秒）
  sourceMaterial?: string;
  script?: string;
  chapters?: ScriptChapter[];
  beats?: ScriptBeat[];
  informationPool?: InformationItem[];
  creativeBrief?: CreativeBrief;
  /** Creative direction retained only for the GPT-free workflow. */
  freeCreativeBrief?: {
    visualMotif: string;
    mediaStrategy: string;
    chapterStrategy: string;
    rhythm: string;
  };
  /** A minimal semantic guardrail for GPT-free direction and scene generation. */
  freeContentAnchor?: {
    topic: string;
    coreMessage: string;
  };
  /** GPT-free first-frame cue for identity carryover, not a layout contract. */
  freeFirstChapterAnchor?: {
    frameId: string;
    summary: string;
  };
  contentAudit?: ContentAudit;
  globalStyle?: string;    // image 模式：全局画风提示词
  directorPlan?: DirectorPlan; // html 模式：整片编导约束
  visualAnchor?: VisualAnchor;
  visualContract?: VisualContract;
  gptVisualBible?: GPTVisualBible;
  collaboration?: CollaborationState;
  research?: ResearchSnapshot; // 联网研究快照与可追溯来源
  contentStyleTrace?: ContentStyleTrace;
  frames: FrameOutline[];
  [key: string]: unknown;
}

export interface FrameSource {
  id: string;              // 对应 outline.frames[i].id
  imagePath?: string;      // /api/data/images/<projectId>/<frameId>.png
  audioPath?: string;      // /api/data/audio/<projectId>/<frameId>.mp3
  audioDuration?: number;  // 秒
  htmlCode?: string;       // html 模式
  realImage?: RealImageAsset;
  realImages?: RealImageAsset[];
  imageSelection?: SmartImageSelection;
  qualityReport?: FrameQualityReport | null;
  imageAsset?: ImageAssetProvenance;
  visualFallbacks?: VisualFallbackRecord[];
  [key: string]: unknown;
}

export interface SmartImageCandidate {
  photoId: number;
  query: string;
  /** Zero-based image slot inside the frame. */
  slotIndex?: number;
  subject?: string;
  alt: string;
  width: number;
  height: number;
  previewUrl?: string;
  /** Candidates are localized before being exposed as one-click alternatives. */
  localPath?: string;
  localFileHash?: string;
  pexelsUrl: string;
  photographer: string;
  photographerUrl: string;
  avgColor?: string;
  score: number;
  layout: RealImageAsset['layout'];
  fitMode: RealImageAsset['fitMode'];
  matchedTerms: string[];
  missingTerms?: string[];
  rejectedTerms: string[];
  status?: 'accepted' | 'rejected' | 'download-failed';
  rejectionCode?: string;
  reason: string;
  verificationLevel?: AssetVerificationLevel;
  visionReview?: AssetVisionReview;
}

export type VisionImageReviewStatus = 'accepted' | 'fallback' | 'unavailable';
export type VisionSubjectMatch = 'high' | 'medium' | 'low';
export type VisionSafeTextSide = 'left' | 'right' | 'top' | 'bottom' | 'none';
export type VisionSubjectPosition = 'left' | 'center' | 'right' | 'mixed';
export type VisionCropRisk = 'low' | 'medium' | 'high';

/**
 * Ephemeral visual review metadata persisted with a SmartImageSelection.
 * It deliberately contains photo IDs and bounded explanations only; image
 * bytes, remote URLs and model chain-of-thought never belong in project JSON.
 */
export interface VisionImageReview {
  status: VisionImageReviewStatus;
  selectedPhotoId?: number;
  backupPhotoIds: number[];
  subjectMatch: VisionSubjectMatch;
  safeTextSide?: VisionSafeTextSide;
  subjectPosition?: VisionSubjectPosition;
  cropRisk: VisionCropRisk;
  rationale: string;
  rejections: Array<{ photoId: number; reason: string }>;
  model?: string;
  elapsedMs?: number;
}

export interface SmartImageSelection {
  request: AssetRequest;
  candidates: SmartImageCandidate[];
  rejectedCandidates?: SmartImageCandidate[];
  attemptedQueries?: string[];
  selectedPhotoId?: number;
  selectedPhotoIds?: number[];
  status: SmartImageFrameStatus;
  reason: string;
  updatedAt: string;
  verificationLevel?: AssetVerificationLevel;
  requiresHumanReview?: boolean;
  visionReview?: VisionImageReview;
}

export interface ImageAssetProvenance {
  provider: 'pexels' | 'uploaded';
  localPath: string;
  localFileHash: string;
  sourceUrl?: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  query?: string;
  imagePurpose: string;
  verificationLevel?: AssetVerificationLevel;
  visionReview?: AssetVisionReview;
  crop?: { x: number; y: number; width: number; height: number };
  motion?: {
    kind: 'slow-push-in' | 'slow-pan' | 'static';
    scaleFrom?: number;
    scaleTo?: number;
    direction?: 'left' | 'right' | 'up' | 'down';
  };
}

export interface VisualFallbackRecord {
  from: 'pexels';
  to: 'html';
  reason: string;
  createdAt: string;
}

export interface RealImageAsset {
  provider: 'pexels';
  photoId: number;
  localPath: string;
  localFileHash?: string;
  query: string;
  alt: string;
  width: number;
  height: number;
  avgColor?: string;
  photographer: string;
  photographerUrl: string;
  pexelsUrl: string;
  fitMode: 'cover' | 'contain';
  position: 'center';
  layout: 'full-bleed' | 'editorial-split' | 'framed-focus';
  scaleFrom: number;
  scaleTo: number;
  downloadedAt: string;
  purpose?: string;
  imageMotion?: string;
  visualGroup?: string;
  acceptedAt?: string;
  license?: string;
  verificationLevel?: AssetVerificationLevel;
  visionReview?: AssetVisionReview;
  fallbackReason?: string;
  crop?: { fitMode: 'cover' | 'contain'; position: 'center' };
  motion?: {
    kind: 'slow-push-in' | 'slow-pan' | 'static';
    scaleFrom: number;
    scaleTo: number;
  };
}

export interface PersonImagePlan {
  name: string;
  query: string;
  fallbackQuery: string;
}

export interface ImageSubjectPlan {
  name: string;
  kind: 'person' | 'product' | 'architecture' | 'natural-object' | 'place' | 'historical-scene' | 'artwork-document' | 'context';
  query: string;
  fallbackQuery: string;
  required: boolean;
}

export interface SmartImagePlan {
  frameId: string;
  useRealImage: boolean;
  priority: number;
  reason: string;
  purpose: string;
  query: string;
  fallbackQueries: string[];
  /** Kept while older saved plans and callers are still in circulation. */
  fallbackQuery?: string;
  subject: string;
  composition: RealImageAsset['layout'];
  textPosition: 'left' | 'right';
  imageMotion: 'slow-push-in' | 'slow-pan' | 'static';
  visualGroup: string;
  deadlineMs: number;
  people?: PersonImagePlan[];
  subjects?: ImageSubjectPlan[];
  assetClass?: string;
  fidelity?: 'required' | 'preferred';
  fallbackPolicy?: 'block' | 'allow-native';
  assetRequest?: AssetRequest;
  requirement?: AssetRequirement;
  minimumVerification?: AssetVerificationLevel;
}

export interface VideoSource {
  frames: FrameSource[];
  gptQualityReport?: GPTVideoQualityReport;
  repairHistory?: FrameRepairHistoryEntry[];
  repairJobs?: Record<string, FrameRepairJob>;
  [key: string]: unknown;
}

export type GPTVideoQualityCategory = 'technical' | 'semantic' | 'visualRichness' | 'rhythm' | 'assets';

export interface GPTVideoQualityIssue {
  code: string;
  category: GPTVideoQualityCategory;
  severity: 'critical' | 'major' | 'minor';
  frameIds: string[];
  message: string;
}

export interface GPTVideoQualityReport {
  generatedAt: string;
  modelScope: 'gpt-only';
  scores: {
    /** Null until every current frame version has a persisted layout audit. */
    technical: number | null;
    semantic: number;
    visualRichness: number;
    rhythm: number;
    /** Null when the workflow intentionally does not use external assets. */
    assets: number | null;
    creative: number;
    overall: number | null;
  };
  stats: {
    frameCount: number;
    auditedFrameCount: number;
    auditStatus: 'pending' | 'complete';
    layoutFamilyCount: number;
    realImageCount: number;
  };
  issues: GPTVideoQualityIssue[];
}

export interface FrameRepairJob {
  frameId: string;
  status: 'running' | 'cancelled' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export type FrameQualityRepairStatus = 'accepted' | 'unchanged' | 'unavailable' | 'cancelled' | 'failed';

export interface FrameRepairHistoryEntry {
  id: string;
  frameId: string;
  beforeHtml: string;
  afterHtml: string;
  summary: string;
  source: 'auto-repair' | 'restore';
  qualityReport?: FrameQualityReport;
  restoreOfId?: string;
  createdAt: string;
}

export interface ProjectSummary {
  uuid: string;
  title: string;
  type: ProjectType;
  canvasPreset: CanvasPresetId;
  createdAt: string;
  updatedAt: string;
  hasOutline: boolean;
  workflow?: ProjectWorkflow;
}

export interface ProjectDetail extends ProjectSummary {
  styleId: string | null;
  contentStyle?: ProjectContentStyleConfig | null;
  gptOptimization?: import('@/lib/gpt-optimization-settings').ProjectGPTOptimizationConfig | null;
  outline: Outline | null;
  videoSource: VideoSource | null;
  projectBrief?: ProjectBrief | null;
  briefStatus?: BriefStatus;
}

export type MessageRole = 'user' | 'assistant';

export type MessageActionId =
  | 'view_outline'
  | 'approve_plan'
  | 'approve_frame'
  | 'generate_sample'
  | 'confirm_visual_anchor'
  | 'generate_all'
  | 'regenerate_audio'
  | 'open_style_picker'
  | 'open_tts_provider'
  | 'export_video'
  | 'brief_confirm'
  | 'brief_edit'
  | 'brief_ai_decide'
  | 'brief_clarify'
  | 'diagnosis_recommend'
  | 'diagnosis_light'
  | 'diagnosis_redesign'
  | 'diagnosis_skip'
  | 'change_set_apply'
  | 'change_set_revert'
  | 'agent_run_cancel'
  | 'agent_run_retry'
  | 'agent_run_resume';

export interface MessageAction {
  id: MessageActionId;
  label: string;
  frameId?: string;
  forceVisual?: boolean;
  disabled?: boolean;
  completed?: boolean;
  variant?: 'default' | 'outline' | 'secondary';
  value?: string;
  runId?: string;
  changeSetId?: string;
  checkpointId?: string;
  sourceMessageId?: string;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata | null;
  createdAt: string;
}

export type FrameReviewOperation = 'add' | 'modify' | 'delete';

export interface FrameReviewDraft {
  operation: FrameReviewOperation;
  targetFrameId?: string;
  insertAfterIndex?: number;
  /** Render this replacement as a new shot, without inheriting visual anchors. */
  freshStart?: boolean;
  title: string;
  narration: string;
  visualPrompt?: string;
  imagePrompt?: string;
  htmlPrompt?: string;
  sceneSpec?: SceneSpec;
  baseUpdatedAt: string;
}

export type FrameStructureOperation = 'split' | 'merge';

export interface FrameStructureItemDraft {
  title: string;
  narration: string;
  visualPrompt?: string;
  imagePrompt?: string;
  htmlPrompt?: string;
  sceneSpec?: SceneSpec;
}

export interface FrameStructureDraft {
  operation: FrameStructureOperation;
  targetFrameIds: string[];
  frames: FrameStructureItemDraft[];
  baseUpdatedAt: string;
}

export type FrameTuneElementKind = 'visual' | 'text' | 'decoration' | 'motion';
export type FrameTunePreviewAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface FrameTuneElement {
  label: string;
  kind: FrameTuneElementKind;
  selector?: string;
  previewAnchor?: FrameTunePreviewAnchor;
  current: Record<string, string>;
  proposed: Record<string, string>;
  reason: string;
}

export interface FrameTuneDraft {
  targetFrameId: string;
  summary: string;
  elements: FrameTuneElement[];
  baseUpdatedAt: string;
}

export type EditScope = 'element' | 'frame' | 'matching' | 'video';
export type EditOperation = 'update_element' | 'delete_element' | 'hide_element' | 'lock_element'
  | 'show_element' | 'unlock_element' | 'duplicate_element' | 'bring_front' | 'send_back';

export interface EditableElement {
  id: string;
  geometryId?: string;
  groupRootId?: string;
  label: string;
  tag: string;
  type: 'text' | 'visual' | 'decoration';
  editable: string[];
  values?: {
    x?: number; y?: number; width?: number; height?: number;
    right?: number; bottom?: number; boundaryAnchor?: 'left' | 'right'; outOfBounds?: boolean;
    visualWidth?: number; visualHeight?: number;
    scale?: number; rotate?: number; opacity?: number;
    text?: string; color?: string; fontSize?: number;
    fontFamily?: string; fontWeight?: string; textAlign?: string;
    hidden?: boolean; locked?: boolean;
  };
}

export interface LayoutIssue {
  code: 'clipped' | 'out_of_bounds' | 'platform_safe_area' | 'subtitle_safe_area' | 'text_occluded'
    | 'semantic_overlap' | 'font_too_small' | 'focal_too_small' | 'edge_spacing' | 'low_contrast'
    | 'excessive_micro_labels' | 'invisible' | 'audit_timeout';
  label: string;
  detail: string;
  severity?: 'critical' | 'major' | 'minor';
  elementId?: string;
  relatedElementId?: string;
  suggestedFix?: {
    elementId: string;
    changes: Record<string, string | number | boolean>;
  };
}

export interface FrameLayoutAudit {
  frameId: string;
  issues: LayoutIssue[];
  auditedAt: number;
}

export interface FrameQualityRunState {
  frameId: string;
  status: 'auditing' | 'sampling' | 'optimizing' | 'visual_repairing' | 'terminal_verifying' | 'sampling_recheck' | 'saving' | 'cancelling' | 'passed' | 'saved' | 'needs_review' | 'unchanged' | 'unavailable' | 'cancelled' | 'failed';
  message: string;
  score?: number;
  updatedAt: number;
}

export interface FrameQualityReport {
  frameId: string;
  status: 'passed' | 'needs_review';
  scoreBefore: number;
  scoreAfter: number;
  iterations: number;
  issues: LayoutIssue[];
  appliedFixes: Array<{
    elementId: string;
    changes: Record<string, string | number | boolean>;
    beforeScore: number;
    afterScore: number;
  }>;
  auditedAt: number;
  auditVersion: string;
  htmlHash: string;
}

export interface EditCommand {
  id: string;
  operation: EditOperation;
  frameId: string;
  elementId: string;
  scope: EditScope;
  changes: Record<string, string | number | boolean>;
  preserve: string[];
  source: 'direct' | 'rule' | 'ai' | 'auto';
  summary: string;
}

export interface EditHistoryEntry {
  id: string;
  command: EditCommand;
  beforeHtml: string;
  afterHtml: string;
  createdAt: string;
}

export type MessageMetadata =
  | { kind: 'text'; actions?: MessageAction[] }
  | { kind: 'pending'; stage?: 'intent' | 'outline' | 'add_frame' | 'delete_frame' | 'split_frame' | 'merge_frames' | 'regenerate_frame' | 'tune_frame' | 'generate_frames' }
  | { kind: 'outline'; outline: Outline; actions?: MessageAction[] }
  | { kind: 'frame_review'; draft: FrameReviewDraft; actions?: MessageAction[] }
  | { kind: 'frame_structure_review'; draft: FrameStructureDraft; actions?: MessageAction[] }
  | { kind: 'frame_tune_review'; draft: FrameTuneDraft; actions?: MessageAction[] }
  | { kind: 'frame_progress'; current: number; total: number; frameId?: string }
  | { kind: 'asset_summary'; assets: AssetSummary[] }
  | { kind: 'clarification'; question: BriefQuestion; actions: MessageAction[] }
  | { kind: 'brief_review'; brief: ProjectBrief; actions: MessageAction[] }
  | { kind: 'director_diagnosis'; diagnosis: DirectorDiagnosis; actions: MessageAction[] }
  | { kind: 'change_set'; changeSet: ChangeSetSummary; actions: MessageAction[] }
  | { kind: 'agent_run'; runId: string; status: import('@/lib/agents/types').AgentRunStatus; actions?: MessageAction[] }
  | { kind: 'checkpoint'; checkpointId: string; canRevert: boolean; actions: MessageAction[] }
  | { kind: 'error'; message: string; actions?: MessageAction[] };

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  prompt: string;          // 拼接到 HTML 动画 prompt 的风格描述
  demoHtml: string;        // 风格演示 HTML
  tokens?: ThemeTokens;
  bestFor?: string[];
  mood?: string[];
  prohibitedPatterns?: string[];
}

export interface ThemeTokens {
  colors: {
    background: string;
    surface: string;
    foreground: string;
    muted: string;
    accent: string;
    accentSecondary: string;
  };
  typography: {
    display: string;
    body: string;
    mono: string;
    titleSize: string;
    bodySize: string;
  };
  spacing: { safeArea: string; gap: string };
  shape: { radius: string; borderWidth: string };
  motion: { duration: string; easing: string; stagger: string };
  signature: string;
}
