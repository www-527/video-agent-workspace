'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { requestJson } from '@/components/content-style/request-json';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  ContentStylePromptView,
  ContentStyleSettingsView,
  PromptValidationResult,
  ProjectContentStyleConfig,
} from '@/lib/content-style/types';

export function ContentStyleSettingsDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}) {
  const [settings, setSettings] = useState<ContentStyleSettingsView | null>(null);
  const [prompts, setPrompts] = useState<ContentStylePromptView | null>(null);
  const [presetId, setPresetId] = useState('');
  const [plannerDrafts, setPlannerDrafts] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const promptSuffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const [settingsData, promptData, projectData] = await Promise.all([
        requestJson<ContentStyleSettingsView>('/api/settings/content-style'),
        requestJson<ContentStylePromptView>(`/api/settings/content-style/prompts${promptSuffix}`),
        projectId
          ? requestJson<{ contentStyle: ProjectContentStyleConfig }>(`/api/projects/${projectId}/content-style`)
            .catch(() => ({ contentStyle: { mode: 'inherit' as const } }))
          : Promise.resolve({ contentStyle: null }),
      ]);
      const projectStyle = projectData.contentStyle;
      const selectedPresetId = projectStyle?.mode === 'override' && projectStyle.presetId
        ? projectStyle.presetId
        : settingsData.activePresetId;
      setSettings(settingsData);
      setPrompts(promptData);
      setPresetId(selectedPresetId);
      setPlannerDrafts(Object.fromEntries(Object.entries(promptData.plannerPresets).map(([id, prompt]) => (
        [id, prompt.effectiveContent]
      ))));
      setInstruction(projectStyle?.mode === 'override'
        ? projectStyle.customInstruction || ''
        : projectId ? '' : settingsData.customInstruction);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const visiblePresets = useMemo(() => {
    if (!settings) return [];
    return settings.presets.filter(preset => (
      preset.id !== 'custom-only'
      && (preset.source === 'builtin' || preset.id === presetId)
    ));
  }, [presetId, settings]);

  const selectedPreset = visiblePresets.find(preset => preset.id === presetId);
  const selectedPlannerPrompt = prompts?.plannerPresets[presetId];
  const plannerPrompt = plannerDrafts[presetId] || '';

  function updatePlannerPrompt(content: string) {
    setPlannerDrafts(current => ({ ...current, [presetId]: content }));
  }

  async function savePreferences() {
    if (!settings || !prompts || !selectedPlannerPrompt || !presetId || !plannerPrompt.trim() || saving) return;
    setSaving(true);
    try {
      let expectedRevision = settings.revision;
      const nextPlannerPrompt = plannerPrompt.trim();
      if (nextPlannerPrompt !== selectedPlannerPrompt.effectiveContent.trim()) {
        const validation = await requestJson<PromptValidationResult>('/api/settings/content-style/prompts/validate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent: 'planner', content: nextPlannerPrompt }),
        });
        if (validation.level === 'invalid') {
          throw new Error(validation.issues.map(issue => issue.message).join('；') || '大纲专家提示词校验未通过');
        }

        const officialPrompt = selectedPlannerPrompt.defaultContent.trim();
        if (nextPlannerPrompt === officialPrompt && selectedPlannerPrompt.source === 'custom') {
          const nextSettings = await requestJson<ContentStyleSettingsView>('/api/settings/content-style/prompts/reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'planner', presetId, expectedRevision }),
          });
          expectedRevision = nextSettings.revision;
        } else {
          const savedPrompt = await requestJson<{ settings: ContentStyleSettingsView }>('/api/settings/content-style/prompts', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agent: 'planner',
              presetId,
              content: nextPlannerPrompt,
              expectedRevision,
              confirmWarnings: validation.level === 'warning',
            }),
          });
          expectedRevision = savedPrompt.settings.revision;
        }
      }

      if (projectId) {
        await requestJson(`/api/projects/${projectId}/content-style`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'override',
            presetId,
            customInstruction: instruction.trim(),
          }),
        });
      } else {
        await requestJson<ContentStyleSettingsView>('/api/settings/content-style', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision,
            activePresetId: presetId,
            customInstruction: instruction.trim(),
            customPresets: settings.customPresets,
          }),
        });
      }
      toast.success('内容提示词已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>内容提示词</DialogTitle>
          <DialogDescription>
            每种表达方式都有独立的大纲专家提示词，切换后可直接查看和修改。
          </DialogDescription>
        </DialogHeader>

        {loading || !settings || !prompts ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />读取提示词…
          </div>
        ) : (
          <div className="flex flex-col gap-5 py-2">
            <section className="flex flex-col gap-2">
              <Label htmlFor="content-preference-preset">表达方式</Label>
              <select
                id="content-preference-preset"
                value={presetId}
                onChange={event => setPresetId(event.target.value)}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                {visiblePresets.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
              {selectedPreset ? (
                <p className="text-sm leading-6 text-muted-foreground">切换后，下方提示词会同步使用对应的结构、节奏和内容规划方式：{selectedPreset.description}</p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="content-planner-prompt">大纲专家提示词</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updatePlannerPrompt(selectedPlannerPrompt?.defaultContent || '')}
                  disabled={!selectedPlannerPrompt || plannerPrompt.trim() === selectedPlannerPrompt.defaultContent.trim()}
                >
                  <RotateCcw data-icon="inline-start" />重置为默认
                </Button>
              </div>
              <Textarea
                id="content-planner-prompt"
                rows={10}
                value={plannerPrompt}
                onChange={event => updatePlannerPrompt(event.target.value)}
                className="font-mono text-xs leading-5"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                修改只保存到当前表达方式，并影响之后使用该表达方式的新大纲任务。固定输出格式、事实约束及画面规则不会在这里显示或被覆盖。
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <Label htmlFor="content-preference-instruction">补充要求（可选）</Label>
              <Textarea
                id="content-preference-instruction"
                rows={4}
                value={instruction}
                onChange={event => setInstruction(event.target.value)}
                placeholder="例如：面向第一次接触这个主题的观众，避免夸张表达。"
              />
              <p className="text-xs text-muted-foreground">
                {projectId ? '作为当前项目的额外提示词发送，不会修改其他项目。' : '作为之后项目的默认补充提示词。'}
              </p>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button type="button" onClick={() => void savePreferences()} disabled={!settings || !prompts || !selectedPlannerPrompt || !presetId || !plannerPrompt.trim() || saving || loading}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
            保存提示词
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
