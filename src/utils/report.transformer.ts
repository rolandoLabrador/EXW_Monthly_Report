import type { BiWeeklyReportData, DealershipBreakdown, ContractProductType, RawContractType } from '../models/report.types.js';
// This file Organizes and transforms raw contract data from MongoDB into the structured format needed for the Excel report. 
//It aggregates counts and costs by dealership and product, while also preparing a raw list of contracts for the second tab of the report.

export function transformContractData(contracts: any[]): BiWeeklyReportData {
  const dealerMap = new Map<string, { totalCount: number; totalCost: number; products: Map<string, { count: number; cost: number }> }>();

  let grandTotalCount = 0;
  let grandTotalNetCost = 0;
  const rawContracts: RawContractType[] = [];

  for (const contract of contracts) {
    // Mapped exactly to your MongoDB schema
    const dealerName = contract.metadata?.DealerName || 'Unknown Dealer';
    const productName = contract.metadata?.CoverageName || 'Unknown Coverage';
    const netCost = Number(contract.metadata?.NetCost) || 0;
    
    // Safely access "Contract#" using bracket notation
    const contractNumber = contract.metadata?.['Contract#'] || contract._id?.toString() || 'Unknown';

    // Add to the raw unaggregated array for the second tab
    rawContracts.push({
      contractNumber: contractNumber,
      coverageName: productName,
      dealershipName: dealerName,
      netCost: netCost
    });

    grandTotalCount++;
    grandTotalNetCost += netCost;

    if (!dealerMap.has(dealerName)) {
      dealerMap.set(dealerName, { totalCount: 0, totalCost: 0, products: new Map() });
    }

    const dealer = dealerMap.get(dealerName)!;
    dealer.totalCount++;
    dealer.totalCost += netCost;

    if (!dealer.products.has(productName)) {
      dealer.products.set(productName, { count: 0, cost: 0 });
    }

    const product = dealer.products.get(productName)!;
    product.count++;
    product.cost += netCost;
  }

  const dealerships: DealershipBreakdown[] = [];
  for (const [dealerName, dealerData] of dealerMap.entries()) {
    const products: ContractProductType[] = [];
    for (const [productName, productData] of dealerData.products.entries()) {
      products.push({
        productName,
        contractCount: productData.count,
        totalNetCost: productData.cost
      });
    }
    
    dealerships.push({
      dealershipName: dealerName,
      totalContractCount: dealerData.totalCount,
      totalNetCost: dealerData.totalCost,
      products
    });
  }

  return { dealerships, grandTotalCount, grandTotalNetCost, rawContracts };
}