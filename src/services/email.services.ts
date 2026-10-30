import sgMail from '@sendgrid/mail';
import fs from 'fs';
import path from 'path';

export class EmailService {

    constructor() {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
    }

    async sendReport(filePath: string, recipientEmail: string){
        const attachment = fs.readFileSync(filePath).toString("base64");
        const fileName = path.basename(filePath);

        const recipients = process.env.RECEIVER_EMAIL!.split(',');
        
        const msg: sgMail.MailDataRequired = {
            to: recipients,
            from: process.env.SENDER_EMAIL!,
            subject: 'Executive Warranties Pending Contract Report',
            text: `Hi,\n\nAttached is the list of pending Executive Warranties contracts up to today.\n\nThanks`,
            html: `<p>Hi,</p><p>Attached is the list of pending Executive Warranties contracts up to today.</p><p>Thanks</p>`,
            attachments: [{
                content: attachment,
                filename: fileName,
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                disposition: 'attachment',
            }],
        };

        if (process.env.CC_EMAIL) {
            msg.cc = process.env.CC_EMAIL.split(',');
        }
        
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
