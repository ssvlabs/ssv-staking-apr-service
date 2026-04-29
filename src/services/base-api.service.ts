import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export abstract class BaseApiService {
  protected readonly client: AxiosInstance;
  protected readonly baseUrl: string;

  protected constructor(
    protected readonly logger: Logger,
    baseURL: string,
    private readonly sourceLabel: string
  ) {
    this.assertValidBaseUrl(baseURL);
    this.baseUrl = baseURL;
    this.client = axios.create({
      baseURL,
      timeout: 30000
    });
  }

  protected async get<T>(path: string): Promise<T> {
    const startTime = Date.now();

    try {
      const response = await this.client.get<T>(path);
      return response.data;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const details = this.formatApiError(error);
      this.logger.error(
        `Failed to fetch ${this.sourceLabel} data after ${elapsed}ms. Details: ${details}`
      );
      throw new Error(`Failed to fetch ${this.sourceLabel} data: ${details}`);
    }
  }

  private assertValidBaseUrl(baseURL: string): void {
    try {
      new URL(baseURL);
    } catch {
      throw new Error(`Invalid ${this.sourceLabel} base URL: "${baseURL}"`);
    }
  }

  private formatApiError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      return `AxiosError: status=${error.response?.status}, statusText=${error.response?.statusText}, url=${error.config?.url}, baseURL=${error.config?.baseURL}, response=${JSON.stringify(error.response?.data)}`;
    }

    if (error instanceof Error) {
      return error.stack || error.message;
    }

    return String(error);
  }
}
