import sgMail from '@sendgrid/mail';
import fs from 'fs';
import path from 'path';
import type { PcmiVerificationStats } from './pcmi.services.js';

export interface EmailSummaryDetails {
  pcmiStats?: PcmiVerificationStats;
}

export class EmailService {
  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  }

  async sendReport(filePath: string, recipientEmail: string, details?: EmailSummaryDetails) {
    const attachment = fs.readFileSync(filePath).toString('base64');
    const fileName = path.basename(filePath);

    const isHighDiscrepancy = Boolean(details?.pcmiStats?.isHighDiscrepancy);
    let recipients: string[];

    if (isHighDiscrepancy && (process.env.DISCREPANCY_RECEIVER_EMAIL || process.env.DISCREPANCY_EMAIL || process.env.DISCREPANCY_ALERT_EMAIL)) {
      const discrepancyEmailConfig = process.env.DISCREPANCY_RECEIVER_EMAIL || process.env.DISCREPANCY_EMAIL || process.env.DISCREPANCY_ALERT_EMAIL!;
      recipients = discrepancyEmailConfig.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`[EMAIL ROUTING] Discrepancy rate (${details?.pcmiStats?.discrepancyRatePct}%) exceeds 2%. Routing report to DISCREPANCY_RECEIVER_EMAIL: ${recipients.join(', ')}`);
    } else {
      if (isHighDiscrepancy) {
        console.warn(`[EMAIL ROUTING] Discrepancy rate (${details?.pcmiStats?.discrepancyRatePct}%) exceeds 2%, but DISCREPANCY_RECEIVER_EMAIL is not configured in .env. Falling back to RECEIVER_EMAIL.`);
      }
      recipients = (recipientEmail || process.env.RECEIVER_EMAIL!).split(',').map(s => s.trim()).filter(Boolean);
    }

    let ccRecipients: string[] = [];
    if (isHighDiscrepancy && process.env.DISCREPANCY_CC_EMAIL) {
      ccRecipients = process.env.DISCREPANCY_CC_EMAIL.split(',').map(s => s.trim()).filter(Boolean);
    } else if (process.env.CC_EMAIL) {
      ccRecipients = process.env.CC_EMAIL.split(',').map(s => s.trim()).filter(Boolean);
    }

    const emailSubject = isHighDiscrepancy
      ? `⚠️ High Discrepancy (${details?.pcmiStats?.discrepancyRatePct}%): EXW Monthly Pending Report`
      : 'EXW Monthly Pending Report';

    let summaryHtml = '';
    if (details?.pcmiStats) {
      const alertBanner = isHighDiscrepancy
        ? `<div style="background-color: #ffeef0; border: 1px solid #f5c2c7; border-radius: 4px; padding: 10px; margin-bottom: 12px; color: #842029;">
             <strong>⚠️ High Discrepancy Notice:</strong> Discrepancy rate is <strong>${details.pcmiStats.discrepancyRatePct}%</strong> (exceeds 2.0% threshold). This report has been routed to the designated review team.
           </div>`
        : '';

      summaryHtml = `<div style="background-color: #f8f9fa; border-left: 4px solid #00B0F0; padding: 12px; margin: 16px 0; font-family: sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #333;">Pipeline & Verification Summary</h4>
        ${alertBanner}
        <ul style="margin: 6px 0; padding-left: 20px; font-size: 13px; color: #444;">
          <li>Total Contracts Scanned: <strong>${details.pcmiStats.totalChecked}</strong></li>
          <li>Verified Still Pending: <strong>${details.pcmiStats.stillPendingCount}</strong> ($${details.pcmiStats.stillPendingCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})</li>
          <li>Status Discrepancies Removed: <strong style="color: #c00;">${details.pcmiStats.statusDiscrepancyCount}</strong> ($${details.pcmiStats.removedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})</li>
          <li>Dealer Cost Differences (API Applied & Highlighted): <strong style="color: #6f42c1;">${details.pcmiStats.costDiscrepancyCount}</strong></li>
          <li>Overall Discrepancy Rate: <strong>${details.pcmiStats.discrepancyRatePct}%</strong> (Cost Rate: ${details.pcmiStats.costDiscrepancyRatePct}%)</li>
        </ul>
      </div>`;
    }

    const msg: any = {
      to: recipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      from: process.env.SENDER_EMAIL!,
      subject: emailSubject,
      text: `Hi,\n\nAttached is the EXW Monthly Pending Report up to today.\n\nThanks`,
      html: `<p>Hi,</p><p>Attached is the EXW Monthly Pending Report up to today.</p>${summaryHtml}<p>Thanks</p>`,
      attachments: [{
        content: attachment,
        filename: fileName,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment',
      }],
    };

    await sgMail.sendMultiple(msg);
  }

  async sendError(error: any) {
    const recipients = process.env.RECEIVER_EMAIL!.split(',');

    const msg = {
      to: recipients,
      from: process.env.SENDER_EMAIL!,
      subject: `ERROR: Contract Export Failed`,
      text: `The automated export failed. Please check the logs.\n\nError: ${error.message}`,
    };

    await sgMail.sendMultiple(msg);
  }
}
