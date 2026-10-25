import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
type TracedRequest = Request & { requestId: string };
const codes: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<TracedRequest>();
    const res = ctx.getResponse<Response>();
    const parserError =
      exception instanceof Error && 'type' in exception && exception.type === 'entity.too.large';
    const malformed =
      exception instanceof SyntaxError &&
      'type' in exception &&
      exception.type === 'entity.parse.failed';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserError
          ? 413
          : malformed
            ? 400
            : 500;
    const response = exception instanceof HttpException ? exception.getResponse() : null;
    const messages =
      response && typeof response === 'object' && 'message' in response ? response.message : null;
    const details = status === 400 && Array.isArray(messages) ? messages : [];
    res.status(status).json({
      error: {
        code: codes[status] ?? 'INTERNAL_ERROR',
        message:
          status === 500
            ? 'Internal server error'
            : status === 400
              ? 'Invalid request'
              : status === 413
                ? 'Request body too large'
                : typeof messages === 'string'
                  ? messages
                  : 'Request failed',
        requestId: req.requestId,
        details,
      },
    });
  }
}
