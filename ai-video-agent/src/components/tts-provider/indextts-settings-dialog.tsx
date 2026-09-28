'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, Loader2, PlugZap, Plus, Power, PowerOff, RotateCcw, Save, Trash2, Upload, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type EmotionMode = 'same_voice' | 'reference_audio' | 'vector' | 'text';
type AdapterMode = 'api' | 'gradio';
type PreviewPhase = 'idle' | 'preparing' | 'generating' | 'playing' | 'done';

interface IndexTtsVoice {
  name: string;
  path: string;
}

interface IndexTtsStatus {
  loaded?: boolean;
  device?: string;
  queueLength?: number;
  currentJobId?: string | null;
  version?: string;
}

interface IndexTtsRole {
  name: string;
  referenceId: string;
  referenceAudio: string;
  speed: number;
}

interface IndexTtsGlossaryTerm {
  term: string;
  zh: string;
  en: string;
}

interface IndexTtsSettings {
  baseUrl: string;
  apiBaseUrl: string;
  gradioBaseUrl: string;
  adapterMode: AdapterMode;
  speaker: string;
  voice: string;
  presetId: string;
  referenceId: string;
  referenceAudio: string;
  speed: number;
  temperature: number;
  topP: number;
  topK: number;
  format: 'mp3' | 'wav';
  timeoutMs: number;
  emotion: {
    mode: EmotionMode;
    weight: number;
    preset: string;
    referenceId: string;
    referenceAudio: string;
    vector: Record<EmotionName, number>;
    text: string;
  };
  multiSpeaker: {
    enabled: boolean;
    roles: IndexTtsRole[];
  };
  glossary: {
    enabled: boolean;
    terms: IndexTtsGlossaryTerm[];
  };
  generation: {
    doSample: boolean;
    temperature: number;
    topP: number;
    topK: number;
    numBeams: number;
    repetitionPenalty: number;
    lengthPenalty: number;
    maxMelTokens: number;
  };
  sentence: {
    sentenceMaxTokens: number;
  };
}

interface IndexTtsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EmotionName = typeof EMOTION_NAMES[number];

const EMOTION_NAMES = ['喜', '怒', '哀', '惧', '厌恶', '低落', '惊喜', '平静'] as const;
const EMOTION_PRESETS = ['高兴', '生气', '悲伤', '害怕', '厌恶', '低落', '惊喜', '平静'];

const EMPTY_SETTINGS: IndexTtsSettings = {
  baseUrl: 'http://127.0.0.1:9000',
  apiBaseUrl: 'http://127.0.0.1:9010',
  gradioBaseUrl: 'http://127.0.0.1:9000',
  adapterMode: 'api',
  speaker: '',
  voice: '',
  presetId: '',
  referenceId: '',
  referenceAudio: '',
  speed: 1,
  temperature: 0.8,
  topP: 0.8,
  topK: 30,
  format: 'mp3',
  timeoutMs: 120000,
  emotion: {
    mode: 'same_voice',
    weight: 0.65,
    preset: '',
    referenceId: '',
    referenceAudio: '',
    vector: {
      喜: 0,
      怒: 0,
      哀: 0,
      惧: 0,
      厌恶: 0,
      低落: 0,
      惊喜: 0,
      平静: 0,
    },
    text: '',
  },
  multiSpeaker: {
    enabled: false,
    roles: [],
  },
  glossary: {
    enabled: false,
    terms: [],
  },
  generation: {
    doSample: true,
    temperature: 0.8,
    topP: 0.8,
    topK: 30,
    numBeams: 3,
    repetitionPenalty: 10,
    lengthPenalty: 0,
    maxMelTokens: 1500,
  },
  sentence: {
    sentenceMaxTokens: 120,
  },
};

const DEFAULT_OPEN_SECTIONS = {
  emotion: true,
  multiSpeaker: false,
  glossary: false,
  generation: false,
};

const PREVIEW_TEXT = '这是一段 IndexTTS 音色试听。';

const GENERATION_HELP = {
  doSample: '是否启用随机采样。开启后声音细节和语气更有变化，但同一文本每次可能略有不同；关闭后更稳定、更可复现，但表达可能更平。',
  temperature: '控制采样随机性。数值越高，语气和节奏越活跃，也更容易出现不稳定；数值越低，输出更稳、更保守，但可能显得机械。',
  topP: '控制候选 token 的累计概率范围。数值越高，模型选择空间越大，表达更丰富；数值越低，选择更集中，稳定性更好但变化减少。',
  topK: '限制每一步只从概率最高的 K 个候选中选择。数值越高，变化更大；数值越低，发音更可控，但可能压缩自然度。',
  numBeams: '束搜索数量，用于寻找更优生成路径。数值越高通常更稳，但生成更慢，也可能让表达更克制；数值较低速度更快。',
  repetitionPenalty: '重复惩罚，减少重复音节、拖音或循环。数值越高越抑制重复，但过高可能让语音断裂或发音不自然；过低更自然但可能重复。',
  lengthPenalty: '长度惩罚，影响生成倾向的音频长度。正值更倾向较长、更完整的表达；负值更倾向较短输出，过强可能截断或节奏过急。',
  maxMelTokens: '单次生成的最大 mel token 数，决定最长音频片段上限。数值越大可容纳更长句子，但更慢、更占显存；过小可能截断。',
  sentenceMaxTokens: '分句最大长度，决定长文本切成多短的片段。数值越小停顿更密、稳定性更好；数值越大语流更连贯，但长句失败风险更高。',
} as const;

export function IndexTtsSettingsDialog({ open, onOpenChange }: IndexTtsSettingsDialogProps) {
  const [settings, setSettings] = useState<IndexTtsSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [serviceRunning, setServiceRunning] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [uploadingEmotionAudio, setUploadingEmotionAudio] = useState(false);
  const [sections, setSections] = useState(DEFAULT_OPEN_SECTIONS);
  const [draftTerm, setDraftTerm] = useState<IndexTtsGlossaryTerm>({ term: '', zh: '', en: '' });
  const [voices, setVoices] = useState<IndexTtsVoice[]>([]);
  const [serviceStatus, setServiceStatus] = useState<IndexTtsStatus | null>(null);
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('idle');
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/settings/indextts')
      .then(async response => {
        if (!response.ok) throw new Error('读取 IndexTTS 参数失败');
        return response.json() as Promise<IndexTtsSettings>;
      })
      .then(payload => {
        setSettings(normalizeClientSettings(payload));
        loadVoices();
      })
      .catch(error => toast.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (open) return;
    stopPreviewAudio();
  }, [open]);

  useEffect(() => () => stopPreviewAudio(false), []);

  const sentencePreview = useMemo(() => {
    const sample = '这是一段用于预览分句的旁白文本。你可以通过 sentenceMaxTokens 控制每段合成的长度，较短的分句更稳，较长的分句更连贯。';
    return splitPreviewSentences(sample, settings.sentence.sentenceMaxTokens);
  }, [settings.sentence.sentenceMaxTokens]);

  function update<K extends keyof IndexTtsSettings>(key: K, value: IndexTtsSettings[K]) {
    setSettings(current => ({ ...current, [key]: value }));
  }

  async function loadVoices() {
    try {
      const response = await fetch('/api/settings/indextts/voices');
      const payload = await response.json().catch(() => ({})) as { voices?: IndexTtsVoice[] };
      if (response.ok) setVoices(payload.voices ?? []);
    } catch {
      setVoices([]);
    }
  }

  function updateEmotion(value: Partial<IndexTtsSettings['emotion']>) {
    setSettings(current => ({ ...current, emotion: { ...current.emotion, ...value } }));
  }

  function updateGeneration(value: Partial<IndexTtsSettings['generation']>) {
    setSettings(current => ({ ...current, generation: { ...current.generation, ...value } }));
  }

  function updateSentence(value: Partial<IndexTtsSettings['sentence']>) {
    setSettings(current => ({ ...current, sentence: { ...current.sentence, ...value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/indextts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const payload = await response.json().catch(() => ({})) as Partial<IndexTtsSettings> & { error?: string };
      if (!response.ok) throw new Error(payload.error || '保存 IndexTTS 参数失败');
      setSettings(normalizeClientSettings(payload as IndexTtsSettings));
      toast.success('IndexTTS 参数已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const response = await fetch('/api/settings/indextts/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; status?: IndexTtsStatus };
      setServiceStatus(payload.status ?? null);
      if (!response.ok) throw new Error(payload.error || 'IndexTTS 连接失败');
      toast.success('IndexTTS 连接正常');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function handlePreviewVoice() {
    const voice = settings.voice.trim();
    if (!voice) {
      toast.error('请先选择音色');
      return;
    }
    if (isPreviewing) return;

    stopPreviewAudio();
    setPreviewProgress(0);
    setPreviewPhase('preparing');

    try {
      await Promise.resolve();
      setPreviewPhase('generating');
      const response = await fetch('/api/settings/indextts/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, voice, text: PREVIEW_TEXT }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; url?: string; duration?: number };
      if (!response.ok || !payload.url) throw new Error(payload.error || 'IndexTTS 试听生成失败');

      setPreviewPhase('playing');
      await playPreviewAudio(payload.url, payload.duration);
      setPreviewPhase('idle');
      setPreviewProgress(0);
    } catch (error) {
      setPreviewPhase('idle');
      setPreviewProgress(0);
      toast.error((error as Error).message);
    } finally {
      previewAudioRef.current = null;
    }
  }

  async function handlePlayOriginalVoice() {
    const voice = settings.voice.trim();
    if (!voice) {
      toast.error('请先选择音色');
      return;
    }
    if (isPreviewing) return;

    stopPreviewAudio();
    setPreviewProgress(0);
    setPreviewPhase('preparing');

    try {
      setPreviewPhase('playing');
      await playPreviewAudio(`/api/settings/indextts/voices/audio?name=${encodeURIComponent(voice)}`);
      setPreviewPhase('idle');
      setPreviewProgress(0);
    } catch (error) {
      setPreviewPhase('idle');
      setPreviewProgress(0);
      toast.error((error as Error).message);
    } finally {
      previewAudioRef.current = null;
    }
  }

  async function handleToggleService() {
    setServiceBusy(true);
    try {
      const nextRunning = !serviceRunning;
      const response = await fetch(
        nextRunning ? '/api/settings/indextts/start' : '/api/settings/indextts/stop',
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || (nextRunning ? '启动 IndexTTS 服务失败' : '关闭 IndexTTS 服务失败'));
      }
      setServiceRunning(nextRunning);
      toast.success(payload.message || (nextRunning ? 'IndexTTS 服务已启动' : 'IndexTTS 服务已关闭'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setServiceBusy(false);
    }
  }

  async function uploadEmotionAudio(file: File | undefined) {
    if (!file) return;
    setUploadingEmotionAudio(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/settings/indextts/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({})) as { referenceId?: string; path?: string; filename?: string; error?: string };
      if (!response.ok || !payload.path) throw new Error(payload.error || '上传情感参考音频失败');
      updateEmotion({ referenceId: payload.referenceId || '', referenceAudio: payload.referenceId ? '' : payload.path || '' });
      toast.success(`已上传：${payload.filename || file.name}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploadingEmotionAudio(false);
    }
  }

  function addRole() {
    setSettings(current => ({
      ...current,
      multiSpeaker: {
        ...current.multiSpeaker,
        roles: [...current.multiSpeaker.roles, { name: '', referenceId: '', referenceAudio: '', speed: 1 }],
      },
    }));
  }

  function updateRole(index: number, value: Partial<IndexTtsRole>) {
    setSettings(current => ({
      ...current,
      multiSpeaker: {
        ...current.multiSpeaker,
        roles: current.multiSpeaker.roles.map((role, roleIndex) => (
          roleIndex === index ? { ...role, ...value } : role
        )),
      },
    }));
  }

  function removeRole(index: number) {
    setSettings(current => ({
      ...current,
      multiSpeaker: {
        ...current.multiSpeaker,
        roles: current.multiSpeaker.roles.filter((_, roleIndex) => roleIndex !== index),
      },
    }));
  }

  function addTerm() {
    const term = {
      term: draftTerm.term.trim(),
      zh: draftTerm.zh.trim(),
      en: draftTerm.en.trim(),
    };
    if (!term.term || (!term.zh && !term.en)) {
      toast.error('请填写术语，并至少填写一种读法');
      return;
    }
    setSettings(current => ({
      ...current,
      glossary: {
        ...current.glossary,
        terms: [...current.glossary.terms.filter(item => item.term !== term.term), term],
      },
    }));
    setDraftTerm({ term: '', zh: '', en: '' });
  }

  function removeTerm(index: number) {
    setSettings(current => ({
      ...current,
      glossary: {
        ...current.glossary,
        terms: current.glossary.terms.filter((_, termIndex) => termIndex !== index),
      },
    }));
  }

  const isPreviewing = previewPhase === 'preparing' || previewPhase === 'generating' || previewPhase === 'playing';
  const previewLabel = getPreviewLabel(previewPhase);

  function stopPreviewAudio(resetState = true) {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (!resetState) return;
    setPreviewProgress(0);
    setPreviewPhase('idle');
  }

  function playPreviewAudio(url: string, duration?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
      previewAudioRef.current = audio;

      const cleanup = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };
      const getDuration = () => (
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : Math.max(1, duration ?? 1)
      );
      const handleTimeUpdate = () => {
        setPreviewProgress(Math.min(100, (audio.currentTime / getDuration()) * 100));
      };
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('音频播放失败'));
      };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);
      audio.play().catch(error => {
        cleanup();
        reject(error);
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>IndexTTS 参数设置</DialogTitle>
          <DialogDescription>
            配置本地 IndexTTS Gradio 服务地址、参考音频、情感控制和生成参数。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            读取 IndexTTS 参数...
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="连接模式">
                <select
                  value={settings.adapterMode}
                  onChange={event => update('adapterMode', event.target.value as AdapterMode)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="api">API</option>
                  <option value="gradio">Gradio</option>
                </select>
              </Field>
              <Field label="API 地址">
                <Input value={settings.apiBaseUrl} onChange={event => update('apiBaseUrl', event.target.value)} />
              </Field>
              <Field label="Gradio 地址">
                <Input
                  value={settings.gradioBaseUrl}
                  onChange={event => setSettings(current => ({
                    ...current,
                    gradioBaseUrl: event.target.value,
                    baseUrl: event.target.value,
                  }))}
                />
              </Field>
            </div>

            {serviceStatus && (
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-4">
                <span>loaded: {serviceStatus.loaded ? 'yes' : 'no'}</span>
                <span>device: {serviceStatus.device || '-'}</span>
                <span>queue: {serviceStatus.queueLength ?? 0}</span>
                <span>version: {serviceStatus.version || '-'}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="音色/说话人">
                <div className="grid gap-2">
                  <div className="flex min-w-0 gap-2">
                  {voices.length > 0 ? (
                    <select
                      value={settings.voice}
                      onChange={event => update('voice', event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="">不使用预设</option>
                      {voices.map(voice => (
                        <option key={voice.path} value={voice.name}>{voice.name}</option>
                      ))}
                    </select>
                  ) : (
                    <Input value={settings.voice} onChange={event => update('voice', event.target.value)} />
                  )}
                  <Button variant="outline" size="icon" onClick={loadVoices} title="刷新预设音色">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePlayOriginalVoice}
                    disabled={isPreviewing}
                    title="试听当前音色"
                  >
                    {isPreviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
                    {previewLabel}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePreviewVoice}
                    disabled={isPreviewing}
                    title="用当前音色合成试听文本"
                  >
                    合成试听
                  </Button>
                  </div>
                  {previewPhase === 'playing' && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{ width: `${previewProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              </Field>
            </div>

            <Field label="参考音频路径">
              <Input
                value={settings.referenceAudio}
                onChange={event => update('referenceAudio', event.target.value)}
                placeholder="C:\path\to\voice.wav"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <SliderNumberField label="语速" value={settings.speed} min={0.5} max={1.5} step={0.05} onChange={value => update('speed', value)} />
              <Field label="输出格式">
                <select
                  value={settings.format}
                  onChange={event => update('format', event.target.value as 'mp3' | 'wav')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                </select>
              </Field>
              <NumberField label="超时时间(ms)" value={settings.timeoutMs} min={1000} max={600000} step={1000} onChange={value => update('timeoutMs', value)} />
            </div>

            <CollapsibleSection
              title="情感控制"
              open={sections.emotion}
              onToggle={() => setSections(current => ({ ...current, emotion: !current.emotion }))}
            >
              <Field label="情感控制方式">
                <select
                  value={settings.emotion.mode}
                  onChange={event => updateEmotion({ mode: event.target.value as EmotionMode })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="same_voice">与音色参考音频相同</option>
                  <option value="reference_audio">使用情感参考音频</option>
                  <option value="vector">使用情感向量控制</option>
                  <option value="text">使用情感描述文本控制</option>
                </select>
              </Field>

              {settings.emotion.mode !== 'same_voice' && (
                <SliderNumberField
                  label="情感权重"
                  value={settings.emotion.weight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={value => updateEmotion({ weight: value })}
                />
              )}

              {settings.emotion.mode === 'reference_audio' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="预设情感">
                    <select
                      value={settings.emotion.preset}
                      onChange={event => updateEmotion({ preset: event.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="">不使用预设</option>
                      {EMOTION_PRESETS.map(preset => <option key={preset} value={preset}>{preset}</option>)}
                    </select>
                  </Field>
                  <Field label="上传情感参考音频">
                    <div className="flex min-w-0 gap-2">
                      <Input
                        value={fileNameFromPath(settings.emotion.referenceAudio)}
                        readOnly
                        placeholder="未上传"
                      />
                      <Button variant="outline" size="icon" disabled={uploadingEmotionAudio} asChild>
                        <label className="cursor-pointer" title="上传情感参考音频">
                          {uploadingEmotionAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          <input
                            type="file"
                            accept="audio/*"
                            className="sr-only"
                            onChange={event => uploadEmotionAudio(event.target.files?.[0])}
                          />
                        </label>
                      </Button>
                    </div>
                  </Field>
                </div>
              )}

              {settings.emotion.mode === 'vector' && (
                <div className="grid gap-4 md:grid-cols-2">
                  {EMOTION_NAMES.map(name => (
                    <SliderNumberField
                      key={name}
                      label={name}
                      value={settings.emotion.vector[name]}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={value => updateEmotion({
                        vector: { ...settings.emotion.vector, [name]: value },
                      })}
                    />
                  ))}
                </div>
              )}

              {settings.emotion.mode === 'text' && (
                <Field label="情感描述文本">
                  <Textarea
                    value={settings.emotion.text}
                    onChange={event => updateEmotion({ text: event.target.value })}
                    placeholder="例如：温柔、克制、带一点惊喜感"
                  />
                </Field>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="多角色配音"
              open={sections.multiSpeaker}
              onToggle={() => setSections(current => ({ ...current, multiSpeaker: !current.multiSpeaker }))}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label="启用多角色配音"
                    checked={settings.multiSpeaker.enabled}
                    onCheckedChange={checked => setSettings(current => ({
                      ...current,
                      multiSpeaker: { ...current.multiSpeaker, enabled: checked },
                    }))}
                  />
                  <span className="text-sm">启用多角色配音</span>
                </div>
                <Button variant="outline" size="sm" onClick={addRole}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加角色
                </Button>
              </div>
              <div className="grid gap-3">
                {settings.multiSpeaker.roles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无角色，点击“添加角色”创建角色槽位。</p>
                ) : settings.multiSpeaker.roles.map((role, index) => (
                  <div key={index} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_140px_auto]">
                    <Field label="角色名">
                      <Input value={role.name} onChange={event => updateRole(index, { name: event.target.value })} />
                    </Field>
                    <Field label="参考音色">
                      <Input value={role.referenceAudio} onChange={event => updateRole(index, { referenceAudio: event.target.value })} />
                    </Field>
                    <NumberField label="语速" value={role.speed} min={0.5} max={1.5} step={0.05} onChange={value => updateRole(index, { speed: value })} />
                    <Button className="self-end" variant="outline" size="icon" onClick={() => removeRole(index)} title="删除角色">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="术语词汇读音"
              open={sections.glossary}
              onToggle={() => setSections(current => ({ ...current, glossary: !current.glossary }))}
            >
              <div className="flex items-center gap-2">
                <Switch
                  aria-label="开启术语词汇读音"
                  checked={settings.glossary.enabled}
                  onCheckedChange={checked => setSettings(current => ({
                    ...current,
                    glossary: { ...current.glossary, enabled: checked },
                  }))}
                />
                <span className="text-sm">开启术语词汇读音</span>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label="术语">
                  <Input value={draftTerm.term} onChange={event => setDraftTerm(current => ({ ...current, term: event.target.value }))} />
                </Field>
                <Field label="中文读法">
                  <Input value={draftTerm.zh} onChange={event => setDraftTerm(current => ({ ...current, zh: event.target.value }))} />
                </Field>
                <Field label="英文读法">
                  <Input value={draftTerm.en} onChange={event => setDraftTerm(current => ({ ...current, en: event.target.value }))} />
                </Field>
                <Button className="self-end" variant="outline" onClick={addTerm}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加
                </Button>
              </div>
              <div className="grid gap-2">
                {settings.glossary.terms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无术语。</p>
                ) : settings.glossary.terms.map((term, index) => (
                  <div key={`${term.term}-${index}`} className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[1fr_1fr_1fr_auto]">
                    <span className="font-medium">{term.term}</span>
                    <span>{term.zh || '-'}</span>
                    <span>{term.en || '-'}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeTerm(index)} title="删除术语">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="高级生成参数"
              open={sections.generation}
              onToggle={() => setSections(current => ({ ...current, generation: !current.generation }))}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label="切换 do_sample 随机采样"
                    checked={settings.generation.doSample}
                    onCheckedChange={checked => updateGeneration({ doSample: checked })}
                  />
                  <span className="text-sm">do_sample</span>
                  <ParameterHelp content={GENERATION_HELP.doSample} />
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  updateGeneration(EMPTY_SETTINGS.generation);
                  updateSentence(EMPTY_SETTINGS.sentence);
                }}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重置
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <SliderNumberField label="temperature" help={GENERATION_HELP.temperature} value={settings.generation.temperature} min={0.1} max={2} step={0.1} onChange={value => updateGeneration({ temperature: value })} />
                <SliderNumberField label="top_p" help={GENERATION_HELP.topP} value={settings.generation.topP} min={0} max={1} step={0.01} onChange={value => updateGeneration({ topP: value })} />
                <NumberField label="top_k" help={GENERATION_HELP.topK} value={settings.generation.topK} min={0} max={100} step={1} onChange={value => updateGeneration({ topK: value })} />
                <NumberField label="num_beams" help={GENERATION_HELP.numBeams} value={settings.generation.numBeams} min={1} max={20} step={1} onChange={value => updateGeneration({ numBeams: value })} />
                <NumberField label="repetition_penalty" help={GENERATION_HELP.repetitionPenalty} value={settings.generation.repetitionPenalty} min={0} max={30} step={0.1} onChange={value => updateGeneration({ repetitionPenalty: value })} />
                <NumberField label="length_penalty" help={GENERATION_HELP.lengthPenalty} value={settings.generation.lengthPenalty} min={-10} max={10} step={0.1} onChange={value => updateGeneration({ lengthPenalty: value })} />
                <NumberField label="max_mel_tokens" help={GENERATION_HELP.maxMelTokens} value={settings.generation.maxMelTokens} min={1} max={5000} step={1} onChange={value => updateGeneration({ maxMelTokens: value })} />
                <NumberField label="sentenceMaxTokens" help={GENERATION_HELP.sentenceMaxTokens} value={settings.sentence.sentenceMaxTokens} min={1} max={500} step={1} onChange={value => updateSentence({ sentenceMaxTokens: value })} />
              </div>
              <Field label="预览分句结果">
                <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                  {sentencePreview.map((sentence, index) => (
                    <div key={index} className="grid gap-1">
                      <span className="text-xs text-muted-foreground">#{index + 1}</span>
                      <span>{sentence}</span>
                    </div>
                  ))}
                </div>
              </Field>
            </CollapsibleSection>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || testing || serviceBusy}>
            取消
          </Button>
          <Button variant="outline" onClick={handleToggleService} disabled={loading || saving || testing || serviceBusy}>
            {serviceBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : serviceRunning ? (
              <PowerOff className="mr-2 h-4 w-4" />
            ) : (
              <Power className="mr-2 h-4 w-4" />
            )}
            {serviceRunning ? '关闭服务' : '启动服务'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={loading || saving || testing || serviceBusy}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
            测试连接
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || testing || serviceBusy}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function normalizeClientSettings(value: Partial<IndexTtsSettings>): IndexTtsSettings {
  const gradioBaseUrl = value.gradioBaseUrl || value.baseUrl || EMPTY_SETTINGS.gradioBaseUrl;
  return {
    ...EMPTY_SETTINGS,
    ...value,
    baseUrl: gradioBaseUrl,
    apiBaseUrl: value.apiBaseUrl || EMPTY_SETTINGS.apiBaseUrl,
    gradioBaseUrl,
    adapterMode: value.adapterMode || EMPTY_SETTINGS.adapterMode,
    voice: value.voice || value.speaker || EMPTY_SETTINGS.voice,
    emotion: {
      ...EMPTY_SETTINGS.emotion,
      ...value.emotion,
      vector: {
        ...EMPTY_SETTINGS.emotion.vector,
        ...value.emotion?.vector,
      },
    },
    multiSpeaker: {
      ...EMPTY_SETTINGS.multiSpeaker,
      ...value.multiSpeaker,
      roles: value.multiSpeaker?.roles ?? [],
    },
    glossary: {
      ...EMPTY_SETTINGS.glossary,
      ...value.glossary,
      terms: value.glossary?.terms ?? [],
    },
    generation: {
      ...EMPTY_SETTINGS.generation,
      temperature: value.temperature ?? EMPTY_SETTINGS.generation.temperature,
      topP: value.topP ?? EMPTY_SETTINGS.generation.topP,
      topK: value.topK ?? EMPTY_SETTINGS.generation.topK,
      ...value.generation,
    },
    sentence: {
      ...EMPTY_SETTINGS.sentence,
      ...value.sentence,
    },
  };
}

function getPreviewLabel(phase: PreviewPhase): string {
  if (phase === 'preparing') return '准备中';
  if (phase === 'generating') return '生成中';
  if (phase === 'playing') return '播放中';
  if (phase === 'done') return '完成';
  return '试听';
}

function splitPreviewSentences(text: string, maxLength: number): string[] {
  const chars = Array.from(text);
  const size = Math.max(1, Math.min(maxLength, 500));
  const segments: string[] = [];
  for (let index = 0; index < chars.length; index += size) {
    segments.push(chars.slice(index, index + size).join(''));
  }
  return segments;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {help && <ParameterHelp content={help} />}
      </div>
      {children}
    </div>
  );
}

function ParameterHelp({ content }: { content: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="查看参数说明"
        title={content}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-0 top-6 z-50 hidden w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-popover px-3 py-2 text-left text-xs leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-within:block">
        {content}
      </span>
    </span>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t pt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold"
        onClick={onToggle}
      >
        <span>{title}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="grid gap-4">{children}</div>}
    </section>
  );
}

function NumberField({
  label,
  help,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} help={help}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(clampNumber(Number(event.target.value), min, max))}
      />
    </Field>
  );
}

function SliderNumberField(props: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const { label, help, value, min, max, step, onChange } = props;
  return (
    <Field label={label} help={help}>
      <div className="grid grid-cols-[1fr_88px] items-center gap-3">
        <Input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={event => onChange(clampNumber(Number(event.target.value), min, max))}
          className="px-0"
        />
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={event => onChange(clampNumber(Number(event.target.value), min, max))}
        />
      </div>
    </Field>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
