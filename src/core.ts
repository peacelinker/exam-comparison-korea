import {
  ATTENDED_STATUSES,
  NOT_ATTENDED_STATUS,
  OFFICIAL_WORSHIP_VALUES,
  type AnalysisResult,
  type AttendedStatus,
  type DataRow,
  type MatchResult,
  type ParsedTabDate,
  type Recommendation,
  type RegionAnalysis,
  type SheetDateInfo,
  type SheetMetrics,
  type SheetProfile,
  type StatusCounts,
  type StatusKind,
  type TransitionBucket,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const attendedSet = new Set<string>(ATTENDED_STATUSES);
const officialWorshipSet = new Set<string>(
  OFFICIAL_WORSHIP_VALUES.map((value) => canonicalize(value)),
);

export function canonicalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "");
}

export function classifyStatus(value: unknown): StatusKind {
  const normalized = canonicalize(value);
  if (!normalized) return "blank";
  if (attendedSet.has(normalized)) return normalized as AttendedStatus;
  if (normalized === NOT_ATTENDED_STATUS) return NOT_ATTENDED_STATUS;
  return "unknown";
}

export function createDataRow(
  rowNumber: number,
  region: unknown,
  name: unknown,
  worship: unknown,
  exam: unknown,
): DataRow {
  const display = (value: unknown) => String(value ?? "").trim();
  const rawRegion = display(region);
  const rawName = display(name);
  const rawWorship = display(worship);
  const rawExam = display(exam);

  return {
    rowNumber,
    region: rawRegion,
    name: rawName,
    worship: rawWorship,
    exam: rawExam,
    canonicalRegion: canonicalize(rawRegion),
    canonicalName: canonicalize(rawName),
    canonicalWorship: canonicalize(rawWorship),
    status: classifyStatus(rawExam),
  };
}

export function calculateMetrics(
  rows: DataRow[],
  options: {
    missingRegionOrNameCount?: number;
    formulaWithoutCachedValueCount?: number;
    columnsReadable?: boolean;
  } = {},
): SheetMetrics {
  const unknownStatusCounts: Record<string, number> = {};
  let blankStatusCount = 0;
  let validStatusCount = 0;

  for (const row of rows) {
    if (row.status === "blank") {
      blankStatusCount += 1;
    } else if (row.status === "unknown") {
      const key = row.exam || "(표시할 수 없는 값)";
      unknownStatusCounts[key] = (unknownStatusCounts[key] ?? 0) + 1;
    } else {
      validStatusCount += 1;
    }
  }

  return {
    dataRowCount: rows.length,
    blankStatusCount,
    nonEmptyStatusCount: rows.length - blankStatusCount,
    validStatusCount,
    validStatusRatio: rows.length === 0 ? 0 : validStatusCount / rows.length,
    unknownStatusCounts,
    missingRegionOrNameCount: options.missingRegionOrNameCount ?? 0,
    formulaWithoutCachedValueCount:
      options.formulaWithoutCachedValueCount ?? 0,
    columnsReadable: options.columnsReadable ?? true,
  };
}

export function createSheetProfile(
  name: string,
  rows: DataRow[],
  options: Parameters<typeof calculateMetrics>[1] = {},
): SheetProfile {
  return { name, rows, metrics: calculateMetrics(rows, options) };
}

export function parseDateTabName(name: string): ParsedTabDate | null {
  const normalized = name.normalize("NFKC").trim();
  let month: number;
  let day: number;

  const compact = normalized.match(/^(\d{2})(\d{2})(?:시험)?$/);
  const separated = normalized.match(/^(\d{1,2})[./-](\d{1,2})(?:시험)?$/);
  if (compact) {
    month = Number(compact[1]);
    day = Number(compact[2]);
  } else if (separated) {
    month = Number(separated[1]);
    day = Number(separated[2]);
  } else {
    return null;
  }

  if (!isValidMonthDay(month, day)) return null;
  return { month, day };
}

function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  const candidate = new Date(Date.UTC(2000, month - 1, day));
  return (
    candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
  );
}

function parseIsoDate(isoDate: string): Date {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("날짜 형식은 YYYY-MM-DD여야 합니다.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("실제 달력에 존재하는 날짜를 입력해 주세요.");
  }
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getSeoulToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function interpretTabDate(
  sheetName: string,
  referenceIsoDate: string,
): SheetDateInfo | undefined {
  const parsed = parseDateTabName(sheetName);
  if (!parsed) return undefined;

  const reference = parseIsoDate(referenceIsoDate);
  const referenceYear = reference.getUTCFullYear();
  const candidates = [referenceYear, referenceYear - 1].map(
    (year) => new Date(Date.UTC(year, parsed.month - 1, parsed.day)),
  );
  const notTooFarFuture = candidates.filter(
    (candidate) => (candidate.getTime() - reference.getTime()) / DAY_MS <= 7,
  );
  const nonFuture = notTooFarFuture
    .filter((candidate) => candidate <= reference)
    .sort((a, b) => b.getTime() - a.getTime());
  const selected =
    nonFuture[0] ??
    notTooFarFuture.sort(
      (a, b) =>
        Math.abs(a.getTime() - reference.getTime()) -
        Math.abs(b.getTime() - reference.getTime()),
    )[0];
  if (!selected) return undefined;

  const diffDays = Math.round(
    (reference.getTime() - selected.getTime()) / DAY_MS,
  );
  return {
    sheetName,
    month: parsed.month,
    day: parsed.day,
    isoDate: toIsoDate(selected),
    diffDays,
    isFuture: diffDays < 0,
    isWithinRecentWeek: diffDays >= 0 && diffDays <= 7,
  };
}

function dateGroupMap(dateInfos: SheetDateInfo[]): Map<string, SheetDateInfo[]> {
  const groups = new Map<string, SheetDateInfo[]>();
  for (const info of dateInfos) {
    const group = groups.get(info.isoDate) ?? [];
    group.push(info);
    groups.set(info.isoDate, group);
  }
  return groups;
}

function profileByName(
  profiles: SheetProfile[],
  name: string,
): SheetProfile | undefined {
  return profiles.find((profile) => profile.name === name);
}

function selectPreviousValidSheet(
  profiles: SheetProfile[],
  dateInfos: SheetDateInfo[],
  beforeIsoDate: string,
  threshold: number,
): { name?: string; reason: string; warning?: string } {
  const profileMap = new Map(profiles.map((profile) => [profile.name, profile]));
  const eligible = dateInfos
    .filter((date) => date.isoDate < beforeIsoDate && !date.isFuture)
    .filter((date) => {
      const profile = profileMap.get(date.sheetName);
      return Boolean(profile && profile.metrics.validStatusRatio >= threshold);
    });
  const groups = dateGroupMap(eligible);
  const dates = [...groups.keys()].sort((a, b) => b.localeCompare(a));
  if (dates.length === 0) {
    return {
      reason: "기준을 충족하는 더 오래된 날짜형 시험 탭이 없습니다. 직접 선택해 주세요.",
    };
  }

  const latestGroup = groups.get(dates[0]) ?? [];
  if (latestGroup.length > 1) {
    return {
      reason: `${dates[0]}로 해석되는 유효 탭이 여러 개라 자동 확정하지 않았습니다.`,
      warning: `${dates[0]} 직전 시험 후보가 중복됩니다: ${latestGroup
        .map((item) => item.sheetName)
        .join(", ")}`,
    };
  }

  return {
    name: latestGroup[0].sheetName,
    reason: `${latestGroup[0].isoDate}로 해석되며, 더 오래된 탭 중 유효 입력률 기준을 충족하는 가장 최근 탭입니다.`,
  };
}

export function recommendSheets(
  profiles: SheetProfile[],
  referenceIsoDate: string,
  threshold = 0.5,
  latestExamIsoDate?: string,
): Recommendation {
  const sheetDates = profiles.map((profile) => ({
    sheetName: profile.name,
    date: interpretTabDate(profile.name, referenceIsoDate),
  }));
  const dateInfos = sheetDates
    .map((item) => item.date)
    .filter((item): item is SheetDateInfo => Boolean(item));
  const dateGroups = dateGroupMap(dateInfos);
  const duplicateDates = [...dateGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([isoDate, items]) => ({
      isoDate,
      sheets: items.map((item) => item.sheetName),
    }));
  const warnings = duplicateDates.map(
    (duplicate) =>
      `${duplicate.isoDate}로 해석되는 탭이 중복됩니다: ${duplicate.sheets.join(", ")}`,
  );

  let candidateGroup: SheetDateInfo[] | undefined;
  let usedHint = false;
  if (latestExamIsoDate) {
    const hint = parseIsoDate(latestExamIsoDate);
    const month = hint.getUTCMonth() + 1;
    const day = hint.getUTCDate();
    const matching = dateInfos.filter(
      (info) => info.month === month && info.day === day,
    );
    if (matching.length > 0) {
      candidateGroup = matching;
      usedHint = true;
    } else {
      warnings.push(
        `최근 시험일 ${latestExamIsoDate}의 월·일과 일치하는 날짜형 탭이 없습니다.`,
      );
    }
  }

  if (!candidateGroup) {
    const recent = dateInfos.filter((info) => info.isWithinRecentWeek);
    const latestDate = recent
      .map((info) => info.isoDate)
      .sort((a, b) => b.localeCompare(a))[0];
    if (latestDate) candidateGroup = dateGroups.get(latestDate);
  }

  const regionOverall = profiles.find(
    (profile) => canonicalize(profile.name) === "지역전체",
  );

  if (!candidateGroup || candidateGroup.length === 0) {
    const previous = selectPreviousValidSheet(
      profiles,
      dateInfos,
      referenceIsoDate,
      threshold,
    );
    if (previous.warning) warnings.push(previous.warning);
    return {
      currentSheet: regionOverall?.name,
      previousSheet: previous.name,
      currentReason: regionOverall
        ? "기준일로부터 최근 7일 이내 날짜형 탭이 없어 ‘지역전체’를 추천했습니다."
        : "최근 7일 이내 날짜형 탭과 ‘지역전체’ 탭이 없어 직접 선택이 필요합니다.",
      previousReason: previous.reason,
      sheetDates,
      duplicateDates,
      warnings,
    };
  }

  if (candidateGroup.length > 1) {
    const label = usedHint ? "최근 시험일과 일치하는" : "가장 최근 날짜로 해석되는";
    warnings.push(
      `${label} 탭이 여러 개이므로 이번 시험 탭을 직접 선택해야 합니다.`,
    );
    return {
      currentSheet: undefined,
      previousSheet: undefined,
      currentReason: `${label} 탭이 여러 개라 자동 확정하지 않았습니다.`,
      previousReason:
        "이번 시험 탭을 먼저 선택한 뒤 직전 시험 탭을 확인해 주세요.",
      sheetDates,
      duplicateDates,
      warnings,
    };
  }

  const candidate = candidateGroup[0];
  const profile = profileByName(profiles, candidate.sheetName);
  if (!profile) {
    throw new Error("추천 후보 시트를 찾을 수 없습니다.");
  }
  const ratio = profile.metrics.validStatusRatio;
  const previous = selectPreviousValidSheet(
    profiles,
    dateInfos,
    candidate.isoDate,
    threshold,
  );
  if (previous.warning) warnings.push(previous.warning);

  if (ratio < threshold) {
    warnings.push(
      `${profile.name} 탭의 I열 유효 입력률이 ${(ratio * 100).toFixed(1)}%로 기준 미만입니다.`,
    );
    return {
      currentSheet: regionOverall?.name,
      previousSheet: previous.name,
      currentReason: regionOverall
        ? `${profile.name}은(는) 최근 날짜형 탭이지만 I열 유효 입력률이 기준 미만이라 ‘지역전체’를 추천했습니다.`
        : `${profile.name}은(는) 입력률 기준 미만이고 ‘지역전체’가 없어 직접 선택이 필요합니다.`,
      previousReason: `${profile.name}은(는) 불완전하여 건너뛰었습니다. ${previous.reason}`,
      sheetDates,
      duplicateDates,
      warnings,
    };
  }

  return {
    currentSheet: candidate.sheetName,
    previousSheet: previous.name,
    currentReason: usedHint
      ? `입력한 최근 시험일과 월·일이 일치하고 I열 유효 입력률이 ${(ratio * 100).toFixed(1)}%로 기준을 충족합니다.`
      : `최근 7일 이내 가장 최근 날짜형 탭이며 I열 유효 입력률이 ${(ratio * 100).toFixed(1)}%로 기준을 충족합니다.`,
    previousReason: previous.reason,
    sheetDates,
    duplicateDates,
    warnings,
  };
}

export function emptyStatusCounts(): StatusCounts {
  return {
    정규응시: 0,
    "정규응시(타지파)": 0,
    대면응시: 0,
    일대일응시: 0,
    서면응시: 0,
    비공식응시: 0,
    미응시: 0,
    blank: 0,
    unknown: 0,
    attendedTotal: 0,
    regularGroup: 0,
  };
}

export function countStatuses(rows: DataRow[]): StatusCounts {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    counts[row.status] += 1;
  }
  counts.attendedTotal = ATTENDED_STATUSES.reduce(
    (sum, status) => sum + counts[status],
    0,
  );
  counts.regularGroup =
    counts.정규응시 + counts["정규응시(타지파)"] + counts.대면응시;
  return counts;
}

function groupRows(
  rows: DataRow[],
  key: (row: DataRow) => string,
): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  return groups;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, "ko", { sensitivity: "base" }),
  );
}

export function matchPeople(
  currentRows: DataRow[],
  previousRows: DataRow[],
): MatchResult {
  const currentByName = groupRows(currentRows, (row) => row.canonicalName);
  const previousByName = groupRows(previousRows, (row) => row.canonicalName);
  const allNames = new Set([...currentByName.keys(), ...previousByName.keys()]);
  const pairs: MatchResult["pairs"] = [];
  const ambiguousNames: string[] = [];
  const newNames: string[] = [];
  const missingNames: string[] = [];

  for (const nameKey of allNames) {
    if (!nameKey) continue;
    const current = currentByName.get(nameKey) ?? [];
    const previous = previousByName.get(nameKey) ?? [];
    if (previous.length === 0) {
      newNames.push(...current.map((row) => row.name));
      continue;
    }
    if (current.length === 0) {
      missingNames.push(...previous.map((row) => row.name));
      continue;
    }
    if (current.length === 1 && previous.length === 1) {
      pairs.push({ current: current[0], previous: previous[0] });
      continue;
    }

    const currentByRegion = groupRows(
      current,
      (row) => `${row.canonicalRegion}\u0000${row.canonicalName}`,
    );
    const previousByRegion = groupRows(
      previous,
      (row) => `${row.canonicalRegion}\u0000${row.canonicalName}`,
    );
    const allRegionKeys = new Set([
      ...currentByRegion.keys(),
      ...previousByRegion.keys(),
    ]);
    let unresolved = false;
    for (const regionKey of allRegionKeys) {
      const currentRegionRows = currentByRegion.get(regionKey) ?? [];
      const previousRegionRows = previousByRegion.get(regionKey) ?? [];
      if (
        currentRegionRows.length === 1 &&
        previousRegionRows.length === 1
      ) {
        pairs.push({
          current: currentRegionRows[0],
          previous: previousRegionRows[0],
        });
      } else if (
        currentRegionRows.length > 0 ||
        previousRegionRows.length > 0
      ) {
        unresolved = true;
      }
    }
    if (unresolved) {
      ambiguousNames.push(current[0]?.name ?? previous[0].name);
    }
  }

  return {
    pairs,
    ambiguousNames: uniqueSorted(ambiguousNames),
    newNames: uniqueSorted(newNames),
    missingNames: uniqueSorted(missingNames),
  };
}

function emptyTransitions(): TransitionBucket {
  const createBuckets = (): Record<AttendedStatus, string[]> =>
    ATTENDED_STATUSES.reduce(
      (buckets, status) => {
        buckets[status] = [];
        return buckets;
      },
      {} as Record<AttendedStatus, string[]>,
    );

  return {
    fromAttendedToNot: createBuckets(),
    fromNotToAttended: createBuckets(),
  };
}

export function calculateTransitions(
  matches: MatchResult["pairs"],
  currentRegion?: string,
): TransitionBucket {
  const transitions = emptyTransitions();
  for (const pair of matches) {
    if (
      currentRegion &&
      pair.current.canonicalRegion !== canonicalize(currentRegion)
    ) {
      continue;
    }
    const previous = pair.previous.status;
    const current = pair.current.status;
    if (attendedSet.has(previous) && current === NOT_ATTENDED_STATUS) {
      transitions.fromAttendedToNot[previous as AttendedStatus].push(
        pair.current.name,
      );
    }
    if (
      previous === NOT_ATTENDED_STATUS &&
      attendedSet.has(current)
    ) {
      transitions.fromNotToAttended[current as AttendedStatus].push(
        pair.current.name,
      );
    }
  }

  for (const status of ATTENDED_STATUSES) {
    transitions.fromAttendedToNot[status] = uniqueSorted(
      transitions.fromAttendedToNot[status],
    );
    transitions.fromNotToAttended[status] = uniqueSorted(
      transitions.fromNotToAttended[status],
    );
  }
  return transitions;
}

function relevantRowsEqual(a: DataRow[], b: DataRow[]): boolean {
  if (a.length !== b.length) return false;
  const signature = (row: DataRow) =>
    [
      row.canonicalRegion,
      row.canonicalName,
      row.canonicalWorship,
      canonicalize(row.exam),
    ].join("\u0001");
  return a.every((row, index) => signature(row) === signature(b[index]));
}

function validateSelectedSheet(profile: SheetProfile, label: string): void {
  if (!profile.metrics.columnsReadable) {
    throw new Error(
      `${label} ‘${profile.name}’에서 A·D·G·I열을 읽을 수 없습니다. 열 위치와 시트 범위를 확인해 주세요.`,
    );
  }
  if (profile.metrics.dataRowCount === 0) {
    if (profile.metrics.formulaWithoutCachedValueCount > 0) {
      throw new Error(
        `${label} ‘${profile.name}’의 수식 셀에 저장된 값이 없어 데이터를 읽을 수 없습니다. 원본 엑셀에서 계산 후 저장하거나 다른 탭을 선택해 주세요.`,
      );
    }
    throw new Error(
      `${label} ‘${profile.name}’의 D열에 이름이 있는 데이터 행이 없습니다. 시트 선택을 확인해 주세요.`,
    );
  }
}

export function analyzeComparison(
  profiles: SheetProfile[],
  currentSheetName: string,
  previousSheetName: string,
  referenceIsoDate: string,
  threshold = 0.5,
): AnalysisResult {
  if (!currentSheetName || !previousSheetName) {
    throw new Error("이번 시험 탭과 직전 시험 탭을 모두 선택해 주세요.");
  }
  if (currentSheetName === previousSheetName) {
    throw new Error(
      "이번 시험 탭과 직전 시험 탭이 같습니다. 서로 다른 탭을 선택해 주세요.",
    );
  }
  const currentSheet = profileByName(profiles, currentSheetName);
  const previousSheet = profileByName(profiles, previousSheetName);
  if (!currentSheet || !previousSheet) {
    throw new Error(
      "선택한 시트를 찾을 수 없습니다. 파일을 다시 불러오고 탭을 선택해 주세요.",
    );
  }
  validateSelectedSheet(currentSheet, "이번 시험 탭");
  validateSelectedSheet(previousSheet, "직전 시험 탭");

  const matches = matchPeople(currentSheet.rows, previousSheet.rows);
  const currentRegions = new Map<string, string>();
  for (const row of currentSheet.rows) {
    if (row.canonicalRegion && !currentRegions.has(row.canonicalRegion)) {
      currentRegions.set(row.canonicalRegion, row.region);
    }
  }
  const regionNames = [...currentRegions.values()].sort((a, b) =>
    a.localeCompare(b, "ko", { sensitivity: "base" }),
  );
  const regions: RegionAnalysis[] = regionNames.map((region) => {
    const regionKey = canonicalize(region);
    const currentRows = currentSheet.rows.filter(
      (row) => row.canonicalRegion === regionKey,
    );
    const previousRows = previousSheet.rows.filter(
      (row) => row.canonicalRegion === regionKey,
    );
    const officialWorshipNotAttended = uniqueSorted(
      currentRows
        .filter(
          (row) =>
            row.status === NOT_ATTENDED_STATUS &&
            officialWorshipSet.has(row.canonicalWorship),
        )
        .map((row) => row.name),
    );
    return {
      region,
      currentCounts: countStatuses(currentRows),
      previousCounts: countStatuses(previousRows),
      transitions: calculateTransitions(matches.pairs, region),
      officialWorshipNotAttended,
    };
  });

  const warnings: string[] = [];
  for (const [label, sheet] of [
    ["이번 시험", currentSheet],
    ["직전 시험", previousSheet],
  ] as const) {
    if (sheet.metrics.validStatusRatio < threshold) {
      warnings.push(
        `${label} 탭의 I열 유효 입력률이 ${(sheet.metrics.validStatusRatio * 100).toFixed(1)}%로 자동 추천 기준 미만입니다.`,
      );
    }
    if (sheet.metrics.blankStatusCount > 0) {
      warnings.push(
        `${label} 탭의 I열 빈값 ${sheet.metrics.blankStatusCount}건은 미응시로 계산하지 않았습니다.`,
      );
    }
    const unknownCount = Object.values(
      sheet.metrics.unknownStatusCounts,
    ).reduce((sum, count) => sum + count, 0);
    if (unknownCount > 0) {
      warnings.push(
        `${label} 탭의 알 수 없는 시험 상태 ${unknownCount}건은 미분류로 제외했습니다.`,
      );
    }
  }
  if (matches.ambiguousNames.length > 0) {
    warnings.push(
      `중복 이름으로 ${matches.ambiguousNames.length}명을 개인 전환 분석에서 제외했습니다.`,
    );
  }
  if (matches.newNames.length > 0) {
    warnings.push(`이번 탭에만 있는 신규 명단이 ${matches.newNames.length}명입니다.`);
  }
  if (matches.missingNames.length > 0) {
    warnings.push(
      `직전 탭에만 있는 누락/이탈 명단이 ${matches.missingNames.length}명입니다.`,
    );
  }

  const regionOverall = profiles.find(
    (profile) => canonicalize(profile.name) === "지역전체",
  );
  const sameAsRegionOverall = Boolean(
    regionOverall &&
      regionOverall.name !== currentSheet.name &&
      relevantRowsEqual(currentSheet.rows, regionOverall.rows),
  );
  if (sameAsRegionOverall) {
    warnings.push(
      `이번 탭과 ‘${regionOverall?.name}’의 A·D·G·I 데이터가 완전히 같습니다.`,
    );
  }

  const excludedCount =
    matches.ambiguousNames.length +
    currentSheet.metrics.blankStatusCount +
    previousSheet.metrics.blankStatusCount +
    Object.values(currentSheet.metrics.unknownStatusCounts).reduce(
      (sum, count) => sum + count,
      0,
    ) +
    Object.values(previousSheet.metrics.unknownStatusCounts).reduce(
      (sum, count) => sum + count,
      0,
    );

  return {
    currentSheet,
    previousSheet,
    currentDate: interpretTabDate(currentSheet.name, referenceIsoDate),
    previousDate: interpretTabDate(previousSheet.name, referenceIsoDate),
    regions,
    currentTotals: countStatuses(currentSheet.rows),
    previousTotals: countStatuses(previousSheet.rows),
    matches,
    sameAsRegionOverall,
    warnings,
    excludedCount,
  };
}

export function formatDelta(value: number): string {
  if (value > 0) return `${value}명 증가`;
  if (value < 0) return `${Math.abs(value)}명 감소`;
  return "변동 없음";
}

export function isOfficialWorship(value: unknown): boolean {
  return officialWorshipSet.has(canonicalize(value));
}
