'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProjectList } from './project-list';

export function ProjectDrawer({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="studio-project-drawer left-0 top-0 h-dvh w-[360px] max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 grid-rows-[auto,minmax(0,1fr)] gap-0 rounded-none border-y-0 border-l-0 p-0 sm:rounded-none">
        <DialogHeader className="border-b px-4 py-4 pr-12">
          <DialogTitle className="text-base">项目</DialogTitle>
          <DialogDescription className="text-xs">新建、查找或切换最近项目</DialogDescription>
        </DialogHeader>
        <ProjectList onNavigate={onNavigate} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
