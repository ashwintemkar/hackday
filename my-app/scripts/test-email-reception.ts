import axios from 'axios';

async function sendTestEmail() {
  try {
    const testEmail = {
      from: 'test@example.com',
      to: 'support@nexagrid.ai',
      subject: 'NEET PG Enquiry on Post-Graduate Training Objectives',
      text: 'Hello, how are the key post-graduate training objectives, like ethics and understanding of health determinants, implemented in the program?',
      html: '<p>Hello,</p><p>How are the key post-graduate training objectives, like ethics and understanding of health determinants, implemented in the program?</p>',
      date: new Date(),
    };

    console.log('Sending test email to webhook...');
    const response = await axios.post('http://localhost:3000/api/email-webhook', testEmail);

    console.log('Response:', response.data);
  } catch (error) {
    console.error('Error sending test email:', error);
  }
}

sendTestEmail();
