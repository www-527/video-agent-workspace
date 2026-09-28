import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EditableElement, EditHistoryEntry, FrameLayoutAudit, FrameQualityRunState, LayoutIssue, PlaybackContext } from '@/types';
import { layoutIssueKey } from '@/lib/layout-issues';
import { abortQualityRepair } from '@/lib/quality/repair-cancellation';

interface StudioState {
  selectedFrameId: string | null;
  showSubtitle: boolean;
  subtitleHorizontal: number;
  subtitleVertical: number;
  isPlaying: boolean;
  playbackContext: PlaybackContext;
  generatingFrames: Record<string, string>;
  tunePreview: { frameId: string; htmlCode: string } | null;
  selectedElement: EditableElement | null;
  selectedElementIds: string[];
  elementPanelFocus: { frameId: string; elementId: string; revision: number } | null;
  editorDirty: boolean;
  editorMeasurementRevision: number;
  editHistoryByFrame: Record<string, { entries: EditHistoryEntry[]; index: number }>;
  layoutAudits: Record<string, FrameLayoutAudit>;
  qualityRuns: Record<string, FrameQualityRunState>;
  qualityRepairRequests: Record<string, number>;
  qualityRepairJobs: Record<string, string>;
  qualityRepairStops: Record<string, boolean>;
  forceExportRequest: number;
  ignoredLayoutIssueKeys: Record<string, string[]>;
  permanentlyIgnoredLayoutIssueKeys: Record<string, string[]>;
  setSelectedFrameId: (id: string | null) => void;
  setShowSubtitle: (v: boolean) => void;
  setSubtitleHorizontal: (v: number) => void;
  setSubtitleVertical: (v: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPlaybackContext: (context: PlaybackContext) => void;
  markFrameGenerating: (frameId: string, phase: string) => void;
  completeGeneratingFrame: (frameId: string) => void;
  clearGeneratingFrames: () => void;
  setTunePreview: (preview: { frameId: string; htmlCode: string } | null) => void;
  setSelectedElement: (element: EditableElement | null) => void;
  setSelectedElementIds: (ids: string[]) => void;
  requestElementPanelFocus: (frameId: string, elementId: string) => void;
  clearElementPanelFocus: () => void;
  setEditorDirty: (dirty: boolean) => void;
  requestEditorMeasurement: () => void;
  pushEditHistory: (entry: EditHistoryEntry) => void;
  setEditHistoryIndex: (frameId: string, index: number) => void;
  setLayoutAudit: (frameId: string, issues: LayoutIssue[]) => void;
  setQualityRun: (frameId: string, state: Omit<FrameQualityRunState, 'frameId' | 'updatedAt'>) => void;
  requestQualityRepair: (frameId: string) => void;
  clearQualityRepairRequest: (frameId: string) => void;
  stopQualityRepair: (frameId: string) => void;
  requestForceExport: () => void;
  ignoreLayoutIssue: (scope: string, issue: LayoutIssue) => void;
  permanentlyIgnoreLayoutIssue: (scope: string, issue: LayoutIssue) => void;
}

export const useStudioStore = create<StudioState>()(persist(set => ({
  selectedFrameId: null,
  showSubtitle: true,
  subtitleHorizontal: 50,
  subtitleVertical: 12,
  isPlaying: false,
  playbackContext: { frameId: null, currentTimeMs: 0, durationMs: 0, playbackRevision: 0 },
  generatingFrames: {},
  tunePreview: null,
  selectedElement: null,
  selectedElementIds: [],
  elementPanelFocus: null,
  editorDirty: false,
  editorMeasurementRevision: 0,
  editHistoryByFrame: {},
  layoutAudits: {},
  qualityRuns: {},
  qualityRepairRequests: {},
  qualityRepairJobs: {},
  qualityRepairStops: {},
  forceExportRequest: 0,
  ignoredLayoutIssueKeys: {},
  permanentlyIgnoredLayoutIssueKeys: {},
  setSelectedFrameId: id => set({ selectedFrameId: id }),
  setShowSubtitle: v => set({ showSubtitle: v }),
  setSubtitleHorizontal: v => set({ subtitleHorizontal: clamp(v, 15, 85) }),
  setSubtitleVertical: v => set({ subtitleVertical: clamp(v, 5, 80) }),
  setIsPlaying: v => set({ isPlaying: v }),
  setPlaybackContext: playbackContext => set({ playbackContext }),
  markFrameGenerating: (frameId, phase) => set(state => ({
    generatingFrames: { ...state.generatingFrames, [frameId]: phase },
  })),
  completeGeneratingFrame: frameId => set(state => {
    if (!(frameId in state.generatingFrames)) return state;
    const generatingFrames = { ...state.generatingFrames };
    delete generatingFrames[frameId];
    return { generatingFrames };
  }),
  clearGeneratingFrames: () => set({ generatingFrames: {} }),
  setTunePreview: preview => set({ tunePreview: preview }),
  setSelectedElement: element => set({ selectedElement: element }),
  setSelectedElementIds: ids => set({ selectedElementIds: [...new Set(ids)] }),
  requestElementPanelFocus: (frameId, elementId) => set(state => ({
    elementPanelFocus: { frameId, elementId, revision: (state.elementPanelFocus?.revision || 0) + 1 },
  })),
  clearElementPanelFocus: () => set({ elementPanelFocus: null }),
  setEditorDirty: editorDirty => set({ editorDirty }),
  requestEditorMeasurement: () => set(state => ({ editorMeasurementRevision: state.editorMeasurementRevision + 1 })),
  pushEditHistory: entry => set(state => {
    const frameId = entry.command.frameId;
    const current = state.editHistoryByFrame[frameId] ?? { entries: [], index: -1 };
    const entries = [...current.entries.slice(0, current.index + 1), entry].slice(-100);
    return { editHistoryByFrame: { ...state.editHistoryByFrame, [frameId]: { entries, index: entries.length - 1 } } };
  }),
  setEditHistoryIndex: (frameId, index) => set(state => {
    const current = state.editHistoryByFrame[frameId] ?? { entries: [], index: -1 };
    return {
      editHistoryByFrame: {
        ...state.editHistoryByFrame,
        [frameId]: { ...current, index: Math.max(-1, Math.min(index, current.entries.length - 1)) },
      },
    };
  }),
  setLayoutAudit: (frameId, issues) => set(state => ({
    layoutAudits: {
      ...state.layoutAudits,
      [frameId]: { frameId, issues, auditedAt: Date.now() },
    },
  })),
  setQualityRun: (frameId, quality) => set(state => ({
    qualityRuns: {
      ...state.qualityRuns,
      [frameId]: { frameId, ...quality, updatedAt: Date.now() },
    },
  })),
  requestQualityRepair: frameId => set(state => ({
    qualityRepairRequests: { ...state.qualityRepairRequests, [frameId]: (state.qualityRepairRequests[frameId] || 0) + 1 },
    qualityRepairJobs: { ...state.qualityRepairJobs, [frameId]: createRepairJobId() },
    qualityRepairStops: { ...state.qualityRepairStops, [frameId]: false },
  })),
  clearQualityRepairRequest: frameId => set(state => {
    const next = { ...state.qualityRepairRequests };
    const nextJobs = { ...state.qualityRepairJobs };
    delete next[frameId];
    delete nextJobs[frameId];
    return { qualityRepairRequests: next, qualityRepairJobs: nextJobs };
  }),
  stopQualityRepair: frameId => {
    abortQualityRepair(frameId);
    set(state => ({
      qualityRepairStops: { ...state.qualityRepairStops, [frameId]: true },
      qualityRuns: {
        ...state.qualityRuns,
        [frameId]: {
          frameId,
          status: 'needs_review',
          message: '已停止修复，保留当前画面',
          updatedAt: Date.now(),
        },
      },
    }));
  },
  requestForceExport: () => set(state => ({ forceExportRequest: state.forceExportRequest + 1 })),
  ignoreLayoutIssue: (scope, issue) => set(state => ({
    ignoredLayoutIssueKeys: {
      ...state.ignoredLayoutIssueKeys,
      [scope]: [...new Set([...(state.ignoredLayoutIssueKeys[scope] || []), layoutIssueKey(issue)])],
    },
  })),
  permanentlyIgnoreLayoutIssue: (scope, issue) => set(state => ({
    permanentlyIgnoredLayoutIssueKeys: {
      ...state.permanentlyIgnoredLayoutIssueKeys,
      [scope]: [...new Set([...(state.permanentlyIgnoredLayoutIssueKeys[scope] || []), layoutIssueKey(issue)])],
    },
  })),
}), {
  name: 'ai-video-agent-permanent-layout-issue-ignores',
  partialize: state => ({ permanentlyIgnoredLayoutIssueKeys: state.permanentlyIgnoredLayoutIssueKeys }),
}));

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createRepairJobId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `repair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
