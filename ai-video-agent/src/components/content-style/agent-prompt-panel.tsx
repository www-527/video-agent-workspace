'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, FileDiff, History, Loader2, Pencil, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  ContentStyleAgent,
  ContentStylePromptView,
  ContentStyleSettingsView,
  PromptValidationResult,
  PromptVersion,
} from '@/lib/content-style/types';
import { AgentSwitch } from './prompt-runtime-panel';
import { requestJson } from './request-json';

type VersionMetadata = Omit<PromptVersion, 'content'>;
type EditorStage = 'view' | 'edit' | 'review';
type ReviewAction = 'save' | 'reset' | 'restore';

export function AgentPromptPanel({
  agent,
  onAgentChange,
  settings,
  prompts,
  versions,
  onReload,
  onDirtyChange,
  onRequestTop,
}: {
  agent: ContentStyleAgent;
  onAgentChange: (agent: ContentStyleAgent) => void;
  settings: ContentStyleSettingsView;
  prompts: ContentStylePromptView;
  versions: VersionMetadata[];
  onReload: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onRequestTop: () => void;
}) {
  const [section, setSection] = useState<'prompt' | 'history'>('prompt');
  const [stage, setStage] = useState<EditorStage>('view');
  const [reviewAction, setReviewAction] = useState<ReviewAction>('save');
  const [draft, setDraft] = useState('');
  const [validation, setValidation] = useState<PromptValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOfficial, setShowOfficial] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const panelTopRef = useRef<HTMLDivElement>(null);

  const currentCore = agent === 'planner' ? prompts.effective.plannerCore : prompts.effective.qualityCore;
  const officialCore = prompts.defaults[agent].content;
  const currentVersionId = agent === 'planner'
    ? prompts.effective.plannerPromptVersionId
    : prompts.effective.qualityPromptVersionId;
  const source = agent === 'planner' ? prompts.effective.plannerSource : prompts.effective.qualitySource;
  const dirty = stage !== 'view' && draft !== currentCore;
  const agentVersions = useMemo(() => versions.filter(version => version.agent === agent), [agent, versions]);

  useEffect(() => {
    setDraft(currentCore);
    setStage('view');
    setValidation(null);
    setSelectedVersion(null);
  }, [agent, currentCore]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    panelTopRef.current?.scrollIntoView({ block: 'start' });
    onRequestTop();
  }, [onRequestTop, section, stage]);

  function changeAgent(nextAgent: ContentStyleAgent) {
    if (dirty && !window.confirm('当前 Agent 的草稿尚未保存，确定切换并放弃草稿吗？')) return;
    onAgentChange(nextAgent);
  }

  function beginEdit() {
    setDraft(currentCore);
    setValidation(null);
    setReviewAction('save');
    setStage('edit');
  }

  function cancelEdit() {
    setDraft(currentCore);
    setValidation(null);
    setStage('view');
  }

  async function prepareReview(action: ReviewAction, content: string, knownValidation?: PromptValidationResult) {
    setSaving(true);
    try {
      const result = knownValidation || await requestJson<PromptValidationResult>('/api/settings/content-style/prompts/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent, content }),
      });
      setDraft(content);
      setValidation(result);
      setReviewAction(action);
      setStage('review');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmReview() {
    if (!validation || validation.level === 'invalid' || saving) return;
    setSaving(true);
    try {
      if (reviewAction === 'reset') {
        await requestJson('/api/settings/content-style/prompts/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent, expectedRevision: settings.revision }),
        });
        toast.success('已恢复官方默认，并保留历史版本');
      } else if (reviewAction === 'restore' && selectedVersion) {
        await requestJson(`/api/settings/content-style/versions/${selectedVersion.id}/restore`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: settings.revision }),
        });
        toast.success('历史版本已恢复，并生成新的版本快照');
      } else {
        await requestJson('/api/settings/content-style/prompts', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent,
            content: draft,
            expectedRevision: settings.revision,
            confirmWarnings: validation.level === 'warning',
          }),
        });
        toast.success(`${agentLabel(agent)}核心指令已保存`);
      }
      setStage('view');
      setValidation(null);
      setSelectedVersion(null);
      await onReload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function inspectVersion(id: string) {
    try {
      setSelectedVersion(await requestJson<PromptVersion>(`/api/settings/content-style/versions/${id}`));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div ref={panelTopRef} className="flex flex-col gap-5 pb-6">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h3 className="text-base font-semibold">Agent 底层设置</h3>
          <p className="mt-1 text-sm text-muted-foreground">这里只修改 Agent 核心指令；固定运行契约和输出结构始终由系统保留。</p>
        </div>
        <AgentSwitch agent={agent} onChange={changeAgent} />
      </div>

      <Tabs value={section} onValueChange={value => setSection(value as 'prompt' | 'history')}>
        <TabsList>
          <TabsTrigger value="prompt">核心指令</TabsTrigger>
          <TabsTrigger value="history">版本历史</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt" className="mt-4">
          {stage === 'view' ? (
            <PromptOverview
              agent={agent}
              source={source}
              versionId={currentVersionId}
              currentCore={currentCore}
              officialCore={officialCore}
              showOfficial={showOfficial}
              onToggleOfficial={() => setShowOfficial(value => !value)}
              onEdit={beginEdit}
              onReset={() => void prepareReview('reset', officialCore)}
              saving={saving}
            />
          ) : stage === 'edit' ? (
            <PromptEditor
              agent={agent}
              draft={draft}
              onDraftChange={setDraft}
              onCancel={cancelEdit}
              onReview={() => void prepareReview('save', draft)}
              saving={saving}
              changed={draft !== currentCore}
            />
          ) : validation ? (
            <PromptReview
              action={reviewAction}
              before={currentCore}
              after={draft}
              validation={validation}
              onBack={() => setStage(reviewAction === 'save' ? 'edit' : 'view')}
              onConfirm={() => void confirmReview()}
              saving={saving}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <VersionHistory
            versions={agentVersions}
            selectedVersion={selectedVersion}
            currentCore={currentCore}
            onInspect={inspectVersion}
            onRestore={version => {
              setSelectedVersion(version);
              setSection('prompt');
              void prepareReview('restore', version.content, version.validation);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PromptOverview({
  agent,
  source,
  versionId,
  currentCore,
  officialCore,
  showOfficial,
  onToggleOfficial,
  onEdit,
  onReset,
  saving,
}: {
  agent: ContentStyleAgent;
  source: 'official' | 'custom';
  versionId: string;
  currentCore: string;
  officialCore: string;
  showOfficial: boolean;
  onToggleOfficial: () => void;
  onEdit: () => void;
  onReset: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{agentLabel(agent)}核心指令</CardTitle>
                <Badge variant={source === 'official' ? 'secondary' : 'outline'}>{source === 'official' ? '官方默认' : '自定义覆盖'}</Badge>
              </div>
              <CardDescription>当前版本：{versionId}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {source === 'custom' ? (
                <Button type="button" variant="outline" onClick={onToggleOfficial}>{showOfficial ? '隐藏官方默认' : '查看官方默认'}</Button>
              ) : null}
              <Button type="button" onClick={onEdit}><Pencil data-icon="inline-start" />编辑当前指令</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea value={currentCore} readOnly rows={20} className="font-mono text-xs leading-5" />
          {source === 'custom' ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={onReset} disabled={saving}>
                {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
                恢复官方默认
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showOfficial && source === 'custom' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">官方默认文本</CardTitle>
            <CardDescription>仅供比较，不会自动替换当前自定义版本。</CardDescription>
          </CardHeader>
          <CardContent><Textarea value={officialCore} readOnly rows={16} className="font-mono text-xs leading-5" /></CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PromptEditor({
  agent,
  draft,
  onDraftChange,
  onCancel,
  onReview,
  saving,
  changed,
}: {
  agent: ContentStyleAgent;
  draft: string;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onReview: () => void;
  saving: boolean;
  changed: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline">草稿模式</Badge>
          <CardTitle className="text-base">编辑{agentLabel(agent)}核心指令</CardTitle>
        </div>
        <CardDescription>固定 JSON、事实、时长和输出契约不会出现在编辑器中，也不会被这里的内容覆盖。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          aria-label={`${agentLabel(agent)}核心指令草稿`}
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          rows={24}
          className="font-mono text-xs leading-5"
        />
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <span className="text-xs text-muted-foreground">{changed ? '草稿包含尚未保存的修改' : '尚未修改当前文本'}</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onCancel}><ArrowLeft data-icon="inline-start" />放弃草稿</Button>
            <Button type="button" onClick={onReview} disabled={!changed || saving}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileDiff data-icon="inline-start" />}
              校验并查看差异
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PromptReview({
  action,
  before,
  after,
  validation,
  onBack,
  onConfirm,
  saving,
}: {
  action: ReviewAction;
  before: string;
  after: string;
  validation: PromptValidationResult;
  onBack: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const summary = promptDiffSummary(before, after);
  const title = action === 'reset' ? '确认恢复官方默认' : action === 'restore' ? '确认恢复历史版本' : '保存前检查';
  const confirmLabel = action === 'reset' ? '确认恢复默认' : action === 'restore' ? '确认恢复此版本' : validation.level === 'warning' ? '了解风险并强制保存' : '确认保存新版本';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            <ValidationBadge validation={validation} />
          </div>
          <CardDescription>确认差异和校验结果后才会写入；成功后会自动生成版本快照。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {validation.issues.length ? (
            <div className="flex flex-col gap-2">
              {validation.issues.map(issue => (
                <div key={issue.code} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={issue.level === 'error' ? 'destructive' : 'outline'}>{issue.level === 'error' ? '阻止保存' : '风险提示'}</Badge>
                    <span>{issue.message}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Check aria-hidden="true" />关键角色约束检查通过
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <DiffMetric label="修改行" value={`${summary.changedLines}`} />
            <DiffMetric label="修改前字符" value={`${before.length}`} />
            <DiffMetric label="修改后字符" value={`${after.length}`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">当前生效版本</span>
              <Textarea value={before} readOnly rows={18} className="font-mono text-xs leading-5" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">保存后版本</span>
              <Textarea value={after} readOnly rows={18} className="font-mono text-xs leading-5" />
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-muted-foreground">影响范围：之后新运行的内容规划与质量审校任务；历史运行记录不会改变。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onBack} disabled={saving}><ArrowLeft data-icon="inline-start" />返回</Button>
              <Button type="button" onClick={onConfirm} disabled={validation.level === 'invalid' || saving}>
                {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                {confirmLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VersionHistory({
  versions,
  selectedVersion,
  currentCore,
  onInspect,
  onRestore,
}: {
  versions: VersionMetadata[];
  selectedVersion: PromptVersion | null;
  currentCore: string;
  onInspect: (id: string) => Promise<void>;
  onRestore: (version: PromptVersion) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">版本快照</CardTitle>
          <CardDescription>只显示当前 Agent 的历史；恢复不会删除后续版本。</CardDescription>
        </CardHeader>
        <CardContent className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
          {versions.length ? versions.map(version => (
            <button
              key={version.id}
              type="button"
              className="rounded-lg border p-3 text-left transition-colors hover:bg-accent"
              onClick={() => void onInspect(version.id)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{sourceLabel(version.source)}</span>
                <Badge variant="outline">{version.contentHash.slice(0, 8)}</Badge>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span>
            </button>
          )) : <p className="py-12 text-center text-sm text-muted-foreground">还没有保存过自定义版本。</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">与当前版本比较</CardTitle>
          <CardDescription>选择左侧快照后，再决定是否进入恢复确认。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {selectedVersion ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">当前生效版本</span>
                  <Textarea value={currentCore} readOnly rows={18} className="font-mono text-xs leading-5" />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">所选历史版本</span>
                  <Textarea value={selectedVersion.content} readOnly rows={18} className="font-mono text-xs leading-5" />
                </div>
              </div>
              <Button type="button" className="self-end" onClick={() => onRestore(selectedVersion)}>
                <History data-icon="inline-start" />查看差异并恢复
              </Button>
            </>
          ) : <p className="py-20 text-center text-sm text-muted-foreground">请选择一个历史版本。</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ValidationBadge({ validation }: { validation: PromptValidationResult }) {
  if (validation.level === 'invalid') return <Badge variant="destructive">校验未通过</Badge>;
  if (validation.level === 'warning') return <Badge variant="outline">需要确认风险</Badge>;
  return <Badge variant="secondary">校验通过</Badge>;
}

function DiffMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function promptDiffSummary(before: string, after: string): { changedLines: number } {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const length = Math.max(beforeLines.length, afterLines.length);
  let changedLines = 0;
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) changedLines += 1;
  }
  return { changedLines };
}

function agentLabel(agent: ContentStyleAgent): string {
  return agent === 'planner' ? '内容规划 Agent' : '内容质量 Agent';
}

function sourceLabel(source: PromptVersion['source']): string {
  if (source === 'reset') return '恢复官方默认';
  if (source === 'restore') return '历史版本恢复';
  return '编辑保存';
}
