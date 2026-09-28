'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AIAPIChat } from '@/components/ai-api-chat';
import {
  DEFAULT_PROJECT_GPT_OPTIMIZATION,
  type GPTOptimizationSettings,
  type ProjectGPTOptimizationConfig,
} from '@/lib/gpt-optimization-settings';

interface AIKeyItem {
  id: string;
  name: string;
  maskedKey: string;
  selectedModel: string;
  baseURL: string;
  apiProtocol: 'auto' | 'responses' | 'chat.completions';
  gptOptimization: GPTOptimizationSettings;
  source: 'saved' | 'environment';
  active: boolean;
  deletable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface AIKeyList {
  items: AIKeyItem[];
  activeId: string | null;
  activeName: string | null;
  activeModel: string | null;
  activeBaseURL: string | null;
  activeAPIProtocol: 'auto' | 'responses' | 'chat.completions' | null;
  activeGPTOptimization: GPTOptimizationSettings | null;
  configured: boolean;
}

interface AvailableAIModel {
  id: string;
  ownedBy: string;
}

interface AvailableAIModelList {
  count: number;
  models: AvailableAIModel[];
}

interface GPTCapabilityReport {
  configuredModel: string;
  actualModel?: string;
  responses: { supported: boolean; error?: string };
  structuredOutput: { supported: boolean; error?: string };
  imageGenerationProbed: false;
}

type PendingAction = 'load' | 'add' | 'activate' | 'rename' | 'delete' | 'model' | 'base-url' | 'api-protocol' | 'gpt-optimization' | null;

export function AIKeyManager({
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  projectId,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  projectId?: string;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [data, setData] = useState<AIKeyList | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [showKey, setShowKey] = useState(false);
  const [addExpanded, setAddExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AIKeyItem | null>(null);
  const [models, setModels] = useState<AvailableAIModelList | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [activeBaseURL, setActiveBaseURL] = useState('');
  const [capabilities, setCapabilities] = useState<GPTCapabilityReport | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [projectGPTOptimization, setProjectGPTOptimization] = useState<ProjectGPTOptimizationConfig>({
    ...DEFAULT_PROJECT_GPT_OPTIMIZATION,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPending('load');
    setError('');
    void Promise.all([
      requestAIKeys(),
      projectId ? requestProjectGPTOptimization(projectId) : Promise.resolve(null),
    ])
      .then(([next, projectSettings]) => {
        if (cancelled) return;
        setData(next);
        setProjectGPTOptimization(projectSettings ?? { ...DEFAULT_PROJECT_GPT_OPTIMIZATION });
        setManualModel(next.activeModel || '');
        setActiveBaseURL(next.activeBaseURL || '');
        setBaseURL(next.activeBaseURL || 'https://api.openai.com/v1');
        if (next.activeId) void loadModels(next.activeId);
      })
      .catch(requestError => {
        if (!cancelled) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => { cancelled = true; };
  // Opening can be driven by the settings dropdown, so data loading must react
  // to the controlled `open` prop instead of relying on DialogTrigger callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  function handleOpenChange(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      resetSecretForm();
      setAddExpanded(false);
      setEditingId(null);
      setError('');
      setModels(null);
      setModelError('');
      setManualModel('');
      setActiveBaseURL('');
      setCapabilities(null);
    }
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setPending('add');
    setError('');
    try {
      const next = await requestAIKeys({
        method: 'POST',
        body: JSON.stringify({ name, apiKey, baseURL }),
      });
      setData(next);
      resetSecretForm();
      setManualModel(next.activeModel || '');
      setActiveBaseURL(next.activeBaseURL || '');
      if (next.activeId) void loadModels(next.activeId);
      toast.success(`已添加并切换到「${next.activeName}」`);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function handleActivate(item: AIKeyItem) {
    if (item.active || pending) return;
    const next = await mutate(
      'activate',
      { method: 'PATCH', body: JSON.stringify({ action: 'activate', id: item.id }) },
      `已切换到「${item.name}」`,
    );
    if (next) {
      setManualModel(next.activeModel || '');
      setActiveBaseURL(next.activeBaseURL || '');
      setCapabilities(null);
      void loadModels(item.id);
    }
  }

  async function handleRename(event: React.FormEvent, item: AIKeyItem) {
    event.preventDefault();
    const next = await mutate(
      'rename',
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'rename', id: item.id, name: editingName }),
      },
      'Key 名称已更新',
    );
    if (next) setEditingId(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const targetName = deleteTarget.name;
    const next = await mutate(
      'delete',
      { method: 'DELETE', body: JSON.stringify({ id: deleteTarget.id }) },
      `已删除「${targetName}」`,
    );
    if (next) {
      setDeleteTarget(null);
      setManualModel(next.activeModel || '');
      setActiveBaseURL(next.activeBaseURL || '');
      if (next.activeId) void loadModels(next.activeId);
      else setModels(null);
    }
  }

  async function mutate(action: Exclude<PendingAction, 'load' | 'add' | null>, init: RequestInit, success: string) {
    setPending(action);
    setError('');
    try {
      const next = await requestAIKeys(init);
      setData(next);
      toast.success(success);
      return next;
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      return null;
    } finally {
      setPending(null);
    }
  }

  async function loadModels(keyId: string) {
    setModelsLoading(true);
    setModelError('');
    try {
      setModels(await requestAIModels(keyId));
    } catch (requestError) {
      setModels(null);
      setModelError(getErrorMessage(requestError));
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleSelectModel(model: string) {
    const activeId = data?.activeId;
    if (!activeId || !model.trim()) return;
    const next = await mutate(
      'model',
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'select-model', id: activeId, model }),
      },
      `已切换模型为「${model.trim()}」`,
    );
    if (next) {
      setManualModel(next.activeModel || model.trim());
      setCapabilities(null);
    }
  }

  async function handleUpdateBaseURL(event: React.FormEvent) {
    event.preventDefault();
    const activeId = data?.activeId;
    if (!activeId || !activeBaseURL.trim() || activeItem?.source === 'environment') return;
    const next = await mutate(
      'base-url',
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update-base-url', id: activeId, baseURL: activeBaseURL }),
      },
      'Base URL 已更新',
    );
    if (next) {
      setActiveBaseURL(next.activeBaseURL || activeBaseURL.trim());
      setModels(null);
      setCapabilities(null);
      void loadModels(activeId);
    }
  }

  async function handleGPTOptimization(enabled: boolean) {
    await handleGPTOptimizationPatch({ enabled });
  }

  async function handleAPIProtocol(apiProtocol: AIKeyItem['apiProtocol']) {
    const activeId = data?.activeId;
    if (!activeId) return;
    const next = await mutate(
      'api-protocol',
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update-api-protocol', id: activeId, apiProtocol }),
      },
      apiProtocol === 'responses'
        ? '已固定使用 Responses API'
        : apiProtocol === 'chat.completions'
          ? '已固定使用 Chat Completions'
          : '已改为自动选择 API 协议',
    );
    if (next) setCapabilities(null);
  }

  async function handleGPTOptimizationPatch(patch: Partial<GPTOptimizationSettings>) {
    const activeId = data?.activeId;
    if (!activeId) return;
    const next = await mutate(
      'gpt-optimization',
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update-gpt-optimization', id: activeId, ...patch }),
      },
      patch.enabled === true ? '已开启 GPT 专项优化'
        : patch.enabled === false ? '已关闭 GPT 专项优化'
          : 'GPT 专项设置已更新',
    );
    if (next) setCapabilities(null);
  }

  async function handleProjectGPTOptimization(next: ProjectGPTOptimizationConfig) {
    if (!projectId) return;
    setPending('gpt-optimization');
    setError('');
    try {
      await updateProjectGPTOptimization(projectId, next);
      setProjectGPTOptimization(next);
      toast.success(next.mode === 'inherit' ? '当前项目已改为继承全局设置' : '当前项目的 GPT 设置已保存');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function handleProbeCapabilities() {
    const activeId = data?.activeId;
    if (!activeId) return;
    setCapabilitiesLoading(true);
    setError('');
    try {
      setCapabilities(await requestGPTCapabilities(activeId));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setCapabilitiesLoading(false);
    }
  }

  function beginRename(item: AIKeyItem) {
    setEditingId(item.id);
    setEditingName(item.name);
    setError('');
  }

  function resetSecretForm() {
    setName('');
    setApiKey('');
    setShowKey(false);
  }

  const isBusy = pending !== null;
  const activeItem = data?.items.find(item => item.active) ?? null;
  const activeGPTOptimization = activeItem?.gptOptimization ?? {
    enabled: false,
    useResponsesAPI: true,
    allowChatFallback: true,
    reasoningProfile: 'auto' as const,
    creativeFreedom: 'balanced' as const,
    internalImageSearch: true,
  };
  const modelOptions = models?.models ?? [];
  const currentModelListed = Boolean(data?.activeModel && modelOptions.some(model => model.id === data.activeModel));
  const buttonLabel = data?.configured && data.activeName
    ? `${data.activeName}${data.activeModel ? ` · ${data.activeModel}` : ''}`
    : 'Key 管理';

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {!hideTrigger ? <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-48 gap-1.5">
            <KeyRound className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{buttonLabel}</span>
          </Button>
        </DialogTrigger> : null}
        <DialogContent className="flex h-[92dvh] max-h-[860px] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12 sm:px-6 sm:py-5">
            <DialogTitle className="flex items-center gap-2.5 text-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-[18px] w-[18px]" />
              </span>
              API Key 管理
            </DialogTitle>
            <DialogDescription className="pl-0 sm:pl-[46px]">
              管理账号、连接与模型。切换只影响新任务，正在运行的任务不会改变。
            </DialogDescription>
          </DialogHeader>

          {pending === 'load' ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取 Key 配置…
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[280px_minmax(0,1fr)] md:overflow-hidden">
              <aside className="border-b bg-white p-4 md:overflow-y-auto md:border-b-0 md:border-r md:p-5" aria-label="已保存的 Key">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">API 账号</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{data?.items.length || 0} 个可用配置</p>
                  </div>
                  {data?.configured ? <span className="h-2 w-2 rounded-full bg-emerald-500" title="已配置" /> : null}
                </div>

                {data?.items.length ? (
                  <div className="space-y-1.5">
                    {data.items.map(item => (
                      <KeyRow
                        key={item.id}
                        item={item}
                        busy={isBusy}
                        editing={editingId === item.id}
                        editingName={editingName}
                        onEditingNameChange={setEditingName}
                        onActivate={() => handleActivate(item)}
                        onBeginRename={() => beginRename(item)}
                        onCancelRename={() => setEditingId(null)}
                        onRename={event => handleRename(event, item)}
                        onDelete={() => setDeleteTarget(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    暂无可用 Key
                  </div>
                )}

                <details
                  className="group mt-4 overflow-hidden rounded-lg border bg-slate-50/70"
                  open={addExpanded || !data?.items.length}
                  onToggle={event => setAddExpanded(event.currentTarget.open)}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-slate-800 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" />添加新 Key</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <form className="space-y-3 border-t bg-white p-3" onSubmit={handleAdd}>
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-key-name">名称</Label>
                      <Input id="ai-key-name" value={name} onChange={event => setName(event.target.value)} placeholder="例如：工作账号" maxLength={50} autoComplete="off" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-key-secret">API Key</Label>
                      <div className="relative">
                        <Input id="ai-key-secret" type={showKey ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="输入 API Key" className="pr-10" autoComplete="new-password" />
                        <button type="button" onClick={() => setShowKey(value => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-key-base-url">Base URL</Label>
                      <Input id="ai-key-base-url" type="url" value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://api.openai.com/v1" autoComplete="url" />
                    </div>
                    <Button type="submit" size="sm" className="w-full" disabled={isBusy || !name.trim() || !apiKey.trim() || !baseURL.trim()}>
                      {pending === 'add' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      添加并切换
                    </Button>
                  </form>
                </details>
              </aside>

              <main className="space-y-4 bg-slate-50/50 p-4 md:overflow-y-auto md:p-5 lg:p-6">
                {activeItem ? (
                  <>
                    <section className="border-b border-slate-200 pb-5" aria-label="当前激活的 Key">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            当前激活
                          </div>
                          <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-950">{activeItem.name}</h2>
                        </div>
                        <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                          <SummaryValue label="模型" value={activeItem.selectedModel} mono />
                          <SummaryValue label="接口" value={formatHost(activeItem.baseURL)} mono />
                          <SummaryValue label="来源" value={activeItem.source === 'environment' ? '环境变量' : '本机保存'} />
                        </div>
                      </div>
                    </section>

                    <DisclosureSection icon={<Server className="h-4 w-4" />} title="连接与模型" description="配置服务地址与当前账号使用的模型" defaultOpen>
                      <div className="space-y-5">
                        <form className="space-y-2" onSubmit={handleUpdateBaseURL}>
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="active-ai-base-url">Base URL</Label>
                            {activeItem.source === 'environment' ? <span className="text-xs text-muted-foreground">环境变量，只读</span> : null}
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input id="active-ai-base-url" type="url" value={activeBaseURL} onChange={event => setActiveBaseURL(event.target.value)} placeholder="https://api.openai.com/v1" readOnly={activeItem.source === 'environment'} aria-label="当前 Key 的 Base URL" autoComplete="url" />
                            {activeItem.source === 'saved' ? (
                              <Button type="submit" variant="secondary" className="sm:flex-shrink-0" disabled={pending === 'base-url' || !activeBaseURL.trim() || activeBaseURL.trim().replace(/\/+$/, '') === activeItem.baseURL}>
                                {pending === 'base-url' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}保存地址
                              </Button>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">模型列表和之后的新任务都会请求这个地址。</p>
                        </form>

                        <div className="space-y-2 border-t pt-4">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="ai-model-select">API 返回的模型</Label>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{modelsLoading ? '正在读取…' : models ? `可用模型 ${models.count} 个` : '可手动输入'}</span>
                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => loadModels(activeItem.id)} disabled={modelsLoading || pending === 'model'}>
                                <RefreshCw className={`mr-1 h-3 w-3 ${modelsLoading ? 'animate-spin' : ''}`} />刷新
                              </Button>
                            </div>
                          </div>
                          <select id="ai-model-select" value={data?.activeModel || ''} onChange={event => handleSelectModel(event.target.value)} disabled={modelsLoading || pending === 'model' || modelOptions.length === 0} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                            {!currentModelListed && data?.activeModel ? <option value={data.activeModel}>{data.activeModel} · 当前配置</option> : null}
                            {modelOptions.map(model => <option key={model.id} value={model.id}>{formatModelLabel(model)}</option>)}
                          </select>
                        </div>

                        <form className="space-y-2" onSubmit={event => { event.preventDefault(); void handleSelectModel(manualModel); }}>
                          <Label htmlFor="manual-ai-model">手动模型 ID</Label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input id="manual-ai-model" value={manualModel} onChange={event => setManualModel(event.target.value)} placeholder="网关未返回模型时手动填写" aria-label="手动模型 ID" maxLength={200} />
                            <Button type="submit" variant="secondary" className="sm:flex-shrink-0" disabled={pending === 'model' || !manualModel.trim() || manualModel.trim() === data?.activeModel}>
                              {pending === 'model' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}保存模型
                            </Button>
                          </div>
                        </form>

                        <div className="space-y-2 border-t pt-4">
                          <Label htmlFor="ai-api-protocol">API 协议</Label>
                          <select
                            id="ai-api-protocol"
                            aria-label="当前 Key 的 API 协议"
                            value={activeItem.apiProtocol ?? 'auto'}
                            onChange={event => void handleAPIProtocol(event.target.value as AIKeyItem['apiProtocol'])}
                            disabled={pending === 'api-protocol'}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="auto">自动（兼容旧配置）</option>
                            <option value="responses">Responses API</option>
                            <option value="chat.completions">Chat Completions</option>
                          </select>
                          <p className="text-xs leading-5 text-muted-foreground">
                            按中转站声明的接口格式选择。协议与 GPT 创作优化相互独立；不确定时保留自动。
                          </p>
                        </div>

                        {modelError ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{modelError}。当前仍使用 <span className="font-mono">{data?.activeModel}</span>，也可以手动输入模型 ID。</p> : null}
                      </div>
                    </DisclosureSection>

                    <DisclosureSection icon={<SlidersHorizontal className="h-4 w-4" />} title="GPT 专项能力" description="Responses API、结构化输出与兼容回退" trailing={activeGPTOptimization.enabled ? '已开启' : '未开启'}>
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3">
                          <div>
                            <h3 className="text-sm font-medium text-slate-900">GPT 专项优化</h3>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">仅作用于 GPT：可独立控制推理深度、创作自由度和程序内部搜图。</p>
                          </div>
                          <ToggleSwitch checked={activeGPTOptimization.enabled} onChange={() => handleGPTOptimization(!activeGPTOptimization.enabled)} disabled={pending === 'gpt-optimization'} label="GPT 专项优化" />
                        </div>
                        {activeGPTOptimization.enabled ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-2">
                              <GPTSelect
                                label="GPT 推理深度"
                                value={activeGPTOptimization.reasoningProfile}
                                disabled={pending === 'gpt-optimization'}
                                onChange={reasoningProfile => void handleGPTOptimizationPatch({ reasoningProfile })}
                                options={REASONING_OPTIONS}
                              />
                              <GPTSelect
                                label="GPT 创作自由度"
                                value={activeGPTOptimization.creativeFreedom}
                                disabled={pending === 'gpt-optimization'}
                                onChange={creativeFreedom => void handleGPTOptimizationPatch({ creativeFreedom })}
                                options={CREATIVE_OPTIONS}
                              />
                              <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 sm:col-span-2">
                                <div>
                                  <p className="text-xs font-medium text-slate-800">GPT 内部搜图能力</p>
                                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">GPT 提出搜索动作，程序负责检索、缓存、来源检查和下载。</p>
                                </div>
                                <ToggleSwitch
                                  checked={activeGPTOptimization.internalImageSearch}
                                  onChange={() => void handleGPTOptimizationPatch({ internalImageSearch: !activeGPTOptimization.internalImageSearch })}
                                  disabled={pending === 'gpt-optimization'}
                                  label="GPT 内部搜图能力"
                                />
                              </div>
                            </div>

                            {projectId ? (
                              <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold text-slate-900">当前项目设置</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">覆盖只写入当前项目，不影响其他项目或 DeepSeek。</p>
                                  </div>
                                  <select
                                    aria-label="当前项目 GPT 设置模式"
                                    value={projectGPTOptimization.mode}
                                    disabled={pending === 'gpt-optimization'}
                                    onChange={event => void handleProjectGPTOptimization(event.target.value === 'override'
                                      ? {
                                        mode: 'override',
                                        reasoningProfile: activeGPTOptimization.reasoningProfile,
                                        creativeFreedom: activeGPTOptimization.creativeFreedom,
                                        internalImageSearch: activeGPTOptimization.internalImageSearch,
                                      }
                                      : { mode: 'inherit' })}
                                    className="h-8 rounded-md border border-input bg-white px-2 text-xs"
                                  >
                                    <option value="inherit">继承全局</option>
                                    <option value="override">项目覆盖</option>
                                  </select>
                                </div>
                                {projectGPTOptimization.mode === 'override' ? (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <GPTSelect
                                      label="项目推理深度"
                                      value={projectGPTOptimization.reasoningProfile ?? activeGPTOptimization.reasoningProfile}
                                      disabled={pending === 'gpt-optimization'}
                                      onChange={reasoningProfile => void handleProjectGPTOptimization({ ...projectGPTOptimization, reasoningProfile })}
                                      options={REASONING_OPTIONS}
                                    />
                                    <GPTSelect
                                      label="项目创作自由度"
                                      value={projectGPTOptimization.creativeFreedom ?? activeGPTOptimization.creativeFreedom}
                                      disabled={pending === 'gpt-optimization'}
                                      onChange={creativeFreedom => void handleProjectGPTOptimization({ ...projectGPTOptimization, creativeFreedom })}
                                      options={CREATIVE_OPTIONS}
                                    />
                                    <div className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 sm:col-span-2">
                                      <span className="text-xs font-medium text-slate-800">项目内部搜图</span>
                                      <ToggleSwitch
                                        checked={projectGPTOptimization.internalImageSearch ?? activeGPTOptimization.internalImageSearch}
                                        onChange={() => void handleProjectGPTOptimization({
                                          ...projectGPTOptimization,
                                          internalImageSearch: !(projectGPTOptimization.internalImageSearch ?? activeGPTOptimization.internalImageSearch),
                                        })}
                                        disabled={pending === 'gpt-optimization'}
                                        label="项目内部搜图"
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                              <CapabilityItem label="Responses API" value="开启" />
                              <CapabilityItem label="联网研究" value="Tavily" />
                              <CapabilityItem label="Chat 回退" value="允许" />
                              <CapabilityItem label="内部搜图" value={activeGPTOptimization.internalImageSearch ? '开启' : '关闭'} />
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={handleProbeCapabilities} disabled={capabilitiesLoading}>
                              {capabilitiesLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}检测中转站能力
                            </Button>
                            {capabilities ? (
                              <div className="rounded-lg border bg-white px-3 py-2 text-xs leading-5 text-slate-700">
                                <p>实际模型：<span className="font-mono">{capabilities.actualModel || '接口未返回'}</span></p>
                                <p>Responses：{formatCapability(capabilities.responses)}</p>
                                <p>结构化输出：{formatCapability(capabilities.structuredOutput)}</p>
                                <p>联网研究：Tavily（不检测中转站搜索）</p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </DisclosureSection>

                    <DisclosureSection icon={<Cpu className="h-4 w-4" />} title="API 对话测试" description="快速验证当前 Key、模型与连续对话响应" trailing="按需展开">
                      <AIAPIChat key={activeItem.id} keyId={activeItem.id} keyName={activeItem.name} model={activeItem.selectedModel} embedded />
                    </DisclosureSection>
                  </>
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-white px-6 text-center">
                    <KeyRound className="h-8 w-8 text-slate-300" />
                    <h2 className="mt-3 text-base font-semibold">还没有当前 Key</h2>
                    <p className="mt-1 text-sm text-muted-foreground">请从左侧添加一个 API Key 开始配置。</p>
                  </div>
                )}

                {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              </main>
            </div>
          )}

          <footer className="flex items-center gap-2 border-t bg-white px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            Key 以明文保存在本机 data/settings，仅适合个人单机使用；请勿共享该目录。
          </footer>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={next => {
        if (!next && pending !== 'delete') setDeleteTarget(null);
      }}>
        <DialogContent className="max-w-md" hideClose={pending === 'delete'}>
          <DialogHeader>
            <DialogTitle>确认删除 Key？</DialogTitle>
            <DialogDescription>
              将删除「{deleteTarget?.name}」。如果它正在使用，程序会自动切换到环境变量 Key 或剩余的第一个 Key。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending === 'delete'}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={pending === 'delete'}>
              {pending === 'delete' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const REASONING_OPTIONS = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'fast', label: '快速' },
  { value: 'balanced', label: '平衡' },
  { value: 'quality', label: '深度' },
] as const;

const CREATIVE_OPTIONS = [
  { value: 'conservative', label: '保守' },
  { value: 'balanced', label: '平衡（推荐）' },
  { value: 'open', label: '开放' },
] as const;

function GPTSelect<T extends string>({
  label,
  value,
  disabled,
  onChange,
  options,
}: {
  label: string;
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-800">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value as T)}
        className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function KeyRow({
  item,
  busy,
  editing,
  editingName,
  onEditingNameChange,
  onActivate,
  onBeginRename,
  onCancelRename,
  onRename,
  onDelete,
}: {
  item: AIKeyItem;
  busy: boolean;
  editing: boolean;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onActivate: () => void;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onRename: (event: React.FormEvent) => void;
  onDelete: () => void;
}) {
  if (editing) {
    return (
      <form className="space-y-2 rounded-lg border bg-white p-2.5" onSubmit={onRename}>
        <Input
          value={editingName}
          onChange={event => onEditingNameChange(event.target.value)}
          maxLength={50}
          autoFocus
          aria-label="新的 Key 名称"
        />
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancelRename} disabled={busy}>取消</Button>
          <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={busy || !editingName.trim()}>保存</Button>
        </div>
      </form>
    );
  }

  return (
    <div className={`group relative flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${item.active ? 'border-primary/40 bg-primary/[0.06] shadow-sm' : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'}`}>
      {item.active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" /> : null}
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={onActivate}
        disabled={busy || item.active}
        aria-label={item.active ? `${item.name}，当前使用` : `切换到 ${item.name}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-900">{item.name}</span>
          {item.active ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary"><Check className="h-3 w-3" />当前</span>
          ) : null}
          {item.source === 'environment' ? (
            <span className="text-[10px] text-slate-500">只读</span>
          ) : null}
        </span>
        <span className="mt-1 block truncate font-mono text-[11px] text-slate-600">{item.selectedModel}</span>
        <span className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
          <span>{item.maskedKey}</span><span aria-hidden="true">·</span><span className="truncate">{formatHost(item.baseURL)}</span>
        </span>
      </button>
      {item.source === 'saved' ? (
        <div className="flex flex-shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onBeginRename} disabled={busy} title="重命名">
            <Pencil className="h-3.5 w-3.5 text-slate-500" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={busy} title="删除">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DisclosureSection({
  icon,
  title,
  description,
  trailing,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <details
      className="group overflow-hidden rounded-xl border bg-white shadow-sm"
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        {trailing ? <span className="hidden text-xs text-muted-foreground sm:block">{trailing}</span> : null}
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}

function SummaryValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 max-w-[10rem] truncate text-xs font-medium text-slate-800 ${mono ? 'font-mono' : ''}`} title={value}>{value}</p>
    </div>
  );
}

function CapabilityItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? 'bg-primary' : 'bg-slate-300'} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function formatHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

async function requestAIKeys(init?: RequestInit): Promise<AIKeyList> {
  const response = await fetch('/api/settings/ai-keys', {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Key 管理操作失败');
  return body as AIKeyList;
}

async function requestAIModels(keyId: string): Promise<AvailableAIModelList> {
  const response = await fetch(`/api/settings/ai-models?keyId=${encodeURIComponent(keyId)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || '读取模型列表失败');
  return body as AvailableAIModelList;
}

async function requestGPTCapabilities(keyId: string): Promise<GPTCapabilityReport> {
  const response = await fetch(`/api/settings/ai-capabilities?keyId=${encodeURIComponent(keyId)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'GPT 能力检测失败');
  return body as GPTCapabilityReport;
}

async function requestProjectGPTOptimization(projectId: string): Promise<ProjectGPTOptimizationConfig | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || '读取项目 GPT 设置失败');
  return (body?.gptOptimization ?? null) as ProjectGPTOptimizationConfig | null;
}

async function updateProjectGPTOptimization(projectId: string, value: ProjectGPTOptimizationConfig): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gptOptimization: value }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || '保存项目 GPT 设置失败');
}

function formatCapability(check: { supported: boolean; error?: string }): string {
  return check.supported ? '支持' : `不支持${check.error ? `（${check.error}）` : ''}`;
}

function formatModelLabel(model: AvailableAIModel): string {
  const knownName = model.id === 'deepseek-v4-flash'
    ? 'DeepSeek V4 Flash'
    : model.id === 'deepseek-v4-pro'
      ? 'DeepSeek V4 Pro'
      : model.id;
  return model.ownedBy && model.ownedBy !== 'unknown'
    ? `${knownName} · ${model.ownedBy}`
    : knownName;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Key 管理操作失败';
}
