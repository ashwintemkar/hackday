import nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const isProduction = process.env.NODE_ENV === 'production';

const localTransporter = nodemailer.createTransport({
    host: 'localhost',
    port: 1025,
    ignoreTLS: true,
});

const sesClient = new SESClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
    },
});

// Add a list of verified sender emails to use
const VERIFIED_SENDER_EMAILS = [
    'support@nexagrid.ai',
    'nexagrid@nexagrid.ai',
    'noreply@nexagrid.ai'
];

export async function sendEmail({
    to,
    from = 'support@nexagrid.ai',
    subject,
    text,
    html,
    replyTo = 'noreply@nexagrid.ai',
}: {
    to: string;
    from?: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
}) {
    try {
        // Validating from address to ensure it's one of our verified addresses
        if (!from.endsWith('@nexagrid.ai') || !VERIFIED_SENDER_EMAILS.includes(from)) {
            console.warn(`Invalid 'from' address: ${from}. Using default support@nexagrid.ai instead.`);
            from = 'support@nexagrid.ai';
        }

        // checking whether replyTo is also from our domain or it's properly set
        if (!replyTo.endsWith('@nexagrid.ai')) {
            replyTo = 'noreply@nexagrid.ai';
        }

        if (isProduction) {
            // AWS SES in production
            const params = {
                Source: from,
                Destination: {
                    ToAddresses: Array.isArray(to) ? to : [to],
                },
                Message: {
                    Subject: {
                        Data: subject,
                        Charset: 'UTF-8',
                    },
                    Body: {
                        Text: {
                            Data: text,
                            Charset: 'UTF-8',
                        },
                        ...(html && {
                            Html: {
                                Data: html,
                                Charset: 'UTF-8',
                            },
                        }),
                    },
                },
                ReplyToAddresses: replyTo ? [replyTo] : undefined,
            };

            try {
                const command = new SendEmailCommand(params);
                const result = await sesClient.send(command);
                console.log(`Email sent to ${to} via AWS SES from ${from}`);
                return { success: true, messageId: result.MessageId };
            } catch (sesError) {
                console.error('SES Error:', sesError);
                console.error('Attempted to send from:', from);
                console.error('Attempted to send to:', to);

                // Try each verified email until one works
                for (const verifiedEmail of VERIFIED_SENDER_EMAILS) {
                    if (verifiedEmail !== from) {
                        try {
                            console.log(`Attempting to send with alternate email: ${verifiedEmail}...`);
                            const fallbackParams = {
                                ...params,
                                Source: verifiedEmail,
                            };
                            const fallbackCommand = new SendEmailCommand(fallbackParams);
                            const fallbackResult = await sesClient.send(fallbackCommand);
                            console.log(`Email sent to ${to} via AWS SES using fallback email ${verifiedEmail}`);
                            return { success: true, messageId: fallbackResult.MessageId };
                        } catch (fallbackError) {
                            console.error(`Failed with ${verifiedEmail} too:`, fallbackError);
                            // Continue to next verified email
                        }
                    }
                }

                // If we get here, all attempts failed
                throw new Error(`Failed to send email after trying all verified sender addresses`);
            }
        } else {
            // Send email using local transporter (mailhog) in development
            const mailOptions = {
                from,
                to,
                subject,
                text,
                html,
                replyTo,
            };

            const info = await localTransporter.sendMail(mailOptions);
            console.log(`Email sent to ${to} via local transporter:`, info.messageId);
            return { success: true, messageId: info.messageId };
        }
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error };
    }
}