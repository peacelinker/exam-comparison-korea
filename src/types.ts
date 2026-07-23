export const ATTENDED_STATUSES = [
  "정규응시",
  "정규응시(타지파)",
  "대면응시",
  "일대일응시",
  "서면응시",
  "비공식응시",
] as const;

export const NOT_ATTENDED_STATUS = "미응시" as const;

export const OFFICIAL_WORSHIP_VALUES = [
  "9시",
  "12시",
  "15시",
  "19시",
  "사랑예배",
  "타교회예배",
  "협력교회예배",
] as const;

export type AttendedStatus = (typeof ATTENDED_STATUSES)[number];
export type ExamStatus = AttendedStatus | typeof NOT_ATTENDED_STATUS;
export type StatusKind = ExamStatus | "blank" | "unknown";

export interface DataRow {
  rowNumber: number;
  region: string;
  name: string;
  worship: string;
  exam: string;
  canonicalRegion: string;
  canonicalName: string;
  canonicalWorship: string;
  status: StatusKind;
}

export interface SheetMetrics {
  dataRowCount: number;
  blankStatusCount: number;
  nonEmptyStatusCount: number;
  validStatusCount: number;
  validStatusRatio: number;
  unknownStatusCounts: Record<string, number>;
  missingRegionOrNameCount: number;
  formulaWithoutCachedValueCount: number;
  columnsReadable: boolean;
}

export interface SheetProfile {
  name: string;
  rows: DataRow[];
  metrics: SheetMetrics;
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: SheetProfile[];
}

export interface ParsedTabDate {
  month: number;
  day: number;
}

export interface SheetDateInfo extends ParsedTabDate {
  sheetName: string;
  isoDate: string;
  diffDays: number;
  isFuture: boolean;
  isWithinRecentWeek: boolean;
}

export interface Recommendation {
  currentSheet?: string;
  previousSheet?: string;
  currentReason: string;
  previousReason: string;
  sheetDates: Array<{ sheetName: string; date?: SheetDateInfo }>;
  duplicateDates: Array<{ isoDate: string; sheets: string[] }>;
  warnings: string[];
}

export interface StatusCounts {
  정규응시: number;
  "정규응시(타지파)": number;
  대면응시: number;
  일대일응시: number;
  서면응시: number;
  비공식응시: number;
  미응시: number;
  blank: number;
  unknown: number;
  attendedTotal: number;
  regularGroup: number;
}

export interface MatchedPair {
  current: DataRow;
  previous: DataRow;
}

export interface MatchResult {
  pairs: MatchedPair[];
  ambiguousNames: string[];
  newNames: string[];
  missingNames: string[];
}

export interface TransitionBucket {
  fromAttendedToNot: Record<AttendedStatus, string[]>;
  fromNotToAttended: Record<AttendedStatus, string[]>;
}

export interface RegionAnalysis {
  region: string;
  currentCounts: StatusCounts;
  previousCounts: StatusCounts;
  transitions: TransitionBucket;
  officialWorshipNotAttended: string[];
}

export interface AnalysisResult {
  currentSheet: SheetProfile;
  previousSheet: SheetProfile;
  currentDate?: SheetDateInfo;
  previousDate?: SheetDateInfo;
  regions: RegionAnalysis[];
  currentTotals: StatusCounts;
  previousTotals: StatusCounts;
  matches: MatchResult;
  sameAsRegionOverall: boolean;
  warnings: string[];
  excludedCount: number;
}
