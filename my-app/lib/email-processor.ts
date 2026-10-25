import { prisma } from './prisma';
import { sendEmail } from './email-service';
import { queryChatAndAnswer } from './pgvector/query';

type EmailData = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: any[];
  messageId?: string;
  date?: Date;
};

async function isEmailAlreadyProcessed(messageId: string | null): Promise<boolean> {
  if (!messageId) return false;

  const existingEmail = await prisma.email.findFirst({
    where: {
      messageId: messageId,
      direction: 'INCOMING'
    }
  });

  return !!existingEmail;
}

export async function processIncomingEmail(emailData: EmailData) {
  try {
    if (emailData.messageId && await isEmailAlreadyProcessed(emailData.messageId)) {
      console.log(`Email with messageId ${emailData.messageId} already processed, skipping.`);
      return { success: true, alreadyProcessed: true };
    }

    console.log(`Processing email from ${emailData.from} with subject: ${emailData.subject}`);

    const incomingEmail = await prisma.email.create({
      data: {
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.text,
        htmlBody: emailData.html || null,
        messageId: emailData.messageId || null,
        receivedAt: emailData.date || new Date(),
        direction: 'INCOMING',
      },
    });

    const senderEmail = extractEmailAddress(emailData.from);
    if (!senderEmail) {
      console.error('Could not extract sender email address');
      return { success: false, error: 'Invalid sender email' };
    }

    const query = generateQueryFromEmail(emailData);

    const { response: ragResponse } = await queryChatAndAnswer({ query });

    const responseBody = formatEmailResponse({
      originalSubject: emailData.subject,
      originalBody: emailData.text,
      generatedResponse: ragResponse,
    });

    const replySubject = emailData.subject.startsWith('Re:')
      ? emailData.subject
      : `Re: ${emailData.subject}`;

    const emailResult = await sendEmail({
      from: 'support@nexagrid.ai',
      to: senderEmail,
      subject: replySubject,
      text: responseBody,
      replyTo: emailData.to,
    });

    if (emailResult.success) {
      await prisma.email.create({
        data: {
          from: emailData.to,
          to: senderEmail,
          subject: replySubject,
          body: responseBody,
          messageId: emailResult.messageId || null,
          sentAt: new Date(),
          direction: 'OUTGOING',
          inReplyToId: incomingEmail.id,
        },
      });

      return { success: true, emailId: incomingEmail.id };
    } else {
      console.error('Failed to send reply email:', emailResult.error);
      return { success: false, error: 'Failed to send reply' };
    }
  } catch (error) {
    console.error('Error processing incoming email:', error);
    return { success: false, error };
  }
}

function extractEmailAddress(from: string): string | null {
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<]+@[^\s>]+)/);
  return match ? match[1] : null;
}

/**
 * Generate a query for the RAG system based on email content
 */
function generateQueryFromEmail(emailData: EmailData): string {
  return `${emailData.subject}\n\n${emailData.text}`;
}

/**
 * Format the RAG response into a professional email response
 */
function formatEmailResponse({
  originalSubject,
  originalBody,
  generatedResponse,
}: {
  originalSubject: string;
  originalBody: string;
  generatedResponse: string;
}): string {
  return `Thank you for your inquiry about "${originalSubject}".

${generatedResponse}

If you have any further questions, please don't hesitate to ask.

Best regards,
Nexagrid Team
`;
}