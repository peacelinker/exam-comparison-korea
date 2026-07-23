import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  analyzeComparison,
  recommendSheets,
} from "../src/core";
import { parseWorkbookBuffer } from "../src/excel";
import { ATTENDED_STATUSES, type TransitionBucket } from "../src/types";

function transitionTotals(transitions: TransitionBucket) {
  return {
    fromAttendedToNot: Object.fromEntries(
      ATTENDED_STATUSES.map((status) => [
        status,
        transitions.fromAttendedToNot[status].length,
      ]),
    ),
    fromNotToAttended: Object.fromEntries(
      ATTENDED_STATUSES.map((status) => [
        status,
        transitions.fromNotToAttended[status].length,
      ]),
    ),
  };
}

const filePath = process.argv[2];
const referenceDate = process.argv[3] ?? "2026-07-23";
const threshold = Number(process.argv[4] ?? "0.5");

if (!filePath) {
  throw new Error(
    '사용법: npm run acceptance -- "파일.xlsx" [기준일] [입력률 기준]',
  );
}

const bytes = await readFile(resolve(filePath));
const workbook = parseWorkbookBuffer(bytes, "로컬 인수 테스트 파일");
const recommendation = recommendSheets(
  workbook.sheets,
  referenceDate,
  threshold,
);

if (!recommendation.currentSheet || !recommendation.previousSheet) {
  throw new Error("자동 추천 결과가 확정되지 않아 인수 분석을 진행할 수 없습니다.");
}

const analysis = analyzeComparison(
  workbook.sheets,
  recommendation.currentSheet,
  recommendation.previousSheet,
  referenceDate,
  threshold,
);
const globalTransitions = transitionTotals({
  fromAttendedToNot: Object.fromEntries(
    ATTENDED_STATUSES.map((status) => [
      status,
      analysis.regions.flatMap(
        (region) => region.transitions.fromAttendedToNot[status],
      ),
    ]),
  ) as TransitionBucket["fromAttendedToNot"],
  fromNotToAttended: Object.fromEntries(
    ATTENDED_STATUSES.map((status) => [
      status,
      analysis.regions.flatMap(
        (region) => region.transitions.fromNotToAttended[status],
      ),
    ]),
  ) as TransitionBucket["fromNotToAttended"],
});

const sheetMetrics = Object.fromEntries(
  workbook.sheets
    .filter((sheet) =>
      ["0719", "0713", "0705", "지역전체"].includes(sheet.name),
    )
    .map((sheet) => [
      sheet.name,
      {
        dataRows: sheet.metrics.dataRowCount,
        validStatuses: sheet.metrics.validStatusCount,
        blankStatuses: sheet.metrics.blankStatusCount,
        validRatio: Number(sheet.metrics.validStatusRatio.toFixed(6)),
      },
    ]),
);

console.log(
  JSON.stringify(
    {
      recommendation: {
        current: recommendation.currentSheet,
        previous: recommendation.previousSheet,
        currentReason: recommendation.currentReason,
        previousReason: recommendation.previousReason,
      },
      sheetMetrics,
      currentTotals: analysis.currentTotals,
      previousTotals: analysis.previousTotals,
      deltas: {
        attended:
          analysis.currentTotals.attendedTotal -
          analysis.previousTotals.attendedTotal,
        regularGroup:
          analysis.currentTotals.regularGroup -
          analysis.previousTotals.regularGroup,
      },
      transitions: globalTransitions,
      officialWorshipNotAttended: analysis.regions.reduce(
        (sum, region) => sum + region.officialWorshipNotAttended.length,
        0,
      ),
      newCount: analysis.matches.newNames.length,
      missingCount: analysis.matches.missingNames.length,
      ambiguousCount: analysis.matches.ambiguousNames.length,
      sameAsRegionOverall: analysis.sameAsRegionOverall,
    },
    null,
    2,
  ),
);
