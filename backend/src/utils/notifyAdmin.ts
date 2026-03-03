import logger from './logger';
import { isSyncActive, addEntry, getEntries, clearEntries } from './syncEmailContext';
import { reviewRequestEmailTemplate } from './emailTemplates';

export async function notifyAdminOnSave(
  contentType: string,
  event: any
) {
  const { result, action } = event;

  // Skip if published and updated (pattern from BOC snippet)
  if (result?.publishedAt && action === 'update') return;

  const isCreate =
    action === 'create' ||
    result?.createdAt === result?.updatedAt;

  const title =
    result.title ||
    result.displayName ||
    result.name ||
    result.fileName?.replace(/\.[^/.]+$/, '') ||
    contentType;

  const docId = result.documentId || result.id;

  // RAW CONSOLE LOG TO BYPASS LOGGER WRAPPER JUST IN CASE
  console.log(`>>> PROCESSING NOTIFICATION: ${contentType} - ${title} (Action: ${action})`);
  console.log(`>>> docId used: ${docId}, isCreate: ${isCreate}`);

  const adminUrl =
    `${process.env.STRAPI_ADMIN_URL || 'http://localhost:1337'}/admin/content-manager/collection-types/api::${contentType}.${contentType}/${docId}`;

  if (isSyncActive()) {
    addEntry({
      contentType,
      title,
      adminUrl,
      action: isCreate ? 'Created' : 'Updated',
    });
    return;
  }

  // Send immediate mail for manual creates
  if (isCreate) {
    console.log(`>>> ATTEMPTING TARGETED NOTIFICATION FOR: ${title}`);

    let ownerBuId: number | null = null;

    try {
      const uid = `api::${contentType}.${contentType}`;

      // Use db.query for more direct access in lifecycles, often more reliable for relations
      const docs = await (strapi as any).db.query(uid).findMany({
        where: {
          $or: [
            { documentId: docId },
            { id: docId }
          ]
        },
        populate: ['ownerBu'],
      });

      const doc = docs && docs[0];

      console.log(`>>> RE-FETCHED DOC DATA: ${JSON.stringify(doc)}`);

      ownerBuId = doc?.ownerBu?.id || null;
      console.log(`>>> RESOLVED ownerBuId: ${ownerBuId}`);
    } catch (err) {
      console.error(`>>> ERROR RE-FETCHING DOC: ${err.message}`);
    }

    await sendImmediateAdminEmail(contentType, title, adminUrl, ownerBuId);
  }
}

async function sendImmediateAdminEmail(contentType: string, title: string, adminUrl: string, ownerBuId: number | null) {
  console.log(`>>> ANALYZING RECIPIENTS. Requested BU: ${ownerBuId}`);

  let recipientEmails: string[] = [];

  // 1. Try to find Admins for the specific Business Unit using user-bu-role
  if (ownerBuId) {
    try {
      const buRoles = await (strapi as any).db.query('api::user-bu-role.user-bu-role').findMany({
        where: {
          businessUnit: ownerBuId,
          role: 'admin'
        },
        populate: ['user']
      });

      console.log(`>>> BU ROLES QUERY RESULT: ${JSON.stringify(buRoles)}`);

      recipientEmails = buRoles
        .map((r: any) => {
          const email = r.user?.email;
          console.log(`>>> TARGET CANDIDATE: ${email} (Role: ${r.role})`);
          return email;
        })
        .filter((email: string) => !!email);
    } catch (err) {
      console.error(`>>> ERROR QUERYING BU ROLES: ${err.message}`);
    }
  }

  // 2. Fallback: If no BU admins found, notify Super Admins
  if (recipientEmails.length === 0) {
    console.log(`>>> NO BU ADMINS FOUND. Falling back to Super Admins.`);
    try {
      const superAdmins = await (strapi as any).db.query('admin::user').findMany({
        where: { isActive: true },
        populate: ['roles']
      });

      recipientEmails = superAdmins
        .filter((u: any) => u.roles?.some((r: any) => r.code === 'strapi-super-admin'))
        .map((u: any) => u.email)
        .filter((email: string) => !!email);

      console.log(`>>> SUPER ADMINS FOUND: ${recipientEmails.join(', ')}`);
    } catch (err) {
      console.error(`>>> ERROR QUERYING SUPER ADMINS: ${err.message}`);
    }
  }

  const finalRecipients = [...new Set(recipientEmails)];

  if (finalRecipients.length === 0) {
    console.warn('>>> NO RECIPIENTS FOUND - EXITING');
    return;
  }

  for (const email of finalRecipients) {
    try {
      console.log(`>>> SENDING EMAIL TO: ${email}`);
      await strapi.plugin('email').service('email').send({
        to: email,
        subject: `[Notification] New ${contentType} Created: ${title}`,
        html: `
                    <div style="font-family: sans-serif; color: #333; padding: 20px; border: 1px solid #eee;">
                        <h3 style="color: #E20074;">New Content Alert</h3>
                        <p>Hello,</p>
                        <p>A new <strong>${contentType}</strong> titled <strong>"${title}"</strong> has been created in your Business Unit.</p>
                        <p style="margin-top: 20px;">
                            <a href="${adminUrl}" style="background-color: #E20074; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View in Admin Panel</a>
                        </p>
                        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
                        <p style="font-size: 12px; color: #999;">Automated notification for manual entry.</p>
                    </div>
                `,
      });
      console.log(`>>> EMAIL SENT SUCCESS TO: ${email}`);
    } catch (err) {
      console.error(`>>> FAILED TO SEND EMAIL TO ${email}: ${err.message}`);
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
