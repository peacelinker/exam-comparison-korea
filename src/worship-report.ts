import type {
  WorshipAnalysisResult,
  WorshipGoal,
  WorshipGoals,
  WorshipRegionAnalysis,
} from "./types";
import {
  formatParticipationRate,
  formatWorshipDelta,
} from "./worship";

function namesLine(names: string[]): string {
  return `- ${names.length > 0 ? names.join(", ") : "없음"}`;
}

function targetLabel(value: number | undefined): string {
  return value == null ? "미설정" : `${value}명`;
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
  goal: WorshipGoal = {},
): string {
  const current = region.currentCounts;
  const previous = region.previousCounts;
  const transitions = region.transitions;

  return `• ${regionLabel(region.region)} (출결재적 ${region.rosterCount}명)

1. 출결재적 전체 참여 : ${current.attendedTotal}명 (${formatParticipationRate(region.participationRate)}%)
(목표 : ${targetLabel(goal.total)}, 지난 구역예배 대비 ${formatWorshipDelta(current.attendedTotal - previous.attendedTotal)})
- 대면 : ${current.대면}명 (목표 : ${targetLabel(goal.face)}, 지난 구역예배 대비 ${formatWorshipDelta(current.대면 - previous.대면)})
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
  goals: WorshipGoals,
): string {
  return analysis.regions
    .map((region) => buildWorshipRegionReport(region, goals[region.region]))
    .join("\n\n────────────────────\n\n");
}

export function buildSingleWorshipReport(
  region: WorshipRegionAnalysis,
  goals: WorshipGoals,
): string {
  return buildWorshipRegionReport(region, goals[region.region]);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildWorshipCsv(
  analysis: WorshipAnalysisResult,
  goals: WorshipGoals,
): string {
  const header = [
    "지역",
    "출결재적",
    "전체 참여",
    "대면",
    "줌",
    "통화",
    "미참여",
    "참여율",
    "지난 구역예배 대비",
    "전체 참여 목표",
    "대면 참여 목표",
  ];
  const rows = [analysis.totals, ...analysis.regions].map((region) => {
    const goal = goals[region.region] ?? {};
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
      goal.total ?? "",
      goal.face ?? "",
    ];
  });
  return [header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n");
}
