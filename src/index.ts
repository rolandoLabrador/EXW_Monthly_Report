import * as configDotenv from 'dotenv';
import path from 'path';
import { DatabaseService } from './services/mongo.services.js';
import { ExcelService } from './services/excel.services.js';
import { EmailService } from './services/email.services.js';
import { transformContractData } from './utils/report.transformer.js';

configDotenv.config();

async function main(){
  // validate enviroment
  const requiredEnvVars= ['MONGO_URI','SENDGRID_API_KEY','RECEIVER_EMAIL','SENDER_EMAIL'];
  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

 if(missingVars.length>0){
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please set these variables in your .env file or environment before running the application.');
    process.exit(1);
 }
  console.log("TESTING ENV LOAD: ", process.env.FTP_HOST);

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
    
    console.log(`Found ${contracts.length} pending contracts. Processing data...`);
    const reportData = transformContractData(contracts);

    console.log(`Generating Excel report at ${filePath}...`);
    await excelService.generateReport(reportData, filePath);

    console.log('Sending email...');
    await emailService.sendReport(filePath, process.env.RECEIVER_EMAIL!);

    console.log('Process completed successfully!');
  } catch (error: any) {
    console.error('An error occurred during the process:', error);
    try {
        await emailService.sendError(error);
    } catch (emailError) {
        console.error('Failed to send error email:', emailError);
    }
  } finally {
    await dbService.close();
  }
}

main();