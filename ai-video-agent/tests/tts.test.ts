import { describe, expect, it } from 'vitest';
import { POST as previewIndexTts } from '@/app/api/settings/indextts/preview/route';
import { buildIndexTtsApiPayload, getIndexTtsJobTimeoutMs, splitTextForTencentTts } from '@/lib/ai/tts';
import {
  defaultIndexTtsSettings,
  indexTtsSettingsSchema,
  normalizeIndexTtsSettings,
} from '@/lib/indextts-settings';
import { normalizeTtsProvider } from '@/lib/tts-provider';
import { getFrameSourceForOutlineFrame, normalizeVideoSourceForFrames, withRegeneratedNarration } from '@/lib/video-source';

describe('splitTextForTencentTts', () => {
  it('优先按自然标点切分，并保留完整文本', () => {
    const text = '第一句话。第二句话比较长，但是仍然应该保持自然。第三句话！';
    const segments = splitTextForTencentTts(text, 18);

    expect(segments.every(segment => Array.from(segment).length <= 18)).toBe(true);
    expect(segments.join('')).toBe(text);
  });

  it('会切开超过腾讯云单次限制的超长句子', () => {
    const text = '长'.repeat(301);
    const segments = splitTextForTencentTts(text);

    expect(segments.map(segment => Array.from(segment).length)).toEqual([140, 140, 21]);
    expect(segments.join('')).toBe(text);
  });

  it('忽略空白文本', () => {
    expect(splitTextForTencentTts('  \n ')).toEqual([]);
  });
});

describe('IndexTTS extended settings', () => {
  it('为后台长旁白保留足够的任务等待时间', () => {
    expect(getIndexTtsJobTimeoutMs(120_000)).toBe(600_000);
    expect(getIndexTtsJobTimeoutMs(900_000)).toBe(900_000);
  });

  it('merges defaults for newly added fields', () => {
    const normalized = normalizeIndexTtsSettings({
      baseUrl: 'http://127.0.0.1:9000',
      referenceAudio: 'voice.wav',
    });

    expect(normalized.adapterMode).toBe('api');
    expect(normalized.apiBaseUrl).toBe('http://127.0.0.1:9010');
    expect(normalized.gradioBaseUrl).toBe('http://127.0.0.1:9000');
    expect(normalized.emotion).toMatchObject({ mode: 'same_voice', weight: 0.65 });
    expect(normalized.multiSpeaker.roles).toEqual([]);
    expect(normalized.glossary.terms).toEqual([]);
    expect(normalized.generation).toMatchObject({
      temperature: 0.8,
      topP: 0.8,
      topK: 30,
      numBeams: 3,
      repetitionPenalty: 10,
      lengthPenalty: 0,
      maxMelTokens: 1500,
    });
    expect(normalized.sentence.sentenceMaxTokens).toBe(120);
  });

  it('validates emotion mode and vector ranges', () => {
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      emotion: { ...defaultIndexTtsSettings.emotion, mode: 'text', text: 'calm' },
    }).success).toBe(true);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      emotion: { ...defaultIndexTtsSettings.emotion, mode: 'bad-mode' },
    }).success).toBe(false);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      emotion: {
        ...defaultIndexTtsSettings.emotion,
        mode: 'vector',
        vector: { ...defaultIndexTtsSettings.emotion.vector, 喜: 1.2 },
      },
    }).success).toBe(false);
  });

  it('filters invalid multi-speaker roles and glossary terms', () => {
    const normalized = normalizeIndexTtsSettings({
      ...defaultIndexTtsSettings,
      multiSpeaker: {
        enabled: true,
        roles: [
          { name: '旁白', referenceAudio: 'voice.wav', speed: 1 },
          { name: '   ', referenceAudio: '   ', speed: 1 },
        ],
      },
      glossary: {
        enabled: true,
        terms: [
          { term: 'IndexTTS', zh: 'Index T T S', en: '' },
          { term: '   ', zh: '   ', en: '' },
        ],
      },
    });

    expect(normalized.multiSpeaker.roles).toHaveLength(1);
    expect(normalized.multiSpeaker.roles[0]).toMatchObject({ name: '旁白', referenceAudio: 'voice.wav' });
    expect(normalized.glossary.terms).toHaveLength(1);
    expect(normalized.glossary.terms[0]).toMatchObject({ term: 'IndexTTS', zh: 'Index T T S' });
  });

  it('validates advanced generation ranges', () => {
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      generation: { ...defaultIndexTtsSettings.generation, maxMelTokens: 5000 },
      sentence: { sentenceMaxTokens: 500 },
    }).success).toBe(true);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      generation: { ...defaultIndexTtsSettings.generation, numBeams: 0 },
    }).success).toBe(false);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      sentence: { sentenceMaxTokens: 0 },
    }).success).toBe(false);
  });

  it('builds stable IndexTTS API payloads', () => {
    const settings = normalizeIndexTtsSettings({
      ...defaultIndexTtsSettings,
      presetId: 'preset_main',
      referenceId: 'ref_main',
      referenceAudio: '',
      voice: 'default.wav',
      speed: 1.1,
      emotion: {
        ...defaultIndexTtsSettings.emotion,
        mode: 'text',
        referenceId: 'ref_emotion',
        text: 'calm',
      },
      multiSpeaker: {
        enabled: true,
        roles: [{ name: 'Narrator', referenceId: 'ref_role', referenceAudio: '', speed: 1 }],
      },
    });

    const payload = buildIndexTtsApiPayload('hello', settings);

    expect(payload).toMatchObject({
      text: 'hello',
      presetId: 'preset_main',
      referenceId: 'ref_main',
      referenceAudio: '',
      voice: 'default.wav',
      speed: 1.1,
      emotion: { mode: 'text', referenceId: 'ref_emotion', text: 'calm' },
      multiSpeaker: { roles: [{ referenceId: 'ref_role' }] },
      generation: settings.generation,
      sentence: settings.sentence,
    });
    expect(payload.emotion.vectorValues).toHaveLength(8);
  });

  it('falls back to speaker when building IndexTTS API payloads without voice', () => {
    const settings = normalizeIndexTtsSettings({
      ...defaultIndexTtsSettings,
      voice: '',
      speaker: 'legacy.wav',
    });

    expect(buildIndexTtsApiPayload('hello', settings).voice).toBe('legacy.wav');
  });

  it('keeps legacy speaker-only settings parseable', () => {
    const { voice: _voice, ...legacySettings } = {
      ...defaultIndexTtsSettings,
      speaker: 'legacy.wav',
    };
    const normalized = normalizeIndexTtsSettings(legacySettings);

    expect(normalized.speaker).toBe('legacy.wav');
    expect(normalized.voice).toBe('');
  });
});

describe('IndexTTS preview API', () => {
  it('requires a selected voice', async () => {
    const response = await previewIndexTts(new Request('http://localhost/api/settings/indextts/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...defaultIndexTtsSettings,
        voice: '',
        text: 'preview',
      }),
    }));
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('请先选择音色');
  });
});

describe('normalizeTtsProvider', () => {
  it('接受受支持的 TTS 服务', () => {
    expect(normalizeTtsProvider('none')).toBe('none');
    expect(normalizeTtsProvider('edge')).toBe('edge');
    expect(normalizeTtsProvider('tencent')).toBe('tencent');
    expect(normalizeTtsProvider('indextts')).toBe('indextts');
  });

  it('未知值回退到腾讯云', () => {
    expect(normalizeTtsProvider('unknown')).toBe('tencent');
    expect(normalizeTtsProvider()).toBe('tencent');
  });
});

describe('withRegeneratedNarration', () => {
  it('保留已有画面字段，只替换旁白音频', () => {
    const frames = withRegeneratedNarration(
      { frames: [{ id: 'frame-1', imagePath: '/image.png', audioPath: '/old.mp3', audioDuration: 1 }] },
      0,
      'frame-1',
      { url: '/new.mp3', duration: 2.5 },
    );

    expect(frames[0]).toEqual({
      id: 'frame-1',
      imagePath: '/image.png',
      audioPath: '/new.mp3',
      audioDuration: 2.5,
    });
  });

  it('为空 source 写入对应分镜 id', () => {
    const frames = withRegeneratedNarration(undefined, 1, 'frame-2', {
      url: '/frame-2.mp3',
      duration: 3,
    });

    expect(frames[1]).toEqual({
      id: 'frame-2',
      audioPath: '/frame-2.mp3',
      audioDuration: 3,
    });
  });
});

describe('getFrameSourceForOutlineFrame', () => {
  it('prefers matching by frame id before falling back to index', () => {
    const source = {
      frames: [
        { id: 'frame-2', htmlCode: '<p>second</p>' },
        { id: 'frame-1', htmlCode: '<p>first regenerated</p>' },
      ],
    };

    expect(getFrameSourceForOutlineFrame(source, 'frame-1', 0)?.htmlCode).toBe('<p>first regenerated</p>');
  });

  it('falls back to index for legacy sources without a matching id', () => {
    const source = { frames: [{ id: 'legacy', htmlCode: '<p>legacy</p>' }] };
    expect(getFrameSourceForOutlineFrame(source, 'frame-1', 0)?.id).toBe('legacy');
  });
});

describe('normalizeVideoSourceForFrames', () => {
  it('realigns sources by frame id and inserts placeholders for missing frames', () => {
    const source = {
      frames: [
        { id: 'frame-2', htmlCode: '<p>second</p>', audioPath: '/2.mp3' },
        { id: 'frame-1', htmlCode: '<p>first</p>', audioPath: '/1.mp3' },
      ],
    };

    const normalized = normalizeVideoSourceForFrames(source, [
      { id: 'frame-1' },
      { id: 'frame-2' },
      { id: 'frame-3' },
    ]);

    expect(normalized.frames.map(frame => frame.id)).toEqual(['frame-1', 'frame-2', 'frame-3']);
    expect(normalized.frames[0].htmlCode).toBe('<p>first</p>');
    expect(normalized.frames[1].htmlCode).toBe('<p>second</p>');
    expect(normalized.frames[2]).toEqual({ id: 'frame-3' });
  });

  it('keeps legacy index-matched media only when the source has no conflicting id', () => {
    const normalized = normalizeVideoSourceForFrames(
      { frames: [{ htmlCode: '<p>legacy</p>' } as any, { id: 'other', htmlCode: '<p>wrong</p>' }] },
      [{ id: 'frame-1' }, { id: 'frame-2' }],
    );

    expect(normalized.frames[0]).toMatchObject({ id: 'frame-1', htmlCode: '<p>legacy</p>' });
    expect(normalized.frames[1]).toEqual({ id: 'frame-2' });
  });
});

describe('IndexTTS settings', () => {
  it('提供默认设置', () => {
    expect(defaultIndexTtsSettings).toMatchObject({
      baseUrl: 'http://127.0.0.1:9000',
      apiBaseUrl: 'http://127.0.0.1:9010',
      gradioBaseUrl: 'http://127.0.0.1:9000',
      adapterMode: 'api',
      speed: 1,
      temperature: 0.8,
      topP: 0.8,
      topK: 30,
      format: 'mp3',
      timeoutMs: 120000,
    });
  });

  it('校验 POST 参数范围', () => {
    expect(indexTtsSettingsSchema.safeParse(defaultIndexTtsSettings).success).toBe(true);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      baseUrl: 'not-a-url',
    }).success).toBe(false);
    expect(indexTtsSettingsSchema.safeParse({
      ...defaultIndexTtsSettings,
      topP: 2,
    }).success).toBe(false);
  });
});
