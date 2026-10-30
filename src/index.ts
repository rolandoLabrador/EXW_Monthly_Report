import * as configDotenv from 'dotenv';
import path from 'path';
import { DatabaseService } from './services/mongo.services.js';
import { ExcelService } from './services/excel.services.js';
import { EmailService } from './services/email.services.js';
import { PcmiService } from './services/pcmi.services.js';
import { transformContractData } from './utils/report.transformer.js';

configDotenv.config();

async function main(){
  // validate environment
  const requiredEnvVars = ['MONGO_URI','SENDGRID_API_KEY','RECEIVER_EMAIL','SENDER_EMAIL', 'CC_EMAIL'];
  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

  if(missingVars.length > 0){
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please set these variables in your .env file or environment before running the application.');
    process.exit(1);
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const fileName = `${year}-${month}-${day}.xlsx`; 
  const filePath = path.join(process.cwd(), fileName);

  const dbService = new DatabaseService();
  const excelService = new ExcelService();
  const emailService = new EmailService();

  try {
    console.log('Connecting to database and fetching contracts...');
    const contracts = await dbService.getContracts();
    
    console.log(`Found ${contracts.length} pending contracts in database.`);

    let finalContracts = contracts;
    let discrepancies: any[] = [];
    let pcmiStats: any = undefined;

    if (process.env.PCMI_CLIENT_ID && process.env.PCMI_CLIENT_SECRET) {
      const pcmiService = new PcmiService();
      const result = await pcmiService.filterPendingContracts(contracts);
      finalContracts = result.pendingContracts;
      discrepancies = result.removedContracts;
      pcmiStats = result.stats;
    }

    console.log(`Processing verified report data for ${finalContracts.length} contracts...`);
    const reportData = transformContractData(finalContracts);

    console.log(`Generating Excel report at ${filePath}...`);
    await excelService.generateReport(reportData, filePath, discrepancies, pcmiStats);

    console.log('Sending email...');
    await emailService.sendReport(filePath, process.env.RECEIVER_EMAIL!);

    await dbService.close();
    console.log('Process completed successfully!');
  } catch (error: any) {
    console.error('An error occurred during the process:', error);
    try {
        await emailService.sendError(error);
        await dbService.close();
    } catch (emailError) {
        console.error('Failed to send error email:', emailError);
        await dbService.close();
    }
  }
}

main();
