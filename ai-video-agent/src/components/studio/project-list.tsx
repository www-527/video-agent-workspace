'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Code2, Loader2, Monitor, MoreHorizontal, Pencil, Plus, Search, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { CanvasPresetId, ProjectSummary } from '@/types';
import { DEFAULT_CANVAS_PRESET, getCanvasPreset } from '@/lib/canvas-presets';
import { createGPTFreeProject } from '@/lib/projects/create-gpt-free-project';

export function ProjectList({
  onNavigate,
  onClose,
}: {
  onNavigate?: (href: string) => void;
  onClose?: () => void;
}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [canvasPreset, setCanvasPreset] = useState<CanvasPresetId>(DEFAULT_CANVAS_PRESET);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('加载项目列表失败');
      return await response.json() as ProjectSummary[];
    },
  });
  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    return keyword ? projects.filter(project => project.title.toLocaleLowerCase('zh-CN').includes(keyword)) : projects;
  }, [projects, query]);

  function navigate(href: string) {
    if (onNavigate) onNavigate(href);
    else router.push(href);
    onClose?.();
  }

  const deleteMutation = useMutation({
    mutationFn: async (uuid: string) => {
      const response = await fetch(`/api/projects/${uuid}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除失败');
    },
    onSuccess: (_data, deletedUuid) => {
      toast.success('项目已删除');
      void qc.invalidateQueries({ queryKey: ['projects'] });
      if (deletedUuid === params.id) {
        const remaining = projects.filter(project => project.uuid !== deletedUuid);
        navigate(remaining.length ? `/projects/${remaining[0].uuid}` : '/');
      }
    },
    onError: error => toast.error((error as Error).message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ uuid, title }: { uuid: string; title: string }) => {
      const response = await fetch(`/api/projects/${uuid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('重命名失败');
    },
    onSuccess: () => {
      toast.success('项目已重命名');
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: error => toast.error((error as Error).message),
  });

  const createMutation = useMutation({
    mutationFn: createGPTFreeProject,
    onSuccess: uuid => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${uuid}`);
    },
    onError: error => toast.error((error as Error).message),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-col gap-3 border-b p-4">
        <Button variant="outline" className="justify-start" onClick={() => createMutation.mutate(canvasPreset)} disabled={createMutation.isPending}>
          {createMutation.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
          {createMutation.isPending ? '正在新建项目' : '新建项目'}
        </Button>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="新建项目画幅">
          <CanvasPresetButton
            active={canvasPreset === 'landscape-16-9'}
            icon={<Monitor className="size-3.5" />}
            label="横屏"
            detail="16:9"
            onClick={() => setCanvasPreset('landscape-16-9')}
          />
          <CanvasPresetButton
            active={canvasPreset === 'douyin-portrait-9-16'}
            icon={<Smartphone className="size-3.5" />}
            label="竖屏"
            detail="9:16"
            onClick={() => setCanvasPreset('douyin-portrait-9-16')}
          />
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="搜索项目" aria-label="搜索项目" />
        </label>
      </div>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-xs font-medium text-muted-foreground">最近项目</h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">{filteredProjects.length}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <div className="flex flex-col gap-1">
          {isLoading ? (
            <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
          ) : filteredProjects.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">{query ? '没有匹配的项目' : '还没有项目'}</div>
          ) : filteredProjects.map(project => {
            const active = project.uuid === params.id;
            return (
              <div key={project.uuid} className={cn('group relative grid grid-cols-[minmax(0,1fr),auto] items-center rounded-md border-l-2', active ? 'border-primary bg-accent/70' : 'border-transparent hover:bg-accent/50')}>
                <button type="button" onClick={() => navigate(`/projects/${project.uuid}`)} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr)] gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Code2 className="mt-0.5 size-4 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className={cn('line-clamp-2 text-sm leading-5', active && 'font-medium')}>{project.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{project.workflow === 'gpt-free' ? 'GPT 自由创作 · ' : ''}{getCanvasPreset(project.canvasPreset).shortName} · {formatRelativeTime(project.updatedAt || project.createdAt)}{project.hasOutline ? ' · 已有大纲' : ' · 未开始'}</span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="mr-1 size-8 opacity-0 focus:opacity-100 group-hover:opacity-100" title={`管理项目：${project.title}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => {
                        const title = window.prompt('输入新的项目名称', project.title)?.trim();
                        if (title && title !== project.title) renameMutation.mutate({ uuid: project.uuid, title });
                      }}><Pencil />重命名</DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {
                        if (window.confirm(`确定删除“${project.title}”吗？`)) deleteMutation.mutate(project.uuid);
                      }}><Trash2 />删除项目</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function CanvasPresetButton({
  active,
  icon,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-2 rounded-md border px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:border-primary/45 hover:bg-muted/40',
      )}
    >
      <span className={cn('flex size-5 items-center justify-center rounded-sm', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{detail}</span>
    </button>
  );
}
