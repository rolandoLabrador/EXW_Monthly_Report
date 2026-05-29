import ExcelJS from 'exceljs';
import type { BiWeeklyReportData } from '../models/report.types.js';

export class ExcelService {
  /**
   * Generates a formatted Bi-Weekly Excel report.
   * 
   * @param data The structured report data.
   * @param outputPath The file path where the Excel file should be saved.
   */
  public async generateReport(data: BiWeeklyReportData, outputPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bi-Weekly Report');

    // Define the highlight style once to keep the code clean and reusable
    const highlightFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF87CEEB' } // Light Blue
    };

    // Set up the exact columns based on your report structure
    sheet.columns = [
      { header: '', key: 'name', width: 80 },
      { header: 'Count of Contract #', key: 'count', width: 22 },
      { header: 'Sum of Net Cost', key: 'cost', width: 22 }
    ];

    // Style the header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'right' };
    sheet.getCell('A1').alignment = { horizontal: 'left' }; // First header column is blank/left
    
    // Apply the highlight specifically to each populated cell in the header row
    headerRow.eachCell((cell) => { cell.fill = highlightFill; });

    // Iterate over the structured data
    for (const dealer of data.dealerships) {
      // Add the Dealership level row
      const dealerRow = sheet.addRow({
        name: dealer.dealershipName,
        count: dealer.totalContractCount,
        cost: dealer.totalNetCost
      });
      dealerRow.font = { bold: true };

      // Add the nested products level rows beneath the dealership
      for (const product of dealer.products) {
        sheet.addRow({
          name: `    ${product.productName}`, // Indented to match your layout
          count: product.contractCount,
          cost: product.totalNetCost
        });
      }
    }

    // Add the blank spacing rows before the Grand Total
    sheet.addRow({});
    sheet.addRow({});

    // Add the Grand Total row
    const totalRow = sheet.addRow({
      name: 'Grand Total',
      count: data.grandTotalCount,
      cost: data.grandTotalNetCost
    });
    totalRow.font = { bold: true };
    
    // Apply the highlight specifically to each populated cell in the Grand Total row
    totalRow.eachCell((cell) => { cell.fill = highlightFill; });

    // Apply the accounting currency format to the 'cost' column globally (skipping the header)
    sheet.getColumn('cost').numFmt = '"$"#,##0.00';

    // --- Add the Second Tab: Raw Contracts ---
    const rawSheet = workbook.addWorksheet('Raw Data');
    rawSheet.columns = [
      { header: 'Contract #', key: 'contractNumber', width: 25 },
      { header: 'Coverage Name', key: 'coverageName', width: 30 },
      { header: 'Dealer Name', key: 'dealershipName', width: 40 },
      { header: 'Net Cost', key: 'netCost', width: 20 }
    ];

    // Style the header row for the raw sheet
    const rawHeaderRow = rawSheet.getRow(1);
    rawHeaderRow.font = { bold: true };

    // Add all the raw contract rows
    for (const raw of data.rawContracts) {
      rawSheet.addRow(raw);
    }

    // Apply the accounting currency format to the 'Net Cost' column
    rawSheet.getColumn('netCost').numFmt = '"$"#,##0.00';

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Excel report successfully generated at: ${outputPath}`);
  }
}