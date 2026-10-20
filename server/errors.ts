import type { ApiErrorCode } from "../shared/api.js";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
  ) {
    super(code);
  }
}
