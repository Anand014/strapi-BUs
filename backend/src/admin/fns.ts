interface BuOption {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  [key: string]: unknown;
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


async function fetchFnsBusinessUnits() : Promise<Array<BuOption>> {
    const fullUrl = "http://localhost:1337/content-manager/collection-types/api::business-unit.business-unit";
    const token = getStrapiToken();
    const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(fullUrl, {
    headers,
    credentials: "include",
  });
  
  const businessUntits = await res.json();
  return businessUntits.results;
}

export {
    fetchFnsBusinessUnits
}