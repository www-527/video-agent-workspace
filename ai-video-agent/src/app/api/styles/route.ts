import { NextRequest, NextResponse } from 'next/server';
import { recommendStyles, STYLE_PRESETS } from '@/lib/styles/presets';

/**
 * GET /api/styles
 * 返回所有内置视觉风格
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim() || '';
  const recommended = query ? recommendStyles(query, 3) : STYLE_PRESETS.slice(0, 3);
  return NextResponse.json({ styles: STYLE_PRESETS, recommendedStyleIds: recommended.map(style => style.id) });
}
