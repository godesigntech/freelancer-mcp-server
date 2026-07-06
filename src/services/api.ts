import axios, { AxiosInstance, AxiosError } from "axios";
import { FREELANCER_API_BASE } from "../constants.js";
import { ApiResponse } from "../types.js";

const clients: Map<string, AxiosInstance> = new Map();
let defaultAccount: string | null = null;

/**
 * Initialize one Freelancer API client per configured account. Each account
 * is just a label -> OAuth token pair; no token ever touches disk except in
 * the caller's own MCP client config.
 */
export function initApiClients(accounts: Record<string, string>): void {
  clients.clear();
  defaultAccount = null;
  for (const [label, token] of Object.entries(accounts)) {
    if (!token) continue;
    clients.set(label, axios.create({
      baseURL: FREELANCER_API_BASE,
      headers: {
        "freelancer-oauth-v1": token,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }));
    if (!defaultAccount) defaultAccount = label;
  }
}

export function listAccounts(): string[] {
  return Array.from(clients.keys());
}

function getApiClient(account?: string): AxiosInstance {
  const label = account || defaultAccount;
  if (!label) {
    throw new Error(
      "No Freelancer accounts configured. Set FREELANCER_OAUTH_TOKEN (single account) or " +
        "FREELANCER_ACCOUNTS (multiple, e.g. '{\"main\":\"token1\",\"client2\":\"token2\"}') in your MCP config."
    );
  }
  const client = clients.get(label);
  if (!client) {
    throw new Error(
      `Unknown account "${label}". Configured accounts: ${listAccounts().join(", ") || "none"}. ` +
        `Use freelancer_list_accounts to see what's available.`
    );
  }
  return client;
}

function unwrap<T>(data: ApiResponse<T>): T {
  if (data.status !== "success") {
    throw new Error(data.message || data.error_code || "API returned non-success status");
  }
  return data.result;
}

function toApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<ApiResponse<unknown>>;
    const msg =
      axiosErr.response?.data?.message ||
      axiosErr.response?.data?.error_code ||
      axiosErr.message;
    return new Error(`Freelancer API error (${axiosErr.response?.status}): ${msg}`);
  }
  return error as Error;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, unknown>,
  account?: string
): Promise<T> {
  const client = getApiClient(account);
  try {
    const response = await client.get<ApiResponse<T>>(path, { params });
    return unwrap(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiPost<T>(
  path: string,
  data?: Record<string, unknown>,
  opts?: { form?: boolean; account?: string }
): Promise<T> {
  const client = getApiClient(opts?.account);
  try {
    // The Freelancer API expects application/x-www-form-urlencoded for most
    // write endpoints; JSON bodies are silently ignored or rejected.
    let body: unknown = data;
    let config;
    if (opts?.form && data) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) params.append(`${key}[]`, String(v));
        } else {
          params.append(key, String(value));
        }
      }
      body = params.toString();
      config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };
    }
    const response = await client.post<ApiResponse<T>>(path, body, config);
    return unwrap(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function apiPut<T>(
  path: string,
  data?: Record<string, unknown>,
  account?: string
): Promise<T> {
  const client = getApiClient(account);
  try {
    const response = await client.put<ApiResponse<T>>(path, data);
    return unwrap(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Some Freelancer write endpoints (notably /users/0.1/self/jobs) reject JSON and
 * require application/x-www-form-urlencoded with repeated array keys (jobs[]=1&jobs[]=2).
 * `arrayParams` maps a field name to a list of values serialized that way.
 */
export async function apiForm<T>(
  method: "post" | "put" | "delete",
  path: string,
  arrayParams: Record<string, Array<string | number>> = {},
  scalarParams: Record<string, string | number> = {},
  account?: string
): Promise<T> {
  const client = getApiClient(account);
  const body = new URLSearchParams();
  for (const [key, values] of Object.entries(arrayParams)) {
    for (const v of values) body.append(`${key}[]`, String(v));
  }
  for (const [key, value] of Object.entries(scalarParams)) {
    body.append(key, String(value));
  }
  try {
    const response = await client.request<ApiResponse<T>>({
      method,
      url: path,
      data: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return unwrap(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[Truncated — ${text.length - limit} characters omitted]`;
}

export function formatDate(unix?: number): string {
  if (!unix) return "unknown";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function mcpError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Accept either a raw numeric thread ID or a Freelancer chat URL
 * (e.g. https://www.freelancer.com/messages/thread/123456 or a
 * project-message deep link containing the thread id) and return the ID.
 */
export function resolveThreadId(input: string | number): number {
  if (typeof input === "number") return input;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/(\d+)(?:\D*)?$/) || trimmed.match(/thread[s]?[/=](\d+)/i);
  if (match) return Number(match[1]);
  throw new Error(`Could not extract a thread ID from "${input}". Pass a numeric thread ID or a Freelancer chat link.`);
}

/** Shared account selector schema description, reused across tool inputs. */
export const ACCOUNT_DESC =
  "Which configured Freelancer account to use (see freelancer_list_accounts for labels). Omit to use your default/only account.";
