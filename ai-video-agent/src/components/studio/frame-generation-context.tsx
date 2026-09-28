'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useFrameGeneration } from '@/hooks/use-frame-generation';
import type { ProjectDetail, SmartImageMode } from '@/types';

type FrameGenerationController = ReturnType<typeof useFrameGeneration> & {
  refresh: () => Promise<ProjectDetail | undefined>;
  smartImageMode: SmartImageMode | 'off';
  setSmartImageMode: (mode: SmartImageMode | 'off') => void;
};

const FrameGenerationContext = createContext<FrameGenerationController | null>(null);

export function FrameGenerationProvider({
  project,
  onProjectChange,
  frameConcurrency,
  children,
}: {
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  frameConcurrency?: number;
  children: ReactNode;
}) {
  const [smartImageMode, setSmartImageMode] = useState<SmartImageMode | 'off'>('balanced');
  const refresh = useCallback(async (): Promise<ProjectDetail | undefined> => {
    try {
      const response = await fetch(`/api/projects/${project.uuid}`);
      if (!response.ok) return undefined;
      const nextProject = await response.json() as ProjectDetail;
      onProjectChange(nextProject);
      return nextProject;
    } catch {
      return undefined;
    }
  }, [project.uuid, onProjectChange]);

  const generation = useFrameGeneration({ project, onProjectRefresh: refresh, frameConcurrency });

  return (
    <FrameGenerationContext.Provider value={{ ...generation, refresh, smartImageMode, setSmartImageMode }}>
      {children}
    </FrameGenerationContext.Provider>
  );
}

export function useFrameGenerationController() {
  const controller = useContext(FrameGenerationContext);
  if (!controller) {
    throw new Error('useFrameGenerationController must be used inside FrameGenerationProvider');
  }
  return controller;
}

/** Consumers that can render in a standalone preview (tests, embeds) may use
 * this variant and simply hide generation controls when no provider exists. */
export function useOptionalFrameGenerationController() {
  return useContext(FrameGenerationContext);
}
