// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  muxerOptions: null as Record<string, unknown> | null,
  videoFlush: vi.fn(),
  audioFlush: vi.fn(),
}));

vi.mock('mp4-muxer', () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(0);
  },
  Muxer: class {
    target = { buffer: new ArrayBuffer(0) };

    constructor(options: Record<string, unknown>) {
      mocks.muxerOptions = options;
    }

    addVideoChunk() {}
    addAudioChunk() {}
    finalize() {}
  },
}));

class MockVideoEncoder {
  static isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
  state = 'configured';

  constructor(_init: unknown) {}
  configure() {}
  encode() {}
  flush() {
    mocks.videoFlush();
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
  }
}

class MockAudioEncoder {
  state = 'configured';

  constructor(_init: unknown) {}
  configure() {}
  encode() {}
  flush() {
    mocks.audioFlush();
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
  }
}

class MockTrackProcessor {
  readable = {
    getReader: () => ({
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    }),
  };

  constructor(_options: unknown) {}
}

class MockOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return { drawImage: vi.fn() };
  }
}

describe('recordStreamToMP4', () => {
  beforeEach(() => {
    mocks.muxerOptions = null;
    mocks.videoFlush.mockReset();
    mocks.audioFlush.mockReset();
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('AudioEncoder', MockAudioEncoder);
    vi.stubGlobal('MediaStreamTrackProcessor', MockTrackProcessor);
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  it('preserves the shared track clock and flushes both encoders before muxing', async () => {
    const { recordStreamToMP4 } = await import('@/lib/webcodecs-mp4-encoder');
    const videoTrack = { getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) };
    const audioTrack = { getSettings: () => ({ sampleRate: 48_000, channelCount: 2 }) };
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack],
    } as unknown as MediaStream;

    const blob = await recordStreamToMP4(stream, 10, { maxDurationSec: 40 });

    expect(blob.type).toBe('video/mp4');
    expect(mocks.muxerOptions?.firstTimestampBehavior).toBe('cross-track-offset');
    expect(mocks.videoFlush).toHaveBeenCalledTimes(1);
    expect(mocks.audioFlush).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit portrait target instead of inferring dimensions from the captured screen', async () => {
    const { recordStreamToMP4 } = await import('@/lib/webcodecs-mp4-encoder');
    const videoTrack = { getSettings: () => ({ width: 2560, height: 1440, frameRate: 30 }) };
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream;

    await recordStreamToMP4(stream, 1, { targetWidth: 1080, targetHeight: 1920 });

    expect(mocks.muxerOptions?.video).toEqual({ codec: 'avc', width: 1080, height: 1920 });
  });
});
