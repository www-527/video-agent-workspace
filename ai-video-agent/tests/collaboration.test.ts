import { describe, expect, it } from 'vitest';
import { approveFrames, approvePlan, areFramesApprovedForGeneration, getCollaborationState, initializeCollaboration, invalidateFrameApproval } from '@/lib/collaboration';
import type { Outline } from '@/types';

const outline: Outline = {
  title: 'Test', totalDuration: 10,
  frames: [
    { id: 'frame-1', index: 1, title: 'One', narration: 'One' },
    { id: 'frame-2', index: 2, title: 'Two', narration: 'Two' },
  ],
};

describe('guided collaboration', () => {
  it('starts with a required plan checkpoint', () => {
    const next = initializeCollaboration(outline);
    expect(getCollaborationState(next)).toMatchObject({ mode: 'guided', planApproved: false, approvedFrameIds: [] });
  });

  it('records plan and first-frame approval', () => {
    const planned = approvePlan(initializeCollaboration(outline), '2026-07-02T00:00:00.000Z');
    const anchored = approveFrames(planned, ['frame-1']);
    expect(anchored.collaboration).toMatchObject({ planApproved: true, approvedFrameIds: ['frame-1'] });
  });

  it('invalidates an approved anchor when its frame changes', () => {
    const anchored = {
      ...approveFrames(approvePlan(outline), ['frame-1']),
      visualAnchor: {
        themeId: 'editorial', colors: [], fontFamilies: [], titleTreatment: '', numberTreatment: '', labelTreatment: '',
        whitespaceRatio: 0.4, motionTempo: 'balanced' as const, prohibitedPatterns: [], approvedFrameIds: ['frame-1'],
      },
    };
    const next = invalidateFrameApproval(anchored, 'frame-1');
    expect(next.visualAnchor).toBeUndefined();
    expect(next.collaboration?.approvedFrameIds).not.toContain('frame-1');
  });

  it('allows an approved batch to generate while the overall plan awaits reconfirmation', () => {
    const reviewed = approveFrames(initializeCollaboration(outline), ['frame-1', 'frame-2']);
    expect(reviewed.collaboration?.planApproved).toBe(false);
    expect(areFramesApprovedForGeneration(reviewed, ['frame-1', 'frame-2'])).toBe(true);
    expect(areFramesApprovedForGeneration(reviewed, ['frame-1', 'missing'])).toBe(false);
    expect(areFramesApprovedForGeneration(reviewed)).toBe(false);
  });
});
