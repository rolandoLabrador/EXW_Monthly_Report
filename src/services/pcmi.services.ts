import type { MongoContract, PcmiDiscrepancy, CostDiscrepancyItem } from '../models/report.types.js';

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
  pendingContracts: MongoContract[];
  removedContracts: PcmiDiscrepancy[];
  stats: PcmiVerificationStats;
}

export interface PcmiContractApiResponse {
  status?: PcmiContractStatus;
  dealerCost?: {
    amount?: number | string;
    amountWithTax?: number | string;
    tax?: {
      taxAmount1?: number | string;
      taxAmount2?: number | string;
    };
  } | number;
  [key: string]: unknown;
}

/**
 * Calculates Database Dealer Cost by summing all values across all categories in the `WrittenAmount` section
 * (e.g. ADMIN + COMMISSION + RESERVE items).
 * If `WrittenAmount` is missing or empty, safely falls back to `metadata.NetCost` or `metadata.SubmittedAmount`.
 */
export function calculateDbDealerCost(contract: MongoContract): number {
  const writtenAmount = contract.WrittenAmount ?? contract.metadata?.WrittenAmount;
  if (writtenAmount && typeof writtenAmount === 'object') {
    let sum = 0;
    let found = false;

    const traverse = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return;
      const record = obj as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const val = record[key];
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
          const subRecord = val as Record<string, unknown>;
          if ('value' in subRecord && !isNaN(Number(subRecord.value))) {
            sum += Number(subRecord.value);
            found = true;
          } else if (typeof (subRecord as { toNumber?: () => number }).toNumber === 'function') {
            sum += (subRecord as { toNumber: () => number }).toNumber();
            found = true;
          } else if (typeof subRecord.toString === 'function' && !isNaN(Number(subRecord.toString()))) {
            sum += Number(subRecord.toString());
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
  const netCost = Number(contract.metadata?.NetCost);
  if (!isNaN(netCost) && netCost > 0) {
    return Number(netCost.toFixed(2));
  }
  const submittedAmount = Number(contract.metadata?.SubmittedAmount);
  if (!isNaN(submittedAmount) && submittedAmount > 0) {
    return Number(submittedAmount.toFixed(2));
  }
  return 0;
}

/**
 * Extracts Dealer Cost from PCMI GetContracts API response.
 * Prefers `dealerCost.amountWithTax`, with fallback to `dealerCost.amount`.
 */
export function extractApiDealerCost(contractData: PcmiContractApiResponse | null | undefined): number | null {
  if (!contractData || contractData.dealerCost === undefined || contractData.dealerCost === null) return null;
  const dc = contractData.dealerCost;
  if (typeof dc === 'number' && !isNaN(dc)) return Number(dc.toFixed(2));
  if (typeof dc === 'object') {
    if (dc.amountWithTax !== undefined && dc.amountWithTax !== null) {
      const val = Number(dc.amountWithTax);
      return isNaN(val) ? null : Number(val.toFixed(2));
    }
    if (dc.amount !== undefined && dc.amount !== null) {
      const val = Number(dc.amount);
      return isNaN(val) ? null : Number(val.toFixed(2));
    }
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

  /**
   * Retrieves or refreshes the OAuth2 Bearer token from PCMI STS with retry support.
   */
  private async getAccessToken(maxRetries: number = 1): Promise<string> {
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

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to obtain PCMI access token (${response.status} ${response.statusText}): ${errorText}`);
        }

        const data = (await response.json()) as { access_token: string; expires_in?: number | string };
        this.accessToken = data.access_token;
        const expiresInMs = (Number(data.expires_in) || 1800) * 1000;
        this.tokenExpiresAt = now + expiresInMs;

        return this.accessToken!;
      } catch (err: unknown) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }

    throw new Error('Could not obtain PCMI access token after retries.');
  }

  /**
   * Queries PCMI for live contract information including status and dealerCost.
   */
  public async getContractInfo(contractNumber: string, maxRetries: number = 1): Promise<PcmiContractInfo | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const token = await this.getAccessToken();
        const url = `${this.baseUrl}/api/v2/contracts/GetContracts?contractNumber=${encodeURIComponent(contractNumber)}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Connection': 'close'
          },
          signal: AbortSignal.timeout(6000)
        });

        if (response.status === 401 && attempt < maxRetries) {
          this.accessToken = null;
          continue;
        }

        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        if (!response.ok) {
          console.warn(`PCMI API returned ${response.status} for contract ${contractNumber}`);
          return null;
        }

        const data = (await response.json()) as { contracts?: Array<PcmiContractApiResponse> };
        if (data.contracts && data.contracts.length > 0) {
          const c = data.contracts[0];
          if (c) {
            return {
              status: c.status || null,
              dealerCost: extractApiDealerCost(c)
            };
          }
        }
        return null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          console.warn(`PCMI request error for contract ${contractNumber} (${msg}); retrying (attempt ${attempt + 2}/${maxRetries + 1})...`);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        console.warn(`PCMI request error for contract ${contractNumber} after ${maxRetries + 1} attempts (${msg}); defaulting to pending.`);
        return null;
      }
    }

    return null;
  }

  /**
   * Queries PCMI for the live status of an individual contract.
   */
  public async getContractStatus(contractNumber: string, maxRetries: number = 1): Promise<PcmiContractStatus | null> {
    const info = await this.getContractInfo(contractNumber, maxRetries);
    return info?.status || null;
  }

  /**
   * Checks all contracts against PCMI using a controlled concurrency pool.
   * 1. Only keeps contracts that are verified as 'P' (Pending) in PCMI.
   * 2. Compares Database Dealer Cost (sum of WrittenAmount) with PCMI API Dealer Cost.
   *    If a difference is found, adopts the API value and flags it for Excel highlighting.
   * 3. Calculates discrepancy metrics and flags if discrepancy exceeds 2%.
   */
  public async filterPendingContracts(
    contracts: MongoContract[],
    concurrency: number = 8
  ): Promise<PcmiVerificationResult> {
    console.log(`Starting PCMI live status verification for ${contracts.length} contracts (concurrency: ${concurrency})...`);

    try {
      await this.getAccessToken();
      console.log('PCMI authentication verified.');
    } catch (authErr) {
      console.warn('Failed to pre-authenticate with PCMI STS, workers will retry:', authErr);
    }

    const pendingContracts: MongoContract[] = [];
    const removedContracts: PcmiDiscrepancy[] = [];
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
        const contractNumber = String(contract.metadata?.['Contract#'] || contract.metadata?.ContractNumber || '');
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
          // Still pending in PCMI. Compare Dealer Cost!
          const apiCost = info.dealerCost;
          const hasCostDiff = apiCost !== null && Math.abs(dbCost - apiCost) > 0.01;

          if (hasCostDiff) {
            contract.effectiveCost = apiCost!;
            contract.hasCostDiscrepancy = true;
            contract.dbDealerCost = dbCost;
            contract.apiDealerCost = apiCost!;

            costDiscrepancyList.push({
              contractNumber,
              dealershipName: String(contract.metadata?.DealerName || ''),
              saleDate: String(contract.metadata?.SaleDate || contract.metadata?.EntryDate || ''),
              coverageName: String(contract.metadata?.CoverageName || ''),
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
            apiCost: info.dealerCost ?? undefined
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
        if (completed % 10 === 0 || completed === total) {
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
