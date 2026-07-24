import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ParsedWorkbook,
  WorshipAnalysisResult,
  WorshipGoals,
  WorshipRegionAnalysis,
} from "./types";
import {
  analyzeWorshipComparison,
  calculateWorshipSheetMetrics,
  formatParticipationRate,
  formatWorshipDelta,
  recommendWorshipSheets,
} from "./worship";
import {
  buildFullWorshipReport,
  buildSingleWorshipReport,
  buildWorshipCsv,
} from "./worship-report";

interface WorshipFlowProps {
  parsed: ParsedWorkbook;
  uploadDate: string;
  onError: (message: string) => void;
  onToast: (message: string) => void;
  onReset: () => void;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function selectedDate(
  recommendation: ReturnType<typeof recommendWorshipSheets>,
  sheetName: string,
): string {
  return (
    recommendation.sheetDates.find((item) => item.sheetName === sheetName)
      ?.date?.isoDate ?? "날짜 해석 없음"
  );
}

function WorshipFlow({
  parsed,
  uploadDate,
  onError,
  onToast,
  onReset,
}: WorshipFlowProps) {
  const referenceDate = uploadDate;
  const threshold = 0.5;
  const [currentSheet, setCurrentSheet] = useState("");
  const [previousSheet, setPreviousSheet] = useState("");
  const [manualSelection, setManualSelection] = useState(false);
  const [analysis, setAnalysis] = useState<WorshipAnalysisResult | null>(null);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [goals, setGoals] = useState<WorshipGoals>({});

  const recommendation = useMemo(
    () => recommendWorshipSheets(parsed.sheets, referenceDate, threshold),
    [parsed, referenceDate, threshold],
  );

  useEffect(() => {
    setManualSelection(false);
    setAnalysis(null);
    setSelectedRegion("");
    setGoals({});
  }, [parsed, uploadDate]);

  useEffect(() => {
    if (manualSelection) return;
    setCurrentSheet(recommendation.currentSheet ?? "");
    setPreviousSheet(recommendation.previousSheet ?? "");
    setAnalysis(null);
  }, [
    manualSelection,
    recommendation.currentSheet,
    recommendation.previousSheet,
  ]);

  const currentProfile = parsed.sheets.find(
    (sheet) => sheet.name === currentSheet,
  );
  const previousProfile = parsed.sheets.find(
    (sheet) => sheet.name === previousSheet,
  );
  const currentMetrics = currentProfile
    ? calculateWorshipSheetMetrics(currentProfile)
    : undefined;
  const previousMetrics = previousProfile
    ? calculateWorshipSheetMetrics(previousProfile)
    : undefined;
  const selectedRegionAnalysis = analysis?.regions.find(
    (region) => region.region === selectedRegion,
  );
  const visibleReport =
    analysis && selectedRegionAnalysis
      ? buildSingleWorshipReport(selectedRegionAnalysis, goals)
      : analysis
        ? buildFullWorshipReport(analysis, goals)
        : "";

  function restoreRecommendation() {
    setManualSelection(false);
    setCurrentSheet(recommendation.currentSheet ?? "");
    setPreviousSheet(recommendation.previousSheet ?? "");
    setAnalysis(null);
    setSelectedRegion("");
    onError("");
  }

  function runAnalysis() {
    onError("");
    try {
      const result = analyzeWorshipComparison(
        parsed.sheets,
        currentSheet,
        previousSheet,
        referenceDate,
        threshold,
      );
      setAnalysis(result);
      setSelectedRegion("");
      setGoals((existing) => {
        const next = { ...existing };
        for (const region of result.regions) {
          next[region.region] ??= {};
        }
        return next;
      });
      window.setTimeout(
        () =>
          document
            .getElementById("worship-report-section")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "구역예배 자료를 분석하지 못했습니다. 탭과 입력값을 확인해 주세요.",
      );
    }
  }

  async function copyReport(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(successMessage);
    } catch {
      onError(
        "클립보드 권한이 없어 복사하지 못했습니다. 미리보기에서 직접 선택해 복사해 주세요.",
      );
    }
  }

  function downloadText(
    contents: string,
    fileName: string,
    type: string,
    successMessage: string,
  ) {
    try {
      const blob = new Blob([contents], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onToast(successMessage);
    } catch {
      onError(
        "다운로드 파일을 만들지 못했습니다. 브라우저 설정을 확인하고 다시 시도해 주세요.",
      );
    }
  }

  function setGoal(
    region: string,
    field: "total" | "face",
    value: string,
  ) {
    setGoals((existing) => ({
      ...existing,
      [region]: {
        ...existing[region],
        [field]:
          value === ""
            ? undefined
            : Math.max(0, Math.floor(Number(value) || 0)),
      },
    }));
  }

  const analyzeDisabled =
    !currentSheet ||
    !previousSheet ||
    currentSheet === previousSheet ||
    !currentMetrics?.columnsReadable ||
    !previousMetrics?.columnsReadable ||
    currentMetrics.officialCount === 0 ||
    currentMetrics.validInputCount === 0;

  return (
    <>
      <section className="workspace-card" aria-labelledby="worship-select-title">
        <div className="section-heading">
          <h2 id="worship-select-title">3. 구역예배 탭 확인</h2>
          <div className="recommend-actions">
            <span className={manualSelection ? "manual" : "automatic"}>
              {manualSelection ? "직접 선택 적용 중" : "자동 추천 적용 중"}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={restoreRecommendation}
            >
              자동 추천으로 되돌리기
            </button>
          </div>
        </div>

        <div className="recommend-grid">
          <article className="recommend-card current">
            <p>금번 구역예배 탭</p>
            <strong>{recommendation.currentSheet ?? "직접 선택 필요"}</strong>
            <span>{recommendation.currentReason}</span>
          </article>
          <div className="compare-arrow" aria-hidden="true">
            →
          </div>
          <article className="recommend-card previous">
            <p>지난 구역예배 탭</p>
            <strong>{recommendation.previousSheet ?? "직접 선택 필요"}</strong>
            <span>{recommendation.previousReason}</span>
          </article>
        </div>

        <div className="select-grid">
          <label>
            <span>금번 구역예배 탭</span>
            <select
              value={currentSheet}
              onChange={(event) => {
                setCurrentSheet(event.target.value);
                setManualSelection(true);
                setAnalysis(null);
              }}
            >
              <option value="">탭을 선택하세요</option>
              {parsed.sheets.map((sheet) => (
                <option
                  key={sheet.name}
                  value={sheet.name}
                  disabled={sheet.name === previousSheet}
                >
                  {sheet.name}
                </option>
              ))}
            </select>
            {currentMetrics && (
              <small>
                정식예배자 {currentMetrics.officialCount.toLocaleString()}명 ·
                H열 유효 입력 {currentMetrics.validInputCount.toLocaleString()}명 ·{" "}
                {percent(currentMetrics.validInputRatio)}
              </small>
            )}
          </label>
          <label>
            <span>지난 구역예배 탭</span>
            <select
              value={previousSheet}
              onChange={(event) => {
                setPreviousSheet(event.target.value);
                setManualSelection(true);
                setAnalysis(null);
              }}
            >
              <option value="">탭을 선택하세요</option>
              {parsed.sheets.map((sheet) => (
                <option
                  key={sheet.name}
                  value={sheet.name}
                  disabled={sheet.name === currentSheet}
                >
                  {sheet.name}
                </option>
              ))}
            </select>
            {previousMetrics && (
              <small>
                정식예배자 {previousMetrics.officialCount.toLocaleString()}명 ·
                H열 유효 입력 {previousMetrics.validInputCount.toLocaleString()}명 ·{" "}
                {percent(previousMetrics.validInputRatio)}
              </small>
            )}
          </label>
        </div>

        {recommendation.warnings.length > 0 && (
          <div className="quality-panel">
            <div>
              <span className="quality-icon" aria-hidden="true">
                !
              </span>
              <div>
                <strong>탭 선택 확인</strong>
                <p>추천 근거와 데이터 입력 상태를 확인해 주세요.</p>
              </div>
            </div>
            <ul>
              {recommendation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="confirm-row">
          <p>
            추천값을 확인하거나 직접 변경한 뒤 구역예배 비교를 실행하세요.
          </p>
          <button
            type="button"
            className="button primary large"
            onClick={runAnalysis}
            disabled={analyzeDisabled}
          >
            구역예배 분석 실행
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      {analysis && (
        <section
          id="worship-report-section"
          className="workspace-card report-section"
          aria-labelledby="worship-report-title"
        >
          <div className="section-heading">
            <h2 id="worship-report-title">4. 목표 입력 및 지역별 보고서</h2>
            <div className="summary-pills">
              <span>
                경고 <strong>{analysis.warnings.length}</strong>
              </span>
              <span>
                제외 <strong>{analysis.excludedCount}</strong>
              </span>
            </div>
          </div>

          <div className="worship-summary-grid" aria-label="전체 지역 요약">
            <div>
              <span>총 출결재적</span>
              <strong>{analysis.totals.rosterCount.toLocaleString()}명</strong>
            </div>
            <div>
              <span>전체 참여</span>
              <strong>
                {analysis.totals.currentCounts.attendedTotal.toLocaleString()}명
              </strong>
            </div>
            <div>
              <span>대면</span>
              <strong>{analysis.totals.currentCounts.대면.toLocaleString()}명</strong>
            </div>
            <div>
              <span>줌</span>
              <strong>{analysis.totals.currentCounts.줌.toLocaleString()}명</strong>
            </div>
            <div>
              <span>통화</span>
              <strong>{analysis.totals.currentCounts.통화.toLocaleString()}명</strong>
            </div>
            <div>
              <span>미참여</span>
              <strong>
                {analysis.totals.currentCounts.미참여.toLocaleString()}명
              </strong>
            </div>
            <div>
              <span>전체 참여율</span>
              <strong>
                {formatParticipationRate(analysis.totals.participationRate)}%
              </strong>
            </div>
            <div>
              <span>지난 구역예배 대비</span>
              <strong
                className={
                  analysis.totals.currentCounts.attendedTotal -
                    analysis.totals.previousCounts.attendedTotal >=
                  0
                    ? "positive"
                    : "negative"
                }
              >
                {formatWorshipDelta(
                  analysis.totals.currentCounts.attendedTotal -
                    analysis.totals.previousCounts.attendedTotal,
                )}
              </strong>
            </div>
          </div>

          <div className="selection-audit">
            <div>
              <span>금번 구역예배 탭</span>
              <strong>{analysis.currentSheet.name}</strong>
              <small>
                {selectedDate(recommendation, analysis.currentSheet.name)} · H열
                입력률 {percent(analysis.currentMetrics.validInputRatio)}
              </small>
            </div>
            <div>
              <span>지난 구역예배 탭</span>
              <strong>{analysis.previousSheet.name}</strong>
              <small>
                {selectedDate(recommendation, analysis.previousSheet.name)} ·
                H열 입력률 {percent(analysis.previousMetrics.validInputRatio)}
              </small>
            </div>
            <p>
              {manualSelection
                ? "사용자가 직접 선택한 탭으로 분석했습니다."
                : recommendation.currentReason}
            </p>
          </div>

          <div className="subsection-heading">
            <div>
              <h3>지역별 목표</h3>
              <p>입력하지 않은 목표는 보고서에 ‘미설정’으로 표시됩니다.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table goal-table">
              <thead>
                <tr>
                  <th scope="col">지역</th>
                  <th scope="col">전체 참여 목표</th>
                  <th scope="col">대면 참여 목표</th>
                </tr>
              </thead>
              <tbody>
                {analysis.regions.map((region) => (
                  <tr key={region.region}>
                    <th scope="row">{region.region}</th>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label={`${region.region} 전체 참여 목표`}
                        value={goals[region.region]?.total ?? ""}
                        onChange={(event) =>
                          setGoal(region.region, "total", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label={`${region.region} 대면 참여 목표`}
                        value={goals[region.region]?.face ?? ""}
                        onChange={(event) =>
                          setGoal(region.region, "face", event.target.value)
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="subsection-heading">
            <div>
              <h3>지역별 상태 요약</h3>
              <p>미리볼 지역과 동일한 고정 순서로 표시합니다.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">지역</th>
                  <th scope="col">출결재적</th>
                  <th scope="col">전체 참여</th>
                  <th scope="col">대면</th>
                  <th scope="col">줌</th>
                  <th scope="col">통화</th>
                  <th scope="col">미참여</th>
                  <th scope="col">참여율</th>
                </tr>
              </thead>
              <tbody>
                {analysis.regions.map((region) => (
                  <tr key={region.region}>
                    <th scope="row">{region.region}</th>
                    <td>{region.rosterCount}</td>
                    <td>{region.currentCounts.attendedTotal}</td>
                    <td>{region.currentCounts.대면}</td>
                    <td>{region.currentCounts.줌}</td>
                    <td>{region.currentCounts.통화}</td>
                    <td>{region.currentCounts.미참여}</td>
                    <td>{formatParticipationRate(region.participationRate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {analysis.warnings.length > 0 && (
            <details className="analysis-warnings">
              <summary>분석 품질 경고 {analysis.warnings.length}건</summary>
              <ul>
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <div className="name-list-grid">
                <div>
                  <strong>
                    지난 탭 미확인{" "}
                    {analysis.matches.unmatchedCurrentNames.length}명
                  </strong>
                  <p>
                    {analysis.matches.unmatchedCurrentNames.join(", ") ||
                      "없음"}
                  </p>
                </div>
                <div>
                  <strong>
                    지역 변경 연결 {analysis.matches.movedNames.length}명
                  </strong>
                  <p>{analysis.matches.movedNames.join(", ") || "없음"}</p>
                </div>
                <div>
                  <strong>
                    중복 이름 확인 {analysis.matches.ambiguousNames.length}명
                  </strong>
                  <p>{analysis.matches.ambiguousNames.join(", ") || "없음"}</p>
                </div>
              </div>
            </details>
          )}

          <div className="report-toolbar">
            <label>
              <span>미리볼 지역</span>
              <select
                value={selectedRegion}
                onChange={(event) => setSelectedRegion(event.target.value)}
              >
                <option value="">전체 지역</option>
                {analysis.regions.map((region) => (
                  <option key={region.region} value={region.region}>
                    {region.region}
                  </option>
                ))}
              </select>
            </label>
            <div className="toolbar-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!selectedRegionAnalysis}
                onClick={() =>
                  selectedRegionAnalysis &&
                  void copyReport(
                    buildSingleWorshipReport(selectedRegionAnalysis, goals),
                    "선택한 지역 보고서를 복사했습니다.",
                  )
                }
              >
                선택 지역 복사
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void copyReport(
                    buildFullWorshipReport(analysis, goals),
                    "전체 지역 보고서를 복사했습니다.",
                  )
                }
              >
                전체 보고서 복사
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() =>
                  downloadText(
                    buildFullWorshipReport(analysis, goals),
                    `구역예배비교_${safeFilePart(analysis.currentDate?.isoDate ?? analysis.currentSheet.name)}.txt`,
                    "text/plain;charset=utf-8",
                    "구역예배 보고서를 TXT로 저장했습니다.",
                  )
                }
              >
                TXT 다운로드
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  downloadText(
                    `\uFEFF${buildWorshipCsv(analysis, goals)}`,
                    `구역예배분석_${safeFilePart(analysis.currentDate?.isoDate ?? analysis.currentSheet.name)}.csv`,
                    "text/csv;charset=utf-8",
                    "분석 결과를 CSV로 저장했습니다.",
                  )
                }
              >
                CSV 다운로드
              </button>
            </div>
          </div>

          <pre className="report-preview" tabIndex={0}>
            {visibleReport}
          </pre>

          <div className="reset-row">
            <button type="button" className="text-button" onClick={onReset}>
              새 파일 분석
            </button>
            <p>새 파일을 선택하면 현재 메모리의 분석 결과를 초기화합니다.</p>
          </div>
        </section>
      )}
    </>
  );
}

export default WorshipFlow;
