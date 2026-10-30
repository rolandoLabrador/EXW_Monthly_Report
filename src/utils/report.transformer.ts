import type { BiWeeklyReportData, DealershipBreakdown, ContractProductType, RawContractType } from '../models/report.types.js';

export interface MongoContract {
  _id?: { toString(): string };
  metadata?: {
    DealerName?: unknown;
    CoverageName?: unknown;
    NetCost?: unknown;
    "Contract#"?: unknown;
    SaleDate?: unknown;
    EntryDate?: unknown;
  };
}

function formatUtcDate(val: any): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function transformContractData(contracts: MongoContract[]): BiWeeklyReportData {
  const dealerMap = new Map<string, {
    totalCount: number;
    totalCost: number;
    totalCountOver45: number;
    totalCostOver45: number;
    products: Map<string, { count: number; cost: number; countOver45: number; costOver45: number }>;
  }>();

  let grandTotalCount = 0;
  let grandTotalNetCost = 0;
  let grandTotalCountOver45Days = 0;
  let grandTotalCostOver45Days = 0;
  const rawContracts: RawContractType[] = [];

  const now = new Date();
  const msIn45Days = 45 * 24 * 60 * 60 * 1000;

  for (const contract of contracts) {
    const dealerName = String(contract.metadata?.DealerName || 'Unknown Dealer');
    const productName = String(contract.metadata?.CoverageName || 'Unknown Coverage');
    const netCost = Number(contract.metadata?.NetCost) || 0;
    const contractNumber = String(contract.metadata?.['Contract#'] || contract._id?.toString() || 'Unknown');

    // Calculate age based on SaleDate (with fallback to EntryDate)
    const saleDateVal = contract.metadata?.SaleDate || contract.metadata?.EntryDate;
    let isOver45 = false;
    let ageCategory = '< 45 Days';

    if (saleDateVal) {
      const d = new Date(String(saleDateVal));
      if (!isNaN(d.getTime())) {
        const ageMs = now.getTime() - d.getTime();
        if (ageMs > msIn45Days) {
          isOver45 = true;
          ageCategory = '> 45 Days';
        }
      }
    }

    rawContracts.push({
      contractNumber,
      coverageName: productName,
      dealershipName: dealerName,
      netCost,
      saleDate: formatUtcDate(saleDateVal),
      ageCategory
    });

    grandTotalCount++;
    grandTotalNetCost += netCost;
    if (isOver45) {
      grandTotalCountOver45Days++;
      grandTotalCostOver45Days += netCost;
    }

    if (!dealerMap.has(dealerName)) {
      dealerMap.set(dealerName, {
        totalCount: 0,
        totalCost: 0,
        totalCountOver45: 0,
        totalCostOver45: 0,
        products: new Map()
      });
    }

    const dealer = dealerMap.get(dealerName)!;
    dealer.totalCount++;
    dealer.totalCost += netCost;
    if (isOver45) {
      dealer.totalCountOver45++;
      dealer.totalCostOver45 += netCost;
    }

    if (!dealer.products.has(productName)) {
      dealer.products.set(productName, {
        count: 0,
        cost: 0,
        countOver45: 0,
        costOver45: 0
      });
    }

    const product = dealer.products.get(productName)!;
    product.count++;
    product.cost += netCost;
    if (isOver45) {
      product.countOver45++;
      product.costOver45 += netCost;
    }
  }

  const dealerships: DealershipBreakdown[] = [];
  for (const [dealerName, dealerData] of dealerMap.entries()) {
    const products: ContractProductType[] = [];
    for (const [productName, productData] of dealerData.products.entries()) {
      products.push({
        productName,
        contractCount: productData.count,
        totalNetCost: productData.cost,
        countOver45Days: productData.countOver45,
        costOver45Days: productData.costOver45
      });
    }
    
    dealerships.push({
      dealershipName: dealerName,
      totalContractCount: dealerData.totalCount,
      totalNetCost: dealerData.totalCost,
      totalCountOver45Days: dealerData.totalCountOver45,
      totalCostOver45Days: dealerData.totalCostOver45,
      products
    });
  }

  return {
    dealerships,
    grandTotalCount,
    grandTotalNetCost,
    grandTotalCountOver45Days,
    grandTotalCostOver45Days,
    rawContracts
  };
}
