import { NextRequest, NextResponse } from 'next/server';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { analyzeIntent } from '@/lib/ai/intent';
import { isAbortError, rethrowIfAborted } from '@/lib/agents/cancellation';
import { generateOutline } from '@/lib/ai/outline';
import {
  modifyFrameContent,
  generateNewFrameContent,
  isFreshFrameGenerationRequest,
  generateFrameStructureContent,
  insertFrameIntoOutline,
  deleteFrameFromOutline,
  realignVideoSource,
  syncOutlineContent,
} from '@/lib/ai/frame-ops';
import { buildAddDraft, buildDraftFromFrame } from '@/lib/ai/frame-drafts';
import { analyzeFrameTune } from '@/lib/ai/frame-tune';
import { initializeCollaboration, invalidateFrameApproval } from '@/lib/collaboration';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import type {
  IntentResult,
  ProjectDetail,
  Outline,
  VideoSource,
  FrameOutline,
  ProjectType,
  MessageAction,
  FrameReviewDraft,
  FrameStructureDraft,
  FrameTuneDraft,
} from '@/types';
import type { ProjectContentStyleConfig } from '@/lib/content-style/types';
import { applyProjectAIContext, applyProjectGPTOptimizationOverride } from '@/lib/ai-key-context';
import { getUpstreamAIError } from '@/lib/ai/upstream-error';
import { runWithAITraceProjectContext } from '@/lib/ai/trace';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/assets/constants';
import { readAssetExtraction, toAssetSummary } from '@/lib/assets/service';
import { selectRelevantDocumentChunks } from '@/lib/assets/document';
import { isAIDialogFeatureEnabled, usesNoviceAgentV2 } from '@/lib/feature-flags';
import {
  clarificationActions,
  compileProjectBriefForOutline,
  confirmProjectBrief,
  isBriefConfirmation,
  resolveProjectBrief,
} from '@/lib/brief/resolver';
import { ContextValidationError, createChatContextSnapshot } from '@/lib/context/chat-context';
import { diagnoseProject, shouldRunDirectorDiagnosis } from '@/lib/director/diagnosis';

const rewriteDraftSchema = z.object({
  operation: z.literal('modify'),
  targetFrameId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  narration: z.string().trim().min(1).max(2_000),
  visualPrompt: z.string().trim().max(8_000).optional(),
  imagePrompt: z.string().trim().max(8_000).optional(),
  htmlPrompt: z.string().trim().max(8_000).optional(),
  sceneSpec: z.any().optional(),
  freshStart: z.boolean().optional(),
  baseUpdatedAt: z.string().min(1),
});

const schema = z.object({
  projectId: z.string().uuid(),
  content: z.string().min(1).max(200_000),
  attachmentIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  context: z.object({
    scopeHint: z.enum(['auto', 'project', 'frame', 'element']).optional(),
    selectedFrameId: z.string().optional(),
    selectedElementIds: z.array(z.string()).max(20).optional(),
    playbackTimeMs: z.number().finite().nonnegative().optional(),
    playbackRevision: z.number().int().nonnegative().optional(),
  }).default({}),
  rewriteDraft: rewriteDraftSchema.optional(),
});

const RECENT_HISTORY_ROUNDS = 3;

/**
 * POST /api/agent/chat
 * Agent 入口：接收用户提示词，意图分析后路由到具体能力。
 *
 * 路由：
 * - generate_outline / regenerate_outline → 生成新大纲
 * - regenerate_frame → 只修改分镜内容，等待用户确认后再生成画面/声音
 * - add_frame → 只插入新分镜，等待用户确认后再生成画面/声音
 * - delete_frame → 删除分镜并同步大纲/媒体源
 * - unknown → 友好提示
 */
async function handleAgentChatPost(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }
    const { projectId, content, attachmentIds, context, rewriteDraft } = parsed.data;

    const project = await prisma.project.findUnique({ where: { uuid: projectId } });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    await applyProjectAIContext(project.workflow);
    applyProjectGPTOptimizationOverride(project.gptOptimization as any);

    const attachedAssets = attachmentIds.length
      ? await prisma.projectAsset.findMany({
        where: { projectId, id: { in: attachmentIds }, status: 'ready' },
        orderBy: { createdAt: 'asc' },
      })
      : [];
    if (attachedAssets.length !== new Set(attachmentIds).size) {
      return NextResponse.json({ error: '附件不存在、尚未处理完成或不属于当前项目' }, { status: 409 });
    }
    if (attachedAssets.some(asset => (
      asset.metadata && typeof asset.metadata === 'object'
      && (asset.metadata as Record<string, unknown>).userUsage === 'excluded'
    ))) {
      return NextResponse.json({ error: '附件已标记为“不要使用”，请先调整用途' }, { status: 409 });
    }
    const attachmentContext = attachedAssets.length
      ? `\n\n【用户附件摘要】\n${(await Promise.all(attachedAssets.map(async asset => {
        const summary = asset.summary && typeof asset.summary === 'object'
          ? asset.summary as Record<string, unknown>
          : {};
        const digest = String(summary.digest || summary.title || '已验证附件').slice(0, 1_500);
        if (asset.kind !== 'document') return `- ${asset.originalName}（${asset.inferredUsage || asset.kind}）：${digest}`;
        const extracted = await readAssetExtraction(projectId, asset.id).catch(() => null);
        const relevant = extracted
          ? selectRelevantDocumentChunks(extracted.chunks, content, 2)
            .map(chunk => chunk.text.slice(0, 1_200))
            .join('\n---\n')
          : '';
        return `- ${asset.originalName}（${asset.inferredUsage || asset.kind}）：${digest}${relevant ? `\n  相关片段：${relevant}` : ''}`;
      }))).join('\n')}`
      : '';
    const resolvedChatContext = project.outline && isAIDialogFeatureEnabled('CHAT_CONTEXT_V1')
      ? await createChatContextSnapshot({ projectId, content, context })
      : null;
    const contextForAI = resolvedChatContext
      ? `\n\n【当前讨论范围】\n范围：${resolvedChatContext.snapshot.resolvedScope === 'project' ? '完整视频' : resolvedChatContext.snapshot.resolvedScope === 'element' ? '当前画面中的已选元素' : '当前分镜'}${resolvedChatContext.snapshot.frameSummary ? `\n分镜标题：${resolvedChatContext.snapshot.frameSummary.title}\n旁白：${resolvedChatContext.snapshot.frameSummary.narration}` : ''}${resolvedChatContext.snapshot.elementSummary?.length ? `\n已选内容：${resolvedChatContext.snapshot.elementSummary.map(item => item.label).join('、')}` : ''}`
      : '';
    const contentForAI = `${content}${attachmentContext}${contextForAI}`;

    const currentOutline = (project.outline as unknown as Outline) ?? null;
    const rewriteFrameIndex = rewriteDraft
      ? currentOutline?.frames.findIndex(frame => frame.id === rewriteDraft.targetFrameId) ?? -1
      : -1;
    if (rewriteDraft && (!currentOutline || rewriteFrameIndex < 0)) {
      return NextResponse.json({ error: '草稿对应的分镜已不存在，请重新生成草稿。' }, { status: 409 });
    }
    if (rewriteDraft && new Date(rewriteDraft.baseUpdatedAt).getTime() !== project.updatedAt.getTime()) {
      return NextResponse.json({ error: '项目已更新，当前草稿已过期，请重新生成草稿。' }, { status: 409 });
    }
    const rewriteBaseline = rewriteDraft && currentOutline
      ? frameFromRewriteDraft(currentOutline.frames[rewriteFrameIndex], rewriteDraft, project.type as ProjectType)
      : undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // 1) 写入用户消息
    const userMessage = await prisma.message.create({
      data: {
        projectId,
        role: 'user',
        content,
        metadata: (attachedAssets.length
          ? { kind: 'asset_summary', assets: attachedAssets.map(toAssetSummary) }
          : { kind: 'text' }) as any,
      },
    });

    if (usesNoviceAgentV2(project) && project.briefStatus !== 'confirmed') {
      const existingBrief = project.projectBrief as unknown as import('@/types').ProjectBrief | null;
      const shouldConfirm = project.briefStatus === 'ready'
        && (isBriefConfirmation(content) || /让\s*AI\s*决定|按推荐/i.test(content));
      if (shouldConfirm && existingBrief?.version === 'project-brief-v1') {
        const confirmedBrief = confirmProjectBrief(existingBrief);
        const allReadyAssets = await prisma.projectAsset.findMany({
          where: { projectId, status: 'ready' },
          orderBy: { createdAt: 'asc' },
        });
        const firstUserMessage = await prisma.message.findFirst({
          where: { projectId, role: 'user' },
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        });
        const compiledInput = compileProjectBriefForOutline({
          brief: confirmedBrief,
          assets: allReadyAssets.map(toAssetSummary),
          originalRequest: firstUserMessage?.content,
        });
        const generatedOutline = await runWithAITraceProjectContext(projectId, () => generateOutline(project.type as 'image' | 'html', compiledInput, {
          projectId,
          canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
          contentStyle: project.contentStyle as unknown as ProjectContentStyleConfig | null,
          abortSignal: req.signal,
          workflow: project.workflow as 'gpt-free',
        }));
        const outline = initializeCollaboration(generatedOutline);
        const updatedProject = await prisma.project.update({
          where: { uuid: projectId },
          data: {
            projectBrief: confirmedBrief as any,
            briefStatus: 'confirmed',
            title: project.outline ? project.title : outline.title,
            outline: outline as any,
            videoSource: { frames: outline.frames.map(frame => ({ id: frame.id })) } as any,
          },
        });
        const assistantMessage = await prisma.message.create({
          data: {
            projectId,
            role: 'assistant',
            content: `简报已确认，并据此生成《${outline.title}》的内容计划。确认内容计划后即可生成完整视频。`,
            metadata: { kind: 'outline', outline, actions: nextActions(project.type as ProjectType, 'outline_ready') } as any,
          },
        });
        return NextResponse.json({
          userMessage: { ...userMessage, createdAt: userMessage.createdAt.toISOString() },
          assistantMessage: { ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() },
          assistantMessages: [{ ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() }],
          project: {
            uuid: updatedProject.uuid,
            title: updatedProject.title,
            type: updatedProject.type,
            workflow: updatedProject.workflow,
            canvasPreset: updatedProject.canvasPreset,
            styleId: updatedProject.styleId,
            contentStyle: updatedProject.contentStyle,
            gptOptimization: updatedProject.gptOptimization,
            projectBrief: updatedProject.projectBrief,
            briefStatus: updatedProject.briefStatus,
            outline: updatedProject.outline,
            videoSource: updatedProject.videoSource,
            createdAt: updatedProject.createdAt.toISOString(),
            updatedAt: updatedProject.updatedAt.toISOString(),
            hasOutline: Boolean(updatedProject.outline),
          },
          intent: { action: 'generate_outline', reason: '用户确认创作简报', params: {} },
        });
      }

      const resolution = resolveProjectBrief({
        content,
        assets: attachedAssets.map(toAssetSummary),
        existingBrief,
      });
      const updatedProject = await prisma.project.update({
        where: { uuid: projectId },
        data: { projectBrief: resolution.brief as any, briefStatus: resolution.status },
      });
      const question = resolution.brief.unresolvedQuestions[0];
      const metadata = question
        ? { kind: 'clarification', question, actions: clarificationActions(question) }
        : {
          kind: 'brief_review',
          brief: resolution.brief,
          actions: [
            { id: 'brief_confirm', label: '按这个生成', variant: 'default' },
            { id: 'brief_edit', label: '修改方案', variant: 'outline' },
            { id: 'brief_ai_decide', label: '让 AI 决定', variant: 'secondary' },
          ],
        };
      const assistantMessage = await prisma.message.create({
        data: {
          projectId,
          role: 'assistant',
          content: question ? '还差一个会明显影响成片的问题。' : '我已经根据你的需求和资料整理好创作简报。',
          metadata: metadata as any,
        },
      });
      return NextResponse.json({
        userMessage: { ...userMessage, createdAt: userMessage.createdAt.toISOString() },
        assistantMessage: { ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() },
        assistantMessages: [{ ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() }],
        project: {
          uuid: updatedProject.uuid,
          title: updatedProject.title,
          type: updatedProject.type,
          workflow: updatedProject.workflow,
          canvasPreset: updatedProject.canvasPreset,
          styleId: updatedProject.styleId,
          contentStyle: updatedProject.contentStyle,
          gptOptimization: updatedProject.gptOptimization,
          projectBrief: updatedProject.projectBrief,
          briefStatus: updatedProject.briefStatus,
          outline: updatedProject.outline,
          videoSource: updatedProject.videoSource,
          createdAt: updatedProject.createdAt.toISOString(),
          updatedAt: updatedProject.updatedAt.toISOString(),
          hasOutline: Boolean(updatedProject.outline),
        },
        intent: { action: 'generate_outline', reason: '先完成创作简报', params: {} },
      });
    }

    if (resolvedChatContext && isAIDialogFeatureEnabled('DIRECTOR_DIAGNOSIS_V1') && shouldRunDirectorDiagnosis(content)) {
      const result = await runWithAITraceProjectContext(projectId, () => diagnoseProject({
        projectId,
        content,
        context: resolvedChatContext.snapshot,
        abortSignal: req.signal,
      }));
      const assistantMessage = await prisma.message.create({
        data: {
          projectId,
          role: 'assistant',
          content: result.diagnosis.summary,
          metadata: {
            kind: 'director_diagnosis',
            diagnosis: result.diagnosis,
            actions: [
              { id: 'diagnosis_recommend', label: '按推荐方案修改', variant: 'default' },
              { id: 'diagnosis_light', label: '轻微调整', variant: 'outline' },
              { id: 'diagnosis_redesign', label: '重新设计', variant: 'outline' },
              { id: 'diagnosis_skip', label: '先不改', variant: 'secondary' },
            ],
          } as any,
        },
      });
      return NextResponse.json({
        userMessage: { ...userMessage, createdAt: userMessage.createdAt.toISOString() },
        assistantMessage: { ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() },
        assistantMessages: [{ ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() }],
        project: {
          uuid: project.uuid,
          title: project.title,
          type: project.type,
          workflow: project.workflow,
          canvasPreset: project.canvasPreset,
          styleId: project.styleId,
          contentStyle: project.contentStyle,
          gptOptimization: project.gptOptimization,
          projectBrief: project.projectBrief,
          briefStatus: project.briefStatus,
          outline: project.outline,
          videoSource: project.videoSource,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
          hasOutline: Boolean(project.outline),
        },
        intent: { action: 'unknown', reason: 'AI 导演只读诊断', params: { scope: result.diagnosis.scope.type } },
      });
    }

    // 2) 意图分析
    let intent: IntentResult;
    let assistantContent = '';
    let assistantMetadata: any = { kind: 'text' };
    let assistantMessagePayloads: Array<{ content: string; metadata: any }> | null = null;
    let projectUpdate: Partial<{ title: string; outline: Outline; videoSource: VideoSource }> = {};
    const conversationContext = await buildConversationContext(projectId, RECENT_HISTORY_ROUNDS);

    if (rewriteBaseline) {
      intent = {
        action: 'regenerate_frame',
        reason: '用户要求以当前未提交草稿为基准进行大改',
        params: { frameIndex: rewriteFrameIndex + 1, modification: content },
      };
    } else try {
      intent = await runWithAITraceProjectContext(projectId, () => analyzeIntent(projectId, contentForAI, req.signal));
    } catch (err) {
      rethrowIfAborted(err, req.signal);
      console.error('[intent] 失败', err);
      intent = { action: 'unknown', reason: '意图分析失败', params: {} };
    }

    // 3) 按 action 路由
    switch (intent.action) {
      case 'generate_outline':
      case 'regenerate_outline': {
        const generatedOutline = await runWithAITraceProjectContext(projectId, () => generateOutline(project.type as 'image' | 'html', contentForAI, {
          projectId,
          canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
          contentStyle: project.contentStyle as unknown as ProjectContentStyleConfig | null,
          abortSignal: req.signal,
          workflow: project.workflow as 'gpt-free',
          conversationContext: intent.action === 'regenerate_outline' ? conversationContext : undefined,
          currentOutline: intent.action === 'regenerate_outline'
            ? ((project.outline as unknown as Outline) ?? null)
            : null,
        }));
        const freeWorkflow = project.workflow === 'gpt-free';
        const outline = initializeCollaboration(generatedOutline);
        projectUpdate.outline = outline;
        if (intent.action === 'generate_outline' && !project.outline) {
          projectUpdate.title = outline.title;
        }
        projectUpdate.videoSource = { frames: outline.frames.map(f => ({ id: f.id })) };
        const researchNote = outline.research?.status === 'failed'
          ? '，但联网核实失败，请人工检查高风险事实'
          : outline.research
            ? `，已联网筛选 ${outline.research.sources.length} 个来源、形成 ${outline.research.evidenceCards?.length || 0} 张证据卡`
            : '';
        assistantContent = freeWorkflow
          ? `已完成《${outline.title}》的口播、大纲与自由视觉总纲。请使用现有内容计划确认，确认后开始自由生成。`
          : `已生成 ${outline.frames.length} 镜大纲《${outline.title}》${researchNote}。确认大纲后将直接生成完整视频。`;
        assistantMetadata = { kind: 'outline', outline, actions: nextActions(project.type as ProjectType, 'outline_ready') };
        break;
      }

      case 'regenerate_frame': {
        const result = await runWithAITraceProjectContext(projectId, () => handleRegenerateFrame({
          projectId,
          projectType: project.type as ProjectType,
          currentOutline: (project.outline as unknown as Outline) ?? null,
          params: intent.params,
          conversationContext,
          baseUpdatedAt: project.updatedAt.toISOString(),
          draftBaseline: rewriteBaseline,
        }));
        assistantContent = result.message;
        assistantMetadata = { kind: 'text' };
        if (result.draft) {
          assistantMessagePayloads = [
            { content: result.message, metadata: { kind: 'text' } },
            buildFrameReviewMessage(result.draft),
          ];
        } else {
          assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, 'needs_outline') };
        }
        break;
      }

      case 'tune_frame': {
        const result = await runWithAITraceProjectContext(projectId, () => handleTuneFrame({
          projectType: project.type as ProjectType,
          currentOutline: (project.outline as unknown as Outline) ?? null,
          currentVideoSource: (project.videoSource as unknown as VideoSource | null) ?? null,
          params: intent.params,
          baseUpdatedAt: project.updatedAt.toISOString(),
        }));
        assistantContent = result.message;
        if (result.draft) {
          assistantMessagePayloads = [
            { content: result.message, metadata: { kind: 'text' } },
            buildFrameTuneReviewMessage(result.draft),
          ];
        } else {
          assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline') };
        }
        break;
      }

      case 'add_frame': {
        const result = await runWithAITraceProjectContext(projectId, () => handleAddFrame({
          projectId,
          projectType: project.type as ProjectType,
          currentOutline: (project.outline as unknown as Outline) ?? null,
          params: intent.params,
          userHint: contentForAI,
          conversationContext,
          baseUpdatedAt: project.updatedAt.toISOString(),
        }));
        assistantContent = result.message;
        if (result.draft) {
          assistantMessagePayloads = [
            { content: result.message, metadata: { kind: 'text' } },
            buildFrameReviewMessage(result.draft),
          ];
        } else {
          assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, 'needs_outline') };
        }
        break;
      }

      case 'delete_frame': {
        const result = handleDeleteFrame({
          projectType: project.type as ProjectType,
          currentOutline: (project.outline as unknown as Outline) ?? null,
          params: intent.params,
          baseUpdatedAt: project.updatedAt.toISOString(),
        });
        assistantContent = result.message;
        if (result.draft) {
          assistantMessagePayloads = [
            { content: result.message, metadata: { kind: 'text' } },
            buildFrameReviewMessage(result.draft),
          ];
        } else {
          assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, 'needs_outline') };
        }
        break;
      }

      case 'split_frame':
      case 'merge_frames': {
        const result = await runWithAITraceProjectContext(projectId, () => handleFrameStructureChange({
          operation: intent.action === 'split_frame' ? 'split' : 'merge',
          projectType: project.type as ProjectType,
          currentOutline: (project.outline as unknown as Outline) ?? null,
          params: intent.params,
          userModification: contentForAI,
          conversationContext,
          baseUpdatedAt: project.updatedAt.toISOString(),
        }));
        assistantContent = result.message;
        if (result.draft) {
          assistantMessagePayloads = [
            { content: result.message, metadata: { kind: 'text' } },
            buildFrameStructureReviewMessage(result.draft),
          ];
        } else {
          assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline') };
        }
        break;
      }

      case 'regenerate_audio': {
        const frameIndex1 = Number(intent.params.frameIndex) || 0;
        const outline = (project.outline as unknown as Outline) ?? null;
        const frame = frameIndex1 > 0 ? outline?.frames[frameIndex1 - 1] : null;
        assistantContent = frame
          ? `可以重生成第 ${frameIndex1} 镜《${frame.title}》的旁白。点击按钮后会只替换这一镜音频，画面保持不变。`
          : '可以重生成某一镜旁白。请告诉我具体编号，比如“重生成第 3 镜旁白”。';
        assistantMetadata = {
          kind: 'text',
          actions: frame
            ? [{ id: 'regenerate_audio', label: `重生成第 ${frameIndex1} 镜旁白`, frameId: frame.id, variant: 'default' }, ...nextActions(project.type as ProjectType, 'outline_ready')]
            : nextActions(project.type as ProjectType, outline ? 'outline_ready' : 'needs_outline'),
        };
        break;
      }

      case 'generate_frames':
        assistantContent = project.outline
          ? '可以继续生成画面和旁白。确认大纲后会直接生成完整视频。'
          : '当前项目还没有大纲，请先告诉我视频主题或脚本，我会先生成内容计划。';
        assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline') };
        break;

      case 'change_style':
        assistantContent = project.type === 'html'
          ? '可以切换视觉风格。建议切换后重新生成首镜样片，再确认新的主题风格。'
          : '图片轮播模式主要使用大纲里的全局画风提示词；如果想换风格，可以直接告诉我希望画面更偏哪种质感，我会帮你重写相关分镜提示词。';
        assistantMetadata = { kind: 'text', actions: project.type === 'html' ? [{ id: 'open_style_picker', label: '切换视觉风格', variant: 'default' }, ...nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline')] : nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline') };
        break;

      case 'set_tts_provider':
        assistantContent = '可以切换 TTS 服务。切换后建议重生成需要调整的分镜旁白，避免同一条视频里声音来源不一致。';
        assistantMetadata = { kind: 'text', actions: [{ id: 'open_tts_provider', label: '切换 TTS', variant: 'default' }, ...nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline')] };
        break;

      case 'export_video':
        assistantContent = '导出前建议先确认所有镜头已经生成，并播放预览检查节奏。准备好后在预览区点击“导出视频”，系统会创建本地离线渲染任务，无需共享标签页。';
        assistantMetadata = { kind: 'text', actions: [{ id: 'export_video', label: '查看导出步骤', variant: 'default' }, ...nextActions(project.type as ProjectType, project.outline ? 'generated' : 'needs_outline')] };
        break;

      default:
        assistantContent = `抱歉，我暂时还不理解您的指令。\n\n我能做的：\n• 创作新视频或重新生成大纲\n• 新增、删除、修改某个分镜\n• 确认大纲后直接生成完整视频\n• 切换视觉风格或 TTS 服务\n\n请试试："做一个 3 分钟介绍黑洞的视频"`;
        assistantMetadata = { kind: 'text', actions: nextActions(project.type as ProjectType, project.outline ? 'outline_ready' : 'needs_outline') };
    }

    // 4) 更新项目（如有）
    let updatedProject = project;
    if (Object.keys(projectUpdate).length) {
      updatedProject = await prisma.project.update({
        where: { uuid: projectId },
        data: projectUpdate as any,
      });
    }

    // 5) 写助手消息
    const createdAssistantMessages = [];
    const payloads = assistantMessagePayloads ?? [{ content: assistantContent, metadata: assistantMetadata }];
    for (const payload of payloads) {
      createdAssistantMessages.push(
        await prisma.message.create({
          data: {
            projectId,
            role: 'assistant',
            content: payload.content,
            metadata: payload.metadata,
          },
        }),
      );
    }
    const assistantMessage = createdAssistantMessages[0];

    // 6) 返回
    const detail: ProjectDetail = {
      uuid: updatedProject.uuid,
      title: updatedProject.title,
      type: updatedProject.type as 'image' | 'html',
      workflow: updatedProject.workflow as 'gpt-free',
      canvasPreset: updatedProject.canvasPreset as ProjectDetail['canvasPreset'],
      styleId: updatedProject.styleId,
      contentStyle: updatedProject.contentStyle as unknown as ProjectContentStyleConfig | null,
      gptOptimization: updatedProject.gptOptimization as ProjectDetail['gptOptimization'],
      outline: (updatedProject.outline as unknown as Outline) ?? null,
      videoSource: (updatedProject.videoSource as unknown as VideoSource) ?? null,
      projectBrief: updatedProject.projectBrief as ProjectDetail['projectBrief'],
      briefStatus: updatedProject.briefStatus as ProjectDetail['briefStatus'],
      createdAt: updatedProject.createdAt.toISOString(),
      updatedAt: updatedProject.updatedAt.toISOString(),
      hasOutline: !!updatedProject.outline,
    };

    return NextResponse.json({
      userMessage: { ...userMessage, createdAt: userMessage.createdAt.toISOString() },
      assistantMessage: { ...assistantMessage, createdAt: assistantMessage.createdAt.toISOString() },
      assistantMessages: createdAssistantMessages.map(message => ({ ...message, createdAt: message.createdAt.toISOString() })),
      project: detail,
      intent,
      contextSnapshot: resolvedChatContext?.snapshot ?? null,
    });
  } catch (err) {
    if (isAbortError(err, req.signal)) {
      return NextResponse.json({ error: '任务已取消', code: 'AGENT_RUN_CANCELLED' }, { status: 499 });
    }
    console.error('[POST /api/agent/chat]', err);
    const message = err instanceof Error ? err.message : '';
    if (err instanceof ContextValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === 'AIServiceUnavailableError') {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    if (/内容规划未返回任何(?:可用)?分镜/.test(message)) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    const upstream = getUpstreamAIError(err);
    if (upstream) {
      return new Response(JSON.stringify({ error: upstream.error }), {
        status: upstream.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return NextResponse.json({ error: 'AI 处理失败' }, { status: 500 });
  }
}

export const POST = withAIKeyRoute(handleAgentChatPost);

type NextActionStage = 'needs_outline' | 'outline_ready' | 'generated';

function nextActions(projectType: ProjectType, stage: NextActionStage): MessageAction[] {
  if (stage === 'needs_outline') return [];

  if (stage === 'generated') {
    return [{ id: 'export_video', label: '导出视频', variant: 'default' }];
  }

  return [{ id: 'approve_plan', label: '确认大纲并生成完整视频', variant: 'default' }];
}

function buildFrameReviewMessage(draft: FrameReviewDraft): { content: string; metadata: { kind: 'frame_review'; draft: FrameReviewDraft; actions: MessageAction[] } } {
  const content = draft.operation === 'add'
    ? '请检查新分镜草稿。'
    : draft.operation === 'delete'
      ? '请确认是否删除这个分镜。'
      : '请检查修改后的分镜草稿。';
  return { content, metadata: { kind: 'frame_review', draft, actions: [] } };
}

function buildFrameTuneReviewMessage(draft: FrameTuneDraft): { content: string; metadata: { kind: 'frame_tune_review'; draft: FrameTuneDraft; actions: MessageAction[] } } {
  return {
    content: '请检查画面微调草稿。',
    metadata: { kind: 'frame_tune_review', draft, actions: [] },
  };
}

function buildFrameStructureReviewMessage(draft: FrameStructureDraft): { content: string; metadata: { kind: 'frame_structure_review'; draft: FrameStructureDraft; actions: MessageAction[] } } {
  return {
    content: draft.operation === 'split' ? '请检查拆分后的分镜草稿。' : '请检查合并后的分镜草稿。',
    metadata: { kind: 'frame_structure_review', draft, actions: [] },
  };
}

function buildLegacyFrameReviewMessage(frame: FrameOutline): { content: string; metadata: { kind: 'text'; actions: MessageAction[] } } {
  const visualIntent = frame.htmlPrompt || frame.imagePrompt || frame.sceneSpec?.visualIntent || '暂无画面意图';
  return {
    content: [
      `请检查分镜 #${frame.index}《${frame.title}》的旁白和画面意图：`,
      '',
      `旁白：${frame.narration}`,
      '',
      `画面意图：${visualIntent}`,
    ].join('\n'),
    metadata: {
      kind: 'text',
      actions: [{ id: 'approve_frame', label: '确认这句内容', frameId: frame.id, variant: 'default' }],
    },
  };
}

function markPlanNeedsReview(outline: Outline): Outline {
  return {
    ...outline,
    visualAnchor: undefined,
    collaboration: {
      mode: 'guided',
      planApproved: false,
      approvedFrameIds: [],
    },
  };
}

function handleDeleteFrame(opts: {
  projectType: ProjectType;
  currentOutline: Outline | null;
  params: Record<string, unknown>;
  baseUpdatedAt: string;
}): {
  draft?: FrameReviewDraft;
  message: string;
} {
  const { projectType, currentOutline, params, baseUpdatedAt } = opts;

  if (!currentOutline) {
    return { message: '当前项目还没有大纲，请先生成大纲。' };
  }

  const frameIndex1 = Number(params.frameIndex) || 0;
  if (frameIndex1 < 1 || frameIndex1 > currentOutline.frames.length) {
    return { message: `分镜编号 ${frameIndex1 || '未指定'} 不存在（当前共 ${currentOutline.frames.length} 个分镜）。` };
  }

  const deletedFrame = currentOutline.frames[frameIndex1 - 1];

  return {
    draft: buildDraftFromFrame({ operation: 'delete', frame: deletedFrame, type: projectType, baseUpdatedAt }),
    message: `我找到了第 ${frameIndex1} 镜《${deletedFrame.title}》。请先确认删除草稿，确认后才会重排大纲并移除对应媒体。`,
  };
}

async function handleFrameStructureChange(opts: {
  operation: 'split' | 'merge';
  projectType: ProjectType;
  currentOutline: Outline | null;
  params: Record<string, unknown>;
  userModification: string;
  conversationContext: string;
  baseUpdatedAt: string;
}): Promise<{ draft?: FrameStructureDraft; message: string }> {
  const { operation, projectType, currentOutline, params, userModification, conversationContext, baseUpdatedAt } = opts;
  if (!currentOutline) return { message: '当前项目还没有大纲，请先生成大纲。' };

  let indexes: number[];
  let parts = 2;
  if (operation === 'split') {
    const frameIndex = Number(params.frameIndex) || 0;
    if (frameIndex < 1 || frameIndex > currentOutline.frames.length) {
      return { message: `分镜编号 ${frameIndex || '未指定'} 不存在（当前共 ${currentOutline.frames.length} 个分镜）。` };
    }
    parts = Math.max(2, Math.min(4, Number(params.parts) || 2));
    indexes = [frameIndex - 1];
  } else {
    const requested = Array.isArray(params.frameIndexes) ? params.frameIndexes.map(Number) : [];
    const unique = [...new Set(requested.filter(index => Number.isInteger(index)))].sort((a, b) => a - b);
    if (unique.length < 2 || unique.some(index => index < 1 || index > currentOutline.frames.length)) {
      return { message: `请指定至少两个有效的连续分镜（当前共 ${currentOutline.frames.length} 个分镜）。` };
    }
    if (unique.some((index, offset) => offset > 0 && index !== unique[offset - 1] + 1)) {
      return { message: '目前只能合并连续分镜，请重新指定相邻的分镜编号。' };
    }
    indexes = unique.map(index => index - 1);
  }

  try {
    const generated = await generateFrameStructureContent({
      type: projectType,
      outline: currentOutline,
      operation,
      targetIndexes: indexes,
      parts,
      userModification: String(params.modification || userModification).trim(),
      conversationContext,
    });
    const targetFrames = indexes.map(index => currentOutline.frames[index]);
    return {
      draft: {
        operation,
        targetFrameIds: targetFrames.map(frame => frame.id),
        frames: generated.frames,
        baseUpdatedAt,
      },
      message: operation === 'split'
        ? `我把第 ${indexes[0] + 1} 镜整理成了 ${parts} 个连续分镜草稿。确认后会保留原位置，并在后面新增 ${parts - 1} 镜。`
        : `我把第 ${indexes[0] + 1}–${indexes[indexes.length - 1] + 1} 镜整理成了一个合并草稿。确认后会保留第一镜的位置并移除其余目标镜头。`,
    };
  } catch (error) {
    console.error('[generateFrameStructureContent] 失败', error);
    return { message: `AI ${operation === 'split' ? '拆分' : '合并'}分镜失败：${(error as Error).message}` };
  }
}

// =============================================================================
// 内部：修改分镜
// =============================================================================

function frameFromRewriteDraft(
  frame: FrameOutline,
  draft: z.infer<typeof rewriteDraftSchema>,
  projectType: ProjectType,
): FrameOutline {
  const htmlPrompt = draft.htmlPrompt || draft.visualPrompt || frame.htmlPrompt;
  const imagePrompt = draft.imagePrompt || draft.visualPrompt || frame.imagePrompt;
  return {
    ...frame,
    title: draft.title,
    narration: draft.narration,
    imagePrompt: projectType === 'image' ? imagePrompt : frame.imagePrompt,
    htmlPrompt: projectType === 'html' ? htmlPrompt : frame.htmlPrompt,
    sceneSpec: projectType === 'html' ? draft.sceneSpec as FrameOutline['sceneSpec'] : frame.sceneSpec,
  };
}

async function handleRegenerateFrame(opts: {
  projectId: string;
  projectType: ProjectType;
  currentOutline: Outline | null;
  currentVideoSource?: VideoSource;
  params: Record<string, unknown>;
  conversationContext: string;
  baseUpdatedAt: string;
  draftBaseline?: FrameOutline;
}): Promise<{
  draft?: FrameReviewDraft;
  outline?: Outline;
  videoSource?: VideoSource;
  frame?: FrameOutline;
  message: string;
}> {
  const { projectType, currentOutline, currentVideoSource = { frames: [] }, params, conversationContext, baseUpdatedAt, draftBaseline } = opts;

  if (!currentOutline) {
    return { message: '当前项目还没有大纲，请先生成大纲。' };
  }

  // 1-based frameIndex → 0-based
  const frameIndex1 = Number(params.frameIndex) || 0;
  const frameIndex0 = frameIndex1 - 1;
  if (frameIndex0 < 0 || frameIndex0 >= currentOutline.frames.length) {
    return { message: `分镜编号 ${frameIndex1} 不存在（当前共 ${currentOutline.frames.length} 个分镜）。` };
  }

  const targetFrame = currentOutline.frames[frameIndex0];
  const modification = String(params.modification || '').trim();
  const freshStart = isFreshFrameGenerationRequest(modification);

  // A blank replacement deliberately reuses the new-frame planner. The target
  // shot is removed from the planning input so its prior copy and visual plan
  // cannot leak into the replacement.
  let updated: Partial<FrameOutline> = {};
  try {
    if (freshStart) {
      const planningOutline: Outline = {
        ...currentOutline,
        frames: currentOutline.frames
          .filter((_, index) => index !== frameIndex0)
          .map((frame, index) => ({ ...frame, index: index + 1 })),
      };
      const fresh = await generateNewFrameContent({
        type: projectType,
        outline: planningOutline,
        userHint: modification,
        afterIndex: frameIndex0,
      });
      updated = {
        title: frameIndex0 === 0 ? currentOutline.title : fresh.title,
        narration: fresh.narration,
        imagePrompt: fresh.imagePrompt,
        htmlPrompt: fresh.htmlPrompt,
        sceneSpec: fresh.sceneSpec,
      };
    } else {
      updated = await modifyFrameContent({
        type: projectType,
        outline: currentOutline,
        frameIndex: frameIndex0,
        userModification: modification,
        conversationContext,
        baselineFrame: draftBaseline,
      });
    }
  } catch (err) {
    console.error(freshStart ? '[generateNewFrameContent] failed' : '[modifyFrameContent] failed', err);
    return { message: `AI ${freshStart ? '从空白镜头生成' : '修改'}分镜内容失败：${(err as Error).message}` };
  }

  const baseFrame = draftBaseline || targetFrame;
  const proposedFrame: FrameOutline = {
    ...targetFrame,
    title: updated.title || baseFrame.title,
    narration: updated.narration || baseFrame.narration,
    imagePrompt: projectType === 'image' ? (updated.imagePrompt || baseFrame.imagePrompt) : targetFrame.imagePrompt,
    htmlPrompt: projectType === 'html' ? (updated.htmlPrompt || baseFrame.htmlPrompt) : targetFrame.htmlPrompt,
    sceneSpec: projectType === 'html' ? (updated.sceneSpec || baseFrame.sceneSpec) : targetFrame.sceneSpec,
  };
  return {
    draft: buildDraftFromFrame({ operation: 'modify', frame: proposedFrame, type: projectType, baseUpdatedAt, freshStart }),
    message: freshStart
      ? `我已为第 ${frameIndex1} 镜生成了一张全新的空白起点草稿；旧镜头内容和视觉约束没有参与这次创作。确认后会按首次生成方式渲染新的画面和配音。`
      : `我先为第 ${frameIndex1} 镜《${targetFrame.title}》生成了一版修改草稿。你可以直接改旁白和画面意图，确认后应用并重生成这一镜的画面和配音。`,
  };

  /*
  const newFrames = currentOutline.frames.map((f, i) =>
    i === frameIndex0
      ? {
          ...f,
          title: updated.title || f.title,
          narration: updated.narration || f.narration,
          imagePrompt: projectType === 'image' ? (updated.imagePrompt || f.imagePrompt) : f.imagePrompt,
          htmlPrompt: projectType === 'html' ? (updated.htmlPrompt || f.htmlPrompt) : f.htmlPrompt,
          sceneSpec: projectType === 'html' ? (updated.sceneSpec || f.sceneSpec) : f.sceneSpec,
        }
      : f,
  );
  const newOutline: Outline = invalidateFrameApproval(
    syncOutlineContent({ ...currentOutline, frames: newFrames }),
    targetFrame.id,
  );

  // 2) 清空旧媒体，交给用户确认内容后手动生成。
  const newSources = [...currentVideoSource.frames];
  // 重要：要先清空旧画面，让后续生成逻辑走"新生成"分支
  newSources[frameIndex0] = {
    id: targetFrame.id,
    imagePath: undefined,
    audioPath: undefined,
    audioDuration: undefined,
    htmlCode: undefined,
  };

  return {
    outline: newOutline,
    videoSource: { frames: newSources },
    frame: newOutline.frames[frameIndex0],
    message: `已修改分镜 #${frameIndex1}《${newFrames[frameIndex0].title}》的内容，旧媒体已清空。请先检查旁白和画面意图，确认后再生成这一镜。`,
  };
  */
}

// =============================================================================
// 内部：新增分镜
// =============================================================================

async function handleTuneFrame(opts: {
  projectType: ProjectType;
  currentOutline: Outline | null;
  currentVideoSource: VideoSource | null;
  params: Record<string, unknown>;
  baseUpdatedAt: string;
}): Promise<{
  draft?: FrameTuneDraft;
  message: string;
}> {
  const { projectType, currentOutline, currentVideoSource, params, baseUpdatedAt } = opts;

  if (!currentOutline) {
    return { message: '当前项目还没有大纲，请先生成内容计划。' };
  }
  if (projectType !== 'html') {
    return { message: '微调功能暂只支持 HTML 动画分镜。图片分镜建议使用“重新生成当前画面”。' };
  }

  const frameIndex1 = Number(params.frameIndex) || 0;
  const frameIndex0 = frameIndex1 - 1;
  if (frameIndex0 < 0 || frameIndex0 >= currentOutline.frames.length) {
    return { message: `分镜编号 ${frameIndex1 || '未指定'} 不存在（当前共 ${currentOutline.frames.length} 个分镜）。` };
  }

  const targetFrame = currentOutline.frames[frameIndex0];
  const source = getFrameSourceForOutlineFrame(currentVideoSource, targetFrame.id, frameIndex0);
  if (!source?.htmlCode) {
    return { message: `第 ${frameIndex1} 镜《${targetFrame.title}》还没有生成 HTML 画面。请先生成该镜画面，再进行微调。` };
  }

  try {
    const draft = await analyzeFrameTune({
      frame: targetFrame,
      source,
      userModification: String(params.modification || '').trim(),
      baseUpdatedAt,
    });
    return {
      draft,
      message: `我把第 ${frameIndex1} 镜《${targetFrame.title}》整理成了一份微调草稿。它只会调整当前画面参数，不改旁白和分镜内容。`,
    };
  } catch (error) {
    console.error('[analyzeFrameTune] failed', error);
    return { message: `AI 分析画面微调失败：${(error as Error).message}` };
  }
}

async function handleAddFrame(opts: {
  projectId: string;
  projectType: ProjectType;
  currentOutline: Outline | null;
  currentVideoSource?: VideoSource;
  params: Record<string, unknown>;
  userHint: string;
  conversationContext: string;
  baseUpdatedAt: string;
}): Promise<{
  draft?: FrameReviewDraft;
  outline?: Outline;
  videoSource?: VideoSource;
  frame?: FrameOutline;
  message: string;
}> {
  const { projectType, currentOutline, currentVideoSource = { frames: [] }, params, userHint, conversationContext, baseUpdatedAt } = opts;

  if (!currentOutline) {
    return { message: '当前项目还没有大纲，请先生成大纲。' };
  }

  const afterIndex1 = Math.max(0, Number(params.afterIndex) || 0);

  // 1) AI 生成新分镜内容
  let newContent;
  try {
    newContent = await generateNewFrameContent({
      type: projectType,
      outline: currentOutline,
      userHint: userHint,
      afterIndex: afterIndex1,
      conversationContext,
    });
  } catch (err) {
    console.error('[generateNewFrameContent] 失败', err);
    return { message: `AI 生成新分镜内容失败：${(err as Error).message}` };
  }

  // AI 可能会回填更合适的 afterIndex
  const finalAfterIndex1 = newContent.afterIndex > 0 ? newContent.afterIndex : afterIndex1;

  // 2) 构造新分镜
  const newFrame: FrameOutline = {
    id: crypto.randomUUID(),
    index: 0, // 会在 insertFrameIntoOutline 中重排
    title: newContent.title,
    narration: newContent.narration,
    imagePrompt: projectType === 'image' ? newContent.imagePrompt : undefined,
    htmlPrompt: projectType === 'html' ? newContent.htmlPrompt : undefined,
    sceneSpec: projectType === 'html' ? newContent.sceneSpec : undefined,
  };

  const draftPosition = Math.max(0, Math.min(finalAfterIndex1, currentOutline.frames.length));
  const draftPosLabel = draftPosition + 1;
  const draftAfterLabel = draftPosition > 0 ? `第 ${draftPosition} 镜之后` : '片头';
  return {
    draft: buildAddDraft({ frame: { ...newFrame, index: draftPosLabel }, insertAfterIndex: draftPosition, type: projectType, baseUpdatedAt }),
    message: `我生成了一条新分镜草稿，建议放在${draftAfterLabel}，应用后大约会成为第 ${draftPosLabel} 镜。你可以先改位置、旁白和画面意图。`,
  };

  /*
  // 3) 插入到大纲
  const { outline: newOutline, insertAt } = insertFrameIntoOutline(currentOutline, newFrame, finalAfterIndex1);

  // 4) 重排 videoSource
  const realignedVS = realignVideoSource(newOutline, currentVideoSource);
  // 新分镜位置就是 insertAt，先把该位置清空（无旧画面）
  realignedVS.frames[insertAt] = { id: newFrame.id };

  const posLabel = insertAt + 1;
  const afterLabel = finalAfterIndex1 > 0 ? `第 ${finalAfterIndex1} 镜之后` : '合适的位置';
  return {
    outline: newOutline,
    videoSource: realignedVS,
    frame: newOutline.frames[insertAt],
    message: `已在${afterLabel}插入新分镜 #${posLabel}《${newFrame.title}》。请先检查内容，确认后再生成画面和旁白。`,
  };
  */
}

async function buildConversationContext(projectId: string, recentRounds: number): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });

  const normalized = messages
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: message.content.trim(),
    }))
    .filter(message => message.content);

  if (normalized.length === 0) return '';

  const firstUser = normalized.find(message => message.role === 'user');
  const rounds: Array<{ user: string; assistants: string[] }> = [];
  let currentRound: { user: string; assistants: string[] } | null = null;

  for (const message of normalized) {
    if (message.role === 'user') {
      if (currentRound) rounds.push(currentRound);
      currentRound = { user: message.content, assistants: [] };
      continue;
    }

    if (!currentRound) {
      currentRound = { user: '', assistants: [message.content] };
    } else {
      currentRound.assistants.push(message.content);
    }
  }

  if (currentRound) rounds.push(currentRound);

  const recent = rounds
    .filter((round, index) => !(index === 0 && firstUser && round.user === firstUser.content))
    .slice(-recentRounds);

  const parts: string[] = [];

  if (firstUser) {
    parts.push('【最开始的用户需求】');
    parts.push(firstUser.content);
  }

  if (recent.length > 0) {
    parts.push(`【最近${recent.length}轮对话】`);
    recent.forEach((round, index) => {
      parts.push(`第${index + 1}轮`);
      if (round.user) {
        parts.push(`用户：${round.user}`);
      }
      round.assistants.forEach(reply => {
        parts.push(`助手：${reply}`);
      });
    });
  }

  return parts.join('\n');
}

