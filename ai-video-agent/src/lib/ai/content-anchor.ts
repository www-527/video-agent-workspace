import type { Outline } from '@/types';

const MAX_TOPIC_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 180;

function compactText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Keep one semantic reference for the GPT-free path without prescribing a
 * storyline, shot count, layout, or visual treatment.
 */
export function createFreeContentAnchor(
  outline: Pick<Outline, 'title' | 'creativeBrief' | 'freeContentAnchor'>,
): NonNullable<Outline['freeContentAnchor']> {
  const topic = compactText(outline.freeContentAnchor?.topic, MAX_TOPIC_LENGTH)
    || compactText(outline.title, MAX_TOPIC_LENGTH)
    || '当前视频主题';
  const coreMessage = compactText(outline.freeContentAnchor?.coreMessage, MAX_MESSAGE_LENGTH)
    || compactText(outline.creativeBrief?.coreMessage, MAX_MESSAGE_LENGTH)
    || topic;
  return { topic, coreMessage };
}
