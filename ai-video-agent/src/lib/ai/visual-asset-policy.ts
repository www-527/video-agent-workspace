import type { AssetRequirement, AssetVerificationLevel, FrameOutline, SceneSpec } from '@/types';

export type VisualAssetClass =
  | 'named-person'
  | 'generic-person'
  | 'product'
  | 'architecture'
  | 'natural-object'
  | 'place'
  | 'historical-scene'
  | 'artwork-document'
  | 'generic-context'
  | 'native-visual';

export interface VisualAssetPolicy {
  assetClass: VisualAssetClass;
  fidelity: 'required' | 'preferred' | 'native';
  fallbackPolicy: 'block' | 'allow-native';
  requirement: AssetRequirement;
  minimumVerification: AssetVerificationLevel;
  reason: string;
}

const NATIVE_RELATION = /图表|数据|指标|流程|因果|层级|时间线|关系图|排版|标题|结论|总结|引用|抽象概念/;
const APPEARANCE_INTENT = /外观|造型|形态|轮廓|长相|肖像|头像|面貌|立面|空间|内景|现场|实景|原貌|设计|包装|辨认|识别|对照|特写|照片|实拍/;
const PRODUCT = /产品|商品|包装|瓶(?:子|身)?|罐|车辆|汽车|手机|电脑|设备|机器|器材|服装|鞋|珠宝|家具|食品|饮料|可乐|药品|玩具|发动机|变速箱|离合器|液力变矩器|活塞|曲轴|火花塞|钢带|锥轮|齿轮箱|汽车零部件|机械总成/;
const ARCHITECTURE = /建筑|大楼|楼宇|住宅|宫殿|教堂|寺庙|桥梁|博物馆|体育馆|厂房|工厂|园区|立面|室内空间|办公室|实验室/;
const NATURAL_OBJECT = /植物|动物|花|树|叶|果实|豆荚|种子|矿石|岩石|地貌|山峰|河流|湖泊|海岸|自然物/;
const PLACE = /城市|街道|村庄|地点|地标|景区|广场|车站|机场|港口|门店|药房|现场|实景/;
const HISTORICAL = /历史人物|历史场景|历史现场|旧址|遗址|古代|年代照片|档案照片|二战|战争现场/;
const ARTWORK = /画作|绘画|雕塑|艺术品|海报|广告原作|手稿|文献|报纸|书籍封面|专辑封面|电影海报/;
const PERSON = /人物|人像|肖像|头像|创始人|发明者|设计师|建筑师|艺术家|演员|歌手|运动员|医生|药剂师|专家|员工|工人|学生|家庭|团队|顾客|用户/;
const PERSON_PROTAGONIST = /圣诞老人|老人|人物|人像|肖像|头像|创始人|发明者|演员|歌手|运动员|医生|药剂师|专家|员工|工人|学生|顾客|用户|Santa(?:\s+Claus)?/i;
const NAMED_PERSON = /(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}|[\p{Script=Han}]{2,8}(?:先生|女士|教授|博士|设计师|建筑师|创始人|发明者))/u;

export function classifyVisualAsset(frame: Pick<FrameOutline, 'title' | 'narration' | 'htmlPrompt' | 'sceneSpec'>): VisualAssetPolicy {
  const core = `${frame.title} ${frame.htmlPrompt || ''} ${frame.sceneSpec?.focalElement || ''} ${frame.sceneSpec?.visualIntent || ''}`;
  const content = `${core} ${frame.narration}`;
  const strategy = frame.sceneSpec?.assetStrategy;
  const explicitlyNative = strategy && strategy !== 'real-image';
  const appearanceCritical = APPEARANCE_INTENT.test(content);

  let assetClass: VisualAssetClass | null = null;
  // Classify the visual protagonist before incidental nouns in narration. A
  // bottle designed by a person is still a product shot, not a portrait frame.
  const subjectText = core || content;
  if (PERSON_PROTAGONIST.test(subjectText)) assetClass = NAMED_PERSON.test(content) || /肖像|头像|历史人物|创始人|发明者/.test(subjectText) ? 'named-person' : 'generic-person';
  else if (PRODUCT.test(subjectText)) assetClass = 'product';
  else if (ARCHITECTURE.test(subjectText)) assetClass = 'architecture';
  else if (NATURAL_OBJECT.test(subjectText)) assetClass = 'natural-object';
  else if (ARTWORK.test(subjectText)) assetClass = 'artwork-document';
  else if (HISTORICAL.test(subjectText)) assetClass = 'historical-scene';
  else if (PLACE.test(subjectText)) assetClass = 'place';
  else if (PERSON.test(subjectText)) assetClass = NAMED_PERSON.test(content) || /肖像|头像|历史人物|创始人|发明者/.test(subjectText) ? 'named-person' : 'generic-person';
  else if (PERSON.test(content)) assetClass = NAMED_PERSON.test(content) ? 'named-person' : 'generic-person';
  else if (ARCHITECTURE.test(content)) assetClass = 'architecture';
  else if (PLACE.test(content)) assetClass = 'place';

  // A concrete object's identity or appearance cannot be faithfully replaced
  // by generic CSS geometry. Explicit visual wording outranks a stale native
  // strategy saved by older projects.
  const highFidelity = Boolean(assetClass && appearanceCritical)
    || assetClass === 'named-person'
    || assetClass === 'historical-scene'
    || assetClass === 'artwork-document';
  if (highFidelity) {
    return {
      assetClass: assetClass!, fidelity: 'required', fallbackPolicy: 'allow-native',
      requirement: { attempt: 'required', failurePolicy: 'needs-review' },
      minimumVerification: 'vision-confirmed',
      reason: '具体对象的身份或外观承担核心语义，优先使用可验收素材；素材不可用时允许降级为不冒充真实身份的原生视觉。',
    };
  }

  if (assetClass && (!strategy || strategy === 'real-image')) {
    return {
      assetClass, fidelity: 'preferred', fallbackPolicy: 'allow-native',
      requirement: { attempt: 'optional', failurePolicy: 'allow-native' },
      minimumVerification: 'metadata-matched',
      reason: '真实素材能增强人物、空间或实体场景的可信度，但不决定核心含义。',
    };
  }

  if (NATIVE_RELATION.test(content) || explicitlyNative) {
    return {
      assetClass: 'native-visual', fidelity: 'native', fallbackPolicy: 'allow-native',
      requirement: { attempt: 'never', failurePolicy: 'allow-native' },
      minimumVerification: 'file-valid',
      reason: '镜头核心是抽象关系或数据结构，适合 HTML 原生视觉。',
    };
  }

  return {
    assetClass: 'generic-context', fidelity: 'preferred', fallbackPolicy: 'allow-native',
    requirement: { attempt: 'optional', failurePolicy: 'allow-native' },
    minimumVerification: 'metadata-matched',
    reason: '可选真实环境素材用于建立语境。',
  };
}

const VERIFICATION_RANK: Record<AssetVerificationLevel, number> = {
  'file-valid': 0,
  'metadata-matched': 1,
  'vision-confirmed': 2,
  'human-confirmed': 3,
};

export function meetsAssetVerificationLevel(
  actual: AssetVerificationLevel | undefined,
  minimum: AssetVerificationLevel,
): boolean {
  return actual !== undefined && VERIFICATION_RANK[actual] >= VERIFICATION_RANK[minimum];
}

export function requiredRealImagePriority(frame: Pick<FrameOutline, 'title' | 'narration' | 'htmlPrompt' | 'sceneSpec'>): SceneSpec['realImagePriority'] | null {
  return classifyVisualAsset(frame).fidelity === 'required' ? 'required' : null;
}
