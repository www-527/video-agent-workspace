import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { validateAgentPrompt } from '@/lib/content-style/store';

const schema = z.object({ agent: z.enum(['planner', 'quality']), content: z.string() });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(validateAgentPrompt(input.agent, input.content));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

