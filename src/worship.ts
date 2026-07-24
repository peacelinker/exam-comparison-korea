import {
  WORSHIP_STATUSES,
  type DataRow,
  type SheetProfile,
  type WorshipAnalysisResult,
  type WorshipCounts,
  type WorshipDateInfo,
  type WorshipInputMetrics,
  type WorshipPerson,
  type WorshipRecommendation,
  type WorshipRegionAnalysis,
  type WorshipSheetMetrics,
  type WorshipStatus,
  type WorshipTransitionSummary,
} from "./types";
import { canonicalize, isOfficialWorship } from "./core";

const DAY_MS = 24 * 60 * 60 * 1000;
const REGION_ORDER = [
  "서대문",
  "마포",
  "신촌",
  "새신",
  "홍대",
  "소성",
] as const;

const statusAliases = new Map<string, WorshipStatus>([
  ["대면", "대면"],
  ["대면모임", "대면"],
  ["줌", "줌"],
  ["zoom", "줌"],
  ["통화", "통화"],
  ["전화", "통화"],
  ["미참여", "미참여"],
  ["불참", "미참여"],
  ["x", "미참여"],
]);

function normalizeStatusKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

export function classifyWorshipStatus(value: unknown): {
  status: WorshipStatus;
  validInput: boolean;
  unknown: boolean;
} {
  const normalized = normalizeStatusKey(value);
  if (!normalized) {
    return { status: "미참여", validInput: false, unknown: false };
  }
  const status = statusAliases.get(normalized);
  if (status) return { status, validInput: true, unknown: false };
  return { status: "미참여", validInput: false, unknown: true };
}

function displayText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function personKey(row: DataRow): string {
  const region = row.canonicalRegion || canonicalize("지역 미지정");
  return `${region}\u0000${row.canonicalName}`;
}

function chooseRows(
  profile: SheetProfile,
  officialOnly: boolean,
): {
  people: WorshipPerson[];
  duplicatePersonCount: number;
  missingRegionCount: number;
} {
  const selected = new Map<
    string,
    { person: WorshipPerson; hasValidStatus: boolean }
  >();
  const duplicateKeys = new Set<string>();
  const missingRegionKeys = new Set<string>();

  for (const row of profile.rows) {
    if (!row.canonicalName) continue;
    if (officialOnly && !isOfficialWorship(row.worship)) continue;
    const key = personKey(row);
    const classified = classifyWorshipStatus(row.worshipParticipation);
    const region = row.canonicalRegion ? displayText(row.region) : "지역 미지정";
    if (!row.canonicalRegion) missingRegionKeys.add(key);

    const next: WorshipPerson = {
      rowNumber: row.rowNumber,
      region,
      name: displayText(row.name),
      canonicalRegion: canonicalize(region),
      canonicalName: row.canonicalName,
      status: classified.status,
      rawStatus: displayText(row.worshipParticipation),
    };
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, {
        person: next,
        hasValidStatus: classified.validInput,
      });
      continue;
    }

    duplicateKeys.add(key);
    if (classified.validInput || !existing.hasValidStatus) {
      selected.set(key, {
        person: next,
        hasValidStatus: classified.validInput,
      });
    }
  }

  return {
    people: [...selected.values()].map((item) => item.person),
    duplicatePersonCount: duplicateKeys.size,
    missingRegionCount: missingRegionKeys.size,
  };
}

function calculateAllInputMetrics(
  profile: SheetProfile,
): WorshipInputMetrics {
  const prepared = chooseRows(profile, false);
  let validInputCount = 0;
  let blankInputCount = 0;
  const unknownStatusCounts: Record<string, number> = {};

  for (const person of prepared.people) {
    const classified = classifyWorshipStatus(person.rawStatus);
    if (classified.validInput) {
      validInputCount += 1;
    } else if (!normalizeStatusKey(person.rawStatus)) {
      blankInputCount += 1;
    } else if (classified.unknown) {
      const label = person.rawStatus || "(빈 값)";
      unknownStatusCounts[label] =
        (unknownStatusCounts[label] ?? 0) + 1;
    }
  }

  return {
    personCount: prepared.people.length,
    validInputCount,
    blankInputCount,
    validInputRatio:
      prepared.people.length === 0
        ? 0
        : validInputCount / prepared.people.length,
    unknownStatusCounts,
    duplicatePersonCount: prepared.duplicatePersonCount,
    missingRegionCount: prepared.missingRegionCount,
  };
}

export function calculateWorshipSheetMetrics(
  profile: SheetProfile,
): WorshipSheetMetrics {
  const prepared = chooseRows(profile, true);
  const officialKeys = new Set<string>();
  const validKeys = new Set<string>();
  const blankKeys = new Set<string>();
  const unknownStatusCounts: Record<string, number> = {};

  for (const row of profile.rows) {
    if (!row.canonicalName || !isOfficialWorship(row.worship)) continue;
    const key = personKey(row);
    officialKeys.add(key);
    const classified = classifyWorshipStatus(row.worshipParticipation);
    if (classified.validInput) validKeys.add(key);
    if (!normalizeStatusKey(row.worshipParticipation)) blankKeys.add(key);
    if (classified.unknown) {
      const label = displayText(row.worshipParticipation) || "(빈 값)";
      unknownStatusCounts[label] = (unknownStatusCounts[label] ?? 0) + 1;
    }
  }

  const officialCount = officialKeys.size;
  return {
    officialCount,
    validInputCount: validKeys.size,
    blankInputCount: [...blankKeys].filter((key) => !validKeys.has(key)).length,
    validInputRatio:
      officialCount === 0 ? 0 : validKeys.size / officialCount,
    unknownStatusCounts,
    duplicatePersonCount: prepared.duplicatePersonCount,
    missingRegionCount: prepared.missingRegionCount,
    columnsReadable: profile.metrics.worshipColumnsReadable,
  };
}

function validDate(year: number, month: number, day: number): Date | undefined {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return undefined;
  }
  return candidate;
}

function parseReferenceDate(isoDate: string): Date {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("최근 구역예배일을 다시 확인해 주세요.");
  const parsed = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!parsed) throw new Error("최근 구역예배일을 다시 확인해 주세요.");
  return parsed;
}

function extractedDateParts(
  sheetName: string,
): { year?: number; month: number; day: number } | undefined {
  const name = sheetName.normalize("NFKC").trim();
  const patterns: Array<{
    regex: RegExp;
    build: (match: RegExpMatchArray) => {
      year?: number;
      month: number;
      day: number;
    };
  }> = [
    {
      regex: /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/,
      build: (m) => ({
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      }),
    },
    {
      regex:
        /(?:^|\D)(\d{4})\s*(?:년|[._/-])\s*(\d{1,2})\s*(?:월|[._/-])\s*(\d{1,2})(?:\s*일)?(?:\D|$)/,
      build: (m) => ({
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      }),
    },
    {
      regex:
        /(?:^|\D)(\d{2})\s*[._/-]\s*(\d{1,2})\s*[._/-]\s*(\d{1,2})(?:\D|$)/,
      build: (m) => ({
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      }),
    },
    {
      regex: /(?:^|\D)(\d{1,2})\s*월\s*(\d{1,2})\s*일?(?:\D|$)/,
      build: (m) => ({ month: Number(m[1]), day: Number(m[2]) }),
    },
    {
      regex: /(?:^|\D)(\d{1,2})\s*[._/-]\s*(\d{1,2})(?:\D|$)/,
      build: (m) => ({ month: Number(m[1]), day: Number(m[2]) }),
    },
    {
      regex: /(?:^|\D)(\d{2})(\d{2})(?:시험)?(?:\D|$)/,
      build: (m) => ({ month: Number(m[1]), day: Number(m[2]) }),
    },
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern.regex);
    if (match) return pattern.build(match);
  }
  return undefined;
}

export function interpretWorshipTabDate(
  sheetName: string,
  referenceIsoDate: string,
): WorshipDateInfo | undefined {
  const parts = extractedDateParts(sheetName);
  if (!parts) return undefined;
  const reference = parseReferenceDate(referenceIsoDate);
  const referenceYear = reference.getUTCFullYear();
  let candidate: Date | undefined;

  if (parts.year != null) {
    let year = parts.year;
    if (year < 100) {
      const century = Math.floor(referenceYear / 100) * 100;
      year = century + year;
      if (year - referenceYear > 50) year -= 100;
    }
    candidate = validDate(year, parts.month, parts.day);
  } else {
    candidate =
      validDate(referenceYear, parts.month, parts.day) ??
      validDate(referenceYear - 1, parts.month, parts.day);
    if (candidate && candidate > reference) {
      candidate = validDate(referenceYear - 1, parts.month, parts.day);
    }
  }

  if (!candidate) return undefined;
  const diffDays = Math.round(
    (reference.getTime() - candidate.getTime()) / DAY_MS,
  );
  return {
    sheetName,
    isoDate: candidate.toISOString().slice(0, 10),
    diffDays,
    isFuture: diffDays < 0,
    isWithinRecentWeek: diffDays >= 0 && diffDays <= 7,
  };
}

export function recommendWorshipSheets(
  profiles: SheetProfile[],
  referenceIsoDate: string,
  threshold = 0.5,
): WorshipRecommendation {
  const sheetDates = profiles.map((profile) => ({
    sheetName: profile.name,
    date: interpretWorshipTabDate(profile.name, referenceIsoDate),
  }));
  const dated = sheetDates
    .flatMap((item) => (item.date ? [item.date] : []))
    .filter((item) => !item.isFuture)
    .sort(
      (a, b) =>
        b.isoDate.localeCompare(a.isoDate) ||
        a.sheetName.localeCompare(b.sheetName, "ko-KR"),
    );
  const d1 = dated[0];
  const d2 = dated[1];
  const regionOverall = profiles.find(
    (profile) => canonicalize(profile.name) === canonicalize("지역전체"),
  );
  const warnings: string[] = [];
  let currentSheet: string | undefined;
  let previousSheet: string | undefined;
  let currentReason = "";
  let previousReason = "";

  if (!d1) {
    currentReason = "날짜를 인식할 수 있는 탭이 없어 직접 선택이 필요합니다.";
    previousReason = "비교할 날짜 탭을 찾지 못했습니다.";
    warnings.push("날짜형 탭을 찾지 못했습니다. 두 탭을 직접 선택해 주세요.");
  } else if (!d1.isWithinRecentWeek) {
    currentSheet = regionOverall?.name;
    previousSheet = d1.sheetName;
    currentReason =
      "최근 7일 이내 날짜 탭이 없어 지역전체를 금번 자료로 추천했습니다.";
    previousReason = `${d1.isoDate} 날짜 탭을 지난 자료로 추천했습니다.`;
    if (!regionOverall) {
      warnings.push(
        "금번 자료로 필요한 ‘지역전체’ 탭이 없습니다. 금번 탭을 직접 선택해 주세요.",
      );
    }
  } else {
    const recentProfile = profiles.find(
      (profile) => profile.name === d1.sheetName,
    );
    const recentMetrics = recentProfile
      ? calculateWorshipSheetMetrics(recentProfile)
      : undefined;
    if (
      !recentMetrics ||
      recentMetrics.officialCount === 0 ||
      recentMetrics.validInputRatio < threshold
    ) {
      currentSheet = regionOverall?.name;
      previousSheet = d2?.sheetName;
      currentReason =
        "가장 최근 날짜 탭의 H열 입력이 부족하여 지역전체를 금번 자료로 추천했습니다.";
      previousReason = d2
        ? `${d2.isoDate} 날짜 탭을 지난 자료로 추천했습니다.`
        : "두 번째 날짜 탭이 없어 직접 선택이 필요합니다.";
      if (!regionOverall) {
        warnings.push(
          "금번 자료로 필요한 ‘지역전체’ 탭이 없습니다. 금번 탭을 직접 선택해 주세요.",
        );
      }
    } else {
      currentSheet = d1.sheetName;
      previousSheet = d2?.sheetName;
      currentReason =
        "가장 최근 날짜 탭에 구역예배 자료가 확인되어 해당 탭을 추천했습니다.";
      previousReason = d2
        ? `${d2.isoDate} 날짜 탭을 지난 자료로 추천했습니다.`
        : "두 번째 날짜 탭이 없어 직접 선택이 필요합니다.";
    }
  }

  if (!d2 && d1) {
    warnings.push("비교할 두 번째 날짜 탭이 없습니다. 지난 탭을 직접 선택해 주세요.");
  }
  if (previousSheet) {
    const previousProfile = profiles.find(
      (profile) => profile.name === previousSheet,
    );
    if (previousProfile) {
      const metrics = calculateWorshipSheetMetrics(previousProfile);
      if (metrics.validInputRatio < threshold) {
        warnings.push(
          `추천된 지난 탭의 H열 유효 입력률이 ${(metrics.validInputRatio * 100).toFixed(1)}%로 기준 미만입니다. 탭을 확인해 주세요.`,
        );
      }
    }
  }
  if (currentSheet && previousSheet && currentSheet === previousSheet) {
    previousSheet = undefined;
    warnings.push("금번 탭과 지난 탭이 같아 지난 탭을 직접 선택해야 합니다.");
  }

  return {
    currentSheet,
    previousSheet,
    currentReason,
    previousReason,
    sheetDates,
    warnings,
  };
}

function emptyCounts(): WorshipCounts {
  return { 대면: 0, 줌: 0, 통화: 0, 미참여: 0, attendedTotal: 0 };
}

function countWorshipStatuses(statuses: WorshipStatus[]): WorshipCounts {
  const counts = emptyCounts();
  for (const status of statuses) counts[status] += 1;
  counts.attendedTotal = counts.대면 + counts.줌 + counts.통화;
  return counts;
}

function emptyTransitions(): WorshipTransitionSummary {
  return {
    attendedToAbsent: [],
    faceToLower: [],
    zoomToLower: [],
    callToAbsent: [],
    toFace: [],
    callToZoom: [],
    absentToFace: [],
    absentToZoom: [],
    absentToCall: [],
  };
}

function uniqueSorted(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) =>
    a.localeCompare(b, "ko-KR", { sensitivity: "base" }),
  );
}

interface WorshipPair {
  current: WorshipPerson;
  previousStatus: WorshipStatus;
}

function calculateWorshipTransitions(
  pairs: WorshipPair[],
): WorshipTransitionSummary {
  const transitions = emptyTransitions();
  for (const pair of pairs) {
    const previous = pair.previousStatus;
    const current = pair.current.status;
    const name = pair.current.name;
    if (
      (previous === "대면" || previous === "줌" || previous === "통화") &&
      current === "미참여"
    ) {
      transitions.attendedToAbsent.push(name);
    }
    if (
      previous === "대면" &&
      (current === "줌" || current === "통화" || current === "미참여")
    ) {
      transitions.faceToLower.push(name);
    }
    if (
      previous === "줌" &&
      (current === "통화" || current === "미참여")
    ) {
      transitions.zoomToLower.push(name);
    }
    if (previous === "통화" && current === "미참여") {
      transitions.callToAbsent.push(name);
    }
    if (
      (previous === "줌" || previous === "통화") &&
      current === "대면"
    ) {
      transitions.toFace.push(name);
    }
    if (previous === "통화" && current === "줌") {
      transitions.callToZoom.push(name);
    }
    if (previous === "미참여" && current === "대면") {
      transitions.absentToFace.push(name);
    }
    if (previous === "미참여" && current === "줌") {
      transitions.absentToZoom.push(name);
    }
    if (previous === "미참여" && current === "통화") {
      transitions.absentToCall.push(name);
    }
  }
  for (const key of Object.keys(
    transitions,
  ) as Array<keyof WorshipTransitionSummary>) {
    transitions[key] = uniqueSorted(transitions[key]);
  }
  return transitions;
}

export function sortWorshipRegions(regions: string[]): string[] {
  const order = new Map(
    REGION_ORDER.map((region, index) => [canonicalize(region), index]),
  );
  return [...new Set(regions)].sort((a, b) => {
    const aIndex = order.get(canonicalize(a));
    const bIndex = order.get(canonicalize(b));
    if (aIndex != null && bIndex != null) return aIndex - bIndex;
    if (aIndex != null) return -1;
    if (bIndex != null) return 1;
    return a.localeCompare(b, "ko-KR", { sensitivity: "base" });
  });
}

function buildRegionAnalysis(
  region: string,
  currentPeople: WorshipPerson[],
  previousPeople: WorshipPerson[],
  pairs: WorshipPair[],
): WorshipRegionAnalysis {
  const currentCounts = countWorshipStatuses(
    currentPeople.map((person) => person.status),
  );
  const previousCounts = countWorshipStatuses(
    previousPeople.map((person) => person.status),
  );
  return {
    region,
    rosterCount: currentPeople.length,
    currentCounts,
    previousCounts,
    participationRate:
      currentPeople.length === 0
        ? 0
        : currentCounts.attendedTotal / currentPeople.length,
    transitions: calculateWorshipTransitions(pairs),
  };
}

function unknownCount(
  metrics: Pick<WorshipSheetMetrics, "unknownStatusCounts">,
): number {
  return Object.values(metrics.unknownStatusCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
}

export function analyzeWorshipComparison(
  profiles: SheetProfile[],
  currentSheetName: string,
  previousSheetName: string,
  referenceIsoDate: string,
  threshold = 0.5,
): WorshipAnalysisResult {
  if (!currentSheetName || !previousSheetName) {
    throw new Error("금번 구역예배 탭과 지난 구역예배 탭을 모두 선택해 주세요.");
  }
  if (currentSheetName === previousSheetName) {
    throw new Error(
      "금번 구역예배 탭과 지난 구역예배 탭은 서로 달라야 합니다.",
    );
  }
  const currentSheet = profiles.find(
    (profile) => profile.name === currentSheetName,
  );
  const previousSheet = profiles.find(
    (profile) => profile.name === previousSheetName,
  );
  if (!currentSheet || !previousSheet) {
    throw new Error("선택한 탭을 찾지 못했습니다. 파일을 다시 선택해 주세요.");
  }
  if (
    !currentSheet.metrics.worshipColumnsReadable ||
    !previousSheet.metrics.worshipColumnsReadable
  ) {
    throw new Error(
      "선택한 탭에서 A·D·G·H열을 읽을 수 없습니다. 엑셀 열 구성을 확인해 주세요.",
    );
  }

  const currentMetrics = calculateWorshipSheetMetrics(currentSheet);
  const previousMetrics = calculateWorshipSheetMetrics(previousSheet);
  const currentInputMetrics = calculateAllInputMetrics(currentSheet);
  const previousInputMetrics = calculateAllInputMetrics(previousSheet);
  if (currentInputMetrics.personCount === 0) {
    throw new Error(
      "금번 탭에서 D열 이름이 입력된 분석 대상을 찾지 못했습니다. 탭 선택을 확인해 주세요.",
    );
  }
  if (currentInputMetrics.validInputCount === 0) {
    throw new Error(
      "금번 탭의 H열에 인식 가능한 구역예배 입력이 없습니다. 자료 입력 또는 탭 선택을 확인해 주세요.",
    );
  }

  const currentPrepared = chooseRows(currentSheet, false);
  const previousPrepared = chooseRows(previousSheet, false);
  const previousByKey = new Map(
    previousPrepared.people.map((person) => [
      `${person.canonicalRegion}\u0000${person.canonicalName}`,
      person,
    ]),
  );
  const previousByName = new Map<string, WorshipPerson[]>();
  for (const person of previousPrepared.people) {
    const group = previousByName.get(person.canonicalName) ?? [];
    group.push(person);
    previousByName.set(person.canonicalName, group);
  }
  const currentNameCounts = new Map<string, number>();
  for (const person of currentPrepared.people) {
    currentNameCounts.set(
      person.canonicalName,
      (currentNameCounts.get(person.canonicalName) ?? 0) + 1,
    );
  }

  const pairs: WorshipPair[] = [];
  const usedPrevious = new Set<string>();
  const ambiguousNames: string[] = [];
  const unmatchedCurrentNames: string[] = [];
  const movedNames: string[] = [];

  for (const current of currentPrepared.people) {
    const exactKey = `${current.canonicalRegion}\u0000${current.canonicalName}`;
    let previous = previousByKey.get(exactKey);
    if (
      !previous &&
      currentNameCounts.get(current.canonicalName) === 1 &&
      previousByName.get(current.canonicalName)?.length === 1
    ) {
      previous = previousByName.get(current.canonicalName)?.[0];
      if (
        previous &&
        previous.canonicalRegion !== current.canonicalRegion
      ) {
        movedNames.push(current.name);
      }
    } else if (
      !previous &&
      (currentNameCounts.get(current.canonicalName) ?? 0) > 1
    ) {
      ambiguousNames.push(current.name);
    } else if (
      !previous &&
      (previousByName.get(current.canonicalName)?.length ?? 0) > 1
    ) {
      ambiguousNames.push(current.name);
    }

    if (previous) {
      usedPrevious.add(
        `${previous.canonicalRegion}\u0000${previous.canonicalName}`,
      );
    } else {
      unmatchedCurrentNames.push(current.name);
    }
    pairs.push({
      current,
      previousStatus: previous?.status ?? "미참여",
    });
  }

  const regionNames = sortWorshipRegions(
    [...currentPrepared.people, ...previousPrepared.people].map(
      (person) => person.region,
    ),
  );
  const regions = regionNames.map((region) => {
    const canonicalRegion = canonicalize(region);
    return buildRegionAnalysis(
      region,
      currentPrepared.people.filter(
        (person) => person.canonicalRegion === canonicalRegion,
      ),
      previousPrepared.people.filter(
        (person) => person.canonicalRegion === canonicalRegion,
      ),
      pairs.filter(
        (pair) => pair.current.canonicalRegion === canonicalRegion,
      ),
    );
  });
  const totals = buildRegionAnalysis(
    "전체 지역",
    currentPrepared.people,
    previousPrepared.people,
    pairs,
  );
  const excludedPreviousCount = previousPrepared.people.filter(
    (person) =>
      !usedPrevious.has(
        `${person.canonicalRegion}\u0000${person.canonicalName}`,
      ),
  ).length;

  const warnings: string[] = [];
  for (const [label, metrics] of [
    ["금번", currentInputMetrics],
    ["지난", previousInputMetrics],
  ] as const) {
    if (metrics.validInputRatio < threshold) {
      warnings.push(
        `${label} 탭의 H열 유효 입력률이 ${(metrics.validInputRatio * 100).toFixed(1)}%로 기준 ${(threshold * 100).toFixed(0)}% 미만입니다.`,
      );
    }
    if (metrics.blankInputCount > 0) {
      warnings.push(
        `${label} 탭의 H열 빈값 ${metrics.blankInputCount}명은 미참여로 처리했습니다.`,
      );
    }
    if (unknownCount(metrics) > 0) {
      const values = Object.entries(metrics.unknownStatusCounts)
        .map(([value, count]) => `${value} ${count}건`)
        .join(", ");
      warnings.push(
        `${label} 탭의 인식되지 않은 H열 값 ${unknownCount(metrics)}건은 미참여로 처리했습니다: ${values}`,
      );
    }
    if (metrics.duplicatePersonCount > 0) {
      warnings.push(
        `${label} 탭의 중복 인원 ${metrics.duplicatePersonCount}명은 마지막 유효 H열 값을 사용했습니다.`,
      );
    }
    if (metrics.missingRegionCount > 0) {
      warnings.push(
        `${label} 탭의 지역 미지정 인원 ${metrics.missingRegionCount}명을 ‘지역 미지정’으로 분류했습니다.`,
      );
    }
  }
  if (ambiguousNames.length > 0) {
    warnings.push(
      `중복 이름으로 지난 상태를 정확히 연결하지 못한 ${uniqueSorted(ambiguousNames).length}명은 지난 상태를 미참여로 처리했습니다.`,
    );
  }
  if (unmatchedCurrentNames.length > 0) {
    warnings.push(
      `지난 탭에서 찾지 못한 현재 인원 ${uniqueSorted(unmatchedCurrentNames).length}명은 지난 상태를 미참여로 처리했습니다.`,
    );
  }
  if (movedNames.length > 0) {
    warnings.push(
      `지역이 변경된 것으로 연결된 인원은 ${uniqueSorted(movedNames).length}명입니다.`,
    );
  }
  if (excludedPreviousCount > 0) {
    warnings.push(
      `지난 탭에는 있지만 현재 명단에 없는 ${excludedPreviousCount}명은 분석에서 제외했습니다.`,
    );
  }

  return {
    currentSheet,
    previousSheet,
    currentDate: interpretWorshipTabDate(currentSheet.name, referenceIsoDate),
    previousDate: interpretWorshipTabDate(previousSheet.name, referenceIsoDate),
    currentMetrics,
    previousMetrics,
    currentInputMetrics,
    previousInputMetrics,
    regions,
    totals,
    matches: {
      ambiguousNames: uniqueSorted(ambiguousNames),
      unmatchedCurrentNames: uniqueSorted(unmatchedCurrentNames),
      movedNames: uniqueSorted(movedNames),
      excludedPreviousCount,
    },
    warnings,
    excludedCount:
      excludedPreviousCount + uniqueSorted(ambiguousNames).length,
  };
}

export function formatWorshipDelta(value: number): string {
  if (value > 0) return `${value}명 증가`;
  if (value < 0) return `${Math.abs(value)}명 하락`;
  return "변동 없음";
}

export function formatParticipationRate(value: number): string {
  const percentage = value * 100;
  return Number.isInteger(percentage)
    ? percentage.toFixed(0)
    : percentage.toFixed(1);
}

export function isRecognizedWorshipStatus(value: unknown): boolean {
  return classifyWorshipStatus(value).validInput;
}

export function worshipStatusLabels(): readonly WorshipStatus[] {
  return WORSHIP_STATUSES;
}
