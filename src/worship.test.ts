import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  canonicalize,
  createDataRow,
  createSheetProfile,
  getSeoulToday,
  isOfficialWorship,
  recommendSheets,
} from "./core";
import { parseWorkbookBuffer } from "./excel";
import {
  analyzeWorshipComparison,
  calculateWorshipSheetMetrics,
  classifyWorshipStatus,
  formatWorshipDelta,
  interpretWorshipTabDate,
  recommendWorshipSheets,
  sortWorshipRegions,
} from "./worship";
import {
  buildFullWorshipReport,
  buildWorshipCsv,
  buildWorshipRegionReport,
} from "./worship-report";
import type { DataRow, WorshipRegionAnalysis } from "./types";

function worshipRow(
  region: string,
  name: string,
  participation: string,
  worship = "9시",
  rowNumber = 2,
): DataRow {
  return createDataRow(
    rowNumber,
    region,
    name,
    worship,
    "",
    participation,
  );
}

function sheet(name: string, rows: DataRow[]) {
  return createSheetProfile(name, rows);
}

function analysisFor(
  currentRows: DataRow[],
  previousRows: DataRow[],
) {
  return analyzeWorshipComparison(
    [sheet("0719", currentRows), sheet("0713", previousRows)],
    "0719",
    "0713",
    "2026-07-23",
  );
}

describe("구역예배 날짜와 추천", () => {
  it("1. 요구된 날짜 형식과 시트명 속 날짜를 인식한다", () => {
    const names = [
      "2026-07-19",
      "2026.07.19",
      "2026_07_19",
      "2026/07/19",
      "20260719",
      "26-07-19",
      "26.07.19",
      "7.19",
      "07.19",
      "7월 19일",
      "2026년 7월 19일",
      "보고_2026-07-19_완료",
    ];
    for (const name of names) {
      expect(interpretWorshipTabDate(name, "2026-07-23")?.isoDate).toBe(
        "2026-07-19",
      );
    }
  });

  it("2. 유효하지 않은 날짜와 일반 탭 이름은 제외한다", () => {
    expect(interpretWorshipTabDate("2026-02-30", "2026-07-23")).toBeUndefined();
    expect(interpretWorshipTabDate("지역전체", "2026-07-23")).toBeUndefined();
    expect(interpretWorshipTabDate("19차", "2026-07-23")).toBeUndefined();
  });

  it("3. 연도가 없는 날짜는 자연스러운 최근 과거 연도로 추론한다", () => {
    expect(interpretWorshipTabDate("12.31", "2026-01-02")?.isoDate).toBe(
      "2025-12-31",
    );
    expect(interpretWorshipTabDate("1.1", "2026-01-02")?.isoDate).toBe(
      "2026-01-01",
    );
  });

  it("4. 한국 시간대 날짜를 기준으로 오늘을 계산한다", () => {
    expect(getSeoulToday(new Date("2026-07-23T15:30:00.000Z"))).toBe(
      "2026-07-24",
    );
  });

  it("5. 최근 7일 경계는 0일과 7일을 포함한다", () => {
    expect(
      interpretWorshipTabDate("2026-07-16", "2026-07-23")
        ?.isWithinRecentWeek,
    ).toBe(true);
    expect(
      interpretWorshipTabDate("2026-07-15", "2026-07-23")
        ?.isWithinRecentWeek,
    ).toBe(false);
  });

  it("6. 명시적인 미래 날짜 탭은 추천 대상에서 제외한다", () => {
    const profiles = [
      sheet("지역전체", [worshipRow("서대문", "가람", "대면")]),
      sheet("2026-07-24", [worshipRow("서대문", "가람", "대면")]),
      sheet("2026-07-19", [worshipRow("서대문", "가람", "줌")]),
      sheet("2026-07-13", [worshipRow("서대문", "가람", "통화")]),
    ];
    const result = recommendWorshipSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("2026-07-19");
    expect(result.previousSheet).toBe("2026-07-13");
  });

  it("7. 최근 7일 이내 날짜 탭이 없으면 지역전체와 D1을 추천한다", () => {
    const profiles = [
      sheet("지역전체", [worshipRow("서대문", "가람", "대면")]),
      sheet("0705", [worshipRow("서대문", "가람", "줌")]),
    ];
    const result = recommendWorshipSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("지역전체");
    expect(result.previousSheet).toBe("0705");
  });

  it("8. 최근 D1의 H열 입력이 부족하면 지역전체와 D2를 추천한다", () => {
    const profiles = [
      sheet("지역전체", [worshipRow("서대문", "가람", "대면")]),
      sheet("0719", [
        worshipRow("서대문", "가람", ""),
        worshipRow("서대문", "나래", ""),
      ]),
      sheet("0713", [worshipRow("서대문", "가람", "줌")]),
    ];
    const result = recommendWorshipSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("지역전체");
    expect(result.previousSheet).toBe("0713");
  });

  it("9. 최근 D1의 H열 입력이 유효하면 D1과 D2를 추천한다", () => {
    const profiles = [
      sheet("0719", [worshipRow("서대문", "가람", "대면")]),
      sheet("0713", [worshipRow("서대문", "가람", "줌")]),
    ];
    const result = recommendWorshipSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("0719");
    expect(result.previousSheet).toBe("0713");
  });

  it("10. 탭 배치와 무관하게 D1과 D2를 날짜 최신순으로 고른다", () => {
    const profiles = [
      sheet("0705", [worshipRow("서대문", "가람", "통화")]),
      sheet("0719", [worshipRow("서대문", "가람", "대면")]),
      sheet("0713", [worshipRow("서대문", "가람", "줌")]),
    ];
    const result = recommendWorshipSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("0719");
    expect(result.previousSheet).toBe("0713");
  });
});

describe("입력 표준화와 품질", () => {
  it("11. 정식예배자 기준으로 H열 유효 입력률을 계산한다", () => {
    const profile = sheet("0719", [
      worshipRow("서대문", "가람", "대면"),
      worshipRow("서대문", "나래", ""),
      worshipRow("서대문", "다온", "확인중"),
      worshipRow("서대문", "라온", "줌", "기타예배"),
    ]);
    const metrics = calculateWorshipSheetMetrics(profile);
    expect(metrics.officialCount).toBe(3);
    expect(metrics.validInputCount).toBe(1);
    expect(metrics.validInputRatio).toBeCloseTo(1 / 3);
  });

  it("12. 정식예배자 값의 공백을 정규화한다", () => {
    expect(isOfficialWorship(" 협력교회  예배 ")).toBe(true);
    expect(isOfficialWorship("기타예배")).toBe(false);
  });

  it("13. H열 상태와 실제 파일의 별칭을 표준화한다", () => {
    expect(classifyWorshipStatus("대면모임").status).toBe("대면");
    expect(classifyWorshipStatus("Zoom").status).toBe("줌");
    expect(classifyWorshipStatus("전화").status).toBe("통화");
    expect(classifyWorshipStatus("X").status).toBe("미참여");
    expect(classifyWorshipStatus("").validInput).toBe(false);
    expect(classifyWorshipStatus("확인중").unknown).toBe(true);
  });

  it("14. 지역과 이름의 앞뒤·연속 공백을 정규화한다", () => {
    const row = worshipRow(" 서대문  ", " 김  가람 ", "대면");
    expect(row.region).toBe("서대문");
    expect(row.name).toBe("김 가람");
    expect(canonicalize(row.name)).toBe("김가람");
  });

  it("15. 중복 인원은 마지막 유효 H열 값을 사용한다", () => {
    const result = analysisFor(
      [
        worshipRow("서대문", "가람", "줌", "9시", 2),
        worshipRow("서대문", "가람", "대면", "9시", 3),
      ],
      [worshipRow("서대문", "가람", "통화")],
    );
    expect(result.currentMetrics.duplicatePersonCount).toBe(1);
    expect(result.totals.currentCounts.대면).toBe(1);
  });

  it("16. 고정 지역 순서 뒤에 새 지역을 가나다순으로 배치한다", () => {
    expect(
      sortWorshipRegions([
        "강남",
        "소성",
        "서대문",
        "마포",
        "홍대",
        "신촌",
        "새신",
        "강북",
      ]),
    ).toEqual(["서대문", "마포", "신촌", "새신", "홍대", "소성", "강남", "강북"]);
  });
});

describe("사람 연결과 집계", () => {
  it("17. 유일한 동일 이름의 지역 이동을 연결한다", () => {
    const result = analysisFor(
      [worshipRow("마포", "가람", "대면")],
      [worshipRow("서대문", "가람", "줌")],
    );
    expect(result.matches.movedNames).toEqual(["가람"]);
    expect(result.totals.previousCounts.줌).toBe(1);
  });

  it("18. 지난 탭 미확인 인원은 지난 상태를 미참여로 처리한다", () => {
    const result = analysisFor(
      [worshipRow("서대문", "가람", "대면")],
      [worshipRow("서대문", "나래", "줌")],
    );
    expect(result.matches.unmatchedCurrentNames).toEqual(["가람"]);
    expect(result.totals.transitions.absentToFace).toEqual(["가람"]);
  });

  it("19. G열 값과 무관하게 H열 전체 명단을 실제 셀 기준으로 집계한다", () => {
    const result = analysisFor(
      [
        worshipRow("서대문", "가람", "대면"),
        worshipRow("서대문", "나래", "줌"),
        worshipRow("서대문", "다온", "통화"),
        worshipRow("서대문", "라온", "미참여"),
        worshipRow("서대문", "마루", "대면", "기타예배"),
      ],
      [
        worshipRow("서대문", "가람", "대면"),
        worshipRow("서대문", "나래", "미참여"),
        worshipRow("서대문", "다온", "미참여"),
        worshipRow("서대문", "라온", "미참여"),
        worshipRow("서대문", "마루", "줌", "기타예배"),
      ],
    );
    expect(result.totals.rosterCount).toBe(5);
    expect(result.totals.currentCounts.대면).toBe(2);
    expect(result.totals.currentCounts.attendedTotal).toBe(4);
    expect(result.totals.participationRate).toBe(0.8);
  });

  it("20. 증가·하락·변동 없음 문구를 만든다", () => {
    expect(formatWorshipDelta(2)).toBe("2명 증가");
    expect(formatWorshipDelta(-1)).toBe("1명 하락");
    expect(formatWorshipDelta(0)).toBe("변동 없음");
  });

  it("21. 참여에서 미참여로 바뀐 인원을 계산한다", () => {
    const result = analysisFor(
      [worshipRow("서대문", "가람", "미참여")],
      [worshipRow("서대문", "가람", "대면")],
    );
    expect(result.totals.transitions.attendedToAbsent).toEqual(["가람"]);
  });

  it("22. 단계하락 세부 유형을 중복 없이 계산한다", () => {
    const result = analysisFor(
      [
        worshipRow("서대문", "가람", "줌"),
        worshipRow("서대문", "나래", "통화"),
        worshipRow("서대문", "다온", "미참여"),
      ],
      [
        worshipRow("서대문", "가람", "대면"),
        worshipRow("서대문", "나래", "줌"),
        worshipRow("서대문", "다온", "통화"),
      ],
    );
    expect(result.totals.transitions.faceToLower).toEqual(["가람"]);
    expect(result.totals.transitions.zoomToLower).toEqual(["나래"]);
    expect(result.totals.transitions.callToAbsent).toEqual(["다온"]);
  });

  it("23. 단계향상 유형을 계산한다", () => {
    const result = analysisFor(
      [
        worshipRow("서대문", "가람", "대면"),
        worshipRow("서대문", "나래", "줌"),
      ],
      [
        worshipRow("서대문", "가람", "통화"),
        worshipRow("서대문", "나래", "통화"),
      ],
    );
    expect(result.totals.transitions.toFace).toEqual(["가람"]);
    expect(result.totals.transitions.callToZoom).toEqual(["나래"]);
  });

  it("24. 미참여에서 대면·줌·통화로 바뀐 유형을 계산한다", () => {
    const result = analysisFor(
      [
        worshipRow("서대문", "가람", "대면"),
        worshipRow("서대문", "나래", "줌"),
        worshipRow("서대문", "다온", "통화"),
      ],
      [
        worshipRow("서대문", "가람", "미참여"),
        worshipRow("서대문", "나래", "미참여"),
        worshipRow("서대문", "다온", "미참여"),
      ],
    );
    expect(result.totals.transitions.absentToFace).toEqual(["가람"]);
    expect(result.totals.transitions.absentToZoom).toEqual(["나래"]);
    expect(result.totals.transitions.absentToCall).toEqual(["다온"]);
  });

  it("25. 출결재적 0명과 H열 전체 빈값을 안전하게 차단한다", () => {
    expect(() =>
      analyzeWorshipComparison(
        [sheet("0719", []), sheet("0713", [])],
        "0719",
        "0713",
        "2026-07-23",
      ),
    ).toThrow("분석 대상");
    expect(() =>
      analysisFor(
        [worshipRow("서대문", "가람", "")],
        [worshipRow("서대문", "가람", "대면")],
      ),
    ).toThrow("인식 가능한 구역예배 입력");
  });
});

describe("보고서와 통합 회귀", () => {
  it("26. 목표 문구 없이 비교 보고서를 출력한다", () => {
    const result = analysisFor(
      [worshipRow("서대문", "가람", "대면")],
      [worshipRow("서대문", "가람", "줌")],
    );
    const report = buildWorshipRegionReport(result.regions[0]);
    expect(report).toContain("• 서대문지역 (분석 인원 1명)");
    expect(report).not.toContain("목표");
    expect(report).toContain("지난 구역예배 대비");
    expect(report).toContain("2. 증감추이 분석");
    expect(report).toContain("- 없음");
  });

  it("27. 전체 보고서와 CSV를 고정 지역 순서로 생성한다", () => {
    const result = analysisFor(
      [
        worshipRow("홍대", "가람", "대면"),
        worshipRow("서대문", "나래", "줌"),
      ],
      [
        worshipRow("홍대", "가람", "줌"),
        worshipRow("서대문", "나래", "미참여"),
      ],
    );
    const report = buildFullWorshipReport(result);
    expect(report.indexOf("서대문지역")).toBeLessThan(report.indexOf("홍대지역"));
    expect(report).not.toContain("목표");
    const csv = buildWorshipCsv(result);
    expect(csv).not.toContain("목표");
    expect(csv.split("\r\n")[1]).toContain("전체 지역");
  });

  it("28. 개인정보 없는 XLSX fixture를 업로드 구조로 파싱한다", () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["지역", "", "", "이름", "", "", "예배 현황", "구역예배", "시험"],
      ["서대문", "", "", "가람", "", "", "9시", "대면모임", "정규응시"],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "0719");
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    const parsed = parseWorkbookBuffer(bytes, "fixture.xlsx");
    expect(parsed.sheets[0].rows[0].worshipParticipation).toBe("대면모임");
    expect(parsed.sheets[0].metrics.worshipColumnsReadable).toBe(true);
  });

  it("29. 기존 시험 비교 추천 기능이 그대로 동작한다", () => {
    const profiles = [
      sheet("0719", [
        createDataRow(2, "서대문", "가람", "9시", "정규응시", "대면"),
      ]),
      sheet("0713", [
        createDataRow(2, "서대문", "가람", "9시", "미응시", "줌"),
      ]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("0719");
    expect(result.previousSheet).toBe("0713");
  });
});
