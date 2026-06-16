import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";

interface ErrorEnvelope {
  error: {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
    path: string;
    timestamp: string;
  };
}

const STATUS_CODE_NAMES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable_entity",
  429: "too_many_requests",
  500: "internal_error",
  501: "not_implemented",
};

function codeForStatus(status: number): string {
  return STATUS_CODE_NAMES[status] ?? `http_${status}`;
}

/** Global exception filter producing a consistent JSON error envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = 500;
    let message = "Internal server error";
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        const rawMessage = record.message;
        message = Array.isArray(rawMessage)
          ? rawMessage.join(", ")
          : typeof rawMessage === "string"
            ? rawMessage
            : exception.message;
        details = record.errors ?? record.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const envelope: ErrorEnvelope = {
      error: {
        statusCode,
        code: codeForStatus(statusCode),
        message,
        ...(details === undefined ? {} : { details }),
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(statusCode).json(envelope);
  }
}
