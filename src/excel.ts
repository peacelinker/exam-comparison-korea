import * as XLSX from "xlsx";
import { createDataRow, createSheetProfile } from "./core";
import type { ParsedWorkbook, SheetProfile } from "./types";

const RELEVANT_COLUMNS = [0, 3, 6, 8] as const;

function getCell(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  columnIndex: number,
): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] as
    | XLSX.CellObject
    | undefined;
}

function visibleValue(cell: XLSX.CellObject | undefined): unknown {
  return cell?.v ?? "";
}

function parseSheet(name: string, sheet: XLSX.WorkSheet): SheetProfile {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  const columnsReadable = Boolean(range && range.e.c >= 8);
  const rows = [];
  let missingRegionOrNameCount = 0;
  let formulaWithoutCachedValueCount = 0;

  if (range) {
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
      const cells = RELEVANT_COLUMNS.map((columnIndex) =>
        getCell(sheet, rowIndex, columnIndex),
      );
      for (const cell of cells) {
        if (cell?.f && cell.v == null) {
          formulaWithoutCachedValueCount += 1;
        }
      }

      const values = cells.map(visibleValue);
      const [region, personName, worship, exam] = values;
      const anyRelevantValue = values.some(
        (value) => String(value ?? "").trim() !== "",
      );
      const hasRegion = String(region ?? "").trim() !== "";
      const hasName = String(personName ?? "").trim() !== "";
      if (anyRelevantValue && (!hasRegion || !hasName)) {
        missingRegionOrNameCount += 1;
      }
      if (!hasName) continue;
      rows.push(
        createDataRow(
          rowIndex + 1,
          region,
          personName,
          worship,
          exam,
        ),
      );
    }
  }

  return createSheetProfile(name, rows, {
    missingRegionOrNameCount,
    formulaWithoutCachedValueCount,
    columnsReadable,
  });
}

export function parseWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName = "선택한 파일",
): ParsedWorkbook {
  const workbook = XLSX.read(buffer, {
    type: buffer instanceof Uint8Array ? "array" : "array",
    cellFormula: true,
    cellText: false,
    cellNF: false,
    raw: true,
  });

  const sheets = workbook.SheetNames.map((name) =>
    parseSheet(name, workbook.Sheets[name]),
  );
  return { fileName, sheets };
}

export async function readWorkbookFile(file: File): Promise<ParsedWorkbook> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error(
      "현재는 .xlsx 파일만 지원합니다. 엑셀에서 ‘Excel 통합 문서(.xlsx)’ 형식으로 저장한 뒤 다시 선택해 주세요.",
    );
  }
  const buffer = await file.arrayBuffer();
  return parseWorkbookBuffer(buffer, file.name);
}
