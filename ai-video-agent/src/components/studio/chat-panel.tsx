'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Image, Loader2, Mic, Palette, Plus, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessageBubble } from '@/components/chat/chat-message';
import { AssetAttachmentList } from '@/components/chat/asset-attachments/asset-attachment-list';
import { ContextChip } from '@/components/chat/context-chip';
import { StylePickerDialog } from '@/components/style-picker/style-picker-dialog';
import { TtsProviderDialog } from '@/components/tts-provider/tts-provider-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFrameGenerationController } from './frame-generation-context';
import { getCollaborationState } from '@/lib/collaboration';
import { getFrameSourceForOutlineFrame, isFrameSourceComplete } from '@/lib/video-source';
import { getStyleById } from '@/lib/styles/presets';
import type { TtsProvider } from '@/lib/tts-provider';
import type { ChangeSetSummary, PlaybackContext, ProjectDetail, ChatMessage, FrameReviewDraft, MessageAction } from '@/types';
import { isFrameVisualComplete } from '@/lib/scene-contract';
import { useStudioStore } from '@/stores/studio-store';

const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  none: '无',
  edge: 'Edge',
  tencent: '腾讯云',
  indextts: 'IndexTTS',
};

const CHAT_INPUT_MIN_HEIGHT = 72;
const CHAT_INPUT_MAX_HEIGHT_RATIO = 0.4;

interface ChatPanelProps {
  project: ProjectDetail;
  messages: ChatMessage[];
  onMessagesChange: (m: ChatMessage[]) => void;
  onProjectChange: (p: ProjectDetail) => void;
}

interface ActionConversation {
  userText: string;
  assistantText: string;
  assistantActions?: MessageAction[];
}

interface SendOptions {
  rewriteDraft?: FrameReviewDraft;
}

interface PendingChangeSetRegeneration {
  projectUpdatedAt: string;
  frameIds: string[];
}

interface AgentRunView {
  id: string;
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'partial_failed' | 'failed' | 'cancelled' | 'interrupted';
  summary?: { errorMessage?: string; retryable?: boolean } | null;
}

class AgentRunExecutionError extends Error {
  constructor(message: string, readonly run: AgentRunView) {
    super(message);
    this.name = 'AgentRunExecutionError';
  }
}

export function ChatPanel({ project, messages, onMessagesChange, onProjectChange }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [ttsProviderOpen, setTtsProviderOpen] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<TtsProvider | null>(null);
  const [ttsLoadFailed, setTtsLoadFailed] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [pendingChangeSetRegeneration, setPendingChangeSetRegeneration] = useState<PendingChangeSetRegeneration | null>(null);
  const [activeAgentRun, setActiveAgentRun] = useState<AgentRunView | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  const reattachedRunProjectRef = useRef<string | null>(null);
  const qc = useQueryClient();
  const selectedFrameId = useStudioStore(state => state.selectedFrameId);
  const selectedElementIds = useStudioStore(state => state.selectedElementIds);
  const playbackContext = useStudioStore(state => state.playbackContext);
  const {
    start: startFrameGeneration,
    refresh: refreshProject,
    smartImageMode,
    setSmartImageMode,
  } = useFrameGenerationController();
  const ttsLabel = ttsProvider
    ? TTS_PROVIDER_LABELS[ttsProvider]
    : ttsLoadFailed ? '读取失败' : '读取中…';
  const freeOutlineMissingFrames = project.workflow === 'gpt-free'
    && Boolean(project.outline)
    && project.outline!.frames.length === 0;

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings/tts')
      .then(async response => {
        if (!response.ok) throw new Error('读取 TTS 设置失败');
        return response.json() as Promise<{ provider: TtsProvider }>;
      })
      .then(({ provider }) => {
        if (cancelled) return;
        setTtsProvider(provider);
        setTtsLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setTtsLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (project.briefStatus === 'empty' || reattachedRunProjectRef.current === project.uuid) return;
    reattachedRunProjectRef.current = project.uuid;
    let cancelled = false;
    void fetch(`/api/projects/${project.uuid}/agent-runs`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as { run?: AgentRunView | null };
        if (!response.ok || !data.run || cancelled) return;
        if (['queued', 'running', 'cancelling'].includes(data.run.status)) {
          const completed = await pollAgentRun(project.uuid, data.run, run => {
            if (!cancelled) setActiveAgentRun(run);
          }, () => cancelled);
          if (cancelled) return;
          setActiveAgentRun(null);
          if (completed.status === 'completed') {
            const refreshed = await fetchProjectWithMessages(project.uuid);
            if (cancelled) return;
            replaceMessages(normalizeProjectMessages(refreshed.messages, project.uuid));
            onProjectChange(refreshed);
            return;
          }
          appendRunRecoveryMessage(completed);
          return;
        }
        appendRunRecoveryMessage(data.run);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project.briefStatus, project.uuid]);

  useEffect(() => {
    if (!pendingChangeSetRegeneration || project.updatedAt !== pendingChangeSetRegeneration.projectUpdatedAt) return;
    const frameIds = pendingChangeSetRegeneration.frameIds.filter(frameId => project.outline?.frames.some(frame => frame.id === frameId));
    setPendingChangeSetRegeneration(null);
    if (!frameIds.length) return;
    void startFrameGeneration(frameIds, {
      smartImages: smartImageMode !== 'off',
      smartImageMode,
    })
      .then(result => appendAssistantText(generationResultMessage(result, `${frameIds.length} 个受影响镜头`)))
      .catch(error => appendActionErrorMessage(error));
  }, [pendingChangeSetRegeneration, project, smartImageMode, startFrameGeneration]);

  // Keep the latest chat content visible, including replacements of pending messages.
  useLayoutEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const maxHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      Math.floor((panelRef.current?.clientHeight ?? CHAT_INPUT_MIN_HEIGHT) * CHAT_INPUT_MAX_HEIGHT_RATIO),
    );
    textarea.style.height = 'auto';
    const nextHeight = Math.max(CHAT_INPUT_MIN_HEIGHT, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  const sendMut = useMutation({
    mutationFn: async ({ content, options, selectedAttachmentIds }: { content: string; options?: SendOptions; selectedAttachmentIds: string[] }) => {
      if (project.briefStatus !== 'empty') {
        const response = await fetch(`/api/projects/${project.uuid}/agent-runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            content,
            attachmentIds: selectedAttachmentIds,
            context: currentActionContext(selectedFrameId, selectedElementIds, playbackContext),
            rewriteDraft: options?.rewriteDraft,
          }),
        });
        const created = await response.json().catch(() => ({})) as { run?: AgentRunView; error?: string; activeRunId?: string };
        if (!response.ok || !created.run) throw new Error(created.error || '创建任务失败');
        const run = await pollAgentRun(project.uuid, created.run, setActiveAgentRun);
        if (run.status !== 'completed') {
          throw new AgentRunExecutionError(agentRunFailureMessage(run), run);
        }
        const refreshed = await fetchProjectWithMessages(project.uuid);
        return { mode: 'persistent' as const, project: refreshed, messages: refreshed.messages };
      }
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: project.uuid,
          content,
          attachmentIds: selectedAttachmentIds,
          context: currentActionContext(selectedFrameId, selectedElementIds, playbackContext),
          rewriteDraft: options?.rewriteDraft,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '请求失败');
      }
      const data = await res.json() as {
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        assistantMessages?: ChatMessage[];
        project: ProjectDetail;
      };
      return { mode: 'legacy' as const, ...data };
    },
    onError: e => toast.error((e as Error).message),
    onSettled: () => setActiveAgentRun(null),
  });

  async function handleSend(overrideText?: string, options?: SendOptions) {
    const enteredText = (overrideText ?? input).trim();
    const text = enteredText || (attachmentIds.length ? '请根据这些资料帮我规划一条视频。' : '');
    if (!text || sendMut.isPending || attachmentsBusy) return;
    const selectedAttachmentIds = [...attachmentIds];

    const now = new Date().toISOString();
    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const optimisticUser: ChatMessage = {
      id: tempUserId,
      projectId: project.uuid,
      role: 'user',
      content: text,
      metadata: { kind: 'text' },
      createdAt: now,
    };
    const optimisticAssistant: ChatMessage = {
      id: tempAssistantId,
      projectId: project.uuid,
      role: 'assistant',
      content: getPendingMessage(text),
      metadata: { kind: 'pending', stage: getPendingStage(text) },
      createdAt: now,
    };

    onMessagesChange([...messagesRef.current, optimisticUser, optimisticAssistant]);
    if (!overrideText) setInput('');

    try {
      const data = await sendMut.mutateAsync({ content: text, options, selectedAttachmentIds });
      if (data.mode === 'persistent') {
        replaceMessages(normalizeProjectMessages(data.messages, project.uuid));
        onProjectChange(data.project);
        setAttachmentIds([]);
        qc.invalidateQueries({ queryKey: ['projects'] });
        return;
      }
      const assistantMessages = data.assistantMessages?.length ? data.assistantMessages : [data.assistantMessage];
      let insertedAssistantMessages = false;
      const nextMessages = messagesRef.current.map(message => {
        if (message.id === tempUserId) return data.userMessage;
        if (message.id === tempAssistantId) {
          insertedAssistantMessages = true;
          return assistantMessages;
        }
        return message;
      }).flat();
      if (!insertedAssistantMessages) nextMessages.push(...assistantMessages);
      onMessagesChange(nextMessages);
      onProjectChange(data.project);
      setAttachmentIds([]);
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      if (e instanceof AgentRunExecutionError) {
        const refreshed = await fetchProjectWithMessages(project.uuid).catch(() => null);
        const persistedMessages = refreshed ? normalizeProjectMessages(refreshed.messages, project.uuid) : messagesRef.current.filter(
          message => message.id !== tempUserId && message.id !== tempAssistantId,
        );
        if (refreshed) onProjectChange(refreshed);
        const actionId = e.run.status === 'interrupted' ? 'agent_run_resume' : 'agent_run_retry';
        const errorMessage: ChatMessage = {
          id: `temp-run-error-${Date.now()}`,
          projectId: project.uuid,
          role: 'assistant',
          content: '',
          metadata: {
            kind: 'error',
            message: e.message,
            actions: [{ id: actionId, label: actionId === 'agent_run_resume' ? '恢复任务' : '重试任务', runId: e.run.id, variant: 'outline' }],
          },
          createdAt: new Date().toISOString(),
        };
        replaceMessages([...persistedMessages, errorMessage]);
        return;
      }
      const reverted = messagesRef.current.filter(
        message => message.id !== tempUserId && message.id !== tempAssistantId,
      );
      const errorMessage: ChatMessage = {
        id: `temp-error-${Date.now()}`,
        projectId: project.uuid,
        role: 'assistant',
        content: '',
        metadata: { kind: 'error', message: (e as Error).message || '请求失败' },
        createdAt: new Date().toISOString(),
      };
      onMessagesChange([...reverted, errorMessage]);
    }
  }

  function replaceMessages(nextMessages: ChatMessage[]) {
    messagesRef.current = nextMessages;
    onMessagesChange(nextMessages);
  }

  function appendRunRecoveryMessage(run: AgentRunView) {
    if (messagesRef.current.some(message => message.metadata?.kind === 'agent_run' && message.metadata.runId === run.id)) return;
    const actionId = run.status === 'interrupted' ? 'agent_run_resume' : 'agent_run_retry';
    const message: ChatMessage = {
      id: `local-agent-run-${run.id}`,
      projectId: project.uuid,
      role: 'assistant',
      content: '',
      metadata: {
        kind: 'agent_run',
        runId: run.id,
        status: run.status,
        actions: [{ id: actionId, label: actionId === 'agent_run_resume' ? '继续上次任务' : '重试任务', runId: run.id, variant: 'outline' }],
      },
      createdAt: new Date().toISOString(),
    };
    replaceMessages([...messagesRef.current, message]);
  }

  async function appendAssistantText(content: string) {
    const tempId = `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticAssistant: ChatMessage = {
      id: tempId,
      projectId: project.uuid,
      role: 'assistant',
      content,
      metadata: { kind: 'text' },
      createdAt: new Date().toISOString(),
    };
    replaceMessages([...messagesRef.current, optimisticAssistant]);

    try {
      const res = await fetch(`/api/projects/${project.uuid}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'assistant', content, metadata: { kind: 'text' } },
          ],
        }),
      });
      const data = await res.json().catch(() => ({})) as { messages?: ChatMessage[]; error?: string };
      if (!res.ok || !data.messages?.[0]) throw new Error(data.error || '写入消息失败');
      replaceMessages(messagesRef.current.map(message => message.id === tempId ? data.messages![0] : message));
    } catch (error) {
      toast.error((error as Error).message || '写入消息失败');
    }
  }

  async function appendActionMessages(action: MessageAction) {
    const conversation = getActionConversationForAction(action, project);
    const now = new Date().toISOString();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempUserId = `temp-action-user-${token}`;
    const tempAssistantId = `temp-action-assistant-${token}`;
    const optimisticUser: ChatMessage = {
      id: tempUserId,
      projectId: project.uuid,
      role: 'user',
      content: conversation.userText,
      metadata: { kind: 'text' },
      createdAt: now,
    };
    const optimisticAssistant: ChatMessage = {
      id: tempAssistantId,
      projectId: project.uuid,
      role: 'assistant',
      content: conversation.assistantText,
      metadata: { kind: 'text', actions: conversation.assistantActions },
      createdAt: now,
    };

    replaceMessages([...messagesRef.current, optimisticUser, optimisticAssistant]);

    try {
      const res = await fetch(`/api/projects/${project.uuid}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: conversation.userText, metadata: { kind: 'text' } },
            { role: 'assistant', content: conversation.assistantText, metadata: { kind: 'text', actions: conversation.assistantActions } },
          ],
        }),
      });
      const data = await res.json().catch(() => ({})) as { messages?: ChatMessage[]; error?: string };
      if (!res.ok || !data.messages?.length) {
        throw new Error(data.error || '写入消息失败');
      }

      replaceMessages(messagesRef.current.map(message => {
        if (message.id === tempUserId) return data.messages![0];
        if (message.id === tempAssistantId) return data.messages![1];
        return message;
      }));
    } catch (error) {
      const reverted = messagesRef.current.filter(
        message => message.id !== tempUserId && message.id !== tempAssistantId,
      );
      const errorMessage: ChatMessage = {
        id: `temp-action-error-${Date.now()}`,
        projectId: project.uuid,
        role: 'assistant',
        content: '',
        metadata: { kind: 'error', message: (error as Error).message || '写入消息失败' },
        createdAt: new Date().toISOString(),
      };
      replaceMessages([...reverted, errorMessage]);
      throw error;
    }
  }

  async function appendActionErrorMessage(error: unknown) {
    const message = (error as Error).message || '操作失败';
    const optimisticError: ChatMessage = {
      id: `temp-action-error-${Date.now()}`,
      projectId: project.uuid,
      role: 'assistant',
      content: '',
      metadata: { kind: 'error', message },
      createdAt: new Date().toISOString(),
    };
    replaceMessages([...messagesRef.current, optimisticError]);

    try {
      const res = await fetch(`/api/projects/${project.uuid}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'assistant', content: '', metadata: { kind: 'error', message } },
          ],
        }),
      });
      const data = await res.json().catch(() => ({})) as { messages?: ChatMessage[] };
      if (!res.ok || !data.messages?.[0]) return;
      replaceMessages(messagesRef.current.map(item => (
        item.id === optimisticError.id ? data.messages![0] : item
      )));
    } catch {
      // Keep the local error visible even if persistence fails.
    }
  }

  async function handleMessageAction(action: MessageAction) {
    if (action.disabled) return;
    if (action.id === 'brief_edit') {
      setInput('请把创作方案调整为：');
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (action.id === 'brief_confirm' || action.id === 'brief_ai_decide' || action.id === 'brief_clarify') {
      await handleSend(action.label);
      return;
    }
    if (action.id === 'diagnosis_recommend' || action.id === 'diagnosis_light' || action.id === 'diagnosis_redesign') {
      await proposeChangeSet(action);
      return;
    }
    if (action.id === 'diagnosis_skip') {
      await appendActionMessages(action);
      return;
    }
    if (action.id === 'change_set_apply') {
      await applyChangeSet(action);
      return;
    }
    if (action.id === 'change_set_revert') {
      await revertChangeSet(action);
      return;
    }
    if (action.id === 'agent_run_retry' || action.id === 'agent_run_resume') {
      await restartAgentRun(action, action.id === 'agent_run_resume' ? 'resume' : 'retry');
      return;
    }
    if (action.id === 'agent_run_cancel') {
      await cancelActiveAgentRun(action.runId);
      return;
    }
    let actionMessagesAppended = false;
    try {
      await appendActionMessages(action);
      actionMessagesAppended = true;

      if (action.id === 'open_style_picker') {
        setStylePickerOpen(true);
        return;
      }
      if (action.id === 'open_tts_provider') {
        setTtsProviderOpen(true);
        return;
      }
      if (action.id === 'approve_plan') {
        await approvePlanAndGenerateVideo();
        return;
      }
      if (action.id === 'approve_frame') {
        await approveFrame(action.frameId);
        return;
      }
      if (action.id === 'generate_sample') {
        if (!ensurePlanApproved()) return;
        if (action.forceVisual && project.outline?.visualAnchor?.approvedFrameIds.length) {
          throw new Error('主题风格已确认，不能重新生成首镜');
        }
        const firstFrame = project.outline?.frames[0];
        if (!firstFrame) throw new Error('请先生成视频大纲');
        const result = await startFrameGeneration([firstFrame.id], {
          sampleOnly: project.type === 'html',
          forceVisual: action.forceVisual,
          smartImages: smartImageMode !== 'off',
          smartImageMode,
        });
        await appendAssistantText(generationResultMessage(result, '首镜样片'));
        return;
      }
      if (action.id === 'confirm_visual_anchor') {
        await confirmVisualAnchor();
        return;
      }
      if (action.id === 'generate_all') {
        if (!ensurePlanApproved()) return;
        if (!project.outline) throw new Error('请先生成视频大纲');
        const pending = getPendingFrameIds(project);
        if (!pending.length) {
          toast.success('所有分镜已生成完毕');
          await appendAssistantText('所有分镜的画面和旁白都已经生成完成。');
          return;
        }
        const firstFrame = project.outline.frames[0];
        const firstSource = getFrameSourceForOutlineFrame(project.videoSource, firstFrame?.id, 0);
        const shouldConfirmOptionalFirstFrame = project.workflow === 'gpt-free'
          && project.gptOptimization?.confirmFirstFrame === true
          && firstFrame !== undefined
          && isFrameVisualComplete(firstSource, project.type, firstFrame)
          && !project.outline.visualAnchor?.approvedFrameIds.includes(firstFrame.id);
        if (shouldConfirmOptionalFirstFrame) {
          await confirmVisualAnchor();
        }
        const result = await startFrameGeneration(pending, {
          smartImages: smartImageMode !== 'off',
          smartImageMode,
        });
        await appendAssistantText(generationResultMessage(result, `${pending.length} 个分镜`));
        return;
      }
      if (action.id === 'regenerate_audio') {
        if (!action.frameId) throw new Error('缺少分镜编号');
        await regenerateAudio(action.frameId);
        return;
      }
      if (action.id === 'export_video') {
        if (getPendingFrameIds(project).length > 0) {
          throw new Error('视频还没生成完成，生成完所有画面和旁白后再导出。');
        }
        toast.message('请在预览区底部点击“导出视频”，系统会创建本地离线渲染任务。');
      }
    } catch (error) {
      toast.error((error as Error).message);
      if (actionMessagesAppended) {
        await appendActionErrorMessage(error);
      }
    }
  }

  async function cancelActiveAgentRun(runId = activeAgentRun?.id) {
    if (!runId || activeAgentRun?.status === 'cancelling') return;
    try {
      const response = await fetch(`/api/projects/${project.uuid}/agent-runs/${runId}/cancel`, { method: 'POST' });
      const data = await response.json().catch(() => ({})) as { run?: AgentRunView; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error || '停止任务失败');
      setActiveAgentRun(data.run);
      toast.message(data.run.status === 'cancelling' ? '正在停止任务…' : agentRunFailureMessage(data.run));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function restartAgentRun(action: MessageAction, mode: 'retry' | 'resume') {
    if (!action.runId || activeAgentRun) return;
    try {
      const response = await fetch(`/api/projects/${project.uuid}/agent-runs/${action.runId}/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
      });
      const data = await response.json().catch(() => ({})) as { run?: AgentRunView; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error || (mode === 'retry' ? '重试任务失败' : '恢复任务失败'));
      const run = await pollAgentRun(project.uuid, data.run, setActiveAgentRun);
      if (run.status !== 'completed') throw new AgentRunExecutionError(agentRunFailureMessage(run), run);
      const refreshed = await fetchProjectWithMessages(project.uuid);
      replaceMessages(normalizeProjectMessages(refreshed.messages, project.uuid));
      onProjectChange(refreshed);
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setActiveAgentRun(null);
    }
  }

  async function proposeChangeSet(action: MessageAction) {
    if (!action.sourceMessageId) throw new Error('导演诊断来源已失效，请重新诊断');
    const intensity = action.id === 'diagnosis_light' ? 'light' : action.id === 'diagnosis_redesign' ? 'redesign' : 'recommended';
    try {
      const res = await fetch(`/api/projects/${project.uuid}/change-sets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceMessageId: action.sourceMessageId, intensity }),
      });
      const data = await res.json().catch(() => ({})) as { messages?: ChatMessage[]; error?: string };
      if (!res.ok || !data.messages?.length) throw new Error(data.error || '生成修改方案失败');
      replaceMessages([...messagesRef.current, ...data.messages]);
    } catch (error) {
      toast.error((error as Error).message);
      await appendActionErrorMessage(error);
    }
  }

  async function applyChangeSet(action: MessageAction) {
    if (!action.changeSetId) throw new Error('修改方案已失效，请重新生成');
    try {
      const res = await fetch(`/api/projects/${project.uuid}/change-sets/${action.changeSetId}/apply`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as {
        changeSet?: ChangeSetSummary;
        project?: ProjectDetail;
        messages?: ChatMessage[];
        error?: string;
      };
      if (!res.ok || !data.changeSet || !data.project || !data.messages?.length) {
        throw new Error(data.error || '应用修改方案失败');
      }
      const nextMessages = messagesRef.current.map(message => {
        if (message.metadata?.kind !== 'change_set' || message.metadata.changeSet.id !== action.changeSetId) return message;
        return {
          ...message,
          metadata: {
            ...message.metadata,
            changeSet: data.changeSet!,
            actions: message.metadata.actions?.map(item => ({ ...item, disabled: true })),
          },
        } as ChatMessage;
      });
      replaceMessages([...nextMessages, ...data.messages]);
      setPendingChangeSetRegeneration({
        projectUpdatedAt: data.project.updatedAt,
        frameIds: data.changeSet.impact.affectedFrameIds,
      });
      onProjectChange(data.project);
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('修改已应用，应用前状态已保存');
    } catch (error) {
      toast.error((error as Error).message);
      await appendActionErrorMessage(error);
    }
  }

  async function revertChangeSet(action: MessageAction, force = false): Promise<void> {
    if (!action.changeSetId) throw new Error('撤销检查点已失效');
    try {
      const res = await fetch(`/api/projects/${project.uuid}/change-sets/${action.changeSetId}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({})) as {
        changeSet?: ChangeSetSummary;
        project?: ProjectDetail;
        messages?: ChatMessage[];
        error?: string;
        requiresConfirmation?: boolean;
      };
      if (!res.ok) {
        if (data.requiresConfirmation && !force) {
          const confirmed = window.confirm(`${data.error || '应用方案后项目还有其他修改。'}\n\n继续会覆盖这些后续修改，确定恢复吗？`);
          if (confirmed) await revertChangeSet(action, true);
          return;
        }
        throw new Error(data.error || '撤销修改失败');
      }
      if (!data.project || !data.messages?.length) throw new Error('撤销结果不完整');
      const nextMessages = messagesRef.current.map(message => {
        if (message.metadata?.kind !== 'checkpoint' || message.metadata.checkpointId !== action.checkpointId) return message;
        return {
          ...message,
          metadata: {
            ...message.metadata,
            canRevert: false,
            actions: message.metadata.actions?.map(item => ({ ...item, disabled: true })),
          },
        } as ChatMessage;
      });
      replaceMessages([...nextMessages, ...data.messages]);
      onProjectChange(data.project);
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('已恢复到这次修改之前');
    } catch (error) {
      toast.error((error as Error).message);
      await appendActionErrorMessage(error);
    }
  }

  async function approvePlanAndGenerateVideo() {
    if (!project.outline) throw new Error('请先生成视频大纲');
    const state = getCollaborationState(project.outline);
    if (!state.planApproved) {
      const res = await fetch('/api/collaboration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.uuid, action: 'approve-plan' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '确认内容计划失败');
    }

    const refreshed = await refreshProject();
    if (refreshed) onProjectChange(refreshed);
    const confirmFirstFrame = project.workflow === 'gpt-free' && project.gptOptimization?.confirmFirstFrame === true;
    const targetFrames = confirmFirstFrame ? project.outline.frames.slice(0, 1) : project.outline.frames;
    toast.success(confirmFirstFrame ? '大纲已确认，开始生成首镜样片' : '大纲已确认，开始生成完整视频');
    const result = await startFrameGeneration(targetFrames.map(frame => frame.id), {
      sampleOnly: confirmFirstFrame,
      smartImages: smartImageMode !== 'off',
      smartImageMode,
    });
    await appendAssistantText(generationResultMessage(result, confirmFirstFrame ? '首镜样片' : '完整视频的画面和旁白'));
  }

  async function approveFrame(frameId?: string) {
    if (!project.outline) throw new Error('请先生成视频大纲');
    if (!frameId) throw new Error('缺少分镜编号');
    const res = await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.uuid, action: 'approve-frame', frameId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '确认分镜内容失败');
    const refreshed = await refreshProject();
    if (refreshed) onProjectChange(refreshed);
    toast.success('内容计划已确认，开始生成这一镜');
    const result = await startFrameGeneration([frameId]);
    await appendAssistantText(generationResultMessage(result, '这一镜'));
  }

  function ensurePlanApproved() {
    const state = getCollaborationState(project.outline);
    if (state.planApproved) return true;
    throw new Error('请先确认内容计划');
  }

  async function confirmVisualAnchor() {
    if (!project.outline) throw new Error('请先生成视频大纲');
    const firstFrame = project.outline.frames[0];
    const firstSource = getFrameSourceForOutlineFrame(project.videoSource, firstFrame?.id, 0);
    if (!firstFrame || !isFrameVisualComplete(firstSource, project.type, firstFrame)) {
      throw new Error('请先生成首镜样片');
    }
    const res = await fetch('/api/visual-anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.uuid, frameIds: [firstFrame.id] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '确认主题风格失败');
    const refreshed = await refreshProject();
    if (refreshed) onProjectChange(refreshed);
    toast.success('主题风格已确认，可以一键生成其余镜头');
    await appendAssistantText('主题风格已确认，后续镜头会继续使用当前主题 Token。');
  }

  async function regenerateAudio(frameId: string) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.uuid, frameId, regen: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '旁白重新生成失败');
    const refreshed = await refreshProject();
    if (refreshed) onProjectChange(refreshed);
    toast.success('旁白已重新生成');
    await appendAssistantText('这一镜的旁白已重新生成完成。');
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b bg-white px-4">
        <span className="text-sm font-medium">AI 对话</span>
        <span className="text-xs text-muted-foreground">{messages.length} 条消息</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {freeOutlineMissingFrames ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">这次自由计划没有生成有效分镜</p>
              <p className="mt-1 text-xs text-amber-800">旧的空大纲不会继续生成。重新生成后仍会先进入现有的内容计划确认。</p>
              <Button className="mt-3" size="sm" onClick={() => void handleSend('重新生成自由计划')}>重新生成自由计划</Button>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center text-sm text-muted-foreground">
              <p className="font-medium">开始创作</p>
              <p className="mt-1 text-xs">输入提示词，例如：</p>
              <p className="mt-1 text-xs italic">"帮我做一个 3 分钟介绍黑洞的视频"</p>
              <p className="mt-1 text-xs italic">"在第 2 镜后面加一个分镜讲讲爱因斯坦"</p>
              <p className="mt-1 text-xs italic">"第 3 镜的旁白里加上年份"</p>
            </div>
          ) : (
            messages.map(m => (
              <ChatMessageBubble
                key={m.id}
                message={m}
                project={project}
                onProjectChange={onProjectChange}
                onAction={handleMessageAction}
                onSendText={handleSend}
                onRewriteDraft={(text, draft) => void handleSend(text, { rewriteDraft: draft })}
                onAppendAssistantText={appendAssistantText}
              />
            ))
          )}
          <div ref={chatEndRef} aria-hidden="true" />
        </div>
      </ScrollArea>

      <div className="flex-shrink-0 border-t bg-slate-50/70 p-3">
        {activeAgentRun ? (
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{activeAgentRun.status === 'cancelling' ? '正在安全停止…' : 'AI 正在处理，点击右侧方形按钮可停止'}</span>
          </div>
        ) : null}
        <div className="rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_5px_18px_rgba(15,23,42,0.07)] transition-shadow duration-200 focus-within:border-slate-300 focus-within:shadow-[0_8px_24px_rgba(15,23,42,0.10)]" role="group" aria-label="消息输入">
          <ContextChip project={project} />
          <AssetAttachmentList
            projectId={project.uuid}
            selectedIds={attachmentIds}
            onSelectedIdsChange={setAttachmentIds}
            onBusyChange={setAttachmentsBusy}
            disabled={sendMut.isPending || Boolean(activeAgentRun)}
          />
          <div className="relative">
          <Textarea
            ref={inputRef}
            value={input}
            disabled={Boolean(activeAgentRun)}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="随心输入"
            className="min-h-[76px] resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-6 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5 pt-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    title="添加创作设置"
                  >
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-64 rounded-[18px] border-slate-200 p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
                  <DropdownMenuLabel className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">创作设置</DropdownMenuLabel>
                  <DropdownMenuItem aria-label={`配音 · ${ttsLabel}`} className="items-start px-2.5 py-2" onSelect={() => setTtsProviderOpen(true)}>
                    <Mic className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm">配音</span>
                      <span className="block truncate text-xs text-muted-foreground">{ttsLabel}</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem aria-label={`视觉风格 · ${getStyleById(project.styleId)?.name ?? '默认'}`} className="items-start px-2.5 py-2" onSelect={() => setStylePickerOpen(true)} disabled={project.type !== 'html'}>
                    <Palette className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm">视觉风格</span>
                      <span className="block truncate text-xs text-muted-foreground">{getStyleById(project.styleId)?.name ?? '默认'}</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-0 my-1.5" />
                  <DropdownMenuLabel className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground"><Image className="size-3.5" />智能配图</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={smartImageMode} onValueChange={value => setSmartImageMode(value as typeof smartImageMode)}>
                    <DropdownMenuRadioItem value="off">关闭</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="fast">快速</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="balanced">平衡</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="asset-priority">素材优先</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="truncate text-xs text-muted-foreground">创作设置</span>
            </div>
            <Button
              size="icon"
              variant={activeAgentRun ? 'destructive' : 'default'}
              className="size-8 rounded-full shadow-none"
              onClick={() => activeAgentRun ? void cancelActiveAgentRun() : void handleSend()}
              disabled={activeAgentRun?.status === 'cancelling' || (!activeAgentRun && ((!input.trim() && attachmentIds.length === 0) || attachmentsBusy))}
              title={activeAgentRun ? '停止任务' : '发送'}
            >
              {activeAgentRun?.status === 'cancelling' ? (
                <Loader2 className="animate-spin" />
              ) : activeAgentRun ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <StylePickerDialog
        open={stylePickerOpen}
        onOpenChange={setStylePickerOpen}
        project={project}
        onProjectChange={onProjectChange}
      />
      <TtsProviderDialog
        open={ttsProviderOpen}
        onOpenChange={setTtsProviderOpen}
        onProviderChange={provider => {
          setTtsProvider(provider);
          setTtsLoadFailed(false);
        }}
      />
    </div>
  );
}

function currentActionContext(
  selectedFrameId: string | null,
  selectedElementIds: string[],
  playbackContext: PlaybackContext,
) {
  return {
    scopeHint: 'auto' as const,
    ...(selectedFrameId ? { selectedFrameId } : {}),
    ...(selectedElementIds.length ? { selectedElementIds } : {}),
    playbackTimeMs: playbackContext.currentTimeMs,
    playbackRevision: playbackContext.playbackRevision,
  };
}

async function pollAgentRun(
  projectId: string,
  initial: AgentRunView,
  onUpdate: (run: AgentRunView) => void,
  isCancelled: () => boolean = () => false,
): Promise<AgentRunView> {
  let run = initial;
  const terminal = new Set(['completed', 'partial_failed', 'failed', 'cancelled', 'interrupted']);
  onUpdate(run);
  while (!terminal.has(run.status)) {
    await new Promise(resolve => window.setTimeout(resolve, 800));
    if (isCancelled()) return run;
    const response = await fetch(`/api/projects/${projectId}/agent-runs/${run.id}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({})) as { run?: AgentRunView; error?: string };
    if (!response.ok || !data.run) throw new Error(data.error || '读取任务进度失败');
    run = data.run;
    onUpdate(run);
  }
  return run;
}

async function fetchProjectWithMessages(projectId: string): Promise<ProjectDetail & { messages: ChatMessage[] }> {
  const response = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({})) as Partial<ProjectDetail> & { messages?: ChatMessage[]; error?: string };
  if (!response.ok || !data.uuid || !data.messages) throw new Error(data.error || '刷新项目失败');
  return {
    ...data,
    hasOutline: Boolean(data.outline),
    messages: data.messages,
  } as ProjectDetail & { messages: ChatMessage[] };
}

function normalizeProjectMessages(messages: ChatMessage[], projectId: string): ChatMessage[] {
  return messages.map(message => ({ ...message, projectId: message.projectId || projectId }));
}

function agentRunFailureMessage(run: AgentRunView): string {
  if (run.status === 'cancelled') return '任务已停止，已经完成的内容会保留。';
  if (run.status === 'interrupted') return '任务因服务中断而暂停，可以从原任务恢复。';
  if (run.status === 'partial_failed') return run.summary?.errorMessage || '任务部分完成，可以重试失败步骤。';
  return run.summary?.errorMessage || '任务执行失败，可以重试。';
}

function getPendingFrameIds(project: ProjectDetail) {
  const frames = project.outline?.frames ?? [];
  const firstFrameId = frames[0]?.id;
  return frames
    .filter((frame, index) => {
      const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
      if (source?.id && source.id !== frame.id) return true;
      if (project.type === 'html' && frame.id === firstFrameId && isFrameSourceComplete(source, project.type, frame)) return false;
      return !isFrameSourceComplete(source, project.type, frame);
    })
    .map(frame => frame.id);
}

function generationResultMessage(
  result: Awaited<ReturnType<ReturnType<typeof useFrameGenerationController>['start']>>,
  subject: string,
) {
  if (result.status === 'completed') return `${subject}已生成完成，可以在预览区查看。`;
  if (result.status === 'aborted') return `${subject}的生成已取消，已经完成的内容会保留。`;
  return `${subject}没有全部生成成功：${result.message || '请查看生成进度后重试。'}`;
}

function getActionConversationForAction(action: MessageAction, project: ProjectDetail): ActionConversation {
  switch (action.id) {
    case 'approve_plan':
      return {
        userText: '确认大纲并生成完整视频',
        assistantText: '大纲已确认，开始生成全部画面和旁白。',
      };
    case 'approve_frame':
      return {
        userText: '确认这句内容',
        assistantText: '已确认这句旁白和画面意图，开始生成这一镜。',
        assistantActions: action.frameId
          ? [{ id: 'approve_frame', label: '确认这句内容', frameId: action.frameId, variant: 'default' }]
          : undefined,
      };
    case 'generate_sample':
      return {
        userText: action.forceVisual ? '重新生成首镜样片' : '生成首镜样片',
        assistantText: '收到，开始生成首镜样片。',
        assistantActions: [
          { id: 'confirm_visual_anchor', label: '确认主题风格', variant: 'default' },
          { id: 'generate_sample', label: '重新生成首镜', variant: 'outline', forceVisual: true },
        ],
      };
    case 'confirm_visual_anchor':
      return {
        userText: '确认主题风格',
        assistantText: '好的，后续镜头会继续使用当前主题 Token。',
        assistantActions: [{ id: 'generate_all', label: '生成其余镜头', variant: 'default' }],
      };
    case 'generate_all':
      return {
        userText: project.type === 'html' ? '生成其余镜头' : '一键生成',
        assistantText: '收到，开始生成画面和旁白。',
      };
    case 'regenerate_audio': {
      const index = project.outline?.frames.findIndex(frame => frame.id === action.frameId) ?? -1;
      const frameLabel = index >= 0 ? `第 ${index + 1} 镜` : '';
      return {
        userText: frameLabel ? `重新生成${frameLabel}旁白` : '重新生成旁白',
        assistantText: '收到，开始重新生成这一镜旁白。',
      };
    }
    case 'open_style_picker':
      return { userText: '切换视觉风格', assistantText: '好的，打开视觉风格选择。' };
    case 'open_tts_provider':
      return { userText: '切换 TTS', assistantText: '好的，打开 TTS 服务选择。' };
    case 'export_video':
      return { userText: '导出视频', assistantText: '请在预览区底部点击导出视频，系统会创建本地离线渲染任务。' };
    case 'view_outline':
      return { userText: '查看内容计划', assistantText: '好的，打开内容计划。' };
    default:
      return { userText: action.label, assistantText: '收到，正在处理。' };
  }
}

function getActionConversation(action: MessageAction, project: ProjectDetail): ActionConversation {
  switch (action.id) {
    case 'approve_plan':
      return { userText: '确认大纲并生成完整视频', assistantText: '大纲已确认，开始生成全部画面和旁白。' };
    case 'approve_frame':
      return { userText: '确认这句内容', assistantText: '已确认这句旁白和画面意图，开始生成这一镜。' };
    case 'generate_sample':
      return { userText: action.forceVisual ? '重新生成首镜样片' : '生成首镜样片', assistantText: '收到，开始生成首镜样片。' };
    case 'confirm_visual_anchor':
      return { userText: '确认主题风格', assistantText: '好的，后续镜头会继续使用当前主题 Token。' };
    case 'generate_all':
      return {
        userText: project.type === 'html' ? '生成其余镜头' : '一键生成',
        assistantText: '收到，开始生成画面和旁白。',
      };
    case 'regenerate_audio': {
      const index = project.outline?.frames.findIndex(frame => frame.id === action.frameId) ?? -1;
      const frameLabel = index >= 0 ? `第 ${index + 1} 镜` : '';
      return {
        userText: frameLabel ? `重新生成${frameLabel}旁白` : '重新生成旁白',
        assistantText: '收到，开始重新生成这一镜旁白。',
      };
    }
    case 'open_style_picker':
      return { userText: '切换视觉风格', assistantText: '好的，打开视觉风格选择。' };
    case 'open_tts_provider':
      return { userText: '切换 TTS', assistantText: '好的，打开 TTS 服务选择。' };
    case 'export_video':
      return { userText: '导出视频', assistantText: '请在预览区底部点击导出视频，系统会创建本地离线渲染任务。' };
    case 'view_outline':
      return { userText: '查看内容计划', assistantText: '好的，打开内容计划。' };
    default:
      return { userText: action.label, assistantText: '收到，正在处理。' };
  }
}

function getPendingStage(text: string): Extract<NonNullable<ChatMessage['metadata']>, { kind: 'pending' }>['stage'] {
  if (/拆分|拆成|拆为|拆开|分成|分为/.test(text)) return 'split_frame';
  if (/合并|合成|并成|并为/.test(text)) return 'merge_frames';
  if (/删|删除|去掉|移除/.test(text)) return 'delete_frame';
  if (/加|新增|插入/.test(text)) return 'add_frame';
  if (/改|修改|重写|重新生成|换/.test(text)) return 'regenerate_frame';
  if (/生成|一键|首镜|画面|旁白/.test(text)) return 'generate_frames';
  return 'intent';
}

function getPendingMessage(text: string) {
  const stage = getPendingStage(text);
  switch (stage) {
    case 'split_frame':
      return '正在拆分分镜并规划后续镜头...';
    case 'merge_frames':
      return '正在合并分镜并整理内容结构...';
    case 'delete_frame':
      return '正在删除分镜并同步内容结构...';
    case 'add_frame':
      return '正在生成新分镜并重排大纲...';
    case 'regenerate_frame': {
      const matched = text.match(/第\s*(\d+)\s*[镜幕]/);
      return matched ? `正在重写第 ${matched[1]} 镜...` : '正在理解你的修改意图...';
    }
    case 'generate_frames':
      return '正在整理生成步骤...';
    default:
      return '正在理解你的指令...';
  }
}
