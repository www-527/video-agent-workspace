import { describe, expect, it } from 'vitest';
import { normalizePexelsQuery } from '@/lib/pexels/cache';
import { assessPexelsCandidates, chooseImageLayout, scorePexelsCandidates } from '@/lib/pexels/scoring';
import { enforcePlanConstraints, selectionLimit } from '@/lib/ai/real-image-planner';

describe('Pexels image selection', () => {
  it('normalizes search queries and picks fit-safe layouts', () => {
    expect(normalizePexelsQuery('  Office   Worker  ')).toBe('office worker');
    expect(chooseImageLayout({ width: 1200, height: 1600 }).layout).toBe('framed-focus');
    expect(chooseImageLayout({ width: 1920, height: 1080 }, 'full-bleed').layout).toBe('full-bleed');
    expect(chooseImageLayout({ width: 1600, height: 1200 }).layout).toBe('editorial-split');
  });

  it('rejects low-resolution and already-used photos', () => {
    const photos = [
      { id: 1, width: 1000, height: 600, url: 'https://pexels.com/1', photographer: 'A', photographer_url: '', alt: 'office worker', src: { large: 'https://images.pexels.com/1.jpg' } },
      { id: 2, width: 1920, height: 1080, url: 'https://pexels.com/2', photographer: 'B', photographer_url: '', alt: 'office worker', src: { large2x: 'https://images.pexels.com/2.jpg' } },
      { id: 3, width: 1920, height: 1080, url: 'https://pexels.com/3', photographer: 'C', photographer_url: '', alt: 'office worker', src: { large2x: 'https://images.pexels.com/3.jpg' } },
    ];
    const selected = scorePexelsCandidates({ photos, subject: 'office worker', usedPhotoIds: new Set([2]) });
    expect(selected.map(item => item.photo.id)).toEqual([3]);
  });

  it('only accepts matching portrait metadata for named people', () => {
    const photos = [
      { id: 4, width: 1920, height: 1080, url: '', photographer: 'A', photographer_url: '', alt: 'Frank Gehry portrait', src: { large2x: 'https://images.pexels.com/4.jpg' } },
      { id: 5, width: 1920, height: 1080, url: '', photographer: 'B', photographer_url: '', alt: 'modern architecture building', src: { large2x: 'https://images.pexels.com/5.jpg' } },
    ];
    const selected = scorePexelsCandidates({ photos, subject: 'Frank Gehry', usedPhotoIds: new Set(), requirePortrait: true, requireSubjectMatch: true });
    expect(selected.map(item => item.photo.id)).toEqual([4]);
  });

  it('prefers a visually consistent color palette when relevance is otherwise close', () => {
    const photos = [
      { id: 6, width: 1920, height: 1080, url: '', photographer: 'A', photographer_url: '', avg_color: '#101010', alt: 'office worker', src: { large2x: 'https://images.pexels.com/6.jpg' } },
      { id: 7, width: 1920, height: 1080, url: '', photographer: 'B', photographer_url: '', avg_color: '#d8c8b8', alt: 'office worker', src: { large2x: 'https://images.pexels.com/7.jpg' } },
    ];
    const selected = scorePexelsCandidates({
      photos,
      subject: 'office worker',
      usedPhotoIds: new Set(),
      previousColor: '#d0c0b0',
    });
    expect(selected[0].photo.id).toBe(7);
  });

  it('uses portrait resolution and target aspect for Douyin projects', () => {
    const photos = [
      { id: 60, width: 2400, height: 1350, url: '', photographer: 'A', photographer_url: '', alt: 'office worker portrait', src: { large2x: 'https://images.pexels.com/60.jpg' } },
      { id: 61, width: 1350, height: 2400, url: '', photographer: 'B', photographer_url: '', alt: 'office worker portrait', src: { large2x: 'https://images.pexels.com/61.jpg' } },
    ];
    const selected = scorePexelsCandidates({
      photos,
      subject: 'office worker',
      usedPhotoIds: new Set(),
      canvasPreset: 'douyin-portrait-9-16',
    });
    expect(selected.map(item => item.photo.id)).toEqual([61]);
  });

  it('limits balanced real-image plans to about one third and two consecutive frames', () => {
    const frames = Array.from({ length: 10 }, (_, index) => ({
      id: `frame-${index + 1}`, index: index + 1, title: 'Office scene', narration: 'A real office worker is at work.', sceneSpec: { assetStrategy: 'real-image', assetRequest: { query: 'office worker documentary', fallbackQueries: [], requiredTerms: ['office'], optionalTerms: ['worker'], excludedTerms: [], subjectType: 'environment', purpose: 'scene', imageRequired: false } },
    }));
    const plans = enforcePlanConstraints(frames as any, frames.map(frame => ({ frameId: frame.id, useRealImage: true, query: 'office worker', fallbackQuery: 'worker office' })));
    const selected = plans.filter(plan => plan.useRealImage);
    expect(selected).toHaveLength(3);
    expect(plans.slice(0, 3).filter(plan => plan.useRealImage)).toHaveLength(2);
  });

  it('uses distinct whole-film limits for fast, balanced, and asset-priority modes', () => {
    expect(selectionLimit(4, 'fast')).toBe(0);
    expect(selectionLimit(6, 'balanced')).toBe(2);
    expect(selectionLimit(1, 'asset-priority')).toBe(1);
    expect(selectionLimit(8, 'balanced')).toBe(3);
    expect(selectionLimit(8, 'asset-priority')).toBe(3);
    expect(selectionLimit(12, 'fast')).toBeLessThan(selectionLimit(12, 'balanced'));
    expect(selectionLimit(12, 'asset-priority')).toBeGreaterThan(selectionLimit(12, 'balanced'));
  });

  it('allows named people in a person-introduction frame when the film has image capacity', () => {
    const frames = Array.from({ length: 5 }, (_, index) => ({
      id: index === 0 ? 'people' : `frame-${index + 1}`,
      index: index + 1,
      title: index === 0 ? '代表人物' : '办公场景',
      narration: index === 0 ? 'Frank Gehry, Zaha Hadid, and Rem Koolhaas.' : 'Office workers at work.',
      sceneSpec: { assetStrategy: 'real-image', assetRequest: { query: 'architect portrait documentary', fallbackQueries: [], requiredTerms: ['architect'], optionalTerms: [], excludedTerms: [], subjectType: 'person', purpose: 'portrait', imageRequired: false } },
    }));
    const [plan] = enforcePlanConstraints(frames as any, [{ frameId: 'people', useRealImage: true, query: 'architect portrait', people: [
      { name: 'Frank Gehry', query: 'Frank Gehry portrait', fallbackQuery: 'Frank Gehry headshot' },
      { name: 'Zaha Hadid', query: 'Zaha Hadid portrait', fallbackQuery: 'Zaha Hadid headshot' },
      { name: 'Rem Koolhaas', query: 'Rem Koolhaas portrait', fallbackQuery: 'Rem Koolhaas headshot' },
    ] }]);
    expect(plan.people?.map(person => person.name)).toEqual(['Frank Gehry', 'Zaha Hadid', 'Rem Koolhaas']);
    expect(plan.useRealImage).toBe(true);
  });

  it('keeps a css-svg scene native even when its content describes tangible objects', () => {
    const frames = [{
      id: 'cola', index: 1, title: '可乐的发明与产品包装',
      narration: '药剂师发明了可乐，后来形成独特的瓶子和品牌包装。',
      sceneSpec: { assetStrategy: 'css-svg', visualRole: 'emphasis', realImagePriority: 'never' },
    }];
    const [plan] = enforcePlanConstraints(frames as any, [{ frameId: 'cola', useRealImage: false }], 'asset-priority');
    expect(plan.useRealImage).toBe(false);
    expect(plan.reason).toContain('原生视觉');
  });

  it('rejects forbidden and topic-free metadata before ranking', () => {
    const photos = [
      { id: 30, width: 1920, height: 1080, url: '', photographer: 'A', photographer_url: '', alt: 'dental equipment clinic', src: { large2x: 'https://images.pexels.com/30.jpg' } },
      { id: 31, width: 1920, height: 1080, url: '', photographer: 'B', photographer_url: '', alt: 'offshore wind turbine technician', src: { large2x: 'https://images.pexels.com/31.jpg' } },
    ];
    const selected = scorePexelsCandidates({ photos, subject: 'wind turbine maintenance', usedPhotoIds: new Set(), requiredTerms: ['wind', 'turbine'], excludedTerms: ['dental', 'office'] });
    expect(selected.map(item => item.photo.id)).toEqual([31]);
    expect(selected[0].matchedTerms).toEqual(['wind', 'turbine']);
  });

  it('requires every required concept and keeps an actionable rejection reason', () => {
    const photos = [
      { id: 40, width: 1920, height: 1080, url: '', photographer: 'A', photographer_url: '', alt: 'wind farm over calm sea', src: { large2x: 'https://images.pexels.com/40.jpg' } },
      { id: 41, width: 1920, height: 1080, url: '', photographer: 'B', photographer_url: '', alt: 'offshore wind turbines over calm sea', src: { large2x: 'https://images.pexels.com/41.jpg' } },
    ];
    const assessed = assessPexelsCandidates({
      photos,
      subject: 'offshore wind turbine',
      usedPhotoIds: new Set(),
      requiredTerms: ['wind', 'turbine'],
    });
    expect(assessed[0]).toMatchObject({
      accepted: false,
      rejectionCode: 'REQUIRED_TERM_MISSING',
      missingTerms: ['turbine'],
    });
    expect(assessed[1]).toMatchObject({ accepted: true, missingTerms: [] });
  });

  it('allows zero real images for short videos and keeps native visuals native', () => {
    const shortFrames = [
      { id: 'one', index: 1, title: '办公室', narration: '员工在办公室工作', sceneSpec: { assetStrategy: 'real-image' } },
      { id: 'two', index: 2, title: '城市', narration: '城市街道氛围', sceneSpec: { assetStrategy: 'real-image' } },
    ];
    const shortPlans = enforcePlanConstraints(shortFrames as any, shortFrames.map(frame => ({ frameId: frame.id, useRealImage: true, query: 'office worker' })));
    expect(shortPlans.every(plan => !plan.useRealImage)).toBe(true);

    const nativeFrames = Array.from({ length: 5 }, (_, index) => ({
      id: `native-${index}`, index, title: '数据总结图表', narration: '展示数据和因果流程', sceneSpec: { assetStrategy: 'chart' },
    }));
    const nativePlans = enforcePlanConstraints(nativeFrames as any, nativeFrames.map(frame => ({ frameId: frame.id, useRealImage: true, query: 'business chart' })));
    expect(nativePlans.every(plan => !plan.useRealImage)).toBe(true);
    expect(nativePlans.every(plan => plan.purpose && plan.visualGroup && plan.deadlineMs > 0)).toBe(true);
  });
});
