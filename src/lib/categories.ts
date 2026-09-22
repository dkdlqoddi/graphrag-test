/**
 * Fixed shelf categories. Every document, chapter and keyword is assigned to
 * exactly one category so the librarian always knows which bookshelf to visit.
 */
export interface Category {
  id: CategoryId;
  label: string;
  labelEn: string;
  color: string;
  description: string;
}

export const CATEGORY_IDS = [
  "computing",
  "science",
  "engineering",
  "business",
  "humanities",
  "society",
  "arts",
  "misc",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORIES: Category[] = [
  {
    id: "computing",
    label: "컴퓨터·AI",
    labelEn: "Computing & AI",
    color: "#5c8d89",
    description: "소프트웨어, 알고리즘, 데이터, 인공지능, 머신러닝",
  },
  {
    id: "science",
    label: "과학·수학",
    labelEn: "Science & Math",
    color: "#7a9cc6",
    description: "물리, 화학, 생물, 수학, 통계, 의학",
  },
  {
    id: "engineering",
    label: "공학·기술",
    labelEn: "Engineering",
    color: "#f2c14e",
    description: "기계, 전기, 전자, 건축, 제조, 에너지",
  },
  {
    id: "business",
    label: "경제·경영",
    labelEn: "Business & Economics",
    color: "#e6553f",
    description: "경제, 경영, 마케팅, 금융, 조직",
  },
  {
    id: "humanities",
    label: "인문·철학",
    labelEn: "Humanities",
    color: "#c05746",
    description: "철학, 문학, 언어, 종교, 심리",
  },
  {
    id: "society",
    label: "사회·역사",
    labelEn: "Society & History",
    color: "#3d405b",
    description: "역사, 정치, 법, 사회, 교육",
  },
  {
    id: "arts",
    label: "예술·문화",
    labelEn: "Arts & Culture",
    color: "#f4a261",
    description: "미술, 음악, 디자인, 영화, 문화",
  },
  {
    id: "misc",
    label: "생활·기타",
    labelEn: "Life & Misc",
    color: "#81b29a",
    description: "생활, 취미, 실용, 분류 불가",
  },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && (CATEGORY_IDS as readonly string[]).includes(value);
}

export function coerceCategory(value: unknown): CategoryId {
  return isCategoryId(value) ? value : "misc";
}

/** Majority vote over category ids; ties resolve to the first seen. */
export function majorityCategory(ids: CategoryId[]): CategoryId {
  if (ids.length === 0) return "misc";
  const counts = new Map<CategoryId, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: CategoryId = ids[0];
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}
