import logger from './logger';
import { isSyncActive, addEntry, getEntries, clearEntries } from './syncEmailContext';
import { reviewRequestEmailTemplate } from './emailTemplates';

/**
 * Resolve the acting user's BU IDs and their highest role in those BUs.
 */
async function getActingUserBuInfo(actingUserId: number): Promise<{
  buIds: number[];
  roles: { businessUnitId: number; role: string }[];
  highestRole: 'admin' | 'editor' | 'viewer' | null;
}> {
  try {
    const actingUserBuRoles = await (strapi as any).db.query('api::user-bu-role.user-bu-role').findMany({
      where: { user: { id: actingUserId } },
      populate: ['businessUnit'],
    });

    const roles = (actingUserBuRoles || [])
      .map((r: any) => ({ businessUnitId: r.businessUnit?.id, role: r.role }))
      .filter((r: any) => r.businessUnitId != null);

    const buIds = [...new Set(roles.map((r: any) => r.businessUnitId))] as number[];

    let highestRole: 'admin' | 'editor' | 'viewer' | null = null;
    if (roles.some((r: any) => r.role === 'admin')) highestRole = 'admin';
    else if (roles.some((r: any) => r.role === 'editor')) highestRole = 'editor';
    else if (roles.some((r: any) => r.role === 'viewer')) highestRole = 'viewer';

    return { buIds, roles, highestRole };
  } catch (err: any) {
    logger.error(`Error resolving BU info for user ${actingUserId}: ${err.message}`);
    return { buIds: [], roles: [], highestRole: null };
  }
}

/**
 * Given the acting user's ID, find which BU(s) they belong to,
 * then find all admins for those BUs and return their emails.
 */
async function findBuAdminEmailsForUser(actingUserId: number): Promise<string[]> {
  const recipientEmails: string[] = [];

  try {
    const { buIds } = await getActingUserBuInfo(actingUserId);
    if (buIds.length === 0) return [];

    for (const buId of buIds) {
      const adminRoles = await (strapi as any).db.query('api::user-bu-role.user-bu-role').findMany({
        where: {
          businessUnit: buId,
          role: 'admin',
        },
        populate: ['user'],
      });

      for (const r of adminRoles || []) {
        const email = r.user?.email;
        if (email) {
          recipientEmails.push(email);
        }
      }
    }
  } catch (err: any) {
    logger.error(`Error finding BU admins for user ${actingUserId}: ${err.message}`);
  }

  return [...new Set(recipientEmails)];
}

/**
 * Given the acting user's ID, find which BU(s) they belong to,
 * then find all editors for those BUs and return their emails.
 */
async function findBuEditorEmailsForUser(actingUserId: number): Promise<string[]> {
  const recipientEmails: string[] = [];

  try {
    const { buIds } = await getActingUserBuInfo(actingUserId);
    if (buIds.length === 0) return [];

    for (const buId of buIds) {
      const editorRoles = await (strapi as any).db.query('api::user-bu-role.user-bu-role').findMany({
        where: {
          businessUnit: buId,
          role: 'editor',
        },
        populate: ['user'],
      });

      for (const r of editorRoles || []) {
        const email = r.user?.email;
        if (email) {
          recipientEmails.push(email);
        }
      }
    }
  } catch (err: any) {
    logger.error(`Error finding BU editors for user ${actingUserId}: ${err.message}`);
  }

  return [...new Set(recipientEmails)];
}

/**
 * Fallback: find all Super Admins if no BU admins were found.
 */
async function findSuperAdminEmails(): Promise<string[]> {
  try {
    const superAdmins = await (strapi as any).db.query('admin::user').findMany({
      where: { isActive: true },
      populate: ['roles'],
    });

    return superAdmins
      .filter((u: any) => u.roles?.some((r: any) => r.code === 'strapi-super-admin'))
      .map((u: any) => u.email)
      .filter((email: string) => !!email);
  } catch (err: any) {
    logger.error(`Error querying Super Admins: ${err.message}`);
    return [];
  }
}

const ADMIN_TO_EDITOR_ACTIONS = ['Published', 'Deleted', 'Discarded'];

/**
 * Core notification function. Called from the content-manager controller extension
 * so we have access to the acting user (ctx.state.user).
 *
 * Routing logic:
 *  - If the acting user is a BU **admin** AND the action is Publish/Delete/Discard
 *    → notify the **editors** in the same BU(s).
 *  - Otherwise (editor performing create/update etc.)
 *    → notify the **admins** in the same BU(s) (original behaviour).
 *
 * @param contentType - e.g. 'document'
 * @param actionLabel - 'Created' | 'Updated' | 'Published' | 'Unpublished' | 'Discarded' | 'Deleted'
 * @param result      - The Strapi document result object
 * @param actingUser  - The admin user who performed the action { id, firstname, lastname, email }
 */
export async function notifyBuAdminOnAction(
  contentType: string,
  actionLabel: string,
  result: any,
  actingUser: { id: number; firstname?: string; lastname?: string; email?: string }
) {
  const title =
    result.title ||
    result.displayName ||
    result.name ||
    result.fileName?.replace(/\.[^/.]+$/, '') ||
    contentType;

  const docId = result.documentId || result.id;
  const actingUserName = [actingUser.firstname, actingUser.lastname].filter(Boolean).join(' ') || 'Unknown';
  const actingUserEmail = actingUser.email || 'unknown';

  logger.info(`Processing notification: ${contentType} ${actionLabel} by ${actingUserName}`);

  const adminUrl =
    `${process.env.STRAPI_ADMIN_URL || 'http://localhost:1337'}/admin/content-manager/collection-types/api::${contentType}.${contentType}/${docId}`;

  if (isSyncActive()) {
    addEntry({
      contentType,
      title,
      adminUrl,
      action: actionLabel as any,
    });
    return;
  }

  const { highestRole } = await getActingUserBuInfo(actingUser.id);
  const isAdminAction = highestRole === 'admin' && ADMIN_TO_EDITOR_ACTIONS.includes(actionLabel);

  let recipientEmails: string[];

  if (isAdminAction) {
    recipientEmails = await findBuEditorEmailsForUser(actingUser.id);
    logger.info(`Admin action "${actionLabel}" — notifying BU editors: ${recipientEmails.join(', ') || '(none)'}`);
  } else {
    recipientEmails = await findBuAdminEmailsForUser(actingUser.id);
    logger.info(`Editor/other action "${actionLabel}" — notifying BU admins: ${recipientEmails.join(', ') || '(none)'}`);
  }

  if (recipientEmails.length === 0) {
    recipientEmails = await findSuperAdminEmails();
  }

  recipientEmails = recipientEmails.filter(email => email !== actingUser.email);

  if (recipientEmails.length === 0) {
    return;
  }

  const roleLabel = isAdminAction ? 'Admin' : 'Editor';

  const defaultFrom = process.env.SMTP_USERNAME || '';
  const senderFrom = isAdminAction && actingUserEmail !== 'unknown'
    ? `"${actingUserName}" <${defaultFrom}>`
    : undefined;
  const senderReplyTo = isAdminAction && actingUserEmail !== 'unknown'
    ? actingUserEmail
    : undefined;

  for (const email of recipientEmails) {
    try {
      await strapi.plugin('email').service('email').send({
        to: email,
        ...(senderFrom && { from: senderFrom }),
        ...(senderReplyTo && { replyTo: senderReplyTo }),
        subject: `[Notification] Document ${actionLabel}: ${title}`,
        html: `
          <div style="font-family: sans-serif; color: #333; padding: 20px; border: 1px solid #eee; max-width: 600px;">
            <h3 style="color: #E20074;">Content ${actionLabel} Alert</h3>
            <p>Hello,</p>
            <p>
              A <strong>${contentType}</strong> titled <strong>"${title}"</strong>
              has been <strong>${actionLabel.toLowerCase()}</strong> by
              ${roleLabel} <strong>${actingUserName}</strong> (${actingUserEmail}).
            </p>
            <p style="margin-top: 20px;">
              <a href="${adminUrl}" style="background-color: #E20074; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                View in Admin Panel
              </a>
            </p>
            <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #999;">
              Action: ${actionLabel} | By: ${roleLabel} ${actingUserName} (${actingUserEmail})
            </p>
          </div>
        `,
      });
      logger.info(`Notification email sent to: ${email} (from: ${senderFrom || 'default'}, replyTo: ${senderReplyTo || 'default'})`);
    } catch (err: any) {
      logger.error(`Failed to send email to ${email}: ${err.message}`);
    }
  }
}

export async function sendConsolidatedReviewEmail() {
  const entries = getEntries();
  if (!entries.length) return;

  const htmlTable = `
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:12px; font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th align="left" style="padding:8px; border:1px solid #ddd;">Action</th>
      <th align="left" style="padding:8px; border:1px solid #ddd;">Title</th>
      <th align="left" style="padding:8px; border:1px solid #ddd;">Link</th>
    </tr>
  </thead>
  <tbody>
    ${entries.map(e => `
      <tr>
        <td style="padding:8px; border:1px solid #ddd;">${e.action}</td>
        <td style="padding:8px; border:1px solid #ddd;">${e.title}</td>
        <td style="padding:8px; border:1px solid #ddd;">
          <a href="${e.adminUrl}"  style="color:#E20074;" target="_blank">View in Admin</a>
        </td>
      </tr>
    `).join('')}
  </tbody>
</table>
`;

  const html = reviewRequestEmailTemplate({
    contentType: 'Multiple content types',
    title: `${entries.length} content updates`,
    editorName: '',
    editorEmail: 'system',
    adminUrl: entries[0].adminUrl,
    byLabel: 'Updated by',
  }).replace('{{CONTENT_TABLE}}', htmlTable);

  await strapi.plugin('email').service('email').send({
    to: ['tanmay@rhombuz.io', 'inder@rhombuz.io'],
    subject: `[Review Required] ${entries.length} content updates`,
    html,
  });

  clearEntries();
}
