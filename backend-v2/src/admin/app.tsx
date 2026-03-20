import type { StrapiApp } from '@strapi/strapi/admin';

const USERS_LIST_RE = /\/settings\/users\/?(\?.*)?$/;
const USERS_LIST_OR_MODAL_RE = /\/settings\/users/;

const TABLE_ATTR = 'data-tenant-col-done';
const ROW_ATTR = 'data-tenant-row-done';
const TENANT_CELL_ATTR = 'data-tenant-cell';
const INVITE_MODAL_ATTR = 'data-tenant-invite-done';

const TENANT_SPACER_ID = 'tenant-dropdown-spacer';

const POLL_INTERVAL_MS = 600;
const BLUR_DELAY_MS = 300;
const SPACER_HEIGHT_PX = 220;
const REFRESH_AFTER_INVITE_MS = 200;

const TH_STYLE =
  'padding: 10px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--colors-neutral500, #a5a5ba); white-space: nowrap;';
const TD_STYLE = 'padding: 10px 16px; vertical-align: middle;';

interface TenantOption {
  id: number;
  name: string;
}

interface TenantUserInfo {
  id: number;
  tenantId: number | null;
  isSuperAdmin: boolean;
}

declare global {
  interface Window {
    __tenantInviteSelectedTenant?: string;
    __tenantThemeListenerAdded?: boolean;
    __tenantFetchInterceptorInstalled?: boolean;
    __tenantInviteModalIntervalStarted?: boolean;
    __tenantMutationObserverStarted?: boolean;
    __tenantPollingStarted?: boolean;
    strapi?: { backendURL?: string };
  }
}

let tenantOptions: TenantOption[] = [];
let userTenantMap: Record<string, string> = {};
let userIsSuperAdminMap: Record<string, boolean> = {};

let dataLoaded = false;
let lastPath = '';

if (typeof window !== 'undefined') {
  window.__tenantInviteSelectedTenant = '';
}

const themeColors = {
  dark: {
    title: '#FFFFFF',
    label: '#FFFFFF',
    border: '#AEAFB4',
    bg: '#3F3C51',
    text: '#FFFFFF',
    optBg: '#212134',
  },
  light: {
    title: '#32324d',
    label: '#32324d',
    border: '#dcdce4',
    bg: '#ffffff',
    text: '#32324d',
    optBg: '#ffffff',
  },
} as const;

function injectTenantSelectStyles(): void {
  if (document.getElementById('tenant-select-styles')) return;
  const theme = localStorage.getItem('STRAPI_THEME') || 'system';
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  const c = isDark ? themeColors.dark : themeColors.light;
  const style = document.createElement('style');
  style.id = 'tenant-select-styles';
  style.textContent = `
    .tenant-invite-select-wrap .tenant-section-title { font-size: 18px; font-weight: 600; margin: 0 0 6px 0; line-height: 1.25; color: ${c.title}; }
    .tenant-invite-select-wrap .tenant-field-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; display: block; color: ${c.label}; }
    .tenant-invite-select-wrap .tenant-select-wrap { display: block; overflow: visible; margin-left: 0; padding-left: 0; box-sizing: border-box; }
    .tenant-invite-select-wrap .tenant-select { box-sizing: border-box; width: 50%; max-width: 50%; min-width: 140px; padding: 8px 12px; border-radius: 4px; font-size: 14px; cursor: pointer; appearance: auto; outline: none; border: 1px solid ${c.border}; background: ${c.bg}; color: ${c.text}; }
    .tenant-invite-select-wrap .tenant-select option { background: ${c.optBg}; color: ${c.text}; }
  `;
  document.head.appendChild(style);

  if (!window.__tenantThemeListenerAdded) {
    window.__tenantThemeListenerAdded = true;
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === 'STRAPI_THEME') {
        document.getElementById('tenant-select-styles')?.remove();
        injectTenantSelectStyles();
      }
    });
  }
}

function getStrapiToken(): string | null {
  let token: string | null =
    localStorage.getItem('jwtToken') || sessionStorage.getItem('jwtToken');
  try {
    if (token && token.startsWith('"')) token = JSON.parse(token) as string;
  } catch {
    // ignore
  }
  if (token) return token;
  const m = document.cookie.match(/(?:^|;\s*)jwtToken=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function tenantFetch(
  url: string,
  options: RequestInit = {},
): Promise<unknown> {
  const baseUrl =
    (typeof window !== 'undefined' &&
      (window.strapi?.backendURL || window.location.origin)) ||
    '';
  const fullUrl = url.startsWith('http')
    ? url
    : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  const token = getStrapiToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(((options.headers as Record<string, string>) || {}) as Record<
      string,
      string
    >),
  };
  const res = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: 'include',
  });

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function loadTenantData(): Promise<void> {
  if (dataLoaded) return;
  try {
    const body = (await tenantFetch('/admin/tenant-options')) as
      | { data?: TenantOption[] }
      | TenantOption[];

    tenantOptions = Array.isArray(body)
      ? body
      : Array.isArray(body?.data)
        ? body.data
        : [];

    const userInfo = (await tenantFetch('/admin/tenant-users-info')) as {
      data?: TenantUserInfo[];
    };

    const list = userInfo?.data ?? [];
    userTenantMap = {};
    userIsSuperAdminMap = {};
    (Array.isArray(list) ? list : []).forEach((u) => {
      userTenantMap[String(u.id)] = u.tenantId != null ? String(u.tenantId) : '';
      userIsSuperAdminMap[String(u.id)] = Boolean(u.isSuperAdmin);
    });

    dataLoaded = true;
  } catch {
    dataLoaded = false;
  }
}

function getTenantName(tenantId: string | null | undefined): string {
  if (tenantId == null || tenantId === '') return '—';
  const opt = tenantOptions.find((b) => String(b.id) === String(tenantId));
  return opt?.name ?? '—';
}

function clearAttrs(attrs: string[]): void {
  attrs.forEach((attr) => {
    document
      .querySelectorAll(`[${attr}]`)
      .forEach((el) => el.removeAttribute(attr));
  });
}

function resetTenantState(): void {
  removeInjectedTenantColumn(getUsersTable());
  clearAttrs([TABLE_ATTR, ROW_ATTR, INVITE_MODAL_ATTR]);
  dataLoaded = false;
  tenantOptions = [];
  userTenantMap = {};
  userIsSuperAdminMap = {};
}

function getUsersTable(): Element | null {
  for (const t of document.querySelectorAll('table')) {
    const link = t.querySelector('a[href*="users"]');
    if (link && /users\/\d+/.test(link.getAttribute('href') || '')) return t;
  }
  return (
    document.querySelector('table') ||
    document.querySelector('[role="table"]') ||
    null
  );
}

function removeInjectedTenantColumn(table: Element | null): void {
  if (!table) return;
  table.querySelector('#tenant-th')?.remove();
  table.querySelectorAll(`[${TENANT_CELL_ATTR}]`).forEach((el) => el.remove());
}

function createTenantSelect(userId: string): HTMLSelectElement {
  const isSuper = Boolean(userIsSuperAdminMap[userId]);
  const sel = document.createElement('select');
  sel.style.width = '100%';
  sel.disabled = isSuper;
  sel.setAttribute('aria-label', 'Tenant');

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— None —';
  sel.appendChild(blank);

  tenantOptions.forEach((t) => {
    const o = document.createElement('option');
    o.value = String(t.id);
    o.textContent = t.name;
    sel.appendChild(o);
  });

  const current = userTenantMap[userId] ?? '';
  sel.value = current;

  if (!isSuper) {
    sel.addEventListener('change', async () => {
      try {
        await tenantFetch(`/admin/users/${userId}/tenant`, {
          method: 'PUT',
          body: JSON.stringify({ tenant: sel.value }),
        });
        userTenantMap[userId] = sel.value || '';
      } catch {
        // ignore
      }
    });
  }

  return sel;
}

function getTenantCellText(userId: string): string {
  if (Boolean(userIsSuperAdminMap[userId])) return 'All';
  return getTenantName(userTenantMap[userId] ?? '');
}

function injectTenantColumn(): void {
  const table = getUsersTable();
  if (!table || table.getAttribute(TABLE_ATTR)) return;
  table.setAttribute(TABLE_ATTR, '1');

  const headerRow =
    table.querySelector('thead tr') ||
    table.querySelector('[role="rowgroup"]:first-child [role="row"]') ||
    table.querySelector('[role="row"]');

  if (headerRow && !table.querySelector('#tenant-th')) {
    const isTh = !!headerRow.querySelector('th');
    const th = document.createElement(isTh ? 'th' : 'div');
    th.id = 'tenant-th';
    th.setAttribute('style', TH_STYLE);
    if (!isTh) th.setAttribute('role', 'columnheader');
    th.innerHTML = `<div style="display:flex;align-items:center;justify-content:flex-start;"><span style="font-size:11px;font-weight:600;text-transform:uppercase;">Tenant</span></div>`;
    headerRow.appendChild(th);
  }

  const bodyRows = Array.from(
    table.querySelectorAll(
      'tbody tr, [role="rowgroup"]:last-child [role="row"]',
    ),
  ).filter((r) => r !== headerRow);

  bodyRows.forEach((row) => {
    if (row.getAttribute(ROW_ATTR)) return;
    row.setAttribute(ROW_ATTR, '1');

    let userId: string | null = null;
    row.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/users\/(\d+)/) || href.match(/\/(\d+)(?:\/|$)/);
      if (m) userId = m[1];
    });

    if (!userId) return;

    const isTd = !!row.querySelector('td');
    const td = document.createElement(isTd ? 'td' : 'div');
    td.setAttribute(TENANT_CELL_ATTR, '1');
    if (!isTd) td.setAttribute('role', 'cell');
    td.setAttribute('style', TD_STYLE);

    td.textContent = getTenantCellText(userId);

    const last = row.lastElementChild;
    last ? row.insertBefore(td, last) : row.appendChild(td);
  });
}

function findInviteModal(): Element | null {
  for (const d of document.querySelectorAll('[role="dialog"], [data-state="open"]')) {
    const t = d.textContent || '';
    if (
      t.includes('Invite new user') &&
      (t.includes('User details') || t.includes('First name'))
    ) {
      return d;
    }
  }

  const byTitle = Array.from(
    document.querySelectorAll('h1, h2, span, [class*="Typography"]'),
  ).find((el) => (el.textContent || '').trim() === 'Invite new user');
  if (!byTitle) return null;

  let p: Element | null = byTitle.parentElement;
  for (let i = 0; i < 25 && p; i++) {
    const t = p.textContent || '';
    if (
      (t.includes('First name') || t.includes('Email')) &&
      t.includes("User's role")
    ) {
      return p;
    }
    p = p.parentElement;
  }

  return null;
}

function injectInviteModalTenant(): void {
  // Remove previous injections (if any)
  document
    .querySelectorAll(`[${INVITE_MODAL_ATTR}].tenant-invite-select-wrap`)
    .forEach((el) => {
      const m =
        el.closest('[role="dialog"], [aria-modal="true"], [data-state]') || null;
      if (!m || !document.contains(m)) el.remove();
    });

  const modal = findInviteModal();
  if (!modal || modal.getAttribute(INVITE_MODAL_ATTR)) return;

  const existingWrap = modal.querySelector(
    '.tenant-invite-select-wrap',
  ) as HTMLElement | null;

  if (existingWrap) {
    const sel = existingWrap.querySelector('select') as HTMLSelectElement | null;
    if (sel && tenantOptions.length > 0 && sel.options.length <= 1) {
      const prev = sel.value;
      sel.replaceChildren();

      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— None —';
      sel.appendChild(blank);

      tenantOptions.forEach((t) => {
        const o = document.createElement('option');
        o.value = String(t.id);
        o.textContent = t.name;
        sel.appendChild(o);
      });

      sel.value = prev || window.__tenantInviteSelectedTenant || '';
    }
    return;
  }

  let insertParent: Element | null = null;
  let insertBeforeNode: Element | null = null;

  const roleHeading = Array.from(
    modal.querySelectorAll('h2, h3, [class*="Typography"]'),
  ).find((el) => (el.textContent || '').trim() === "User's role" || (el.textContent || '').trim() === 'Roles');

  if (roleHeading) {
    let section: Element | null = roleHeading.parentElement;
    for (let i = 0; i < 15 && section; i++) {
      const t = section.textContent || '';
      if (
        t.includes('Select') ||
        t.includes('several roles') ||
        t.includes("User's roles")
      ) {
        insertParent = section.parentElement;
        insertBeforeNode = section.nextElementSibling;
        break;
      }
      section = section.parentElement;
    }
  }

  if (!insertParent) {
    const form = modal.querySelector('form');
    insertParent =
      (form?.querySelector('[class*="Body"], [class*="body"]') as Element | null) ||
      form?.firstElementChild ||
      modal;
  }

  const wrap = document.createElement('div');
  wrap.className = 'tenant-invite-select-wrap';
  wrap.setAttribute(INVITE_MODAL_ATTR, '1');
  wrap.setAttribute('style', 'margin-top: 8px; padding-top: 6px;');

  const h2 = document.createElement('h2');
  h2.className = 'tenant-section-title';
  h2.textContent = 'Tenants';
  wrap.appendChild(h2);

  const label = document.createElement('label');
  label.className = 'tenant-field-label';
  label.textContent = 'Tenant';
  wrap.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'tenant-select';
  sel.name = 'tenant';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— None —';
  sel.appendChild(blank);

  tenantOptions.forEach((t) => {
    const o = document.createElement('option');
    o.value = String(t.id);
    o.textContent = t.name;
    sel.appendChild(o);
  });

  sel.value = window.__tenantInviteSelectedTenant || '';
  sel.addEventListener('change', () => {
    window.__tenantInviteSelectedTenant = sel.value || '';
  });

  const selectWrap = document.createElement('div');
  selectWrap.className = 'tenant-select-wrap';
  selectWrap.appendChild(sel);
  wrap.appendChild(selectWrap);

  // Optional spacer to help dropdowns not be clipped in the modal
  const modalRoot = modal.closest('[role="dialog"]') || modal;
  const spacer = document.createElement('div');
  spacer.id = TENANT_SPACER_ID;
  spacer.setAttribute('style', `height: ${SPACER_HEIGHT_PX}px; flex-shrink: 0;`);
  spacer.setAttribute('aria-hidden', 'true');
  const parent =
    modalRoot.querySelector('form')?.firstElementChild ||
    modalRoot.firstElementChild;

  const expand = () => {
    if (document.getElementById(TENANT_SPACER_ID)) return;
    modalRoot.classList.add('tenant-modal-dropdown-open');
    if (parent) parent.appendChild(spacer);
  };
  const collapse = () => {
    modalRoot.classList.remove('tenant-modal-dropdown-open');
    document.getElementById(TENANT_SPACER_ID)?.remove();
  };

  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  sel.addEventListener('focus', () => {
    if (blurTimer) clearTimeout(blurTimer);
    expand();
  });
  sel.addEventListener('blur', () => {
    blurTimer = setTimeout(() => {
      collapse();
      blurTimer = null;
    }, BLUR_DELAY_MS);
  });

  if (insertParent) {
    insertBeforeNode
      ? insertParent.insertBefore(wrap, insertBeforeNode)
      : insertParent.appendChild(wrap);
  }
}

function injectStylesAndBootstrap(): void {
  injectTenantSelectStyles();
}

function installFetchInterceptor(): void {
  if (window.__tenantFetchInterceptorInstalled) return;
  window.__tenantFetchInterceptorInstalled = true;

  const orig = window.fetch;
  window.fetch = function (url: RequestInfo | URL, opts: RequestInit = {}) {
    const urlStr =
      typeof url === 'string' ? url : (opts as { url?: string })?.url || '';
    const isAdminUsers = urlStr.includes('/admin/users');
    const isCreate =
      isAdminUsers &&
      opts?.method === 'POST' &&
      !/\/admin\/users\/[^/]/.test(urlStr) &&
      !urlStr.includes('/admin/users/batch-delete');

    if (isAdminUsers && opts?.body && typeof opts.body === 'string') {
      try {
        const data = JSON.parse(opts.body) as Record<string, unknown>;
        if (data && typeof data === 'object') {
          if (window.__tenantInviteSelectedTenant !== undefined) {
            if (window.__tenantInviteSelectedTenant !== '') {
              data.tenant = window.__tenantInviteSelectedTenant;
            } else if (Object.prototype.hasOwnProperty.call(data, 'tenant')) {
              delete data.tenant;
            }
          }
          opts = { ...opts, body: JSON.stringify(data) };
        }
      } catch {
        // ignore
      }
    }

    return orig.call(this, url, opts).then((r) => {
      if (isCreate && r?.status === 201) {
        dataLoaded = false;
        setTimeout(() => {
          loadTenantData().then(() => {
            removeInjectedTenantColumn(getUsersTable());
            injectTenantColumn();
          });
        }, REFRESH_AFTER_INVITE_MS);
      }
      return r;
    });
  };
}

function startPolling(): void {
  if (window.__tenantPollingStarted) return;
  window.__tenantPollingStarted = true;

  injectStylesAndBootstrap();
  installFetchInterceptor();

  const tick = async () => {
    const path = window.location.pathname;

    const isUsersList =
      USERS_LIST_RE.test(path) ||
      (path.includes('/settings/users') &&
        !/\/settings\/users\/\d+/.test(path));

    if (!isUsersList) {
      if (USERS_LIST_OR_MODAL_RE.test(lastPath)) resetTenantState();
      lastPath = path;
      injectInviteModalTenant();
      return;
    }

    lastPath = path;
    if (!dataLoaded) await loadTenantData();

    injectTenantColumn();
    injectInviteModalTenant();
  };

  // Immediate tick, then poll
  void tick();
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}

export default {
  config: { locales: [] as string[] },
  bootstrap(_app: StrapiApp) {
    if (!window.__tenantPollingStarted) startPolling();
  },
};
