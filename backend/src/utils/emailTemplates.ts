export const reviewRequestEmailTemplate = (data: {
  contentType: string;
  title: string;
  editorName: string;
  editorEmail: string;
  adminUrl: string;
  byLabel: string;
}) => `
  <div style="font-family: sans-serif; color: #333; padding: 20px; border: 1px solid #eee;">
    <h2 style="color: #E20074;">Review Required: ${data.title}</h2>
    <p>A content update has been performed by <strong>${data.editorName || 'System'}</strong> (${data.editorEmail || 'system'}).</p>
    {{CONTENT_TABLE}}
    <p style="margin-top: 20px;">Please review the changes in the Strapi Admin panel.</p>
    <p style="margin-top: 10px;">
      <a href="${data.adminUrl}" style="background-color: #E20074; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View in Admin Panel</a>
    </p>
    <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #999;">${data.byLabel}: ${data.editorName || 'System'}</p>
  </div>
`;

export const reviewRequestEmailText = (data: any) => `
  Review Required: ${data.title}
  A content update has been performed by ${data.editorName} (${data.editorEmail}).
  Please review the changes in the Strapi Admin panel.
`;
