'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { ArrowUpRight, Clapperboard, Code2, FolderKanban, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { cn, formatRelativeTime } from '@/lib/utils';
import { getCanvasPreset } from '@/lib/canvas-presets';
import type { ProjectSummary } from '@/types';
import { ShutdownButton } from '@/components/shutdown-button';
import { RestartButton } from '@/components/restart-button';
import { AIKeyManager } from '@/components/ai-key-manager';

const ProjectDrawer = dynamic(
  () => import('@/components/studio/project-drawer').then(module => module.ProjectDrawer),
  { ssr: false },
);

const CodexAPITestDialog = dynamic(
  () => import('@/components/codex-api-test-dialog').then(module => module.CodexAPITestDialog),
  { ssr: false },
);

export default function HomePage() {
  const router = useRouter();
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [codexTestOpen, setCodexTestOpen] = useState(false);
  const [enteringProjectCenter, setEnteringProjectCenter] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [recentProjectsLoading, setRecentProjectsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/projects')
      .then(async response => {
        if (!response.ok) throw new Error('获取项目列表失败');
        return await response.json() as ProjectSummary[];
      })
      .then(projects => {
        if (!cancelled) setRecentProjects(projects.slice(0, 6));
      })
      .catch(error => {
        if (!cancelled) {
          setRecentProjects([]);
          toast.error(error instanceof Error ? error.message : '获取项目列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setRecentProjectsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleEnterProjectCenter() {
    if (enteringProjectCenter) return;

    setEnteringProjectCenter(true);
    try {
      const response = await fetch('/api/projects');
      const projects = await response.json().catch(() => null) as ProjectSummary[] | null;
      if (!response.ok) throw new Error('获取项目列表失败');

      const latestProject = projects?.[0];
      if (!latestProject) {
        setProjectDrawerOpen(true);
        return;
      }

      router.push(`/projects/${latestProject.uuid}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取项目列表失败');
    } finally {
      setEnteringProjectCenter(false);
    }
  }

  return (
    <div className="home-shell min-h-screen text-foreground">
      <header className="home-header">
        <div className="grid h-[68px] w-full grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="home-mark flex size-9 items-center justify-center text-white">
              <Clapperboard className="size-[18px]" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-[-0.01em]">{env.APP_NAME}</span>
              <span className="home-brand-caption">VIDEO STUDIO</span>
            </span>
          </div>
          <span className="home-page-label">创作首页</span>
          <div className="flex justify-end gap-0.5 [&_button]:font-normal">
            <AIKeyManager />
            <RestartButton />
            <ShutdownButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] px-4 pb-12 pt-10 sm:px-7 sm:pt-14">
        <div className="home-intro">
          <div className="home-eyebrow"><span />AI VIDEO WORKBENCH <em>01</em></div>
          <h1 className="home-title">开始创作</h1>
          <p className="home-lede">新建一个视频项目，或继续处理最近的工作。</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(360px,.88fr)_minmax(0,1.12fr)]">
          <section className="home-new-project" aria-labelledby="new-project-title">
            <div className="home-section-heading">
              <div>
                <p className="home-section-index">01 / NEW PROJECT</p>
                <h2 id="new-project-title">新建项目</h2>
              </div>
              <span className="home-heading-rule" aria-hidden="true" />
            </div>
            <div className="home-creation-mode">
              <span className="home-mode-icon"><Sparkles className="size-[18px]" strokeWidth={1.75} /></span>
              <div>
                <p className="home-mode-kicker">GUIDED BY GPT</p>
                <h3>GPT 自由创作</h3>
              </div>
            </div>
            <p className="home-mode-description">输入主题、文章或口播稿；确认内容计划后，继续生成分镜、画面和旁白。</p>
            <Button className="home-create-button" onClick={handleEnterProjectCenter} disabled={enteringProjectCenter} aria-label="进入项目中心">
              {enteringProjectCenter ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FolderKanban data-icon="inline-start" />}
              {enteringProjectCenter ? '正在进入项目中心' : '进入项目中心'}
              <ArrowUpRight className="ml-auto size-4" strokeWidth={1.75} />
            </Button>
            <p className="home-note">直接进入最近项目；没有项目时，可选择横竖屏后新建。</p>
          </section>

          <section className="home-projects min-w-0" aria-labelledby="recent-projects-title">
            <div className="home-section-heading home-projects-heading">
              <div>
                <p className="home-section-index">02 / CONTINUE WORKING</p>
                <h2 id="recent-projects-title">最近项目</h2>
                <p>继续上次的创作，或打开项目列表进行管理。</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setProjectDrawerOpen(true)} className="home-all-projects-button">
                <FolderKanban data-icon="inline-start" />
                全部项目
              </Button>
            </div>

            <div className="home-project-list">
              {recentProjectsLoading ? (
                <div className="flex h-[274px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在读取项目</div>
              ) : recentProjects.length ? (
                <div className="space-y-1.5">
                  {recentProjects.map(project => <ProjectRow key={project.uuid} project={project} onOpen={() => router.push(`/projects/${project.uuid}`)} />)}
                </div>
              ) : (
                <div className="home-empty-state">
                  <span className="home-empty-icon"><FolderKanban className="size-5" strokeWidth={1.65} /></span>
                  <p>还没有项目</p>
                  <span>从左侧新建第一个视频项目。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <Button
        size="icon"
        variant="ghost"
        onClick={() => setCodexTestOpen(true)}
        className="home-test-entry"
        title="Codex API 测试"
      >
        <Code2 className="size-3.5" />
        <span className="sr-only">Codex API 测试</span>
      </Button>

      <ProjectDrawer open={projectDrawerOpen} onOpenChange={setProjectDrawerOpen} onNavigate={href => router.push(href)} />
      <CodexAPITestDialog open={codexTestOpen} onOpenChange={setCodexTestOpen} />
    </div>
  );
}

function ProjectRow({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const canvas = getCanvasPreset(project.canvasPreset);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="home-project-row grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-left outline-none"
    >
      <span className="home-project-icon flex size-9 items-center justify-center"><Code2 className="size-4" strokeWidth={1.7} /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{project.title}</span>
        <span className={cn('mt-1 block truncate text-xs text-muted-foreground')}>
          {canvas.shortName} · {formatRelativeTime(project.updatedAt || project.createdAt)} · {project.hasOutline ? '已有大纲' : '待开始'}
        </span>
      </span>
      <ArrowUpRight className="home-project-arrow size-4" strokeWidth={1.55} aria-hidden="true" />
    </button>
  );
}
