import { describe, expect, it, vi } from 'vitest';
import { startFramePrerequisites } from '@/lib/frame-prerequisites';
import { runWithOptionalImageFallback } from '@/lib/ai/optional-image-fallback';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('HTML smart-image frame pipeline', () => {
  it('starts TTS and image preparation before awaiting either result', async () => {
    const audio = deferred<string>();
    const image = deferred<string>();
    const order: string[] = [];
    const pipeline = startFramePrerequisites(
      vi.fn(() => { order.push('tts-start'); return audio.promise; }),
      vi.fn(() => { order.push('image-start'); return image.promise; }),
    );

    expect(order).toEqual(['tts-start', 'image-start']);
    image.resolve('native-fallback');
    audio.resolve('audio-ready');
    await expect(pipeline.settled).resolves.toEqual(['audio-ready', 'native-fallback']);
  });

  it('retries without images when image-assisted HTML generation fails', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('image layout validation failed'));
    const fallback = vi.fn().mockResolvedValue('<html>native visual</html>');
    const onFallback = vi.fn();

    await expect(runWithOptionalImageFallback({
      hasImages: true,
      primary,
      fallback,
      onFallback,
    })).resolves.toBe('<html>native visual</html>');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
