// Shared API error shape for Keystone API targets.
//
// Lives in its own module so both the internal client (`./client`, proxied
// `/api`) and the external direct-fetch client (`./external`, absolute
// `https://<host>/api`) throw the same class: `instanceof ApiError` checks
// (`isUnsupportedError`, `isPermissionError`) work for either transport.
// `client.ts` re-exports this so existing import sites keep working.

export class ApiError extends Error {
  status: number;
  code?: string;
  kind?: string;

  constructor(message: string, status: number, code?: string, kind?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}
