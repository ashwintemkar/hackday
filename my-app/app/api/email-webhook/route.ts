// app/api/email-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { processIncomingEmail } from '@/lib/email-processor';
import axios from 'axios';

export async function POST(req: NextRequest) {
    try {
        const data = await req.json();
        console.log('Received webhook data:', JSON.stringify(data).substring(0, 500) + '...');

        if (data.Type === 'SubscriptionConfirmation') {
            console.log('Received subscription confirmation request');

            const subscribeUrl = data.SubscribeURL;
            if (subscribeUrl) {
                try {
                    const response = await axios.get(subscribeUrl);
                    console.log('Subscription confirmed successfully:', response.status);
                    return NextResponse.json({ success: true, message: 'Subscription confirmed' });
                } catch (error) {
                    console.error('Failed to confirm subscription:', error);
                    return NextResponse.json({ error: 'Failed to confirm subscription' }, { status: 500 });
                }
            } else {
                console.error('No SubscribeURL found in the request');
                return NextResponse.json({ error: 'No SubscribeURL found' }, { status: 400 });
            }
        }

        if (data.Type === 'Notification') {
            console.log('Processing SNS notification');
            try {
                const messageData = JSON.parse(data.Message);
                console.log('Message data type:', messageData.notificationType);

                if (messageData.notificationType === 'Received') {
                    const email = messageData.mail;
                    const content = messageData.content || {};

                    const emailData = {
                        from: email.source,
                        to: email.destination[0],
                        subject: email.commonHeaders.subject || 'No Subject',
                        text: content.text || '',
                        html: content.html || '',
                        messageId: email.messageId,
                        date: new Date(email.timestamp),
                    };

                    console.log(`Processing email from ${emailData.from} to ${emailData.to}`);
                    const result = await processIncomingEmail(emailData);

                    if (result.success) {
                        if (result.alreadyProcessed) {
                            return NextResponse.json({ success: true, message: 'Email already processed' });
                        }
                        return NextResponse.json({ success: true, emailId: result.emailId });
                    } else {
                        return NextResponse.json(
                            { error: result.error || 'Failed to process email' },
                            { status: 500 }
                        );
                    }
                }
            } catch (parseError) {
                console.error('Error parsing SNS message:', parseError);
                return NextResponse.json({ error: 'Invalid SNS message format' }, { status: 400 });
            }
        }

        if (data.from && data.to && data.subject) {
            const result = await processIncomingEmail({
                from: data.from,
                to: data.to,
                subject: data.subject,
                text: data.text || '',
                html: data.html || '',
                messageId: data.messageId,
                date: data.date ? new Date(data.date) : new Date(),
            });

            if (result.success) {
                if (result.alreadyProcessed) {
                    return NextResponse.json({ success: true, message: 'Email already processed' });
                }
                return NextResponse.json({ success: true, emailId: result.emailId });
            } else {
                return NextResponse.json(
                    { error: result.error || 'Failed to process email' },
                    { status: 500 }
                );
            }
        }

        return NextResponse.json({ error: 'Invalid request format' }, { status: 400 });
    } catch (error) {
        console.error('Error processing webhook:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}