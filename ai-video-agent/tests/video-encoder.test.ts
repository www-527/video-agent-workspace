import { describe, expect, it } from 'vitest';
import { buildVideoEncodingArgs, selectGpuEncoderFromList } from '@/lib/render/video-encoder';

describe('video encoder policy', () => {
  it('keeps the CPU encoder on the existing high-quality CRF 18 profile', () => {
    expect(buildVideoEncodingArgs('libx264')).toEqual(expect.arrayContaining(['medium', '-crf', '18']));
  });

  it('uses the highest-quality NVENC preset and constant quality target', () => {
    expect(buildVideoEncodingArgs('h264_nvenc')).toEqual(expect.arrayContaining(['p7', '-tune', 'hq', '-cq', '18']));
  });

  it('prefers NVIDIA, then Intel, then AMD from the available FFmpeg encoders', () => {
    expect(selectGpuEncoderFromList('V..... h264_amf\nV..... h264_qsv\nV..... h264_nvenc')).toBe('h264_nvenc');
    expect(selectGpuEncoderFromList('V..... h264_amf')).toBe('h264_amf');
    expect(selectGpuEncoderFromList('V..... libx264')).toBeNull();
  });
});
