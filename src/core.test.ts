import { describe, expect, it } from "vitest";
import {
  analyzeComparison,
  calculateTransitions,
  canonicalize,
  classifyStatus,
  countStatuses,
  createDataRow,
  createSheetProfile,
  formatDelta,
  interpretTabDate,
  isOfficialWorship,
  matchPeople,
  parseDateTabName,
  recommendSheets,
  sortExamRegions,
} from "./core";
import { buildRegionReport } from "./report";
import { ATTENDED_STATUSES, type DataRow } from "./types";

function row(
  region: string,
  name: string,
  exam: string,
  worship = "9시",
  rowNumber = 2,
): DataRow {
  return createDataRow(rowNumber, region, name, worship, exam);
}

function sheet(name: string, rows: DataRow[]) {
  return createSheetProfile(name, rows);
}

describe("날짜형 시트 탭 해석", () => {
  it("1. 0719, 0719시험, 7.19, 1.25를 인식한다", () => {
    expect(parseDateTabName("0719")).toEqual({ month: 7, day: 19 });
    expect(parseDateTabName("0719시험")).toEqual({ month: 7, day: 19 });
    expect(parseDateTabName("7.19")).toEqual({ month: 7, day: 19 });
    expect(parseDateTabName("1.25")).toEqual({ month: 1, day: 25 });
  });

  it("2. 19차, ★분석, 작성예시는 제외한다", () => {
    expect(parseDateTabName("19차")).toBeNull();
    expect(parseDateTabName("★분석")).toBeNull();
    expect(parseDateTabName("작성예시")).toBeNull();
    expect(parseDateTabName("0230")).toBeNull();
  });

  it("3. 기준일과 7일 경계를 포함하고 미래는 제외한다", () => {
    expect(interpretTabDate("0716", "2026-07-23")?.isWithinRecentWeek).toBe(
      true,
    );
    expect(interpretTabDate("0715", "2026-07-23")?.isWithinRecentWeek).toBe(
      false,
    );
    expect(interpretTabDate("0724", "2026-07-23")?.isWithinRecentWeek).toBe(
      false,
    );
  });

  it("4. 연도 전환 시 전년도 12월을 추론한다", () => {
    expect(interpretTabDate("1231", "2026-01-02")?.isoDate).toBe(
      "2025-12-31",
    );
    expect(interpretTabDate("0101", "2026-01-02")?.isoDate).toBe(
      "2026-01-01",
    );
  });

  it("5. 같은 날짜로 해석되는 탭의 중복을 감지한다", () => {
    const profiles = [
      sheet("0719", [row("가", "가람", "정규응시")]),
      sheet("7.19", [row("가", "나래", "정규응시")]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.duplicateDates).toEqual([
      { isoDate: "2026-07-19", sheets: ["0719", "7.19"] },
    ]);
    expect(result.currentSheet).toBeUndefined();
  });
});

describe("시트 자동 추천", () => {
  it("6. 유효 입력률과 임계값을 적용한다", () => {
    const profile = sheet("0719", [
      row("가", "가람", "정규응시"),
      row("가", "나래", ""),
      row("가", "다온", "확인중"),
      row("가", "라온", "미응시"),
    ]);
    expect(profile.metrics.validStatusRatio).toBe(0.5);
    expect(
      recommendSheets([profile], "2026-07-23", 0.5).currentSheet,
    ).toBe("0719");
    expect(
      recommendSheets([profile], "2026-07-23", 0.75).currentSheet,
    ).toBeUndefined();
  });

  it("7. 최근 날짜 탭이 없으면 지역전체를 추천한다", () => {
    const profiles = [
      sheet("지역전체", [row("가", "가람", "정규응시")]),
      sheet("0705", [row("가", "가람", "정규응시")]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("지역전체");
    expect(result.previousSheet).toBe("0705");
  });

  it("8. 최근 탭의 I열이 불충분하면 지역전체를 사용하고 건너뛴다", () => {
    const profiles = [
      sheet("지역전체", [row("가", "가람", "정규응시")]),
      sheet("0719", [
        row("가", "가람", ""),
        row("가", "나래", "정규응시"),
        row("가", "다온", ""),
      ]),
      sheet("0705", [row("가", "가람", "정규응시")]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("지역전체");
    expect(result.previousSheet).toBe("0705");
  });

  it("9. 최근 탭의 I열이 충분하면 해당 탭을 추천한다", () => {
    const profiles = [
      sheet("0719", [row("가", "가람", "정규응시")]),
      sheet("0705", [row("가", "가람", "미응시")]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("0719");
    expect(result.previousSheet).toBe("0705");
  });

  it("10. 중간의 불완전 탭을 건너뛰고 직전 유효 탭을 고른다", () => {
    const profiles = [
      sheet("0719", [row("가", "가람", "정규응시")]),
      sheet("0713", [
        row("가", "가람", ""),
        row("가", "나래", ""),
      ]),
      sheet("0705", [row("가", "가람", "미응시")]),
    ];
    const result = recommendSheets(profiles, "2026-07-23", 0.5);
    expect(result.currentSheet).toBe("0719");
    expect(result.previousSheet).toBe("0705");
  });
});

describe("집계와 사람 매칭", () => {
  it("11. 시험 상태의 공백을 정규화한다", () => {
    expect(canonicalize(" 정규 응시 ")).toBe("정규응시");
    expect(classifyStatus(" 정규 응시 ")).toBe("정규응시");
  });

  it("12. 전체 응시자, 정규군, 증감을 계산한다", () => {
    const rows = ATTENDED_STATUSES.map((status, index) =>
      row("가", `사람${index}`, status),
    );
    const counts = countStatuses([
      ...rows,
      row("가", "미응시자", "미응시"),
      row("가", "빈값", ""),
    ]);
    expect(counts.attendedTotal).toBe(6);
    expect(counts.regularGroup).toBe(3);
    expect(formatDelta(2)).toBe("2명 증가");
  });

  it("13. 응시에서 미응시로 바뀐 사람을 직전 상태별로 센다", () => {
    const matches = matchPeople(
      [row("가", "가람", "미응시")],
      [row("가", "가람", "서면응시")],
    );
    const transitions = calculateTransitions(matches.pairs);
    expect(transitions.fromAttendedToNot.서면응시).toEqual(["가람"]);
  });

  it("14. 미응시에서 응시로 바뀐 사람을 이번 상태별로 센다", () => {
    const matches = matchPeople(
      [row("가", "나래", "비공식응시")],
      [row("가", "나래", "미응시")],
    );
    const transitions = calculateTransitions(matches.pairs);
    expect(transitions.fromNotToAttended.비공식응시).toEqual(["나래"]);
  });

  it("15. 빈값과 알 수 없는 값은 미응시로 바꾸지 않는다", () => {
    expect(classifyStatus("")).toBe("blank");
    expect(classifyStatus("확인중")).toBe("unknown");
    const counts = countStatuses([
      row("가", "가람", ""),
      row("가", "나래", "확인중"),
    ]);
    expect(counts.미응시).toBe(0);
    expect(counts.blank).toBe(1);
    expect(counts.unknown).toBe(1);
  });

  it("16. 유일 이름의 지역 이동을 연결하고 해결 못한 중복은 제외한다", () => {
    const moved = matchPeople(
      [row("새지역", "가람", "정규응시")],
      [row("옛지역", "가람", "미응시")],
    );
    expect(moved.pairs).toHaveLength(1);
    expect(moved.pairs[0].current.region).toBe("새지역");

    const duplicated = matchPeople(
      [
        row("가", "나래", "정규응시"),
        row("가", "나래", "미응시", "9시", 3),
      ],
      [row("가", "나래", "정규응시")],
    );
    expect(duplicated.ambiguousNames).toEqual(["나래"]);
  });

  it("17. 정식예배자 값의 띄어쓰기를 정규화한다", () => {
    expect(isOfficialWorship("타교회 예배")).toBe(true);
    expect(isOfficialWorship("협력교회예배")).toBe(true);
    expect(isOfficialWorship("기타예배")).toBe(false);
  });

  it("18. 보고서에 0명 항목과 없음 문구를 출력한다", () => {
    const result = analyzeComparison(
      [
        sheet("0719", [row("새빛", "가람", "정규응시", "9시")]),
        sheet("0705", [row("새빛", "가람", "정규응시", "9시")]),
      ],
      "0719",
      "0705",
      "2026-07-23",
    );
    const report = buildRegionReport(result.regions[0]);
    expect(report).toContain("- 일대일응시: 0명");
    expect(report).toContain("- 없음");
  });

  it("19. 증가, 감소, 변동 없음 문구를 만든다", () => {
    expect(formatDelta(4)).toBe("4명 증가");
    expect(formatDelta(-3)).toBe("3명 감소");
    expect(formatDelta(0)).toBe("변동 없음");
  });

  it("20. 시험 지역을 지정 순서로 정렬하고 새 지역은 뒤에 가나다순으로 둔다", () => {
    expect(
      sortExamRegions([
        "강북",
        "소성",
        "마포",
        "합정",
        "새신",
        "서대문",
        "홍대",
        "신촌",
        "강남",
      ]),
    ).toEqual([
      "서대문",
      "마포",
      "합정",
      "신촌",
      "새신",
      "홍대",
      "소성",
      "강남",
      "강북",
    ]);
  });

  it("21. 지역과 전체의 직전 시험 대비 전체·정규시험 증감을 계산할 수 있다", () => {
    const result = analyzeComparison(
      [
        sheet("0719", [
          row("서대문", "가람", "정규응시"),
          row("서대문", "나래", "정규응시(타지파)"),
          row("서대문", "다온", "일대일응시"),
        ]),
        sheet("0705", [
          row("서대문", "가람", "정규응시"),
          row("서대문", "나래", "미응시"),
          row("서대문", "다온", "일대일응시"),
        ]),
      ],
      "0719",
      "0705",
      "2026-07-23",
    );

    const region = result.regions[0];
    expect(
      region.currentCounts.attendedTotal - region.previousCounts.attendedTotal,
    ).toBe(1);
    expect(
      region.currentCounts.regularGroup - region.previousCounts.regularGroup,
    ).toBe(1);
    expect(
      result.currentTotals.attendedTotal - result.previousTotals.attendedTotal,
    ).toBe(1);
    expect(
      result.currentTotals.regularGroup - result.previousTotals.regularGroup,
    ).toBe(1);
  });
});
