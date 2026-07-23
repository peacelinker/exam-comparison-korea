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

type Stage = "upload" | "confirm" | "report";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const countUnknown = (profile: SheetProfile) =>
  Object.values(profile.metrics.unknownStatusCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

function confidence(profile: SheetProfile, threshold: number) {
  if (profile.metrics.validStatusRatio >= 0.8) {
    return { label: "높은 신뢰도", tone: "success" };
  }
  if (profile.metrics.validStatusRatio >= threshold) {
    return { label: "주의", tone: "caution" };
  }
  return { label: "불충분", tone: "danger" };
}

function App() {
  const [referenceDate, setReferenceDate] = useState(getSeoulToday);
  const [latestExamDate, setLatestExamDate] = useState("");
  const [thresholdPercent, setThresholdPercent] = useState(50);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
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

  const threshold = thresholdPercent / 100;
  const recommendation = useMemo(
    () =>
      parsed
        ? recommendSheets(
            parsed.sheets,
            referenceDate,
            threshold,
            latestExamDate || undefined,
          )
        : null,
    [parsed, referenceDate, threshold, latestExamDate],
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

  const stage: Stage = analysis ? "report" : parsed ? "confirm" : "upload";
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
        <nav className="topbar" aria-label="서비스 안내">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              비
            </span>
            <span>시험 비교 분석</span>
          </div>
          <span className="local-badge">
            <span className="status-dot" aria-hidden="true" />
            브라우저 내부 처리
          </span>
        </nav>

        <div className="hero-grid">
          <div>
            <p className="eyebrow">EXAM COMPARISON WORKSPACE</p>
            <h1>
              엑셀 두 탭의 변화를
              <br />
              정확하게 비교하세요
            </h1>
            <p className="hero-copy">
              날짜형 탭과 I열 입력률을 함께 살펴 적절한 시험 탭을 추천하고,
              지역별 증감과 명단을 정해진 양식으로 정리합니다.
            </p>
          </div>
          <div className="privacy-card">
            <div className="shield" aria-hidden="true">
              <span>✓</span>
            </div>
            <div>
              <strong>파일은 이 기기를 벗어나지 않습니다</strong>
              <p>
                서버 전송, 로그인, 저장, 분석 추적 없이 현재 브라우저
                메모리에서만 처리합니다.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main>
        <ol className="stepper" aria-label="분석 진행 단계">
          {[
            ["01", "파일과 기준 설정"],
            ["02", "탭 추천 확인"],
            ["03", "보고서 생성"],
          ].map(([number, label], index) => {
            const currentIndex =
              stage === "upload" ? 0 : stage === "confirm" ? 1 : 2;
            return (
              <li
                key={number}
                className={
                  index === currentIndex
                    ? "active"
                    : index < currentIndex
                      ? "complete"
                      : ""
                }
              >
                <span>{index < currentIndex ? "✓" : number}</span>
                <strong>{label}</strong>
              </li>
            );
          })}
        </ol>

        <section className="workspace-card" aria-labelledby="upload-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">STEP 01</p>
              <h2 id="upload-title">파일과 분석 기준</h2>
            </div>
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
              <h3>{busy ? "엑셀을 브라우저에서 읽는 중…" : ".xlsx 파일을 놓아주세요"}</h3>
              <p>또는 아래 버튼으로 이 기기에서 파일을 선택하세요.</p>
              <button
                type="button"
                className="button primary"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                {busy ? "분석 준비 중" : "파일 선택"}
              </button>
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFileInput}
                disabled={busy}
              />
              <small>지원 형식: Excel 통합 문서(.xlsx)</small>
            </div>
          )}

          <div className="settings-grid">
            <label>
              <span>기준일 <em>Asia/Seoul</em></span>
              <input
                type="date"
                value={referenceDate}
                onChange={(event) => {
                  setReferenceDate(event.target.value);
                  setAnalysis(null);
                }}
              />
              <small>날짜형 탭의 연도를 추론하는 기준입니다.</small>
            </label>
            <label>
              <span>최근 시험일 <em>선택</em></span>
              <input
                type="date"
                value={latestExamDate}
                onChange={(event) => {
                  setLatestExamDate(event.target.value);
                  setAnalysis(null);
                }}
              />
              <small>입력하면 월·일이 같은 탭을 먼저 살핍니다.</small>
            </label>
            <label>
              <span>
                I열 유효 입력률 기준 <strong>{thresholdPercent}%</strong>
              </span>
              <input
                className="range"
                type="range"
                min="10"
                max="100"
                step="5"
                value={thresholdPercent}
                onChange={(event) => {
                  setThresholdPercent(Number(event.target.value));
                  setAnalysis(null);
                }}
              />
              <small>자동 추천에만 적용되며 수동 선택이 우선합니다.</small>
            </label>
          </div>
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

        {parsed && recommendation && (
          <>
            <section className="workspace-card" aria-labelledby="sheet-table-title">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">TAB QUALITY</p>
                  <h2 id="sheet-table-title">탭별 입력 상태</h2>
                </div>
                <span className="muted-note">
                  D열에 이름이 있는 행 기준
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>시트 탭</th>
                      <th>날짜 해석</th>
                      <th>데이터 행</th>
                      <th>유효 I열</th>
                      <th>빈값</th>
                      <th>알 수 없음</th>
                      <th>A/D 누락</th>
                      <th>판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.sheets.map((profile) => {
                      const date = recommendation.sheetDates.find(
                        (item) => item.sheetName === profile.name,
                      )?.date;
                      const state = confidence(profile, threshold);
                      const unknownEntries = Object.entries(
                        profile.metrics.unknownStatusCounts,
                      );
                      return (
                        <tr key={profile.name}>
                          <td>
                            <strong>{profile.name}</strong>
                            {profile.metrics.formulaWithoutCachedValueCount >
                              0 && (
                              <small className="cell-warning">
                                저장값 없는 수식{" "}
                                {
                                  profile.metrics
                                    .formulaWithoutCachedValueCount
                                }
                                건
                              </small>
                            )}
                          </td>
                          <td>{date?.isoDate ?? "—"}</td>
                          <td>{profile.metrics.dataRowCount.toLocaleString()}</td>
                          <td>
                            <strong>
                              {profile.metrics.validStatusCount.toLocaleString()}
                            </strong>
                            <small>
                              {percent(profile.metrics.validStatusRatio)}
                            </small>
                          </td>
                          <td>
                            {profile.metrics.blankStatusCount.toLocaleString()}
                          </td>
                          <td>
                            {countUnknown(profile).toLocaleString()}
                            {unknownEntries.length > 0 && (
                              <small title={unknownEntries
                                .map(([value, count]) => `${value} ${count}건`)
                                .join(", ")}
                              >
                                {unknownEntries
                                  .map(
                                    ([value, count]) => `${value} ${count}건`,
                                  )
                                  .join(", ")}
                              </small>
                            )}
                          </td>
                          <td>
                            {profile.metrics.missingRegionOrNameCount.toLocaleString()}
                          </td>
                          <td>
                            <span className={`quality-tag ${state.tone}`}>
                              {state.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="workspace-card" aria-labelledby="recommend-title">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">STEP 02</p>
                  <h2 id="recommend-title">추천 탭 확인</h2>
                </div>
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
                  <p>이번(최근) 시험 탭</p>
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
                  <span>이번(최근) 시험 탭</span>
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
                  두 탭은 언제든 직접 바꿀 수 있습니다. 선택을 확정해야
                  이름 매칭과 지역별 분석을 시작합니다.
                </p>
                <button
                  type="button"
                  className="button primary large"
                  onClick={confirmAndAnalyze}
                  disabled={!currentSheet || !previousSheet || busy}
                >
                  선택 확정 후 분석
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          </>
        )}

        {analysis && (
          <section
            id="report-section"
            className="workspace-card report-section"
            aria-labelledby="report-title"
          >
            <div className="section-heading">
              <div>
                <p className="section-kicker">STEP 03</p>
                <h2 id="report-title">지역별 비교 보고서</h2>
              </div>
              <div className="summary-pills">
                <span>
                  경고 <strong>{analysis.warnings.length}</strong>
                </span>
                <span>
                  제외 <strong>{analysis.excludedCount}</strong>
                </span>
              </div>
            </div>

            <div className="report-meta-grid">
              <div>
                <span>이번 시험</span>
                <strong>{analysis.currentSheet.name}</strong>
                <small>
                  {analysis.currentDate?.isoDate ?? "날짜 해석 없음"} · 입력률{" "}
                  {percent(analysis.currentSheet.metrics.validStatusRatio)}
                </small>
              </div>
              <div>
                <span>직전 시험</span>
                <strong>{analysis.previousSheet.name}</strong>
                <small>
                  {analysis.previousDate?.isoDate ?? "날짜 해석 없음"} · 입력률{" "}
                  {percent(analysis.previousSheet.metrics.validStatusRatio)}
                </small>
              </div>
              <div>
                <span>전체 응시자 증감</span>
                <strong
                  className={
                    analysis.currentTotals.attendedTotal -
                      analysis.previousTotals.attendedTotal >=
                    0
                      ? "positive"
                      : "negative"
                  }
                >
                  {analysis.currentTotals.attendedTotal -
                    analysis.previousTotals.attendedTotal >
                  0
                    ? "+"
                    : ""}
                  {analysis.currentTotals.attendedTotal -
                    analysis.previousTotals.attendedTotal}
                  명
                </strong>
                <small>
                  {analysis.previousTotals.attendedTotal.toLocaleString()} →{" "}
                  {analysis.currentTotals.attendedTotal.toLocaleString()}
                </small>
              </div>
              <div>
                <span>정규군 증감</span>
                <strong
                  className={
                    analysis.currentTotals.regularGroup -
                      analysis.previousTotals.regularGroup >=
                    0
                      ? "positive"
                      : "negative"
                  }
                >
                  {analysis.currentTotals.regularGroup -
                    analysis.previousTotals.regularGroup >
                  0
                    ? "+"
                    : ""}
                  {analysis.currentTotals.regularGroup -
                    analysis.previousTotals.regularGroup}
                  명
                </strong>
                <small>
                  {analysis.previousTotals.regularGroup.toLocaleString()} →{" "}
                  {analysis.currentTotals.regularGroup.toLocaleString()}
                </small>
              </div>
            </div>

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
