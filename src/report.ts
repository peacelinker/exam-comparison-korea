import { formatDelta } from "./core";
import {
  ATTENDED_STATUSES,
  type AnalysisResult,
  type AttendedStatus,
  type RegionAnalysis,
} from "./types";

function namesBlock(names: string[]): string {
  if (names.length === 0) return "- 없음";
  return names.map((name) => `- ${name}`).join("\n");
}

function sumBuckets(
  buckets: Record<AttendedStatus, string[]>,
): number {
  return ATTENDED_STATUSES.reduce(
    (sum, status) => sum + buckets[status].length,
    0,
  );
}

function regionLabel(region: string): string {
  return region.endsWith("지역") ? region : `${region}지역`;
}

export function buildRegionReport(region: RegionAnalysis): string {
  const current = region.currentCounts;
  const previous = region.previousCounts;
  const down = region.transitions.fromAttendedToNot;
  const up = region.transitions.fromNotToAttended;
  const downSections = ATTENDED_STATUSES.map(
    (status) =>
      `• '${status}' → '미응시': ${down[status].length}명\n${namesBlock(down[status])}`,
  ).join("\n\n");
  const upSections = ATTENDED_STATUSES.map(
    (status) =>
      `• '${status}': ${up[status].length}명\n${namesBlock(up[status])}`,
  ).join("\n\n");

  return `• ${regionLabel(region.region)}

1. 전체 응시자: ${current.attendedTotal}명
(지난 시험 대비 ${formatDelta(current.attendedTotal - previous.attendedTotal)})
- '정규응시' + '정규응시(타지파)' + '대면응시': ${current.regularGroup}명
(지난 시험 대비 ${formatDelta(current.regularGroup - previous.regularGroup)})
- 일대일응시: ${current.일대일응시}명
- 서면응시: ${current.서면응시}명
- 비공식응시: ${current.비공식응시}명
- 미응시: ${current.미응시}명

2. 증감추이 분석
1) 응시 → 미응시: 총 ${sumBuckets(down)}명
${downSections}

2) '미응시' → 응시: 총 ${sumBuckets(up)}명
${upSections}

3. 정식예배자 중 미응시자: 총 ${region.officialWorshipNotAttended.length}명
${namesBlock(region.officialWorshipNotAttended)}`;
}

export function buildReportSummary(analysis: AnalysisResult): string {
  const currentRatio = (
    analysis.currentSheet.metrics.validStatusRatio * 100
  ).toFixed(1);
  const previousRatio = (
    analysis.previousSheet.metrics.validStatusRatio * 100
  ).toFixed(1);
  return `[분석 검산 요약]
- 이번 시험 탭: ${analysis.currentSheet.name}${analysis.currentDate ? ` (${analysis.currentDate.isoDate})` : " (날짜 해석 없음)"}
- 직전 시험 탭: ${analysis.previousSheet.name}${analysis.previousDate ? ` (${analysis.previousDate.isoDate})` : " (날짜 해석 없음)"}
- I열 유효 입력률: 이번 ${currentRatio}% / 직전 ${previousRatio}%
- 제외 건수: ${analysis.excludedCount}건
- 품질 경고: ${analysis.warnings.length}건`;
}

export function buildFullReport(analysis: AnalysisResult): string {
  return `${buildReportSummary(analysis)}

${analysis.regions.map(buildRegionReport).join("\n\n────────────────────\n\n")}`;
}

export function buildSingleRegionReport(
  analysis: AnalysisResult,
  region: RegionAnalysis,
): string {
  return `${buildReportSummary(analysis)}

${buildRegionReport(region)}`;
}
