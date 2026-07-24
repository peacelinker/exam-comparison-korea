import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseWorkbookBuffer } from "../src/excel";
import {
  analyzeWorshipComparison,
  recommendWorshipSheets,
} from "../src/worship";

const filePath = process.argv[2];
const referenceDate = process.argv[3] ?? "2026-07-23";
const threshold = Number(process.argv[4] ?? "0.5");

if (!filePath) {
  throw new Error(
    '사용법: pnpm acceptance:worship -- "파일.xlsx" [최근 구역예배일] [입력률 기준]',
  );
}

const bytes = await readFile(resolve(filePath));
const workbook = parseWorkbookBuffer(bytes, "로컬 인수 테스트 파일");
const recommendation = recommendWorshipSheets(
  workbook.sheets,
  referenceDate,
  threshold,
);

if (!recommendation.currentSheet || !recommendation.previousSheet) {
  throw new Error("자동 추천 결과가 확정되지 않아 인수 분석을 진행할 수 없습니다.");
}

const analysis = analyzeWorshipComparison(
  workbook.sheets,
  recommendation.currentSheet,
  recommendation.previousSheet,
  referenceDate,
  threshold,
);

console.log(
  JSON.stringify(
    {
      recommendation: {
        current: recommendation.currentSheet,
        previous: recommendation.previousSheet,
        reason: recommendation.currentReason,
      },
      inputQuality: {
        currentOfficial: analysis.currentMetrics.officialCount,
        currentValidRatio: Number(
          analysis.currentMetrics.validInputRatio.toFixed(6),
        ),
        previousOfficial: analysis.previousMetrics.officialCount,
        previousValidRatio: Number(
          analysis.previousMetrics.validInputRatio.toFixed(6),
        ),
      },
      totals: {
        roster: analysis.totals.rosterCount,
        attended: analysis.totals.currentCounts.attendedTotal,
        face: analysis.totals.currentCounts.대면,
        zoom: analysis.totals.currentCounts.줌,
        call: analysis.totals.currentCounts.통화,
        absent: analysis.totals.currentCounts.미참여,
      },
      regions: analysis.regions.map((region) => ({
        region: region.region,
        roster: region.rosterCount,
        attended: region.currentCounts.attendedTotal,
      })),
      warningCount: analysis.warnings.length,
    },
    null,
    2,
  ),
);
