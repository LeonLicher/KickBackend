/* eslint-disable @typescript-eslint/no-explicit-any */
type RequestOptions = {
  headers?: HeadersInit;
  body?: any;
  responseType?: "json" | "text";
};

interface FetchResponse<T> {
  status: number;
  ok: boolean;
  headers: Headers;
  json(): Promise<T>;
  text(): Promise<string>;
}

class HttpClient {
  public usedPlayerIds: Set<string> = new Set();
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    url: string,
    { headers = {}, body, responseType = "json" }: RequestOptions = {}
  ): Promise<T> {
    const fullUrl = `${this.baseUrl}${url}`;

    const requestHeaders = new Headers(headers);
    requestHeaders.append("Content-Type", "application/json");

    // Set accept header based on responseType
    if (responseType === "json") {
      requestHeaders.append("Accept", "application/json");
    } else {
      requestHeaders.append(
        "Accept",
        "text/html,application/xhtml+xml,application/xml"
      );
    }

    requestHeaders.append(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    );

    try {
      const response = (await fetch(fullUrl, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
      })) as FetchResponse<T>;

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      // Check content type to determine how to parse the response
      const contentType = response.headers.get("content-type") || "";

      let responseData: T;
      if (
        responseType === "text" ||
        contentType.includes("text/html") ||
        contentType.includes("text/plain")
      ) {
        responseData = (await response.text()) as unknown as T;
      } else {
        responseData = await response.json();
      }

      return responseData;
    } catch (error) {
      throw error;
    }
  }

  public get<T>(
    url: string,
    headers?: HeadersInit,
    responseType: "json" | "text" = "json"
  ): Promise<T> {
    return this.request<T>("GET", url, { headers, responseType });
  }

  public post<T>(
    url: string,
    body: any,
    headers?: HeadersInit,
    responseType: "json" | "text" = "json"
  ): Promise<T> {
    return this.request<T>("POST", url, { headers, body, responseType });
  }

  public put<T>(
    url: string,
    body: any,
    headers?: HeadersInit,
    responseType: "json" | "text" = "json"
  ): Promise<T> {
    return this.request<T>("PUT", url, { headers, body, responseType });
  }

  public delete<T>(
    url: string,
    headers?: HeadersInit,
    responseType: "json" | "text" = "json"
  ): Promise<T> {
    return this.request<T>("DELETE", url, { headers, responseType });
  }
}

export default HttpClient;
