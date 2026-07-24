import type {
  WorshipAnalysisResult,
  WorshipRegionAnalysis,
} from "./types";
import {
  formatParticipationRate,
  formatWorshipDelta,
} from "./worship";

function namesLine(names: string[]): string {
  return `- ${names.length > 0 ? names.join(", ") : "없음"}`;
}

function regionLabel(region: string): string {
  if (region === "전체 지역") return region;
  return region.endsWith("지역") ? region : `${region}지역`;
}

function attendedFromAbsentTotal(region: WorshipRegionAnalysis): number {
  const transitions = region.transitions;
  return (
    transitions.absentToFace.length +
    transitions.absentToZoom.length +
    transitions.absentToCall.length
  );
}

export function buildWorshipRegionReport(
  region: WorshipRegionAnalysis,
): string {
  const current = region.currentCounts;
  const previous = region.previousCounts;
  const transitions = region.transitions;

  return `• ${regionLabel(region.region)} (분석 인원 ${region.rosterCount}명)

1. 전체 참여 : ${current.attendedTotal}명 (${formatParticipationRate(region.participationRate)}%)
(지난 구역예배 대비 ${formatWorshipDelta(current.attendedTotal - previous.attendedTotal)})
- 대면 모임 : ${current.대면}명 (지난 구역예배 대비 ${formatWorshipDelta(current.대면 - previous.대면)})
- 줌 : ${current.줌}명
- 통화 : ${current.통화}명

2. 증감추이 분석
1) 대면/줌/통화 → 미참여 : ${transitions.attendedToAbsent.length}명
• 대면 → 줌/통화/미참여 : ${transitions.faceToLower.length}명
${namesLine(transitions.faceToLower)}

• 줌 → 통화/미참여 : ${transitions.zoomToLower.length}명
${namesLine(transitions.zoomToLower)}

• 통화 → 미참여 : ${transitions.callToAbsent.length}명
${namesLine(transitions.callToAbsent)}

2) 단계향상
• 줌/통화 → 대면 : ${transitions.toFace.length}명
${namesLine(transitions.toFace)}

• 통화 → 줌 : ${transitions.callToZoom.length}명
${namesLine(transitions.callToZoom)}

3) 미참여 → 참석(대면, 줌, 통화) : ${attendedFromAbsentTotal(region)}명
• 대면 : ${transitions.absentToFace.length}명
${namesLine(transitions.absentToFace)}

• 줌 : ${transitions.absentToZoom.length}명
${namesLine(transitions.absentToZoom)}

• 통화 : ${transitions.absentToCall.length}명
${namesLine(transitions.absentToCall)}`;
}

export function buildFullWorshipReport(
  analysis: WorshipAnalysisResult,
): string {
  return analysis.regions
    .map((region) => buildWorshipRegionReport(region))
    .join("\n\n────────────────────\n\n");
}

export function buildSingleWorshipReport(
  region: WorshipRegionAnalysis,
): string {
  return buildWorshipRegionReport(region);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildWorshipCsv(
  analysis: WorshipAnalysisResult,
): string {
  const header = [
    "지역",
    "분석 인원",
    "전체 참여",
    "대면 모임",
    "줌",
    "통화",
    "미참여",
    "참여율",
    "지난 구역예배 대비",
  ];
  const rows = [analysis.totals, ...analysis.regions].map((region) => {
    return [
      region.region,
      region.rosterCount,
      region.currentCounts.attendedTotal,
      region.currentCounts.대면,
      region.currentCounts.줌,
      region.currentCounts.통화,
      region.currentCounts.미참여,
      `${formatParticipationRate(region.participationRate)}%`,
      formatWorshipDelta(
        region.currentCounts.attendedTotal -
          region.previousCounts.attendedTotal,
      ),
    ];
  });
  return [header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n");
}
