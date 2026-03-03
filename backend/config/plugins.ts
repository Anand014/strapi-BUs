import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', ''), 
        port: env.int('SMTP_PORT', 25),
        secure: false,
        requireTLS: true,
        auth: {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD'),
        },
        tls: {
          minVersion: 'TLSv1.2',
        },
        logger: true,
        debug: true,
      },
      settings: {
        defaultFrom: env('SMTP_FROM_EMAIL', 'noreply@email.developer.t-mobile.com'),
        defaultReplyTo: env('SMTP_FROM_EMAIL', 'noreply@email.developer.t-mobile.com'),
      },
    },
  },

  'strapi-plugin-sso': {
    enabled: true,
    config: {
      AZUREAD_TENANT_ID: env('AZUREAD_TENANT_ID'),
      AZUREAD_OAUTH_CLIENT_ID: env('AZUREAD_OAUTH_CLIENT_ID'),
      AZUREAD_OAUTH_CLIENT_SECRET: env('AZUREAD_OAUTH_CLIENT_SECRET'),
      AZUREAD_OAUTH_REDIRECT_URI:
        env('AZUREAD_OAUTH_REDIRECT_URI') ||
        'http://localhost:1337/strapi-plugin-sso/azuread/callback',
    },
  },
});

export default config;
