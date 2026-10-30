import ExcelJS from 'exceljs';
import type { BiWeeklyReportData } from '../models/report.types.js';

export class ExcelService {
  /**
   * Generates a formatted Monthly Excel report with More Than 45 Days Count and Cost.
   */
  public async generateReport(
    data: BiWeeklyReportData,
    outputPath: string,
    discrepancies?: any[],
    pcmiStats?: any
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Monthly Report');

    // Define highlight styles
    const highlightFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF87CEEB' } // Light Blue
    };

    const highlightRed: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC7CE' } // Light Pink / Red for More Than 45 Days
    };

    const getOuterBorder = (isTop: boolean, isBottom: boolean, isLeft: boolean, isRight: boolean): Partial<ExcelJS.Borders> => {
      const b: Partial<ExcelJS.Borders> = {};
      if (isTop) b.top = { style: 'medium' };
      if (isBottom) b.bottom = { style: 'medium' };
      if (isLeft) b.left = { style: 'medium' };
      if (isRight) b.right = { style: 'medium' };
      return b;
    };

    // Columns with spacing column A on the left
    sheet.columns = [
      { key: 'emptyA', width: 3 }, // Spacing on the left
      { key: 'name', width: 60 },
      { key: 'count', width: 22 },
      { key: 'cost', width: 22 },
      { key: 'count45', width: 24 },
      { key: 'cost45', width: 24 }
    ];

    // Freeze headers below row 2 (leaving row 1 as top spacing)
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    sheet.addRow({}); // Row 1: Spacing on top

    // Row 2: Header row
    const headerRow = sheet.addRow({
      name: '',
      count: 'Total Count of Contract',
      cost: 'Total of Net Cost',
      count45: 'More than 45 Days Count',
      cost45: 'More than 45 Days Cost'
    });
    headerRow.font = { bold: true };
    
    // Apply styling and borders to header (Columns B through F)
    [2, 3, 4, 5, 6].forEach(colIndex => {
      const cell = headerRow.getCell(colIndex);
      if (colIndex >= 5) {
        cell.fill = highlightRed;
      } else {
        cell.fill = highlightFill;
      }
      if (colIndex > 2) cell.alignment = { horizontal: 'right' };
      cell.border = getOuterBorder(true, true, colIndex === 2, colIndex === 6);
    });

    const startDataRow = 3;

    // Iterate over the structured data
    for (const dealer of data.dealerships) {
      // Add the Dealership level row
      const dealerRow = sheet.addRow({
        name: dealer.dealershipName,
        count: dealer.totalContractCount,
        cost: dealer.totalNetCost,
        count45: dealer.totalCountOver45Days,
        cost45: dealer.totalCostOver45Days
      });
      dealerRow.font = { bold: true };

      // Add the nested products level rows beneath the dealership
      for (const product of dealer.products) {
        sheet.addRow({
          name: `    ${product.productName}`,
          count: product.contractCount,
          cost: product.totalNetCost,
          count45: product.countOver45Days,
          cost45: product.costOver45Days
        });
      }
    }

    const endDataRow = sheet.lastRow ? sheet.lastRow.number : startDataRow;

    // Apply cleaner outer borders around the data table
    for (let r = startDataRow; r <= endDataRow; r++) {
      const row = sheet.getRow(r);
      const isTop = (r === startDataRow);
      const isBottom = (r === endDataRow);
      row.getCell(2).border = getOuterBorder(isTop, isBottom, true, false);
      row.getCell(3).border = getOuterBorder(isTop, isBottom, false, false);
      row.getCell(4).border = getOuterBorder(isTop, isBottom, false, false);
      row.getCell(5).border = getOuterBorder(isTop, isBottom, false, false);
      row.getCell(6).border = getOuterBorder(isTop, isBottom, false, true);
    }

    // Add spacing rows before Grand Total
    sheet.addRow({});
    sheet.addRow({});

    // Add Grand Total row
    const totalRow = sheet.addRow({
      name: 'Grand Total',
      count: data.grandTotalCount,
      cost: data.grandTotalNetCost,
      count45: data.grandTotalCountOver45Days,
      cost45: data.grandTotalCostOver45Days
    });
    totalRow.font = { bold: true };
    
    // Highlights & borders for Grand Total row
    [2, 3, 4, 5, 6].forEach(colIndex => {
      const cell = totalRow.getCell(colIndex);
      if (colIndex >= 5) {
        cell.fill = highlightRed;
      } else {
        cell.fill = highlightFill;
      }
      cell.border = getOuterBorder(true, true, colIndex === 2, colIndex === 6);
    });

    // Add explanatory footnote
    sheet.addRow({});
    const noteRow = sheet.addRow({
      name: '* Note: "Total Count of Contract" and "Total of Net Cost" reflect all pending contracts to date. "More than 45 Days" columns highlight the subset of contracts that have been pending for more than 45 days.'
    });
    noteRow.font = { italic: true, size: 10, color: { argb: 'FF595959' } };

    // Apply currency formatting to the cost columns globally
    sheet.getColumn('cost').numFmt = '"$"#,##0.00';
    sheet.getColumn('cost45').numFmt = '"$"#,##0.00';

    // --- Add the Second Tab: Raw Contracts ---
    const rawSheet = workbook.addWorksheet('Raw Data');
    rawSheet.views = [{ state: 'frozen', ySplit: 1 }];
    rawSheet.columns = [
      { header: 'Contract #', key: 'contractNumber', width: 25 },
      { header: 'Sale Date', key: 'saleDate', width: 15 },
      { header: 'Coverage Name', key: 'coverageName', width: 30 },
      { header: 'Dealer Name', key: 'dealershipName', width: 40 },
      { header: 'Net Cost', key: 'netCost', width: 20 },
      { header: 'Age Category', key: 'ageCategory', width: 18 }
    ];

    const rawHeaderRow = rawSheet.getRow(1);
    rawHeaderRow.font = { bold: true };
    for (let c = 1; c <= 6; c++) {
      rawHeaderRow.getCell(c).border = getOuterBorder(true, true, c === 1, c === 6);
    }

    for (const raw of data.rawContracts) {
      const rawRow = rawSheet.addRow(raw);
      if (raw.ageCategory === '> 45 Days') {
        for (let c = 1; c <= 6; c++) {
          rawRow.getCell(c).fill = highlightRed;
        }
      }
    }

    rawSheet.getColumn('netCost').numFmt = '"$"#,##0.00';

    // --- Add the Third Tab: Discrepancies (if PCMI reconciliation was run) ---
    if (discrepancies) {
      const discSheet = workbook.addWorksheet('Discrepancies');
      discSheet.views = [{ state: 'frozen', ySplit: 1 }];
      discSheet.columns = [
        { header: 'Contract #', key: 'contractNumber', width: 25 },
        { header: 'Dealer Name', key: 'dealershipName', width: 40 },
        { header: 'Sale Date', key: 'saleDate', width: 15 },
        { header: 'Coverage Name', key: 'coverageName', width: 30 },
        { header: 'Net Cost', key: 'netCost', width: 20 },
        { header: 'Database Status', key: 'dbStatus', width: 18 },
        { header: 'PCMI Status Code', key: 'pcmiCode', width: 18 },
        { header: 'PCMI Status Description', key: 'pcmiDesc', width: 28 }
      ];

      const discHeaderRow = discSheet.getRow(1);
      discHeaderRow.font = { bold: true };
      for (let c = 1; c <= 8; c++) {
        discHeaderRow.getCell(c).fill = highlightRed;
        discHeaderRow.getCell(c).border = getOuterBorder(true, true, c === 1, c === 8);
      }

      if (discrepancies.length === 0) {
        const emptyRow = discSheet.addRow({
          contractNumber: 'No discrepancies detected. 100% of pending contracts match PCMI live pending status.'
        });
        emptyRow.font = { italic: true };
      } else {
        const formatUtc = (val: any) => {
          if (!val) return '';
          const d = new Date(val);
          if (isNaN(d.getTime())) return '';
          return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
        };

        for (const item of discrepancies) {
          const c = item.contract;
          const status = item.pcmiStatus || {};
          const row = discSheet.addRow({
            contractNumber: item.contractNumber || c.metadata?.['Contract#'] || '',
            dealershipName: c.metadata?.DealerName || '',
            saleDate: formatUtc(c.metadata?.SaleDate || c.metadata?.EntryDate),
            coverageName: c.metadata?.CoverageName || '',
            netCost: Number(c.metadata?.NetCost) || 0,
            dbStatus: 'Pending (P)',
            pcmiCode: status.code || '',
            pcmiDesc: status.description || ''
          });

          row.getCell(7).font = { bold: true, color: { argb: 'FF9C0006' } };
          row.getCell(8).font = { bold: true, color: { argb: 'FF9C0006' } };
        }
      }

      discSheet.getColumn('netCost').numFmt = '"$"#,##0.00';
    }

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Excel report successfully generated at: ${outputPath}`);
  }
}
