import React, { useEffect } from "react";
import { fetchFnsBusinessUnits } from "./fns";
import { log } from "node:console";

const USERS_LIST_RE = /\/settings\/users\/?(\?.*)?$/;
const USERS_LIST_OR_MODAL_RE = /\/settings\/users/;
const TABLE_ATTR = "data-bu-col-done";
const ROW_ATTR = "data-bu-row-done";
const BU_CELL_ATTR = "data-bu-cell";
const INVITE_MODAL_ATTR = "data-bu-invite-done";
const BU_SPACER_ID = "bu-dropdown-spacer";
const POLL_INTERVAL_MS = 600;
const BLUR_DELAY_MS = 300;
const SPACER_HEIGHT_PX = 220;
const REFRESH_AFTER_INVITE_MS = 200;
const TH_STYLE =
  "padding: 10px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--colors-neutral500, #a5a5ba); white-space: nowrap;";
const TD_STYLE = "padding: 10px 16px; vertical-align: middle;";

interface BuOption {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  [key: string]: unknown;
}

interface BuUserInfo {
  id: number;
  buId: number | null;
}

declare global {
  interface Window {
    __buInviteSelectedBu?: string;
    __buThemeListenerAdded?: boolean;
    __buFetchInterceptorInstalled?: boolean;
    __buInviteModalIntervalStarted?: boolean;
    __buMutationObserverStarted?: boolean;
    __buPollingStarted?: boolean;
    strapi?: { backendURL?: string };
  }
}

let buOptions: BuOption[] = [];
let userBuMap: Record<string, string> = {};
let dataLoaded = false;
let lastPath = "";
if (typeof window !== "undefined") {
  (window as Window).__buInviteSelectedBu = "";
}

const themeColors = {
  dark: {
    title: "#FFFFFF",
    label: "#FFFFFF",
    border: "#AEAFB4",
    bg: "#3F3C51",
    text: "#FFFFFF",
    optBg: "#212134",
  },
  light: {
    title: "#32324d",
    label: "#32324d",
    border: "#dcdce4",
    bg: "#ffffff",
    text: "#32324d",
    optBg: "#ffffff",
  },
} as const;

function injectBuSelectStyles(): void {
  if (document.getElementById("bu-select-styles")) return;
  const theme = localStorage.getItem("STRAPI_THEME") || "system";
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  const c = isDark ? themeColors.dark : themeColors.light;
  const style = document.createElement("style");
  style.id = "bu-select-styles";
  style.textContent = `
    .bu-invite-select-wrap .bu-section-title { font-size: 18px; font-weight: 600; margin: 0 0 6px 0; line-height: 1.25; color: ${c.title}; }
    .bu-invite-select-wrap .bu-field-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; display: block; color: ${c.label}; }
    .bu-invite-select-wrap .bu-select-wrap { display: block; overflow: visible; margin-left: 0; padding-left: 0; box-sizing: border-box; }
    .bu-invite-select-wrap .bu-select { box-sizing: border-box; width: 50%; max-width: 50%; min-width: 140px; padding: 8px 12px; border-radius: 4px; font-size: 14px; cursor: pointer; appearance: auto; outline: none; border: 1px solid ${c.border}; background: ${c.bg}; color: ${c.text}; }
    .bu-invite-select-wrap .bu-select option { background: ${c.optBg}; color: ${c.text}; }
  `;
  document.head.appendChild(style);
  if (!window.__buThemeListenerAdded) {
    window.__buThemeListenerAdded = true;
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key === "STRAPI_THEME") {
        document.getElementById("bu-select-styles")?.remove();
        injectBuSelectStyles();
      }
    });
  }
}

function getStrapiToken(): string | null {
  let token: string | null =
    localStorage.getItem("jwtToken") || sessionStorage.getItem("jwtToken");
  try {
    if (token && token.startsWith('"')) token = JSON.parse(token) as string;
  } catch {
    // ignore
  }
  if (token) return token;
  const m = document.cookie.match(/(?:^|;\s*)jwtToken=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function buFetch(
  url: string,
  options: RequestInit = {}
): Promise<unknown> {
  const baseUrl =
    (typeof window !== "undefined" &&
      (window.strapi?.backendURL || window.location.origin)) ||
    "";
  const fullUrl = url.startsWith("http")
    ? url
    : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const token = getStrapiToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const result = await fetchFnsBusinessUnits()
  console.log("All business units: ", result);
  
  const res = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: "include",
  });
  const ct = res.headers.get("content-type") || "";
  let payload: unknown;
  if (ct.includes("application/json")) payload = await res.json();
  else {
    const text = await res.text();
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return payload;
}

// async function loadBuData(): Promise<void> {
//   if (dataLoaded) return;
//   try {
//     const body = (await buFetch("/admin/bu-options")) as
//       | { data?: BuOption[] }
//       | BuOption[];
//     buOptions = Array.isArray(body)
//       ? body
//       : Array.isArray(body?.data)
//         ? body.data
//         : [];
//     const userInfo = (await buFetch("/admin/bu-users-info")) as {
//       data?: BuUserInfo[];
//     };
//     const list = userInfo?.data ?? [];
//     userBuMap = {};
//     (Array.isArray(list) ? list : []).forEach((u) => {
//       userBuMap[String(u.id)] = u.buId != null ? String(u.buId) : "";
//     });
//     dataLoaded = true;
//   } catch {
//     dataLoaded = false;
//   }
// }

async function loadBuData(): Promise<void> {
  if (dataLoaded) return;
  try {
    const body = (await buFetch("/admin/bu-options")) as
      | { data?: BuOption[] }
      | BuOption[];
    const businessUnits = await fetchFnsBusinessUnits();    
    buOptions = businessUnits;;
    
    const userInfo = (await buFetch("/admin/bu-users-info")) as {
      data?: BuUserInfo[];
    };
    const list = userInfo?.data ?? [];
    userBuMap = {};
    (Array.isArray(list) ? list : []).forEach((u) => {
      userBuMap[String(u.id)] = u.buId != null ? String(u.buId) : "";
    });
    dataLoaded = true;
  } catch {
    dataLoaded = false;
  }
}


function getBuName(buId: string | null | undefined): string {
  if (buId == null || buId === "") return "—";
  // const opt = buOptions.find((b) => String(b.id) === String(buId)); overrideen
  const opt = buOptions.find((b) => String(b.documentId) === String(buId));
  return opt?.name ?? "—";
}

function clearAttrs(attrs: string[]): void {
  attrs.forEach((attr) =>
    document
      .querySelectorAll(`[${attr}]`)
      .forEach((el) => el.removeAttribute(attr))
  );
}

function resetBuState(): void {
  removeInjectedBuColumn(getUsersTable());
  clearAttrs([TABLE_ATTR, ROW_ATTR, INVITE_MODAL_ATTR]);
  dataLoaded = false;
  userBuMap = {};
}

function getUsersTable(): Element | null {
  for (const t of document.querySelectorAll("table")) {
    const link = t.querySelector('a[href*="users"]');
    if (link && /users\/\d+/.test(link.getAttribute("href") || "")) return t;
  }
  return (
    document.querySelector("table") ||
    document.querySelector('[role="table"]') ||
    null
  );
}

function removeInjectedBuColumn(table: Element | null): void {
  if (!table) return;
  table.querySelector("#bu-th")?.remove();
  table.querySelectorAll(`[${BU_CELL_ATTR}]`).forEach((el) => el.remove());
}

async function refreshBuUsersAndTable(): Promise<void> {
  dataLoaded = false;
  await loadBuData();
  const table = getUsersTable();
  if (table) {
    removeInjectedBuColumn(table);
    table.removeAttribute(TABLE_ATTR);
    table
      .querySelectorAll(`[${ROW_ATTR}]`)
      .forEach((el) => el.removeAttribute(ROW_ATTR));
  }
  injectBuColumn();
}

function installFetchInterceptor(): void {
  if (window.__buFetchInterceptorInstalled) return;
  window.__buFetchInterceptorInstalled = true;
  const orig = window.fetch;
  window.fetch = function (
    url: RequestInfo | URL,
    opts: RequestInit = {}
  ): Promise<Response> {
    const urlStr =
      typeof url === "string" ? url : (opts as { url?: string })?.url || "";
    const isAdminUsers = urlStr.includes("/admin/users");
    const isCreate =
      isAdminUsers &&
      opts?.method === "POST" &&
      !/\/admin\/users\/[^/]/.test(urlStr) &&
      !urlStr.includes("/admin/users/batch-delete");
    if (isAdminUsers && opts?.body && typeof opts.body === "string") {
      try {
        const data = JSON.parse(opts.body) as Record<string, unknown>;
        if (data && typeof data === "object") {
          if (isCreate && window.__buInviteSelectedBu !== undefined) {
            if (window.__buInviteSelectedBu !== "")
              data.businessUnit = window.__buInviteSelectedBu;
          } else if (Object.prototype.hasOwnProperty.call(data, "bu"))
            delete data.businessUnit;
          opts = { ...opts, body: JSON.stringify(data) };
        }
      } catch {
        // ignore
      }
    }
    return orig.call(this, url, opts).then((r) => {      
      if (isCreate && r?.status === 201) {
        dataLoaded = false;
        setTimeout(() => refreshBuUsersAndTable(), REFRESH_AFTER_INVITE_MS);
      }
      return r;
    });
  };
}

function findInviteModal(): Element | null {
  for (const d of document.querySelectorAll(
    '[role="dialog"], [data-state="open"]'
  )) {
    const t = d.textContent || "";
    if (
      t.includes("Invite new user") &&
      (t.includes("User details") || t.includes("First name"))
    )
      return d;
  }
  const byTitle = Array.from(
    document.querySelectorAll('h1, h2, span, [class*="Typography"]')
  ).find((el) => (el.textContent || "").trim() === "Invite new user");
  if (!byTitle) return null;
  let p: Element | null = byTitle.parentElement;
  for (let i = 0; i < 25 && p; i++) {
    const t = p.textContent || "";
    if (
      (t.includes("First name") || t.includes("Email")) &&
      t.includes("User's role")
    )
      return p;
    p = p.parentElement;
  }
  return null;
}

interface BuInviteWrapElement extends HTMLDivElement {
  _buInsertParent?: Element | null;
}

function injectInviteModalBu(): void {
  document
    .querySelectorAll(`[${INVITE_MODAL_ATTR}].bu-invite-select-wrap`)
    .forEach((el) => {
      const m = el.closest(
        '[role="dialog"], [aria-modal="true"], [data-state]'
      );
      if (!m || !document.contains(m)) el.remove();
    });
  const modal = findInviteModal();
  if (!modal || modal.getAttribute(INVITE_MODAL_ATTR)) return;

  const existingWrap = modal.querySelector(
    ".bu-invite-select-wrap",
  ) as HTMLElement | null;
  if (existingWrap) {
    const sel = existingWrap.querySelector("select") as HTMLSelectElement | null;
    if (sel && buOptions.length > 0 && sel.options.length <= 1) {
      const prev = sel.value;
      sel.replaceChildren();
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— None —";
      sel.appendChild(blank);
      buOptions.forEach((b) => {
        const o = document.createElement("option");
        // o.value = String(b.id);  override with the o.value = b.documentId; change it
        o.value = b.documentId;
        o.textContent = b.name;
        sel.appendChild(o);
      });
      sel.value = prev || window.__buInviteSelectedBu || "";
    }
    return;
  }

  let insertParent: Element | null = null;
  let insertBeforeNode: Element | null = null;
  const roleHeading = Array.from(
    modal.querySelectorAll('h2, h3, [class*="Typography"]')
  ).find((el) => {
    const t = (el.textContent || "").trim();
    return t === "User's role" || t === "Roles";
  });
  if (roleHeading) {
    let section: Element | null = roleHeading.parentElement;
    for (let i = 0; i < 15 && section; i++) {
      const t = section.textContent || "";
      if (
        t.includes("Select") ||
        t.includes("several roles") ||
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
    const form = modal.querySelector("form");
    insertParent =
      form?.querySelector('[class*="Body"], [class*="body"]') ||
      form?.firstElementChild ||
      modal;
  }

  const wrap = document.createElement("div") as BuInviteWrapElement;
  wrap.className = "bu-invite-select-wrap";
  wrap.setAttribute(INVITE_MODAL_ATTR, "1");
  wrap.setAttribute("style", "margin-top: 8px; padding-top: 6px;");
  const h2 = document.createElement("h2");
  h2.className = "bu-section-title";
  h2.textContent = "Business Units";
  wrap.appendChild(h2);
  const label = document.createElement("label");
  label.className = "bu-field-label";
  label.textContent = "Business Unit";
  wrap.appendChild(label);
  const sel = document.createElement("select");
  sel.className = "bu-select";
  sel.name = "bu";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "— None —";
  sel.appendChild(blank);
  buOptions.forEach((b) => {
    const o = document.createElement("option");
    // o.value = String(b.id); overrriedn
    o.value = String(b.documentId); 
    o.textContent = b.name;
    sel.appendChild(o);
  });
  sel.value = window.__buInviteSelectedBu || "";
  sel.addEventListener("change", () => {
    window.__buInviteSelectedBu = sel.value || "";
  });
  const selectWrap = document.createElement("div");
  selectWrap.className = "bu-select-wrap";
  selectWrap.appendChild(sel);
  wrap.appendChild(selectWrap);

  const modalRoot = modal.closest('[role="dialog"]') || modal;
  wrap._buInsertParent = insertParent;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  const expandModal = (): void => {
    if (document.getElementById(BU_SPACER_ID)) return;
    modalRoot.classList.add("bu-modal-dropdown-open");
    const spacer = document.createElement("div");
    spacer.id = BU_SPACER_ID;
    spacer.setAttribute(
      "style",
      `height: ${SPACER_HEIGHT_PX}px; flex-shrink: 0;`
    );
    spacer.setAttribute("aria-hidden", "true");
    const parent =
      wrap._buInsertParent ||
      modalRoot.querySelector("form")?.firstElementChild ||
      modalRoot.firstElementChild;
    if (parent) parent.appendChild(spacer);
  };
  const collapseModal = (): void => {
    modalRoot.classList.remove("bu-modal-dropdown-open");
    document.getElementById(BU_SPACER_ID)?.remove();
  };
  sel.addEventListener("focus", () => {
    if (blurTimer) clearTimeout(blurTimer);
    expandModal();
  });
  sel.addEventListener("blur", () => {
    blurTimer = setTimeout(() => {
      collapseModal();
      blurTimer = null;
    }, BLUR_DELAY_MS);
  });

  if (insertParent) {
    insertBeforeNode
      ? insertParent.insertBefore(wrap, insertBeforeNode)
      : insertParent.appendChild(wrap);
  }
}

function injectBuColumn(): void {
  const table = getUsersTable();
  if (!table || table.getAttribute(TABLE_ATTR)) return;
  table.setAttribute(TABLE_ATTR, "1");

  const headerRow =
    table.querySelector("thead tr") ||
    table.querySelector('[role="rowgroup"]:first-child [role="row"]') ||
    table.querySelector('[role="row"]');
  if (headerRow && !table.querySelector("#bu-th")) {
    const isTh = !!headerRow.querySelector("th");
    const th = document.createElement(isTh ? "th" : "div");
    th.id = "bu-th";
    th.setAttribute("style", TH_STYLE);
    if (!isTh) th.setAttribute("role", "columnheader");
    th.innerHTML =
      '<div style="display: flex; align-items: center; justify-content: flex-start;"><span style="font-size: 11px; font-weight: 600; text-transform: uppercase;">Business Unit</span></div>';
    headerRow.appendChild(th);
  }

  const bodyRows = Array.from(
    table.querySelectorAll(
      'tbody tr, [role="rowgroup"]:last-child [role="row"]'
    )
  ).filter((r) => r !== headerRow);
  bodyRows.forEach((row) => {
    if (row.getAttribute(ROW_ATTR)) return;
    row.setAttribute(ROW_ATTR, "1");
    let userId: string | null = null;
    row.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/users\/(\d+)/) || href.match(/\/(\d+)(?:\/|$)/);
      if (m) userId = m[1];
    });
    const isTd = !!row.querySelector("td");
    const td = document.createElement(isTd ? "td" : "div");
    td.setAttribute(BU_CELL_ATTR, "1");
    if (!isTd) td.setAttribute("role", "cell");
    td.setAttribute("style", TD_STYLE);
    td.textContent = getBuName(userId ? (userBuMap[userId] ?? "") : "");
    const last = row.lastElementChild;
    last ? row.insertBefore(td, last) : row.appendChild(td);
  });
}

function runInviteModalInjection(): void {
  if (!document.body?.textContent?.includes("Invite new user")) return;
  dataLoaded ? injectInviteModalBu() : loadBuData().then(injectInviteModalBu);
}

function startPolling(): void {
  injectBuSelectStyles();
  installFetchInterceptor();
  loadBuData();
  const tick = async (): Promise<void> => {
    const path = window.location.pathname;
    const isUsersList =
      USERS_LIST_RE.test(path) ||
      (path.includes("/settings/users") &&
        !/\/settings\/users\/\d+/.test(path));
    if (!isUsersList) {
      if (USERS_LIST_OR_MODAL_RE.test(lastPath)) resetBuState();
      lastPath = path;
      runInviteModalInjection();
      return;
    }
    lastPath = path;
    if (!dataLoaded) await loadBuData();
    injectBuColumn();
    injectInviteModalBu();
  };
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
  if (!window.__buInviteModalIntervalStarted) {
    window.__buInviteModalIntervalStarted = true;
    setInterval(runInviteModalInjection, POLL_INTERVAL_MS);
  }
  if (
    typeof MutationObserver !== "undefined" &&
    !window.__buMutationObserverStarted
  ) {
    window.__buMutationObserverStarted = true;
    new MutationObserver(runInviteModalInjection).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

function BuTableInjector(): null {
  return null;
}
(BuTableInjector as unknown as React.FunctionComponent & {
  startPolling: typeof startPolling;
}).startPolling = startPolling;

const config = { locales: [] as string[] };

interface StrapiAdminApp {
  registerPlugin: (config: {
    id: string;
    name: string;
    isReady: boolean;
    initializer: (context: { setPlugin: (id: string) => void }) => null;
  }) => void;
}

const register = (app: StrapiAdminApp): void => {
  app.registerPlugin({
    id: "bu-table-injector-plugin",
    name: "Business Unit Table Injector",
    isReady: false,
    initializer({ setPlugin }) {
      if (!window.__buPollingStarted) {
        window.__buPollingStarted = true;
        startPolling();
      }
      useEffect(() => setPlugin("bu-table-injector-plugin"), [setPlugin]);
      return null;
    },
  });
};

const bootstrap = (): void => {
  if (!window.__buPollingStarted) {
    window.__buPollingStarted = true;
    startPolling();
  }
};

export default { config, register, bootstrap };
