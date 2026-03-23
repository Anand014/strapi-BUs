export type ContentItemNotificationData = {
  actionLabel: string;
  title: string;
  adminUrl: string;
  roleLabel: 'Admin' | 'Editor';
  actingUserName: string;
  actingUserEmail: string;
};

export function contentItemNotificationEmailTemplate(
  data: ContentItemNotificationData,
): string {
  return `
    <div style="font-family: sans-serif; color: #333; padding: 20px; border: 1px solid #eee; max-width: 600px;">
      <h3 style="color: #E20074;">Content ${data.actionLabel} Alert</h3>
      <p>Hello,</p>
      <p>
        A <strong>content-item</strong> titled <strong>"${data.title}"</strong>
        has been <strong>${data.actionLabel.toLowerCase()}</strong> by
        ${data.roleLabel} <strong>${data.actingUserName}</strong> (${data.actingUserEmail}).
      </p>
      <p style="margin-top: 20px;">
        <a href="${data.adminUrl}" style="background-color: #E20074; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          View in Admin Panel
        </a>
      </p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #999;">
        Action: ${data.actionLabel} | By: ${data.roleLabel} ${data.actingUserName} (${data.actingUserEmail})
      </p>
    </div>
  `;
}

