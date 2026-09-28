import { NextRequest, NextResponse } from 'next/server';
import { ChangeSetError, getChangeSet } from '@/lib/changesets/service';

interface RouteContext {
  params: { id: string; changeSetId: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    return NextResponse.json({ changeSet: await getChangeSet(params.id, params.changeSetId) });
  } catch (error) {
    if (error instanceof ChangeSetError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: '读取修改方案失败' }, { status: 500 });
  }
}
