'use client';

import { Copy, ExternalLink, Loader2, Play, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  ContentStyleAgent,
  ContentStylePromptView,
  ProjectContentStyleConfig,
} from '@/lib/content-style/types';

export function PromptRuntimePanel({
  agent,
  onAgentChange,
  prompts,
  projectConfig,
  projectId,
  previewTopic,
  onPreviewTopicChange,
  previewResult,
  previewing,
  onPreview,
  onNavigateToStyle,
  onNavigateToAgent,
}: {
  agent: ContentStyleAgent;
  onAgentChange: (agent: ContentStyleAgent) => void;
  prompts: ContentStylePromptView;
  projectConfig: ProjectContentStyleConfig | null;
  projectId?: string;
  previewTopic: string;
  onPreviewTopicChange: (topic: string) => void;
  previewResult: Record<string, unknown> | null;
  previewing: 'compile' | 'model' | null;
  onPreview: (compileOnly: boolean) => void;
  onNavigateToStyle: () => void;
  onNavigateToAgent: () => void;
}) {
  const compiled = prompts.compiled[agent];
  const coreSource = agent === 'planner' ? prompts.effective.plannerSource : prompts.effective.qualitySource;
  const versionId = agent === 'planner'
    ? prompts.effective.plannerPromptVersionId
    : prompts.effective.qualityPromptVersionId;
  const scope = projectId && projectConfig?.mode === 'override' ? '当前项目覆盖' : '全局设置';
  const userMessage = buildRuntimeUserMessage(agent, prompts.instructionContext, previewTopic);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h3 className="text-base font-semibold">Prompt 运行查看</h3>
          <p className="mt-1 text-sm text-muted-foreground">只读查看当前配置会怎样发送给模型；修改请前往对应设置入口。</p>
        </div>
        <AgentSwitch agent={agent} onChange={onAgentChange} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem label="内容风格" value={prompts.preset.name} badge="预设生成" />
        <SummaryItem label="应用范围" value={scope} badge={projectId ? '项目上下文' : '全局上下文'} />
        <SummaryItem label="Agent 核心" value={coreSource === 'official' ? '官方默认' : '自定义覆盖'} badge={`版本 ${versionLabel(versionId)}`} />
        <SummaryItem label="System Prompt 哈希" value={shortId(prompts.promptHashes[agent], 12)} badge="SHA-256" mono />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardTitle className="text-base">本次预览上下文</CardTitle>
              <CardDescription>输入一个主题后，下方 User Message 会展示运行时消息模板。</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onNavigateToStyle}>
                <ExternalLink data-icon="inline-start" />修改内容风格
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onNavigateToAgent}>
                <ExternalLink data-icon="inline-start" />修改 Agent 核心
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="prompt-preview-topic">主题、素材或本次要求</Label>
          <Textarea
            id="prompt-preview-topic"
            rows={4}
            value={previewTopic}
            onChange={event => onPreviewTopicChange(event.target.value)}
            placeholder="输入一个主题，查看当前配置下会发送给模型的消息。"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onPreview(true)} disabled={!previewTopic.trim() || Boolean(previewing)}>
              {previewing === 'compile' ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
              刷新 Prompt 预览
            </Button>
            <Button type="button" onClick={() => onPreview(false)} disabled={!previewTopic.trim() || Boolean(previewing)}>
              {previewing === 'model' ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
              调用模型预览大纲
            </Button>
          </div>
        </CardContent>
      </Card>

      <MessageCard
        title="System Message"
        description="完整、只读的系统消息。固定契约、Agent 核心和风格规则已经按真实顺序拼接。"
        content={compiled.system}
        rows={18}
      />
      <MessageCard
        title="User Message"
        description="内容要求会直接发送；联网研究、对话历史或待审校大纲等动态资料以占位符表示。"
        content={userMessage}
        rows={12}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt 组成</CardTitle>
          <CardDescription>这里只解释每一层来自哪里；本页不直接修改内容。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {compiled.layers.map(layer => (
            <div key={layer.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{layerDisplayName(layer.id, layer.name)}</span>
                  <Badge variant={layer.editable ? 'outline' : 'secondary'}>{layer.editable ? '可编辑' : '只读'}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{layerDescription(layer.id)}</p>
              </div>
              {layer.id === 'agent-core' ? (
                <Button type="button" variant="ghost" size="sm" onClick={onNavigateToAgent}>前往修改</Button>
              ) : layer.id === 'content-style' ? (
                <Button type="button" variant="ghost" size="sm" onClick={onNavigateToStyle}>前往修改</Button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">全局与项目内容要求</span>
                <Badge variant="outline">可编辑</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">作为 User Message 的上下文发送，不会覆盖固定系统契约。</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onNavigateToStyle}>前往修改</Button>
          </div>
        </CardContent>
      </Card>

      {previewResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近一次预览结果</CardTitle>
            <CardDescription>编译预览展示消息结构；模型预览还会返回生成的大纲。</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea value={JSON.stringify(previewResult, null, 2)} readOnly rows={18} className="font-mono text-xs" />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function AgentSwitch({ agent, onChange }: { agent: ContentStyleAgent; onChange: (agent: ContentStyleAgent) => void }) {
  return (
    <Tabs value={agent} onValueChange={value => onChange(value as ContentStyleAgent)}>
      <TabsList>
        <TabsTrigger value="planner">内容规划 Agent</TabsTrigger>
        <TabsTrigger value="quality">内容质量 Agent</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function SummaryItem({ label, value, badge, mono = false }: { label: string; value: string; badge: string; mono?: boolean }) {
  return (
    <Card>
      <CardContent className="flex min-h-24 flex-col justify-between gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Badge variant="secondary">{badge}</Badge>
        </div>
        <span className={mono ? 'font-mono text-sm' : 'text-sm font-medium'}>{value}</span>
      </CardContent>
    </Card>
  );
}

function MessageCard({ title, description, content, rows }: { title: string; description: string; content: string; rows: number }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(`${title} 已复制`);
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            <Copy data-icon="inline-start" />复制
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea value={content} readOnly rows={rows} className="font-mono text-xs leading-5" />
      </CardContent>
    </Card>
  );
}

function buildRuntimeUserMessage(agent: ContentStyleAgent, instructionContext: string, topic: string): string {
  const subject = topic.trim() || '（尚未输入主题）';
  if (agent === 'planner') {
    return [
      instructionContext,
      '【对话历史上下文】\n（运行时按需注入）',
      '【当前已有大纲】\n（续改任务时按需注入）',
      '【联网研究结果】\n（研究阶段完成后注入）',
      '【时长硬约束】\n（根据本次要求自动解析）',
      `【本次用户要求】\n${subject}`,
    ].filter(Boolean).join('\n\n');
  }
  return [
    instructionContext,
    `【原始要求】\n${subject}`,
    '【允许使用的证据】\n（研究阶段完成后注入）',
    '【待审校完整大纲】\n（内容规划 Agent 完成后注入）',
  ].filter(Boolean).join('\n\n');
}

function layerDisplayName(id: string, fallback: string): string {
  if (id === 'fixed-contract') return '固定运行契约';
  if (id === 'agent-core') return 'Agent 核心指令';
  if (id === 'content-style') return '内容风格规则';
  if (id === 'quality-output') return '审校输出契约';
  return fallback;
}

function layerDescription(id: string): string {
  if (id === 'fixed-contract') return '系统强制保留的输出、事实与结构约束。';
  if (id === 'agent-core') return '定义当前 Agent 的角色、工作步骤与判断方式。';
  if (id === 'content-style') return '由当前内容风格预设自动生成。';
  if (id === 'quality-output') return '规定内容质量 Agent 返回的数据结构。';
  return '运行时 Prompt 的组成部分。';
}

function shortId(value: string, length = 8): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function versionLabel(value: string): string {
  const officialVersion = value.match(/-v(\d+)$/);
  return officialVersion ? `v${officialVersion[1]}` : shortId(value);
}
