export interface ContractProductType {
  productName: string;
  contractCount: number;
  totalNetCost: number;
}

export interface DealershipBreakdown {
  dealershipName: string;
  totalContractCount: number;
  totalNetCost: number;
  products: ContractProductType[];
}

export interface BiWeeklyReportData {
  dealerships: DealershipBreakdown[];
  grandTotalCount: number;
  grandTotalNetCost: number;
  rawContracts: RawContractType[];
}

export interface RawContractType {
  contractNumber: string;
  coverageName: string;
  dealershipName: string;
  netCost: number;
}