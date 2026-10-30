export interface PcmiContractStatus {
  code: string;
  description: string;
}

export interface PcmiVerificationStats {
  totalChecked: number;
  stillPendingCount: number;
  discrepancyCount: number;
  discrepancyRatePct: number;
  stillPendingCost: number;
  removedCost: number;
  byStatus: {
    active: number;
    cancelled: number;
    other: number;
  };
}

export interface PcmiVerificationResult {
  pendingContracts: any[];
  removedContracts: any[];
  stats: PcmiVerificationStats;
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
   * Retrieves or refreshes the OAuth2 Bearer token from PCMI STS.
   */
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

  /**
   * Queries PCMI for the live status of an individual contract.
   */
  public async getContractStatus(contractNumber: string): Promise<PcmiContractStatus | null> {
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
        return data.contracts[0].status || null;
      }
      return null;
    } catch (err: any) {
      console.warn(`Error querying PCMI status for contract ${contractNumber}:`, err.message);
      return null;
    }
  }

  /**
   * Checks all contracts against PCMI using a controlled concurrency pool.
   * Only keeps contracts that are verified as 'P' (Pending) in PCMI.
   * Discrepancies (Active, Cancelled, Void) are moved to removedContracts.
   */
  public async filterPendingContracts(
    contracts: any[],
    concurrency: number = 12
  ): Promise<PcmiVerificationResult> {
    console.log(`Starting PCMI live status verification for ${contracts.length} contracts (concurrency: ${concurrency})...`);
    
    const pendingContracts: any[] = [];
    const removedContracts: any[] = [];
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
        const netCost = Number(contract.metadata?.NetCost) || 0;

        if (!contractNumber) {
          pendingContracts.push(contract);
          stillPendingCost += netCost;
          completed++;
          continue;
        }

        const status = await this.getContractStatus(contractNumber);

        if (!status) {
          pendingContracts.push(contract);
          stillPendingCost += netCost;
        } else if (status.code?.toUpperCase() === 'P' || status.description?.toUpperCase() === 'PENDING') {
          pendingContracts.push(contract);
          stillPendingCost += netCost;
        } else {
          removedContracts.push({
            contract,
            contractNumber,
            pcmiStatus: status
          });
          removedCost += netCost;

          const code = status.code?.toUpperCase();
          if (code === 'A' || status.description?.toUpperCase().includes('ACTIVE')) {
            byStatus.active++;
          } else if (code === 'C' || code === 'V' || status.description?.toUpperCase().includes('CANCEL') || status.description?.toUpperCase().includes('VOID')) {
            byStatus.cancelled++;
          } else {
            byStatus.other++;
          }
        }

        completed++;
        if (completed % 100 === 0 || completed === total) {
          console.log(`PCMI Verification Progress: ${completed}/${total} checked (${removedContracts.length} discrepancies found)`);
        }
      }
    });

    await Promise.all(workers);

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const discrepancyCount = removedContracts.length;
    const discrepancyRatePct = total > 0 ? Number(((discrepancyCount / total) * 100).toFixed(2)) : 0;

    console.log(`\n================= PCMI VERIFICATION SUMMARY =================`);
    console.log(`Execution Time: ${elapsedSeconds}s`);
    console.log(`Total Contracts Scanned: ${total}`);
    console.log(`Verified Still Pending: ${pendingContracts.length} ($${stillPendingCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    console.log(`Discrepancies Removed: ${discrepancyCount} ($${removedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    console.log(`Discrepancy Rate: ${discrepancyRatePct}%`);
    console.log(`  - Active in PCMI: ${byStatus.active}`);
    console.log(`  - Cancelled/Void in PCMI: ${byStatus.cancelled}`);
    console.log(`  - Other Statuses: ${byStatus.other}`);
    console.log(`=============================================================\n`);

    const stats: PcmiVerificationStats = {
      totalChecked: total,
      stillPendingCount: pendingContracts.length,
      discrepancyCount,
      discrepancyRatePct,
      stillPendingCost,
      removedCost,
      byStatus
    };

    return { pendingContracts, removedContracts, stats };
  }
}

