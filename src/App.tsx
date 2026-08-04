import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzeComparison,
  formatDelta,
  getSeoulToday,
  recommendSheets,
} from "./core";
import { readWorkbookFile } from "./excel";
import {
  buildFullReport,
  buildSingleRegionReport,
} from "./report";
import type {
  AnalysisResult,
  ParsedWorkbook,
  SheetProfile,
} from "./types";
import ReportSnapshot from "./ReportSnapshot";
import WorshipFlow from "./WorshipFlow";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const countUnknown = (profile: SheetProfile) =>
  Object.values(profile.metrics.unknownStatusCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

function App() {
  const referenceDate = getSeoulToday();
  const threshold = 0.5;
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [analysisType, setAnalysisType] = useState<"exam" | "worship">("exam");
  const [uploadDate, setUploadDate] = useState(referenceDate);
  const [currentSheet, setCurrentSheet] = useState("");
  const [previousSheet, setPreviousSheet] = useState("");
  const [manualSelection, setManualSelection] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const recommendation = useMemo(
    () =>
      parsed
        ? recommendSheets(parsed.sheets, referenceDate, threshold)
        : null,
    [parsed, referenceDate],
  );

  useEffect(() => {
    if (!parsed || !recommendation || manualSelection) return;
    setCurrentSheet(recommendation.currentSheet ?? "");
    setPreviousSheet(recommendation.previousSheet ?? "");
    setAnalysis(null);
  }, [
    parsed,
    recommendation,
    recommendation?.currentSheet,
    recommendation?.previousSheet,
    manualSelection,
  ]);

  const selectedRegionAnalysis = analysis?.regions.find(
    (region) => region.region === selectedRegion,
  );
  const visibleReport =
    analysis && selectedRegionAnalysis
      ? buildSingleRegionReport(analysis, selectedRegionAnalysis)
      : analysis
        ? buildFullReport(analysis)
        : "";

  async function handleFile(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setToast("");
    setAnalysis(null);
    try {
      const workbook = await readWorkbookFile(file);
      if (workbook.sheets.length === 0) {
        throw new Error(
          "읽을 수 있는 시트가 없습니다. 엑셀 파일이 손상되지 않았는지 확인해 주세요.",
        );
      }
      setParsed(workbook);
      setUploadDate(getSeoulToday());
      setAnalysisType("exam");
      setManualSelection(false);
      setSelectedRegion("");
    } catch (caught) {
      setParsed(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "파일을 읽는 중 오류가 발생했습니다. 파일 형식을 확인해 주세요.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    void handleFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  function applyRecommendation() {
    if (!recommendation) return;
    setManualSelection(false);
    setCurrentSheet(recommendation.currentSheet ?? "");
    setPreviousSheet(recommendation.previousSheet ?? "");
    setAnalysis(null);
    setError("");
  }

  function confirmAndAnalyze() {
    if (!parsed) return;
    setError("");
    try {
      const result = analyzeComparison(
        parsed.sheets,
        currentSheet,
        previousSheet,
        referenceDate,
        threshold,
      );
      setAnalysis(result);
      setSelectedRegion(result.regions[0]?.region ?? "");
      window.setTimeout(
        () =>
          document
            .getElementById("report-section")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "분석할 수 없습니다. 선택한 탭과 데이터 품질을 확인해 주세요.",
      );
    }
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(successMessage);
      window.setTimeout(() => setToast(""), 2400);
    } catch {
      setError(
        "클립보드 권한이 없어 복사하지 못했습니다. 보고서 미리보기에서 직접 선택해 복사해 주세요.",
      );
    }
  }

  function downloadReport() {
    if (!analysis) return;
    const blob = new Blob([buildFullReport(analysis)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `시험비교_${analysis.currentSheet.name}_${analysis.previousSheet.name}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToast("전체 지역 보고서를 TXT로 저장했습니다.");
    window.setTimeout(() => setToast(""), 2400);
  }

  function resetAll() {
    setParsed(null);
    setAnalysis(null);
    setCurrentSheet("");
    setPreviousSheet("");
    setSelectedRegion("");
    setManualSelection(false);
    setAnalysisType("exam");
    setError("");
    setToast("");
  }

  const currentProfile = parsed?.sheets.find(
    (sheet) => sheet.name === currentSheet,
  );
  const previousProfile = parsed?.sheets.find(
    (sheet) => sheet.name === previousSheet,
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>시험·구역예배 비교 분석기</h1>
        <p className="hero-copy">
          한 개의 엑셀 파일에서 시험 또는 구역예배 자료를 선택해 지역별
          증감과 명단을 비교하고 보고서로 정리합니다.
        </p>
        <p className="privacy-line">
          원본 엑셀은 수정하거나 저장하지 않으며, 선택한 파일은 현재
          브라우저 메모리에서만 처리합니다.
        </p>
      </header>

      <main>
        <section className="workspace-card" aria-labelledby="upload-title">
          <div className="section-heading">
            <h2 id="upload-title">1. 엑셀 파일 업로드</h2>
            {parsed && <span className="file-chip">{parsed.fileName}</span>}
          </div>

          {!parsed && (
            <div
              className={`drop-zone ${dragActive ? "drag-active" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <div className="upload-icon" aria-hidden="true">
                ↑
              </div>
              <button
                type="button"
                className="button secondary upload-button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                {busy ? "불러오는 중…" : "파일 선택"}
              </button>
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFileInput}
                disabled={busy}
              />
              <div className="upload-copy">
                <strong>
                  {busy
                    ? "엑셀을 브라우저에서 읽는 중입니다."
                    : "이곳에 .xlsx 파일을 놓거나 파일 선택을 눌러주세요."}
                </strong>
                <small>지원 형식: Excel 통합 문서(.xlsx)</small>
              </div>
            </div>
          )}

        </section>

        {error && (
          <div className="alert error-alert" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>확인이 필요합니다</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {parsed && (
          <section className="workspace-card" aria-labelledby="analysis-type-title">
            <div className="section-heading">
              <h2 id="analysis-type-title">2. 분석 유형 선택</h2>
            </div>
            <div className="analysis-type-tabs" role="group" aria-label="분석 유형">
              <button
                type="button"
                className={analysisType === "exam" ? "active" : ""}
                aria-pressed={analysisType === "exam"}
                onClick={() => {
                  setAnalysisType("exam");
                  setAnalysis(null);
                  setError("");
                }}
              >
                <strong>시험 비교 분석</strong>
                <span>이번 시험과 직전 시험을 비교합니다.</span>
              </button>
              <button
                type="button"
                className={analysisType === "worship" ? "active" : ""}
                aria-pressed={analysisType === "worship"}
                onClick={() => {
                  setAnalysisType("worship");
                  setAnalysis(null);
                  setError("");
                }}
              >
                <strong>구역예배 비교 보고</strong>
                <span>금번과 지난 구역예배 참여를 비교합니다.</span>
              </button>
            </div>
          </section>
        )}

        {parsed && recommendation && analysisType === "exam" && (
          <>
            <section className="workspace-card" aria-labelledby="recommend-title">
              <div className="section-heading">
                <h2 id="recommend-title">3. 이번·직전 시험 탭 선택</h2>
                <button
                  type="button"
                  className="text-button"
                  onClick={applyRecommendation}
                >
                  자동 추천 다시 적용
                </button>
              </div>

              <div className="recommend-grid">
                <article className="recommend-card current">
                  <p>이번 시험 탭</p>
                  <strong>{recommendation.currentSheet ?? "직접 선택 필요"}</strong>
                  <span>{recommendation.currentReason}</span>
                </article>
                <div className="compare-arrow" aria-hidden="true">
                  →
                </div>
                <article className="recommend-card previous">
                  <p>직전 시험 탭</p>
                  <strong>{recommendation.previousSheet ?? "직접 선택 필요"}</strong>
                  <span>{recommendation.previousReason}</span>
                </article>
              </div>

              <div className="select-grid">
                <label>
                  <span>이번 시험 탭</span>
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
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                  {currentProfile && (
                    <small>
                      유효 입력 {currentProfile.metrics.validStatusCount.toLocaleString()}건 ·{" "}
                      {percent(currentProfile.metrics.validStatusRatio)}
                    </small>
                  )}
                </label>
                <label>
                  <span>직전 시험 탭</span>
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
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                  {previousProfile && (
                    <small>
                      유효 입력 {previousProfile.metrics.validStatusCount.toLocaleString()}건 ·{" "}
                      {percent(previousProfile.metrics.validStatusRatio)}
                    </small>
                  )}
                </label>
              </div>

              {(recommendation.warnings.length > 0 ||
                parsed.sheets.some(
                  (sheet) =>
                    sheet.metrics.blankStatusCount > 0 ||
                    countUnknown(sheet) > 0,
                )) && (
                <div className="quality-panel">
                  <div>
                    <span className="quality-icon" aria-hidden="true">
                      !
                    </span>
                    <div>
                      <strong>품질 확인</strong>
                      <p>
                        경고는 숨기지 않고 보고서 생성 전 검산 항목으로
                        남깁니다.
                      </p>
                    </div>
                  </div>
                  <ul>
                    {recommendation.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                    {parsed.sheets
                      .filter(
                        (sheet) =>
                          sheet.metrics.formulaWithoutCachedValueCount > 0,
                      )
                      .map((sheet) => (
                        <li key={`formula-${sheet.name}`}>
                          {sheet.name}: 저장된 값이 없는 수식 셀{" "}
                          {sheet.metrics.formulaWithoutCachedValueCount}건
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              <div className="confirm-row">
                <p>
                  자동 추천된 탭을 확인하거나 직접 변경한 뒤 분석을
                  실행하세요.
                </p>
                <button
                  type="button"
                  className="button primary large"
                  onClick={confirmAndAnalyze}
                  disabled={!currentSheet || !previousSheet || busy}
                >
                  분석 실행
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          </>
        )}

        {analysis && analysisType === "exam" && (
          <section
            id="report-section"
            className="workspace-card report-section"
            aria-labelledby="report-title"
          >
            <div className="section-heading">
              <h2 id="report-title">4. 최종 시험 보고서</h2>
              <div className="summary-pills">
                <span>
                  경고 <strong>{analysis.warnings.length}</strong>
                </span>
                <span>
                  제외 <strong>{analysis.excludedCount}</strong>
                </span>
              </div>
            </div>

            <ReportSnapshot
              title={`${analysis.currentSheet.name} 시험 응시 현황`}
              eyebrow="정식예배자 기준"
              dateLabel={
                analysis.currentDate?.isoDate.replaceAll("-", ". ") ??
                analysis.currentSheet.name
              }
              cards={analysis.regions.map((region) => ({
                title: region.region,
                caption: `일대일 ${region.currentCounts.일대일응시} · 서면 ${region.currentCounts.서면응시} · 비공식 ${region.currentCounts.비공식응시} · 미응시 ${region.currentCounts.미응시}`,
                primaryLabel: "전체 응시",
                primaryValue: `${region.currentCounts.attendedTotal.toLocaleString()}명`,
                metrics: [
                  {
                    label: "정규시험",
                    value: `${region.currentCounts.regularGroup.toLocaleString()}명`,
                  },
                  {
                    label: "직전 시험",
                    value: `${region.previousCounts.attendedTotal.toLocaleString()}명`,
                  },
                  {
                    label: "증감",
                    value: formatDelta(
                      region.currentCounts.attendedTotal -
                        region.previousCounts.attendedTotal,
                    ),
                  },
                ],
              }))}
              totalCaption={`일대일 ${analysis.currentTotals.일대일응시} · 서면 ${analysis.currentTotals.서면응시} · 비공식 ${analysis.currentTotals.비공식응시} · 미응시 ${analysis.currentTotals.미응시}`}
              totalMetrics={[
                {
                  label: "전체 응시",
                  value: `${analysis.currentTotals.attendedTotal.toLocaleString()}명`,
                },
                {
                  label: "정규시험",
                  value: `${analysis.currentTotals.regularGroup.toLocaleString()}명`,
                },
                {
                  label: "직전 시험",
                  value: `${analysis.previousTotals.attendedTotal.toLocaleString()}명`,
                },
              ]}
              keyStats={[
                {
                  label: "전체 응시",
                  value: `${analysis.currentTotals.attendedTotal.toLocaleString()}명`,
                },
                {
                  label: "정규시험",
                  value: `${analysis.currentTotals.regularGroup.toLocaleString()}명`,
                },
                {
                  label: "직전 시험 대비",
                  value: formatDelta(
                    analysis.currentTotals.attendedTotal -
                      analysis.previousTotals.attendedTotal,
                  ),
                },
              ]}
              totalFirst
            />

            {analysis.warnings.length > 0 && (
              <details className="analysis-warnings" open>
                <summary>
                  분석 품질 경고 {analysis.warnings.length}건
                </summary>
                <ul>
                  {analysis.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {(analysis.matches.newNames.length > 0 ||
                  analysis.matches.missingNames.length > 0 ||
                  analysis.matches.ambiguousNames.length > 0) && (
                  <div className="name-list-grid">
                    <div>
                      <strong>
                        신규 명단 {analysis.matches.newNames.length}명
                      </strong>
                      <p>
                        {analysis.matches.newNames.join(", ") || "없음"}
                      </p>
                    </div>
                    <div>
                      <strong>
                        누락/이탈 {analysis.matches.missingNames.length}명
                      </strong>
                      <p>
                        {analysis.matches.missingNames.join(", ") || "없음"}
                      </p>
                    </div>
                    <div>
                      <strong>
                        매칭 필요 {analysis.matches.ambiguousNames.length}명
                      </strong>
                      <p>
                        {analysis.matches.ambiguousNames.join(", ") || "없음"}
                      </p>
                    </div>
                  </div>
                )}
              </details>
            )}

            <div className="subsection-heading detailed-report-heading">
              <div>
                <h3>상세 보고서</h3>
                <p>지역을 선택해 명단과 증감 원인을 자세히 확인할 수 있습니다.</p>
              </div>
            </div>

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
                    void copyText(
                      buildSingleRegionReport(
                        analysis,
                        selectedRegionAnalysis,
                      ),
                      "현재 지역 보고서를 복사했습니다.",
                    )
                  }
                >
                  현재 지역 복사
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void copyText(
                      buildFullReport(analysis),
                      "전체 지역 보고서를 복사했습니다.",
                    )
                  }
                >
                  전체 지역 복사
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={downloadReport}
                >
                  TXT 다운로드
                </button>
              </div>
            </div>

            <pre className="report-preview" tabIndex={0}>
              {visibleReport}
            </pre>

            <div className="reset-row">
              <button type="button" className="text-button" onClick={resetAll}>
                새 파일 분석
              </button>
              <p>새 파일을 선택하면 현재 메모리의 분석 결과를 초기화합니다.</p>
            </div>
          </section>
        )}

        {parsed && analysisType === "worship" && (
          <WorshipFlow
            parsed={parsed}
            uploadDate={uploadDate}
            onError={setError}
            onToast={(message) => {
              setToast(message);
              window.setTimeout(() => setToast(""), 2400);
            }}
            onReset={resetAll}
          />
        )}
      </main>

      <footer>
        <p>
          이 앱은 코드만 배포됩니다. 선택한 엑셀과 이름 목록은 브라우저
          밖으로 전송하거나 저장하지 않습니다.
        </p>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
