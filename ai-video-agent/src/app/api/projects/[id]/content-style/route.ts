import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

const configSchema = z.object({
  mode: z.enum(['inherit', 'override']),
  presetId: z.string().min(1).optional(),
  customInstruction: z.string().max(20_000).optional(),
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const project = await prisma.project.findUnique({ where: { uuid: params.id }, select: { contentStyle: true } });
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    return NextResponse.json({ contentStyle: project.contentStyle || { mode: 'inherit' } });
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const config = configSchema.parse(await request.json());
    if (config.mode === 'override') {
      const view = await contentStyleStore.getView();
      if (!config.presetId || !view.presets.some(preset => preset.id === config.presetId)) {
        return NextResponse.json({ error: '请选择有效的项目内容风格' }, { status: 422 });
      }
    }
    const project = await prisma.project.update({
      where: { uuid: params.id },
      data: { contentStyle: config as any },
      select: { contentStyle: true },
    });
    return NextResponse.json({ contentStyle: project.contentStyle });
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

