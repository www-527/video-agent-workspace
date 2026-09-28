import { spawn } from 'child_process';

export type VideoEncoder = 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf';

const GPU_ENCODERS: Exclude<VideoEncoder, 'libx264'>[] = ['h264_nvenc', 'h264_qsv', 'h264_amf'];

export function buildVideoEncodingArgs(encoder: VideoEncoder): string[] {
  if (encoder === 'h264_nvenc') {
    return ['-c:v', encoder, '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32', '-pix_fmt', 'yuv420p'];
  }
  if (encoder === 'h264_qsv') {
    return ['-c:v', encoder, '-preset', 'veryslow', '-global_quality', '18', '-look_ahead', '1', '-pix_fmt', 'nv12'];
  }
  if (encoder === 'h264_amf') {
    return ['-c:v', encoder, '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '18', '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'];
}

export function selectGpuEncoderFromList(encodersOutput: string): Exclude<VideoEncoder, 'libx264'> | null {
  return GPU_ENCODERS.find(encoder => new RegExp(`\\b${encoder}\\b`).test(encodersOutput)) ?? null;
}

export async function resolveVideoEncoder(ffmpeg: string, useGpuEncoding: boolean): Promise<VideoEncoder> {
  if (!useGpuEncoding) return 'libx264';
  const available = await captureProcess(ffmpeg, ['-hide_banner', '-encoders']).catch(() => '');
  const candidates = GPU_ENCODERS.filter(encoder => new RegExp(`\\b${encoder}\\b`).test(available));
  for (const encoder of candidates) {
    if (await probeEncoder(ffmpeg, encoder)) return encoder;
  }
  return 'libx264';
}

async function probeEncoder(ffmpeg: string, encoder: Exclude<VideoEncoder, 'libx264'>): Promise<boolean> {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    // Some NVENC generations reject tiny frames even though normal HD/Full HD
    // exports are supported. Probe at a broadly supported video size.
    '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=1', '-frames:v', '1',
    ...buildVideoEncodingArgs(encoder), '-f', 'null', '-',
  ];
  return new Promise(resolve => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}

async function captureProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`FFmpeg exited with code ${code}`)));
  });
}
