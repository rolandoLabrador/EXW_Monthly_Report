import type { CostDiscrepancyItem } from '../models/report.types.js';

export interface PcmiContractStatus {
  code: string;
  description: string;
}

export interface PcmiContractInfo {
  status: PcmiContractStatus | null;
  dealerCost: number | null;
}

export interface PcmiVerificationStats {
  totalChecked: number;
  stillPendingCount: number;
  stillPendingCost: number;

  // Status discrepancies (contracts no longer pending in PCMI)
  statusDiscrepancyCount: number;
  removedCost: number;
  byStatus: {
    active: number;
    cancelled: number;
    other: number;
  };

  // Cost discrepancies (dealer cost mismatch between DB WrittenAmount & API)
  costDiscrepancyCount: number;
  costDiscrepancyList: CostDiscrepancyItem[];
  costDiscrepancyRatePct: number;

  // Overall discrepancy metrics
  discrepancyCount: number;
  discrepancyRatePct: number;
  isHighDiscrepancy: boolean;
}

export interface PcmiVerificationResult {
  pendingContracts: any[];
  removedContracts: any[];
  stats: PcmiVerificationStats;
}

/**
 * Calculates Database Dealer Cost by summing all values across all categories in the `WrittenAmount` section
 * (e.g. ADMIN + COMMISSION + RESERVE items).
 * If `WrittenAmount` is missing or empty, safely falls back to `metadata.NetCost` or `metadata.SubmittedAmount`.
 */
export function calculateDbDealerCost(contract: any): number {
  const writtenAmount = contract?.WrittenAmount || contract?.metadata?.WrittenAmount;
  if (writtenAmount && typeof writtenAmount === 'object') {
    let sum = 0;
    let found = false;

    const traverse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val === null || val === undefined) continue;

        if (typeof val === 'number') {
          if (!isNaN(val)) {
            sum += val;
            found = true;
          }
        } else if (typeof val === 'string' && val.trim() !== '') {
          const num = Number(val);
          if (!isNaN(num)) {
            sum += num;
            found = true;
          }
        } else if (typeof val === 'object') {
          if ('value' in val && !isNaN(Number((val as any).value))) {
            sum += Number((val as any).value);
            found = true;
          } else if (typeof (val as any).toNumber === 'function') {
            sum += (val as any).toNumber();
            found = true;
          } else if (typeof (val as any).toString === 'function' && !isNaN(Number((val as any).toString()))) {
            sum += Number((val as any).toString());
            found = true;
          } else {
            traverse(val);
          }
        }
      }
    };

    traverse(writtenAmount);
    if (found && sum > 0) {
      return Number(sum.toFixed(2));
    }
  }

  // Fallback to metadata.NetCost or metadata.SubmittedAmount
  const netCost = Number(contract?.metadata?.NetCost);
  if (!isNaN(netCost) && netCost > 0) {
    return Number(netCost.toFixed(2));
  }
  const submittedAmount = Number(contract?.metadata?.SubmittedAmount);
  if (!isNaN(submittedAmount) && submittedAmount > 0) {
    return Number(submittedAmount.toFixed(2));
  }
  return 0;
}

/**
 * Extracts Dealer Cost from PCMI GetContracts API response.
 * Prefers `dealerCost.amountWithTax`, with fallback to `dealerCost.amount`.
 */
export function extractApiDealerCost(contractData: any): number | null {
  if (!contractData || !contractData.dealerCost) return null;
  const dc = contractData.dealerCost;
  if (typeof dc === 'number' && !isNaN(dc)) return Number(dc.toFixed(2));
  if (dc.amountWithTax !== undefined && dc.amountWithTax !== null) {
    const val = Number(dc.amountWithTax);
    return isNaN(val) ? null : Number(val.toFixed(2));
  }
  if (dc.amount !== undefined && dc.amount !== null) {
    const val = Number(dc.amount);
    return isNaN(val) ? null : Number(val.toFixed(2));
  }
  return null;
}

export class PcmiService {
  private baseUrl: string;
  private tokenUrl: string;
  private clientId: string;
  private clientSecret: string;
  private username: string;
  private password: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.tokenUrl = process.env.PCMI_TOKEN_URL || 'https://pcrsauto.com/Pcmi.Web.Sts/token';
    this.baseUrl = (process.env.PCMI_BASE_URL || 'https://pcrsauto.com/Pcmi.web.services')
      .replace(/\/swagger\/.*$/i, '')
      .replace(/\/+$/, '');
    this.clientId = process.env.PCMI_CLIENT_ID || '';
    this.clientSecret = process.env.PCMI_CLIENT_SECRET || '';
    this.username = process.env.PCMI_USERNAME || '';
    this.password = process.env.PCMI_PASSWORD || '';
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    const params = new URLSearchParams();
    params.append('grant_type', process.env.PCMI_GRANT_TYPE || 'password');
    params.append('username', this.username);
    params.append('password', this.password);
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to obtain PCMI access token (${response.status} ${response.statusText}): ${errorText}`);
    }

    const data: any = await response.json();
    this.accessToken = data.access_token;
    const expiresInMs = (Number(data.expires_in) || 1800) * 1000;
    this.tokenExpiresAt = now + expiresInMs;

    return this.accessToken!;
  }

  public async getContractInfo(contractNumber: string): Promise<PcmiContractInfo | null> {
    try {
      const token = await this.getAccessToken();
      const url = `${this.baseUrl}/api/v2/contracts/GetContracts?contractNumber=${encodeURIComponent(contractNumber)}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`PCMI API returned ${response.status} for contract ${contractNumber}`);
        return null;
      }

      const data: any = await response.json();
      if (data.contracts && data.contracts.length > 0) {
        const c = data.contracts[0];
        return {
          status: c.status || null,
          dealerCost: extractApiDealerCost(c)
        };
      }
      return null;
    } catch (err: any) {
      console.warn(`Error querying PCMI info for contract ${contractNumber}:`, err.message);
      return null;
    }
  }

  public async getContractStatus(contractNumber: string): Promise<PcmiContractStatus | null> {
    const info = await this.getContractInfo(contractNumber);
    return info?.status || null;
  }

  public async filterPendingContracts(
    contracts: any[],
    concurrency: number = 12
  ): Promise<PcmiVerificationResult> {
    console.log(`Starting PCMI live verification for ${contracts.length} contracts (concurrency: ${concurrency})...`);
    
    const pendingContracts: any[] = [];
    const removedContracts: any[] = [];
    const costDiscrepancyList: CostDiscrepancyItem[] = [];
    let completed = 0;
    const total = contracts.length;
    const startTime = Date.now();

    const byStatus = {
      active: 0,
      cancelled: 0,
      other: 0
    };

    let stillPendingCost = 0;
    let removedCost = 0;

    let currentIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (currentIndex < total) {
        const index = currentIndex++;
        const contract = contracts[index]!;
        const contractNumber = contract.metadata?.['Contract#'] || contract.metadata?.ContractNumber;
        const dbCost = calculateDbDealerCost(contract);

        if (!contractNumber) {
          contract.effectiveCost = dbCost;
          contract.hasCostDiscrepancy = false;
          contract.dbDealerCost = dbCost;
          contract.apiDealerCost = dbCost;
          pendingContracts.push(contract);
          stillPendingCost += dbCost;
          completed++;
          continue;
        }

        const info = await this.getContractInfo(contractNumber);

        if (!info || !info.status) {
          contract.effectiveCost = dbCost;
          contract.hasCostDiscrepancy = false;
          contract.dbDealerCost = dbCost;
          contract.apiDealerCost = dbCost;
          pendingContracts.push(contract);
          stillPendingCost += dbCost;
        } else if (info.status.code?.toUpperCase() === 'P' || info.status.description?.toUpperCase() === 'PENDING') {
          const apiCost = info.dealerCost;
          const hasCostDiff = apiCost !== null && Math.abs(dbCost - apiCost) > 0.01;

          if (hasCostDiff) {
            contract.effectiveCost = apiCost!;
            contract.hasCostDiscrepancy = true;
            contract.dbDealerCost = dbCost;
            contract.apiDealerCost = apiCost!;

            costDiscrepancyList.push({
              contractNumber,
              dealershipName: contract.metadata?.DealerName || '',
              saleDate: contract.metadata?.SaleDate || contract.metadata?.EntryDate || '',
              coverageName: contract.metadata?.CoverageName || '',
              dbCost,
              apiCost: apiCost!,
              costDifference: Number((apiCost! - dbCost).toFixed(2))
            });

            pendingContracts.push(contract);
            stillPendingCost += apiCost!;
          } else {
            const effectiveCost = apiCost !== null ? apiCost : dbCost;
            contract.effectiveCost = effectiveCost;
            contract.hasCostDiscrepancy = false;
            contract.dbDealerCost = dbCost;
            contract.apiDealerCost = effectiveCost;
            pendingContracts.push(contract);
            stillPendingCost += effectiveCost;
          }
        } else {
          removedContracts.push({
            contract,
            contractNumber,
            pcmiStatus: info.status,
            dbCost,
            apiCost: info.dealerCost
          });
          removedCost += dbCost;

          const code = info.status.code?.toUpperCase();
          if (code === 'A' || info.status.description?.toUpperCase().includes('ACTIVE')) {
            byStatus.active++;
          } else if (code === 'C' || code === 'V' || info.status.description?.toUpperCase().includes('CANCEL') || info.status.description?.toUpperCase().includes('VOID')) {
            byStatus.cancelled++;
          } else {
            byStatus.other++;
          }
        }

        completed++;
        if (completed % 250 === 0 || completed === total) {
          console.log(`PCMI Verification Progress: ${completed}/${total} checked (${removedContracts.length} status mismatches, ${costDiscrepancyList.length} cost differences)`);
        }
      }
    });

    await Promise.all(workers);

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const statusDiscrepancyCount = removedContracts.length;
    const costDiscrepancyCount = costDiscrepancyList.length;
    const totalDiscrepancyCount = statusDiscrepancyCount + costDiscrepancyCount;

    const discrepancyRatePct = total > 0 ? Number(((totalDiscrepancyCount / total) * 100).toFixed(2)) : 0;
    const costDiscrepancyRatePct = total > 0 ? Number(((costDiscrepancyCount / total) * 100).toFixed(2)) : 0;
    const isHighDiscrepancy = discrepancyRatePct > 2.0 || costDiscrepancyRatePct > 2.0;

    console.log(`\n================= PCMI VERIFICATION SUMMARY =================`);
    console.log(`Execution Time: ${elapsedSeconds}s`);
    console.log(`Total Contracts Scanned: ${total}`);
    console.log(`Verified Still Pending: ${pendingContracts.length} ($${stillPendingCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    console.log(`  - Matching Cost: ${pendingContracts.length - costDiscrepancyCount}`);
    console.log(`  - Cost Differences (API Adopted & Highlighted): ${costDiscrepancyCount}`);
    console.log(`Status Discrepancies Removed: ${statusDiscrepancyCount} ($${removedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    console.log(`  - Active in PCMI: ${byStatus.active}`);
    console.log(`  - Cancelled/Void in PCMI: ${byStatus.cancelled}`);
    console.log(`  - Other Statuses: ${byStatus.other}`);
    console.log(`Overall Discrepancy Rate: ${discrepancyRatePct}% (Cost Discrepancy Rate: ${costDiscrepancyRatePct}%)`);
    console.log(`High Discrepancy (>2% threshold): ${isHighDiscrepancy ? 'YES (Will route to DISCREPANCY_RECEIVER_EMAIL)' : 'NO'}`);
    console.log(`=============================================================\n`);

    const stats: PcmiVerificationStats = {
      totalChecked: total,
      stillPendingCount: pendingContracts.length,
      stillPendingCost,
      statusDiscrepancyCount,
      removedCost,
      byStatus,
      costDiscrepancyCount,
      costDiscrepancyList,
      costDiscrepancyRatePct,
      discrepancyCount: totalDiscrepancyCount,
      discrepancyRatePct,
      isHighDiscrepancy
    };

    return { pendingContracts, removedContracts, stats };
  }
}
