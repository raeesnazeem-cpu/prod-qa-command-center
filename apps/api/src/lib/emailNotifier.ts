import { logger } from './logger';

/**
 * Sends an email using Resend API.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    logger.warn('RESEND_API_KEY not configured. Email not sent.');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'QA Command Center <onboarding@resend.dev>', // Default Resend test domain
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Resend API error: ${JSON.stringify(errorData)}`);
    }
  } catch (error: any) {
    logger.error({ error: error.message, to, subject }, 'Failed to send email via Resend');
    // We don't necessarily want to crash the whole request if email fails
  }
}

/**
 * Sends an email when a task is assigned to a user.
 */
export async function emailTaskAssigned(user: any, task: any, projectName: string): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const taskUrl = `${frontendUrl}/projects/${task.project_id}/tasks/${task.id}`;

  const subject = `New Task Assigned: ${task.title}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #1e293b; margin-top: 0;">Hi ${user.full_name},</h2>
      <p style="color: #475569; line-height: 1.5;">
        You have been assigned a new task in <strong>${projectName}</strong>.
      </p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; font-weight: bold; color: #0f172a;">${task.title}</p>
        <p style="margin: 10px 0 0 0; color: #64748b; font-size: 14px;">Severity: ${task.severity.toUpperCase()}</p>
      </div>
      <a href="${taskUrl}" style="display: inline-block; background-color: #93c0b1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Task</a>
      <p style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
        Sent via QA Command Center
      </p>
    </div>
  `;

  await sendEmail(user.email, subject, html);
}

/**
 * Sends an email when an AI verdict is delivered for a rebuttal.
 */
export async function emailRebuttalVerdict(user: any, task: any, verdict: string): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const taskUrl = `${frontendUrl}/projects/${task.project_id}/tasks/${task.id}`;

  const subject = `Rebuttal Verdict: ${task.title}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #1e293b; margin-top: 0;">Hi ${user.full_name},</h2>
      <p style="color: #475569; line-height: 1.5;">
        An AI verdict has been delivered for your rebuttal on task: <strong>${task.title}</strong>.
      </p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; font-weight: bold; color: #0f172a;">Verdict: ${verdict}</p>
      </div>
      <a href="${taskUrl}" style="display: inline-block; background-color: #93c0b1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Details</a>
      <p style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
        Sent via QA Command Center
      </p>
    </div>
  `;

  await sendEmail(user.email, subject, html);
}

/**
 * Sends an email when a QA run report is ready.
 */
export async function emailRunReportReady(user: any, run: any, reportUrl: string): Promise<void> {
  const subject = `QA Run Report Ready: ${run.run_type.replace('_', ' ').toUpperCase()}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #1e293b; margin-top: 0;">Hi ${user.full_name},</h2>
      <p style="color: #475569; line-height: 1.5;">
        The QA report for your recent run is now ready for review.
      </p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; color: #64748b; font-size: 14px;">Type: ${run.run_type.replace('_', ' ').toUpperCase()}</p>
        <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">Completed: ${new Date().toLocaleDateString()}</p>
      </div>
      <a href="${reportUrl}" style="display: inline-block; background-color: #93c0b1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">Download Report</a>
      <p style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
        Sent via QA Command Center
      </p>
    </div>
  `;

  await sendEmail(user.email, subject, html);
}
