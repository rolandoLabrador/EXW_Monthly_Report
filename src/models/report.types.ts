export interface ContractProductType {
  productName: string;
  contractCount: number;
  totalNetCost: number;
  countOver45Days: number;
  costOver45Days: number;
}

export interface DealershipBreakdown {
  dealershipName: string;
  totalContractCount: number;
  totalNetCost: number;
  totalCountOver45Days: number;
  totalCostOver45Days: number;
  products: ContractProductType[];
}

export interface BiWeeklyReportData {
  dealerships: DealershipBreakdown[];
  grandTotalCount: number;
  grandTotalNetCost: number;
  grandTotalCountOver45Days: number;
  grandTotalCostOver45Days: number;
  rawContracts: RawContractType[];
}

export interface RawContractType {
  contractNumber: string;
  coverageName: string;
  dealershipName: string;
  netCost: number;
  saleDate?: string | undefined;
  ageCategory?: string | undefined;
  hasCostDiscrepancy?: boolean | undefined;
  dbDealerCost?: number | undefined;
  apiDealerCost?: number | undefined;
}

export interface CostDiscrepancyItem {
  contractNumber: string;
  dealershipName: string;
  saleDate: string;
  coverageName: string;
  dbCost: number;
  apiCost: number;
  costDifference: number;
}

export interface MongoContract {
  _id?: { toString(): string } | undefined;
  metadata?: {
    DealerName?: unknown;
    CoverageName?: unknown;
    NetCost?: unknown;
    SubmittedAmount?: unknown;
    "Contract#"?: unknown;
    ContractNumber?: unknown;
    SaleDate?: unknown;
    EntryDate?: unknown;
    [key: string]: unknown;
  } | undefined;
  WrittenAmount?: unknown;
  effectiveCost?: number | undefined;
  hasCostDiscrepancy?: boolean | undefined;
  dbDealerCost?: number | undefined;
  apiDealerCost?: number | undefined;
  [key: string]: unknown;
}

export interface PcmiDiscrepancy {
  contractNumber: string;
  contract: MongoContract;
  pcmiStatus?: {
    code?: string | undefined;
    description?: string | undefined;
  } | null | undefined;
  dbCost?: number | undefined;
  apiCost?: number | undefined;
}
